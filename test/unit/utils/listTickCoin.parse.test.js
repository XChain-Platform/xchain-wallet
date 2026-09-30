import { describe, it, expect } from 'vitest';
import {
    LIST_TICK_COIN_SEPARATOR,
    LIST_TICK_COINS,
    splitTickCoinItem,
    qualifyTickItem,
    chainIdForCoin,
} from '../../../packages/core/src/shared/utils/listTickCoin.js';
import { classifyTickItems } from '../../../packages/core/src/shared/utils/listTickItems.js';

describe('splitTickCoinItem', () => {
    it('exposes the separator and coins', () => {
        expect(LIST_TICK_COIN_SEPARATOR).toBe(':');
        expect(LIST_TICK_COINS).toEqual(['BTC', 'LTC', 'DOGE']);
    });
    it('splits at the first colon and upper-cases the coin', () => {
        expect(splitTickCoinItem('ltc:PEPE')).toEqual({ coin: 'LTC', rest: 'PEPE' });
        expect(splitTickCoinItem('Doge:A:B')).toEqual({ coin: 'DOGE', rest: 'A:B' });
    });
    it('returns null for bare, unknown-coin and empty input', () => {
        expect(splitTickCoinItem('PEPE')).toBeNull();
        expect(splitTickCoinItem('XRP:PEPE')).toBeNull();
        expect(splitTickCoinItem('')).toBeNull();
        expect(splitTickCoinItem(undefined)).toBeNull();
    });
});

describe('qualifyTickItem', () => {
    it('is bare on the list coin and qualified otherwise', () => {
        expect(qualifyTickItem('BTC', 'PEPE', 'BTC')).toBe('PEPE');
        expect(qualifyTickItem('ltc', 'PEPE', 'BTC')).toBe('LTC:PEPE');
    });
});

describe('chainIdForCoin', () => {
    it('keeps the network of the given chain id', () => {
        expect(chainIdForCoin('LTC', 'bitcoin-testnet')).toBe('litecoin-testnet');
        expect(chainIdForCoin('doge', 'bitcoin-regtest')).toBe('dogecoin-regtest');
        expect(chainIdForCoin('BTC', 'litecoin-mainnet')).toBe('bitcoin-mainnet');
    });
    it('returns null for unknown coin or malformed chain id', () => {
        expect(chainIdForCoin('XRP', 'bitcoin-mainnet')).toBeNull();
        expect(chainIdForCoin('BTC', 'bitcoin')).toBeNull();
    });
});

describe('classifyTickItems coinQualified', () => {
    it('judges a qualified item on its rest and reports coinOf', () => {
        const r = classifyTickItems('PEPE, ltc:RARE, BTC:', { coinQualified: true });
        expect(r.valid).toEqual(['PEPE', 'ltc:RARE']);
        expect(r.coinOf).toEqual([null, 'LTC']);
        expect(r.invalid).toEqual(['BTC:']);
    });
    it('folds duplicates on upper-cased coin and lower-cased rest', () => {
        const r = classifyTickItems('LTC:RARE\nltc:rare', { coinQualified: true });
        expect(r.valid).toEqual(['LTC:RARE']);
        expect(r.duplicates).toBe(1);
    });
    it('keeps same rest on different coins distinct', () => {
        const r = classifyTickItems('LTC:RARE,DOGE:RARE', { coinQualified: true });
        expect(r.valid).toHaveLength(2);
        expect(r.duplicates).toBe(0);
    });
    it('without the option equals the plain result', () => {
        const text = 'PEPE, ltc:RARE, pepe';
        const r = classifyTickItems(text);
        expect(r).toEqual(classifyTickItems(text, {}));
        expect('coinOf' in r).toBe(false);
        expect(r.duplicates).toBe(1);
    });
});
