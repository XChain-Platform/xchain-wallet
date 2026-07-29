// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regtest venue helpers: the seam between a Playwright spec and a real
// chain (, spec §8.6).
//
// WHY THESE SPECS ARE SEPARATE FROM THE REST OF THE SUITE
//
// `playwright.config.js` drives the Vite DEV server, which runs the
// dev-mock SDK - whose signing path throws by design. So no spec run
// that way can ever exercise signing or broadcast, on any chain. That,
// not "missing regtest wiring", is why §8.6's signing legs went unrun
// for months.
//
// : the dev server runs the mock because it is TOLD to
// (`VITE_XCHAIN_REAL_SDK=0`, pinned in `playwright.config.js`), not
// because the real SDK fails to load there. It used to be the latter -
// vite dev threw `require is not defined` on the CJS import and
// `resolveSdkFactory` caught it - and when vite learned to pre-bundle
// the SDK that venue silently became a real-SDK-against-mainnet venue,
// where every compose fails "unreachable". Same venue as before, chosen
// on purpose now.
//
// `playwright.regtest.config.js` serves a `vite preview` of the
// PRODUCTION build instead, which rollup bundles the CJS into - the
// same artifact users get. Production builds delete the dev mock
// entirely and THROW rather than fall back (hostBridge.js `sdkResolved`
// under `import.meta.env.PROD`), so a preview that renders at all is
// itself proof the real SDK loaded. There is no mock to accidentally
// test against here.
//
// VENUE CONTRACT
//
// These specs need the devhost 3-chain regtest stack reachable on
// localhost at the ports the wallet's own regtest descriptors already
// name (explorer 18080, hub 10000, shared by all three chains; encoder
// 3023/3223/3123 for BTC/LTC/DOGE) plus that chain's regtest-miner on
// 3025/3225/3125 for funding. SSH tunnels satisfy that with no code
// change; one command covers every chain:
//
//   ssh -N -L 18080:localhost:18080 -L 10000:localhost:10000 \
//          -L 3023:localhost:3023 -L 3025:localhost:3025 \
//          -L 3223:localhost:3223 -L 3225:localhost:3225 \
//          -L 3123:localhost:3123 -L 3125:localhost:3125 jdog@devhost
//
// `assertVenueReachable()` (called from global setup) fails once, fast,
// with that command in the message, rather than letting every spec die
// several screens deep in the UI on a symptom that looks like a wallet
// bug.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { expect } from '@playwright/test';
import { openSettings, gotoSection, unlockedShell } from './wallet.js';
import {
    MIN_SEED_MARGIN_SECONDS,
    XCHAIN_PAIR,
    XCHAIN_USD_PRICE,
    VENUE_PRICE,
    planSeedRows,
    priceVerdict,
    readStateScript,
    seedMarginSeconds,
    unusablePriceMessage,
    venueDisagreement,
    writeRowsScript,
} from './priceSeed.js';

/**
 * The three regtest chains this stack runs, and the ports each one answers on.
 *
 * WHY THIS IS A TABLE AND NOT THREE CONSTANTS. The venue is SHARED, and Bitcoin
 * is the busy one: it carries the e2e suites, the drills and whatever another
 * session is mid-sweep on. A spec that must own the chain's state for a while -
 * a market with a deadline, a clock that has to cross it - cannot take its turn
 * on a chain somebody else is broadcasting into, and until this table existed
 * the only answer was to wait. Litecoin and Dogecoin run the identical stack on
 * a fixed port offset (encoder 3x23, miner 3x25), so the choice costs nothing
 * but the arithmetic below.
 *
 * The explorer (18080) and hub (10000) are SHARED across all three chains, so
 * only the per-chain services are keyed here; the explorer is addressed by coin
 * code in the path instead.
 */
const VENUES = {
    RBTC: {
        encoderPort: 3023, minerPort: 3025,
        chainId: 'bitcoin-regtest', chainLabel: 'Bitcoin',
        // The container `seedPrices()` runs its price seed inside . Named
        // here rather than derived from chainId because the stack's naming uses
        // the coin's full name where the wallet's chain id does too, but there is
        // no rule saying it always will - a rename should break on a missing key,
        // not on a string that silently builds the wrong container name.
        indexerContainer: 'xchain-node-bitcoin-regtest-xchain-indexer',
        // Bech32 HRP plus the legacy P2PKH/P2SH version bytes each chain's
        // regtest params use. Asserted on wherever a spec reads an address out
        // of the wallet, so a form that hands back a MAINNET address (or another
        // chain's) fails on the address itself rather than several steps later
        // on a funding that never arrives.
        addressRe: /^(bcrt1|[mn2])/,
    },
    RLTC: {
        encoderPort: 3223, minerPort: 3225,
        chainId: 'litecoin-regtest', chainLabel: 'Litecoin',
        indexerContainer: 'xchain-node-litecoin-regtest-xchain-indexer',
        addressRe: /^(rltc1|[mn2])/,
    },
    RDOGE: {
        encoderPort: 3123, minerPort: 3125,
        chainId: 'dogecoin-regtest', chainLabel: 'Dogecoin',
        indexerContainer: 'xchain-node-dogecoin-regtest-xchain-indexer',
        addressRe: /^[mn2]/,
    },
};

/**
 * Explorer coin code for the chain this run drives.
 *
 * Defaults to Bitcoin, so every spec written before this table keeps the venue
 * it was written against and nothing has to opt out. Set XC_REGTEST_COIN=RLTC
 * to move a run onto Litecoin.
 */
export const REGTEST_COIN = process.env.XC_REGTEST_COIN || 'RBTC';

const VENUE = VENUES[REGTEST_COIN];
if (!VENUE) {
    throw new Error(
        `XC_REGTEST_COIN=${REGTEST_COIN} is not a regtest chain on this stack; `
        + `expected one of ${Object.keys(VENUES).join(', ')}`);
}

/** Explorer/hub ports are shared; encoder/miner come from the chosen chain. */
export const EXPLORER_URL = 'http://localhost:18080';
export const ENCODER_URL = `http://localhost:${VENUE.encoderPort}`;
export const MINER_URL = `http://localhost:${VENUE.minerPort}`;

/** The wallet's own id and display name for the chain this run drives. */
export const REGTEST_CHAIN_ID = VENUE.chainId;
export const REGTEST_CHAIN_LABEL = VENUE.chainLabel;

/** Address shape this chain's regtest params produce. */
export const REGTEST_ADDRESS_RE = VENUE.addressRe;

/**
 * A deterministic, checksum-valid regtest P2WPKH destination.
 *
 * Derived once from a fixed sha256 (`bitcoinjs-lib` p2wpkh over
 * hash160('xchain-wallet-e2e-regtest-destination')) and pinned as a
 * literal so specs assert on a stable string. Nothing holds its key:
 * anything sent here is intentionally unspendable-by-us, which is what
 * a throwaway e2e destination should be.
 */
export const REGTEST_DESTINATION = 'bcrt1qmr46t4ca5wh35k6mczdzrkepqw2d8ne956f48f';

/** JSON-RPC 2.0 call against a venue service. Throws on RPC-level errors. */
async function venueRpc(url, method, params = {}, timeoutMs = 30_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: controller.signal,
        });
        const body = await res.json();
        if (body.error) {
            throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
        }
        // The miner reports some failures as a `result.error` string rather
        // than a JSON-RPC error object; treat that as a failure too, or a
        // bad fund silently becomes "waiting for a UTXO that never comes".
        if (body.result && typeof body.result === 'object' && body.result.error) {
            throw new Error(`${method} failed: ${body.result.error}`);
        }
        return body.result;
    } finally {
        clearTimeout(timer);
    }
}

export const minerRpc = (method, params) => venueRpc(MINER_URL, method, params);
export const encoderRpc = (method, params) => venueRpc(ENCODER_URL, method, params);

/**
 * Fails the run early, with the fix, when the venue is not reachable.
 *
 * Called from global setup so a down tunnel costs one legible error
 * instead of N specs timing out inside the wallet UI.
 */
export async function assertVenueReachable() {
    // Names the ports THIS run needs, not Bitcoin's: a Litecoin run whose
    // encoder tunnel is missing would otherwise be told to open Bitcoin's and
    // find that it already is.
    const hint =
        `Regtest venue (${REGTEST_COIN}) unreachable. Open the tunnels:\n`
        + `  ssh -N -L 18080:localhost:18080 -L ${VENUE.encoderPort}:localhost:${VENUE.encoderPort} `
        + `-L 10000:localhost:10000 -L ${VENUE.minerPort}:localhost:${VENUE.minerPort} jdog@devhost`;

    let status;
    try {
        const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/status`, {
            signal: AbortSignal.timeout(10_000),
        });
        status = await res.json();
    } catch (err) {
        throw new Error(`${hint}\n\nExplorer ${EXPLORER_URL} did not answer: ${err.message}`);
    }

    // A reachable-but-lagging chain produces confusing spec failures
    // (funds that never arrive), so check liveness, not just liveness of
    // the socket.
    const lag = status?.chain_lag_blocks?.[REGTEST_COIN];
    if (typeof lag !== 'number') {
        throw new Error(`${hint}\n\nExplorer answered but reports no ${REGTEST_COIN} chain.`);
    }
    if (lag > 2) {
        throw new Error(`Regtest ${REGTEST_COIN} indexer is ${lag} blocks behind; wait for it to catch up.`);
    }

    let miner;
    try {
        miner = await minerRpc('status', {}, 10_000);
    } catch (err) {
        throw new Error(`${hint}\n\nRegtest miner ${MINER_URL} did not answer: ${err.message}`);
    }
    if (!miner?.wallet_ready) {
        throw new Error(`Regtest miner is up but its wallet is not ready: ${JSON.stringify(miner)}`);
    }
}

/**
 * The venue host the tunnels already go to, and the SSH identity used to reach
 * it. Overridable for a stack that lives somewhere else; never a credential,
 * just a host, and the key is the operator's own agent.
 */
const SSH_HOST = process.env.XC_REGTEST_SSH_HOST || 'jdog@devhost';

/**
 * Whether this run may write a price snapshot at all.
 *
 * Two names, because there are two audiences. `XCHAIN_E2E_NO_PRICE_SEED` is the
 * platform's existing flag and means "this venue's hub publishes prices itself,
 * so a synthetic round would shadow the real ones"; `XC_REGTEST_NO_PRICE_SEED`
 * is the wallet-local off switch for a run that simply must not touch shared
 * state. Either one suppresses the write; NEITHER suppresses the CHECK, which
 * is the half that keeps a price failure legible.
 */
const PRICE_SEED_SUPPRESSED =
    process.env.XC_REGTEST_NO_PRICE_SEED === '1' || process.env.XCHAIN_E2E_NO_PRICE_SEED === '1';

/**
 * Runs `script` inside this chain's indexer container and returns the JSON it
 * printed.
 *
 * The script arrives on stdin, so nothing has to survive quoting through a
 * local shell and a remote one, and no part of it is visible in a process list.
 * `BatchMode=yes` means a host that wants a password fails immediately with a
 * legible error instead of hanging a global setup on a prompt nobody can see.
 *
 * Exported because `seedPrices()` deliberately refuses to write over a venue
 * that already prices, which is right for setup and useless for the one spec
 * that must MOVE a price it just used: the  Approve-time re-quote can
 * only be driven by changing the fee between composing and approving. That
 * spec drives the write itself, through this same credential-free path.
 */
export async function runInIndexer(script, timeoutMs = 60_000) {
    const args = [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        SSH_HOST,
        'docker', 'exec', '-i', VENUE.indexerContainer, 'node',
    ];

    return new Promise((resolve, reject) => {
        const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`ssh ${SSH_HOST} docker exec ${VENUE.indexerContainer} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`ssh ${SSH_HOST} docker exec ${VENUE.indexerContainer} exited ${code}: `
                    + `${stderr.trim() || stdout.trim() || '(no output)'}`));
                return;
            }
            // The container script prints exactly one JSON line, but docker exec
            // can prepend a warning; take the last non-empty line rather than
            // the whole buffer so a chatty daemon does not read as a parse error.
            const line = stdout.trim().split('\n').filter(Boolean).pop();
            try {
                resolve(JSON.parse(line));
            } catch {
                reject(new Error(`indexer container returned unparseable output: ${stdout.trim().slice(0, 400)}`));
            }
        });

        child.stdin.end(script);
    });
}

/**
 * Asks the venue, over the public read the wallet itself uses, whether it can
 * price an action right now.
 *
 * The tick is randomized on every call for a reason that cost real time to
 * find: `computeFeeQuote` runs the REAL handler, and a handler that refuses
 * (taken ticker) stages a zero fee, which returns early with no price fields at
 * all - indistinguishable, to a naive reader, from a venue with no oracle
 * price. A fresh tick keeps the quote on the path that actually reports prices.
 */
async function probePrice() {
    const tick = 'XCW' + randomBytes(4).toString('hex').toUpperCase();
    const q = new URLSearchParams({
        action: 'ISSUE',
        params: `0|${tick}`,
        source: REGTEST_DESTINATION,
    });
    let body = null;
    try {
        const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/feequote?${q.toString()}`, {
            signal: AbortSignal.timeout(30_000),
        });
        body = await res.json();
    } catch (err) {
        return { usable: false, retryable: true, reason: `the explorer did not answer /feequote: ${err.message}` };
    }
    return priceVerdict(body);
}

/**
 * Chain-seconds of usable life left in the venue's price, or null when that
 * cannot be established.
 *
 * The public quote cannot answer this: it reports whether a price exists, and
 * carries the BLOCK's time and the round number but never the chosen snapshot's
 * own timestamp, so there is nothing in it to subtract. The age lives in
 * `price_snapshots`, so this asks the container the same way the seed does, over
 * the same credential-free path.
 *
 * Null on any failure, deliberately. This runs on the healthy path, where the
 * venue has ALREADY told us it prices; a flaky SSH hop or a schema surprise must
 * not turn a working venue into a failed global setup. The caller reads null as
 * "leave it alone".
 */
async function priceHealth(venue) {
    try {
        const state = await runInIndexer(readStateScript([XCHAIN_PAIR, venue.coinPair]));
        if (!state || !Number(state.chainTime)) return { margin: null, disagreement: null };
        const chainTime = Number(state.chainTime);
        const rows = state.rows || [];
        return {
            margin: seedMarginSeconds({ rows, chainTime, coinPairs: [XCHAIN_PAIR, venue.coinPair] }),
            disagreement: venueDisagreement({
                rows,
                chainTime,
                expected: { [XCHAIN_PAIR]: XCHAIN_USD_PRICE, [venue.coinPair]: venue.price },
            }),
        };
    } catch {
        return { margin: null, disagreement: null };
    }
}

/**
 * Guarantees this venue can price a fee-bearing action, or fails naming that as
 * the reason .
 *
 * WHAT THIS REPLACES. Nothing on a regtest stack publishes `price_snapshots` -
 * those rows come from a validator federation and there is none here - so until
 * this existed every fee-bearing spec silently inherited whatever the last
 * person to hand-seed had left behind, and a snapshot is usable for 1800s.
 * Three campaign sessions were lost to that: one to a sentinel that had expired,
 * one to re-seeding on a seven-minute timer for its whole length, and both had
 * to hand the state back to the next session in prose.
 *
 * ORDER OF OPERATIONS, ALL THREE STEPS LOAD-BEARING:
 *
 *   1. CHECK FIRST, and return without writing anything if the venue already
 *      prices. This is not an optimization. A synthetic round outranks every
 *      derived round forever (selection is `ORDER BY round_number DESC`), so on
 *      a venue whose hub really does publish the pair - the end state 
 *      step 8 is driving at - an unconditional seed would silently replace real
 *      data with a fixture and every green run after it would prove nothing.
 *   2. SEED, delegated over SSH into the indexer container so no credential
 *      lives in this repo or in the browser harness. See `priceSeed.js` for why
 *      the hub's `pushoracleprice` cannot do this job.
 *   3. MINE, THEN RE-CHECK. The dry-run verdict is pinned per block height, so
 *      a re-quote at the same height replays the old failure and reads exactly
 *      like "the seed did not work" - that cost a full diagnostic detour once
 *      already. The block also does real work: on a chain whose clock tracks
 *      wall time it moves the tip past the wall-anchored row, which is what
 *      makes that row selectable.
 *
 * Returns a summary rather than throwing when the venue is fine, so a caller
 * can log what it is pricing against.
 */
export async function seedPrices({ attempts = 4 } = {}) {
    const venue = VENUE_PRICE[REGTEST_COIN];
    if (!venue) {
        throw new Error(`seedPrices: no fixture price for ${REGTEST_COIN}`);
    }

    // Step 1: does the venue already answer, and will it still answer at the
    // approve step? "Answers now" was the whole test until , and it is not
    // enough: the run that found this composed a bet against a healthy quote and
    // failed minutes later on "no current oracle price for LTC/USD". Off Bitcoin
    // the window is spent in CHAIN seconds, and an idle LTC/DOGE chain burns them
    // in a rush once a spec starts mining, so a margin check is the only way to
    // tell a fresh venue from one that is about to expire under the run's feet.
    // Never write over a venue that has real life left in it.
    const before = await probePrice();
    let refreshing = false;
    if (before.usable) {
        const { margin, disagreement } = await priceHealth(venue);
        const thin = margin !== null && margin < MIN_SEED_MARGIN_SECONDS;
        if (!thin && !disagreement) {
            return { seeded: false, reason: 'venue already priced', marginSeconds: margin, ...before };
        }
        const why = disagreement
            ? `${disagreement.coinPair} is seeded at ${disagreement.found} but this fixture prices it at `
              + `${disagreement.expected} (synthetic round ${disagreement.round}, almost certainly another suite's)`
            : `only ${margin}s of chain life left`;
        // Suppression is an explicit instruction not to write, so it outranks the
        // refresh. Say so loudly rather than seeding anyway or failing a venue
        // that does, right now, still price.
        if (PRICE_SEED_SUPPRESSED) {
            console.warn(`[regtest ${REGTEST_COIN}] ${why}, and XC_REGTEST_NO_PRICE_SEED is set, so it will `
                + 'NOT be repaired; a fee-bearing step may fail on price or on a dust protocol fee');
            return { seeded: false, reason: 'venue already priced', marginSeconds: margin, ...before };
        }
        console.log(`[regtest ${REGTEST_COIN}] refreshing the venue price: ${why}`);
        refreshing = true;
    }
    // These two only speak to a venue that cannot price at all. A refresh has
    // already proved it can, so neither applies and both would be wrong here:
    // `retryable` is false for a usable quote, and suppression was handled above.
    if (!refreshing) {
        if (!before.retryable) {
            throw new Error(unusablePriceMessage({
                regtestCoin: REGTEST_COIN, reason: before.reason, seeded: false,
            }));
        }
        if (PRICE_SEED_SUPPRESSED) {
            throw new Error(unusablePriceMessage({
                regtestCoin: REGTEST_COIN, reason: before.reason, seeded: false,
            }));
        }
    }

    // Step 2: seed. Read the venue's own clock and its existing rounds first -
    // the anchors and the shadowing check both depend on them.
    let state;
    let rows;
    try {
        state = await runInIndexer(readStateScript([XCHAIN_PAIR, venue.coinPair]));
        const existingRounds = {};
        for (const row of state.rows || []) {
            (existingRounds[row.coinPair] ||= []).push(row.round);
        }
        rows = planSeedRows({
            regtestCoin: REGTEST_COIN,
            existingRounds,
            chainTime: state.chainTime,
            wallTime: Math.floor(Date.now() / 1000),
        });
        await runInIndexer(writeRowsScript(rows));
    } catch (err) {
        throw new Error(unusablePriceMessage({
            regtestCoin: REGTEST_COIN,
            reason: `${before.reason} - and seeding one failed: ${err.message}`,
            seeded: false,
        }));
    }

    // Step 3: mine, then re-check against the same public read the wallet uses.
    let after = before;
    for (let i = 0; i < attempts; i++) {
        await minerRpc('generate_blocks', { count: 1 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 3_000));
        after = await probePrice();
        if (after.usable) {
            return {
                seeded: true,
                rows: rows.length,
                chainTime: state.chainTime,
                ...after,
            };
        }
        if (!after.retryable) break;
    }

    throw new Error(unusablePriceMessage({
        regtestCoin: REGTEST_COIN,
        reason: after.reason,
        seeded: true,
        state: {
            chainTime: state.chainTime,
            tipIndex: state.tipIndex,
            wrote: rows.map((r) => `${r.coinPair}#${r.roundNumber}@${r.blockTimestamp}`),
            found: (state.rows || []).map((r) => `${r.coinPair}#${r.round}@${r.timestamp}`),
        },
    }));
}

/**
 * Funds `address` with `amountBtc` and waits until the encoder's
 * utxo-tracker view actually shows it.
 *
 * Mines a block explicitly rather than trusting the miner's timer: the
 * wallet selects only CONFIRMED utxos, so a spec that raced the next
 * scheduled block would fail intermittently on "no funds" - the worst
 * kind of e2e flake, because it looks like a wallet bug.
 */
export async function fundAddress(address, amountBtc = 1) {
    const before = await countUtxos(address);
    await minerRpc('send_funds', { address, amount: amountBtc });
    await minerRpc('generate_blocks', { count: 1 });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if ((await countUtxos(address)) > before) return;
        await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(`Funding ${address} with ${amountBtc} BTC never appeared in the utxo-tracker view`);
}

async function countUtxos(address) {
    const result = await encoderRpc('get_utxos', { address });
    return Array.isArray(result?.utxos) ? result.utxos.length : 0;
}

/**
 * Mines a block and waits for `txid` to show up as a confirmed UTXO on
 * `address`, returning it.
 *
 * This is the independent half of a broadcast assertion. "Broadcast
 * pending" is the wallet reporting on itself; this is the CHAIN
 * reporting that the money arrived, at the right address, for the right
 * amount, from the transaction the wallet claimed to have sent. A
 * signed-but-wrong transaction (bad output set, wrong amount) passes
 * the first check and fails this one.
 */
export async function waitForConfirmedUtxo(address, txid, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    await minerRpc('generate_blocks', { count: 1 });

    while (Date.now() < deadline) {
        const result = await encoderRpc('get_utxos', { address });
        const match = (result?.utxos || []).find((u) => u.txid === txid || u.fullTxid === txid);
        if (match) return match;
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`Transaction ${txid} never confirmed to ${address}`);
}

/**
 * How fast a pre-flight response has to come back before the SDK's Tier-1
 * budget is safe. The budget itself is `DEFAULT_TIMEOUT_MS` (4000ms) in
 * `xchain-sdk/src/preflight/constants.js`; this is well under it so a
 * warm call cannot be marginal.
 */
const PREFLIGHT_WARM_MS = 750;

/**
 * Makes the indexer's dry-run for ONE exact action cheap, and returns its
 * verdict, so a spec can assert on the Tier-1 half without racing a budget.
 *
 * WHY THIS EXISTS. Tier 1 is the dry-run: the indexer runs the action
 * through the real handler in a rolled-back transaction. That is not a
 * lookup, it costs real work, and on this SHARED venue a COLD one measured
 * between 1.2s and 5.0s depending on what else was driving the stack. The
 * SDK abandons Tier 1 at 4000ms and degrades to the client tier by design
 * (spec §8.4), so the confirm panel renders a Tier-2-only report and the
 * dry-run finding the spec is asserting on simply is not there.
 *
 * That failure is worth spelling out because it reads as a wallet defect and
 * is not one: the verdict is right, the panel is right, the network was just
 * slow. It USED to be worse: `DRYRUN_UNAVAILABLE` is an `info` finding, and
 * `PreflightPanel` rendered only errors, warnings and the unverified list, so
 * nothing on the screen distinguished "the network said this is fine" from
 * "the network never answered".  fixed that half - the panel now reads
 * "Local checks only" with an explicit unreached notice, and carries
 * `data-dryrun="unreached"` - so a spec that hits the slow path now FAILS
 * loudly instead of asserting against a false pass. Warming is still the right
 * move: a spec that waits and hopes is a coin flip on this venue.
 *
 * The lever is that the indexer MEMOIZES the verdict per block height
 * , which is measurable: the same query costs seconds cold and ~10ms
 * warm. So this asks the endpoint for exactly what the wallet is about to ask
 * it - same action, same params, same source, same query shape as
 * `explorer.getPreflight` - until the answer comes back warm.
 *
 * It does NOT weaken what the spec proves. The wallet still composes the
 * action itself, still calls the endpoint itself, and still has to relay the
 * verdict to the panel; all this removes is the stopwatch. And it adds teeth
 * of its own: the returned verdict lets a spec assert the VENUE agrees with
 * its premise, so an unaffordable send that the indexer happens to consider
 * valid fails here, naming the venue, instead of failing later as a confusing
 * assertion about missing panel text.
 *
 * The memo is keyed by block height, so warm and use it in the same breath -
 * a block landing in between (this venue mines on demand AND on a timer)
 * puts the next call back on the cold path.
 *
 * @param {{action: string, params: string, source: string}} query
 * @returns {Promise<object>} the endpoint's own response body
 */
export async function warmPreflight({ action, params, source }, timeoutMs = 120_000) {
    // Built exactly as `explorer.getPreflight` builds it - a query that
    // differs from the wallet's is a different memo entry, which would warm
    // nothing and quietly restore the race this exists to remove.
    const q = new URLSearchParams();
    q.set('action', action);
    q.set('params', params);
    q.set('source', source);
    const url = `${EXPLORER_URL}/${REGTEST_COIN}/api/preflight?${q.toString()}`;

    const deadline = Date.now() + timeoutMs;
    let last = null;
    let lastMs = null;
    while (Date.now() < deadline) {
        const started = Date.now();
        let body = null;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
            body = await res.json();
        } catch {
            // The explorer blipping mid-block is transient; keep trying until
            // the budget runs out rather than reporting it as a slow dry-run.
            await new Promise((r) => setTimeout(r, 2_000));
            continue;
        }
        lastMs = Date.now() - started;
        last = body;
        if (lastMs <= PREFLIGHT_WARM_MS) return last;
        // Straight back round: the point of the second call is that it hits
        // the memo the first one populated.
    }
    throw new Error(
        `pre-flight for ${action} never answered within ${PREFLIGHT_WARM_MS}ms `
        + `(last ${lastMs}ms). The indexer dry-run is too slow for the SDK's 4000ms `
        + `Tier-1 budget on this venue, so the wallet would drop the verdict. `
        + `This is venue load, not a wallet defect - last response: ${JSON.stringify(last)}`);
}

/**
 * Makes the next broadcast fail, with a chosen node reject reason.
 *
 * §8.6 scenarios 3 and 4 hinge on the wallet CLASSIFYING a post-sign
 * broadcast failure correctly: a transient one keeps the signed
 * transaction recoverable and queued, a permanent one marks it failed and
 * demands a re-compose. Getting a real node to produce each reason on
 * demand is not something a test can do reliably - a doomed transaction
 * needs its inputs spent out from under it by someone else - so the
 * reject string is injected at the encoder's `broadcast_tx` boundary
 * instead.
 *
 * What is simulated is only the node's ANSWER. Everything before it is
 * real: a real compose, a real tamper check, a real signature over the
 * real PSBT, and the wallet's real classification path. The strings used
 * are the node's own (`bad-txns-inputs-missingorspent`, ECONNREFUSED).
 *
 * Only `broadcast_tx` is intercepted - `create_tx` and `get_utxos` share
 * this endpoint and must keep working, or the send would never get far
 * enough to broadcast at all.
 */
export async function failBroadcast(page, kind) {
    const reason = kind === 'permanent'
        ? 'bad-txns-inputs-missingorspent'
        : 'connect ECONNREFUSED 127.0.0.1:3023';

    await page.route(`${ENCODER_URL}/**`, async (route) => {
        const body = route.request().postData() || '';
        if (!body.includes('"broadcast_tx"')) return route.continue();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                error: { code: -32010, message: reason, data: { reason } },
            }),
        });
    });
}

/**
 * Asserts the chain recorded NO XChain action for `txid`.
 *
 * : a plain native-coin payment must be an ordinary payment. It used
 * to carry a `SEND|0|BTC|...` OP_RETURN that the indexer could only ever
 * record as `invalid: TICK (unknown)`, so "did an action get written?" is
 * the question that actually distinguishes the fix from the bug - a
 * spec that only checked the money arrived passed happily either way.
 */
export async function assertNoActionRecorded(txid) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/actions?limit=200`, {
        signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : [];
    // An empty list would make this assertion vacuous - it would "pass" on a
    // dead explorer just as readily as on a correct payment.
    expect(rows.length, 'explorer returned no actions at all; cannot conclude anything').toBeGreaterThan(0);
    const match = rows.find((r) => r.tx_hash === txid);
    expect(match, `an XChain action was recorded for a plain payment: ${JSON.stringify(match)}`)
        .toBeUndefined();
}

/**
 * Waits for the chain's own verdict on the action carried by `txid`, and
 * asserts it is `valid`.
 *
 * The counterpart of `assertNoActionRecorded`, and the independent half of
 * any token-action assertion: "Broadcast pending" is the wallet reporting on
 * itself, and even a confirmed transaction says nothing about whether the
 * indexer ACCEPTED the action inside it. An action the handler rejects is
 * recorded with a non-`valid` status and the money simply does not move - a
 * spec that stopped at the txid would pass on that.
 *
 * Mines while it waits: the indexer only records an action once its block
 * lands, and the regtest miner's own timer is too slow to wait out.
 *
 * The default budget is deliberately generous. Mining is instant but INDEXING
 * is not, and on a busy shared venue the indexer can run minutes behind the
 * chain tip - at which point "no action recorded" means "not indexed yet", not
 * "the wallet sent something wrong". A 120s budget failed exactly that way
 * while the action in question was sitting on chain, so the timeout message
 * now reports the lag rather than leaving the next reader to guess.
 */
export async function waitForValidAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await minerRpc('generate_blocks', { count: 1 });
        // limit=100 because that is the explorer's REAL page cap: it silently
        // clamps anything larger, so asking for 200 bought imaginary headroom.
        // The list is newest-first, so one page is ample for an action just
        // broadcast - the risk here was never page depth, it was lag.
        const list = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/actions?limit=100`, {
            signal: AbortSignal.timeout(15_000),
        }).then((r) => r.json()).catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) {
            const detail = await fetch(
                `${EXPLORER_URL}/${REGTEST_COIN}/api/action/${row.action_index}`,
                { signal: AbortSignal.timeout(15_000) },
            ).then((r) => r.json());
            // Assert on the status rather than merely on presence: `invalid:
            // insufficient funds` is also "an action was recorded".
            for (const status of actionStatuses(detail)) {
                expect(status, `chain rejected the action for ${txid}`).toBe('valid');
            }
            return detail;
        }
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/status`, {
        signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json()).catch(() => null);
    throw new Error(
        `No XChain action recorded for ${txid} within ${Math.round(timeoutMs / 1000)}s. `
        + `Chain tip ${status?.chain_tip?.[REGTEST_COIN]}, indexer lag `
        + `${status?.chain_lag_blocks?.[REGTEST_COIN]}, decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}. A non-zero lag means the `
        + `venue is behind, not that the wallet sent something wrong.`,
    );
}

/**
 * Every status an action detail exposes, across both shapes the explorer
 * uses.
 *
 * Single-leg actions (DISPENSER, ISSUE, ...) carry one top-level `status`.
 * A SEND does not: its verdict lives per transfer leg in `sends[]`, because
 * one action can move several ticks and the handler judges each. Asking only
 * for `detail.status` on a SEND reads `undefined`, which is why this throws
 * on finding nothing rather than returning an empty list - a caller looping
 * over zero statuses asserts nothing and passes.
 */
function actionStatuses(detail) {
    const statuses = [];
    if (typeof detail.status === 'string') statuses.push(detail.status);
    for (const leg of Array.isArray(detail.sends) ? detail.sends : []) {
        if (typeof leg.status === 'string') statuses.push(leg.status);
    }
    if (statuses.length === 0) {
        throw new Error(
            `action ${detail.action_index} (${detail.action}) exposed no status; `
            + `keys: ${Object.keys(detail).join(',')}`,
        );
    }
    return statuses;
}

/**
 * Points one of a form's chain pickers at the chain this run drives.
 *
 * A no-op on Bitcoin, which every form already defaults to, so specs written
 * before the venue table behave exactly as they did.
 *
 * `field` is the picker's own visible label, and it is REQUIRED to be specific
 * because several screens carry more than one: a form's is "Network", the
 * add-address modal's is "Coin", a cross-chain swap has "Give chain" and "Get
 * chain". Addressing them by accessible name is possible at all because
 * ChainPicker now puts its label in that name; before that fix every picker on
 * a screen answered to the same query, which is a defect for a screen reader
 * user and was a coin flip for this helper.
 *
 * @param {import('@playwright/test').Page | import('@playwright/test').Locator} scope
 * @param {string} [field]  the picker's visible label
 */
export async function selectVenueChain(scope, field = 'Network') {
    if (REGTEST_COIN === 'RBTC') return;

    const trigger = scope.getByRole('button', { name: new RegExp(`^${field}:`) }).first();
    await expect(trigger, `no "${field}" chain picker on this screen`)
        .toBeVisible({ timeout: 30_000 });
    if (((await trigger.getAttribute('aria-label')) || '').includes(REGTEST_CHAIN_LABEL)) return;

    await trigger.click();
    await scope.getByRole('option', { name: new RegExp(`^${REGTEST_CHAIN_LABEL}\\b`) })
        .first().click();
    // Assert the switch took: the picker closes on click whether or not the
    // option was the one intended, so an unasserted click is a silent
    // wrong-chain run - the exact failure this helper exists to prevent.
    await expect(trigger).toHaveAttribute('aria-label', new RegExp(REGTEST_CHAIN_LABEL),
        { timeout: 15_000 });
}

/**
 * Mints `amount` XCHAIN to the active address and waits for the balance.
 *
 * XCHAIN is free-mintable on regtest and testnet by any address, so this is
 * how a freshly-created wallet gets a TOKEN balance - which several §8.6
 * scenarios need, because the parts of the confirm system that only apply to
 * XChain actions (pre-flight, the §4.7 reservation) are exactly the parts a
 * native-coin send skips.
 *
 * Driven through the command palette's Advanced action -> MINT rather than
 * the friendly Mint form, which is balance-scoped and will not offer a tick
 * the wallet holds none of.
 */
export async function mintXchain(page, amount) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox').first();
    await expect(combobox).toBeVisible();
    await combobox.fill('Advanced action');
    await page.keyboard.press('Enter');

    // Every form defaults to whichever chain the wallet lists first, which is
    // Bitcoin; on any other venue the mint would land on the wrong chain and
    // the balance this helper promises would never appear.
    await selectVenueChain(page);

    await page.getByLabel('Action').selectOption('MINT');
    await page.getByRole('textbox', { name: 'TICK', exact: true }).fill('XCHAIN');
    await page.getByRole('textbox', { name: 'AMOUNT', exact: true }).fill(String(amount));
    await page.getByRole('button', { name: 'Sign action' }).click();

    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await page.getByTestId('confirm-approve').click();
    // The advanced-action flow has its own terminal screen; rather than
    // couple to it, wait on the thing that actually matters downstream - the
    // on-chain balance, below.
    await page.waitForTimeout(4_000);
}

/**
 * The XCHAIN balance `address` holds right now, as a number (0 when the
 * explorer carries no row for it at all).
 *
 * A plain read with no waiting and no mining, which is what a BEFORE/AFTER
 * assertion needs: the interesting question for a multi-leg send is not "did
 * the balance reach N" but "did it move by exactly the leg amount", and a
 * helper that waits for a threshold cannot answer that.
 *
 * @param {string} address
 * @param {string} tick
 * @returns {Promise<number>}
 */
export async function tokenBalance(address, tick) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/balances/${address}`, {
        signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    const row = (body?.data || []).find((b) => b.tick === tick);
    return row ? Number(row.amount) : 0;
}

/**
 * Mines one block, but ONLY while the decode/index pipeline is keeping up.
 *
 * Promoted from the BET round-trip spec, which found the hazard the hard way:
 * a poll loop that mines unconditionally outruns the decoder, so the state it
 * is waiting for never indexes and the loop responds by mining harder. One run
 * left the decoder 157 blocks behind the node with every balance read empty,
 * which presents as "the wallet's action vanished" and is really the harness
 * flooding the venue. Blocks are only ever needed to ADVANCE state, never to
 * make an already-mined action visible, so skipping the mine while the pipeline
 * catches up costs nothing.
 *
 * Never throws: a poll loop must keep polling when the status read blips.
 */
export async function nudgeChain() {
    try {
        const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/status`, {
            signal: AbortSignal.timeout(10_000),
        });
        const status = await res.json();
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* the venue check in global setup reports real unreachability */ }
}

/**
 * Polls the explorer until `address` holds at least `min` of `tick`.
 *
 * Mines on each pass for the same reason `fundAddress` does: the wallet and
 * the indexer both only see confirmed state, and waiting on the miner's own
 * timer turns every balance-dependent spec into an intermittent failure that
 * reads like a wallet bug.
 */
export async function waitForTokenBalance(address, tick, min, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/balances/${address}`, {
                signal: AbortSignal.timeout(15_000),
            });
            const body = await res.json();
            const row = (body?.data || []).find((b) => b.tick === tick);
            last = row ? row.amount : null;
            if (row && Number(row.amount) >= min) return row;
        } catch { /* transient while a block lands */ }
        await minerRpc('generate_blocks', { count: 1 });
        await new Promise((r) => setTimeout(r, 1_500));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
}

/**
 * Flips the wallet onto the regtest network and waits for it to come
 * back up.
 *
 * Two venue facts are baked in here because both cost a debugging
 * session to find:
 *   - Regtest chains are HIDDEN until Developer Mode is on
 *     (NetworkSection deliberately filters the option), so dev mode has
 *     to be enabled first.
 *   - The network control is an inline `kind: 'panel'` section on the
 *     Settings index (a `<select aria-label="Active network">`), NOT a
 *     drill row like Developer Mode.
 *
 * The switch reloads the page (NetworkSection does this on purpose so
 * chain-scoped effects re-derive), and a reload re-locks the vault, so
 * this unlocks again before returning.
 */
export async function switchToRegtest(page, password) {
    // One UI walk for every shell. `openSettings` absorbs the only difference:
    // web/desktop navigate, the MV3 popup goes through the command palette
    // because it has no nav surface .
    await openSettings(page);

    await page.getByRole('button', { name: /^Developer Mode/ }).click();
    const devToggle = page.getByRole('switch', { name: 'Developer Mode', exact: true });
    await expect(devToggle).toBeVisible();
    if (!(await devToggle.isChecked())) {
        // `.check()` fails here: the input is fully controlled by PERSISTED
        // settings, so its `checked` does not flip until the vault write
        // resolves, and check()'s post-click assertion is synchronous.
        // Click, then wait for the state the write produces.
        await devToggle.click();
        await expect(devToggle).toBeChecked();
    }
    await page.getByRole('button', { name: 'Back to settings' }).click();

    // : this select now derives an address on each chain of the
    // network it switches to. Before that fix it only moved a filter,
    // stranding the wallet with no addresses and no UI path to make one -
    // so if this ever regresses, the funding step below is where it shows.
    await page.getByLabel('Active network').selectOption('regtest');

    await unlockAfterReload(page, password);
}

/**
 * Waits out the post-switch reload and unlocks.
 *
 * Kept separate because every `goto`/reload in a regtest spec needs it:
 * the vault does not survive a page load.
 */
export async function unlockAfterReload(page, password) {
    const unlock = page.getByRole('button', { name: 'Unlock Wallet' });

    // Wait for whichever side of the fork this shell lands on. The extension
    // keeps its session master key in `chrome.storage.session`, which SURVIVES
    // a popup reload, so it comes back already unlocked; the web shell holds
    // it in memory and re-locks. Waiting only for the unlock screen hangs for
    // 60s in the extension on a wallet that is fine.
    await unlock.or(unlockedShell(page)).first()
        .waitFor({ state: 'visible', timeout: 60_000 });

    if (await unlock.count() === 0) return;

    await page.getByLabel('Password').fill(password);
    await unlock.click();
    // Home's balance hero, not the Lock button: the popup renders no nav at
    // all, and below 600px Lock sits inside the closed More sheet.
    await expect(unlockedShell(page)).toBeVisible({ timeout: 90_000 });
}

/**
 * Reads the wallet's own regtest receive address off the Receive screen.
 *
 * This is the only way to learn it: addresses derive from a random seed
 * at wallet creation, so the spec cannot know it in advance.
 */
export async function readReceiveAddress(page) {
    await gotoSection(page, 'Receive');

    const field = page.getByLabel('Address', { exact: true });
    await expect(field).toBeVisible({ timeout: 30_000 });
    await expect(field).toHaveValue(REGTEST_ADDRESS_RE, { timeout: 30_000 });
    return field.inputValue();
}
