// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DESTROY (§40.4; protocol docs: xchain-documentation/protocol/actions/
// DESTROY.md), driven through the real form against a real chain instead of
// the source-regex smoke coverage in `test/smoke/actions/destroy-form.smoke.js`.
//
// WHAT THE SMOKE COVERAGE CANNOT REACH. It proves DestroyForm.jsx calls the
// right messaging method with the right action string, and that the core
// flow guards its required inputs before ever reaching a signer. None of
// that proves the chain actually burns anything, or that the typed "DESTROY"
// confirmation gate has real teeth rather than just existing in source. This
// spec drives the real form, signs, broadcasts, and asks the explorer
// whether the destroyed amount is actually gone - the whole point of an
// irreversible action being that there is no form state left to check
// afterwards, only the chain's.
//
// TWO THINGS ASSERTED THAT FORM STATE ALONE CANNOT SHOW
//
// 1. THE TYPED-CONFIRMATION GATE ACTUALLY GATES. Approve stays disabled with
//    no text and with a near-miss typed, and only enables once the word is
//    DESTROY - checked against the live button state, not against the source
//    that defines it. The match is case-insensitive and trimmed by design
//    (DestroyForm.jsx `typedConfirmOk`, the same rule CallbackForm and
//    OracleForm use), so the near-miss here is a misspelling, not a lowercase.
// 2. THE BALANCE ACTUALLY DROPS BY THE DESTROYED AMOUNT, ONCE, on the chain's
//    own read of it - not a balance the wallet only claims to have burned.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    fundAddress,
    mintXchain,
    nudgeChain,
    readReceiveAddress,
    REGTEST_CHAIN_ID,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
const STAMP = Date.now().toString().slice(-6);
const TICK = `DST${STAMP}`;
const SUPPLY = 1000;
const DESTROY_AMOUNT = 250;
/** Pays the ISSUE and DESTROY protocol fees, with room to spare. */
const MINT_XCHAIN = 10;

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Picks `tick` on the venue chain out of DestroyForm's TokenField, which
 * opens the same TokenPicker (`purpose="send"`) the Send form uses, keyed the
 * same way (`data-balance-key="${chainId}:${tick}"`).
 */
async function selectDestroyToken(page, tick) {
    const main = page.getByRole('main');
    const trigger = main.getByRole('button', { name: /^Token: / }).first();
    await expect(trigger, 'no Token field on the Destroy form').toBeVisible({ timeout: 30_000 });
    await trigger.click();

    const search = page.getByLabel('Search coins or tokens');
    await expect(search, 'the Token field did not open the asset picker').toBeVisible({ timeout: 30_000 });
    await search.fill(tick);

    const row = page.locator(`[data-balance-key="${REGTEST_CHAIN_ID}:${tick}"]`).first();
    await expect(row, `the asset picker lists no ${tick} on this chain`).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(main.getByRole('button', { name: /^Token: / }).first())
        .toHaveAttribute('aria-label', new RegExp(`^Token: ${tick} on `), { timeout: 15_000 });
}

/**
 * Waits until `address` holds EXACTLY `expected` of `tick` - the right shape
 * for a burn, where the balance can only ever go down from a known starting
 * point, unlike `waitForTokenBalance`'s `>=` threshold (which would pass
 * immediately here, before the burn has actually landed).
 */
async function waitForExactTickBalance(address, tick, expected, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            last = await tokenBalance(address, tick);
            if (last === expected) return last;
            if (last < expected) {
                throw new Error(`${tick} balance for ${address} dropped below ${expected} (found ${last}): `
                    + 'the DESTROY burned more than requested');
            }
        } catch (err) {
            if (err instanceof Error && err.message.includes('burned more than requested')) throw err;
            // transient venue read; keep waiting
        }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance for ${address} never reached ${expected} (last=${last})`);
}

test.describe('DESTROY on regtest', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('the typed-confirmation gate has real teeth, and the destroyed amount is actually gone on chain', async ({ page }) => {
        let source;

        await test.step('onboard, fund, and issue a token to destroy from', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Destroy Wallet' });
            await switchToRegtest(page, PASSWORD);
            source = await readReceiveAddress(page);
            await fundAddress(source, FUNDING_BTC);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            // ISSUE charges an XCHAIN protocol fee, and the preflight disables
            // Approve on a wallet that holds none.
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(source, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Ticker').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
                await password.fill(PASSWORD);
            }
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmModal(page, 'the ISSUE');
            const issuePassword = page.getByLabel('Password', { exact: true });
            if (await issuePassword.count() > 0 && await issuePassword.isVisible().catch(() => false)) {
                await issuePassword.fill(PASSWORD);
            }
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            await page.getByTestId('confirm-approve').click();

            await expect(page.getByRole('main')).toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
            const issueTxid = (await page.getByRole('main').innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
            expect(issueTxid, 'the ISSUE never showed a transaction id').toBeTruthy();

            const issueAction = await waitForValidAction(issueTxid);
            expect(issueAction.action).toBe('ISSUE');
            await waitForTokenBalance(source, TICK, SUPPLY);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('fill the Destroy form and reach the confirm screen', async () => {
            await gotoPalette(page, 'Destroy');
            const main = page.getByRole('main');
            // Scoped by role (the warning sits in a raw role="alert" div)
            // rather than bare text, matching the rest of this suite's
            // convention for alert-region content.
            await expect(main.getByRole('alert').filter({ hasText: 'Destroy is irreversible.' }))
                .toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await selectDestroyToken(page, TICK);
            // AmountField composes the label as "Amount (TICK)" once a token
            // is selected (packages/core/src/shared/components/AmountField.jsx),
            // so a bare exact "Amount" label never matches; anchor on the
            // prefix the way the Send form's own amount field is addressed.
            await main.getByRole('textbox', { name: /^Amount/ }).fill(String(DESTROY_AMOUNT));
            await main.getByRole('button', { name: 'Destroy', exact: true }).click();

            await expectConfirmModal(page, 'the DESTROY');
            const intent = page.getByTestId('action-intent');
            await expect(intent).toContainText(`Destroy ${DESTROY_AMOUNT} ${TICK}`);
        });

        await test.step('the typed "DESTROY" gate stays closed until the word is right', async () => {
            const password = page.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
                await password.fill(PASSWORD);
            }
            const typed = page.getByLabel('Type "DESTROY" to confirm');
            const approve = page.getByTestId('confirm-approve');

            await expect(approve, 'Approve is enabled with no typed confirmation at all').toBeDisabled();

            await typed.fill('DESTORY');
            await expect(approve, 'Approve is enabled on a misspelled confirmation').toBeDisabled();

            await typed.fill('');
            await typed.fill('DESTROY');
            await expect(approve).toBeEnabled({ timeout: 30_000 });
        });

        await test.step('approve, and the chain shows the exact amount burned, once', async () => {
            const before = await tokenBalance(source, TICK);
            expect(before, 'the ISSUE balance was not what the Destroy form is about to spend from')
                .toBe(SUPPLY);

            await page.getByTestId('confirm-approve').click();
            await expect(page.getByRole('main')).toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
            const txid = (await page.getByRole('main').innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
            expect(txid, 'success screen showed no transaction id').toBeTruthy();

            const action = await waitForValidAction(txid);
            expect(action.action).toBe('DESTROY');
            expect(String(action.tx_data), `unexpected wire format: ${action.tx_data}`)
                .toMatch(/^DESTROY\|/);
            expect(String(action.tx_data)).toContain(String(DESTROY_AMOUNT));

            await waitForExactTickBalance(source, TICK, SUPPLY - DESTROY_AMOUNT);
        });
    });
});
