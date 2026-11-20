// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// bridge.getActiveChains is scoped to the site's chain grant with the same
// empty-means-all rule the per-chain methods and the chainChanged event use,
// so every id it returns is one getAddresses accepts.

import { describe, expect, it, vi } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';
import { notifyNetworkChanged } from '../../../packages/extension/src/bridge/bridgeEvents.js';
import { MockXChainProvider } from '../../../packages/test-dapp/src/mock-provider.ts';
import { runExample } from '../../../packages/test-dapp/src/example.ts';

const ORIGIN = 'https://reader.example';
const FIRST = 'litecoin-regtest';
const GRANTED = 'bitcoin-regtest';

const descriptors = {
    [FIRST]: { id: FIRST, coin: 'litecoin', networkKind: 'regtest' },
    [GRANTED]: { id: GRANTED, coin: 'bitcoin', networkKind: 'regtest' },
};
const chainRegistry = {
    get: (id) => descriptors[id] ?? null,
    descriptorFor: (id) => descriptors[id] ?? null,
    supportedChains: () => Object.values(descriptors),
};

function makeVault(chains) {
    const site = {
        id: 'site-1', origin: ORIGIN,
        permissions: { chains, accounts: [], canSignMessage: false, canSignAction: {} },
    };
    return {
        settings: {
            get: async () => ({
                activeNetwork: 'regtest',
                // The granted chain is deliberately not the first key.
                fees: { [FIRST]: {}, [GRANTED]: {} },
                blockedOrigins: [],
            }),
        },
        accounts: { list: async () => [] },
        addresses: { list: vi.fn(async () => []) },
        connectedSites: {
            list: async () => [site],
            findBy: async (field, value) => (site[field] === value ? [site] : []),
            put: async (entry) => entry,
            delete: async () => {},
        },
    };
}

function call(vault, type, request = {}) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host);
    return host.handle({ type, request: { origin: ORIGIN, ...request } });
}

describe('bridge.getActiveChains and the chain grant', () => {
    it('returns only the granted chain and every returned id is accepted by getAddresses', async () => {
        const vault = makeVault([GRANTED]);
        const { result } = await call(vault, 'bridge.getActiveChains');
        expect(result).toEqual([GRANTED]);
        for (const chainId of result) {
            const response = await call(vault, 'bridge.getAddresses', { chainId });
            expect(response.ok, chainId).toBe(true);
        }
        const refused = await call(vault, 'bridge.getAddresses', { chainId: FIRST });
        expect(refused.ok).toBe(false);
    });

    it('returns every active-network chain for an empty grant', async () => {
        const { result } = await call(makeVault([]), 'bridge.getActiveChains');
        expect(result).toEqual([FIRST, GRANTED]);
    });

    it('agrees with the chain the chainChanged event announces', async () => {
        const vault = makeVault([GRANTED]);
        const { result } = await call(vault, 'bridge.getActiveChains');
        const chainChanged = vi.fn();
        await notifyNetworkChanged({
            events: { chainChanged },
            sites: await vault.connectedSites.list(),
            activeChainIds: [FIRST, GRANTED],
        });
        expect(chainChanged).toHaveBeenCalledTimes(1);
        expect(result).toContain(chainChanged.mock.calls[0][1]);
    });
});

describe('the reference mock enforces the chain grant', () => {
    it('refuses ungranted chains and hides them from getActiveChains', async () => {
        const provider = new MockXChainProvider({
            supportedChains: Object.values(descriptors),
            activeChains: [FIRST, GRANTED],
        });
        await provider.connect({ requestedChains: [GRANTED] });
        await expect(provider.getActiveChains()).resolves.toEqual([GRANTED]);
        await expect(provider.getAddresses(FIRST)).rejects.toMatchObject({ code: 'CHAIN_NOT_SUPPORTED' });
        await expect(provider.getBalances(FIRST, 'a')).rejects.toMatchObject({ code: 'CHAIN_NOT_SUPPORTED' });
        await expect(provider.getAddresses(GRANTED)).resolves.toBeInstanceOf(Array);
    });

    it('lets the reference example finish when another chain is active first', async () => {
        const provider = new MockXChainProvider({
            supportedChains: Object.values(descriptors),
            activeChains: [FIRST, GRANTED],
            addresses: {
                [GRANTED]: [{
                    id: 'a', accountId: null, chain: 'bitcoin', network: 'regtest',
                    addressType: 'p2wpkh', address: 'bcrt1qexample', label: 'A',
                }],
            },
        });
        provider.install();
        try {
            const report = await runExample();
            expect(report.connected).toBe(true);
            expect(report.signMessageOk).toBe(true);
        } finally {
            await provider.disconnect();
        }
    });

    it('refuses every signing surface outside the grant before throttling', async () => {
        const addresses = {
            [FIRST]: [{ id: 'ltc', chain: 'litecoin', network: 'regtest', address: 'rltc1qexample' }],
            [GRANTED]: [{ id: 'btc', chain: 'bitcoin', network: 'regtest', address: 'bcrt1qexample' }],
        };
        const provider = new MockXChainProvider({
            supportedChains: Object.values(descriptors), activeChains: [FIRST, GRANTED],
            addresses, throttle: { retryAfterMs: 1000 },
        });
        await provider.connect({ requestedChains: [GRANTED] });
        const unsupported = { ok: false, error: 'CHAIN_NOT_SUPPORTED' };
        await expect(provider.signMessage({ chainId: FIRST, address: 'rltc1qexample', message: 'm' }))
            .resolves.toMatchObject(unsupported);
        await expect(provider.signAction({ chainId: FIRST, action: 'SEND', params: {} }))
            .resolves.toMatchObject(unsupported);
        await expect(provider.signPsbt({ chainId: FIRST, psbtHex: '00', signingPaths: [] }))
            .resolves.toMatchObject(unsupported);
        await expect(provider.coSign({ chainId: FIRST, aggregateAddress: 'a', psbtHex: '00' }))
            .resolves.toMatchObject(unsupported);
        const batchProvider = new MockXChainProvider({
            supportedChains: Object.values(descriptors), activeChains: [FIRST, GRANTED], addresses,
        });
        await batchProvider.connect({ requestedChains: [GRANTED] });
        await expect(batchProvider.signIn({ appId: 'app', chainId: FIRST }))
            .resolves.toMatchObject({ ok: false, error: 'ADDRESS_NOT_AUTHORIZED' });
        const results = await batchProvider.parallel([
            { chainId: FIRST, action: 'SEND', params: {} },
            { chainId: GRANTED, action: 'SEND', params: {} },
        ]);
        expect(results[0]).toMatchObject(unsupported);
        expect(results[1]).toMatchObject({ ok: true, chainId: GRANTED });
    });
});
