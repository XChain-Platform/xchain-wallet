// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createActionSafetySessionStorage,
    ownSpendStoreFrom,
    reservationStoreFrom,
} from '../../../packages/extension/src/background/actionSafetySessionStorage.js';

afterEach(() => vi.unstubAllGlobals());

function sessionArea() {
    const values = {};
    return {
        values,
        get: (key, callback) => callback({ [key]: values[key] }),
        set: (entries, callback) => {
            Object.assign(values, entries);
            callback?.();
        },
    };
}

describe('action safety session storage', () => {
    it('is unavailable outside an extension', () => {
        expect(createActionSafetySessionStorage()).toBeNull();
    });

    it('persists reservations and own spends under separate keys', async () => {
        const area = sessionArea();
        vi.stubGlobal('chrome', { storage: { session: area } });
        const storage = createActionSafetySessionStorage();
        const reservations = reservationStoreFrom(storage);
        const ownSpends = ownSpendStoreFrom(storage);

        await reservations.save([{ id: 'reservation-1' }]);
        await ownSpends.save([{ id: 'spend-1' }]);

        await expect(reservations.load()).resolves.toEqual([{ id: 'reservation-1' }]);
        await expect(ownSpends.load()).resolves.toEqual([{ id: 'spend-1' }]);
        expect(area.values).toEqual({
            'xchain.reservationLedger': [{ id: 'reservation-1' }],
            'xchain.ownSpends': [{ id: 'spend-1' }],
        });
    });
});
