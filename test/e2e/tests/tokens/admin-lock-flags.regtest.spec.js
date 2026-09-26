// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The four admin locks not covered by genesis-locks.regtest.spec.js. Each flag
// is selected in the real Lock editor and approved on the shared Confirm
// screen. The explorer must then expose all four flags, the corresponding
// consensus fee quotes must refuse the protected edits, and the wallet must
// disable the same controls when the forms are reopened.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    mintXchain,
    nudgeChain,
    readReceiveAddress,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 2;
const XCHAIN_MINT = 40;
const STAMP = Date.now().toString().slice(-6);
const TICK = `ALF${STAMP}`;
const EDITION_SIZE = 100;
const MAX_MINT = 10;

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function reloadToHome(page) {
    await gotoPalette(page, 'Home');
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
}

async function approveAndGetTxid(page) {
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
        await password.fill(PASSWORD);
    }
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled({ timeout: 120_000 });
    await approve.click();

    const main = page.getByRole('main');
    await expect(main, 'no transaction id appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'the success screen showed no transaction id').toBeTruthy();
    return txid;
}

async function openTokenAdmin(page, item, tick = TICK) {
    await reloadToHome(page);
    await gotoPalette(page, 'My Tokens');
    const main = page.getByRole('main');
    const row = main.getByRole('button').filter({ hasText: tick }).first();
    await expect(row, `${tick} is on chain but My Tokens does not list it`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();
    // "Manage Token" is the page title in the banner, outside <main>; the
    // ticker heading is what proves this token's admin page opened.
    await expect(main.getByRole('heading', { name: tick, exact: true }), 'Manage Token did not open on this ticker')
        .toBeVisible({ timeout: 30_000 });

    const button = main.getByRole('button', { name: item, exact: true });
    if (await button.count() > 0 && await button.first().isVisible()) {
        await button.first().click();
        return;
    }
    await main.getByRole('button', { name: /^More/ }).click();
    await main.getByRole('menuitem', { name: item, exact: true }).click();
}

async function waitForLocks(timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const token = await explorerJson(`token/${TICK}`).catch(() => null);
        last = token?.locks ?? last;
        if (last?.max_mint && last?.mint_supply && last?.sleep && last?.callback) {
            return token;
        }
        await nudgeChain();
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`the four admin locks never appeared for ${TICK}: ${JSON.stringify(last)}`);
}

async function feeQuote(action, params, source) {
    const query = new URLSearchParams({ action, params, source });
    return explorerJson(`feequote?${query.toString()}`, { allowErrorBody: true });
}

function quoteVerdict(quote) {
    return String(quote?.status || quote?.error || '');
}

test.describe(`admin lock flags on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('the four remaining locks land on chain and permanently refuse their actions', async ({ page }) => {
        let owner;

        await test.step('onboard, fund the protocol fee, and create a mintable edition', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Admin Lock Flags Wallet' });
            await switchToRegtest(page, PASSWORD);
            owner = await readReceiveAddress(page);
            expect(owner).toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(owner, FUNDING);
            await mintXchain(page, XCHAIN_MINT);
            await waitForTokenBalance(owner, 'XCHAIN', XCHAIN_MINT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await seedPrices();

            await gotoPalette(page, 'Create a token');
            const main = page.getByRole('main');
            await main.getByRole('button', { name: /^Limited edition/ }).click();
            await selectVenueChain(main);
            await main.getByRole('button', { name: 'Next', exact: true }).click();
            await expect(main.getByLabel('Token name (ticker)')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Token name (ticker)').fill(TICK);
            await main.getByLabel('Edition size').fill(String(EDITION_SIZE));
            await main.getByLabel('Copies per mint').fill(String(MAX_MINT));
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmModal(page, 'the edition ISSUE');
            const action = await waitForValidAction(await approveAndGetTxid(page));
            expect(action.action).toBe('ISSUE');
            expect(action.source).toBe(owner);

            const token = await explorerJson(`token/${TICK}`);
            expect(Number(token?.mints?.max), 'the edition has no MAX_MINT to freeze')
                .toBe(MAX_MINT);
            expect(token?.locks?.max_mint).toBe(false);
            expect(token?.locks?.mint_supply).toBe(false);
            expect(token?.locks?.sleep).toBe(false);
            expect(token?.locks?.callback).toBe(false);
        });

        await test.step('set LOCK_MAX_MINT, LOCK_MINT_SUPPLY, LOCK_SLEEP, and LOCK_CALLBACK', async () => {
            await openTokenAdmin(page, 'Lock');
            const main = page.getByRole('main');
            const submit = main.getByRole('button', { name: 'Update token', exact: true });
            await expect(submit).toBeVisible({ timeout: 30_000 });

            const locks = [
                ['Max mint per transaction', 'LOCK_MAX_MINT'],
                ['Mint supply now', 'LOCK_MINT_SUPPLY'],
                ['Sleep', 'LOCK_SLEEP'],
                ['Callback', 'LOCK_CALLBACK'],
            ];
            for (const [label, field] of locks) {
                const checkbox = main.getByRole('checkbox', { name: new RegExp(`^${label}`) });
                await expect(checkbox, `${field} is absent from the admin lock matrix`)
                    .toBeEnabled({ timeout: 30_000 });
                await checkbox.check();
            }

            await expect(submit, 'the irreversible lock update bypassed its typed gate')
                .toBeDisabled();
            await main.getByLabel('Type LOCK to confirm').fill('LOCK');
            await expect(submit).toBeEnabled();
            await submit.click();

            await expectConfirmModal(page, 'the four admin locks');
            const action = await waitForValidAction(await approveAndGetTxid(page));
            expect(action.action, 'admin locks must ride as ISSUE v3').toBe('ISSUE');
            expect(action.source).toBe(owner);

            const token = await waitForLocks();
            expect(token?.locks?.max_mint).toBe(true);
            expect(token?.locks?.mint_supply).toBe(true);
            expect(token?.locks?.sleep).toBe(true);
            expect(token?.locks?.callback).toBe(true);
        });

        await test.step('the explorer fee quote refuses each protected operation by its lock', async () => {
            const maxMint = await feeQuote('ISSUE', `2|${TICK}|5`, owner);
            expect(quoteVerdict(maxMint), 'LOCK_MAX_MINT did not freeze MAX_MINT')
                .toMatch(/MAX_MINT \(locked\)/i);

            const mintSupply = await feeQuote('ISSUE', `2|${TICK}||1`, owner);
            expect(quoteVerdict(mintSupply), 'LOCK_MINT_SUPPLY did not refuse MINT_SUPPLY')
                .toMatch(/MINT_SUPPLY \(locked\)/i);

            const sleep = await feeQuote('SLEEP', `1|-1|${TICK}`, owner);
            expect(quoteVerdict(sleep), 'LOCK_SLEEP did not refuse a token pause')
                .toMatch(/LOCK_SLEEP/i);

            const callback = await feeQuote('ISSUE', `4|${TICK}|999999999|XCHAIN|1`, owner);
            expect(quoteVerdict(callback), 'LOCK_CALLBACK did not freeze callback configuration')
                .toMatch(/CALLBACK_(BLOCK|TICK|AMOUNT) \(locked\)/i);
        });

        await test.step('Mint settings disables both locked ISSUE v2 fields', async () => {
            await openTokenAdmin(page, 'Mint settings');
            const main = page.getByRole('main');
            await expect(main.getByRole('alert').filter({ hasText: /LOCK_MAX_MINT/ }))
                .toBeVisible({ timeout: 30_000 });
            await expect(main.getByRole('alert').filter({ hasText: /LOCK_MINT_SUPPLY/ }))
                .toBeVisible({ timeout: 30_000 });
            await expect(main.getByLabel('Max mint per transaction (optional)')).toBeDisabled();
            await expect(main.getByLabel('Mint supply now (optional)')).toBeDisabled();
            await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
        });

        await test.step('Pause token refuses SLEEP before composition', async () => {
            await openTokenAdmin(page, 'Pause token');
            const main = page.getByRole('main');
            await expect(main.getByRole('alert').filter({ hasText: /LOCK_SLEEP/ }))
                .toBeVisible({ timeout: 30_000 });
            await expect(main.getByRole('radio', { name: /Pause indefinitely/ })).toBeDisabled();
            await expect(main.getByRole('button', { name: 'Pause token', exact: true })).toBeDisabled();
            await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
        });

        await test.step('Callback settings refuses edits before composition', async () => {
            await openTokenAdmin(page, 'Callback settings');
            const main = page.getByRole('main');
            await expect(main.getByRole('alert').filter({ hasText: /LOCK_CALLBACK/ }))
                .toBeVisible({ timeout: 30_000 });
            await expect(main.getByLabel('Callback token')).toBeDisabled();
            await expect(main.getByLabel('Payout per unit')).toBeDisabled();
            await expect(main.getByLabel('Callback allowed from block')).toBeDisabled();
            await expect(main.getByRole('button', { name: 'Update token', exact: true }))
                .toBeDisabled();
            await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
        });
    });
});
