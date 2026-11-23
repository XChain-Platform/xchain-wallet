// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createPendingStore } from '../../../packages/connect/src/pendingStore.js';

const KEY = 'xchain-pending';
const firstRecord = {
    id: 'request-1',
    method: 'login',
    nonce: 'nonce-1',
    state: 'state-1',
};

function mapStorage(initial = []) {
    const values = new Map(initial);
    return {
        values,
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, value);
        },
        removeItem(key) {
            values.delete(key);
        },
    };
}

describe('createPendingStore', () => {
    it('round trips one pending record', () => {
        const storage = mapStorage();
        const store = createPendingStore(storage, KEY);

        expect(store.get()).toBeNull();
        store.set(firstRecord);

        expect(store.get()).toEqual(firstRecord);
        expect(storage.values.get(KEY)).toBe(JSON.stringify(firstRecord));
    });

    it('replaces the earlier pending record', () => {
        const store = createPendingStore(mapStorage(), KEY);
        const replacement = {
            id: 'request-2',
            method: 'signMessage',
            nonce: 'nonce-2',
            state: 'state-2',
        };

        store.set(firstRecord);
        store.set(replacement);

        expect(store.get()).toEqual(replacement);
    });

    it('clears the pending record', () => {
        const store = createPendingStore(mapStorage(), KEY);
        store.set(firstRecord);

        store.clear();

        expect(store.get()).toBeNull();
    });

    it('drops corrupt JSON without throwing', () => {
        const storage = mapStorage([[KEY, '{bad json']]);
        const store = createPendingStore(storage, KEY);

        expect(store.get()).toBeNull();
        expect(storage.values.has(KEY)).toBe(false);
    });

    it('returns null for corrupt JSON when cleanup fails', () => {
        const storage = mapStorage([[KEY, '{bad json']]);
        storage.removeItem = () => {
            throw new Error('storage cleanup unavailable');
        };
        const store = createPendingStore(storage, KEY);

        expect(store.get()).toBeNull();
    });

    it('drops a stored record missing nonce', () => {
        const { nonce: _nonce, ...missingNonce } = firstRecord;
        const storage = mapStorage([[KEY, JSON.stringify(missingNonce)]]);
        const store = createPendingStore(storage, KEY);

        expect(store.get()).toBeNull();
        expect(storage.values.has(KEY)).toBe(false);
    });

    it.each([
        ['id', ''],
        ['method', null],
        ['nonce', 1],
        ['state', undefined],
    ])('refuses a bad %s field and names it', (field, value) => {
        const store = createPendingStore(mapStorage(), KEY);

        expect(() => store.set({ ...firstRecord, [field]: value }))
            .toThrow(new TypeError(`Pending record field "${field}" must be a non-empty string`));
    });

    it('refuses and names an extra key', () => {
        const store = createPendingStore(mapStorage(), KEY);

        expect(() => store.set({ ...firstRecord, unexpected: 'value' }))
            .toThrow(new TypeError('Pending record has extra key "unexpected"'));
    });

    it('surfaces a setItem storage error', () => {
        const storageError = new Error('storage quota exceeded');
        const storage = mapStorage();
        storage.setItem = () => {
            throw storageError;
        };
        const store = createPendingStore(storage, KEY);

        expect(() => store.set(firstRecord)).toThrow(storageError);
    });
});
