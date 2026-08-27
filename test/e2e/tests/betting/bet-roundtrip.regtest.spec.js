// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// P8 verify line: create -> bet -> resolve, driven entirely through the
// wallet UI against the live regtest stack.
//
// P8's routes each have unit and smoke coverage, and the SDK/indexer sides have
// their own e2e family in xchain-e2e-test. What none of them touch is the seam
// this spec exists for: the wallet composing a BET host-side, signing it, and
// the chain accepting it. A market authored in the browser has to survive the
// SDK builder, the host-side compose allow-list, the tamper check, a real
// signature and the indexer's parse rules, and the pieces are mocked apart in
// every other suite.
//
// THREE VENUE FACTS ARE BAKED IN, each of which cost real debugging time:
//
// 1. DEADLINES COME FROM THE CHAIN CLOCK, NOT THE BROWSER'S. The form's
//    datetime-local picker is browser-local by construction, but DEADLINE is
//    validated against BLOCK_TIME. On this stack the drills leave regtest hours
//    AHEAD of wall clock (they jump mocktime forward and never rewind, because
//    rewinding wedges block production), so a deadline picked "an hour from now"
//    is already in the chain's past and the create is rejected with
//    `invalid: DEADLINE (past)`. Every time here is computed from the chain tip.
//
// 2. THE ORACLE CANNOT BET ITS OWN MARKET (spec §6 format 2), so a round trip
//    needs two addresses. The wallet generates the second one, which is the
//    honest version of this test anyway: it exercises the address switcher that
//    a real bettor uses.
//
// 3. ASSERTIONS READ THE EXPLORER, NOT THE SCREEN. "Bet placed" is the wallet
//    reporting on itself. The pools, the stored latch and the settled balances
//    are the chain reporting on the wallet, and a signed-but-wrong action
//    (wrong outcome index, wrong tick, wrong stake) passes the first and fails
//    the second.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    mintXchain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
const MINT_XCHAIN = 1000;

/**
 * Stake and oracle fee, chosen against the WAGER TICK'S DECIMALS.
 *
 * XCHAIN on this stack has 0 decimals, and §7 floors every payout at the tick's
 * precision, so the numbers are not arbitrary: at a 20 stake a 1% fee floors to
 * zero and the "oracle took its cut" leg would assert nothing while still
 * passing. At 200 the arithmetic is exact and checkable by hand:
 *   fee    = floor(200 * 1 / 100) = 2
 *   pot    = 198
 *   payout = floor(200 * 198 / 200) = 198   (the only bet backed the winner)
 * That is the §7 rake case: the sole winner nets less than they staked, which
 * is correct parimutuel behaviour and exactly what the wallet warns about.
 */
const STAKE = '200';
const FEE_PCT = '1';
const EXPECTED_FEE = 2;
const EXPECTED_PAYOUT = 198;

/** Unique per run so the market is findable by label in a shared chain's list. */
const RUN_TAG = `e2e-${Date.now()}`;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * Block time at the newest PARSED block: the clock every BET rule is judged
 * against.
 *
 * Walks back from the reported tip instead of reading it directly, because
 * `status.chain_tip` is the NODE's height and the indexer is routinely a block
 * or two behind it, in which case `block/{tip}` is simply absent. Reading only
 * the tip made this throw against a perfectly healthy stack. Walking back also
 * yields the conservative answer: a slightly OLDER block time can only make a
 * computed deadline further in the chain's future, never accidentally in its
 * past, which is the failure that matters here.
 */
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

/**
 * A unix time as the string a datetime-local input expects.
 *
 * The input is interpreted in the BROWSER's timezone, and the browser runs on
 * this machine, so formatting with local getters round-trips to the intended
 * instant. Formatting as UTC here would silently shift the deadline by the
 * timezone offset, which on a market whose whole life is minutes is the
 * difference between a valid create and a rejected one.
 */
function toLocalDateTimeInput(unixSec) {
    const d = new Date(unixSec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The wallet's confirm surface, shared by all four BET formats. */
async function approveConfirm(page) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('confirm-approve').click();
}

/** Fills a password field only when the form is asking for one. */
async function fillPasswordIfPresent(scope) {
    const field = scope.getByLabel('Password', { exact: true });
    if (await field.count() > 0 && await field.isVisible()) await field.fill(PASSWORD);
}

/**
 * Mines one block, but ONLY while the decode/index pipeline is keeping up.
 *
 * A poll loop that mines every pass looks harmless and is not: the decoder
 * processes blocks at its own pace, so mining every 1.5s outruns it, the thing
 * being waited for never indexes, and the loop responds by mining harder. One
 * run of this spec left the decoder 157 blocks behind the node and every
 * balance read empty, which presents as "the wallet's action vanished" and is
 * really the harness outrunning the venue. Mining is therefore gated on the
 * pipeline being in step, and blocks are only ever needed to advance state, not
 * to make an already-mined action visible.
 */
async function nudgeChain() {
    let lag = 0;
    try {
        const status = await explorerJson('status');
        lag = Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0);
    } catch { return; }
    if (lag > 3) return;
    await minerRpc('generate_blocks', { count: 1 });
}

async function waitForFeed(feedIndex, predicate, what, timeoutMs = 420_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            last = await explorerJson(`bet_feed/${feedIndex}`);
            if (predicate(last)) return last;
        } catch { /* transient while a block lands */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`feed ${feedIndex} never reached ${what}; last=${JSON.stringify(last)}`);
}

/**
 * Polls the explorer until `address` holds at least `min` of `tick`.
 *
 * Deliberately not the shared fixture's waitForTokenBalance: that one mines on
 * every pass, which is the decoder-outrunning pattern described above. Same
 * contract otherwise.
 */
async function waitForToken(address, tick, min, timeoutMs = 420_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            last = await tokenBalance(address, tick);
            if (last >= min) return last;
        } catch { /* transient */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
}

async function tokenBalance(address, tick) {
    const body = await explorerJson(`balances/${address}`);
    const row = (body?.data || []).find((b) => b.tick === tick);
    return row ? Number(row.amount) : 0;
}

/**
 * Navigates to a Betting view from wherever the wallet currently is.
 *
 * Through the command palette rather than the nav rail, because Betting is not
 * a nav destination: it lives inside the Token Actions catalogue, two clicks
 * deep behind More -> More actions. The palette is also the surface a returning
 * user reaches for, so driving it here keeps these entries covered.
 */
async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox').first();
    await expect(combobox).toBeVisible();
    await combobox.fill(title);
    await page.keyboard.press('Enter');
}

async function gotoBettingHub(page) {
    await gotoPalette(page, 'Betting');
    await expect(page.getByRole('button', { name: 'Create market', exact: true }))
        .toBeVisible({ timeout: 30_000 });
}

test.describe('BET round trip on regtest', () => {
    // The regtest config sets an expect timeout but leaves ACTION timeout
    // unbounded, so a click on a locator that never appears hangs until the whole
    // test times out and reports nothing useful. Bounding it here (spec-local, so
    // no other suite's behaviour changes) makes a wrong selector fail in 30s
    // naming itself, which is the difference between one debugging cycle and a
    // 30-minute blind one.
    test.use({ actionTimeout: 30_000 });

    // Onboarding, two funded addresses, four signed actions and a clock jump,
    // each waiting on real blocks. The chain is the long pole throughout, and
    // this venue is shared: when another suite is also driving it the decode and
    // index pipeline runs minutes behind the node, so the per-step waits and this
    // budget are sized for a busy stack rather than an idle one.
    test.setTimeout(1_800_000);

    test.beforeAll(async () => {
        // Heal the shared node's clock BEFORE trusting it. This spec pins mocktime
        // to cross a deadline, and the afterAll below puts it back - but a killed
        // run (Ctrl-C, a lost preview server, a contended port) never reaches that
        // teardown, and the next suite then inherits a node whose clock sits under
        // median-time-past, where `generate_blocks` fails outright with "Error
        // generating to address" and every spec on the machine looks broken.
        // Pinning to tip+5 here is the same repair the ops recipe prescribes, and
        // it costs nothing when the clock is already fine.
        try {
            const tip = await chainTime();
            await minerRpc('set_mock_time', { timestamp: tip + 5 });
            await minerRpc('set_default_mining_time', {});
        } catch { /* the venue check in global setup reports unreachability */ }
    });

    test.afterAll(async () => {
        // Leave the shared node's clock where the next suite can mine: pinned
        // just above the tip rather than released to 0, which would put the
        // node clock BELOW median-time-past and wedge block production for
        // everyone (the regtest-miner wedge this stack has hit before).
        try {
            const tip = await chainTime();
            await minerRpc('set_mock_time', { timestamp: tip + 5 });
            await minerRpc('set_default_mining_time', {});
        } catch { /* best effort: never fail a run in teardown */ }
    });

    test('a market authored in the wallet takes a bet and pays it out', async ({ page }) => {
        let oracle;
        let punter;
        let feedIndex;
        let deadlineSec;

        await test.step('onboard onto regtest and fund the oracle address', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            // Read the oracle address OFF THE FORM rather than from the Receive
            // screen. They are not the same address: the create form prefers the
            // wallet's ACTIVE address, while Receive can hand back a rotated one.
            // Funding the Receive address instead produced a market created by an
            // address this spec had never funded, which only worked at all because
            // a previous run had left coins on it, and would fail on a clean chain.
            // Fund the address the form will actually sign with.
            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            oracle = await page.getByRole('main').getByLabel('Your oracle address').inputValue();
            // The VENUE's address shape, not Bitcoin's: a hardcoded `bcrt1`
            // alternative passes on Litecoin only because `[mn2]` also matches
            // there, and fails outright on a chain whose bech32 HRP differs.
            expect(oracle, 'the create form names an oracle address').toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(oracle, FUNDING_BTC);

            // Balances are fetched per chain on mount; a reload is the cheapest
            // way to make the freshly-confirmed UTXO visible to the forms.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // XCHAIN is both the gas token and the wager tick here. Betting is
            // token-only (§6 format 0 rejects the native coin), and XCHAIN is
            // freely mintable on regtest, so it saves issuing a throwaway token
            // whose supply rules are not what this spec is testing.
            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(oracle, 'XCHAIN', MINT_XCHAIN);

            // The chain having the balance is not the same as the WALLET having it:
            // balances are fetched per chain on mount, and the create form's token
            // picker only offers what this address is known to hold. Without the
            // remount the picker has BTC and nothing else, and the spec waits
            // forever for an XCHAIN row that will never render.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('create the market', async () => {
            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();

            const main = page.getByRole('main');
            // The address that will sign must still be the one that was funded: the
            // default is derived from wallet state, so assert it rather than trust it.
            expect(await main.getByLabel('Your oracle address').inputValue(),
                'the form still signs with the funded address').toBe(oracle);

            // The token field is a chip rather than an input, and its accessible
            // name is "<label>: <selection or placeholder>".
            const tokenField = main.getByRole('button', { name: /^Token bets are placed in:/ });
            await expect(tokenField).toBeVisible({ timeout: 30_000 });

            // It opens a picker rather than taking free text, so the wager tick can
            // only ever be one this address actually holds.
            await tokenField.click();
            // Balance rows declare role="listitem", not button, so they are addressed
            // by their stable data key rather than by role.
            await page.locator('[data-balance-key$=":XCHAIN"]').first().click();

            await main.getByLabel('What is being bet on').fill(`Round trip ${RUN_TAG}`);
            await main.getByLabel('Outcome 0').fill('Yes');
            await main.getByLabel('Outcome 1').fill('No');

            // Venue fact 1: from the CHAIN's clock. Far enough out that the bet
            // below lands while the market is still open, short enough that the
            // jump to close it does not need to be large.
            const now = await chainTime();
            deadlineSec = now + 1_800;
            await main.getByLabel('Betting closes').fill(toLocalDateTimeInput(deadlineSec));

            await main.getByLabel('Your fee (optional)').fill(FEE_PCT);
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review market', exact: true }).click();
            await approveConfirm(page);

            // The chain's answer, not the app's: the feed row exists, is owned by
            // this address, carries the terms that were typed, and is open.
            const deadline = Date.now() + 180_000;
            let feed = null;
            while (Date.now() < deadline && !feed) {
                const list = await explorerJson(`bet_feeds/${oracle}/source`);
                feed = (list?.data || []).find((f) => String(f.label).includes(RUN_TAG)) || null;
                if (!feed) {
                    await nudgeChain();
                    await new Promise((r) => setTimeout(r, 2_000));
                }
            }
            expect(feed, `no market with label containing ${RUN_TAG} landed for ${oracle}`).toBeTruthy();
            // Assert the SOURCE, because the label match alone would happily accept a
            // market some other address created: that is exactly how the
            // funded-the-wrong-address bug above hid itself for several runs.
            expect(feed.source, 'the market is owned by the funded oracle address').toBe(oracle);
            feedIndex = feed.action_index;

            expect(feed.tick, 'wager tick').toBe('XCHAIN');
            expect(feed.outcomes, 'outcome labels ride the wire in order').toBe('Yes,No');
            expect(Number(feed.fee), 'oracle percentage, not the protocol duration fee').toBe(1);
            expect(feed.feed_status).toBe('open');
            // The picker is browser-local and the protocol is chain-time: this is
            // the assertion that catches a timezone or clock-source mistake, which
            // otherwise shows up as an inscrutable rejected create.
            expect(Math.abs(Number(feed.deadline) - deadlineSec),
                'the stored deadline is the instant the picker was given').toBeLessThanOrEqual(60);
        });

        await test.step('generate a second address and fund it as the bettor', async () => {
            // Addresses is not on the nav rail (and this layout has no "More"
            // button either), so it is reached the same way a user reaches it.
            await gotoPalette(page, 'Addresses');
            await page.getByRole('button', { name: 'Add or import address' }).click();
            await page.getByRole('menuitem', { name: 'Add address' }).click();
            await page.getByRole('button', { name: /^Generate/ }).click();

            // Pick the row that is neither the oracle nor already active, open it,
            // and make it the active address: every action, the bet included,
            // composes from whichever address the wallet is currently on.
            const rows = page.getByRole('button', { name: /^View address / });
            await expect(rows.first()).toBeVisible();
            const generated = (await rows.all().then((all) =>
                Promise.all(all.map((r) => r.getAttribute('aria-label')))))
                .map((l) => String(l).replace('View address ', ''))
                .filter((a) => a && a !== oracle);
            expect(generated.length, 'a second address exists to bet from').toBeGreaterThan(0);

            await page.getByRole('button', { name: `View address ${generated[0]}` }).click();
            await page.getByRole('group', { name: 'Address actions' })
                .getByRole('button', { name: 'Use' }).click();

            // Read the bettor address back off a FORM rather than trusting the row
            // that was clicked. Forms resolve their source through the wallet's
            // active-address preference, and an earlier version of this spec scraped
            // an address out of the list that was not the one the bet composed from:
            // the assertions then measured a balance nobody had credited, while the
            // settlement itself was perfectly correct. Read the same value the bet
            // will use, from the same place the oracle address was read.
            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            const willSignAs = await page.getByRole('main').getByLabel('Your oracle address').inputValue();
            expect(willSignAs, 'the wallet now signs as some other address').not.toBe(oracle);
            punter = willSignAs;

            await fundAddress(punter, FUNDING_BTC);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(punter, 'XCHAIN', MINT_XCHAIN);
            // Same remount reason as the oracle above: the place-bet form reads the
            // stake against a balance the wallet has to have loaded.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('place a bet from the second address', async () => {
            await gotoBettingHub(page);
            await page.getByRole('button', { name: new RegExp(`#${feedIndex}\\b`) }).click();

            const main = page.getByRole('main');
            await expect(main.getByRole('heading', { name: 'Place a bet' })).toBeVisible({ timeout: 30_000 });

            await main.getByRole('button', { name: 'Yes', exact: true }).click();
            await main.getByLabel(/^Stake/).fill(STAKE);
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review bet', exact: true }).click();
            await approveConfirm(page);

            // The pool is the settlement predicate itself (§7 sums only
            // bet_status='open'), so asserting it is asserting the stake was
            // escrowed against the right outcome, not merely that a tx landed.
            const feed = await waitForFeed(
                feedIndex,
                (f) => (f?.pools || []).some((p) => Number(p.pool) > 0),
                'a funded pool');

            // Take the bettor's identity from the CHAIN rather than from which row
            // was clicked. Which of the wallet's addresses a form signs with is the
            // wallet's own business (both forms consult the same preference helper,
            // and it does not always land on the row a spec just activated), so
            // pinning it here would test wallet internals instead of betting. What
            // this spec must hold is the protocol rule and the money: the bet came
            // from an address that is NOT the feed's oracle, and the payout lands on
            // whichever address actually staked.
            const bets = await explorerJson(`bets/${feedIndex}/feed`);
            const placed = (bets?.data || [])[0];
            expect(placed, 'the bet is on the chain').toBeTruthy();
            expect(placed.source, 'an oracle may not bet its own market (§6 format 2)')
                .not.toBe(oracle);
            expect(Number(placed.outcome), 'staked on the outcome that was clicked').toBe(0);
            punter = placed.source;
            const pool = feed.pools.find((p) => Number(p.outcome) === 0);
            expect(pool, 'the stake landed on outcome 0, the one that was clicked').toBeTruthy();
            expect(Number(pool.pool)).toBeCloseTo(Number(STAKE), 8);
            expect(Number(pool.bet_count)).toBe(1);
        });

        await test.step('cross the deadline and let the chain latch the market closed', async () => {
            // The latch is written by the end-of-block pass, so it needs blocks
            // stamped past DEADLINE, not merely a clock that has moved.
            await minerRpc('set_mining_time', { max_time: 3_600_000, tx_added_time: 3_600_000 });
            await minerRpc('set_mock_time', { timestamp: deadlineSec + 120 });
            await minerRpc('generate_blocks', { count: 2 });

            const feed = await waitForFeed(feedIndex, (f) => f?.feed_status === 'closed', 'closed');
            expect(Number(feed.closed_block), 'the latch stamped its block').toBeGreaterThan(0);
        });

        await test.step('resolve from the oracle console and pay the winner', async () => {
            // Back to the oracle address: only the feed's source may resolve.
            await gotoPalette(page, 'Addresses');
            await page.getByRole('button', { name: `View address ${oracle}` }).click();
            await page.getByRole('group', { name: 'Address actions' })
                .getByRole('button', { name: 'Use' }).click();

            await gotoPalette(page, 'My markets');

            const main = page.getByRole('main');
            await expect(main.getByText(new RegExp(`#${feedIndex}\\b`))).toBeVisible({ timeout: 30_000 });
            await main.getByRole('button', { name: 'Resolve', exact: true }).first().click();
            await main.getByRole('button', { name: 'Yes', exact: true }).click();
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review resolve', exact: true }).click();
            await approveConfirm(page);

            const feed = await waitForFeed(feedIndex, (f) => f?.feed_status === 'resolved', 'resolved');
            expect(feed.feed_status).toBe('resolved');

            // Assert settlement from the RESOLVE ACTION'S OWN CREDITS, not from a
            // balance delta sampled around it. Two earlier versions of this leg
            // measured balances before and after, and both reported nonsense (0, then
            // -2) while the chain had settled perfectly: a balance read is a moving
            // target here, because it nets the escrow debit and the payout credit
            // depending on exactly which block the read lands between. The credit
            // rows are the ledger's own statement of who was paid what, and they
            // cannot drift with sampling time.
            const resolved = (feed.timeline || []).find((t) => t.status === 'resolved');
            expect(resolved?.action_index, 'the resolve is an action on the timeline').toBeTruthy();
            const action = await explorerJson(`action/${resolved.action_index}`);
            const credits = (action.credits || []).filter((c) => c.tick === 'XCHAIN');

            const toWinner = credits.find((c) => c.address === punter);
            const toOracle = credits.find((c) => c.address === oracle);
            expect(toWinner, `no payout credit for the bettor ${punter}`).toBeTruthy();
            expect(Number(toWinner.amount), 'winner takes the pot less the rake').toBe(EXPECTED_PAYOUT);
            expect(toOracle, `no fee credit for the oracle ${oracle}`).toBeTruthy();
            expect(Number(toOracle.amount), 'oracle takes its percentage (plus zero dust here)').toBe(EXPECTED_FEE);

            // Conservation, and the §7 one-credit-per-bet rule: a single bet plus the
            // oracle credit is exactly two rows, summing to everything escrowed.
            expect(credits.length, 'one credit per bet, plus one for the oracle').toBe(2);
            expect(credits.reduce((n, c) => n + Number(c.amount), 0),
                'everything escrowed left again').toBe(Number(STAKE));

            // Pools are summed over open bets only, so a settled market shows none:
            // every row it summed left `open` in the same action.
            const settled = await explorerJson(`bet_feed/${feedIndex}`);
            const settledFeed = Array.isArray(settled) ? settled[0] : settled;
            expect((settledFeed.pools || []).length, 'no bet is still open after settlement').toBe(0);
        });
    });
});
