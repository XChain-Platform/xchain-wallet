// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "DEX / Markets + SWAP": the TRUE ORDER lane - the
// native-coin limit order authored by CreateOrderForm (PC-17), listed by
// MyOrdersView and closed by ORDER v1. It has been ⬜ since Session 4, which
// proved SWAP (token-for-token, all-or-nothing) and explicitly did NOT prove
// this: they are different actions with different escrow behaviour.
//
// WHAT MAKES THIS WORTH A SPEC RATHER THAN A SESSION NOTE. Placing an order
// MOVES MONEY before anything matches: the indexer debits GIVE_AMOUNT from the
// seller and parks it in escrow (`order.js`, format 0), and only a cancel,
// an expiry or a match brings it back. So the lane has a closed loop that the
// chain itself can settle - balance B, then B - stake while the order is open,
// then B again after the cancel - and every step of it is a claim the screen
// makes that the chain can refute. A read-only "the form renders" pass would
// prove none of it.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dex/order-lifecycle.regtest.spec.js
//
// It runs on any venue, but Bitcoin's regtest indexer is wedged at block 10818
// (campaign §3.7), and every assertion here is a question for the
// indexer, so RLTC is where it can actually answer.
//
// THE PAIR IS DELIBERATE: GIVE a token, GET native coin. That is the side the
// per-market OpenOrdersPanel silently drops and the reason MyOrdersView exists,
// and it is the only shape where the GIVE side escrows (a native-coin GIVE
// escrows nothing; it creates a CoinPay obligation at match time instead). The
// default 90-day expiration window is used on purpose: the ORDER fee is
// duration-metered with 90 free days, so this spec sits OFF the fee lane that
// §11 already covers and any coin movement here is escrow, not fee.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    EXPLORER_URL,
    fundAddress,
    minerRpc,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
/** Minted before the order, so the escrow debit has room to be visible. */
const MINT = 1000;
/** The escrowed side. A round number: an off-by-a-fee debit must not hide in it. */
const GIVE = 100;
/** The ask, in native coin. Never paid here - nothing matches this order. */
const GET = '0.5';
/** The chain's own ticker. */
const COIN = REGTEST_COIN.replace(/^R/, '');

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * Mines only when something is actually waiting for a block (§3.5).
 *
 * The fixture's own waiters mine on every pass, which drove one venue 161
 * blocks forward in a single wait and left the decoder 149 behind - so the
 * action being waited for missed its own budget. Blocks are only ever needed
 * to ADVANCE state, never to reveal state already mined.
 */
async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

/**
 * The indexed action for a txid, found in the LIST rather than by probing an
 * index: a speculative `GET /api/action/<index>` before the indexer writes its
 * row poisons that index permanently (§3.6).
 */
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
    throw new Error(
        `No XChain action recorded for ${txid} within ${Math.round(timeoutMs / 1000)}s. `
        + `Chain tip ${status?.chain_tip?.[REGTEST_COIN]}, decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}. A non-zero decoder lag means the venue is `
        + 'behind, not that the wallet sent something wrong.');
}

/**
 * The cancel and edit panels report no txid (they are fire-and-forget), so
 * their actions are found the only other way the chain offers: the newest
 * action of that type from this source. The wallet under test is
 * single-purpose and freshly created, so "the newest one from this address"
 * is unambiguous.
 */
async function waitForActionFrom(source, actionName, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100');
        const row = (list?.data || []).find((r) => String(r.action) === actionName
            && String(r.source) === source);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`No ${actionName} from ${source} within ${Math.round(timeoutMs / 1000)}s`);
}

const waitForOrderCancel = (source) => waitForActionFrom(source, 'ORDER_CANCEL');

/**
 * Polls an order's own row until its expiration is the edited one.
 *
 * The edit action indexing and the order's state carrying it are two separate
 * facts, and the explorer serves them a beat apart (the same lag that made a
 * single balance read report an escrow of zero), so this waits for the second
 * rather than asserting on it immediately.
 */
async function waitForOrderExpiration(orderIndex, expected, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let detail = null;
    while (Date.now() < deadline) {
        detail = await explorerJson(`action/${orderIndex}`).catch(() => detail);
        if (Number(detail?.state?.expiration) === expected) return detail;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    return detail || {};
}

/**
 * Waits for a token balance to STOP being `from`, and returns what it became.
 *
 * The explorer serves the action row before it serves that action's effect on
 * the balance view, so a single read taken the moment `waitForIndexedAction`
 * returns can still show the pre-action figure - which reads exactly like "the
 * order escrowed nothing" (it cost this spec a run). Polling for the change and
 * THEN asserting the exact delta keeps the assertion honest: a wrong-sized
 * escrow still fails, and one that never happens fails here by name.
 */
async function waitForBalanceChange(address, tick, from, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = from;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last !== from) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance for ${address} never moved off ${from}`);
}

/** Waits for a token balance to reach `min` without outrunning the decoder. */
async function waitForBalanceAtLeast(address, tick, min, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = 0;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last >= min) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
}

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

/** Approves the open confirm screen and returns the broadcast txid. */
async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    // No \b anchors: this screen renders the id with no separators around it.
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/**
 * Onboards a wallet on the venue chain, funds it and mints the token the
 * order will escrow. Returns the source address.
 */
async function onboardFundMint(page, walletName) {
    await createWallet(page, { password: PASSWORD, name: walletName });
    await switchToRegtest(page, PASSWORD);

    await gotoPalette(page, 'Create order');
    const main = page.getByRole('main');
    await expect(main.getByLabel('From address')).toBeVisible({ timeout: 30_000 });
    // Every action form carries its own chain picker and they all default to
    // Bitcoin (§3.5), so a form without one composes on whatever chain the
    // wallet happens to list first - which on a regtest wallet is not this
    // venue. This form had no picker at all until this spec asked for one.
    await selectVenueChain(main);
    const source = await main.getByLabel('From address').inputValue();
    expect(source, `the Create order form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
        .toMatch(REGTEST_ADDRESS_RE);

    await fundAddress(source, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);

    await mintXchain(page, MINT);
    await waitForBalanceAtLeast(source, 'XCHAIN', MINT);
    return source;
}

/**
 * Authors and broadcasts the token-for-native-coin order, and returns the
 * indexed action once the chain has accepted it.
 */
async function placeOrder(page) {
    await gotoPalette(page, 'Create order');
    const main = page.getByRole('main');
    await expect(main.getByLabel('From address')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);

    // The default sides are exactly the pair this spec is about (give a
    // token, get native coin); asserted rather than assumed, because a
    // changed default would silently move the test onto a shape that
    // escrows nothing.
    // `exact` matters on both fields: the give side also carries a "Trade
    // ownership of this ticker" checkbox, and the get side an "Amount (LTC)"
    // - a loose label match resolves to two elements.
    await expect(main.getByLabel('Ticker', { exact: true }),
        'the give side no longer defaults to a token, so nothing would be escrowed')
        .toBeVisible();
    await main.getByLabel('Ticker', { exact: true }).fill('XCHAIN');
    await main.getByLabel('Amount', { exact: true }).fill(String(GIVE));
    await main.getByLabel(`Amount (${COIN})`).fill(GET);

    await main.getByRole('button', { name: /^Place order/ }).click();

    await expectConfirmModal(page, 'this action', 60_000);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    const txid = await approveAndGetTxid(page);
    expect(txid, 'the order screen showed no transaction id').toBeTruthy();

    const action = await waitForIndexedAction(txid);
    expect(String(action.action), 'the wallet broadcast something other than an ORDER')
        .toBe('ORDER');
    expect(String(action.status), 'the chain rejected the order').toBe('valid');
    return action;
}

/** The open-order row in My orders, located by the index the chain gave it. */
function orderRow(page, orderIndex) {
    return page.getByRole('main').getByRole('listitem').filter({ hasText: `#${orderIndex}` });
}

test.describe(`the DEX ORDER lane on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('an order escrows the give side, lists as open, and a cancel returns it', async ({ page }) => {
        let source;
        let orderIndex;

        await test.step('onboard, fund and mint the side to be escrowed', async () => {
            source = await onboardFundMint(page, 'Order Lane Wallet');
        });

        await test.step('place the order and ask the chain what it escrowed', async () => {
            const before = await tokenBalance(source, 'XCHAIN');
            expect(before, 'the mint that funds this order never landed').toBeGreaterThanOrEqual(MINT);

            const action = await placeOrder(page);
            orderIndex = String(action.action_index);
            expect(action.fee,
                'the default-window order was charged a protocol fee, so this spec is measuring a fee '
                + 'as well as an escrow and the two cannot be told apart')
                .toBeNull();

            // The escrow, measured rather than read: an open order holds the
            // give side, so the seller's spendable balance must fall by
            // exactly the stake and by nothing else. The default window is
            // inside the 90 free days, so there is no protocol fee to blur it.
            const after = await waitForBalanceChange(source, 'XCHAIN', before);
            expect(before - after,
                `placing the order moved ${before - after} XCHAIN; the order escrows ${GIVE}`)
                .toBe(GIVE);
        });

        await test.step('My orders lists it as open, on chain terms', async () => {
            await gotoPalette(page, 'My orders');
            const row = orderRow(page, orderIndex);
            await expect(row, `the order this wallet just placed (#${orderIndex}) is not in My orders`)
                .toBeVisible({ timeout: 60_000 });
            await expect(row, 'the row does not state the side it escrowed').toContainText('XCHAIN');
            await expect(row, 'an order the chain calls open is not shown as open').toContainText('Open');
        });

        await test.step('cancel it, and the escrow comes back', async () => {
            const before = await tokenBalance(source, 'XCHAIN');
            const main = page.getByRole('main');
            await orderRow(page, orderIndex).getByRole('button', { name: 'Cancel', exact: true }).click();

            // The panel's own promise, which is the claim the chain settles
            // below. (Its title lives in the page header, not in a heading
            // element, so asserting a heading here would fail on a correct
            // screen.)
            await expect(main.getByText(/Cancelling closes the order and returns the escrowed/),
                'the cancel panel never opened for this order')
                .toBeVisible({ timeout: 30_000 });
            await expect(main, 'the cancel panel is pointed at a different order')
                .toContainText(`#${orderIndex}`);
            await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
            await page.getByRole('button', { name: 'Sign cancel' }).click();
            await expect(page.getByText('Cancel broadcast'),
                'the cancel never reported being broadcast')
                .toBeVisible({ timeout: 120_000 });

            const cancel = await waitForOrderCancel(source, orderIndex);
            expect(String(cancel.status), 'the chain rejected the cancel').toBe('valid');

            // The other half of the closed loop: what the order took out, the
            // cancel puts back, to the satoshi. A partial return would leave
            // the seller short with nothing on screen to say so.
            const after = await waitForBalanceAtLeast(source, 'XCHAIN', before + GIVE);
            expect(after - before,
                `the cancel returned ${after - before} XCHAIN of the ${GIVE} it escrowed`)
                .toBe(GIVE);
        });

        await test.step('and the list agrees with the chain afterwards', async () => {
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await gotoPalette(page, 'My orders');
            const row = orderRow(page, orderIndex);
            await expect(row, `#${orderIndex} vanished from My orders after being cancelled`)
                .toBeVisible({ timeout: 60_000 });
            await expect(row,
                'a cancelled order still reads as open, which is an invitation to wait for a match '
                + 'that can never come')
                .toContainText('Cancelled', { timeout: 60_000 });
        });
    });

    // The edit lane shares the cancel lane's plumbing (no confirm screen, so it
    // always builds live) and shared exactly its defect, which is why it is
    // driven here rather than trusted to the unit pin: a fix applied to two
    // call sites and verified at one is half a fix.
    //
    // The new expiration is deliberately EARLIER than the order's default
    // window. An edit that pushes the expiration OUT re-charges the
    // duration-metered fee (`getUnifiedExpirationFee`, format 2), and this
    // spec is not the fee lane; shortening is free, so what the chain records
    // is the edit alone.
    test('an open order can be edited, and the chain takes the new expiration', async ({ page }) => {
        const source = await onboardFundMint(page, 'Order Edit Wallet');
        const order = await placeOrder(page);
        const orderIndex = String(order.action_index);
        const originalExpiration = Number(order.expiration);
        expect(originalExpiration, 'the order carries no expiration to edit')
            .toBeGreaterThan(0);

        // 30 days out: comfortably inside the default 90-day window (so no fee)
        // and far enough from it that a wrong-unit conversion cannot land on it
        // by accident.
        const target = new Date((originalExpiration - 60 * 86_400) * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        const localInput = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-`
            + `${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
        // The form reads a local datetime and the chain stores Unix seconds, so
        // the expected value is derived the same way the form does it - to the
        // minute, since the input has no seconds.
        const expectedUnix = Math.floor(Date.parse(localInput) / 1000);

        await test.step('edit the expiration from My orders', async () => {
            await gotoPalette(page, 'My orders');
            const row = orderRow(page, orderIndex);
            await expect(row, `#${orderIndex} is not in My orders to edit`)
                .toBeVisible({ timeout: 60_000 });
            await row.getByRole('button', { name: 'Edit', exact: true }).click();

            const main = page.getByRole('main');
            const expiration = main.getByLabel('New expiration (optional)');
            await expect(expiration, 'the edit panel never opened for this order')
                .toBeVisible({ timeout: 30_000 });
            await expect(main, 'the edit panel is pointed at a different order')
                .toContainText(`#${orderIndex}`);

            // A blank edit is refused before anything is signed: the wire has
            // no way to say "change nothing", so an empty submit would spend a
            // miner fee to say nothing.
            await expect(main.getByRole('button', { name: 'Sign edit' }),
                'an edit with no change offers to broadcast')
                .toBeDisabled();

            await expiration.fill(localInput);
            await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
            await page.getByRole('button', { name: 'Sign edit' }).click();
            await expect(page.getByText('Edit broadcast'),
                'the edit never reported being broadcast')
                .toBeVisible({ timeout: 120_000 });
        });

        await test.step('the chain records the edit against the order', async () => {
            const edit = await waitForActionFrom(source, 'ORDER_EDIT');
            expect(String(edit.status), 'the chain rejected the edit').toBe('valid');
            expect(String(edit.order_action_index),
                'the edit named a different order than the row it was opened from')
                .toBe(orderIndex);
            expect(edit.fee,
                'shortening an order\'s life was charged a protocol fee')
                .toBeNull();

            // The order's own state is what a matcher reads, so that is where
            // the edit has to land - not merely in the edit action's payload.
            const updated = await waitForOrderExpiration(orderIndex, expectedUnix);
            expect(Number(updated.state?.expiration),
                `the order still expires at ${originalExpiration}; the edit asked for ${expectedUnix}`)
                .toBe(expectedUnix);
            expect(String(updated.state?.status),
                'editing an order closed it, which would strand the escrow')
                .toBe('open');
        });
    });
});
