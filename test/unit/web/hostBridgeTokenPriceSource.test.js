// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The in-page host hands the price-alert watcher a token-ticker price
// source when the core build exports one, reads the price-data setting once
// per poll, and still starts the watcher exactly as before without it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    watcherOpts: [],
    lookupOpts: [],
    lookupCalls: [],
    settings: { privacy: { priceDataEnabled: true } },
    withExport: true,
    idle: [],
}));

vi.mock('../../../packages/core/src/notifications/PriceAlertWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    PriceAlertWatcher: class {
        constructor(opts) { h.watcherOpts.push(opts); }
        start() {}
        stop() {}
        refresh() { return Promise.resolve(); }
    },
}));
vi.mock('../../../packages/core/src/notifications/NotificationService.js', async (importOriginal) => ({
    ...(await importOriginal()),
    NotificationService: class { start() { return Promise.resolve(); } stop() {} refresh() { return Promise.resolve(); } },
}));
vi.mock('../../../packages/core/src/notifications/GovernancePollWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    GovernancePollWatcher: class { start() { return Promise.resolve(); } stop() {} refresh() { return Promise.resolve(); } },
}));
vi.mock('../../../packages/core/src/notifications/CoinpayAutopayWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    CoinpayAutopayWatcher: class { start() { return Promise.resolve(); } stop() {} refresh() { return Promise.resolve(); } },
}));
vi.mock('../../../packages/core/src/notifications/DeadlineWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    DeadlineWatcher: class { start() { return Promise.resolve(); } stop() {} refresh() { return Promise.resolve(); } },
}));
vi.mock('../../../packages/core/src/notifications/DispenserEscrowWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    DispenserEscrowWatcher: class { start() { return Promise.resolve(); } stop() {} refresh() { return Promise.resolve(); } },
}));
vi.mock('../../../packages/core/src/notifications/index.js', async (importOriginal) => {
    const actual = await importOriginal();
    const { createTokenPriceLookup: _drop, ...rest } = actual;
    // A getter lets one test file flip the export on and off between cases.
    return Object.defineProperty({ ...rest }, 'createTokenPriceLookup', {
        enumerable: true,
        get: () => (h.withExport ? (opts) => {
            h.lookupOpts.push(opts);
            return async (req) => {
                h.lookupCalls.push({ req, allow: opts.allowCoingeckoFallback() });
                return { prices: {} };
            };
        } : undefined),
    });
});
vi.mock('../../../packages/core/src/storage/Vault.js', async (importOriginal) => ({
    ...(await importOriginal()),
    Vault: class {
        async open() {}
        async save() {}
        setAutoSave() {}
        close() {}
    },
}));
vi.mock('../../../packages/core/src/signers/SignerPool.js', async (importOriginal) => ({
    ...(await importOriginal()),
    SignerPool: class { populate() { return Promise.resolve({}); } lockAll() {} },
}));
vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => ({
    ...(await importOriginal()),
    makeFreshKdfParams: () => ({ algorithm: 'argon2id' }),
    deriveMasterKeyAsync: async () => new Uint8Array(32).fill(9),
}));
vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: {
            ...actual.flows,
            createWallet: async () => ({ mnemonic: 'm', wallet: { id: 'w1', name: 'Main Wallet' } }),
            getSettings: async () => h.settings,
        },
    };
});
vi.mock('../../../packages/web/src/storage/backends.js', () => ({
    createStorageBackend: () => ({ load: async () => null, save: async () => {}, clear: async () => {} }),
    createMetaBackend: () => ({ load: async () => null, save: async () => {}, clear: async () => {} }),
    installNativeWipeHook: () => {},
    installNativeScreenGuard: () => {},
}));

const { createWalletLocal, lockWalletLocal } = await import('../../../packages/web/src/hostBridge.js');

/** Build the session and run the deferred watcher start. */
async function startSession() {
    await createWalletLocal({ password: 'pw' });
    for (const cb of h.idle.splice(0)) cb?.();
    expect(h.watcherOpts).toHaveLength(1);
    return h.watcherOpts[0];
}

beforeEach(async () => {
    await lockWalletLocal();
    h.watcherOpts.length = 0;
    h.lookupOpts.length = 0;
    h.lookupCalls.length = 0;
    h.idle.length = 0;
    h.settings = { privacy: { priceDataEnabled: true } };
    h.withExport = true;
    vi.stubGlobal('requestIdleCallback', (cb) => h.idle.push(cb));
    vi.stubGlobal('cancelIdleCallback', () => {});
});

describe('web host token price source for price alerts', () => {
    it('gives the watcher a getTokenPrices built over the chain registry', async () => {
        const opts = await startSession();
        expect(typeof opts.getTokenPrices).toBe('function');
        expect(h.lookupOpts).toHaveLength(1);
        expect(typeof h.lookupOpts[0].chainRegistry.get).toBe('function');
        expect(typeof h.lookupOpts[0].allowCoingeckoFallback).toBe('function');
    });

    it('reads the price-data setting at each poll', async () => {
        const opts = await startSession();
        const req = { items: [{ chainId: 'c', tick: 'T' }], fiatCurrency: 'USD' };
        await opts.getTokenPrices(req);
        h.settings = { privacy: { priceDataEnabled: false } };
        await opts.getTokenPrices(req);
        h.settings = { privacy: {} };
        await opts.getTokenPrices(req);
        expect(h.lookupCalls.map((c) => c.allow)).toEqual([true, false, true]);
        expect(h.lookupCalls[0].req).toBe(req);
    });

    it('still starts the watcher without the export', async () => {
        h.withExport = false;
        const opts = await startSession();
        expect('getTokenPrices' in opts).toBe(false);
        expect(typeof opts.getNativePrices).toBe('function');
    });
});
