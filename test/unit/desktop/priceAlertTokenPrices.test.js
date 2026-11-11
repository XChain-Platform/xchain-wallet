/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The desktop shell hands the price-alert watcher a token price source built
// from the chain registry and the user's price-data setting.

import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    watcherArgs: [],
    lookupArgs: [],
    lookup: null,
    settings: { privacy: { priceDataEnabled: true } },
    withLookup: true,
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    class Inert { async start() {} stop() {} async refresh() {} }
    class Spy extends Inert {
        constructor(args) { super(); hoisted.watcherArgs.push(args); }
    }
    const notifications = new Proxy({ ...actual.notifications }, {
        get(target, key) {
            if (key === 'PriceAlertWatcher') return Spy;
            if (key === 'NotificationService' || key === 'GovernancePollWatcher' || key === 'DeadlineWatcher') {
                return Inert;
            }
            if (key === 'createTokenPriceLookup') {
                if (!hoisted.withLookup) return undefined;
                return (deps) => {
                    hoisted.lookupArgs.push(deps);
                    return hoisted.lookup;
                };
            }
            return target[key];
        },
    });
    return {
        ...actual,
        notifications,
        flows: { ...actual.flows, getSettings: async () => hoisted.settings },
    };
});

import { createRuntime, ensureHost } from '../../../packages/desktop/main/runtime.js';

function memoryBackend(initial = null) {
    let blob = initial;
    return {
        load: async () => blob,
        save: async (b) => { blob = b; },
        clear: async () => { blob = null; },
    };
}

function runtimeWithNotify() {
    return createRuntime({
        storageBackend: memoryBackend(),
        sessionBackend: memoryBackend(new Uint8Array(32).fill(7)),
        metaBackend: memoryBackend(),
        chainRegistry: { id: 'registry' },
        sdkRegistry: { get: () => ({}), async has() { return true; }, async listChainIds() { return []; } },
        notify: vi.fn(),
    });
}

describe('desktop price-alert watcher token prices', () => {
    it('passes a getTokenPrices that reads the setting on each poll', async () => {
        hoisted.watcherArgs.length = 0;
        hoisted.lookupArgs.length = 0;
        hoisted.withLookup = true;
        hoisted.lookup = vi.fn(async () => ({ prices: {} }));
        const runtime = runtimeWithNotify();
        await ensureHost(runtime);

        expect(hoisted.watcherArgs).toHaveLength(1);
        const { getTokenPrices } = hoisted.watcherArgs[0];
        expect(typeof getTokenPrices).toBe('function');
        expect(hoisted.lookupArgs[0].chainRegistry).toBe(runtime.chainRegistry);

        const req = { items: [{ chainId: 'c', tick: 'PEPE' }], fiatCurrency: 'USD' };
        hoisted.settings = { privacy: { priceDataEnabled: false } };
        await expect(getTokenPrices(req)).resolves.toEqual({ prices: {} });
        expect(hoisted.lookup).toHaveBeenCalledWith(req);
        expect(hoisted.lookupArgs[0].allowCoingeckoFallback()).toBe(false);

        hoisted.settings = { privacy: { priceDataEnabled: true } };
        await getTokenPrices(req);
        expect(hoisted.lookupArgs[0].allowCoingeckoFallback()).toBe(true);
    });

    it('still starts the watcher when core has no token lookup export', async () => {
        hoisted.watcherArgs.length = 0;
        hoisted.withLookup = false;
        const runtime = runtimeWithNotify();
        await ensureHost(runtime);

        expect(hoisted.watcherArgs).toHaveLength(1);
        expect(hoisted.watcherArgs[0].getTokenPrices).toBeUndefined();
        expect(typeof hoisted.watcherArgs[0].getNativePrices).toBe('function');
        expect(runtime.priceAlertWatcher).not.toBeNull();
    });
});
