// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "DEX / Markets + SWAP": PC-16 auto-pay ARMING - the
// wallet's only feature that agrees, in advance, to spend coin without asking
// again.
//
// WHY THIS IS THE PART WORTH DRIVING NOW. A native-coin GIVE order escrows
// nothing; when it matches, the seller's tokens stay escrowed and the coin side
// owes a CoinPay payment on a deadline. Auto-pay is the wallet promising to make
// that payment unattended. The PAYING half needs a match and is blocked behind
// D-135 (the venue refuses to compose an order that fills on arrival), but
// the ARMING half - the consent, the keep-open confirm notice, the per-order
// revocation - needs no counterparty at all and had never been driven.
//
// THE ORDER GETS A FRESHLY ISSUED TOKEN ON ITS GET SIDE, deliberately: a mirror
// of any order already open on this shared venue would MATCH on arrival, and this
// spec would then be blocked on someone else's leftovers as well as on.
// A tick minted by this run has no counterparty by construction.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dex/order-autopay-arming.regtest.spec.js

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    EXPLORER_URL,
    fundAddress,
    issuePlainToken,
    readIssueSource,
    minerRpc,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    openFromAddress,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 2;
const SUPPLY = '1000';
/** XCHAIN minted for the ISSUE protocol fee. */
const GAS_XCHAIN = 10;
const STAMP = Date.now().toString().slice(-6);
/** The GET side: this run's own token, so nothing on the venue can cross it. */
const TICK = `APY${STAMP}`;
/** The GIVE side, in native coin. Never actually paid: nothing matches. */
const GIVE_COIN = '0.5';
const WANT_TOKENS = 100;
const COIN = REGTEST_COIN.replace(/^R/, '');

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100');
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(`No XChain action recorded for ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s. Decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}.`);
}

async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/** Fills the native-GIVE / token-GET pair this spec arms auto-pay on. */
async function fillNativeGiveOrder(main) {
    // Radios come in DOM order: the "You give" group first, "You get" second.
    await main.getByRole('radio', { name: `Native ${COIN}` }).first().check();
    await main.getByRole('radio', { name: 'A token' }).last().check();
    await main.getByLabel(`Amount (${COIN})`).fill(GIVE_COIN);
    await main.getByLabel('Ticker', { exact: true }).fill(TICK);
    await main.getByLabel('Amount', { exact: true }).fill(String(WANT_TOKENS));
}

test.describe(`PC-16 auto-pay arming on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('arming is gated, stated, recorded against the order, and revocable', async ({ page }) => {
        let source;
        let orderIndex;

        await test.step('onboard, fund, and issue the token this order asks for', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Autopay Wallet' });
            await switchToRegtest(page, PASSWORD);

            await openPaletteCommand(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            source = await readIssueSource(main);
            expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // The ISSUE protocol fee is charged in XCHAIN; a fresh wallet holds none, and the
            // confirm screen then refuses with "insufficient funds (FEE)" and keeps Approve off.
            await mintXchain(page, GAS_XCHAIN);
            await waitForTokenBalance(source, 'XCHAIN', GAS_XCHAIN);

            await openPaletteCommand(page, 'Issue token');
            const form = page.getByRole('main');
            await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await readIssueSource(form);
            await issuePlainToken(form, { ticker: TICK, supply: SUPPLY });
            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const issued = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(issued.status),
                `the venue rejected the ISSUE (${issued.status}); on this chain that is usually the `
                + 'price sentinel going stale mid-run (campaign §3.2), not a wallet defect')
                .toBe('valid');
        });

        await test.step('the arming offer carries no acknowledgement gate', async () => {
            await openPaletteCommand(page, 'Create order');
            const main = page.getByRole('main');
            await expect(await openFromAddress(main)).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await fillNativeGiveOrder(main);

            // Auto-pay is offered ON by default, and only on this shape: a
            // token GIVE escrows instead, and there is nothing to pay later.
            const autopay = main.getByRole('switch', { name: 'Auto pay', exact: true });
            await expect(autopay, 'a native-coin GIVE offers no auto-pay control, so PC-16 never arms')
                .toBeVisible();
            await expect(autopay, 'auto-pay is not the default on the shape that can use it')
                .toBeChecked();

            // The web shell can only pay while it is open; the confirm screen
            // says so, and the form asks for no acknowledgement checkbox.
            await expect(main.getByRole('checkbox', { name: /I understand/ }),
                'the form still gates an armed order on an acknowledgement checkbox')
                .toHaveCount(0);
        });

        await test.step('place it, and read what the wallet promises', async () => {
            const main = page.getByRole('main');
            await main.getByRole('button', { name: /^Place order/ }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-summary-notice'),
                'the web wallet arms unattended payments without telling the user it can only make '
                + 'them while it is open')
                .toContainText(/paid while the wallet is open, even when it's locked/);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const txid = await approveAndGetTxid(page);

            // The success screen has to state which of the two outcomes happened:
            // consent can fail to record even though the order is on chain, and
            // the copy distinguishes them.
            await expect(page.getByRole('main'),
                'the wallet armed an unattended payment agreement and said nothing about it')
                .toContainText(/Auto pay is armed/, { timeout: 30_000 });

            const order = await waitForIndexedAction(txid);
            expect(String(order.action)).toBe('ORDER');
            expect(String(order.status), 'the chain rejected the order').toBe('valid');
            expect(order.escrows,
                'the native-coin GIVE side escrowed something; it commits through the CoinPay '
                + 'obligation at match time, not through escrow')
                .toBeFalsy();
            orderIndex = String(order.action_index);
        });

        await test.step('the consent is attached to THAT order, and can be revoked', async () => {
            await openPaletteCommand(page, 'My orders');
            // The switch moved from the row to the order's detail page
            // (2026-11-13), where it heads the Details tab as a setting row
            // (wallet-orders-layout-1-ring). The ring layout's row names the
            // trade, not the order number, so it is found by its order key.
            const openOrderDetails = async () => {
                const page_ = page.getByRole('main');
                const orderRow = page_.locator(`[data-order-row$=":${orderIndex}"]`);
                await expect(orderRow, `the order (#${orderIndex}) is not in My orders`)
                    .toBeVisible({ timeout: 60_000 });
                await orderRow.getByRole('button').click();
                await page_.getByRole('tab', { name: 'Details' }).click({ timeout: 30_000 });
                return page_;
            };
            const row = await openOrderDetails();

            // The consent record is keyed by txid at broadcast and only gains its
            // orderActionIndex when a later pass resolves it, so this toggle
            // appearing at all is the backfill working end to end.
            const toggle = row.getByRole('switch', { name: /^Auto pay (on|off)/ });
            await expect(toggle,
                'the armed order carries no auto-pay control on its detail page, so the consent cannot be '
                + 'seen or withdrawn')
                .toBeVisible({ timeout: 60_000 });
            await expect(row, 'the page does not say the order is armed').toContainText(/auto pay on/i);
            await expect(toggle).toBeChecked();

            // click(), NOT uncheck(): the switch is CONTROLLED by the consent
            // record and the flip is an async round trip to the host. A user click
            // sets the DOM checked to false, React re-renders it back to true from
            // unchanged state, and only when the write returns does it settle on
            // false. uncheck() reads that intermediate as "the click did not take"
            // and clicks again, toggling it back - so the assertion below is the
            // settled ROW TEXT rather than the input element.
            await toggle.click();
            await expect(row,
                'revoking auto-pay left the row still claiming it is armed')
                .toContainText(/notify-only/, { timeout: 60_000 });

            // Revocation is a safety control, so it has to survive a reload -
            // an in-memory-only "off" would silently re-arm.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await openPaletteCommand(page, 'My orders');
            const reloaded = await openOrderDetails();
            await expect(reloaded,
                'auto-pay re-armed itself across a reload, so a revocation the user made does not '
                + 'hold and the wallet may pay a match they refused')
                .toContainText(/notify-only/, { timeout: 60_000 });
        });
    });
});
