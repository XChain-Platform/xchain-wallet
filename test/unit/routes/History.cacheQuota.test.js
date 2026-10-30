// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    HISTORY_CACHE_MAX_ENTRIES,
    readHistoryCache,
    writeHistoryCache,
} from '../../../packages/core/src/shared/utils/historyCache.js';

const QUOTA_CHARS = 600_000;
const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function quotaStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => {
            if (String(v).length > QUOTA_CHARS) throw new DOMException('full', 'QuotaExceededError');
            map.set(k, String(v));
        },
        removeItem: (k) => map.delete(k),
        key: (i) => [...map.keys()][i] ?? null,
        get length() { return map.size; },
    };
}

function rows(n) {
    return Array.from({ length: n }, (_, i) => ({
        key: `k${i}`,
        action: 'SEND',
        actionIndex: String(n - i),
        blockIndex: 1_000_000 - i,
        chainId: 'bitcoin-mainnet',
        raw: { tick: 'BTC', amount: '1.5', destination: 'bc1qzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' },
    }));
}

beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: quotaStorage(), configurable: true });
});

afterEach(() => {
    if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage);
    else delete globalThis.localStorage;
});

describe('History cache past the storage quota', () => {
    it('saves the newest rows when the full feed does not fit', () => {
        const all = rows(6000);
        const ok = writeHistoryCache('w', 'a', { entries: all, addressesByChain: {}, fetchedAt: 1 }, 'mainnet');
        expect(ok).toBe(true);
        const cached = readHistoryCache('w', 'a', 'mainnet');
        expect(cached.entries.length).toBeGreaterThan(0);
        expect(cached.entries.length).toBeLessThanOrEqual(HISTORY_CACHE_MAX_ENTRIES);
        expect(cached.entries[0].key).toBe('k0');
    });

    it('keeps a small feed whole', () => {
        writeHistoryCache('w', 'a', { entries: rows(20), addressesByChain: {}, fetchedAt: 1 }, 'mainnet');
        expect(readHistoryCache('w', 'a', 'mainnet').entries).toHaveLength(20);
    });
});
