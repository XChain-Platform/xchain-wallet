// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "DEX / Markets + SWAP": the market SIDE of an order.
// `order-lifecycle.regtest.spec.js` proves what an order does to the ledger and
// to My orders; this proves what it does to the thing a counterparty actually
// browses - the markets list, the pair's own view, and the order book.
//
// WHY IT IS WORTH DRIVING. Session 4 could only ever see the empty state ("No
// markets for BTC"), because no order had ever been placed from the wallet on a
// pair. An order that no one can SEE cannot be filled by a human, so "the order
// is on chain" and "the order is on the market" are two different claims and
// only the first has ever been checked.
//
// THE PAIR IS TOKEN-FOR-TOKEN HERE, deliberately: the `markets` table joins BOTH
// sides to a real ticker (explorer db.js getMarkets INNER JOINs index_tickers
// twice), so a native-coin side - which carries a NULL tick - can never produce a
// market row at all. That is a platform design fact, not a wallet bug.
//
// AND THE ORDER CARRIES A MEMO, which is not decoration: driving this lane found
// that an order WITHOUT one is missing from the book entirely
// (D-136/ - `getOrderInfoBatch` INNER JOINed `index_memos`, and MEMO is an
// optional field, so the book silently dropped every order that omitted it).
// Fixed in xchain-explorer, but a venue runs a built image, so this spec pins the
// working shape today and its second test - the same order with NO memo, which is
// what the wallet's form produces unless you open "Advanced options" - is gated on
// the venue carrying the fix.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dex/market-view.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    mintXchain,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** ISSUE pays a real coin fee on this chain , so fund generously. */
const FUNDING = 2;
const SUPPLY = '1000';
const STAMP = Date.now().toString().slice(-6);
const TICK = `MKT${STAMP}`;
/** The order this run puts on the book: give the new token, get XCHAIN. */
const GIVE = 100;
const GET = 5;
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

/** The venue's own order book for a pair, once it carries an ask. */
async function waitForBookAsk(tick1, tick2, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let book = null;
    while (Date.now() < deadline) {
        book = await explorerJson(`market/${tick1}/${tick2}/orderbook`).catch(() => book);
        if (book && Array.isArray(book.asks) && book.asks.length > 0) return book;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    return book || { asks: [], bids: [] };
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

async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

test.describe(`the DEX market view on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('an order reaches the market a counterparty browses, and the book quotes it', async ({ page }) => {
        let source;

        await test.step('onboard, fund, and issue the token this market is made of', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Market View Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            source = await main.getByLabel('From').inputValue();
            expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const form = page.getByRole('main');
            await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(form);
            await form.getByLabel('Ticker').fill(TICK);
            await form.getByLabel('Supply', { exact: true }).fill(SUPPLY);
            const password = form.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await form.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const issued = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(issued.status),
                `the venue rejected the ISSUE (${issued.status}); on this chain that is usually the `
                + 'price sentinel going stale mid-run, not a wallet defect (campaign §3.2)')
                .toBe('valid');
        });

        await test.step('place a token-for-token order, which is what creates a market', async () => {
            await gotoPalette(page, 'Create order');
            const main = page.getByRole('main');
            await expect(main.getByLabel('From address')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            // Both sides are tokens here, so each SideEditor renders its own
            // Ticker + Amount: first() is "You give", last() is "You get".
            await main.getByRole('radio', { name: 'A token' }).last().check();
            await main.getByLabel('Ticker', { exact: true }).first().fill(TICK);
            await main.getByLabel('Amount', { exact: true }).first().fill(String(GIVE));
            await main.getByLabel('Ticker', { exact: true }).last().fill('XCHAIN');
            await main.getByLabel('Amount', { exact: true }).last().fill(String(GET));

            // The memo is load-bearing on a venue that has not taken the
            // D-136/ fix: without it the book drops the order. Set here so
            // this test pins the market path itself rather than re-failing on a
            // defect its sibling below already owns.
            await main.getByRole('button', { name: /Advanced options/ }).click();
            await main.getByLabel('Memo (optional)').fill(`book ${STAMP}`);

            await main.getByRole('button', { name: /^Place order/ }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const order = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(order.action)).toBe('ORDER');
            expect(String(order.status), 'the chain rejected the order').toBe('valid');
        });

        await test.step('the venue now carries the market and the ask', async () => {
            const book = await waitForBookAsk(TICK, 'XCHAIN');
            expect(book.asks.length,
                `the order is on chain but ${TICK}/XCHAIN has an empty book, so nobody browsing the `
                + 'DEX can see it')
                .toBeGreaterThan(0);
            // The book quotes [price, amount]; the amount is what was escrowed.
            const ask = book.asks.find((a) => Math.round(Number(a[1])) === GIVE);
            expect(ask, `no ask for the ${GIVE} ${TICK} this run escrowed (book: `
                + `${JSON.stringify(book.asks)})`).toBeTruthy();
            expect(Number(ask[0]),
                `the book prices the order at ${ask?.[0]} XCHAIN per ${TICK}; the order asked `
                + `${GET} for ${GIVE}`)
                .toBeCloseTo(GET / GIVE, 8);

            const markets = await explorerJson(`markets/${TICK}`);
            const pair = (markets?.data || []).find((m) => [m.tick1, m.tick2].includes(TICK));
            expect(pair, `${TICK} has no market row, so it cannot appear in any markets list`)
                .toBeTruthy();
        });

        await test.step('and the wallet shows it where a counterparty would look', async () => {
            await page.getByRole('button', { name: 'DEX' }).first().click();
            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: /^(Change asset|Select coin or token)/ }),
                'the DEX screen never rendered its asset selector')
                .toBeVisible({ timeout: 30_000 });

            await main.getByRole('button', { name: /^(Change asset|Select coin or token)/ }).click();
            const search = page.getByRole('textbox').first();
            await expect(search).toBeVisible({ timeout: 30_000 });
            await search.fill(TICK);
            await page.getByText(TICK, { exact: true }).first().click();

            // "All" rather than "Popular": a market minutes old has no volume,
            // and Popular is volume-ranked.
            await main.getByRole('tab', { name: 'All' }).click();
            // Each row names the OTHER side of the pair (the selected asset is
            // the column the list is scoped to), so the row for this run's market
            // reads "XCHAIN", not the token that was just issued.
            const row = main.getByRole('listitem').filter({ hasText: 'XCHAIN' }).first();
            await expect(row,
                `${TICK}/XCHAIN is on the venue's own markets feed but the wallet's DEX list does not `
                + 'show it')
                .toBeVisible({ timeout: 60_000 });

            await row.click();
            await expect(page.getByText(`${TICK}/XCHAIN`).or(page.getByText(`XCHAIN/${TICK}`)).first(),
                'the market row did not open its pair view')
                .toBeVisible({ timeout: 30_000 });
            await main.getByRole('tab', { name: 'Book' }).click();
            await expect(main,
                'the pair view opened on an empty book while the venue quotes an ask for it')
                .toContainText(String(GIVE), { timeout: 60_000 });
        });
    });

    // The same lane with the field left blank, which is what the form produces
    // unless the user opens "Advanced options" - so this is the ordinary case,
    // and it is the one that was broken.
    test('an order with no memo is on the book too (D-136/)', async ({ page }) => {
        const noMemoTick = `NMO${STAMP}`;

        await test.step('issue, order without a memo, and expect the book to carry it', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Memoless Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            let main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            const source = await main.getByLabel('From').inputValue();
            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Ticker').fill(noMemoTick);
            await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const issued = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(issued.status), 'the venue rejected the ISSUE').toBe('valid');

            await gotoPalette(page, 'Create order');
            main = page.getByRole('main');
            await expect(main.getByLabel('From address')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByRole('radio', { name: 'A token' }).last().check();
            await main.getByLabel('Ticker', { exact: true }).first().fill(noMemoTick);
            await main.getByLabel('Amount', { exact: true }).first().fill(String(GIVE));
            await main.getByLabel('Ticker', { exact: true }).last().fill('XCHAIN');
            await main.getByLabel('Amount', { exact: true }).last().fill(String(GET));
            // No memo: the field is never opened.
            await main.getByRole('button', { name: /^Place order/ }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const order = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(order.status), 'the chain rejected the order').toBe('valid');
            expect(order.memo, 'this test is only meaningful with the memo left unset').toBeNull();

            const book = await waitForBookAsk(noMemoTick, 'XCHAIN');

            // THE VENUE GATE, checked here because only now does a memo-less
            // order this run controls exist to probe with. The defect's exact
            // signature: the pair HAS a market row carrying the ask price (so the
            // order reached the market) while the BOOK is empty (so the second
            // pass dropped it on the memo join). Anything else is a real failure
            // and must not be skipped.
            const markets = await explorerJson(`markets/${noMemoTick}`);
            const pair = (markets?.data || []).find((m) => [m.tick1, m.tick2].includes(noMemoTick));
            const marketHasAsk = pair
                && [pair.tick1_ask, pair.tick2_ask].some((a) => Number(a) > 0);
            test.skip(book.asks.length === 0 && Boolean(marketHasAsk),
                `this venue's explorer still drops orders with no MEMO from the book: order for `
                + `${noMemoTick}/XCHAIN is valid and open, its market row carries an ask, and the book `
                + 'is empty. Fixed in xchain-explorer/src/db.js (getOrderInfoBatch + getOrderInfo now '
                + 'LEFT JOIN index_memos, matching the 50 other joins in that file) and pinned by '
                + 'test/unit/db.orderbook-memoless.test.js; rebuild the explorer image to run this '
                + 'lane.');

            expect(book.asks.length,
                'an order with no memo is on chain, open, and absent from its own order book, so '
                + 'every ordinary order the wallet places is invisible to counterparties')
                .toBeGreaterThan(0);
        });
    });
});
