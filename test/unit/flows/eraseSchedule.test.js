// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Forgot Password's "Erase everything" waits 48 hours (operator ruling 2026-11-16).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ERASE_CANCELLED_STORAGE_KEY,
    ERASE_HOLD_MS,
    ERASE_SCHEDULE_STORAGE_KEY,
    VAULT_SESSION_LOCK_NAME,
    __resetEraseScheduleForTests,
    cancelEraseSchedule,
    configureEraseSchedulePersistence,
    eraseRemainingMs,
    getEraseSchedule,
    isEraseDue,
    markEraseGuardUnavailable,
    runDueErase,
    scheduleErase,
    shouldRunDueErase,
} from '../../../packages/core/src/flows/eraseSchedule.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
});

afterEach(() => {
    vi.useRealTimers();
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
});

describe('erase schedule', () => {
    it('holds for 48 hours, then is due', async () => {
        const schedule = await scheduleErase();
        expect(schedule.dueAt - schedule.scheduledAt).toBe(ERASE_HOLD_MS);
        expect(ERASE_HOLD_MS).toBe(48 * 60 * 60 * 1000);
        expect(isEraseDue(getEraseSchedule())).toBe(false);
        vi.advanceTimersByTime(ERASE_HOLD_MS - 1000);
        expect(eraseRemainingMs(getEraseSchedule())).toBe(1000);
        expect(isEraseDue(getEraseSchedule())).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(isEraseDue(getEraseSchedule())).toBe(true);
    });

    it('typing WIPE again keeps the first due time', async () => {
        const first = await scheduleErase();
        vi.advanceTimersByTime(60_000);
        expect(await scheduleErase()).toEqual(first);
    });

    it('cancels', async () => {
        await scheduleErase();
        expect(await cancelEraseSchedule()).toBe(true);
        expect(getEraseSchedule()).toBeNull();
        expect(await cancelEraseSchedule()).toBe(false);
    });

    it('ignores a tampered record that claims a longer or inverted hold', () => {
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify({ scheduledAt: 1, dueAt: 1 + ERASE_HOLD_MS * 10 }));
        expect(getEraseSchedule()).toBeNull();
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify({ scheduledAt: 10, dueAt: 5 }));
        expect(getEraseSchedule()).toBeNull();
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, 'not json');
        expect(getEraseSchedule()).toBeNull();
    });

    it('uses an injected store (the native guard slot) instead of localStorage', async () => {
        let slot = null;
        const store = {
            load: vi.fn(async () => slot),
            save: vi.fn(async (s) => { slot = s; }),
            clear: vi.fn(async () => { slot = null; }),
        };
        await configureEraseSchedulePersistence(store);
        const schedule = await scheduleErase();
        expect(slot).toEqual(schedule);
        expect(globalThis.localStorage.getItem(ERASE_SCHEDULE_STORAGE_KEY)).toBeNull();
        // A fresh boot hydrates from the slot.
        await configureEraseSchedulePersistence(store);
        expect(getEraseSchedule()).toEqual(schedule);
        await cancelEraseSchedule();
        expect(slot).toBeNull();
    });
});

// Security review of the Forgot Password recovery, 2026-11-16.
describe('the due erase runs only when every store still holds it', () => {
    const CANCELLED_KEY = ERASE_CANCELLED_STORAGE_KEY;

    /** A record whose 48-hour hold ended a minute ago. */
    function dueRecord() {
        const dueAt = Date.now() - 60_000;
        return { scheduledAt: dueAt - ERASE_HOLD_MS, dueAt };
    }

    function slotStore(initial, { clearFails = false } = {}) {
        const state = { slot: initial };
        return {
            state,
            load: vi.fn(async () => state.slot),
            save: vi.fn(async (s) => { state.slot = s; }),
            clear: vi.fn(async () => {
                if (clearFails) throw new Error('keystore is locked');
                state.slot = null;
            }),
        };
    }

    function stubLocks({ held = [], grant = true } = {}) {
        const request = vi.fn(async (_name, _opts, fn) => fn(grant ? { name: _name } : null));
        Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: { query: vi.fn(async () => ({ held, pending: [] })), request },
        });
        return request;
    }

    beforeEach(() => {
        globalThis.localStorage.removeItem(CANCELLED_KEY);
    });
    afterEach(() => {
        globalThis.localStorage.removeItem(CANCELLED_KEY);
        delete globalThis.navigator.locks;
    });

    it('rejects a record whose hold is shorter than 48 hours', () => {
        const now = Date.now();
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify({ scheduledAt: now, dueAt: now + 60 * 60 * 1000 }));
        expect(getEraseSchedule()).toBeNull();
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify({ scheduledAt: now, dueAt: now + ERASE_HOLD_MS - 1 }));
        expect(getEraseSchedule()).toBeNull();
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify({ scheduledAt: now, dueAt: now + ERASE_HOLD_MS }));
        expect(getEraseSchedule()).toEqual({ scheduledAt: now, dueAt: now + ERASE_HOLD_MS });
    });

    it('a cancel the store refuses rejects and leaves the erase showing', async () => {
        const store = slotStore(null, { clearFails: true });
        await configureEraseSchedulePersistence(store);
        await scheduleErase();
        await expect(cancelEraseSchedule()).rejects.toMatchObject({ name: 'EraseCancelError' });
        expect(getEraseSchedule()).not.toBeNull();
    });

    it('a cancel whose native clear failed still stops the erase at every later start', async () => {
        const store = slotStore(dueRecord(), { clearFails: true });
        await configureEraseSchedulePersistence(store);
        expect(isEraseDue(getEraseSchedule())).toBe(true);
        await expect(cancelEraseSchedule()).rejects.toThrow();
        expect(await shouldRunDueErase()).toBe(false);
        // The next start hydrates the same record from the slot.
        __resetEraseScheduleForTests();
        await configureEraseSchedulePersistence(store);
        expect(isEraseDue(getEraseSchedule())).toBe(true);
        expect(await shouldRunDueErase()).toBe(false);
    });

    it('re-reads the native slot and skips when it no longer holds the record', async () => {
        const store = slotStore(dueRecord());
        await configureEraseSchedulePersistence(store);
        expect(await shouldRunDueErase()).toBe(true);
        // Cancelled from another context since this start hydrated.
        store.state.slot = null;
        expect(await shouldRunDueErase()).toBe(false);
    });

    it('skips when a localStorage copy disagrees with the native slot', async () => {
        const record = dueRecord();
        await configureEraseSchedulePersistence(slotStore(record));
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify({
            scheduledAt: record.scheduledAt + 5, dueAt: record.dueAt + 5,
        }));
        expect(await shouldRunDueErase()).toBe(false);
    });

    it('re-reads localStorage on the web path and skips a record removed since start', async () => {
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify(dueRecord()));
        expect(await shouldRunDueErase()).toBe(true);
        globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
        expect(await shouldRunDueErase()).toBe(false);
    });

    it('never runs in a boot whose native guard store failed to load', async () => {
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify(dueRecord()));
        markEraseGuardUnavailable();
        expect(await shouldRunDueErase()).toBe(false);
    });

    it('never runs while any tab holds the vault lease', async () => {
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify(dueRecord()));
        stubLocks({ held: [{ name: 'xchain-wallet:vault-session', mode: 'exclusive' }] });
        expect(VAULT_SESSION_LOCK_NAME).toBe('xchain-wallet:vault-session');
        expect(await shouldRunDueErase()).toBe(false);
        const wipe = vi.fn(async () => {});
        expect(await runDueErase(wipe)).toBe(false);
        expect(wipe).not.toHaveBeenCalled();
    });

    it('runs the wipe holding the vault lease, and not at all when the lease is taken first', async () => {
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify(dueRecord()));
        stubLocks({ grant: false });
        const wipe = vi.fn(async () => {});
        expect(await runDueErase(wipe)).toBe(false);
        expect(wipe).not.toHaveBeenCalled();

        const granted = stubLocks({ grant: true });
        expect(await runDueErase(wipe)).toBe(true);
        expect(wipe).toHaveBeenCalledTimes(1);
        expect(granted).toHaveBeenCalledWith('xchain-wallet:vault-session', { ifAvailable: true }, expect.any(Function));
    });
});
