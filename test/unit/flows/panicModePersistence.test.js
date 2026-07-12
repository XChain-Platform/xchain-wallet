// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: panic-mode persistence backend (§26.5 / G068). In an MV3 background
// service worker localStorage is undefined, so the freeze must persist via an
// injected async store (chrome.storage.local) hydrated into a synchronous
// cache at boot, and signing must fail closed until that hydrate resolves
// (review finding uuid:fb728a88).

import { describe, it, expect, afterEach } from 'vitest';
import {
    configurePanicModePersistence,
    applyExternalPanicModeState,
    assertSigningAllowed,
    activatePanicMode,
    getPanicModeState,
    isSigningFrozen,
    clearPanicModeState,
    emptyPanicModeState,
    PanicModeActiveError,
    DEFAULT_DURATION_MS,
} from '../../../packages/core/src/flows/panicMode.js';

function activeState(nowMs = Date.now()) {
    return { activatedAt: nowMs, expiresAt: nowMs + DEFAULT_DURATION_MS, durationMs: DEFAULT_DURATION_MS };
}

afterEach(() => {
    clearPanicModeState();
});

describe('panic-mode persistence', () => {
    it('hydrates the freeze from the injected store at boot', async () => {
        const state = activeState();
        const store = {
            load: async () => state,
            save: async () => {},
            clear: async () => {},
        };

        await configurePanicModePersistence(store);

        expect(isSigningFrozen()).toBe(true);
        expect(getPanicModeState()).toEqual(state);
        expect(() => assertSigningAllowed()).toThrow(PanicModeActiveError);
    });

    it('fails closed while hydration is pending, then serves once it resolves', async () => {
        let resolveLoad;
        const store = {
            load: () => new Promise((resolve) => { resolveLoad = resolve; }),
            save: async () => {},
            clear: async () => {},
        };

        // Do not await: the load promise is still pending here.
        const pending = configurePanicModePersistence(store);

        // Fail closed: state has not loaded, so signing must be refused even
        // though no freeze is (yet) known.
        expect(() => assertSigningAllowed()).toThrow(PanicModeActiveError);

        resolveLoad(emptyPanicModeState());
        await pending;

        // Hydrated to an empty (inactive) state: signing now allowed.
        expect(() => assertSigningAllowed()).not.toThrow();
    });

    it('applies a cross-context storage.onChanged update into the cache', async () => {
        const store = { load: async () => emptyPanicModeState(), save: async () => {}, clear: async () => {} };
        await configurePanicModePersistence(store);
        expect(isSigningFrozen()).toBe(false);

        // Simulate a freeze activated in another context (popup) arriving via
        // chrome.storage.onChanged.
        applyExternalPanicModeState(activeState());
        expect(isSigningFrozen()).toBe(true);

        // And a deactivation from another context clearing it.
        applyExternalPanicModeState(null);
        expect(isSigningFrozen()).toBe(false);
    });

    it('mirrors local activation and deactivation to the async store', async () => {
        const saved = [];
        let cleared = 0;
        const store = {
            load: async () => emptyPanicModeState(),
            save: async (s) => { saved.push(s); },
            clear: async () => { cleared += 1; },
        };
        await configurePanicModePersistence(store);

        activatePanicMode();
        expect(saved.length).toBe(1);
        expect(saved[0].expiresAt).toBeGreaterThan(0);
        expect(isSigningFrozen()).toBe(true);

        clearPanicModeState();
    });
});
