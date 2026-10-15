// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import {
    createBridgeEventBroadcaster,
    notifyAccountsChanged,
    notifyDisconnectedSites,
    notifyNetworkChanged,
} from '../../../packages/extension/src/bridge/bridgeEvents.js';

const ORIGIN = 'https://dapp.example';
const OTHER = 'https://other.example';

function collection(records = []) {
    const rows = new Map(records.map((record) => [record.id, structuredClone(record)]));
    return {
        get: async (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
        put: async (record) => { rows.set(record.id, structuredClone(record)); },
        delete: async (id) => rows.delete(id),
        list: async () => [...rows.values()].map((record) => structuredClone(record)),
        findBy: async (field, value) => [...rows.values()]
            .filter((record) => record[field] === value)
            .map((record) => structuredClone(record)),
    };
}

function site(id, origin, chains = []) {
    return {
        id,
        origin,
        appName: origin,
        permissions: { accounts: ['account-1'], chains, canSignMessage: false, canSignAction: {} },
    };
}

function eventStub() {
    return {
        accountsChanged: vi.fn(async () => {}),
        chainChanged: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
        walletSwitched: vi.fn(async () => {}),
    };
}

function hostFixture(sites, accounts = []) {
    const settings = createDefaultSettings();
    settings.fees = {
        'bitcoin-mainnet': {},
        'bitcoin-testnet': {},
        'litecoin-testnet': {},
    };
    const connectedSites = collection(sites);
    const vault = {
        wallets: collection(),
        accounts: collection(accounts),
        addresses: collection(),
        signers: collection(),
        connectedSites,
        settings: {
            record: structuredClone(settings),
            async get() { return structuredClone(this.record); },
            async put(next) { this.record = structuredClone(next); },
        },
    };
    const events = eventStub();
    const host = createBackgroundHost({
        vault,
        chainRegistry: defaultRegistry(),
        sdkRegistry: {},
        bridgeEvents: events,
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { connectedSites, events, host };
}

describe('dApp event fanout audit', () => {
    it('delivers one origin-stamped event to each unique registered tab', async () => {
        const sent = [];
        const events = createBridgeEventBroadcaster({
            tabs: { sendMessage: (tabId, message, callback) => {
                sent.push({ tabId, message });
                callback?.();
            } },
            connectedTabs: {
                tabsForOrigin: async (origin) => (
                    origin === ORIGIN ? [7, 7, 9] : [11]
                ),
            },
        });

        await events.accountsChanged(ORIGIN, [{
            id: 'account-1',
            name: 'Primary',
            walletId: 'wallet-private',
            encryptedSeed: 'never-forwarded',
        }]);

        expect(sent.map(({ tabId }) => tabId)).toEqual([7, 9]);
        expect(sent.every(({ message }) => message.origin === ORIGIN)).toBe(true);
        expect(sent.every(({ message }) => (
            JSON.stringify(message.payload) === JSON.stringify([{ id: 'account-1', name: 'Primary' }])
        ))).toBe(true);
    });

    it('deduplicates origins and withholds chains outside each site grant', async () => {
        const events = eventStub();
        await notifyNetworkChanged({
            events,
            activeChainIds: ['bitcoin-testnet', 'litecoin-testnet'],
            sites: [
                site('one', ORIGIN, ['litecoin-testnet']),
                site('duplicate', ORIGIN, ['bitcoin-testnet']),
                site('other', OTHER, ['dogecoin-testnet']),
            ],
        });

        expect(events.chainChanged).toHaveBeenCalledTimes(1);
        expect(events.chainChanged).toHaveBeenCalledWith(ORIGIN, 'litecoin-testnet');
    });

    it('sends only public records to origins whose account grant changed', async () => {
        const events = eventStub();
        await notifyAccountsChanged({
            events,
            accounts: [
                { id: 'account-1', name: 'Primary', encryptedSeed: 'secret' },
                { id: 'account-2', name: 'Other', walletId: 'private-wallet' },
            ],
            changedAccountIds: ['account-1'],
            sites: [
                site('one', ORIGIN),
                { ...site('two', OTHER), permissions: { accounts: ['account-2'] } },
            ],
        });

        expect(events.accountsChanged).toHaveBeenCalledOnce();
        expect(events.accountsChanged).toHaveBeenCalledWith(
            ORIGIN,
            [{ id: 'account-1', name: 'Primary' }],
        );
    });

    it('disconnects each persisted origin once and ignores invalid site rows', async () => {
        const events = eventStub();
        await notifyDisconnectedSites({
            events,
            sites: [site('one', ORIGIN), site('duplicate', ORIGIN), { origin: '' }, {}],
            reason: 'wallet-locked',
        });

        expect(events.disconnect).toHaveBeenCalledOnce();
        expect(events.disconnect).toHaveBeenCalledWith(ORIGIN, 'wallet-locked');
    });
});

describe('dApp state-change triggers', () => {
    it('emits disconnect once for settings deletion and not for a missing site', async () => {
        const { events, host } = hostFixture([site('one', ORIGIN)]);

        const first = await host.handle({ type: 'sites.delete', request: { id: 'one' } });
        const second = await host.handle({ type: 'sites.delete', request: { id: 'one' } });

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        expect(events.disconnect).toHaveBeenCalledOnce();
        expect(events.disconnect).toHaveBeenCalledWith(ORIGIN, 'user-revoked');
    });

    it('disconnects only sites evicted by an origin block', async () => {
        const { events, host } = hostFixture([
            site('one', ORIGIN),
            site('two', OTHER),
        ]);

        const response = await host.handle({ type: 'sites.block', request: { origin: ORIGIN } });

        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(events.disconnect).toHaveBeenCalledOnce();
        expect(events.disconnect).toHaveBeenCalledWith(ORIGIN, 'blocked-by-user');
    });

    it('emits one granted chain on a real network change and stays silent on repeats', async () => {
        const { events, host } = hostFixture([
            site('one', ORIGIN, ['litecoin-testnet']),
            site('two', OTHER, ['dogecoin-mainnet']),
        ]);

        const changed = await host.handle({
            type: 'settings.update',
            request: { patch: { activeNetwork: 'testnet' } },
        });
        const repeated = await host.handle({
            type: 'settings.update',
            request: { patch: { activeNetwork: 'testnet' } },
        });

        expect(changed.ok, JSON.stringify(changed.error ?? {})).toBe(true);
        expect(repeated.ok, JSON.stringify(repeated.error ?? {})).toBe(true);
        expect(events.chainChanged).toHaveBeenCalledOnce();
        expect(events.chainChanged).toHaveBeenCalledWith(ORIGIN, 'litecoin-testnet');
    });

    it('emits an account rename only to sites granted that account', async () => {
        const account = { id: 'account-1', walletId: 'wallet-1', name: 'Primary' };
        const { events, host } = hostFixture([
            site('one', ORIGIN),
            { ...site('two', OTHER), permissions: { accounts: ['account-2'] } },
        ], [account, { id: 'account-2', walletId: 'wallet-1', name: 'Other' }]);

        const changed = await host.handle({
            type: 'account.rename',
            request: { accountId: 'account-1', name: 'Renamed' },
        });
        const repeated = await host.handle({
            type: 'account.rename',
            request: { accountId: 'account-1', name: 'Renamed' },
        });

        expect(changed.ok, JSON.stringify(changed.error ?? {})).toBe(true);
        expect(repeated.ok, JSON.stringify(repeated.error ?? {})).toBe(true);
        expect(events.accountsChanged).toHaveBeenCalledOnce();
        expect(events.accountsChanged).toHaveBeenCalledWith(
            ORIGIN,
            [{ id: 'account-1', name: 'Renamed' }],
        );
    });

    it('snapshots connected sites before lock teardown and emits the contract disconnect', () => {
        const source = readFileSync(
            `${process.cwd()}/packages/extension/src/background.js`,
            'utf8',
        );
        const teardown = source.slice(
            source.indexOf('function tearDownHost()'),
            source.indexOf('async function sealBroadcastQueues()'),
        );

        expect(teardown).toContain('vault.connectedSites.list()');
        expect(teardown).toContain("reason: 'wallet-locked'");
        expect(teardown.indexOf('vault.connectedSites.list()')).toBeLessThan(teardown.indexOf('vault.close()'));
    });
});
