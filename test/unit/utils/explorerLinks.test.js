// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { explorerPageUrl } from '../../../packages/core/src/shared/utils/explorerLinks.js';
import { safeHttpUrl } from '../../../packages/core/src/shared/utils/externalUrl.js';

describe('safeHttpUrl', () => {
    it.each([
        ['https://example.com/help', 'https://example.com/help'],
        [' http://localhost:8080/path ', 'http://localhost:8080/path'],
        ['javascript:alert(1)', null],
        ['data:text/html,<script>alert(1)</script>', null],
        ['//example.com/path', null],
        ['/relative', null],
        ['not a url', null],
        [null, null],
    ])('normalizes link candidate %j', (value, expected) => {
        expect(safeHttpUrl(value)).toBe(expected);
    });
});

describe('explorerPageUrl', () => {
    it.each([
        ['bitcoin-mainnet', 'transaction', 'abc123', 'https://explorer.xchain.io/BTC/tx/abc123'],
        ['litecoin-testnet', 'address', 'tltc1 q', 'https://explorer.xchain.io/TLTC/address/tltc1%20q'],
        ['dogecoin-regtest', 'token', 'DOGE.CAT', 'http://localhost:18080/RDOGE/token/DOGE.CAT'],
        ['bitcoin-regtest', 'dispenser', 42, 'http://localhost:18080/RBTC/dispenser/42'],
        ['litecoin-mainnet', 'action', 0, 'https://explorer.xchain.io/LTC/action/0'],
    ])('builds the %s %s route', (chainId, kind, value, expected) => {
        expect(explorerPageUrl({ chainId, kind, value })).toBe(expected);
    });

    it('honours a custom explorer endpoint from Settings', () => {
        const settings = {
            sdkEndpoints: {
                'bitcoin-testnet': {
                    custom: true,
                    explorerUrl: 'https://operator.example/explorer/',
                },
            },
        };

        expect(explorerPageUrl({
            chainId: 'bitcoin-testnet',
            kind: 'transaction',
            value: 'deadbeef',
            settings,
        })).toBe('https://operator.example/explorer/TBTC/tx/deadbeef');
    });

    it.each(['javascript:alert(1)', 'data:text/html,explorer'])(
        'refuses a non-HTTP custom explorer endpoint: %s',
        (explorerUrl) => {
            expect(explorerPageUrl({
                chainId: 'bitcoin-testnet',
                kind: 'transaction',
                value: 'deadbeef',
                settings: {
                    sdkEndpoints: {
                        'bitcoin-testnet': { custom: true, explorerUrl },
                    },
                },
            })).toBeNull();
        },
    );

    it.each([
        [{ chainId: 'bitcoin-mainnet', kind: 'transaction', value: '' }],
        [{ chainId: 'unknown-mainnet', kind: 'transaction', value: 'abc' }],
        [{ chainId: 'bitcoin-mainnet', kind: 'unknown', value: 'abc' }],
    ])('returns null for an incomplete route', (input) => {
        expect(explorerPageUrl(input)).toBeNull();
    });
});
