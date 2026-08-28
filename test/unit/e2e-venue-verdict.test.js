// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: test/e2e/fixtures/venueHealth.js - the pre-flight venue verdict.
//
// Test infrastructure testing test infrastructure, and it earns its keep for a
// specific reason: the venue states this guard exists to catch appear on the
// shared dev stack once every few weeks and NEVER on demand. Waiting for the
// next wedge to find out whether the guard fires is how the last one cost a
// day. So the sick payloads are recorded here, verbatim from `/api/status` on
// the day each outage happened, and the guard is driven against them in
// milliseconds.
//
// Both bodies are real. Do not "tidy" the numbers: the whole point of the
// RDOGE one is the contradiction between `chain_lag_blocks: 0` and an 89-block
// gap between `chain_tip` and `last_block`, and an edited payload would let a
// future simplification of the guard pass while re-opening the hole.

import { describe, it, expect } from 'vitest';
import {
    RATE_LIMIT_WINDOW_MS,
    createOutageWatch,
    probeVerdict,
    rateLimitDelayMs,
    venueVerdict,
} from '../e2e/fixtures/venueHealth.js';

// Recorded 2026-08-27: all three chains as the explorer reported them, with
// RLTC healthy and RBTC's decoder crash-looping on a REORG_HALT marker.
const STATUS_2026_08_27 = {
    chain_lag_blocks: { RBTC: null, RDOGE: 0, RLTC: 0 },
    chain_tip: { RBTC: null, RDOGE: 2829, RLTC: 6117 },
    decoder_health: { RBTC: 'unreachable', RDOGE: 'healthy', RLTC: 'healthy' },
    decoder_lag_blocks: { RBTC: 0, RDOGE: 0, RLTC: 0 },
    decoder_tip: { RBTC: 14677, RDOGE: 2829, RLTC: 6117 },
    last_block: { RBTC: 14677, RDOGE: 2829, RLTC: 6117 },
};

// Recorded 2026-08-11, the wedge this guard was written for. Note what the
// endpoint says about itself: zero lag, decoder at the tip, and an indexed
// height 89 blocks short of that tip.
const STATUS_WEDGED_RDOGE = {
    chain_lag_blocks: { RDOGE: 0 },
    chain_tip: { RDOGE: 2153 },
    decoder_health: { RDOGE: 'healthy' },
    decoder_lag_blocks: { RDOGE: 0 },
    decoder_tip: { RDOGE: 2153 },
    last_block: { RDOGE: 2064 },
};

describe('venueVerdict', () => {
    describe('the venue that is fit to run on', () => {
        it('passes RLTC on the real 2026-08-27 body', () => {
            expect(venueVerdict(STATUS_2026_08_27, 'RLTC')).toBeNull();
        });

        it('passes a chain that is one block behind, because that is a normal race', () => {
            const body = {
                chain_lag_blocks: { RLTC: 1 }, chain_tip: { RLTC: 6118 },
                decoder_health: { RLTC: 'healthy' }, last_block: { RLTC: 6117 },
            };
            expect(venueVerdict(body, 'RLTC')).toBeNull();
        });

        it('passes when the explorer publishes no decoder_health at all', () => {
            // Forward compatibility in the safe direction: an older explorer
            // that predates the field must not become permanently unusable.
            const body = {
                chain_lag_blocks: { RLTC: 0 }, chain_tip: { RLTC: 10 }, last_block: { RLTC: 10 },
            };
            expect(venueVerdict(body, 'RLTC')).toBeNull();
        });
    });

    describe('THE WEDGE - the case chain_lag_blocks cannot see', () => {
        it('refuses the real 2026-08-11 RDOGE body, which reports zero lag', () => {
            const reason = venueVerdict(STATUS_WEDGED_RDOGE, 'RDOGE');
            expect(reason).not.toBeNull();
            // The reader has to be told it is a WEDGE and not a wait, because
            // the remedy differs: one is patience, the other is an ops act.
            expect(reason).toMatch(/WEDGED/);
            // Both heights and the contradicting field, so nobody has to take
            // the guard's word for it.
            expect(reason).toContain('2153');
            expect(reason).toContain('2064');
            expect(reason).toContain('89 blocks behind');
            expect(reason).toContain('chain_lag_blocks reports 0');
        });

        it('tolerates a 2-block gap and refuses a 3-block one', () => {
            const at = (indexed) => venueVerdict({
                chain_lag_blocks: { RLTC: 0 }, chain_tip: { RLTC: 100 },
                decoder_health: { RLTC: 'healthy' }, last_block: { RLTC: indexed },
            }, 'RLTC');
            expect(at(98)).toBeNull();
            expect(at(97)).toMatch(/WEDGED/);
        });

        it('does not invent a wedge when the explorer omits a height', () => {
            const body = {
                chain_lag_blocks: { RLTC: 0 }, chain_tip: { RLTC: null },
                decoder_health: { RLTC: 'healthy' }, last_block: { RLTC: 6117 },
            };
            expect(venueVerdict(body, 'RLTC')).toBeNull();
        });
    });

    describe('THE DEAD DECODER - checked first, because it poisons every other field', () => {
        it('refuses RBTC on the real 2026-08-27 body and names the health string', () => {
            const reason = venueVerdict(STATUS_2026_08_27, 'RBTC');
            expect(reason).toContain('unreachable');
            // And specifically NOT the tunnel-shaped message: RBTC's
            // chain_lag_blocks is null on this body, so the old ordering would
            // have answered "reports no RBTC chain" and sent the reader to
            // check an ssh tunnel that was never the problem.
            expect(reason).not.toMatch(/reports no RBTC chain/);
            expect(reason).toMatch(/not a wallet defect/);
        });

        it('outranks a wedge on the same body', () => {
            const body = {
                chain_lag_blocks: { RLTC: 0 }, chain_tip: { RLTC: 100 },
                decoder_health: { RLTC: 'halted' }, last_block: { RLTC: 1 },
            };
            expect(venueVerdict(body, 'RLTC')).toMatch(/halted/);
        });
    });

    describe('the venue that is merely behind', () => {
        it('asks the caller to wait when the lag is real and the heights agree', () => {
            const body = {
                chain_lag_blocks: { RLTC: 9 }, chain_tip: { RLTC: 100 },
                decoder_health: { RLTC: 'healthy' }, last_block: { RLTC: 100 },
            };
            expect(venueVerdict(body, 'RLTC')).toMatch(/9 blocks behind; wait/);
        });

        it('reports an absent chain rather than throwing on an empty body', () => {
            expect(venueVerdict({}, 'RLTC')).toMatch(/reports no RLTC chain/);
            expect(venueVerdict(undefined, 'RLTC')).toMatch(/reports no RLTC chain/);
        });
    });
});

// The MID-RUN half. `venueVerdict` guards the start of a run; these two guard a
// poll loop, which is where a venue that disappears actually costs budget. The
// outage recorded here is 2026-08-27: the shared explorer container was
// recreated mid-session, /api/status stopped answering for about six minutes,
// and it came back healthy on its own (RestartCount 0). The in-flight spec
// noticed nothing and spent 13 minutes waiting.
describe('probeVerdict: the venue seen from inside a poll', () => {
    it('names a hang-up as a hang-up, and points at the container as well as the tunnel', () => {
        // What fetch throws when a tunnel's local listener accepts and the
        // forwarded service is gone. curl reports this as HTTP 000.
        const said = probeVerdict({ error: new TypeError('fetch failed') }, 'RLTC');
        expect(said).toMatch(/stopped answering mid-run/);
        expect(said).toMatch(/fetch failed/);
        expect(said, 'a hang-up must not be described as a refusal').not.toMatch(/refused/i);
        expect(said).toMatch(/container/);
    });

    it('separates a venue serving errors from a venue that is gone', () => {
        expect(probeVerdict({ httpStatus: 502 }, 'RLTC')).toMatch(/HTTP 502 mid-run/);
        expect(probeVerdict({ httpStatus: 500 }, 'RLTC')).toMatch(/the venue, not the wallet/);
    });

    it('falls through to the pre-flight verdict when the venue is answering', () => {
        expect(probeVerdict({ httpStatus: 200, body: STATUS_2026_08_27 }, 'RLTC')).toBeNull();
        expect(probeVerdict({ httpStatus: 200, body: STATUS_2026_08_27 }, 'RBTC'))
            .toMatch(/decoder reports "unreachable"/);
    });
});

describe('createOutageWatch: notice it, then name it', () => {
    const gone = { error: new Error('socket hang up') };
    const well = { httpStatus: 200, body: STATUS_2026_08_27 };

    it('tolerates a blip, because the real outage healed itself', () => {
        const watch = createOutageWatch({ toleranceMs: 60_000 });
        expect(watch.observe(gone, 1_000, 'RLTC'), 'the first miss must not abort a run').toBeNull();
        expect(watch.observe(gone, 30_000, 'RLTC'), 'still inside the window').toBeNull();
        expect(watch.observe(well, 40_000, 'RLTC')).toBeNull();
    });

    it('fails once the venue has been gone longer than the window, and says how long', () => {
        const watch = createOutageWatch({ toleranceMs: 60_000 });
        expect(watch.observe(gone, 1_000, 'RLTC')).toBeNull();
        const said = watch.observe(gone, 91_000, 'RLTC');
        expect(said, 'a venue gone for 90s must not be waited out silently').toBeTruthy();
        expect(said).toMatch(/stopped answering mid-run/);
        expect(said).toMatch(/90s/);
    });

    it('CLEARS the window on recovery, so one spec cannot fail on the previous one outage', () => {
        const watch = createOutageWatch({ toleranceMs: 60_000 });
        watch.observe(gone, 1_000, 'RLTC');
        watch.observe(well, 2_000, 'RLTC');
        // Sick again much later: the clock restarts from HERE, not from 1_000.
        expect(watch.observe(gone, 500_000, 'RLTC'), 'recovery must reset the window').toBeNull();
        expect(watch.observe(gone, 530_000, 'RLTC')).toBeNull();
        expect(watch.observe(gone, 600_000, 'RLTC')).toBeTruthy();
    });

    it('carries a WEDGE through the same window, not just a dead socket', () => {
        const watch = createOutageWatch({ toleranceMs: 10_000 });
        const wedged = { httpStatus: 200, body: STATUS_WEDGED_RDOGE };
        expect(watch.observe(wedged, 0, 'RDOGE')).toBeNull();
        expect(watch.observe(wedged, 20_000, 'RDOGE')).toMatch(/WEDGED/);
    });
});

// The shared explorer's rate limit, and the reason a fixture has to
// know about it. `RateLimit-Limit: 120` / `RateLimit-Policy: 120;w=60` sit in
// the headers of every explorer response; three long `tokens/` specs crossed
// that limit while the wallet was reading the same explorer, and every one of
// them reported a locator timeout with the 429 nowhere in sight.
describe('rateLimitDelayMs', () => {
    const headers = (obj) => new Headers(obj);

    it('says nothing at all about a response that is not a rate limit', () => {
        expect(rateLimitDelayMs(200, headers({}))).toBeNull();
        expect(rateLimitDelayMs(500, headers({ 'retry-after': '5' })),
            'a 500 carrying a stray Retry-After is still not a rate limit').toBeNull();
    });

    it('waits what the venue asks, in the venue own units', () => {
        expect(rateLimitDelayMs(429, headers({ 'retry-after': '7' }))).toBe(7_000);
        expect(rateLimitDelayMs(429, headers({ 'ratelimit-reset': '12' }))).toBe(12_000);
    });

    it('prefers Retry-After when the venue sends both', () => {
        expect(rateLimitDelayMs(429, headers({ 'retry-after': '3', 'ratelimit-reset': '40' })))
            .toBe(3_000);
    });

    it('falls back to the advertised window rather than to a guess', () => {
        expect(rateLimitDelayMs(429, headers({}))).toBe(RATE_LIMIT_WINDOW_MS);
        expect(rateLimitDelayMs(429, headers({ 'retry-after': 'soon' })),
            'a garbage header must not become NaN milliseconds').toBe(RATE_LIMIT_WINDOW_MS);
    });

    it('treats a zero as the real answer it is, not as a missing header', () => {
        expect(rateLimitDelayMs(429, headers({ 'retry-after': '0' })),
            'the window has just rolled: ask again now').toBe(0);
    });

    it('caps a hostile header so one response cannot park a spec for its whole budget', () => {
        expect(rateLimitDelayMs(429, headers({ 'retry-after': '86400' }))).toBe(RATE_LIMIT_WINDOW_MS);
        expect(rateLimitDelayMs(429, headers({ 'retry-after': '30' }), { capMs: 5_000 })).toBe(5_000);
    });

    it('reads a plain object as well as a Headers, case-insensitively', () => {
        expect(rateLimitDelayMs(429, { 'Retry-After': '4' })).toBe(4_000);
        expect(rateLimitDelayMs(429, undefined)).toBe(RATE_LIMIT_WINDOW_MS);
    });
});
