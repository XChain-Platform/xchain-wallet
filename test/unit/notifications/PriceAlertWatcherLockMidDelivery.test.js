// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { PriceAlertWatcher } from '../../../packages/core/src/notifications/PriceAlertWatcher.js';

function armed(id) {
    return {
        id,
        chainId: 'bitcoin-mainnet',
        direction: 'above',
        targetFiat: 100,
        fiatCurrency: 'usd',
        status: 'armed',
    };
}

describe('PriceAlertWatcher lock during delivery', () => {
    it('delivers no further alert once the watcher stops mid-poll', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const delivered = [];
        const markTriggered = vi.fn(async () => {});
        const watcher = new PriceAlertWatcher({
            getNativePrices: async () => ({ prices: { 'bitcoin-mainnet': { priceFiat: 200 } } }),
            listArmedAlerts: async () => [armed('a'), armed('b'), armed('c')],
            getSettings: async () => ({ notifications: { priceAlerts: true } }),
            notify: async (n) => {
                delivered.push(n.data.alertId);
                if (n.data.alertId === 'a') await gate;
                return true;
            },
            markTriggered,
            intervalMs: 1e9,
        });

        const poll = watcher.pollOnce();
        await vi.waitFor(() => expect(delivered).toEqual(['a']));
        watcher.stop();
        release();
        await poll;

        expect(delivered).toEqual(['a']);
        expect(markTriggered.mock.calls.map((c) => c[0])).not.toContain('b');
    });
});
