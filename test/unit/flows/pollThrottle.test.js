// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: the re-poll throttle Home, History and the coinpay badge share. The
// property under test is the one the rate-limits spec needs from it: an
// alt-tab back after the data has aged past the poll interval polls exactly
// once, and an alt-tab inside the window (or while a poll is in flight) polls
// zero times.

import { describe, it, expect } from 'vitest';
import { createPollThrottle } from '../../../packages/core/src/flows/pollThrottle.js';

const INTERVAL = 20_000;

function clock(startMs = 1_000_000) {
    let t = startMs;
    return { now: () => t, advance: (ms) => { t += ms; }, at: () => t };
}

describe('createPollThrottle', () => {
    it('is due before any poll has ever landed', () => {
        const c = clock();
        const th = createPollThrottle(INTERVAL, { now: c.now });
        expect(th.due()).toBe(true);
        expect(th.lastSuccessAt()).toBe(null);
    });

    it('drops a refocus burst inside the window and fires once after it', () => {
        const c = clock();
        const th = createPollThrottle(INTERVAL, { now: c.now });
        th.succeed(); // the cold-open landed

        // focus + visibilitychange, together, 5 s later: the data is fresher
        // than the poll interval, so neither fires.
        c.advance(5_000);
        expect(th.start()).toBe(false);
        expect(th.start()).toBe(false);

        // The same pair after the data has aged past the interval: exactly one.
        c.advance(INTERVAL);
        expect(th.start()).toBe(true);
        expect(th.start()).toBe(false);
    });

    it('holds the window while a poll is in flight, and restarts it on success', () => {
        const c = clock();
        const th = createPollThrottle(INTERVAL, { now: c.now });
        expect(th.start()).toBe(true);
        c.advance(INTERVAL * 2);
        // Still in flight: even aged data does not admit a second poll.
        expect(th.due()).toBe(false);
        th.succeed();
        expect(th.lastSuccessAt()).toBe(c.at());
        expect(th.due()).toBe(false);
        c.advance(INTERVAL);
        expect(th.due()).toBe(true);
    });

    it('releases the window on failure without moving the last success', () => {
        const c = clock();
        const th = createPollThrottle(INTERVAL, { now: c.now });
        th.succeed();
        const landed = th.lastSuccessAt();
        c.advance(INTERVAL);
        expect(th.start()).toBe(true);
        th.fail();
        expect(th.lastSuccessAt()).toBe(landed);
        // The next event may try again at once; the data is still stale.
        expect(th.start()).toBe(true);
    });

    it('claim() is a start that counts as its own success', () => {
        const c = clock();
        const th = createPollThrottle(INTERVAL, { now: c.now });
        expect(th.claim()).toBe(true);
        expect(th.claim()).toBe(false);
        expect(th.lastSuccessAt()).toBe(c.at());
        c.advance(INTERVAL);
        expect(th.claim()).toBe(true);
    });

    it('reset() forgets the window so a switched wallet polls at once', () => {
        const c = clock();
        const th = createPollThrottle(INTERVAL, { now: c.now });
        th.succeed();
        expect(th.due()).toBe(false);
        th.reset();
        expect(th.due()).toBe(true);
        expect(th.lastSuccessAt()).toBe(null);
    });

    it('accepts an explicit timestamp on every method, for callers with their own clock', () => {
        const th = createPollThrottle(INTERVAL, { now: () => { throw new Error('clock must not be read'); } });
        th.succeed(100);
        expect(th.due(100 + INTERVAL - 1)).toBe(false);
        expect(th.due(100 + INTERVAL)).toBe(true);
        expect(th.start(100 + INTERVAL)).toBe(true);
    });

    it('refuses a nonsensical interval', () => {
        expect(() => createPollThrottle(-1)).toThrow();
        expect(() => createPollThrottle(NaN)).toThrow();
    });
});
