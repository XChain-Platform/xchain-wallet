// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { explorerPageUrl } from '../../../packages/core/src/shared/utils/explorerLinks.js';
import { safeHttpUrl } from '../../../packages/core/src/shared/utils/externalUrl.js';

const CHAIN_CASES = [
    ['bitcoin-mainnet', 'BTC', 'https://explorer.xchain.io'],
    ['bitcoin-testnet', 'TBTC', 'https://explorer.xchain.io'],
    ['bitcoin-regtest', 'RBTC', 'http://localhost:18080'],
    ['litecoin-mainnet', 'LTC', 'https://explorer.xchain.io'],
    ['litecoin-testnet', 'TLTC', 'https://explorer.xchain.io'],
    ['litecoin-regtest', 'RLTC', 'http://localhost:18080'],
    ['dogecoin-mainnet', 'DOGE', 'https://explorer.xchain.io'],
    ['dogecoin-testnet', 'TDOGE', 'https://explorer.xchain.io'],
    ['dogecoin-regtest', 'RDOGE', 'http://localhost:18080'],
];

const PAGE_CASES = [
    ['transaction', 'tx'],
    ['address', 'address'],
    ['block', 'block'],
];

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
    it.each(CHAIN_CASES.flatMap(([chainId, coin, base]) => (
        PAGE_CASES.map(([kind, segment]) => [chainId, kind, coin, base, segment])
    )))('builds the configured %s %s page', (chainId, kind, coin, base, segment) => {
        expect(explorerPageUrl({ chainId, kind, value: 'id /?#%ü' }))
            .toBe(`${base}/${coin}/${segment}/id%20%2F%3F%23%25%C3%BC`);
    });

    it.each(CHAIN_CASES.flatMap(([chainId, coin]) => (
        PAGE_CASES.map(([kind, segment]) => [chainId, kind, coin, segment])
    )))('isolates the %s endpoint override for %s pages', (chainId, kind, coin, segment) => {
        const settings = {
            sdkEndpoints: Object.fromEntries(CHAIN_CASES.map(([id]) => [id, {
                custom: true,
                explorerUrl: `https://${id}.example/explorer/`,
            }])),
        };

        expect(explorerPageUrl({
            chainId,
            kind,
            value: 'abc123',
            settings,
        })).toBe(`https://${chainId}.example/explorer/${coin}/${segment}/abc123`);
    });

    it.each([
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
