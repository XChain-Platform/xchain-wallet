// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the §46 PriceAlertWatcher. getNativePrices is a spy that
// returns a fixed price; listArmedAlerts is a mutable array; notify +
// markTriggered are spies. pollOnce() is driven directly so no real timers.

import { describe, it, expect, vi } from 'vitest';
import { PriceAlertWatcher } from '../../../packages/core/src/notifications/PriceAlertWatcher.js';

function armedAlert(over = {}) {
    return {
        id: over.id || 'a1',
        walletId: 'w1',
        chainId: 'bitcoin-mainnet',
        direction: 'above',
        targetFiat: 70000,
        fiatCurrency: 'usd',
        status: 'armed',
        triggeredAt: null,
        ...over,
    };
}

function makeWatcher(over = {}) {
    const alerts = over.alerts || [armedAlert()];
    const settings = over.settings || {
        privacy: { priceDataEnabled: true },
        notifications: { priceAlerts: true },
    };
    const price = over.price ?? 71000;
    const getNativePrices = over.getNativePrices
        || vi.fn(async ({ chainIds }) => ({
            prices: Object.fromEntries(chainIds.map((c) => [c, { priceFiat: price }])),
        }));
    const notify = vi.fn(async () => {});
    const markTriggered = over.markTriggered
        || vi.fn(async (id) => {
            const a = alerts.find((x) => x.id === id);
            if (a) a.status = 'triggered';
        });
    const listArmedAlerts = vi.fn(async () => alerts.map((a) => ({ ...a })));
    const getSettings = vi.fn(async () => settings);
    const watcher = new PriceAlertWatcher({
        getNativePrices,
        listArmedAlerts,
        getSettings,
        notify,
        markTriggered,
    });
    return { watcher, getNativePrices, notify, markTriggered, listArmedAlerts, getSettings, alerts, settings };
}

describe('PriceAlertWatcher', () => {
    it('fires an "above" alert when price >= target, then marks it triggered', async () => {
        const { watcher, notify, markTriggered } = makeWatcher({ price: 71000 });
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        const n = notify.mock.calls[0][0];
        expect(n.kind).toBe('price-alert');
        expect(n.body).toContain('Bitcoin');
        expect(n.body).toContain('$70,000');
        expect(markTriggered).toHaveBeenCalledWith('a1');
    });

    it('fires a "below" alert when price <= target', async () => {
        const { watcher, notify } = makeWatcher({
            alerts: [armedAlert({ direction: 'below', targetFiat: 60000 })],
            price: 59000,
        });
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0].body).toContain('fell below');
    });

    it('does NOT fire when the threshold is not crossed', async () => {
        const { watcher, notify, markTriggered } = makeWatcher({ price: 69000 }); // above-70k not met
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
        expect(markTriggered).not.toHaveBeenCalled();
    });

    it('is one-shot — does not re-fire on a second poll in the same session', async () => {
        const { watcher, notify } = makeWatcher({ price: 71000 });
        await watcher.pollOnce();
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('makes NO price fetch when priceDataEnabled is off', async () => {
        const { watcher, getNativePrices, notify } = makeWatcher({
            settings: { privacy: { priceDataEnabled: false }, notifications: { priceAlerts: true } },
        });
        await watcher.pollOnce();
        expect(getNativePrices).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it('makes NO price fetch when the priceAlerts toggle is off', async () => {
        const { watcher, getNativePrices } = makeWatcher({
            settings: { privacy: { priceDataEnabled: true }, notifications: { priceAlerts: false } },
        });
        await watcher.pollOnce();
        expect(getNativePrices).not.toHaveBeenCalled();
    });

    it('makes NO price fetch when there are no armed alerts', async () => {
        const { watcher, getNativePrices } = makeWatcher({ alerts: [] });
        await watcher.pollOnce();
        expect(getNativePrices).not.toHaveBeenCalled();
    });

    it('skips alerts whose chain has no price data (null priceFiat)', async () => {
        const getNativePrices = vi.fn(async ({ chainIds }) => ({
            prices: Object.fromEntries(chainIds.map((c) => [c, { priceFiat: null }])),
        }));
        const { watcher, notify } = makeWatcher({ getNativePrices });
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('bails on a {disabled:true} oracle result', async () => {
        const getNativePrices = vi.fn(async () => ({ disabled: true }));
        const { watcher, notify } = makeWatcher({ getNativePrices });
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('groups distinct chains into one fetch per fiat currency', async () => {
        const getNativePrices = vi.fn(async ({ chainIds }) => ({
            prices: Object.fromEntries(chainIds.map((c) => [c, { priceFiat: 100000 }])),
        }));
        const { watcher, notify } = makeWatcher({
            alerts: [
                armedAlert({ id: 'a1', chainId: 'bitcoin-mainnet', targetFiat: 70000 }),
                armedAlert({ id: 'a2', chainId: 'litecoin-mainnet', targetFiat: 80 }),
            ],
            getNativePrices,
        });
        await watcher.pollOnce();
        expect(getNativePrices).toHaveBeenCalledTimes(1);
        expect(getNativePrices.mock.calls[0][0].chainIds).toEqual(['bitcoin-mainnet', 'litecoin-mainnet']);
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('re-fires after the alert is re-armed (new watcher session)', async () => {
        const alerts = [armedAlert()];
        const { watcher, notify } = makeWatcher({ alerts, price: 71000 });
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        // operator re-arms; a fresh poll in a NEW session should fire again
        alerts[0].status = 'armed';
        const second = makeWatcher({ alerts, price: 71000 });
        await second.watcher.pollOnce();
        expect(second.notify).toHaveBeenCalledTimes(1);
    });
});
