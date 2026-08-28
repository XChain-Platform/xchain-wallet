// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: test/e2e/fixtures/priceKeeper.js - the mid-run venue price keeper.
//
// Test infrastructure testing test infrastructure, and it earns its keep the
// same way `e2e-venue-verdict.test.js` does: the condition it guards takes an
// hour of live suite to reproduce and cost this campaign two whole-suite runs
// that disagreed with each other. Driving the decisions here takes
// milliseconds, and the venue is a single shared stack that other sessions run
// on.
//
// The seed is injected, so every case below is the real decision path with a
// fake venue behind it.

import { describe, it, expect } from 'vitest';
import { createPriceKeeper, DEFAULT_KEEP_INTERVAL_MS, MIN_SEED_MARGIN_SECONDS }
    from '../e2e/fixtures/priceKeeper.js';

/** A `seedPrices`-shaped result for a venue that still has life in it. */
const HEALTHY = { seeded: false, reason: 'venue already priced', marginSeconds: 1500 };
/** The same call when it found the margin thin and wrote a fresh round. */
const RESEEDED = { seeded: true, reason: 'seeded', marginSeconds: 1795, oracleRound: 888100013 };

function collector() {
    const lines = [];
    return { lines, sink: (m) => lines.push(String(m)) };
}

describe('createPriceKeeper: the decisions', () => {
    it('refuses to be built without a venue to seed', () => {
        expect(() => createPriceKeeper({})).toThrow(/seed must be a function/);
    });

    it('says nothing on a healthy tick, because the run log is read by grep', async () => {
        const log = collector();
        const warn = collector();
        const keeper = createPriceKeeper({ seed: async () => HEALTHY, log: log.sink, warn: warn.sink });

        const out = await keeper.tick();

        expect(out.acted).toBe(false);
        expect(out.reason).toBe('healthy');
        expect(log.lines, 'a keeper that narrates every minute buries the failure positions')
            .toEqual([]);
        expect(warn.lines).toEqual([]);
        expect(keeper.stats).toMatchObject({ ticks: 1, reseeds: 0, failures: 0, skipped: 0 });
    });

    it('ALWAYS speaks when it re-seeds, since that is what explains a changed run', async () => {
        const log = collector();
        const keeper = createPriceKeeper({ seed: async () => RESEEDED, log: log.sink });

        await keeper.tick();
        await keeper.tick();

        expect(keeper.stats.reseeds).toBe(2);
        expect(log.lines).toHaveLength(2);
        expect(log.lines[0]).toMatch(/refreshed the venue price mid-run/);
        // The counters ride in the line so a later reader can place the re-seed
        // against the [N/111] markers around it without a second source.
        expect(log.lines[1]).toMatch(/re-seed #2, tick 2/);
    });
});

describe('the failure a keeper must survive: it is a helper, not a gate', () => {
    it('never throws into the run, and names itself as the cause of the sentence it prevents', async () => {
        const warn = collector();
        const keeper = createPriceKeeper({
            seed: async () => { throw new Error('ssh: connect to host regtest-host port 22: timed out'); },
            warn: warn.sink,
        });

        const out = await keeper.tick();

        expect(out.reason).toBe('failed');
        expect(keeper.stats.failures).toBe(1);
        expect(warn.lines[0]).toMatch(/could not refresh the venue price: ssh: connect/);
        expect(warn.lines[0], 'the whole point is that a reader stops blaming the wallet')
            .toMatch(/temporarily unavailable.*this and not the wallet/s);
    });

    it('warns ONCE across a run of failures, then re-arms after a healthy tick', async () => {
        const warn = collector();
        let mode = 'fail';
        const keeper = createPriceKeeper({
            seed: async () => {
                if (mode === 'fail') throw new Error('venue unreachable');
                return HEALTHY;
            },
            warn: warn.sink,
        });

        await keeper.tick();
        await keeper.tick();
        await keeper.tick();
        expect(warn.lines, 'three failed ticks are one outage, not three').toHaveLength(1);

        mode = 'ok';
        await keeper.tick();
        mode = 'fail';
        await keeper.tick();
        expect(warn.lines, 'a SECOND outage after a recovery must not be swallowed by the first')
            .toHaveLength(2);
        expect(keeper.stats).toMatchObject({ ticks: 5, failures: 4 });
    });
});

describe('overrun: the one way this helper could damage the venue it protects', () => {
    it('drops a tick that lands while a seed is still writing, rather than queueing it', async () => {
        let release;
        let calls = 0;
        const gate = new Promise((resolve) => { release = resolve; });
        const keeper = createPriceKeeper({
            seed: async () => { calls += 1; await gate; return RESEEDED; },
        });

        const first = keeper.tick();
        const second = await keeper.tick();

        expect(second, 'a second SSH write into the price table must never start')
            .toMatchObject({ acted: false, reason: 'busy' });
        expect(calls).toBe(1);
        expect(keeper.stats.skipped).toBe(1);

        release();
        await first;

        // And the gate lifts: the NEXT cadence runs normally rather than the
        // keeper wedging itself shut after one slow seed.
        const third = await keeper.tick();
        expect(third.acted).toBe(true);
        expect(calls).toBe(2);
    });
});

describe('the cadence', () => {
    it('re-asks well inside the cushion seedPrices refuses to go below', () => {
        // A jump is caught with the 900s cushion still intact instead of after
        // the 1800s window has already closed, which is the whole failure this
        // module exists for.
        expect(DEFAULT_KEEP_INTERVAL_MS / 1000).toBeLessThan(MIN_SEED_MARGIN_SECONDS / 4);
    });
});
