// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    formatNativeBaseUnits,
    isProtocolCoinTicker,
    nativeDecimalsFor,
    nativeUnitScaleFor,
    smallBalanceBaseUnitsFor,
    tickerForCoin,
    tickerForDescriptor,
    transactionExplorerLinks,
} from '../../../packages/core/src/registry/coinTicker.js';

describe('coin ticker metadata edge branches', () => {
    it('falls back from invalid precision metadata and accepts boundary values', () => {
        expect(nativeDecimalsFor({ coin: 'litecoin', nativeDecimals: -1 })).toBe(8);
        expect(nativeDecimalsFor({ coin: 'custom', nativeDecimals: 19 })).toBe(8);
        expect(nativeDecimalsFor({ coin: 'custom', nativeDecimals: 1.5 })).toBe(8);
        expect(nativeDecimalsFor({ coin: 'custom', nativeDecimals: 0 })).toBe(0);
        expect(nativeDecimalsFor({ coin: 'custom', nativeDecimals: 18 })).toBe(18);
        expect(nativeUnitScaleFor({ nativeDecimals: 2 })).toBe(100n);
    });

    it('formats zero, negative, integer-only, and malformed base-unit values', () => {
        expect(formatNativeBaseUnits(0, 'bitcoin')).toBe('0');
        expect(formatNativeBaseUnits(-12340, { nativeDecimals: 3 })).toBe('-12.34');
        expect(formatNativeBaseUnits(12, { nativeDecimals: 0 })).toBe('12');
        expect(formatNativeBaseUnits('not-an-integer', 'bitcoin')).toBeNull();
    });

    it('falls back from malformed small-balance metadata', () => {
        expect(smallBalanceBaseUnitsFor({ coin: 'dogecoin', smallBalanceBaseUnits: -1 })).toBe(1000000n);
        expect(smallBalanceBaseUnitsFor({ coin: 'custom', smallBalanceBaseUnits: 'bad' })).toBe(546n);
        expect(smallBalanceBaseUnitsFor({ coin: 'custom', smallBalanceBaseUnits: 0 })).toBe(0n);
    });

    it('filters malformed and unsafe configured explorer entries', () => {
        const descriptor = {
            coin: 'custom',
            networkKind: 'mainnet',
            transactionExplorers: [
                null,
                {},
                { url: 'https://example.test/no-placeholder' },
                { url: 'http://example.test/tx/{txid}' },
                { url: 'not a url/{txid}' },
                { url: 'https://example.test/tx/{txid}' },
            ],
        };
        expect(transactionExplorerLinks(descriptor, 'a/b')).toEqual([{
            id: 'https://example.test/tx/a%2Fb',
            label: 'Explorer',
            iconImg: undefined,
            url: 'https://example.test/tx/a%2Fb',
        }]);
    });

    it('handles missing inputs, regtest, and non-array overrides', () => {
        expect(transactionExplorerLinks(null, 'tx')).toEqual([]);
        expect(transactionExplorerLinks({ coin: 'bitcoin', networkKind: 'mainnet' }, '')).toEqual([]);
        expect(transactionExplorerLinks({ coin: 'bitcoin', networkKind: 'regtest' }, 'tx')).toEqual([]);
        expect(transactionExplorerLinks({ coin: 'bitcoin', networkKind: 'mainnet', transactionExplorers: {} }, 'tx'))
            .toHaveLength(2);
    });

    it('normalizes known and custom tickers without misclassifying custom coins', () => {
        expect(tickerForCoin('BitCoin')).toBe('BTC');
        expect(tickerForCoin('newcoin')).toBe('NEWCOIN');
        expect(tickerForCoin(null)).toBe('');
        expect(tickerForDescriptor({ coin: 'newcoin', nativeTicker: '  NEW  ' })).toBe('NEW');
        expect(tickerForDescriptor({ coin: 'litecoin', nativeTicker: '   ' })).toBe('LTC');
        expect(isProtocolCoinTicker('doge')).toBe(true);
        expect(isProtocolCoinTicker('newcoin')).toBe(false);
    });
});
