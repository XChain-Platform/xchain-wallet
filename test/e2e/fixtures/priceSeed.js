// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// . The arithmetic and the wording behind `seedPrices()`, with no I/O in
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
// So until  the wallet's regtest specs simply inherited whatever the last
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
//   - the PRE-FLIGHT reads at the tip's block time ( anchors the whole
//     price read on the quoted block's own time, so the older campaign note
//     that "/feequote measures staleness against wall clock" is no longer true
//     at HEAD - it was measured before  landed);
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
 * Not a round number picked for convenience: the hub carries forward a
 * bootstrap of 2.00 every round (`XCHAIN_PRICE_BOOTSTRAP_USD`), and the e2e
 * tree pins the same constant in `xchainPriceConstants.BOOTSTRAP_XCHAIN_USD`.
 * Seeding anything else would mean every green fee run asserted against a
 * number no producer emits, which is the specific way a missing-pair bug once
 * survived to launch-blocker status.
 */
export const XCHAIN_USD_PRICE = '2.00000000';

/**
 * The coin pair and price this fixture puts on each regtest chain.
 *
 * The prices are not arbitrary and are not interchangeable; each is the value a
 * campaign session measured a working flow at.
 *
 *   BTC   100000  matches the platform's own native-fee fixtures.
 *   LTC       30  MEASURED FLOOR, not a preference. At a "realistic" $100 a
 *                 place-bet's protocol fee prices at 2000 sats against
 *                 Litecoin's 5460-sat dust floor and is refused outright, so
 *                 betting is unusable on LTC; $30 puts the fee at 6667 sats and
 *                 the same bet indexes valid (break-even is ~$36.6). The verify
 *                 case for  is a Litecoin bet, so this number is what
 *                 makes it pass.
 *   DOGE     0.1  a realistic price leaves ~20x of headroom, because a
 *                 USD-denominated fee buys more sats per cent on a cheap coin.
 */
export const VENUE_PRICE = Object.freeze({
    RBTC:  Object.freeze({ coinPair: 'BTC/USD',  price: '100000.00000000' }),
    RLTC:  Object.freeze({ coinPair: 'LTC/USD',  price: '30.00000000' }),
    RDOGE: Object.freeze({ coinPair: 'DOGE/USD', price: '0.10000000' }),
});

/**
 * The round numbers this fixture writes: the platform's OWN native-fee
 * sentinels, deliberately not a new family of its own.
 *
 * Reusing them is the whole point. Selection takes the highest round number, so
 * a synthetic row outranks every derived round forever, and suppressing new
 * seeds cannot retract rows an earlier run already wrote (, found
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
 * Not a style preference, and the reason it is this large is . A quote
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
 * suite ran last wins. Found by , where a controllerPolicy run on LTC left
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
 * Returns null when the answer is unknowable rather than bad: a pair with no
 * visible row at all. That case is deliberately not reported as 0, because the
 * caller has already asked the public endpoint whether the venue prices, and a
 * disagreement between that answer and this table is not something a fixture
 * should resolve by silently rewriting rows.
 *
 * @returns {number|null} seconds, negative when the selected row is already stale
 */
export function seedMarginSeconds({ rows, chainTime, coinPairs, maxAge = ORACLE_MAX_PRICE_AGE_SECONDS }) {
    if (!Number.isFinite(chainTime) || chainTime <= 0) {
        throw new Error(`seedMarginSeconds: chainTime must be a positive unix time, got ${chainTime}`);
    }
    if (!Array.isArray(coinPairs) || !coinPairs.length) {
        throw new Error('seedMarginSeconds: coinPairs must be a non-empty array');
    }

    let worst = null;
    for (const pair of coinPairs) {
        const row = selectedSnapshot(rows, pair, chainTime);
        if (!row) return null;
        const margin = (Number(row.timestamp) + maxAge) - chainTime;
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
 * This is the whole verification side of , and it is deliberately the
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
    if (body.busy) {
        return { usable: false, retryable: true, reason: body.error || 'the indexer is already at its fee-quote limit' };
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
        );
    }
    if (state) {
        lines.push('', `Venue price state: ${JSON.stringify(state)}`);
    }
    return lines.join('\n');
}

function sshHostHint() {
    return (typeof process !== 'undefined' && process.env && process.env.XC_REGTEST_SSH_HOST) || 'jdog@devhost';
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
