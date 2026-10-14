import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearAllChainFilters,
    readChainSet,
    writeChainSet,
} from '../../../../packages/core/src/shared/utils/chainFilterMemory.js';

beforeEach(() => localStorage.clear());

afterEach(() => vi.restoreAllMocks());

describe('chain filter memory edge behavior', () => {
    it.each([
        [null, null],
        ['{', null],
        [JSON.stringify({ chain: 'bitcoin-mainnet' }), null],
        [JSON.stringify([null, 4, false]), null],
    ])('rejects an absent or malformed stored set %#', (raw, expected) => {
        if (raw !== null) localStorage.setItem('xc:chainFilter:history', raw);
        expect(readChainSet('history')).toBe(expected);
    });

    it('filters rotated chain ids, non-strings, and duplicates', () => {
        localStorage.setItem('xc:chainFilter:history', JSON.stringify([
            'bitcoin-mainnet',
            'retired-mainnet',
            'bitcoin-mainnet',
            4,
        ]));

        expect(readChainSet('history', ['bitcoin-mainnet', 'litecoin-mainnet']))
            .toEqual(new Set(['bitcoin-mainnet']));
        expect(readChainSet('history', ['litecoin-mainnet'])).toBeNull();
    });

    it('writes stable sorted values and removes empty selections', () => {
        writeChainSet('history', new Set(['litecoin-mainnet', 'bitcoin-mainnet']));
        expect(localStorage.getItem('xc:chainFilter:history'))
            .toBe('["bitcoin-mainnet","litecoin-mainnet"]');

        writeChainSet('history', new Set());
        expect(localStorage.getItem('xc:chainFilter:history')).toBeNull();
    });

    it('tolerates refused reads, writes, and removals', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('read blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('write blocked');
        });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('remove blocked');
        });

        expect(readChainSet('history')).toBeNull();
        expect(() => writeChainSet('history', new Set(['bitcoin-mainnet']))).not.toThrow();
        expect(() => writeChainSet('history', new Set())).not.toThrow();
    });

    it('clears only chain-filter records after collecting all matching keys', () => {
        localStorage.setItem('xc:chainFilter:history', '["bitcoin-mainnet"]');
        localStorage.setItem('xc:chainFilter:orders', '["litecoin-mainnet"]');
        localStorage.setItem('unrelated', 'keep');

        expect(clearAllChainFilters()).toBe(2);
        expect(localStorage.getItem('xc:chainFilter:history')).toBeNull();
        expect(localStorage.getItem('xc:chainFilter:orders')).toBeNull();
        expect(localStorage.getItem('unrelated')).toBe('keep');
    });

    it('returns zero when enumeration fails', () => {
        vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
            throw new Error('enumeration blocked');
        });
        localStorage.setItem('xc:chainFilter:history', '["bitcoin-mainnet"]');

        expect(clearAllChainFilters()).toBe(0);
    });

    it('counts only records that storage actually removes', () => {
        localStorage.setItem('xc:chainFilter:history', '["bitcoin-mainnet"]');
        localStorage.setItem('xc:chainFilter:orders', '["litecoin-mainnet"]');
        const original = Storage.prototype.removeItem;
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function removeItem(key) {
            if (key.endsWith('history')) throw new Error('remove blocked');
            return original.call(this, key);
        });

        expect(clearAllChainFilters()).toBe(1);
    });
});
