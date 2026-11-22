// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createLinkThrottle } from '../../../packages/core/src/site_request/linkThrottle.js';

function createClock(initial = 0) {
    let time = initial;
    return {
        now: () => time,
        set: (next) => { time = next; },
    };
}

describe('createLinkThrottle', () => {
    it('allows five link requests', () => {
        const clock = createClock();
        const throttle = createLinkThrottle({ now: clock.now });

        expect(Array.from({ length: 5 }, () => throttle.take())).toEqual([
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true },
        ]);
    });

    it('refuses the sixth request with the time until the oldest leaves', () => {
        const clock = createClock();
        const throttle = createLinkThrottle({ now: clock.now });

        for (let i = 0; i < 5; i += 1) throttle.take();
        clock.set(12_345);

        expect(throttle.take()).toEqual({ ok: false, retryInMs: 47_655 });
    });

    it('allows a request once the oldest take leaves the window', () => {
        const clock = createClock();
        const throttle = createLinkThrottle({ now: clock.now });

        for (let i = 0; i < 5; i += 1) {
            clock.set(i * 1_000);
            expect(throttle.take()).toEqual({ ok: true });
        }

        clock.set(60_001);
        expect(throttle.take()).toEqual({ ok: true });
    });

    it('treats the exact window edge as available', () => {
        const clock = createClock();
        const throttle = createLinkThrottle({ limit: 1, windowMs: 100, now: clock.now });

        expect(throttle.take()).toEqual({ ok: true });
        clock.set(99);
        expect(throttle.take()).toEqual({ ok: false, retryInMs: 1 });
        clock.set(100);
        expect(throttle.take()).toEqual({ ok: true });
    });

    it('does not let a refused take extend the window', () => {
        const clock = createClock();
        const throttle = createLinkThrottle({ limit: 1, windowMs: 100, now: clock.now });

        expect(throttle.take()).toEqual({ ok: true });
        clock.set(50);
        expect(throttle.take()).toEqual({ ok: false, retryInMs: 50 });
        clock.set(75);
        expect(throttle.take()).toEqual({ ok: false, retryInMs: 25 });
        clock.set(100);
        expect(throttle.take()).toEqual({ ok: true });
    });
});
