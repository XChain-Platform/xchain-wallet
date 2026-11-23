// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPLORER_BASE } from '../../../packages/core/src/branding/branding.js';
import {
    DEFAULT_EXPLORER_URL,
    EXPLORER_COINS,
    explorerBalancesUrl,
    readExplorerBalances,
} from '../../../packages/connect/src/explorerBalances.js';

describe('explorer balances URL', () => {
    it('maps all nine wallet chain ids to explorer coin codes', () => {
        expect(EXPLORER_COINS).toEqual({
            'bitcoin-mainnet': 'BTC',
            'bitcoin-testnet': 'TBTC',
            'bitcoin-regtest': 'RBTC',
            'litecoin-mainnet': 'LTC',
            'litecoin-testnet': 'TLTC',
            'litecoin-regtest': 'RLTC',
            'dogecoin-mainnet': 'DOGE',
            'dogecoin-testnet': 'TDOGE',
            'dogecoin-regtest': 'RDOGE',
        });
        expect(Object.isFrozen(EXPLORER_COINS)).toBe(true);
        expect(DEFAULT_EXPLORER_URL).toBe(DEFAULT_EXPLORER_BASE);

        for (const [chainId, coin] of Object.entries(EXPLORER_COINS)) {
            expect(explorerBalancesUrl(chainId, 'wallet-address'))
                .toBe(`${DEFAULT_EXPLORER_BASE}/${coin}/api/balances/wallet-address`);
        }
    });

    it('rejects an unknown chain with the public error code', () => {
        expect.assertions(4);
        for (const chainId of ['monero-mainnet', 'toString']) {
            try {
                explorerBalancesUrl(chainId, 'wallet-address');
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect(error.code).toBe('CHAIN_NOT_SUPPORTED');
            }
        }
    });

    it('percent-encodes the address path segment', () => {
        expect(explorerBalancesUrl('bitcoin-mainnet', 'address/with a?query'))
            .toBe(`${DEFAULT_EXPLORER_BASE}/BTC/api/balances/address%2Fwith%20a%3Fquery`);
    });

    it('uses an absolute override with or without a trailing slash', () => {
        const expected = 'http://127.0.0.1:3000/base/RBTC/api/balances/regtest-address';
        expect(explorerBalancesUrl('bitcoin-regtest', 'regtest-address', {
            explorerUrl: 'http://127.0.0.1:3000/base',
        })).toBe(expected);
        expect(explorerBalancesUrl('bitcoin-regtest', 'regtest-address', {
            explorerUrl: 'http://127.0.0.1:3000/base/',
        })).toBe(expected);
    });

    it.each([
        '',
        'relative/path',
        'ftp://explorer.example',
    ])('rejects a non-http absolute explorer override: %s', (explorerUrl) => {
        expect(() => explorerBalancesUrl('bitcoin-mainnet', 'wallet-address', { explorerUrl }))
            .toThrow(TypeError);
    });

    it.each(['', '   '])('rejects an empty address', (address) => {
        expect(() => explorerBalancesUrl('bitcoin-mainnet', address)).toThrow(TypeError);
    });
});

describe('explorer balances response', () => {
    it('keeps only tick and amount from every balance row', () => {
        expect(readExplorerBalances('wallet-address', {
            data: [
                { tick: 'XCHAIN', amount: '12.5', coin_price: 4, decimals: 8, supply: '1000' },
                { tick: 'BTC', amount: '0.25', coin_price: 90000, decimals: 8, supply: '21m' },
            ],
            total: 7,
        })).toEqual({
            address: 'wallet-address',
            data: [
                { tick: 'XCHAIN', amount: '12.5' },
                { tick: 'BTC', amount: '0.25' },
            ],
            total: 7,
        });
    });

    it('uses the data length when total is absent', () => {
        expect(readExplorerBalances('wallet-address', {
            data: [
                { tick: 'BTC', amount: '1' },
                { tick: 'LTC', amount: '2' },
            ],
        }).total).toBe(2);
    });

    it.each([
        null,
        'not an object',
        {},
        { data: null },
        { data: {} },
    ])('rejects a malformed body', (body) => {
        expect(() => readExplorerBalances('wallet-address', body)).toThrow(TypeError);
    });
});
