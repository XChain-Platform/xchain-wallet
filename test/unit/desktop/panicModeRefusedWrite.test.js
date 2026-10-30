/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop main signs, so a panic-freeze file write it cannot make must leave
// main frozen: a refused save keeps the freeze main applied first, and a
// refused clear never lifts it. The renderer hears the refusal and says so.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flows } from '@xchain-wallet/core';
import { __resetPanicModePersistenceForTests } from '../../../packages/core/src/flows/panicMode.js';
import {
    PANIC_STATE_CLEAR_TYPE,
    PANIC_STATE_SAVE_TYPE,
    handlePanicStateMessage,
} from '../../../packages/desktop/main/panicModeState.js';
import { installDesktopPanicModeBridge } from '../../../packages/desktop/renderer/panicModeBridge.js';

const HOUR = 60 * 60 * 1000;

function activeState(now = Date.now()) {
    return { activatedAt: now, expiresAt: now + HOUR, durationMs: HOUR, armedBy: 'self' };
}

function refusingStore({ save = false, clear = false } = {}) {
    let value = null;
    return {
        load: async () => value,
        save: async (s) => { if (save) throw new Error('ENOSPC'); value = s; },
        clear: async () => { if (clear) throw new Error('EACCES'); value = null; },
        peek: () => value,
    };
}

beforeEach(() => { __resetPanicModePersistenceForTests(); });
afterEach(() => { __resetPanicModePersistenceForTests(); });

describe('desktop main panic writes that the file refuses', () => {
    it('stays frozen when the clear is refused', async () => {
        const store = refusingStore({ clear: true });
        await flows.configurePanicModePersistence(store);
        await handlePanicStateMessage({ flows, store }, PANIC_STATE_SAVE_TYPE, activeState());
        expect(flows.isSigningFrozen()).toBe(true);

        await expect(handlePanicStateMessage({ flows, store }, PANIC_STATE_CLEAR_TYPE))
            .rejects.toThrow('EACCES');
        expect(flows.isSigningFrozen()).toBe(true);
        expect(store.peek()).not.toBeNull();
    });

    it('stays frozen when the save is refused, and tells the renderer', async () => {
        const store = refusingStore({ save: true });
        await flows.configurePanicModePersistence(store);

        await expect(handlePanicStateMessage({ flows, store }, PANIC_STATE_SAVE_TYPE, activeState()))
            .rejects.toThrow('ENOSPC');
        expect(flows.isSigningFrozen()).toBe(true);
    });

    it('lifts the freeze once the clear lands', async () => {
        const store = refusingStore();
        await flows.configurePanicModePersistence(store);
        await handlePanicStateMessage({ flows, store }, PANIC_STATE_SAVE_TYPE, activeState());

        await handlePanicStateMessage({ flows, store }, PANIC_STATE_CLEAR_TYPE);
        expect(flows.isSigningFrozen()).toBe(false);
        expect(store.peek()).toBeNull();
    });
});

describe('desktop renderer panic writes main refuses', () => {
    it('reports the freeze unsaved when main cannot save it', async () => {
        const sendMessage = async (type) => {
            if (type === 'panic.state.save') throw new Error('ENOSPC');
            return null;
        };
        await installDesktopPanicModeBridge({ flows, sendMessage });

        flows.activatePanicMode();
        await new Promise((r) => setTimeout(r, 0));

        expect(flows.isSigningFrozen()).toBe(true);
        expect(flows.getPanicModeSaveStatus()).toBe(flows.PANIC_SAVE_UNSAVED);
    });

    it('keeps the freeze when main cannot clear it', async () => {
        let held = null;
        const sendMessage = async (type, request) => {
            if (type === 'panic.state.save') { held = request; return held; }
            if (type === 'panic.state.clear') throw new Error('EACCES');
            return held;
        };
        await installDesktopPanicModeBridge({ flows, sendMessage });
        flows.activatePanicMode();
        await new Promise((r) => setTimeout(r, 0));

        expect(await flows.deactivatePanicMode()).toBe(false);
        expect(flows.isSigningFrozen()).toBe(true);
        expect(flows.getPanicModeSaveStatus()).toBe(flows.PANIC_SAVE_CLEAR_FAILED);
    });
});
