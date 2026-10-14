// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const flowMocks = vi.hoisted(() => ({
    addressBalances: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, ...flowMocks } };
});

const { MessageHost } = await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } = await import('../../../packages/extension/src/bridge/handlers.js');

const ORIGIN = 'https://reader.example';
const REGTEST = 'bitcoin-regtest';
const MAINNET = 'bitcoin-mainnet';

const descriptors = {
    [REGTEST]: { id: REGTEST, coin: 'bitcoin', networkKind: 'regtest' },
    [MAINNET]: { id: MAINNET, coin: 'bitcoin', networkKind: 'mainnet' },
};

const chainRegistry = {
    get: (id) => descriptors[id] ?? null,
    descriptorFor: (id) => descriptors[id] ?? null,
    supportedChains: () => Object.values(descriptors),
};

const accounts = [
    { id: 'account-a', name: 'Wallet A', walletId: 'wallet-a' },
    { id: 'account-b', name: 'Wallet B', walletId: 'wallet-b' },
];

const addresses = [
    {
        id: 'address-a-regtest', accountId: 'account-a', address: 'bcrt1qa',
        chain: 'bitcoin', network: 'regtest', addressType: 'p2wpkh', label: 'A regtest',
    },
    {
        id: 'address-b-regtest', accountId: 'account-b', address: 'bcrt1qb',
        chain: 'bitcoin', network: 'regtest', addressType: 'p2wpkh', label: 'B regtest',
    },
    {
        id: 'address-a-mainnet', accountId: 'account-a', address: 'bc1qa',
        chain: 'bitcoin', network: 'mainnet', addressType: 'p2wpkh', label: 'A mainnet',
    },
];

function connectedSite(overrides = {}) {
    return {
        id: 'site-1',
        origin: ORIGIN,
        permissions: {
            chains: [REGTEST, MAINNET],
            accounts: ['account-a'],
            canSignMessage: false,
            canSignAction: {},
            ...overrides,
        },
    };
}

function makeVault(site = connectedSite()) {
    const sites = new Map(site ? [[site.id, site]] : []);
    const state = { activeNetwork: 'regtest' };
    return {
        _sites: sites,
        _state: state,
        settings: {
            get: vi.fn(async () => ({
                activeNetwork: state.activeNetwork,
                fees: { [REGTEST]: {}, [MAINNET]: {} },
                blockedOrigins: [],
            })),
        },
        accounts: {
            list: vi.fn(async () => accounts.slice()),
        },
        addresses: {
            list: vi.fn(async () => addresses.slice()),
        },
        connectedSites: {
            findBy: vi.fn(async (field, value) => (
                [...sites.values()].filter((entry) => entry[field] === value)
            )),
            put: vi.fn(async (entry) => { sites.set(entry.id, entry); return entry; }),
            delete: vi.fn(async (id) => { sites.delete(id); }),
        },
    };
}

function buildHost(vault) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host);
    return host;
}

beforeEach(() => {
    flowMocks.addressBalances.mockReset();
    flowMocks.addressBalances.mockResolvedValue({
        native: { tick: 'BTC', quantity: '1', divisibility: 8 },
        tokens: [],
    });
});

describe('dApp bridge read authorization', () => {
    it('returns only NOT_CONNECTED and no data for every protected read', async () => {
        const vault = makeVault(null);
        const host = buildHost(vault);
        const requests = [
            ['bridge.getAccounts', { origin: ORIGIN }],
            ['bridge.getAddresses', { origin: ORIGIN, chainId: REGTEST }],
            ['bridge.getBalances', { origin: ORIGIN, chainId: REGTEST, address: 'bcrt1qa' }],
            ['bridge.getActiveChains', { origin: ORIGIN }],
        ];

        for (const [type, request] of requests) {
            const response = await host.handle({ type, request });
            expect(response.ok, type).toBe(false);
            expect(response.error.code, type).toBe('NOT_CONNECTED');
            expect(response).not.toHaveProperty('result');
        }
        expect(vault.accounts.list).not.toHaveBeenCalled();
        expect(vault.addresses.list).not.toHaveBeenCalled();
        expect(flowMocks.addressBalances).not.toHaveBeenCalled();
    });

    it('does not restore or answer from a grant revoked during a read', async () => {
        const vault = makeVault();
        vault.accounts.list.mockImplementationOnce(async () => {
            vault._sites.delete('site-1');
            return accounts.slice();
        });

        const response = await buildHost(vault).handle({
            type: 'bridge.getAccounts',
            request: { origin: ORIGIN },
        });

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('NOT_CONNECTED');
        expect(response).not.toHaveProperty('result');
        expect(vault._sites.size).toBe(0);
        expect(vault.connectedSites.put).not.toHaveBeenCalled();
    });

    it('applies an account-scope revocation that lands during a read', async () => {
        const vault = makeVault(connectedSite({ accounts: ['account-a', 'account-b'] }));
        vault.accounts.list.mockImplementationOnce(async () => {
            vault._sites.set('site-1', connectedSite({ accounts: ['account-a'] }));
            return accounts.slice();
        });

        const response = await buildHost(vault).handle({
            type: 'bridge.getAccounts',
            request: { origin: ORIGIN },
        });

        expect(response.ok).toBe(true);
        expect(response.result).toEqual([{ id: 'account-a', name: 'Wallet A' }]);
    });

    it('discards fetched balances when the site is revoked in flight', async () => {
        const vault = makeVault();
        flowMocks.addressBalances.mockImplementationOnce(async () => {
            vault._sites.delete('site-1');
            return {
                native: { tick: 'BTC', quantity: '99999999', divisibility: 8 },
                tokens: [],
            };
        });

        const response = await buildHost(vault).handle({
            type: 'bridge.getBalances',
            request: { origin: ORIGIN, chainId: REGTEST, address: 'bcrt1qa' },
        });

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('NOT_CONNECTED');
        expect(response).not.toHaveProperty('result');
    });

    it('never returns an ungranted wallet account, address, or balance', async () => {
        const vault = makeVault();
        const host = buildHost(vault);

        const accountResponse = await host.handle({
            type: 'bridge.getAccounts', request: { origin: ORIGIN },
        });
        const addressResponse = await host.handle({
            type: 'bridge.getAddresses', request: { origin: ORIGIN, chainId: REGTEST },
        });
        const balanceResponse = await host.handle({
            type: 'bridge.getBalances',
            request: { origin: ORIGIN, chainId: REGTEST, address: 'bcrt1qb' },
        });

        expect(accountResponse.result).toEqual([{ id: 'account-a', name: 'Wallet A' }]);
        expect(addressResponse.result.map((entry) => entry.address)).toEqual(['bcrt1qa']);
        expect(balanceResponse.ok).toBe(false);
        expect(balanceResponse.error.code).toBe('ADDRESS_NOT_AUTHORIZED');
        expect(balanceResponse).not.toHaveProperty('result');
        expect(flowMocks.addressBalances).not.toHaveBeenCalled();
    });

    it('rejects address and balance reads from an inactive network', async () => {
        const vault = makeVault();
        const host = buildHost(vault);

        const addressResponse = await host.handle({
            type: 'bridge.getAddresses', request: { origin: ORIGIN, chainId: MAINNET },
        });
        const balanceResponse = await host.handle({
            type: 'bridge.getBalances',
            request: { origin: ORIGIN, chainId: MAINNET, address: 'bc1qa' },
        });

        expect(addressResponse.ok).toBe(false);
        expect(addressResponse.error.code).toBe('CHAIN_NOT_SUPPORTED');
        expect(addressResponse).not.toHaveProperty('result');
        expect(balanceResponse.ok).toBe(false);
        expect(balanceResponse.error.code).toBe('CHAIN_NOT_SUPPORTED');
        expect(balanceResponse).not.toHaveProperty('result');
        expect(flowMocks.addressBalances).not.toHaveBeenCalled();
    });
});
