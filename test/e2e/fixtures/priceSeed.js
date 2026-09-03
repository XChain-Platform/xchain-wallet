// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//The arithmetic and the wording behind `seedPrices()`, with no I/O in
// it, so the parts that are easy to get quietly wrong can be pinned by a unit
// test instead of by a 90-second run against a shared chain.
//
// WHY A FEE-BEARING SPEC NEEDS THIS AT ALL
//
// Every USD-priced action (place a bet, issue a token, open a dispenser) is
// valued against the indexer's `price_snapshots`, and a snapshot is only usable
// for `ORACLE_MAX_PRICE_AGE_SECONDS` (1800s) after the timestamp it carries.
// Nothing on this venue publishes those rows: they are written by
// `OracleConsensus`, i.e. a validator federation, and no regtest stack runs one.
// So until the wallet's regtest specs simply inherited whatever the last
// person to hand-seed had left behind, and three sessions were lost to that -
// one to a sentinel that had expired, one to re-seeding on a seven-minute timer
// for its whole length.
//
// THE DESIGN QUESTION THE LEDGER LEFT OPEN, ANSWERED IN THE SOURCE
//
// The ledger's candidate was the hub's `pushoracleprice` JSON-RPC, on the
// grounds that it needs no database credentials in this repo. It cannot work,
// and the tree already says so: `pushoracleprice` writes `oracle_prices` (a
// user-published PRICE v1 row, consumed by FIAT dispenser settlement), not
// `price_snapshots`. `xchain-e2e-test/test/helpers/priceSnapshotHelper.js` states
// the asymmetry outright - "oracle_prices has [a broadcasting write path],
// reachable over `pushoracleprice`. price_snapshots does not" - and
// `priceSeedRouting.test.js` pins it. `db.getLatestPrice`, the function whose
// null answer produces "no current oracle price", reads `price_snapshots` and
// nothing else. There is no credential-free HTTP write path to that table on
// this stack; the miner exposes none either.
//
// WHAT IS DONE INSTEAD, AND WHY IT STILL CARRIES NO CREDENTIALS
//
// The seed is DELEGATED, not performed: `ssh <venue host> docker exec
// <indexer container> node`, with the script piped in on stdin. The script runs
// inside the container, so `INDEXER_DB_*` resolves from the container's own
// environment. No credential is stored in this repo, held by the Playwright
// process, passed on a command line, or printed. That relationship is not new
// machinery either - the venue contract in `regtest.js` already requires an SSH
// session to the same host to open the tunnels.
//
// THE ANCHOR RULE (the part that is genuinely subtle)
//
// A snapshot stamped S is readable by a block at time B only inside
//     S <= B <= S + 1800
// The upper bound is the staleness guard. The LOWER bound is the H-3 selection
// gate: off Bitcoin, `getLatestPrice` selects with `block_timestamp <= ?`
// against the block's own time, so a row stamped in the chain's future is not
// "fresh for longer", it is invisible.
//
// Two clocks therefore have to be satisfied at once, and on this stack they
// disagree by hours (a concurrent session's `setmocktime` leaves BTC and DOGE
// frozen well behind wall clock):
// - the PRE-FLIGHT reads at the tip's block time (anchors the whole
//     price read on the quoted block's own time, so the older campaign note
//     that "/feequote measures staleness against wall clock" is no longer true
// at HEAD - it was measured before landed);
//   - the ON-CHAIN check reads at the time of the block that carries the
//     action, which on a chain whose clock tracks wall time is ~now.
// So seed BOTH: the lower round numbers at the tip's time, the highest at wall
// clock. Selection is `ORDER BY round_number DESC` and the guard runs after it,
// which makes the pairing load-bearing in one direction only. Off Bitcoin the
// wall row is excluded by the time gate at pre-flight and the tip row answers;
// once a block lands at wall time the wall row becomes visible and answers,
// still fresh. On Bitcoin there is no time gate, so the wall row answers both
// times and its negative age passes the guard. Reverse the pairing and the
// frozen regime selects a row it must then reject, which is the shadowing trap:
// ONE high round with a bad timestamp makes a pair look permanently dead no
// matter how many correct lower rounds sit behind it.
//
// This is the same rule as `priceSnapshotHelper.usableSeedAnchors()`, restated
// here rather than imported because that helper lives in a different repo and
// reaches its database directly.

/** The gas token's pair, needed by every priced action regardless of chain. */
export const XCHAIN_PAIR = 'XCHAIN/USD';

/**
 * XCHAIN/USD, at the value production actually publishes.
 *
 * A venue fixture, matched to the e2e tree's seeded value in
 * `xchainPriceConstants.BOOTSTRAP_XCHAIN_USD`, not to a production constant.
 *
 * It used to be both: the hub's bootstrap was itself `2.00000000` USD and this
 * seeded the same number. D2 was redecided on 2026-08-03 to denominate the
 * bootstrap in SATOSHIS (1000 sat), so the hub no longer holds any fixed USD
 * figure to match: its USD value is resolved per round by converting 1000 sat
 * with that round's consensus BTC/USD, and therefore moves with BTC.
 *
 * Kept at 2.00 deliberately rather than re-based. What matters for these runs is
 * that the seeded price and the asserted fee arithmetic agree with each other;
 * chasing a moving production figure would make the expectations non-deterministic
 * for no gain. The cross-repo pin that DOES still need to hold lives in
 * `xchainPriceSeedGuard`, which pins the hub's satoshi constant directly.
 */
export const XCHAIN_USD_PRICE = '2.00000000';

/**
 * The coin pair and price this fixture puts on each regtest chain.
 *
 * The prices are not arbitrary and are not interchangeable. Each one is a point
 * inside a BAND with a floor and a ceiling, and both ends are computed from the
 * suite's own numbers by `priceBand()` below rather than asserted in prose. The
 * band is what a reader needs, because the constant on its own invites exactly
 * the wrong repair: "an action priced under dust, therefore re-tune the seed".
 *
 *   BTC   100000  matches the platform's own native-fee fixtures. Bitcoin is
 *                 the only chain with an XCHAIN fee lane, so it never meets the
 *                 dust wall at all and its ceiling is not load-bearing.
 *   LTC       30  sits under a $36.63 ceiling set by the CHEAPEST fee the suite
 *                 drives (100 gas: a one-recipient AIRDROP or DIVIDEND, one bet
 *                 credit) against Litecoin's 5460-sat dust floor, and above an
 *                 $8 floor set by the DEAREST (ISSUE, 100000 gas) against
 *                 `fundAddress`'s one-coin default. At a "realistic" $100 the
 *                 cheap fee prices at 2000 sats and is refused outright.
 *   DOGE     0.1  a realistic price leaves ~20x of headroom, because a
 *                 USD-denominated fee buys more sats per cent on a cheap coin.
 */
export const VENUE_PRICE = Object.freeze({
    RBTC:  Object.freeze({ coinPair: 'BTC/USD',  price: '100000.00000000' }),
    RLTC:  Object.freeze({ coinPair: 'LTC/USD',  price: '30.00000000' }),
    RDOGE: Object.freeze({ coinPair: 'DOGE/USD', price: '0.10000000' }),
});

/**
 * XCHAIN per gas unit, mirrored from `GAS_PRICE` in the coin bundles
 * (`xchain-indexer/src/coins/{BTC,LTC,DOGE}.js`, all three identical).
 *
 * Restated rather than imported for the same reason the anchor rule above is:
 * the registry lives in another repo and this tree carries no dependency on it.
 * The unit suite is the pin - if a coin bundle ever moves this, the band checks
 * go red here in milliseconds instead of on a shared chain.
 */
export const GAS_PRICE_XCHAIN = '0.00001';

/**
 * Each venue chain's dust floor, from `dustThreshold` in the same coin bundles
 * and matching the copy `tests/send/dust-and-max.regtest.spec.js` already keeps.
 *
 * This is the number that makes a protocol fee UNPAYABLE rather than merely
 * cheap. Off Bitcoin the fee must be a native-coin output and there is no
 * XCHAIN-balance lane to fall back to, so a fee that prices below the floor
 * cannot be created and the action cannot be submitted at all.
 */
export const VENUE_DUST_SATS = Object.freeze({ RBTC: 546, RLTC: 5460, RDOGE: 100_000 });

/**
 * The venues where the dust floor is actually load-bearing.
 *
 * Bitcoin is deliberately absent. `detectFeePaymentMode` keeps an XCHAIN-balance
 * lane there and rejects a missing fee output only off Bitcoin, so a
 * below-dust quote on RBTC is paid from the balance instead of refused - which
 * is why the seeded $100000 prices the cheapest fee at 2 sats and nothing
 * breaks. Litecoin and Dogecoin have no such lane, and there the same 2 sats
 * would be an output that cannot be created.
 */
export const NATIVE_FEE_ONLY = Object.freeze(['RLTC', 'RDOGE']);

/**
 * The extremes of the gas schedule this suite actually drives, which are the
 * two ends the seeded price has to satisfy at once.
 *
 * `cheapest` is 100 gas and it is a floor of the schedule, not of one spec:
 * AIRDROP_PER_RECIPIENT, DIVIDEND_PER_RECIPIENT and BET_PER_CREDIT are all 100,
 * and every other key the suite reaches is larger (the next ones up are
 * EXPIRATION_PER_DAY / BET_FEED_PER_DAY at 550 and VM_EXECUTE_BASE at 1000).
 * `tests/tokens/airdrop.regtest.spec.js` drives the one-recipient case and
 * asserts the 100 directly, so this is measured, not assumed.
 *
 * `dearest` is ISSUE at 100000 gas, driven by the fee specs and the token specs
 * on an address `fundAddress` gives ONE coin.
 */
export const SUITE_GAS = Object.freeze({ cheapest: 100, dearest: 100_000 });

/**
 * The share of a one-coin funding an action's protocol fee may take before the
 * band is called closed.
 *
 * A quarter, so a spec can pay its fee, its miner fee, and still compose a
 * second action without re-funding. Nothing measures a hard failure at any
 * particular share; the value exists to make "ISSUE loses its headroom" an
 * arithmetic statement instead of a judgement call.
 */
export const MAX_FEE_SHARE_OF_FUNDING = 0.25;

/**
 * A protocol fee in the CHAIN's own satoshis, the way a native-fee chain has to
 * pay it: gas is XCHAIN-denominated, so the amount converts through BOTH seeded
 * prices and the coin price is the only one this fixture is free to move.
 *
 *   sats = gas * GAS_PRICE * XCHAIN_USD / COIN_USD * 1e8
 */
export function feeSats({ gas, coinUsd, xchainUsd = XCHAIN_USD_PRICE, gasPrice = GAS_PRICE_XCHAIN }) {
    const feeUsd = Number(gas) * Number(gasPrice) * Number(xchainUsd);
    return (feeUsd / Number(coinUsd)) * 1e8;
}

/**
 * The band a venue's seeded coin price has to sit inside, with both ends
 * derived rather than remembered.
 *
 * WHY THIS IS A FUNCTION AND NOT A COMMENT. A campaign session read one
 * under-dust refusal on Litecoin, concluded "the seed is too high, every
 * cheaper action falls under the floor", and the next session was sent to
 * re-tune this constant. Measured, the band says otherwise, and says it in a
 * form a test can check: the seeded $30 already clears the cheapest fee the
 * suite drives, and the actions that DO price under dust there (SWEEP and
 * CALLBACK, the only two still on the legacy flat per-DB-hit charge) have an
 * EMPTY band - no coin price satisfies both ends at once, so no reseed can fix
 * them and the repair is a protocol one. `emptyBand` states that outright.
 *
 * `ceilingUsd`  the highest coin price at which the CHEAPEST fee still buys an
 *               above-dust output. Above it the cheap action is unsubmittable.
 * `floorUsd`    the lowest coin price at which the DEAREST fee still fits
 *               inside `MAX_FEE_SHARE_OF_FUNDING` of a `fundingCoins` funding.
 *               Below it the expensive action eats the wallet.
 *
 * @param {{regtestCoin: string, cheapestGas?: number, dearestGas?: number,
 *          fundingCoins?: number, xchainUsd?: string}} args
 */
export function priceBand({
    regtestCoin,
    cheapestGas = SUITE_GAS.cheapest,
    dearestGas = SUITE_GAS.dearest,
    fundingCoins = 1,
    xchainUsd = XCHAIN_USD_PRICE,
} = {}) {
    const venue = VENUE_PRICE[regtestCoin];
    const dustSats = VENUE_DUST_SATS[regtestCoin];
    if (!venue || !dustSats) {
        throw new Error(`priceBand: ${regtestCoin} is not a regtest chain this fixture prices; `
            + `expected one of ${Object.keys(VENUE_PRICE).join(', ')}`);
    }
    const gasPrice = Number(GAS_PRICE_XCHAIN);
    const cheapestUsd = Number(cheapestGas) * gasPrice * Number(xchainUsd);
    const dearestUsd = Number(dearestGas) * gasPrice * Number(xchainUsd);

    const ceilingUsd = (cheapestUsd * 1e8) / dustSats;
    const floorUsd = dearestUsd / (fundingCoins * MAX_FEE_SHARE_OF_FUNDING);
    const seededUsd = Number(venue.price);

    return {
        coinPair: venue.coinPair,
        seededUsd,
        dustSats,
        ceilingUsd,
        floorUsd,
        emptyBand: ceilingUsd < floorUsd,
        cheapestFeeSats: feeSats({ gas: cheapestGas, coinUsd: seededUsd, xchainUsd }),
        dearestFeeSats: feeSats({ gas: dearestGas, coinUsd: seededUsd, xchainUsd }),
        // How much room the seed has before the cheap action goes under dust,
        // and how much before it went under the funding floor. Both are
        // multiples of the seeded price, so "1.0" means sitting on the edge.
        dustHeadroom: ceilingUsd / seededUsd,
        fundingHeadroom: seededUsd / floorUsd,
        // Read the other way round: how many coins a spec has to fund an
        // address with before the dearest fee is still under
        // MAX_FEE_SHARE_OF_FUNDING of it. `fundAddress` defaults to one coin,
        // so anything above 1 here is a venue whose specs must pass an amount.
        minFundingCoins: dearestUsd / (seededUsd * MAX_FEE_SHARE_OF_FUNDING),
    };
}

/**
 * The LEGACY per-DB-hit charge, restated in gas units so it can be fed to
 * `priceBand()` alongside every unified price.
 *
 * SWEEP and CALLBACK are the only two actions still on it: a flat 1000
 * satoshis of XCHAIN per database hit, with no base term and no floor. 1000
 * XCHAIN-satoshis is 0.00001 XCHAIN, which is exactly one gas unit at
 * `GAS_PRICE_XCHAIN`, so one DB hit converts to one gas unit and the two
 * schedules become directly comparable.
 *
 * Nine hits is what a real Litecoin SWEEP measured on this venue: 9 gas is
 * 0.00009 XCHAIN, $0.00018 at the seeded XCHAIN price, and 600 litoshi at the
 * seeded $30 - against a 5460-satoshi floor, which is the refusal.
 *
 * Kept here ONLY so the empty-band claim can be executed rather than argued. It
 * is not a price this fixture seeds against, and the repair for it is a
 * protocol one (a BASE term that puts a floor under the fee), not a reseed.
 */
export const LEGACY_DB_HIT_GAS = 1;
export const MEASURED_LEGACY_SWEEP_DB_HITS = 9;

/**
 * The round numbers this fixture writes: the platform's OWN native-fee
 * sentinels, deliberately not a new family of its own.
 *
 * Reusing them is the whole point. Selection takes the highest round number, so
 * a synthetic row outranks every derived round forever, and suppressing new
 * Seeds cannot retract rows an earlier run already wrote (found
 * shadowing BTC regtest at $2.00 while the hub had derived ~12.90). The e2e
 * tree keeps one list of every synthetic round in existence
 * (`xchainPriceConstants.SEED_SENTINEL_ROUNDS`) precisely so `clearSeedSentinels`
 * can undo them all. A private wallet-only family would be invisible to that
 * cleanup, so this writes rounds the cleanup already knows.
 *
 * Lower round = the tip-time anchor, higher = the wall-clock anchor, matching
 * `nativeFeeHelper`'s own `*_ROUND` / `*_ROUND_NOW` split.
 */
export const BASE_ROUNDS = Object.freeze({
    xchain: Object.freeze([888100001, 888100011]),
    coin:   Object.freeze([888100002, 888100012]),
});

/**
 * Every round number the XChain tree writes synthetically, mirrored from
 * `xchain-e2e-test/test/helpers/xchainPriceConstants.js` (SEED_SENTINEL_ROUNDS),
 * which is the source of truth.
 *
 * Used for ONE purpose: deciding which rows already on the venue this fixture
 * may move forward. A round in this set is provably a fixture's, so re-stamping
 * it is safe; a round outside it may be a real derived round and is never
 * touched. That matters because a stale synthetic round ABOVE the ones seeded
 * here would shadow them and leave the pair looking permanently dead - which is
 * exactly the state BTC regtest is in whenever a run leaves 999200011/999200012
 * behind.
 */
export const SYNTHETIC_ROUNDS = Object.freeze([
    990001, 990002,
    990011, 990012,
    888100001, 888100002,
    888100011, 888100012,
    999000001, 999000002,
    999000003, 999000004,
    999000005, 999000006,
    999000708,
    999200001, 999200002,
    999200011, 999200012,
    999300001, 999300002,
]);

const SYNTHETIC = new Set(SYNTHETIC_ROUNDS);

/** The indexer's `ORACLE_MAX_PRICE_AGE_SECONDS`. See the anchor rule above. */
export const ORACLE_MAX_PRICE_AGE_SECONDS = 1800;

/**
 * How much of that window a run insists on having LEFT before it accepts a
 * venue as already priced.
 *
 * Not a style preference, and the reason it is this large is a separate case. A quote
 * that answers at global setup is not the same claim as a quote that will still
 * answer at the approve step several minutes later, and off Bitcoin the gap
 * between those two claims is not bounded by wall clock: LTC and DOGE mine only
 * on demand, so an idle chain's clock sits hours behind, and the moment a spec
 * starts mining, chain time sprints toward wall time and burns the window far
 * faster than the run takes. A spec that composed a bet against a healthy quote
 * then failed at approve with "no current oracle price" is exactly that race.
 * 900s is half the window: comfortably longer than any single spec's fee-bearing
 * stretch, and still short enough that a genuinely fresh venue is left alone.
 */
export const MIN_SEED_MARGIN_SECONDS = 900;

/**
 * The snapshot `getLatestPrice` would actually choose for `coinPair` at block
 * time `chainTime`, or null if the pair has none it can see.
 *
 * Mirrors the two halves of the anchor rule in this file's header, and the
 * ORDER is the whole point: the H-3 gate hides any row stamped in the chain's
 * future, and selection is `ORDER BY round_number DESC` among what survives -
 * so the winner is the highest ROUND, not the newest timestamp. The staleness
 * guard then runs on that one row and does NOT fall back to a fresher row
 * beneath it. Picking by timestamp here would report a venue healthy while the
 * indexer was failing on a stale high round, which is the precise shape of the
 * bug this function exists to catch.
 */
export function selectedSnapshot(rows, coinPair, chainTime) {
    const visible = (rows || []).filter((r) => r
        && r.coinPair === coinPair
        && Number.isFinite(Number(r.timestamp))
        && Number(r.timestamp) <= chainTime);
    if (!visible.length) return null;
    return visible.reduce((best, r) => (Number(r.round) > Number(best.round) ? r : best));
}

/**
 * The pair whose seeded price is not the one this fixture asks for, or null.
 *
 * WHY THIS IS NOT A VIOLATION OF "NEVER WRITE OVER A VENUE THAT PRICES".
 * That rule protects REAL data: a hub that genuinely publishes a pair must not
 * be papered over by a fixture, because then a green run proves nothing. It says
 * nothing about a row this fixture family owns. Only SYNTHETIC rounds are
 * considered here, so a derived round is still never touched, and a synthetic
 * round carrying someone else's number is not real data by any reading.
 *
 * WHY IT HAPPENS, which is the part worth remembering: the regtest venue is
 * SHARED between suites that disagree about what a coin is worth.
 * `xchain-e2e-test` seeds LTC/USD at 100000 for its own fee arithmetic while
 * this fixture wants 30, both write the same synthetic rounds, and whichever
 * suite ran last wins. Found, where a controllerPolicy run on LTC left
 * 100000 behind and the next wallet bet died with a protocol fee of 0.00000002
 * LTC, which is dust the network will not relay. That reads as a wallet bug and
 * is not one, so the fixture repairs its own number instead of inheriting it.
 */
export function venueDisagreement({ rows, chainTime, expected }) {
    for (const [coinPair, want] of Object.entries(expected || {})) {
        const row = selectedSnapshot(rows, coinPair, chainTime);
        if (!row || !SYNTHETIC.has(Number(row.round))) continue;
        if (Number(row.price) !== Number(want)) {
            return { coinPair, round: Number(row.round), found: String(row.price), expected: String(want) };
        }
    }
    return null;
}

/**
 * Chain-seconds of usable life left in the venue's price, taken as the WORST of
 * the pairs a fee-bearing action needs (both must price, so the weaker one is
 * the venue's real answer).
 *
 * TWO CLOCKS AGAIN, AND THEY ARE NOT THE SAME ONE THIS TIME EITHER. Selection
 * happens at `chainTime` (the H-3 gate hides a row stamped in the chain's
 * future, so the tip's own time decides WHICH row answers), but staleness has to
 * be judged at the time of the block that will carry the action - which is what
 * `referenceTime` is for. On a chain whose clock tracks wall time and which
 * mines ONLY ON DEMAND those two are hours apart, and the difference is not
 * academic: an idle Litecoin venue found 5.7 hours behind wall clock reported
 * 1743s of life left, and then the run's own first block, stamped at wall clock,
 * consumed 20,700 chain-seconds in one step and every fee-bearing action after
 * it answered "no current oracle price for LTC/USD (missing or stale beyond
 * 1800s)". MIN_SEED_MARGIN_SECONDS cannot absorb that: no margin inside the
 * 1800s window can, because the jump is unbounded by the length of the run.
 *
 * So the caller passes the time the NEXT block will most likely carry
 * (`max(chainTime, wallTime)` on this stack) and gets an answer that is already
 * true after that block lands. It defaults to `chainTime`, which keeps the
 * frozen-clock regime (`setmocktime`, where the next block carries mocktime, not
 * wall time) reading exactly as it did.
 *
 * Returns null when the answer is unknowable rather than bad: a pair with no
 * visible row at all. That case is deliberately not reported as 0, because the
 * caller has already asked the public endpoint whether the venue prices, and a
 * disagreement between that answer and this table is not something a fixture
 * should resolve by silently rewriting rows.
 *
 * @returns {number|null} seconds, negative when the selected row is already stale
 */
export function seedMarginSeconds({
    rows, chainTime, coinPairs, referenceTime, maxAge = ORACLE_MAX_PRICE_AGE_SECONDS,
}) {
    if (!Number.isFinite(chainTime) || chainTime <= 0) {
        throw new Error(`seedMarginSeconds: chainTime must be a positive unix time, got ${chainTime}`);
    }
    if (!Array.isArray(coinPairs) || !coinPairs.length) {
        throw new Error('seedMarginSeconds: coinPairs must be a non-empty array');
    }
    const readAt = Number.isFinite(referenceTime) && referenceTime > 0 ? referenceTime : chainTime;

    let worst = null;
    for (const pair of coinPairs) {
        const row = selectedSnapshot(rows, pair, chainTime);
        if (!row) return null;
        const margin = (Number(row.timestamp) + maxAge) - readAt;
        if (worst === null || margin < worst) worst = margin;
    }
    return worst;
}

/**
 * The rows to write for ONE coin pair: every round this fixture owns for it,
 * stamped so that both the pre-flight clock and the on-chain clock find a
 * fresh one. See the anchor rule in this file's header.
 *
 * `existingRounds` is what the venue already carries for the pair; only the
 * entries that are known-synthetic are adopted, and they are adopted precisely
 * so a leftover high round cannot shadow the seed.
 *
 * @param {{coinPair: string, price: string, baseRounds: number[],
 *          existingRounds?: number[], chainTime: number, wallTime: number}} args
 * @returns {{coinPair: string, price: string, roundNumber: number, blockTimestamp: number}[]}
 *          ascending by round number
 */
export function planPairRows({ coinPair, price, baseRounds, existingRounds = [], chainTime, wallTime }) {
    if (!Number.isFinite(chainTime) || chainTime <= 0) {
        throw new Error(`planPairRows(${coinPair}): chainTime must be a positive unix time, got ${chainTime}`);
    }
    if (!Number.isFinite(wallTime) || wallTime <= 0) {
        throw new Error(`planPairRows(${coinPair}): wallTime must be a positive unix time, got ${wallTime}`);
    }

    const rounds = [...new Set([
        ...baseRounds,
        ...existingRounds.filter((r) => SYNTHETIC.has(Number(r))).map(Number),
    ])].sort((a, b) => a - b);

    // Only the TOP round takes the wall anchor. Everything below it stays at
    // the tip, which is the newest stamp that is always legal under the H-3
    // gate - so the pair keeps an answer even on a chain whose clock is frozen
    // hours behind wall time and whose gate hides the wall row entirely.
    const topAnchor = Math.max(chainTime, wallTime);
    return rounds.map((roundNumber, i) => ({
        coinPair,
        price,
        roundNumber,
        blockTimestamp: i === rounds.length - 1 ? topAnchor : chainTime,
    }));
}

/**
 * Every row to write for a venue: the gas pair plus that chain's coin pair.
 *
 * @param {{regtestCoin: string, existingRounds?: Record<string, number[]>,
 *          chainTime: number, wallTime: number}} args
 */
export function planSeedRows({ regtestCoin, existingRounds = {}, chainTime, wallTime }) {
    const venue = VENUE_PRICE[regtestCoin];
    if (!venue) {
        throw new Error(`planSeedRows: ${regtestCoin} is not a regtest chain this fixture prices; `
            + `expected one of ${Object.keys(VENUE_PRICE).join(', ')}`);
    }
    return [
        ...planPairRows({
            coinPair: XCHAIN_PAIR, price: XCHAIN_USD_PRICE, baseRounds: BASE_ROUNDS.xchain,
            existingRounds: existingRounds[XCHAIN_PAIR] || [], chainTime, wallTime,
        }),
        ...planPairRows({
            coinPair: venue.coinPair, price: venue.price, baseRounds: BASE_ROUNDS.coin,
            existingRounds: existingRounds[venue.coinPair] || [], chainTime, wallTime,
        }),
    ];
}

/**
 * Reads a `/api/feequote` body and says whether the venue can price an action
 * right now.
 *
 * This is the whole verification side, and it is deliberately the
 * PUBLIC endpoint: it asks the venue the same question the wallet is about to
 * ask, over the same transport, with no credentials. A pre-flight that answers
 * with both prices is proof; anything else is the named reason a fee-bearing
 * spec is going to fail.
 *
 * `retryable` distinguishes "not yet" from "not ever". A missing price becomes
 * present after a seed and a block, and the quote engine's admission cap
 * (`busy`) clears on its own; a venue with native fees switched off will never
 * answer differently no matter how long the caller waits.
 */
export function priceVerdict(body) {
    if (!body || typeof body !== 'object') {
        return { usable: false, retryable: true, reason: 'the explorer returned no fee quote at all' };
    }
    // `busy` is carried through, not just folded into `retryable`, because the
    // two call for OPPOSITE responses. A missing price is fixed by seeding and
    // advancing the chain; a busy quote engine is a lock the caller is standing
    // behind, and mining another block only lengthens the queue holding it.
    if (body.busy) {
        return {
            usable: false, retryable: true, busy: true,
            reason: body.error || 'the indexer is already at its fee-quote limit',
        };
    }
    if (body.supported === false) {
        return {
            usable: false, retryable: false,
            reason: body.error || 'this venue does not price native-coin fees (no FEE_DESTINATION configured)',
        };
    }

    const coinUsd   = Number(body.coinUsdPrice);
    const xchainUsd = Number(body.xchainUsdPrice);
    if (Number.isFinite(coinUsd) && coinUsd > 0 && Number.isFinite(xchainUsd) && xchainUsd > 0) {
        return {
            usable: true, retryable: false, reason: null,
            coinUsdPrice: String(body.coinUsdPrice),
            xchainUsdPrice: String(body.xchainUsdPrice),
            oracleRound: body.oracleRound ?? null,
            blockTime: body.blockTime ?? null,
        };
    }

    return {
        usable: false, retryable: true,
        reason: body.error || 'the fee quote carried no oracle price',
    };
}

/**
 * Drives a freshly seeded venue until it prices an action, or says why not.
 *
 * All I/O is injected, because the bug this replaced was one of ORDER and a
 * live venue cannot be made to reproduce it: the loop used to mine a block,
 * wait a flat 3 seconds and re-probe, four times. On Litecoin and Dogecoin
 * that is plenty. On Bitcoin it is a bet that loses, because the same venue
 * parses most blocks in 54-260ms and the occasional one in 1m 12.8s, and for
 * the whole of that window every fee quote answers `busy` ("waited 2000ms for
 * the database transaction lock"). Four attempts then fit inside ONE lock and
 * the run reports an unpriceable venue that is, minutes later, healthy - which
 * is how RBTC came to look permanently dead while the other two chains ran.
 *
 * Two rules come out of that, and both are asserted in the unit suite:
 *   - WAIT ON THE INDEXER, not on a duration. `waitForTip` resolves when the
 *     chain has actually been absorbed.
 *   - A BUSY ENGINE IS A LOCK, NOT A MISSING PRICE. Re-ask the same question;
 *     do not mine again, which only puts another block in front of the one
 *     already being parsed. The number of MINES is therefore the thing worth
 *     asserting on, and `trace` exists so a test can.
 *
 * @returns {Promise<{verdict: object, trace: string[]}>} the last verdict seen
 *   and the sequence of actions taken to reach it.
 */
export async function settlePrice({
    probe, mineOne, waitForTip, sleep,
    attempts = 4, busyReprobes = 20, busyReprobeMs = 5_000,
}) {
    let verdict = { usable: false, retryable: true, reason: 'the venue was never probed' };
    const trace = [];
    for (let i = 0; i < attempts; i++) {
        trace.push('mine');
        await mineOne();
        trace.push('wait');
        await waitForTip();
        trace.push('probe');
        verdict = await probe();
        for (let b = 0; verdict.busy && b < busyReprobes; b++) {
            trace.push('sleep');
            await sleep(busyReprobeMs);
            trace.push('probe');
            verdict = await probe();
        }
        if (verdict.usable) return { verdict, trace };
        // "Not ever" rather than "not yet": another block will not help.
        if (!verdict.retryable) break;
    }
    return { verdict, trace };
}

/**
 * The message a spec's operator should get when the venue cannot be priced.
 *
 * Its whole job is to stop the next reader diagnosing a wallet defect. A
 * fee-bearing spec that fails on price state fails several screens into a form,
 * on copy that reads exactly like a wallet bug ("The LTC fee price is
 * temporarily unavailable"), so this names the venue, the reason, and what was
 * tried, and it is raised from global setup rather than mid-spec.
 */
export function unusablePriceMessage({ regtestCoin, reason, seeded, state }) {
    const lines = [
        `Regtest ${regtestCoin} cannot price a fee-bearing action: ${reason}`,
        '',
        'This is VENUE state, not a wallet defect. Every USD-priced action (bet, issue,',
        'dispenser) is valued against the indexer\'s price_snapshots, and nothing on a',
        'regtest stack publishes those rows - there is no validator federation here.',
    ];
    if (seeded) {
        lines.push(
            '',
            'seedPrices() DID write a fresh snapshot and the venue still refuses, so the',
            'seed is being outranked or the chain clock has moved out from under it:',
            'getLatestPrice takes the HIGHEST round number and only then checks staleness,',
            'so one high round with a bad timestamp hides every correct row behind it.',
        );
    } else {
        lines.push(
            '',
            'seedPrices() did NOT write anything (seeding is off, or the venue host could',
            'not be reached over SSH), so the venue was left with whatever it already had.',
            'Unset XC_REGTEST_NO_PRICE_SEED / XCHAIN_E2E_NO_PRICE_SEED, or check that',
            '`ssh ' + sshHostHint() + '` works from this machine.',
            '',
            // The remedy that cost 2026-08-27 a run: the default ssh host is
            // `jdog@localhost`, which only resolves on a machine that either IS
            // the venue or forwards port 22 to it. From a dev box that reaches
            // the venue as a named host, `ssh jdog@localhost` fails with "Host
            // key verification failed" and the message above sends the reader
            // off to debug ssh - when the fix is one environment variable that
            // nothing here named.
            'IF THAT SSH TARGET IS SIMPLY THE WRONG ONE, set XC_REGTEST_SSH_HOST to the host',
            'that runs the venue containers, as your ssh config already names it, and re-run.',
            'The seed shells out to `ssh <host> docker exec <indexer>`, so it needs the name',
            'your ssh config already uses, not a tunnel.',
        );
    }
    if (state) {
        lines.push('', `Venue price state: ${JSON.stringify(state)}`);
    }
    return lines.join('\n');
}

function sshHostHint() {
    return (typeof process !== 'undefined' && process.env && process.env.XC_REGTEST_SSH_HOST) || 'jdog@localhost';
}

/**
 * The script run INSIDE the indexer container to read the venue's price state.
 *
 * Built as a string and piped to `node` on stdin so nothing has to be quoted
 * through two shells. It prints exactly one JSON line and never reads, echoes
 * or logs a credential: the connection parameters come from the container's own
 * environment and stay there.
 *
 * @param {string[]} coinPairs the pairs to report rounds for
 */
export function readStateScript(coinPairs) {
    return containerScript(`
        // Placeholders are built rather than relying on array expansion: the
        // mariadb driver does not expand an array into an IN list, it binds it
        // as one value, which silently matches nothing.
        const rows = await priceConn.query(
            'SELECT coin_pair, round_number, block_timestamp, price, status'
            + ' FROM price_snapshots WHERE coin_pair IN ('
            + PAIRS.map(() => '?').join(',') + ')', PAIRS);
        const tip = await blocksConn.query(
            'SELECT block_index, block_time FROM blocks ORDER BY block_index DESC LIMIT 1');
        out = {
            network:   process.env.INDEXER_NETWORK,
            chainTime: tip.length ? Number(tip[0].block_time) : 0,
            tipIndex:  tip.length ? Number(tip[0].block_index) : 0,
            rows: rows.map(r => ({
                coinPair:  r.coin_pair,
                round:     Number(r.round_number),
                timestamp: Number(r.block_timestamp),
                price:     String(r.price),
                status:    r.status,
            })),
        };
    `, { PAIRS: coinPairs });
}

/**
 * The script run INSIDE the indexer container to upsert the planned rows.
 *
 * The rows carry only synthetic round numbers, coin pairs, fixture prices and
 * unix timestamps, so embedding them in the source is safe; the credentials are
 * the part that never leaves the container.
 *
 * The upsert is `ON DUPLICATE KEY UPDATE` on the table's own (round_number,
 * coin_pair) key, which is what lets this move an existing sentinel forward
 * rather than stacking a new round beside it.
 */
export function writeRowsScript(rows) {
    return containerScript(`
        for (const row of ROWS){
            await priceConn.query(
                'INSERT INTO price_snapshots'
                + ' (round_number, coin_pair, price, reference_block, reference_chain,'
                + '  block_timestamp, validator_count, consensus_round, consensus_proof, status)'
                + " VALUES (?, ?, ?, 0, 'BTC', ?, 1, 1, '[]', 'finalized')"
                + ' ON DUPLICATE KEY UPDATE price = VALUES(price),'
                + ' reference_block = VALUES(reference_block),'
                + ' block_timestamp = VALUES(block_timestamp),'
                + " status = 'finalized'",
                [row.roundNumber, row.coinPair, row.price, row.blockTimestamp]);
        }
        out = { written: ROWS.length, network: process.env.INDEXER_NETWORK };
    `, { ROWS: rows });
}

/**
 * Wraps a body in the connection + safety preamble both container scripts share.
 *
 * THE REGTEST ASSERTION IS THE POINT. This is the one place in the wallet's test
 * tree that writes to a database at all, so it refuses to run anywhere but a
 * regtest indexer, checked against the container's own `INDEXER_NETWORK` rather
 * than against anything the caller passed in.
 *
 * Where it writes follows the indexer's own read path: once HUB_DB_NAME is set
 * the indexer opens a separate hubDb and every price lookup goes through it, so
 * a seed into the local database would land in a table nothing reads. `blocks`
 * only ever exists in the indexer's own database, so the tip is read there
 * regardless.
 */
function containerScript(body, constants = {}) {
    const decls = Object.entries(constants)
        .map(([name, value]) => `const ${name} = ${JSON.stringify(value)};`)
        .join('\n');
    return `'use strict';
const mariadb = require('mariadb');
${decls}
const env = process.env;
if (env.INDEXER_NETWORK !== 'regtest'){
    console.error('REFUSING: INDEXER_NETWORK is ' + JSON.stringify(env.INDEXER_NETWORK)
        + ', not "regtest". The wallet e2e price fixture only ever writes to a regtest venue.');
    process.exit(2);
}
const indexerParams = {
    host: env.INDEXER_DB_HOST, port: Number(env.INDEXER_DB_PORT || 3306),
    user: env.INDEXER_DB_USER, password: env.INDEXER_DB_PASS, database: env.INDEXER_DB_NAME,
};
const priceParams = (env.HUB_DB_HOST && env.HUB_DB_NAME) ? {
    host: env.HUB_DB_HOST, port: Number(env.HUB_DB_PORT || 3306),
    user: env.HUB_DB_USER, password: env.HUB_DB_PASS, database: env.HUB_DB_NAME,
} : indexerParams;
(async () => {
    let out = null;
    const priceConn  = await mariadb.createConnection(priceParams);
    const blocksConn = priceParams === indexerParams
        ? priceConn : await mariadb.createConnection(indexerParams);
    try {
${body}
    } finally {
        await priceConn.end().catch(() => {});
        if (blocksConn !== priceConn) await blocksConn.end().catch(() => {});
    }
    process.stdout.write(JSON.stringify(out) + '\\n');
})().catch((err) => {
    // The message only, never the parameter object: a mariadb error object
    // carries the connection config, and printing it would put a password in
    // Playwright's output.
    console.error('SEED FAILED: ' + err.message);
    process.exit(1);
});
`;
}
