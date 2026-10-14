// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { PriceAlertWatcher } from '../../../packages/core/src/notifications/PriceAlertWatcher.js';

function alert(overrides = {}) {
    return {
        id: 'alert-1',
        chainId: 'bitcoin-mainnet',
        direction: 'above',
        targetFiat: 100,
        fiatCurrency: 'usd',
        status: 'armed',
        ...overrides,
    };
}

function makeLogger() {
    return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeWatcher(overrides = {}) {
    const logger = overrides.logger || makeLogger();
    const notify = overrides.notify || vi.fn(async () => true);
    const markTriggered = overrides.markTriggered || vi.fn(async () => {});
    const watcher = new PriceAlertWatcher({
        getNativePrices: overrides.getNativePrices || vi.fn(async ({ chainIds }) => ({
            prices: Object.fromEntries(chainIds.map((chainId) => [chainId, { priceFiat: 101 }])),
        })),
        listArmedAlerts: overrides.listArmedAlerts || vi.fn(async () => [alert()]),
        getSettings: overrides.getSettings || vi.fn(async () => ({
            privacy: { priceDataEnabled: true },
            notifications: { priceAlerts: true },
        })),
        notify,
        markTriggered,
        logger,
    });
    return { watcher, logger, notify, markTriggered };
}

describe('PriceAlertWatcher guard and error edges', () => {
    it('names each missing required dependency', () => {
        const valid = {
            getNativePrices: vi.fn(),
            listArmedAlerts: vi.fn(),
            getSettings: vi.fn(),
            notify: vi.fn(),
            markTriggered: vi.fn(),
        };
        for (const key of Object.keys(valid)) {
            expect(() => new PriceAlertWatcher({ ...valid, [key]: null })).toThrow(key);
        }
    });

    it('contains settings, alert-list, and oracle failures independently', async () => {
        const cases = [
            ['getSettings failed', { getSettings: vi.fn(async () => { throw new Error('settings secret'); }) }],
            ['listArmedAlerts failed', { listArmedAlerts: vi.fn(async () => { throw new Error('list secret'); }) }],
            ['getNativePrices failed', { getNativePrices: vi.fn(async () => { throw new Error('oracle secret'); }) }],
        ];

        for (const [message, overrides] of cases) {
            const logger = makeLogger();
            const { watcher, notify } = makeWatcher({ logger, ...overrides });
            await expect(watcher.pollOnce()).resolves.toBeUndefined();
            expect(notify).not.toHaveBeenCalled();
            expect(logger.error.mock.calls[0]).toEqual([
                `[price-alert] PriceAlertWatcher: ${message}`,
                '<Error>',
            ]);
            expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret');
        }
    });

    it('drops an overlapping poll while the first settings read is pending', async () => {
        let resolveSettings;
        const getSettings = vi.fn(() => new Promise((resolve) => { resolveSettings = resolve; }));
        const listArmedAlerts = vi.fn(async () => []);
        const { watcher } = makeWatcher({ getSettings, listArmedAlerts });

        const first = watcher.pollOnce();
        await watcher.pollOnce();
        expect(getSettings).toHaveBeenCalledTimes(1);
        expect(listArmedAlerts).not.toHaveBeenCalled();
        resolveSettings({ notifications: { priceAlerts: true } });
        await first;
        expect(listArmedAlerts).toHaveBeenCalledTimes(1);
    });

    it('filters malformed and non-armed alert rows before fetching prices', async () => {
        const getNativePrices = vi.fn();
        const { watcher } = makeWatcher({
            getNativePrices,
            listArmedAlerts: vi.fn(async () => [null, {}, alert({ status: 'triggered' })]),
        });

        await watcher.pollOnce();
        expect(getNativePrices).not.toHaveBeenCalled();
    });
});

describe('PriceAlertWatcher value boundaries', () => {
    it('ignores non-finite prices and unknown directions', async () => {
        const getNativePrices = vi.fn(async () => ({
            prices: {
                'bitcoin-mainnet': { priceFiat: Number.NaN },
                'litecoin-mainnet': { priceFiat: 500 },
            },
        }));
        const { watcher, notify, markTriggered } = makeWatcher({
            getNativePrices,
            listArmedAlerts: vi.fn(async () => [
                alert(),
                alert({ id: 'alert-2', chainId: 'litecoin-mainnet', direction: 'sideways' }),
            ]),
        });

        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
        expect(markTriggered).not.toHaveBeenCalled();
    });

    it('formats fractional non-USD targets and falls back to a raw chain id', async () => {
        const { watcher, notify } = makeWatcher({
            listArmedAlerts: vi.fn(async () => [alert({
                chainId: '-private',
                targetFiat: 1_234.5,
                fiatCurrency: 'EUR',
            })]),
            getNativePrices: vi.fn(async () => ({ prices: { '-private': { priceFiat: 2_000 } } })),
        });

        await watcher.pollOnce();
        expect(notify.mock.calls[0][0].body).toBe('-private rose above 1,234.5 EUR.');
    });

    it('clears the in-session fired guard on stop', async () => {
        const notify = vi.fn(async () => true);
        const { watcher } = makeWatcher({ notify });

        await watcher.pollOnce();
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        watcher.stop();
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(2);
    });
});
