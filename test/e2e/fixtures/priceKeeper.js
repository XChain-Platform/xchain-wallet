// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// priceKeeper: hold the venue's oracle price alive for the WHOLE run, not just
// for its first minute.
//
// WHY THIS EXISTS, measured 2026-08-27 on the second whole-suite Litecoin run.
// The price is seeded once in global setup and repaired after that only by the
// handful of `dispensers/` specs that call `seedPrices()` for reasons of their
// own. A 1.9-hour suite therefore spends its first ~25 tests on whatever chain
// life the setup seed had left, and run 2 went stale inside that band: FIVE of
// its nine failures carry "The LTC fee price is temporarily unavailable" on
// screen (`contracts/deploy-chunked-lane` twice, `dex/market-view` twice,
// `dex/order-autopay-arming`), and the venue's own words behind that sentence,
// read out of the failure trace, are `invalid: no current oracle price for
// LTC/USD (missing or stale beyond 1800s)`. The band ends at the first
// `dispensers/` spec, which re-seeds for everybody downstream by accident.
//
// So which specs pass depends on their alphabetical distance from the last spec
// that happened to re-seed. That is why runs 1 and 2 disagreed in BOTH
// directions over the same specs, and why "green alone, red under load" kept
// being read as a load problem: a spec run on its own is one test away from the
// setup seed and can hardly fail this way.
//
// The margin is spent in CHAIN seconds and a chain that mines on demand can
// burn 20,000 of them in one block (see `seedMarginSeconds`), so no starting
// margin is large enough to make a one-shot seed safe. Re-checking on a wall
// clock cadence is the only shape that survives a jump.

import { MIN_SEED_MARGIN_SECONDS } from './priceSeed.js';

/**
 * How often to re-ask. Short relative to the 900s (`MIN_SEED_MARGIN_SECONDS`)
 * cushion `seedPrices` refuses to go below, so a clock jump is caught with the
 * cushion still intact rather than after the window has already closed.
 */
export const DEFAULT_KEEP_INTERVAL_MS = 60_000;

/**
 * The keeper's decision half, with the venue injected so it can be driven in
 * milliseconds instead of against a live chain.
 *
 * @param {object}   deps
 * @param {Function} deps.seed   `seedPrices`-shaped: resolves `{ seeded, marginSeconds }`
 *                               and decides for itself whether a write is needed.
 * @param {Function} [deps.log]
 * @param {Function} [deps.warn]
 */
export function createPriceKeeper({ seed, log = () => {}, warn = () => {} } = {}) {
    if (typeof seed !== 'function') {
        throw new Error('createPriceKeeper: seed must be a function');
    }

    const stats = { ticks: 0, reseeds: 0, failures: 0, skipped: 0 };
    let inFlight = false;
    let failing = false;

    async function tick() {
        // Seeding writes price rows into the indexer over SSH. Two writes in
        // flight at once is the one way this helper could damage the venue it
        // exists to protect, so an overrun tick is DROPPED rather than queued:
        // the next cadence is a minute away and the margin it guards is 900
        // seconds wide.
        if (inFlight) {
            stats.skipped += 1;
            return { acted: false, reason: 'busy' };
        }
        inFlight = true;
        stats.ticks += 1;
        try {
            const result = await seed();
            failing = false;
            if (result && result.seeded) {
                stats.reseeds += 1;
                // Always spoken, never de-duplicated: a re-seed mid-run is the
                // single fact that explains why a fee number or a confirm-modal
                // failure changed between two runs of the same suite.
                log(`[price keeper] refreshed the venue price mid-run (re-seed #${stats.reseeds}`
                    + `, tick ${stats.ticks})`);
                return { acted: true, reason: 'reseeded', result };
            }
            return { acted: false, reason: 'healthy', result };
        } catch (err) {
            stats.failures += 1;
            // Spoken ONCE per run of consecutive failures. A keeper that cannot
            // reach the venue would otherwise print every minute into the run
            // log this campaign reads by grepping for failure positions, and
            // burying that is a real cost. A later healthy tick re-arms it, so
            // a second outage is not swallowed by the first.
            if (!failing) {
                failing = true;
                warn(`[price keeper] could not refresh the venue price: ${err?.message || err}. `
                    + 'The run continues; a fee-bearing step may refuse with "the fee price is '
                    + 'temporarily unavailable", which is this and not the wallet.');
            }
            return { acted: false, reason: 'failed', error: err };
        } finally {
            inFlight = false;
        }
    }

    return { tick, stats };
}

/**
 * Start the keeper on a real timer and hand back the stopper.
 *
 * Deliberately thin: everything worth testing lives in `createPriceKeeper`, and
 * this half is a timer plus an `unref` so a pending tick can never hold
 * Playwright's process open after the last spec.
 *
 * @returns {{ stop: () => object }} `stop()` returns the run's keeper stats.
 */
export function startPriceKeeper({ seed, log, warn, intervalMs = DEFAULT_KEEP_INTERVAL_MS } = {}) {
    const keeper = createPriceKeeper({ seed, log, warn });
    const timer = setInterval(() => { void keeper.tick(); }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    return {
        stop() {
            clearInterval(timer);
            return keeper.stats;
        },
    };
}

export { MIN_SEED_MARGIN_SECONDS };
