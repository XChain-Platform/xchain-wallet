// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createConfirmActionSessionStorage,
    reservationStoreFrom,
} from '../../../packages/extension/src/background/confirmActionSessionStorage.js';

afterEach(() => {
    delete globalThis.chrome;
});

function installSessionArea(initial = {}) {
    const values = { ...initial };
    const area = {
        get: vi.fn((key, callback) => callback({ [key]: values[key] })),
        set: vi.fn((next, callback) => {
            Object.assign(values, next);
            callback();
        }),
    };
    globalThis.chrome = { storage: { session: area } };
    return { area, values };
}

describe('confirm action session storage fallback branches', () => {
    it('rejects incomplete chrome storage and normalizes malformed values', async () => {
        globalThis.chrome = {};
        expect(createConfirmActionSessionStorage()).toBeNull();

        const { values } = installSessionArea({
            'xchain.confirmAction': 'invalid',
            'xchain.reservationLedger': { not: 'an array' },
        });
        const storage = createConfirmActionSessionStorage();

        expect(await storage.loadSessions()).toEqual({});
        expect(await storage.loadReservations()).toEqual([]);
        await storage.removeSession('missing');
        await storage.saveReservations('invalid');
        expect(values['xchain.reservationLedger']).toEqual([]);
    });

    it('contains synchronous chrome API failures and preserves valid values', async () => {
        const sessions = { keep: { id: 'keep' } };
        const reservations = [{ id: 'reservation-1' }];
        const { area } = installSessionArea({
            'xchain.confirmAction': sessions,
            'xchain.reservationLedger': reservations,
        });
        const storage = createConfirmActionSessionStorage();

        expect(await storage.loadSessions()).toBe(sessions);
        expect(await storage.loadReservations()).toBe(reservations);

        area.get.mockImplementationOnce(() => { throw new Error('read refused'); });
        expect(await storage.loadSessions()).toEqual({});

        area.set.mockImplementation(() => { throw new Error('write refused'); });
        await expect(storage.putSession('next', { id: 'next' })).resolves.toBeUndefined();
        await expect(storage.saveReservations(reservations)).resolves.toBeUndefined();
    });

    it('adapts reservation load and save without changing their values', async () => {
        const loadReservations = vi.fn(async () => [{ id: 'one' }]);
        const saveReservations = vi.fn(async () => {});
        const store = reservationStoreFrom({ loadReservations, saveReservations });

        await expect(store.load()).resolves.toEqual([{ id: 'one' }]);
        await store.save([{ id: 'two' }]);
        expect(saveReservations).toHaveBeenCalledWith([{ id: 'two' }]);
    });
});
