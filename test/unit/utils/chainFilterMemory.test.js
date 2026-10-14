// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearAllChainFilters,
    readChainSet,
    writeChainSet,
} from '../../../packages/core/src/shared/utils/chainFilterMemory.js';

describe('chainFilterMemory', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns null for missing, malformed, or non-array records', () => {
        expect(readChainSet('history')).toBeNull();

        localStorage.setItem('xc:chainFilter:history', '{bad json');
        expect(readChainSet('history')).toBeNull();

        localStorage.setItem('xc:chainFilter:history', JSON.stringify({ chain: 'bitcoin-mainnet' }));
        expect(readChainSet('history')).toBeNull();
    });

    it('keeps unique string ids allowed by the current registry', () => {
        localStorage.setItem('xc:chainFilter:history', JSON.stringify([
            'bitcoin-mainnet',
            42,
            'retired-mainnet',
            'bitcoin-mainnet',
            'litecoin-mainnet',
        ]));

        expect(readChainSet('history', ['bitcoin-mainnet', 'litecoin-mainnet']))
            .toEqual(new Set(['bitcoin-mainnet', 'litecoin-mainnet']));
        expect(readChainSet('history', ['dogecoin-mainnet'])).toBeNull();
    });

    it('writes sorted ids and removes empty selections', () => {
        writeChainSet('history', new Set(['litecoin-mainnet', 'bitcoin-mainnet']));
        expect(localStorage.getItem('xc:chainFilter:history'))
            .toBe('["bitcoin-mainnet","litecoin-mainnet"]');

        writeChainSet('history', new Set());
        expect(localStorage.getItem('xc:chainFilter:history')).toBeNull();
    });

    it('isolates list keys and clears only chain-filter records', () => {
        writeChainSet('history', new Set(['bitcoin-mainnet']));
        writeChainSet('balances', new Set(['litecoin-mainnet']));
        localStorage.setItem('xc:unrelated', 'keep');

        expect(clearAllChainFilters()).toBe(2);
        expect(readChainSet('history')).toBeNull();
        expect(readChainSet('balances')).toBeNull();
        expect(localStorage.getItem('xc:unrelated')).toBe('keep');
    });

    it('tolerates unavailable storage for reads, writes, and bulk clearing', () => {
        const fail = () => { throw new Error('storage unavailable'); };
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail);
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(fail);
        vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(fail);

        expect(readChainSet('history')).toBeNull();
        expect(() => writeChainSet('history', new Set(['bitcoin-mainnet']))).not.toThrow();
        expect(() => writeChainSet('history', null)).not.toThrow();
        expect(clearAllChainFilters()).toBe(0);
    });
});
