// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSiteRequestIntake } from '../../../packages/core/src/site_request/intake.js';

const fixturePath = resolve('test/fixtures/connect/request-vectors.json');
const vectors = JSON.parse(readFileSync(fixturePath, 'utf8'));

function createClock(initial = vectors.now) {
    let time = initial;
    return {
        now: () => time,
        set: (next) => { time = next; },
    };
}

function envelope(index = 0, changes = {}) {
    return { ...vectors.valid[index].envelope, ...changes };
}

describe('createSiteRequestIntake', () => {
    it.each(vectors.valid)('accepts the parsed $name envelope', ({ envelope: request }) => {
        const intake = createSiteRequestIntake({ now: () => vectors.now });

        expect(intake.offer(request)).toEqual({ ok: true, parked: false });
        expect(intake.current()).toEqual({ envelope: request, parked: false });
        expect(intake.current().envelope).not.toBe(request);
        expect(intake.recheck()).toEqual({ ok: true, envelope: request });
    });

    it('parks a locked-wallet request and resumes it through unlock', () => {
        const request = envelope();
        const intake = createSiteRequestIntake({ now: () => vectors.now });

        expect(intake.offer(request, { locked: true })).toEqual({ ok: true, parked: true });
        expect(intake.current()).toEqual({ envelope: request, parked: true });
        expect(intake.recheck()).toEqual({ ok: false, reason: 'locked' });
        expect(intake.unlock()).toEqual({ ok: true, envelope: request });
        expect(intake.current()).toEqual({ envelope: request, parked: false });
        expect(intake.recheck()).toEqual({ ok: true, envelope: request });
    });

    it('rechecks expiry at unlock and clears an expired parked request', () => {
        const clock = createClock();
        const request = envelope();
        const intake = createSiteRequestIntake({ now: clock.now });

        intake.offer(request, { locked: true });
        clock.set(request.exp);

        expect(intake.unlock()).toEqual({ ok: false, reason: 'expired' });
        expect(intake.current()).toBeNull();
        expect(intake.recheck()).toEqual({ ok: false, reason: 'empty' });
    });

    it('rechecks expiry immediately before an unlocked request is displayed', () => {
        const clock = createClock();
        const request = envelope();
        const intake = createSiteRequestIntake({ now: clock.now });

        intake.offer(request);
        clock.set(request.exp);

        expect(intake.recheck()).toEqual({ ok: false, reason: 'expired' });
        expect(intake.current()).toBeNull();
    });

    it('keeps the first request when a second request finds the slot busy', () => {
        const first = envelope();
        const second = envelope(1);
        const intake = createSiteRequestIntake({ now: () => vectors.now });

        expect(intake.offer(first)).toEqual({ ok: true, parked: false });
        expect(intake.offer(second)).toEqual({ ok: false, reason: 'busy' });
        expect(intake.current()).toEqual({ envelope: first, parked: false });
    });

    it.each([
        ['approvalOpen', { approvalOpen: true }],
        ['sendHeld', { sendHeld: true }],
    ])('does not cover an existing %s surface', (_name, options) => {
        const intake = createSiteRequestIntake({ now: () => vectors.now });

        expect(intake.offer(envelope(), options)).toEqual({ ok: false, reason: 'covered' });
        expect(intake.current()).toBeNull();
    });

    it('limits the wallet to five arrivals in a trailing 60 second window', () => {
        const clock = createClock();
        const intake = createSiteRequestIntake({ now: clock.now });

        for (let index = 0; index < 5; index += 1) {
            const request = envelope(0, { id: `request-${index}` });
            expect(intake.offer(request)).toEqual({ ok: true, parked: false });
            expect(intake.release(request.id)).toBe(true);
        }

        clock.set(vectors.now + 12_345);
        expect(intake.offer(envelope(0, { id: 'request-5' }))).toEqual({
            ok: false,
            reason: 'throttled',
            retryInMs: 47_655,
        });
        expect(intake.current()).toBeNull();

        clock.set(vectors.now + 60_000);
        expect(intake.offer(envelope(0, { id: 'request-6' })))
            .toEqual({ ok: true, parked: false });
    });

    it('does not let a throttled arrival replace the held request', () => {
        const intake = createSiteRequestIntake({ limit: 1, now: () => vectors.now });
        const first = envelope();

        expect(intake.offer(first, { locked: true })).toEqual({ ok: true, parked: true });
        expect(intake.offer(envelope(1))).toEqual({
            ok: false,
            reason: 'throttled',
            retryInMs: 60_000,
        });
        expect(intake.current()).toEqual({ envelope: first, parked: true });
    });

    it('releases only the matching request and keeps its id single-use', () => {
        const intake = createSiteRequestIntake({ now: () => vectors.now });
        const request = envelope();

        intake.offer(request);
        expect(intake.release('another-id')).toBe(false);
        expect(intake.current()).toEqual({ envelope: request, parked: false });
        expect(intake.release(request.id)).toBe(true);
        expect(intake.current()).toBeNull();
        expect(intake.offer(request)).toEqual({ ok: false, reason: 'reused' });
    });
});
