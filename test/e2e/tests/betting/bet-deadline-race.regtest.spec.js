// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-112: the deadline race, and the receipt the wallet owes when the
// user overrides it.
//
// THE RACE. A market is `open` when a bet is composed and `closed` by the time
// it is approved, because the deadline passed while the confirm screen sat
// there. No compose-time check can catch this: the transaction was legal when
// it was built. What catches it is `useConfirmAction`'s §4.6 staleness
// re-check, which re-runs pre-flight when the report is older than
// STALENESS_MS and INTERRUPTS rather than signs when the verdict degrades.
//
// WHAT THIS SPEC IS FOR. That defence works and was proven by hand (campaign
// session 25). The bug was on the other side of it: overriding the refusal with
// "Sign anyway" broadcast a real transaction that the chain rejected, for a real
// miner fee and a real non-refundable protocol fee, and the wallet reported
// NOTHING - no receipt, no txid, no error. The receipt lived inside a card
// gated on `feed_status === 'open'`, `placeBet` ends with a reload, the reload
// came back `closed`, and the card unmounted with the outcome inside it. So "the
// wallet refused" and "the wallet spent your money and failed" were
// pixel-identical, with no txid to look the attempt up by.
//
// The fix moved the receipt to the top level. This spec is the live half of its
// proof and the guard that keeps it: a rendering fix is exactly the kind that a
// later layout change silently undoes, and the only way to see it is to drive a
// bet the chain will reject and check that the wallet still says so.
//
// WHY IT RUNS ON LITECOIN. Two venue facts, both measured rather than assumed:
//   1. A deadline is judged against BLOCK_TIME, so the race needs a chain whose
//      clock actually reaches the deadline. Bitcoin regtest here has spent whole
//      sessions frozen hours behind wall time, where no deadline a wallet would
//      accept can ever arrive.
//   2. Bitcoin regtest is the BUSY chain - the e2e suites, the drills and
//      whatever another session is mid-sweep on all land there. This spec owns a
//      market's state for several minutes, which is not something to do on a
//      chain somebody else is broadcasting into.
// Litecoin's clock tracks wall time and the chain is quiet, so the race is
// driven by waiting for a real deadline to pass rather than by moving the
// node's clock: a mocktime jump is a shared-venue side effect this does not
// need. Run it with XC_REGTEST_COIN=RLTC (see fixtures/regtest.js).
//
// PRE-FLIGHT, and it is not optional: a place-bet off Bitcoin pays its protocol
// fee in the native coin, so LTC/USD must be seeded low enough that the
// quoted fee clears the chain's 5,460-sat dust floor ((b)). At the venue's
// real ~$47 price the fee quotes ~4,200 sats and every place-bet is refused
// before it can race anything. Seed at $30 and mine, per campaign §3.2.

// TIER 1, AND WHY EVERY VERDICT BELOW IS WARMED FIRST. Both pre-flight
// assertions here are Tier-1-only: `data-dryrun="approved"` at compose and
// "feed not open" at the Approve-time re-check are the INDEXER's words
// (`xchain-indexer/src/actions/bet.js`), reachable no other way. A cold dry-run
// on this shared venue has been measured between 1.2s and 5.0s and the SDK
// abandons Tier 1 at 4000ms, so an unwarmed assertion is a coin flip on venue
// load rather than a test of the wallet. `warmPreflight` is the fix
// and `warmBet` below is this spec's use of it.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    EXPLORER_URL,
    fundAddress,
    minerRpc,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    warmPreflight,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const MINT_XCHAIN = 1000;
const STAKE = '100';

/**
 * The outcome this run bets on, as the market's LABEL and as its zero-based
 * wire index, declared together.
 *
 * They have to agree: the label is what the form is clicked by, the index is
 * what the wire params carry, and a warm built on the wrong index would warm a
 * different memo entry - which restores the exact race this spec warms to
 * remove, silently and while still looking warmed.
 */
const OUTCOME = { label: 'Yes', index: 0 };
/** The market's other outcome. Named only so the create form can be filled. */
const OUTCOME_OTHER = 'No';

/**
 * How far ahead of the chain's clock the market's deadline is set.
 *
 * Long enough that the bet below is composed while the market is genuinely
 * open, short enough that the spec waits it out in real time rather than moving
 * the node's clock. The picker has MINUTE granularity and truncates, so the
 * effective lead is between DEADLINE_LEAD_SEC - 59 and DEADLINE_LEAD_SEC.
 *
 * Sized against what has to happen INSIDE it, which is more than it looks: the
 * create has to broadcast and index, the active address has to move back to the
 * bettor, and the bet has to compose through the encoder and the pre-flight
 * endpoint. On a venue whose indexer is a minute behind, four minutes was not
 * enough and the market closed before the bet existed.
 */
const DEADLINE_LEAD_SEC = 420;

/** Unique per run so the market is findable by label in a shared chain's list. */
const RUN_TAG = `race-${Date.now()}`;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * Block time at the newest PARSED block: the clock every BET rule is judged
 * against. Walks back from the reported tip, which is the NODE's height and can
 * be a block or two ahead of what the indexer has parsed.
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
    } catch { /* transient: the venue check in global setup reports real outages */ }
}

async function waitForFeed(feedIndex, predicate, what, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            last = await explorerJson(`bet_feed/${feedIndex}`);
            const feed = Array.isArray(last) ? last[0] : last;
            if (predicate(feed)) return feed;
        } catch { /* transient while a block lands */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`feed ${feedIndex} never reached ${what}; last=${JSON.stringify(last)}`);
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

/**
 * Runs a command from the palette by CLICKING its row, not by pressing Enter.
 *
 * Enter runs whatever is at `activeIndex` at the moment the key lands, and the
 * results are re-scored and re-sorted asynchronously as the query is typed. Type
 * then immediately Enter, and on a loaded machine the highlight is still on the
 * previous render's first row: the palette closes, some other command runs, and
 * the failure surfaces one step later as "the screen I asked for is not here"
 * (observed once as a run that pressed Enter for Betting and stayed on Home).
 * Waiting for the row and clicking it removes the race entirely.
 */
async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox').first();
    await expect(combobox).toBeVisible();
    await combobox.fill(title);

    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible({ timeout: 15_000 });
    await row.click();
    // The palette is modal; if it is still up, the click did not run a command.
    await expect(page.getByRole('dialog', { name: 'Command palette' }))
        .toBeHidden({ timeout: 15_000 });
}

async function gotoBettingHub(page) {
    await gotoPalette(page, 'Betting');
    await expect(page.getByRole('button', { name: 'Create market', exact: true }))
        .toBeVisible({ timeout: 30_000 });
    // The hub carries a Network picker of its OWN, separate from the one on the
    // create form, and it defaults to Bitcoin. Left alone it lists Bitcoin's
    // markets, so a Litecoin market simply is not there - which presents as the
    // market the spec just created on chain having vanished.
    await selectVenueChain(page.getByRole('main'));
}

/**
 * Makes `address` the wallet's active one, which is what every form composes
 * from. Both roles in this spec exist in one wallet, so the run switches between
 * them rather than juggling two vaults.
 */
async function useAddress(page, address) {
    await gotoPalette(page, 'Addresses');
    await page.getByRole('button', { name: `View address ${address}` }).click();
    await page.getByRole('group', { name: 'Address actions' })
        .getByRole('button', { name: 'Use' }).click();
}

async function fillPasswordIfPresent(scope) {
    const field = scope.getByLabel('Password', { exact: true });
    if (await field.count() > 0 && await field.isVisible()) await field.fill(PASSWORD);
}

/**
 * Warms the indexer's dry-run for the exact BET this spec is about to ask the
 * wallet to pre-flight, and asserts the venue's own verdict matches the premise
 * of the step that follows.
 *
 * The params are BET v2's wire form, `VERSION|FEED_ACTION_INDEX|OUTCOME|AMOUNT`
 * (`xchain-sdk/src/formats.js`), with the empty trailing MEMO trimmed exactly as
 * `FormatSelector.serialize` trims it. That has to match the wallet's string
 * character for character: the indexer memoizes per (action, params, source,
 * height, feeMode), so a params string that differs by so much as a trailing
 * pipe warms an entry nobody will ask for.
 *
 * `feeMode` is deliberately NOT sent, and that is the faithful choice on both
 * chains this can run on rather than an omission. The wallet forces the native
 * lane for a bet on Litecoin and leaves it off on Bitcoin (`useNativeFee`), and
 * those are each chain's own default, which is what the indexer resolves an
 * absent `feeMode` to. Both sides therefore land on the same resolved mode, and
 * the memo key is built from the RESOLVED mode.
 *
 * The `expected` check earns its place twice over: it says at the venue, in one
 * line, that the network holds the opinion the step is scripted around, so a
 * market the indexer has not closed yet fails here naming the feed instead of
 * ten lines later as missing text on a panel.
 *
 * @param {string} source     the address the wallet is betting from
 * @param {number} feedIndex  the market's action index
 * @param {boolean} expected  the verdict the following step depends on
 */
async function warmBet(source, feedIndex, expected) {
    const quote = await warmPreflight({
        action: 'BET',
        params: `2|${feedIndex}|${OUTCOME.index}|${STAKE}`,
        source,
    });
    expect(quote.valid, `the venue's own dry-run for a ${STAKE} bet on market #${feedIndex} `
        + `disagrees with this spec's premise: ${JSON.stringify(quote)}`).toBe(expected);
    return quote;
}

/** Approves a confirm that is expected to go through cleanly. */
async function approveConfirm(page) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('confirm-approve').click();
}

test.describe('BET deadline race', () => {
    test.use({ actionTimeout: 30_000 });

    // Onboarding, two funded addresses, three signed actions, and a deadline
    // waited out in real time rather than jumped, on a shared venue whose
    // indexer can run minutes behind.
    test.setTimeout(1_800_000);

    test('a bet approved after its market closed is refused, and overriding it still reports', async ({ page }) => {
        let oracle;
        let punter;
        let feedIndex;
        let deadlineSec;

        await test.step('onboard onto regtest and fund the oracle address', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            // Read the oracle address off the FORM, which prefers the wallet's
            // active address, rather than off Receive, which can hand back a
            // rotated one. Funding the wrong one produces a market created by an
            // address this spec never funded.
            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            await selectVenueChain(page.getByRole('main'));
            oracle = await page.getByRole('main').getByLabel('Your oracle address').inputValue();
            expect(oracle, `the create form names a ${REGTEST_COIN} address`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(oracle, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(oracle, 'XCHAIN', MINT_XCHAIN);

            // Balances are fetched per chain on mount, and the create form's
            // token picker only offers what the address is KNOWN to hold.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('generate a second address and fund it as the bettor', async () => {
            // BEFORE the market is created, deliberately. The market's deadline
            // has to be short enough to wait out and long enough to compose a bet
            // inside, and funding a second address costs minutes of real chain
            // time - so a market created before this step is already closed by the
            // time the bet is composed, and the run tests the ordinary rejected
            // bet rather than the race. Everything expensive happens first; the
            // market is opened seconds before the bet that races it.
            //
            // The oracle may not bet its own market (§6 format 2), so the race
            // needs a second address as much as a round trip does.
            await gotoPalette(page, 'Addresses');

            // Snapshot the list BEFORE generating, so the new address is
            // identified by DIFFERENCE rather than by shape. A prefix filter
            // cannot do this job: Bitcoin and Litecoin regtest share the legacy
            // m/n/2 version bytes, and Dogecoin has no bech32 form at all, so
            // "the one that looks like this chain's" is ambiguous on exactly the
            // venues this spec exists to run on.
            const listed = async () => {
                const rows = page.getByRole('button', { name: /^View address / });
                await expect(rows.first()).toBeVisible({ timeout: 30_000 });
                return (await Promise.all((await rows.all())
                    .map((r) => r.getAttribute('aria-label'))))
                    .map((l) => String(l).replace('View address ', ''))
                    .filter(Boolean);
            };
            const before = new Set(await listed());

            await page.getByRole('button', { name: 'Add or import address' }).click();
            await page.getByRole('menuitem', { name: 'Add address' }).click();

            // The modal derives on ITS OWN chain picker (labelled "Coin"), which
            // defaults to Bitcoin. Skipping this generates a perfectly good
            // Bitcoin address, makes it active on Bitcoin, and leaves Litecoin's
            // active address exactly where it was - the oracle. The run then
            // fails several steps later looking like a wallet bug, which is how
            // this was found.
            await selectVenueChain(page, 'Coin');
            await page.getByRole('button', { name: /^Generate/ }).click();

            const generated = (await listed()).filter((a) => !before.has(a));
            expect(generated.length, 'generating added exactly one address to the list').toBe(1);
            expect(generated[0], 'the generated address is not the oracle').not.toBe(oracle);

            await page.getByRole('button', { name: `View address ${generated[0]}` }).click();
            await page.getByRole('group', { name: 'Address actions' })
                .getByRole('button', { name: 'Use' }).click();

            // Read the bettor back off a form, the same way the oracle was read:
            // which address a form signs with is resolved through the wallet's
            // own preference, not through the row that was clicked.
            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            await selectVenueChain(page.getByRole('main'));
            punter = await page.getByRole('main').getByLabel('Your oracle address').inputValue();
            expect(punter, 'the wallet now signs as some other address').not.toBe(oracle);

            await fundAddress(punter, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(punter, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('open a market, as the oracle, whose deadline arrives in minutes', async () => {
            await useAddress(page, oracle);

            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();

            const main = page.getByRole('main');
            await selectVenueChain(main);
            expect(await main.getByLabel('Your oracle address').inputValue(),
                'the form signs with the funded oracle address').toBe(oracle);

            const tokenField = main.getByRole('button', { name: /^Token bets are placed in:/ });
            await expect(tokenField).toBeVisible({ timeout: 30_000 });
            await tokenField.click();
            await page.locator('[data-balance-key$=":XCHAIN"]').first().click();

            await main.getByLabel('What is being bet on').fill(`Deadline race ${RUN_TAG}`);
            await main.getByLabel('Outcome 0').fill(OUTCOME.label);
            await main.getByLabel('Outcome 1').fill(OUTCOME_OTHER);

            // From the CHAIN's clock, not the browser's.
            deadlineSec = (await chainTime()) + DEADLINE_LEAD_SEC;
            await main.getByLabel('Betting closes').fill(toLocalDateTimeInput(deadlineSec));

            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review market', exact: true }).click();
            await approveConfirm(page);

            const until = Date.now() + 180_000;
            let feed = null;
            while (Date.now() < until && !feed) {
                const list = await explorerJson(`bet_feeds/${oracle}/source`);
                feed = (list?.data || []).find((f) => String(f.label).includes(RUN_TAG)) || null;
                if (!feed) {
                    await nudgeChain();
                    await new Promise((r) => setTimeout(r, 2_000));
                }
            }
            expect(feed, `no market labelled ${RUN_TAG} landed for ${oracle}`).toBeTruthy();
            expect(feed.source, 'the market is owned by the funded oracle address').toBe(oracle);
            expect(feed.feed_status, 'the market is open when the bet is composed').toBe('open');
            feedIndex = feed.action_index;

            // Back to the bettor for the compose below.
            await useAddress(page, punter);
        });

        await test.step('compose a bet while the market is still open', async () => {
            // The market must STILL be open at compose, or this spec is testing
            // the ordinary rejected-bet path instead of the race.
            const stillOpen = await explorerJson(`bet_feed/${feedIndex}`);
            const feed = Array.isArray(stillOpen) ? stillOpen[0] : stillOpen;
            expect(feed.feed_status,
                'the deadline arrived before the bet could be composed; raise DEADLINE_LEAD_SEC')
                .toBe('open');

            await gotoBettingHub(page);
            await page.getByRole('button', { name: new RegExp(`#${feedIndex}\\b`) }).click();

            const main = page.getByRole('main');
            await expect(main.getByRole('heading', { name: 'Place a bet' })).toBeVisible({ timeout: 30_000 });
            await main.getByRole('button', { name: OUTCOME.label, exact: true }).click();
            await main.getByLabel(/^Stake/).fill(STAKE);
            await fillPasswordIfPresent(main);

            // Warmed in the same breath as the compose it is warming for: the
            // memo is keyed by block height, and this venue mines on a timer as
            // well as on demand, so anything slotted in between can put the
            // wallet's own call back on the cold path.
            await warmBet(punter, feedIndex, true);
            await main.getByRole('button', { name: 'Review bet', exact: true }).click();

            // The dry run must not be REFUSING here. A confirm that is already
            // failing would make the degradation below unobservable.
            //
            // NOT `pass`, and this file's own header says why without having
            // noticed it applied here: the assertions are meant to be
            // TIER-1-ONLY, and `data-verdict` is not a Tier-1 signal - it
            // aggregates Tier-2 findings too. Off Bitcoin the panel always
            // carries one, correctly: "This action charges a protocol fee. If
            // the chain rejects the action, any attached native-coin fee output
            // is forfeited", which exists because `isNativeFeeMandatory` makes
            // the coin the only fee lane on every chain but Bitcoin. So on
            // Litecoin the baseline verdict is `warn` with `data-dryrun`
            // "approved", and demanding `pass` fails a spec whose subject is
            // working perfectly.
            //
            // Measured in the first whole-suite Litecoin run, 2026-08-27:
            // `data-verdict="warn" data-dryrun="approved"`, with the panel
            // reading "The network checked this action and expects it to
            // succeed." This is the same class the chain-pinning row recorded
            // on `contracts/deploy-chunked-lane` - **a spec written on Bitcoin
            // encodes Bitcoin's ABSENCES as well as its values** - one severity
            // level up, and it is a spec bug rather than a wallet one.
            //
            // The transition this spec exists to catch is still a real one: the
            // degradation below asserts `fail`, which neither `pass` nor `warn`
            // is, and the Tier-1 check it actually depends on is the
            // `data-dryrun="approved"` assertion immediately after this.
            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('preflight-panel'),
                'the confirm is already refusing before the deadline, so the degradation this spec '
                + 'measures would not be a transition')
                .toHaveAttribute('data-verdict', /^(pass|warn)$/, { timeout: 60_000 });

            // And it must pass because the NETWORK said so. `pass` alone cannot
            // tell that apart from a dry-run that never answered: DRYRUN_UNAVAILABLE
            // is an info finding, so a Tier-2-only report is also a `pass`. This is
            // the machine-readable Tier-1 state, and asserting it here is
            // what makes the degradation below a real transition rather than the
            // first time the network was ever heard from.
            await expect(page.getByTestId('preflight-panel'))
                .toHaveAttribute('data-dryrun', 'approved');
            await expect(page.getByTestId('confirm-approve')).toBeEnabled();
        });

        await test.step('let the deadline pass under the open confirm screen', async () => {
            // Real time, not a mocktime jump: this venue's clock tracks wall
            // clock, and moving a shared node's clock is a side effect other
            // sessions inherit. The wait also carries the confirm report past
            // STALENESS_MS (30s), which is what arms the Approve-time re-check.
            const waitMs = Math.max(0, (deadlineSec + 15) * 1000 - Date.now());
            await page.waitForTimeout(waitMs);

            // The latch is written by the end-of-block pass, so the market closes
            // when a block STAMPED past the deadline lands, not when the clock
            // passes it.
            await minerRpc('generate_blocks', { count: 2 });
            const closed = await waitForFeed(feedIndex, (f) => f?.feed_status === 'closed', 'closed');
            expect(Number(closed.closed_block), 'the latch stamped its block').toBeGreaterThan(0);

            // The confirm screen is untouched by any of that: the wallet has no
            // idea yet, which is the whole point of the race.
            await expectConfirmModal(page, 'this action', 30_000);
        });

        await test.step('Approve is refused by the §4.6 re-check', async () => {
            // The re-check is where this spec's Tier-1 exposure actually bites:
            // the refusal it asserts is the indexer's own "feed not open", and
            // the re-check is a fresh dry-run at the height the closing block
            // just created, so it is COLD by construction. `bypassCache` on the
            // re-check bypasses the SDK's coalescer, not the indexer's memo, so
            // warming here is what the wallet's call lands on.
            //
            // The verdict is also the venue's confirmation that the latch really
            // took: `false` here means the indexer refuses the bet, which is the
            // only reason the panel below has anything to say.
            const quote = await warmBet(punter, feedIndex, false);
            expect(String(quote.status), 'the indexer refuses the bet for the reason this spec '
                + 'asserts on screen').toMatch(/feed not open/i);

            await page.getByTestId('confirm-approve').click();

            // The verdict degrades from the re-check, and the chain's own reason
            // rides through to the screen.
            await expect(page.getByTestId('preflight-panel'))
                .toHaveAttribute('data-verdict', 'fail', { timeout: 90_000 });
            await expect(page.getByTestId('preflight-chip')).toHaveText('Will likely fail');
            await expect(page.getByTestId('preflight-panel')).toContainText(/feed not open/i);

            // Not a Tier-2 fail wearing the same paint: an unreached dry-run
            // renders "Local checks only" and `data-dryrun="unreached"`, and this
            // whole step is about the NETWORK having changed its mind.
            await expect(page.getByTestId('preflight-panel'))
                .not.toHaveAttribute('data-dryrun', 'unreached');

            // Refusing means refusing: Approve is blocked behind an unchecked
            // override rather than merely warned about.
            await expect(page.getByTestId('confirm-approve')).toBeDisabled();
            const ack = page.locator('[data-testid^="ack-"]');
            await expect(ack.first()).toBeVisible();
            await expect(ack.first()).not.toBeChecked();
        });

        await test.step('overriding it sends the bet AND says so (D-112)', async () => {
            const ack = page.locator('[data-testid^="ack-"]').first();
            await ack.check();
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 30_000 });
            await page.getByTestId('confirm-approve').click();

            // THE ASSERTION THIS SPEC EXISTS FOR. The submit ends with a reload
            // that comes back `closed`, which unmounts the whole place-bet card;
            // before the fix the receipt lived inside it and the user was left on
            // a page that said nothing at all about a transaction they had just
            // paid two fees for.
            const result = page.getByTestId('bet-result');
            await expect(result, 'the wallet reports nothing after sending a bet (D-112)')
                .toBeVisible({ timeout: 120_000 });

            // Not merely visible: it must say the RIGHT thing. "Bet placed." on a
            // market that closed is the same silence in a different font.
            await expect(result).toContainText('betting closed while you were confirming');
            await expect(result).toContainText(/spent either way/i);

            // And it must carry the txid, which is the only handle the user has
            // on an attempt the market page will otherwise never mention again.
            //
            // Read the definition element, NOT the card's text. `textContent`
            // concatenates the <dt> and <dd> with no separator, the label is
            // "Txid", and **"Txid" ends in a hex digit** - so a /[0-9a-f]{64}/
            // over the whole card matches one character early and yields a txid
            // that is off by one at both ends. That cost this spec a full run,
            // reported as "the bet never reached the chain" while the receipt on
            // screen was perfectly correct.
            const txid = ((await result.getByRole('definition').first().textContent()) || '').trim();
            expect(txid, `no txid in the receipt: ${await result.textContent()}`)
                .toMatch(/^[0-9a-f]{64}$/i);

            // The chain's own verdict, which is what makes the receipt necessary:
            // the transaction is real, it cost real fees, and it indexes invalid.
            const until = Date.now() + 300_000;
            let row = null;
            while (Date.now() < until && !row) {
                const list = await explorerJson('actions?limit=100');
                row = (list?.data || []).find((r) => r.tx_hash === txid) || null;
                if (!row) {
                    await nudgeChain();
                    await new Promise((r) => setTimeout(r, 2_000));
                }
            }
            expect(row, `the bet named by the receipt never reached the chain: ${txid}`).toBeTruthy();
            const detail = await explorerJson(`action/${row.action_index}`);
            expect(String(detail.status), 'the chain rejects a bet on a closed market')
                .toMatch(/FEED_ACTION_INDEX|feed not open/i);

            // The stake was never escrowed: what the user lost is the two fees,
            // which is exactly what the receipt says.
            const bets = await explorerJson(`bets/${feedIndex}/feed`);
            const open = (bets?.data || []).filter((b) => String(b.bet_status) === 'open');
            expect(open.length, 'a rejected bet must not hold a stake').toBe(0);
            expect(punter, 'the bettor is not the oracle').not.toBe(oracle);
        });
    });
});
