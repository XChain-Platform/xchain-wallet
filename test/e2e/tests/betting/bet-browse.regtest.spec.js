// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §10.1: the betting BROWSE layer - the status pills, the
// taking-bets/all filter, and the chain filter.
//
// WHY A SPEC RATHER THAN A SESSION NOTE. Everything §10.2-§10.6 checks is read
// back through this list, so a browse bug reads as a bug in whatever flow
// happened to be running. And the one property worth pinning is invisible on a
// quiet venue: the pill must show the status the CHAIN stored, never one
// recomputed from the reader's clock. Those two agree almost always, which is
// exactly why a regression here would survive every other betting spec.
//
// HOW THE DISAGREEMENT IS MANUFACTURED, deliberately rather than waited for. A
// market's deadline is judged against BLOCK time, and this venue's Litecoin
// node produces blocks only on demand. So a market whose deadline has passed in
// wall-clock terms stays `open` on chain until a block lands. This spec opens a
// market with a short deadline, lets the deadline pass WITHOUT mining, and then
// asserts the wallet still says "Taking bets" - because the chain still does.
// A wallet that recomputed the status from `Date.now()` would say "Betting
// closed" here, and would be lying about a market that is genuinely still
// taking bets.
//
// WHAT IT FOUND ON ITS FIRST RUN, which is why the last step reads the way it
// does: **D-117**, the hub read the chain once and never again. The market
// closed on chain and the list kept it under "Taking bets" indefinitely, and
// re-selecting "Betting" from the palette did not help because the route was
// already mounted. The trace of that run settled it - six list requests, all
// inside the first thirty seconds. The fix gives BetFeedsList a 30s refresh;
// the last step asserts it by touching NOTHING and requiring the row to leave
// the list on its own.
//
// THE VENUE CAN INVALIDATE THAT WINDOW, and the spec says so rather than
// blaming the wallet: the chain is shared, and another session mining Litecoin
// during the hold window latches the market closed. That case is detected off
// the explorer and reported as venue interference
// ([[concurrent-sessions-race-same-e2e-venue]]).
//
// Runs on Litecoin for the reasons the deadline race records: Bitcoin regtest
// is the busy chain, and this spec needs several minutes of nobody mining.
// XC_REGTEST_COIN=RLTC.
//
// PRE-FLIGHT: creating a market is fee-bearing off Bitcoin, so the
// venue's LTC/USD snapshot must be seeded low enough for the quoted fee to
// clear the 5,460-sat dust floor (campaign §3.2 / §3.5). Seed $30 and mine.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    mintXchain,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const MINT_XCHAIN = 1000;

/**
 * Deadline lead for the market this spec opens.
 *
 * Short, because the spec waits it out in real time; long enough that the
 * create broadcasts and indexes while the market is genuinely open. The picker
 * has MINUTE granularity and truncates, so the effective lead is between
 * DEADLINE_LEAD_SEC - 59 and DEADLINE_LEAD_SEC.
 */
const DEADLINE_LEAD_SEC = 240;

/** Unique per run: the venue's Litecoin chain carries markets from every prior session. */
const RUN_TAG = `browse-${Date.now()}`;

/**
 * The wallet's plain-language pill text per stored status.
 *
 * Copied from BetFeedsList's `statusLabel` ON PURPOSE rather than imported: a
 * spec that imports the mapping it is checking passes when the mapping changes,
 * which is the one thing it exists to notice.
 */
const PILL_TEXT = {
    open: 'Taking bets',
    closed: 'Betting closed',
    resolved: 'Settled',
    resolved_void: 'Void, refunded',
    cancelled: 'Cancelled, refunded',
    expired: 'Expired, refunded',
};

async function explorerJson(path, coin = REGTEST_COIN) {
    const res = await fetch(`${EXPLORER_URL}/${coin}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/** Block time at the newest PARSED block: the clock every BET rule is judged against. */
async function chainTime() {
    const status = await explorerJson('status');
    const tip = Number(status?.chain_tip?.[REGTEST_COIN]);
    if (!Number.isFinite(tip)) throw new Error(`explorer reports no ${REGTEST_COIN} tip`);
    for (let h = tip; h > tip - 10 && h > 0; h--) {
        const block = await explorerJson(`block/${h}`);
        const ts = Number(block?.timestamp);
        if (Number.isFinite(ts) && ts > 0) return ts;
    }
    throw new Error(`no parsed block with a timestamp within 10 blocks of tip ${tip}`);
}

async function tipHeight() {
    const status = await explorerJson('status');
    return Number(status?.chain_tip?.[REGTEST_COIN]);
}

/** A unix time as the string a (browser-local) datetime-local input expects. */
function toLocalDateTimeInput(unixSec) {
    const d = new Date(unixSec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Mines one block, but only while the decode/index pipeline is keeping up. */
async function nudgeChain() {
    try {
        const status = await explorerJson('status');
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient: global setup reports real outages */ }
}

/**
 * One market as the chain stores it, or null when that chain has no such
 * market.
 *
 * The null case is load-bearing rather than defensive: a missing feed answers
 * `{error, code: 'NOT_FOUND'}` with HTTP 200-shaped JSON, which is TRUTHY, so
 * "the row on screen resolves on chain" would pass for a row that does not
 * exist - the exact check the demo-fallback sweep depends on.
 */
async function feedRow(feedIndex, coin = REGTEST_COIN) {
    const body = await explorerJson(`bet_feed/${feedIndex}`, coin);
    const row = Array.isArray(body) ? body[0]
        : (Array.isArray(body?.data) ? body.data[0] : body);
    if (!row || row.error || !row.action_index) return null;
    return row;
}

async function waitForToken(address, tick, min, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const body = await explorerJson(`balances/${address}`);
            const row = (body?.data || []).find((b) => b.tick === tick);
            last = row ? Number(row.amount) : 0;
            if (last >= min) return last;
        } catch { /* transient */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
}

/** Runs a palette command by clicking its row (see the deadline-race spec). */
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
 * Opens the betting hub on the VENUE chain.
 *
 * The hub carries its own chain picker, independent of every other form's
 * (campaign §3.5): miss it and a Litecoin market is simply absent from the
 * list, which reads as the market having vanished.
 */
async function gotoBettingHub(page) {
    await gotoPalette(page, 'Betting');
    await expect(page.getByRole('button', { name: 'Create market', exact: true }))
        .toBeVisible({ timeout: 30_000 });
    await selectVenueChain(page.getByRole('main'));
}

/** Every market card currently rendered, as {index, text}. */
async function renderedCards(page) {
    const cards = page.getByRole('main').getByRole('button', { name: /^#\d+\s/ });
    const out = [];
    for (const card of await cards.all()) {
        const text = (await card.innerText()) || '';
        const index = (text.match(/#(\d+)/) || [])[1];
        if (index) out.push({ index, text });
    }
    return out;
}

async function fillPasswordIfPresent(scope) {
    const field = scope.getByLabel('Password', { exact: true });
    if (await field.count() > 0 && await field.isVisible()) await field.fill(PASSWORD);
}

test.describe('BET browse', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('the list shows the status the chain stored, and filters on it', async ({ page }) => {
        let oracle;
        let feedIndex;
        let heightAtCreate;

        await test.step('onboard, fund, and hold XCHAIN', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Browse Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            const main = page.getByRole('main');
            await selectVenueChain(main);
            oracle = await main.getByLabel('Your oracle address').inputValue();
            expect(oracle, `this wallet has no ${REGTEST_COIN} address`).toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(oracle, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(oracle, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('open a market with a short deadline', async () => {
            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            const main = page.getByRole('main');
            await selectVenueChain(main);

            const tokenField = main.getByRole('button', { name: /^Token bets are placed in:/ });
            await expect(tokenField).toBeVisible({ timeout: 30_000 });
            await tokenField.click();
            await page.locator('[data-balance-key$=":XCHAIN"]').first().click();

            await main.getByLabel('What is being bet on').fill(`Browse pills ${RUN_TAG}`);
            await main.getByLabel('Outcome 0').fill('Yes');
            await main.getByLabel('Outcome 1').fill('No');
            await main.getByLabel('Betting closes')
                .fill(toLocalDateTimeInput((await chainTime()) + DEADLINE_LEAD_SEC));
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review market', exact: true }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
            await page.getByTestId('confirm-approve').click();

            const until = Date.now() + 180_000;
            let feed = null;
            while (Date.now() < until && !feed) {
                const list = await explorerJson(`bet_feeds/${oracle}/source`);
                feed = (list?.data || []).find((f) => String(f.label).includes(RUN_TAG)) || null;
                if (!feed) { await nudgeChain(); await new Promise((r) => setTimeout(r, 2_000)); }
            }
            expect(feed, `no market labelled ${RUN_TAG} landed for ${oracle}`).toBeTruthy();
            expect(feed.feed_status).toBe('open');
            feedIndex = String(feed.action_index);
            heightAtCreate = await tipHeight();
        });

        await test.step('the default list is the open ones, and every pill matches the chain', async () => {
            await gotoBettingHub(page);

            const mine = page.getByRole('main').getByRole('button', { name: new RegExp(`^#${feedIndex}\\s`) });
            await expect(mine, `the market this run created is missing from the browse list`)
                .toBeVisible({ timeout: 30_000 });
            await expect(mine).toContainText(PILL_TEXT.open);

            // The whole visible page cross-checked against the indexer, one row
            // at a time. This is also the demo-fallback sweep (D-11 / D-12):
            // every prior list route in this wallet has shipped a demo row at
            // some point, and a demo row has no feed on chain to resolve.
            const cards = await renderedCards(page);
            expect(cards.length, 'the browse list rendered no markets at all').toBeGreaterThan(0);
            for (const card of cards) {
                const stored = await feedRow(card.index);
                expect(stored, `market #${card.index} is on screen but not on chain (demo row?)`).toBeTruthy();
                expect(String(stored.feed_status),
                    `#${card.index} is listed under "Taking bets" but the chain stores `
                    + `${stored.feed_status}`).toBe('open');
                expect(card.text,
                    `#${card.index}: the pill does not match the stored status ${stored.feed_status}`)
                    .toContain(PILL_TEXT[String(stored.feed_status)]);
            }
        });

        await test.step('the deadline passes with no block, and the wallet still says taking bets', async () => {
            // The wallet must follow the CHAIN, not the clock. Nothing here
            // mines: the point is that the market is past its deadline in
            // wall-clock terms and still `open` on chain.
            const stored = await feedRow(feedIndex);
            const deadline = Number(stored.deadline);
            const waitMs = Math.max(0, (deadline - Math.floor(Date.now() / 1000)) + 15) * 1000;
            await new Promise((r) => setTimeout(r, waitMs));
            expect(Math.floor(Date.now() / 1000),
                'the deadline has not actually passed in wall-clock terms').toBeGreaterThan(deadline);

            const heightNow = await tipHeight();
            const after = await feedRow(feedIndex);
            expect(String(after.feed_status),
                heightNow > heightAtCreate
                    ? `VENUE INTERFERENCE, not a wallet defect: ${REGTEST_COIN} advanced from `
                      + `${heightAtCreate} to ${heightNow} during the hold window, which latched the `
                      + `market closed before the wallet could be asked about it. Re-run when the `
                      + `chain is quiet.`
                    : 'the chain closed the market with no new block')
                .toBe('open');

            // RELOADED, not re-navigated. Selecting "Betting" from the palette
            // while the hub is already on screen changes no state, so the route
            // does not remount and nothing re-reads - which is how the first
            // version of this spec "proved" the pill on a list fetched minutes
            // earlier (and how D-117 was found). A reload is the only way to be
            // certain the status on screen came from a fresh read of the chain.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await gotoBettingHub(page);
            const mine = page.getByRole('main').getByRole('button', { name: new RegExp(`^#${feedIndex}\\s`) });
            await expect(mine,
                'a market past its deadline but still open on chain vanished from the open list: '
                + 'the wallet is recomputing status from the clock')
                .toBeVisible({ timeout: 30_000 });
            await expect(mine,
                'the wallet recomputed the status from the clock instead of showing what the chain stored')
                .toContainText(PILL_TEXT.open);
        });

        await test.step('a block lands, and the filter follows the chain', async () => {
            const until = Date.now() + 240_000;
            let stored = null;
            while (Date.now() < until) {
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 2_000));
                stored = await feedRow(feedIndex);
                if (String(stored?.feed_status) === 'closed') break;
            }
            expect(String(stored?.feed_status),
                'a block past the deadline did not latch the market closed').toBe('closed');

            // D-117, live: NOTHING is touched here. No reload, no navigation,
            // no filter change - the market closed on chain while the hub sat
            // on screen, and the list has to notice by itself. Before the fix
            // this never happened at all (a trace of the failing run showed six
            // list requests, all in the first thirty seconds), so the row stayed
            // under "Taking bets" indefinitely. Two refresh cycles of headroom.
            await expect(page.getByRole('main').getByRole('button', { name: new RegExp(`^#${feedIndex}\\s`) }),
                'the hub never re-read the chain: a market that closed while the list was on '
                + 'screen is still listed under "Taking bets" (D-117)')
                .toBeHidden({ timeout: 75_000 });

            await page.getByRole('button', { name: 'All markets', exact: true }).click();
            const mine = page.getByRole('main').getByRole('button', { name: new RegExp(`^#${feedIndex}\\s`) });
            await expect(mine, '"All markets" does not list the market that just closed')
                .toBeVisible({ timeout: 30_000 });
            await expect(mine).toContainText(PILL_TEXT.closed);

            // The terminal states only exist on a chain with history, which is
            // why this is asserted here rather than manufactured: the venue
            // carries resolved / cancelled / expired markets from earlier
            // sessions, and each must read as what the chain stored.
            const cards = await renderedCards(page);
            let terminal = 0;
            for (const card of cards) {
                const row = await feedRow(card.index);
                expect(row, `market #${card.index} is on screen but not on chain (demo row?)`).toBeTruthy();
                const want = PILL_TEXT[String(row.feed_status)];
                if (!want) continue;   // a status this wallet renders through its generic fallback
                expect(card.text,
                    `#${card.index}: the pill does not match the stored status ${row.feed_status}`)
                    .toContain(want);
                if (String(row.feed_status) !== 'open') terminal += 1;
            }
            expect(terminal,
                '"All markets" showed nothing but open markets, so the non-open pills went unchecked')
                .toBeGreaterThan(0);
        });

        await test.step('the chain filter really scopes the list', async () => {
            // The hub is chain-scoped: switching it must swap the whole list,
            // not filter the current one. A market index from this chain
            // appearing under another chain would mean the list is keyed on
            // nothing.
            const main = page.getByRole('main');
            const picker = main.getByRole('button', { name: /^Network:/ }).first();
            await picker.click();
            await main.getByRole('option', { name: /^Bitcoin\b/ }).first().click();
            await expect(picker).toHaveAttribute('aria-label', /Bitcoin/, { timeout: 15_000 });

            // Matched on the LABEL, not the index: action indexes are per
            // chain, so Bitcoin having a market #<same number> is ordinary and
            // would make an index-based assertion fail for the wrong reason.
            await expect(main.getByRole('button', { name: new RegExp(RUN_TAG) }),
                `Bitcoin's list still shows this run's ${REGTEST_COIN} market`)
                .toBeHidden({ timeout: 30_000 });

            const cards = await renderedCards(page);
            for (const card of cards) {
                const onBitcoin = await feedRow(card.index, 'RBTC');
                expect(onBitcoin,
                    `#${card.index} is listed under Bitcoin but Bitcoin's chain has no such market`)
                    .toBeTruthy();
            }
        });
    });
});
