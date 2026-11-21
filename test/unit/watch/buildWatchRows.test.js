// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { tickerColor } from '../../../packages/core/src/ui/AssetMark.jsx';
import { buildWatchRows } from '../../../packages/core/src/watch/buildWatchRows.js';

function row(tick, overrides = {}) {
    return {
        chainId: 'bitcoin-mainnet',
        tick,
        kind: 'token',
        displayName: `${tick} token`,
        quantity: '125000000',
        pendingQuantity: '25000000',
        divisibility: 8,
        fiatRate: 2,
        imageUrl: `token-image:${tick}`,
        ...overrides,
    };
}

describe('buildWatchRows', () => {
    it('projects formatted schema rows from injected published data', () => {
        const source = row('TOK');
        const result = buildWatchRows([source], {
            settings: { fiatCurrency: 'EUR', numberFormat: 'trim' },
            hashByImageUrl: new Map([[source.imageUrl, 'icon-hash']]),
            tokenInfoByKey: new Map([['bitcoin-mainnet:TOK', { creator: 'issuer' }]]),
        });

        expect(result).toEqual({
            capped: false,
            rows: [{
                id: 'bitcoin-mainnet:TOK',
                chainId: 'bitcoin-mainnet',
                tick: 'TOK',
                displayName: 'TOK token',
                amountText: '1.25 TOK',
                fiatText: '€2.50',
                noPrice: false,
                pendingText: '0.25 TOK pending',
                unavailable: false,
                iconHash: 'icon-hash',
                tickerColor: tickerColor('TOK'),
                hasDetail: true,
            }],
        });
        expect(source).toEqual(row('TOK'));
    });

    it('uses glyph fields until images and token details are cached', () => {
        const unpriced = row('LONG', {
            displayName: 'x'.repeat(70),
            fiatRate: null,
            pendingQuantity: '0',
            unavailable: 'all',
        });

        expect(buildWatchRows([unpriced]).rows[0]).toMatchObject({
            displayName: 'x'.repeat(64),
            fiatText: 'No price yet',
            noPrice: true,
            pendingText: '',
            unavailable: true,
            iconHash: '',
            hasDetail: false,
        });
    });

    it('gives native rows detail only when their published price entry has a sparkline', () => {
        const native = row('BTC', { kind: 'native', imageUrl: null });
        expect(buildWatchRows([native], {
            nativePriceMap: { 'bitcoin-mainnet': { priceFiat: 75_000 } },
        }).rows[0].hasDetail).toBe(false);
        expect(buildWatchRows([native], {
            nativePriceMap: { 'bitcoin-mainnet': { sparkline: [70_000, 75_000] } },
        }).rows[0].hasDetail).toBe(true);
    });

    it('applies pinned-only, the small-balance rule, and the fixed 50-row cap', () => {
        const pinned = row('PIN', { quantity: '1', pendingQuantity: '0' });
        const small = row('SMALL', { quantity: '1', pendingQuantity: '0' });
        const large = Array.from({ length: 51 }, (_, index) => row(`T${index}`));

        const filtered = buildWatchRows([small, pinned, ...large], {
            hideSmallBalances: true,
            smallBalanceFiat: '1',
            pinnedKeys: new Set(['bitcoin-mainnet:PIN']),
        });
        expect(filtered.capped).toBe(true);
        expect(filtered.rows.map(({ tick }) => tick)).toEqual([
            'PIN',
            ...large.slice(0, 49).map(({ tick }) => tick),
        ]);

        expect(buildWatchRows([small, pinned, ...large], {
            settings: { watch: { tokenMode: 'pinned' } },
            pinnedKeys: new Set(['bitcoin-mainnet:PIN']),
        })).toMatchObject({ capped: false, rows: [{ tick: 'PIN' }] });
    });
});
