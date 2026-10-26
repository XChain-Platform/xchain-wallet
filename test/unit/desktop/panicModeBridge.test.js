// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop renderer's freeze is main's freeze: an arm or a deactivate in
// the renderer is sent to main, and a freeze an older build left in
// renderer localStorage is handed over once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flows } from '@xchain-wallet/core';
import { __resetPanicModePersistenceForTests } from '../../../packages/core/src/flows/panicMode.js';
import { tripDuressIfMatch, setDuressPassphrase, __resetDuressPersistenceForTests } from '../../../packages/core/src/flows/duressPassphrase.js';
import { installDesktopPanicModeBridge } from '../../../packages/desktop/renderer/panicModeBridge.js';

const HOUR = 60 * 60 * 1000;

/** A stand-in for main: the pre-host panic messages over one record. */
function fakeMain(initial = null) {
    let held = initial;
    const sendMessage = vi.fn(async (type, request) => {
        if (type === 'panic.state.save') held = request;
        else if (type === 'panic.state.clear') held = null;
        return held ?? { activatedAt: 0, expiresAt: 0, durationMs: 0 };
    });
    return { sendMessage, held: () => held };
}

beforeEach(() => {
    localStorage.clear();
    __resetPanicModePersistenceForTests();
    __resetDuressPersistenceForTests();
});

afterEach(() => {
    __resetPanicModePersistenceForTests();
    __resetDuressPersistenceForTests();
    localStorage.clear();
});

describe('desktop renderer panic-mode bridge', () => {
    it('sends a Settings arm and deactivate to main, not to localStorage', async () => {
        const main = fakeMain();
        await installDesktopPanicModeBridge({ flows, sendMessage: main.sendMessage });

        flows.activatePanicMode();
        await vi.waitFor(() => expect(main.held()).toMatchObject({ armedBy: 'self' }));
        expect(localStorage.getItem(flows.PANIC_STORAGE_KEY)).toBeNull();

        flows.deactivatePanicMode();
        await vi.waitFor(() => expect(main.held()).toBeNull());
    });

    it('sends a duress arm from the Locked screen to main', async () => {
        const main = fakeMain();
        await installDesktopPanicModeBridge({ flows, sendMessage: main.sendMessage });
        setDuressPassphrase('under duress');

        expect(tripDuressIfMatch('under duress')).toBe(true);

        await vi.waitFor(() => expect(main.held()).toMatchObject({ armedBy: 'duress' }));
    });

    it('shows the freeze main already holds', async () => {
        const now = Date.now();
        const main = fakeMain({ activatedAt: now, expiresAt: now + HOUR, durationMs: HOUR, armedBy: 'self' });
        await installDesktopPanicModeBridge({ flows, sendMessage: main.sendMessage });
        expect(flows.isSigningFrozen(flows.getPanicModeState())).toBe(true);
    });

    it('hands an older build\'s localStorage freeze to main once, then removes it', async () => {
        const now = Date.now();
        localStorage.setItem(flows.PANIC_STORAGE_KEY, JSON.stringify({
            activatedAt: now, expiresAt: now + HOUR, durationMs: HOUR, armedBy: 'self',
        }));
        const main = fakeMain();
        await installDesktopPanicModeBridge({ flows, sendMessage: main.sendMessage });

        expect(main.held()).toMatchObject({ expiresAt: now + HOUR });
        expect(localStorage.getItem(flows.PANIC_STORAGE_KEY)).toBeNull();
        expect(flows.isSigningFrozen(flows.getPanicModeState())).toBe(true);
    });

    it('keeps the localStorage freeze when main does not take it', async () => {
        const now = Date.now();
        localStorage.setItem(flows.PANIC_STORAGE_KEY, JSON.stringify({
            activatedAt: now, expiresAt: now + HOUR, durationMs: HOUR, armedBy: 'self',
        }));
        const sendMessage = vi.fn(async () => { throw new Error('main unreachable'); });
        await installDesktopPanicModeBridge({ flows, sendMessage }).catch(() => {});
        expect(localStorage.getItem(flows.PANIC_STORAGE_KEY)).not.toBeNull();
    });

    it('reloads main\'s state when the window regains focus', async () => {
        const main = fakeMain();
        const target = new EventTarget();
        await installDesktopPanicModeBridge({ flows, sendMessage: main.sendMessage, focusTarget: target });
        expect(flows.isSigningFrozen(flows.getPanicModeState())).toBe(false);

        // Another window armed the freeze in main.
        const now = Date.now();
        await main.sendMessage('panic.state.save', {
            activatedAt: now, expiresAt: now + HOUR, durationMs: HOUR, armedBy: 'self',
        });
        target.dispatchEvent(new Event('focus'));

        await vi.waitFor(() => expect(flows.isSigningFrozen(flows.getPanicModeState())).toBe(true));
    });
});
