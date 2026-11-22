// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWatchSnapshot } from '../../../packages/core/src/watch/buildWatchSnapshot.js';

const fixtureRoot = 'test/fixtures/watch';
const inputs = JSON.parse(readFileSync(`${fixtureRoot}/inputs/home-state.json`, 'utf8'));
const request = {
    id: '0123456789abcdef0123456789abcdef',
    kind: 'request',
    iconHash: '',
    sentence: 'Review this request on your phone',
    amountText: '0.50 BTC',
};

const standardRow = () => ({
    chainId: 'bitcoin-mainnet',
    tick: 'BTC',
    kind: 'native',
    displayName: 'Bitcoin',
    quantity: '50',
    pendingQuantity: '0',
    divisibility: 2,
    fiatRate: 40000,
    imageUrl: 'btc-image',
});

const manyRows = () => Array.from({ length: 50 }, (_, index) => {
    const value = index + 1;
    return {
        chainId: 'bitcoin-mainnet',
        tick: `T${String(value).padStart(2, '0')}`,
        kind: 'token',
        displayName: `Token ${String(value).padStart(2, '0')}`,
        quantity: String(value),
        pendingQuantity: '0',
        divisibility: 0,
        fiatRate: 1,
    };
});

function homeState(input) {
    let rows = [standardRow()];
    let walletName = 'Daily wallet';
    const settings = {
        activeNetwork: 'mainnet',
        fiatCurrency: 'USD',
        watch: {
            enabled: input.enabled ?? true,
            showTotal: input.enabled ?? true,
            startIn: 'fiat',
        },
    };
    const state = {
        rows,
        settings,
        session: input.session ?? 'unlocked',
        walletName,
        accountId: 'account-1',
        activeAccountId: 'account-1',
        hidden: input.hidden ?? false,
        balancesAt: input.now - (input.ageMs ?? 0),
        pricesAt: input.now - (input.ageMs ?? 0),
        hashByImageUrl: { 'btc-image': 'btc-icon-cache' },
        nativePriceMap: { 'bitcoin-mainnet': { sparkline: [1] } },
        activeByChain: {},
        inbox: [],
        request,
        capped: input.capped ?? false,
    };

    if (input.scenario === 'empty') state.rows = [];
    if (input.scenario === 'testnet') {
        state.rows[0].chainId = 'bitcoin-testnet';
        state.settings.activeNetwork = 'testnet';
        state.walletName = 'Test wallet';
        state.nativePriceMap = { 'bitcoin-testnet': { sparkline: [1] } };
    }
    if (input.scenario === 'unpriced') {
        state.rows = [{
            chainId: 'bitcoin-mainnet',
            tick: 'PEPECASH',
            kind: 'token',
            displayName: 'Pepe Cash',
            quantity: '1000',
            pendingQuantity: '0',
            divisibility: 0,
            fiatRate: null,
        }];
    }
    if (input.scenario === 'rows50') state.rows = manyRows();
    if (input.scenario === 'longnames') {
        state.walletName = `Wallet ${'W'.repeat(50)}`;
        state.totalRows = [standardRow()];
        state.rows = [{
            chainId: 'bitcoin-mainnet',
            tick: 'LONG',
            kind: 'token',
            displayName: `Extremely long asset name ${'N'.repeat(50)}`,
            quantity: '12345678912345678',
            pendingQuantity: '9999912345678',
            divisibility: 8,
            fiatRate: 1,
        }];
        state.tokenInfoByKey = { 'bitcoin-mainnet:LONG': {} };
    }
    return state;
}

describe('watch snapshot fixture regeneration', () => {
    it.each(Object.entries(inputs))('%s rebuilds byte-identically', (name, input) => {
        const path = `${fixtureRoot}/${name}.json`;
        const generated = `${JSON.stringify(
            buildWatchSnapshot(homeState(input), { now: input.now }),
            null,
            2,
        )}\n`;

        if (process.env.WATCH_FIXTURES_WRITE === '1') writeFileSync(path, generated);
        expect(generated).toBe(readFileSync(path, 'utf8'));
    });
});
