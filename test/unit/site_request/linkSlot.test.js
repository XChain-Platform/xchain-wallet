// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createLinkSlot } from '../../../packages/core/src/site_request/linkSlot.js';

function createClock(initial = 1_000) {
    let time = initial;
    return {
        now: () => time,
        set: (next) => { time = next; },
    };
}

describe('createLinkSlot', () => {
    it('accepts and holds a copy of a request', () => {
        const request = { id: 'link-1', exp: 2_000 };
        const slot = createLinkSlot({ now: () => 1_000 });

        expect(slot.offer(request)).toEqual({ ok: true });
        expect(slot.current()).toEqual(request);
        expect(slot.current()).not.toBe(request);

        request.exp = 3_000;
        expect(slot.current()).toEqual({ id: 'link-1', exp: 2_000 });
    });

    it('refuses a second request as busy without replacing the first', () => {
        const slot = createLinkSlot({ now: () => 1_000 });
        const first = { id: 'link-1', exp: 2_000 };

        expect(slot.offer(first)).toEqual({ ok: true });
        expect(slot.offer({ id: 'link-2', exp: 3_000 })).toEqual({ ok: false, reason: 'busy' });
        expect(slot.current()).toEqual(first);
    });

    it('applies expired, reused, busy, and covered refusal priority', () => {
        const slot = createLinkSlot({ now: () => 1_000 });

        slot.offer({ id: 'reused', exp: 2_000 });
        slot.release('reused');
        slot.offer({ id: 'held', exp: 3_000 });

        expect(slot.offer({ id: 'reused', exp: 1_000 }, { approvalOpen: true }))
            .toEqual({ ok: false, reason: 'expired' });
        expect(slot.offer({ id: 'reused', exp: 4_000 }, { approvalOpen: true }))
            .toEqual({ ok: false, reason: 'reused' });
        expect(slot.offer({ id: 'fresh', exp: 4_000 }, { approvalOpen: true }))
            .toEqual({ ok: false, reason: 'busy' });
        expect(slot.current()).toEqual({ id: 'held', exp: 3_000 });
    });

    it.each([
        ['approvalOpen', { approvalOpen: true }],
        ['sendHeld', { sendHeld: true }],
    ])('refuses a request covered by %s and leaves the slot empty', (_name, options) => {
        const slot = createLinkSlot({ now: () => 1_000 });

        expect(slot.offer({ id: 'link-1', exp: 2_000 }, options))
            .toEqual({ ok: false, reason: 'covered' });
        expect(slot.current()).toBeNull();
        expect(slot.remembered()).toBe(0);
    });

    it('treats expiry as an exclusive boundary', () => {
        const slot = createLinkSlot({ now: () => 1_000 });

        expect(slot.offer({ id: 'due', exp: 1_000 })).toEqual({ ok: false, reason: 'expired' });
        expect(slot.offer({ id: 'future', exp: 1_001 })).toEqual({ ok: true });
    });

    it('keeps accepted ids reused after release and accepts a new id', () => {
        const slot = createLinkSlot({ now: () => 1_000 });

        expect(slot.offer({ id: 'link-1', exp: 2_000 })).toEqual({ ok: true });
        expect(slot.release('link-1')).toBe(true);
        expect(slot.offer({ id: 'link-1', exp: 2_000 })).toEqual({ ok: false, reason: 'reused' });
        expect(slot.offer({ id: 'link-2', exp: 2_000 })).toEqual({ ok: true });
    });

    it('does not release a held request for another id', () => {
        const slot = createLinkSlot({ now: () => 1_000 });
        const request = { id: 'link-1', exp: 2_000 };

        slot.offer(request);

        expect(slot.release('link-2')).toBe(false);
        expect(slot.current()).toEqual(request);
    });

    it('rechecks a held request through unexpired, expired, and empty states', () => {
        const clock = createClock();
        const slot = createLinkSlot({ now: clock.now });

        slot.offer({ id: 'link-1', exp: 2_000 });
        expect(slot.recheck()).toEqual({ ok: true });

        clock.set(2_000);
        expect(slot.recheck()).toEqual({ ok: false, reason: 'expired' });
        expect(slot.current()).toBeNull();
        expect(slot.recheck()).toEqual({ ok: false, reason: 'empty' });
    });

    it('accepts an offer after the held request expires', () => {
        const clock = createClock();
        const slot = createLinkSlot({ now: clock.now });

        slot.offer({ id: 'link-1', exp: 2_000 });
        clock.set(2_000);

        expect(slot.offer({ id: 'link-2', exp: 3_000 })).toEqual({ ok: true });
        expect(slot.current()).toEqual({ id: 'link-2', exp: 3_000 });
    });

    it('forgets an accepted id when its expiry is reached', () => {
        const clock = createClock();
        const slot = createLinkSlot({ now: clock.now });

        slot.offer({ id: 'link-1', exp: 2_000 });
        slot.release('link-1');
        expect(slot.remembered()).toBe(1);

        clock.set(2_000);
        expect(slot.remembered()).toBe(0);
        expect(slot.offer({ id: 'link-1', exp: 3_000 })).toEqual({ ok: true });
    });

    it('does not consume an expired held request while counting remembered ids', () => {
        const clock = createClock();
        const slot = createLinkSlot({ now: clock.now });

        slot.offer({ id: 'link-1', exp: 2_000 });
        clock.set(2_000);

        expect(slot.remembered()).toBe(0);
        expect(slot.current()).toEqual({ id: 'link-1', exp: 2_000 });
        expect(slot.recheck()).toEqual({ ok: false, reason: 'expired' });
        expect(slot.current()).toBeNull();
        expect(slot.recheck()).toEqual({ ok: false, reason: 'empty' });
    });

    it.each([undefined, null, '', 7, {}])('throws for malformed id %j', (id) => {
        const slot = createLinkSlot({ now: () => 1_000 });

        expect(() => slot.offer({ id, exp: 2_000 })).toThrow(TypeError);
        expect(() => slot.offer({ id, exp: 2_000 })).toThrow(/id/);
    });

    it.each([undefined, null, '2000', NaN, Infinity, -Infinity])('throws for malformed exp %j', (exp) => {
        const slot = createLinkSlot({ now: () => 1_000 });

        expect(() => slot.offer({ id: 'link-1', exp })).toThrow(TypeError);
        expect(() => slot.offer({ id: 'link-1', exp })).toThrow(/exp/);
    });
});
