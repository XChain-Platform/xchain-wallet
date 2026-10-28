// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a panic-mode write the store refuses fails safe. Turning the freeze on
// holds it in memory and reports it unsaved; turning it off keeps the freeze
// when the clear is refused. Neither outcome claims a saved state.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    configurePanicModePersistence,
    applyExternalPanicModeState,
    activatePanicMode,
    deactivatePanicMode,
    assertSigningAllowed,
    isSigningFrozen,
    getPanicModeState,
    getPanicModeSaveStatus,
    subscribePanicModeSaveStatus,
    holdPanicModeFreeze,
    clearPanicModeState,
    __resetPanicModePersistenceForTests,
    PanicModeActiveError,
    PANIC_SAVE_OK,
    PANIC_SAVE_UNSAVED,
    PANIC_SAVE_CLEAR_FAILED,
    DEFAULT_DURATION_MS,
} from '../../../packages/core/src/flows/panicMode.js';

function store({ saved = null, saveFails = false, saveThrows = false, clearFails = false } = {}) {
    const box = { value: saved };
    return {
        box,
        load: async () => box.value,
        save: (s) => {
            if (saveThrows) throw new Error('QUOTA_BYTES quota exceeded');
            if (saveFails) return Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
            box.value = s;
            return Promise.resolve();
        },
        clear: () => {
            if (clearFails) return Promise.reject(new Error('write failed'));
            box.value = null;
            return Promise.resolve();
        },
    };
}

function frozenRecord(nowMs = Date.now(), durationMs = DEFAULT_DURATION_MS) {
    return { activatedAt: nowMs, expiresAt: nowMs + durationMs, durationMs, armedBy: 'self' };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
    clearPanicModeState();
    __resetPanicModePersistenceForTests();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('panic-mode activation the store refuses', () => {
    it('keeps signing frozen and reports the freeze unsaved when save rejects', async () => {
        await configurePanicModePersistence(store({ saveFails: true }));
        const seen = [];
        subscribePanicModeSaveStatus((s) => seen.push(s));

        activatePanicMode();
        expect(isSigningFrozen()).toBe(true);
        await settle();

        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_UNSAVED);
        expect(seen).toEqual([PANIC_SAVE_UNSAVED]);
        expect(() => assertSigningAllowed()).toThrow(PanicModeActiveError);
    });

    it('treats a save that throws synchronously the same way', async () => {
        await configurePanicModePersistence(store({ saveThrows: true }));
        activatePanicMode();
        await settle();
        expect(isSigningFrozen()).toBe(true);
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_UNSAVED);
    });

    it('does not lose an unsaved freeze when the store is read again', async () => {
        const refusing = store({ saveFails: true });
        await configurePanicModePersistence(refusing);
        activatePanicMode();
        await settle();

        // A worker rebuild re-configures and hydrates from a store that never
        // took the record.
        await configurePanicModePersistence(refusing);
        expect(isSigningFrozen()).toBe(true);
    });

    it('reports saved when the store takes the record', async () => {
        const s = store();
        await configurePanicModePersistence(s);
        activatePanicMode();
        await settle();
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_OK);
        expect(s.box.value.expiresAt).toBeGreaterThan(0);
    });

    it('keeps the freeze in memory when localStorage refuses it', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });
        activatePanicMode();
        expect(isSigningFrozen()).toBe(true);
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_UNSAVED);
    });
});

describe('panic-mode deactivation the store refuses', () => {
    it('keeps the freeze on and reports it when clear rejects', async () => {
        const s = store({ saved: frozenRecord(), clearFails: true });
        await configurePanicModePersistence(s);
        expect(isSigningFrozen()).toBe(true);

        const off = await deactivatePanicMode();

        expect(off).toBe(false);
        expect(isSigningFrozen()).toBe(true);
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_CLEAR_FAILED);
        expect(() => assertSigningAllowed()).toThrow(PanicModeActiveError);
    });

    it('lifts the freeze once the clear lands', async () => {
        const s = store({ saved: frozenRecord() });
        await configurePanicModePersistence(s);

        const off = await deactivatePanicMode();

        expect(off).toBe(true);
        expect(isSigningFrozen()).toBe(false);
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_OK);
        expect(s.box.value).toBeNull();
    });

    it('lifts an unsaved freeze when deactivated', async () => {
        await configurePanicModePersistence(store({ saveFails: true }));
        activatePanicMode();
        await settle();

        expect(await deactivatePanicMode()).toBe(true);
        expect(isSigningFrozen()).toBe(false);
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_OK);
    });

    it('keeps the freeze when localStorage refuses the removal', async () => {
        activatePanicMode();
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('write failed');
        });
        expect(await deactivatePanicMode()).toBe(false);
        expect(isSigningFrozen()).toBe(true);
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_CLEAR_FAILED);
    });
});

describe('a freeze held for another context', () => {
    it('freezes signing, survives a re-read of an empty store, and ends with a cleared record', async () => {
        const s = store();
        await configurePanicModePersistence(s);

        holdPanicModeFreeze(frozenRecord());
        expect(() => assertSigningAllowed()).toThrow(PanicModeActiveError);

        await configurePanicModePersistence(s);
        expect(isSigningFrozen()).toBe(true);

        applyExternalPanicModeState(null);
        expect(isSigningFrozen()).toBe(false);
    });

    it('holds a freeze while persistence is not configured yet', () => {
        holdPanicModeFreeze(frozenRecord());
        expect(isSigningFrozen()).toBe(true);
    });

    it('ignores an inactive or expired record and never shortens a longer freeze', async () => {
        await configurePanicModePersistence(store());
        holdPanicModeFreeze(null);
        holdPanicModeFreeze(frozenRecord(Date.now() - 2 * DEFAULT_DURATION_MS));
        expect(isSigningFrozen()).toBe(false);

        const long = frozenRecord(Date.now(), 2 * DEFAULT_DURATION_MS);
        holdPanicModeFreeze(long);
        holdPanicModeFreeze(frozenRecord(Date.now(), 60_000));
        expect(getPanicModeState().expiresAt).toBe(long.expiresAt);
    });
});
