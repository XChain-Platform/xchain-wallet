// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    nativeWatchChart,
    watchRowMeta,
} from '../../../packages/core/src/watch/watchRowMeta.js';

describe('nativeWatchChart', () => {
    it('builds a chart from the native price entry', () => {
        const sparkline = Array.from({ length: 168 }, (_, index) => index + 1);
        const chart = nativeWatchChart({ ETH: { sparkline } }, 'ETH');

        expect(chart.points).toHaveLength(48);
        expect(chart.points.at(-1)).toBe(168);
        expect(chart.up).toBe(true);
    });

    it('returns null without a usable native series', () => {
        expect(nativeWatchChart({ ETH: { sparkline: [1] } }, 'ETH')).toBeNull();
        expect(nativeWatchChart({ ETH: null }, 'ETH')).toBeNull();
        expect(nativeWatchChart(undefined, 'ETH')).toBeNull();
    });
});

describe('watchRowMeta', () => {
    it('reports native detail only when a chart is available', () => {
        const row = { kind: 'native', chainId: 'ETH', tick: 'ETH' };
        const nativePriceMap = { ETH: { sparkline: [1, 2] } };

        expect(watchRowMeta(row, { nativePriceMap })).toEqual({
            chainId: 'ETH',
            tick: 'ETH',
            tickerColor: '#1A74A8',
            unavailable: false,
            hasDetail: true,
        });
        expect(watchRowMeta(row, { nativePriceMap: { ETH: null } }).hasDetail).toBe(false);
    });

    it('reports token detail only when the cache predicate returns true', () => {
        const row = { kind: 'token', chainId: 'ETH', tick: 'USDC' };
        const cached = vi.fn(() => true);
        const uncached = vi.fn(() => false);

        expect(watchRowMeta(row, { hasCachedTokenInfo: cached }).hasDetail).toBe(true);
        expect(cached).toHaveBeenCalledWith('ETH', 'USDC');
        expect(watchRowMeta(row, { hasCachedTokenInfo: uncached }).hasDetail).toBe(false);
        expect(watchRowMeta(row, { hasCachedTokenInfo: () => 1 }).hasDetail).toBe(false);
    });

    it('normalizes unavailable and tolerates an absent options object', () => {
        const unavailable = watchRowMeta({
            kind: 'token',
            chainId: 'BTC',
            tick: 'BTC',
            unavailable: true,
        });

        expect(unavailable.unavailable).toBe(true);
        expect(unavailable.hasDetail).toBe(false);
        expect(watchRowMeta({
            kind: 'token',
            chainId: 'BTC',
            tick: 'BTC',
            unavailable: 1,
        }).unavailable).toBe(false);
    });

    it('emits only ticker colors accepted by the row schema', () => {
        const colors = new Set(Array.from({ length: 400 }, (_, index) => (
            watchRowMeta({ kind: 'token', chainId: 'ETH', tick: `T${index}X${index * 7}` })
                .tickerColor
        )));

        expect(colors).toHaveLength(15);
        for (const color of colors) expect(color).toMatch(/^#[0-9A-F]{6}$/);
    });
});
