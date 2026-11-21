// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildWatchDetail } from '../../../packages/core/src/watch/buildWatchDetail.js';
import {
    clearTokenInfoCache,
    tokenInfoCacheKey,
    writeTokenInfoCache,
} from '../../../packages/core/src/shared/utils/tokenInfoCache.js';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const detailSchema = JSON.parse(readFileSync('packages/core/src/watch/contract/detail.schema.json'));

const tokenRow = {
    id: 'bitcoin-mainnet:XC',
    kind: 'token',
    chainId: 'bitcoin-mainnet',
    tick: 'XC',
    change24hPct: 4.75,
    fiatRateSource: 'market',
};

afterEach(() => clearTokenInfoCache());

describe('buildWatchDetail', () => {
    it('returns null for an uncached token', () => {
        expect(buildWatchDetail(tokenRow)).toBeNull();
    });

    it('builds token facts, cached text, price labels and artwork without a read', () => {
        const description = `A useful token ${'with a long cached description '.repeat(12)}`;
        const info = {
            totalSupply: '1000000',
            divisibility: 6,
            locked: false,
            creator: 'xc1qabcdefghijklmnopqrstuvwxyz7pq999',
            description,
            imageUrl: 'https://images.example/xc.png',
        };
        writeTokenInfoCache(tokenInfoCacheKey(tokenRow.chainId, tokenRow.tick), info);

        const detail = buildWatchDetail(tokenRow, {
            hashByImageUrl: new Map([[info.imageUrl, 'art-hash']]),
        });

        expect(detail).toEqual({
            v: 1,
            tokenId: tokenRow.id,
            artworkHash: 'art-hash',
            changeText: '+4.75% over 24 h',
            priceSourceText: 'XChain DEX',
            facts: [
                { label: 'Type', value: 'Token' },
                { label: 'Supply', value: '1,000,000 XC' },
                { label: 'Divisibility', value: '6 decimals' },
                { label: 'Status', value: 'Mutable' },
                { label: 'Creator', value: 'xc1qab…7pq999' },
            ],
            description: expect.any(String),
        });
        expect([...detail.description].length).toBeLessThanOrEqual(280);
        expect(detail.description.endsWith('…')).toBe(true);
        expect(validate(detailSchema, detail)).toEqual([]);
    });

    it('accepts the one freshly fetched record and omits absent optional text', () => {
        const detail = buildWatchDetail({
            ...tokenRow,
            id: 'bitcoin-mainnet:ONE',
            kind: 'subtoken',
            tick: 'ONE',
            change24hPct: null,
            fiatRateSource: null,
        }, {
            tokenInfo: {
                totalSupply: '1',
                divisibility: 1,
                locked: true,
                creator: 'short',
                description: '   ',
            },
        });

        expect(detail).toEqual({
            v: 1,
            tokenId: 'bitcoin-mainnet:ONE',
            facts: [
                { label: 'Type', value: 'Subtoken' },
                { label: 'Supply', value: '1 ONE' },
                { label: 'Divisibility', value: '1 decimal' },
                { label: 'Status', value: 'Locked' },
                { label: 'Creator', value: 'short' },
            ],
        });
    });

    it('builds native detail from the native price map alone', () => {
        const sparkline = Array.from({ length: 168 }, (_, index) => 200 - index);
        const detail = buildWatchDetail({
            id: 'native:btc',
            kind: 'native',
            chainId: 'bitcoin-mainnet',
            tick: 'BTC',
            change24hPct: 99,
            fiatRateSource: 'market',
        }, {
            nativePriceMap: {
                'bitcoin-mainnet': { change24hPct: -8.1, sparkline },
            },
            tokenInfo: { description: 'must not appear' },
            artworkHash: 'must-not-appear',
        });

        expect(detail).toMatchObject({
            v: 1,
            tokenId: 'native:btc',
            changeText: '-8.10% over 24 h',
            priceSourceText: 'CoinGecko',
            chart: { up: false },
        });
        expect(detail.chart.points).toHaveLength(48);
        expect(detail).not.toHaveProperty('facts');
        expect(detail).not.toHaveProperty('artworkHash');
        expect(validate(detailSchema, detail)).toEqual([]);
    });

    it('returns null when a native map has no usable cached chart', () => {
        const row = { id: 'native:btc', kind: 'native', chainId: 'bitcoin-mainnet', tick: 'BTC' };

        expect(buildWatchDetail(row, { nativePriceMap: {} })).toBeNull();
        expect(buildWatchDetail(row, {
            nativePriceMap: { 'bitcoin-mainnet': { sparkline: [42] } },
        })).toBeNull();
    });
});
