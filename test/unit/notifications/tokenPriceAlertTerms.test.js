// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The watcher disarms a fired alert by handing markAlertTriggered the terms it
// fired under, and the flow compares them with the stored alert's key. A token
// alert whose two key formats drifted apart would notify on every poll and
// never disarm, so this drives a saved token alert through both halves.

import { describe, expect, it, vi } from 'vitest';
import { PriceAlertWatcher, alertTerms } from '../../../packages/core/src/notifications/PriceAlertWatcher.js';
import { markAlertTriggered, saveAlert } from '../../../packages/core/src/flows/priceAlerts.js';
import { priceAlertKey } from '../../../packages/core/src/schemas/priceAlert.js';

function memoryVault() {
    const rows = new Map();
    return {
        priceAlerts: {
            async findBy(field, value) { return [...rows.values()].filter((r) => r[field] === value); },
            async get(id) { return rows.get(id) || null; },
            async put(record) { rows.set(record.id, { ...record }); },
            async delete(id) { return rows.delete(id); },
            async list() { return [...rows.values()]; },
        },
    };
}

describe('token price alert terms', () => {
    it('match between the saved alert key and the watcher, so a fired token alert disarms', async () => {
        const vault = memoryVault();
        const saved = await saveAlert({
            vault,
            walletId: 'w1',
            chainId: 'bitcoin-mainnet',
            tick: ' xchain ',
            direction: 'above',
            targetFiat: 1.2,
            fiatCurrency: 'USD',
        });
        expect(saved.tick).toBe('XCHAIN');
        expect(alertTerms(saved)).toBe(priceAlertKey(saved));

        const notify = vi.fn(async () => {});
        const watcher = new PriceAlertWatcher({
            getNativePrices: vi.fn(async () => ({ prices: {} })),
            getTokenPrices: vi.fn(async ({ items }) => ({
                prices: Object.fromEntries(items.map(({ chainId, tick }) => [`${chainId}::${tick}`, { priceFiat: 1.5 }])),
            })),
            listArmedAlerts: () => vault.priceAlerts.list(),
            getSettings: async () => ({ privacy: { priceDataEnabled: true }, notifications: { priceAlerts: true } }),
            notify,
            markTriggered: (id, terms) => markAlertTriggered({ vault, id, terms }),
        });

        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        expect((await vault.priceAlerts.get(saved.id)).status).toBe('triggered');

        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('keeps the coin alert key unchanged', () => {
        const coin = { chainId: 'bitcoin-mainnet', direction: 'below', targetFiat: 50000, fiatCurrency: 'usd' };
        expect(priceAlertKey(coin)).toBe('bitcoin-mainnet::below::50000::usd');
        expect(alertTerms(coin)).toBe(priceAlertKey(coin));
    });
});
