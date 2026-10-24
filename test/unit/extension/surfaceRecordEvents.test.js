// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A rename, removal or account change committed through the background host
// reaches every open extension surface, so a popup, a side panel and a full
// tab never keep showing a stale name or a removed wallet.

import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import {
    applySurfaceStateEvent,
    attachSurfaceStateListener,
    createSurfaceStateBroadcaster,
    SURFACE_STATE_STORAGE_KEY,
} from '../../../packages/extension/src/shared/surfaceStateSync.js';

function memCollection(rows = []) {
    const m = new Map(rows.map((row) => [row.id, row]));
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => Array.from(m.values()).map((v) => structuredClone(v)),
        delete: async (id) => m.delete(id),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map((r) => structuredClone(r)),
    };
}

function makeVault() {
    return {
        wallets: memCollection([
            { id: 'w1', name: 'Alpha', importedKeys: [] },
            { id: 'w2', name: 'Beta', importedKeys: [] },
        ]),
        accounts: memCollection([
            { id: 'a1', walletId: 'w1', index: 0, name: 'Account 1' },
            { id: 'a2', walletId: 'w1', index: 1, name: 'Account 2' },
        ]),
        addresses: memCollection(),
        pendingTxs: memCollection(),
        pendingAirdrops: memCollection(),
        pendingDeploys: memCollection(),
        multisigSigningSessions: memCollection(),
        coSignerAccounts: memCollection(),
        watchlistEntries: memCollection(),
        priceAlerts: memCollection(),
        gatedKeys: memCollection(),
        autopayOrders: memCollection(),
        signers: memCollection(),
        connectedSites: memCollection(),
        settings: { get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }), put: async () => {} },
    };
}

function makeHost() {
    const surfaceStateEvents = { publish: vi.fn(async () => true) };
    const host = createBackgroundHost({
        vault: makeVault(),
        chainRegistry: {},
        sdkRegistry: {},
        signerPool: { get: () => null, has: () => false, evict() {} },
        bridgeEvents: { walletSwitched: vi.fn(), emit() {}, disconnect: vi.fn(async () => {}) },
        surfaceStateEvents,
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, surfaceStateEvents };
}

function sessionStorageBus() {
    const listeners = new Set();
    return {
        storageArea: {
            set: vi.fn((record, callback) => {
                for (const listener of listeners) {
                    listener({ [SURFACE_STATE_STORAGE_KEY]: { newValue: record[SURFACE_STATE_STORAGE_KEY] } }, 'session');
                }
                callback();
            }),
        },
        onChanged: {
            addListener: (listener) => listeners.add(listener),
            removeListener: (listener) => listeners.delete(listener),
        },
    };
}

function openSurface(bus) {
    const calls = { refreshWallets: vi.fn(), remountScreens: vi.fn(), walletRemoved: vi.fn(), accountsChanged: vi.fn() };
    attachSurfaceStateListener((event) => applySurfaceStateEvent(event, calls), bus.onChanged);
    return calls;
}

describe('wallet rename reaches every open surface', () => {
    it('publishes a wallets event after the rename commits', async () => {
        const { host, surfaceStateEvents } = makeHost();
        const response = await host.handle({ type: 'wallet.rename', request: { walletId: 'w1', name: 'Gamma' } });
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(surfaceStateEvents.publish).toHaveBeenCalledWith('wallets', { change: 'renamed', walletId: 'w1' });
    });

    it('publishes nothing when the rename is refused', async () => {
        const { host, surfaceStateEvents } = makeHost();
        const response = await host.handle({ type: 'wallet.rename', request: { walletId: 'w1', name: 'Beta' } });
        expect(response.ok).toBe(false);
        expect(surfaceStateEvents.publish).not.toHaveBeenCalled();
    });

    it('reloads the wallet list on the popup and the side panel', async () => {
        const bus = sessionStorageBus();
        const popup = openSurface(bus);
        const sidePanel = openSurface(bus);
        const events = createSurfaceStateBroadcaster({ storageArea: bus.storageArea, runtime: {}, now: () => 1 });
        await events.publish('wallets', { change: 'renamed', walletId: 'w1' });
        expect(popup.refreshWallets).toHaveBeenCalledTimes(1);
        expect(sidePanel.refreshWallets).toHaveBeenCalledTimes(1);
    });

    it('remounts the open screen so a picker or details view shows the new name', async () => {
        const bus = sessionStorageBus();
        const popup = openSurface(bus);
        const sidePanel = openSurface(bus);
        const events = createSurfaceStateBroadcaster({ storageArea: bus.storageArea, runtime: {}, now: () => 1 });
        await events.publish('wallets', { change: 'renamed', walletId: 'w1' });
        expect(popup.remountScreens).toHaveBeenCalledTimes(1);
        expect(sidePanel.remountScreens).toHaveBeenCalledTimes(1);
    });
});

describe('wallet removal reaches every open surface', () => {
    it('publishes a wallets event after the wallet and its records are gone', async () => {
        const { host, surfaceStateEvents } = makeHost();
        const response = await host.handle({ type: 'wallet.remove', request: { walletId: 'w2' } });
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(surfaceStateEvents.publish).toHaveBeenCalledWith('wallets', { change: 'removed', walletId: 'w2' });
    });

    it('publishes nothing when the wallet does not exist', async () => {
        const { host, surfaceStateEvents } = makeHost();
        const response = await host.handle({ type: 'wallet.remove', request: { walletId: 'missing' } });
        expect(response.ok).toBe(false);
        expect(surfaceStateEvents.publish).not.toHaveBeenCalled();
    });

    it('tells the popup and the side panel which wallet was removed', async () => {
        const bus = sessionStorageBus();
        const popup = openSurface(bus);
        const sidePanel = openSurface(bus);
        const events = createSurfaceStateBroadcaster({ storageArea: bus.storageArea, runtime: {}, now: () => 1 });
        await events.publish('wallets', { change: 'removed', walletId: 'w2' });
        expect(popup.walletRemoved).toHaveBeenCalledWith('w2');
        expect(sidePanel.walletRemoved).toHaveBeenCalledWith('w2');
    });

    it('ignores a removal event with no wallet id', async () => {
        const bus = sessionStorageBus();
        const popup = openSurface(bus);
        const events = createSurfaceStateBroadcaster({ storageArea: bus.storageArea, runtime: {}, now: () => 1 });
        await events.publish('wallets', { change: 'removed' });
        expect(popup.walletRemoved).not.toHaveBeenCalled();
    });
});

const REGTEST = { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] };

function makeAccountHost() {
    const vault = makeVault();
    vault.settings = {
        _rec: { schemaVersion: 1, activeNetwork: 'regtest', fees: { 'bitcoin-regtest': { strategy: 'normal' } }, ads: { perChain: {} } },
        async get() { return JSON.parse(JSON.stringify(this._rec)); },
        async put(r) { this._rec = JSON.parse(JSON.stringify(r)); },
    };
    const signer = {
        id: 'signer-1',
        kind: 'software',
        async getAddresses({ chainId, accountIndex, change, startIndex }) {
            return [{
                index: startIndex,
                address: `addr_${chainId}_${accountIndex}_${change}_${startIndex}`,
                publicKey: `pub_${chainId}`,
                path: `m/84'/0'/${accountIndex}'/${change}/${startIndex}`,
            }];
        },
        lock() {},
    };
    const surfaceStateEvents = { publish: vi.fn(async () => true) };
    const host = createBackgroundHost({
        vault,
        chainRegistry: {
            has: (id) => id === REGTEST.id,
            get: () => REGTEST,
            descriptorFor: () => REGTEST,
            byNetworkKind: () => [REGTEST],
            chainIdFor: () => REGTEST.id,
            supportedChains: () => [REGTEST],
        },
        sdkRegistry: { get: () => ({}) },
        signerPool: { get: () => signer, has: () => true },
        bridgeEvents: { walletSwitched: vi.fn(), emit() {}, disconnect: vi.fn(async () => {}) },
        surfaceStateEvents,
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, surfaceStateEvents };
}

describe('account changes reach every open surface', () => {
    it('publishes an accounts event after an account is added', async () => {
        const { host, surfaceStateEvents } = makeAccountHost();
        const response = await host.handle({ type: 'account.create', request: { walletId: 'w1' } });
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(surfaceStateEvents.publish).toHaveBeenCalledWith('accounts', {
            change: 'added',
            walletId: 'w1',
            accountId: response.result.account.id,
        });
    });

    it('publishes an accounts event after an account is renamed', async () => {
        const { host, surfaceStateEvents } = makeAccountHost();
        const response = await host.handle({ type: 'account.rename', request: { accountId: 'a1', name: 'Savings' } });
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(surfaceStateEvents.publish).toHaveBeenCalledWith('accounts', {
            change: 'renamed',
            walletId: 'w1',
            accountId: 'a1',
        });
    });

    it('publishes nothing when the rename is refused', async () => {
        const { host, surfaceStateEvents } = makeAccountHost();
        const response = await host.handle({ type: 'account.rename', request: { accountId: 'a1', name: 'Account 2' } });
        expect(response.ok).toBe(false);
        expect(surfaceStateEvents.publish).not.toHaveBeenCalled();
    });

    it('tells the popup and the side panel which wallet changed accounts', async () => {
        const bus = sessionStorageBus();
        const popup = openSurface(bus);
        const sidePanel = openSurface(bus);
        const events = createSurfaceStateBroadcaster({ storageArea: bus.storageArea, runtime: {}, now: () => 1 });
        await events.publish('accounts', { change: 'added', walletId: 'w1', accountId: 'a3' });
        await events.publish('accounts', { change: 'renamed' });
        expect(popup.accountsChanged).toHaveBeenCalledTimes(1);
        expect(popup.accountsChanged).toHaveBeenCalledWith('w1');
        expect(sidePanel.accountsChanged).toHaveBeenCalledWith('w1');
    });
});
