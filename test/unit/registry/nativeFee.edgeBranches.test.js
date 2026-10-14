// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    isNativeFeeMandatory,
    nativeFeeTickerFor,
    protocolCoinTickerFor,
} from '../../../packages/core/src/registry/nativeFee.js';

describe('native fee normalization edge branches', () => {
    it('trims string forms and accepts mixed-case protocol identifiers', () => {
        expect(nativeFeeTickerFor('  litecoin-mainnet  ')).toBe('LTC');
        expect(nativeFeeTickerFor('Dogecoin')).toBe('DOGE');
        expect(nativeFeeTickerFor('btc')).toBe('BTC');
        expect(nativeFeeTickerFor('   ')).toBe('');
    });

    it('normalizes descriptor objects independently of unrelated fields', () => {
        expect(nativeFeeTickerFor({ coin: 'litecoin', id: 'wrong-mainnet' })).toBe('LTC');
        expect(nativeFeeTickerFor({ coin: '' })).toBe('');
        expect(nativeFeeTickerFor({ coin: 'custom' })).toBe('CUSTOM');
    });

    it('uses the first chain-id segment as the coin identifier', () => {
        expect(nativeFeeTickerFor('dogecoin-private-regtest')).toBe('DOGE');
        expect(nativeFeeTickerFor('custom-private-mainnet')).toBe('CUSTOM');
        expect(nativeFeeTickerFor('-mainnet')).toBe('');
    });

    it('requires native fees only for recognized non-Bitcoin protocol coins', () => {
        expect(isNativeFeeMandatory('ltc-testnet')).toBe(true);
        expect(isNativeFeeMandatory('DoGe')).toBe(true);
        expect(isNativeFeeMandatory('btc-regtest')).toBe(false);
        expect(isNativeFeeMandatory('custom-testnet')).toBe(false);
        expect(isNativeFeeMandatory(123)).toBe(false);
    });

    it('labels only recognized protocol coins after normalization', () => {
        expect(protocolCoinTickerFor('  bitcoin-testnet ')).toBe('BTC');
        expect(protocolCoinTickerFor({ coin: 'DOGE' })).toBe('DOGE');
        expect(protocolCoinTickerFor('custom-mainnet')).toBe('');
        expect(protocolCoinTickerFor(false)).toBe('');
    });
});
