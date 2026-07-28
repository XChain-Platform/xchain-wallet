// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : panic mode's disclosure policy.
//
// The freeze itself was already proven end to end (session 17): signing is
// refused at assertSigningAllowed and nothing reaches the chain. What was
// missing is that the user only found out on pressing Approve & Sign. These
// tests pin the policy that fixes it, and pin the one case where silence is
// still correct: a duress-armed freeze must give an observer no cue.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    PANIC_ARMED_DURESS,
    PANIC_ARMED_SELF,
    activatePanicMode,
    clearPanicModeState,
    getPanicArmedBy,
    getPanicModeState,
} from '../../../packages/core/src/flows/panicMode.js';
import { tripDuressIfMatch, setDuressPassphrase, clearDuressPassphrase } from '../../../packages/core/src/flows/duressPassphrase.js';
import {
    formatPanicRemaining,
    panicFreezeNotice,
} from '../../../packages/core/src/shared/safety/panicNotice.js';

const T0 = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

beforeEach(() => clearPanicModeState());
afterEach(() => { clearPanicModeState(); clearDuressPassphrase(); });

describe('panicFreezeNotice', () => {
    it('returns null when signing is allowed', () => {
        expect(panicFreezeNotice({ state: getPanicModeState(), nowMs: T0 })).toBeNull();
    });

    it('returns null once the freeze has expired', () => {
        const state = activatePanicMode({ nowMs: T0, durationMs: HOUR });
        expect(panicFreezeNotice({ state, nowMs: T0 + HOUR + 1 })).toBeNull();
    });

    for (const surface of ['home', 'send', 'sign']) {
        it(`announces a self-armed freeze on the ${surface} surface`, () => {
            const state = activatePanicMode({ nowMs: T0, armedBy: PANIC_ARMED_SELF });
            const notice = panicFreezeNotice({ state, nowMs: T0, surface });
            expect(notice.frozen).toBe(true);
            expect(notice.disclose).toBe(true);
            expect(notice.armedBy).toBe('self');
            expect(notice.title).toMatch(/panic mode is on/i);
            // Always says how long, and always says where to undo it: a
            // freeze the user cannot lift is a brick.
            expect(notice.detail).toContain('24h');
            expect(notice.detail).toMatch(/settings > safety/i);
        });

        it(`stays silent about a duress-armed freeze on the ${surface} surface`, () => {
            const state = activatePanicMode({ nowMs: T0, armedBy: PANIC_ARMED_DURESS });
            const notice = panicFreezeNotice({ state, nowMs: T0, surface });
            // Still frozen, so a sign screen can withdraw its "ready to
            // sign" claim...
            expect(notice.frozen).toBe(true);
            // ...but with nothing an observer could read off the screen.
            expect(notice.disclose).toBe(false);
            expect(notice.title).toBeNull();
            expect(notice.detail).toBeNull();
        });
    }

    it('tells the Send surface that THIS send will be refused', () => {
        const state = activatePanicMode({ nowMs: T0 });
        const notice = panicFreezeNotice({ state, nowMs: T0, surface: 'send' });
        expect(notice.title).toMatch(/cannot be signed/i);
    });

    it('counts down as the freeze burns off', () => {
        const state = activatePanicMode({ nowMs: T0 });
        const early = panicFreezeNotice({ state, nowMs: T0 + 5 * 60 * 1000 });
        const late = panicFreezeNotice({ state, nowMs: T0 + 23 * HOUR });
        expect(early.remainingText).toBe('23h 55m');
        expect(late.remainingText).toBe('1h');
        expect(late.remainingMs).toBeLessThan(early.remainingMs);
    });

    it('treats a legacy record with no provenance as undisclosable', () => {
        // A freeze written by a build that predates `armedBy`. Announcing it
        // could be exactly the disclosure the duress flow exists to avoid,
        // so the fail-safe direction is silence.
        const legacy = { activatedAt: T0, expiresAt: T0 + HOUR, durationMs: HOUR };
        const notice = panicFreezeNotice({ state: legacy, nowMs: T0 });
        expect(notice.frozen).toBe(true);
        expect(notice.disclose).toBe(false);
    });
});

describe('formatPanicRemaining', () => {
    it('renders sub-hour spans in minutes', () => {
        expect(formatPanicRemaining(42 * 60 * 1000)).toBe('42m');
    });

    it('drops the minutes on a whole hour', () => {
        expect(formatPanicRemaining(3 * HOUR)).toBe('3h');
    });

    it('never renders a negative countdown', () => {
        expect(formatPanicRemaining(-5000)).toBe('0m');
    });
});

describe('panic-mode provenance', () => {
    it('defaults an activation to self-armed', () => {
        const state = activatePanicMode({ nowMs: T0 });
        expect(state.armedBy).toBe('self');
        expect(getPanicArmedBy(getPanicModeState())).toBe('self');
    });

    it('reports null provenance when nothing is frozen', () => {
        expect(getPanicArmedBy(getPanicModeState())).toBeNull();
    });

    it('marks a duress-passphrase trip as duress-armed', () => {
        setDuressPassphrase('open sesame please');
        expect(tripDuressIfMatch('open sesame please')).toBe(true);
        const state = getPanicModeState();
        expect(state.expiresAt).toBeGreaterThan(0);
        expect(getPanicArmedBy(state)).toBe('duress');
        expect(panicFreezeNotice({ state }).disclose).toBe(false);
    });

    it('survives a reload of the persisted record', () => {
        activatePanicMode({ nowMs: Date.now() });
        // getPanicModeState re-reads and re-coerces from storage.
        expect(getPanicModeState().armedBy).toBe('self');
        expect(panicFreezeNotice({ state: getPanicModeState() }).disclose).toBe(true);
    });

    it('keeps the inactive state shape untouched', () => {
        clearPanicModeState();
        expect(Object.keys(getPanicModeState()).sort()).toEqual(
            ['activatedAt', 'durationMs', 'expiresAt'],
        );
    });
});
