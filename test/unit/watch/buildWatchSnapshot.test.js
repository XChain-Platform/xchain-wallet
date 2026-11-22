// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    buildWatchSnapshot,
    SNAPSHOT_BUDGET_BYTES,
} from '../../../packages/core/src/watch/buildWatchSnapshot.js';
import {
    explainMessage,
    validateMessage,
} from '../../../packages/core/src/watch/contract/index.js';

const NOW = 1_700_000_000_000;
const request = Object.freeze({
    id: '0123456789abcdef0123456789abcdef',
    kind: 'request',
    iconHash: '',
    sentence: 'Review this request on your phone',
    amountText: '0.50 BTC',
});

const state = (overrides = {}) => ({
    rows: [{
        chainId: 'bitcoin-mainnet',
        tick: 'BTC',
        kind: 'native',
        displayName: 'Bitcoin',
        quantity: '50',
        pendingQuantity: '0',
        divisibility: 2,
        fiatRate: 40000,
        imageUrl: 'btc-image',
    }],
    settings: {
        activeNetwork: 'mainnet',
        fiatCurrency: 'USD',
        watch: { enabled: true, showTotal: true, startIn: 'fiat' },
    },
    session: 'unlocked',
    walletName: 'Daily wallet',
    accountId: 'account-1',
    activeAccountId: 'account-1',
    hashByImageUrl: { 'btc-image': 'btc-icon-cache' },
    nativePriceMap: { 'bitcoin-mainnet': { sparkline: [1, 2] } },
    activeByChain: {},
    inbox: [],
    request,
    ...overrides,
});

describe('buildWatchSnapshot', () => {
    it('composes the published home state into a schema-valid v1 snapshot', () => {
        const input = state();
        const before = structuredClone(input);
        const result = buildWatchSnapshot(input, { now: NOW });

        expect(explainMessage('snapshot', result)).toEqual([]);
        expect(validateMessage('snapshot', result)).toBe(true);
        expect(result).toMatchObject({
            v: 1,
            builtAt: NOW,
            balancesAt: NOW,
            pricesAt: NOW,
            rows: [{ id: 'bitcoin-mainnet:BTC', amountText: '0.50 BTC' }],
            capped: false,
            request,
            settings: { enabled: true, showTotal: true },
        });
        expect(input).toEqual(before);
    });

    it('uses supplied freshness times without reading the clock', () => {
        const result = buildWatchSnapshot(state({
            now: 11,
            balancesAt: 7,
            pricesAt: 9,
        }));

        expect(result).toMatchObject({ builtAt: 11, balancesAt: 7, pricesAt: 9 });
    });

    it('clears wallet data when Show wallet on watch is off', () => {
        const result = buildWatchSnapshot(state({
            hidden: true,
            inbox: [{ id: 'not-sent' }],
            settings: { watch: { enabled: false, showTotal: false } },
        }), { now: NOW });

        expect(validateMessage('snapshot', result)).toBe(true);
        expect(result).toMatchObject({
            hidden: false,
            walletName: '',
            totals: { fiatText: '', unitsText: 'Balances' },
            rows: [],
            capped: false,
            receive: [],
            inbox: [],
            request,
            settings: { enabled: false, showTotal: false },
        });
    });

    it('drops rows only from the tail to fit the 60 KiB budget', () => {
        const rows = Array.from({ length: 50 }, (_, index) => ({
            chainId: 'bitcoin-mainnet',
            tick: `T${index}${'X'.repeat(1_500)}`,
            kind: 'token',
            displayName: `Token ${index}`,
            quantity: String(index + 1),
            pendingQuantity: '0',
            divisibility: 0,
            fiatRate: null,
        }));
        const result = buildWatchSnapshot(state({ rows }), { now: NOW });

        expect(new TextEncoder().encode(JSON.stringify(result)).length)
            .toBeLessThanOrEqual(SNAPSHOT_BUDGET_BYTES);
        expect(result.rows.length).toBeLessThan(rows.length);
        expect(result.rows.map(({ tick }) => tick)).toEqual(
            rows.slice(0, result.rows.length).map(({ tick }) => tick),
        );
        expect(result.capped).toBe(true);
    });
});
