// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { MessageHost } from '../../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../../packages/extension/src/bridge/handlers.js';
import { MockXChainProvider } from '../../../../packages/test-dapp/src/mock-provider.ts';

const ORIGIN = 'app-origin';
const CHAIN = 'bitcoin-regtest';
const ACCOUNT = { id: 'acct-1', name: 'Primary' };
const descriptor = { id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' };
const chainRegistry = {
    get: (id) => (id === CHAIN ? descriptor : null),
    descriptorFor: (id) => (id === CHAIN ? descriptor : null),
    supportedChains: () => [descriptor],
};

function bridgeHarness(recorded) {
    const sites = new Map();
    const vault = {
        settings: { get: async () => ({ activeNetwork: 'regtest', fees: { [CHAIN]: {} } }) },
        accounts: { list: async () => [ACCOUNT] },
        connectedSites: {
            list: async () => [...sites.values()],
            findBy: async (field, value) => [...sites.values()].filter((site) => site[field] === value),
            put: async (site) => { sites.set(site.id, site); return site; },
            update: async (id, decide) => {
                const next = decide(sites.get(id) ?? null);
                if (next == null) return false;
                sites.set(next.id, next);
                return true;
            },
            delete: async (id) => { sites.delete(id); },
        },
    };
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    const events = {
        accountsChanged: async (_origin, accounts) => recorded.push(['accountsChanged', accounts]),
        chainChanged: async (_origin, chainId) => recorded.push(['chainChanged', chainId]),
        disconnect: async (_origin, reason) => recorded.push(['disconnect', reason]),
        walletSwitched: async () => recorded.push(['walletSwitched']),
    };
    const approvals = {
        connect: async () => ({
            approved: true,
            chains: [CHAIN],
            accounts: [ACCOUNT.id],
            canSignMessage: false,
            canSignAction: {},
        }),
    };
    registerBridgeHandlers(host, { approvals, events });
    return host;
}

async function bridgeCall(host, type) {
    return host.handle({
        type,
        request: { origin: ORIGIN, appName: 'Event dApp', requestedChains: [CHAIN] },
    });
}

describe('reference provider event sequence', () => {
    it('matches production across connect and repeated disconnect', async () => {
        const mockEvents = [];
        const mock = new MockXChainProvider();
        for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
            mock.on(event, (...args) => mockEvents.push([event, ...args]));
        }
        const bridgeEvents = [];
        const host = bridgeHarness(bridgeEvents);

        await mock.connect();
        await bridgeCall(host, 'bridge.connect');
        expect(mockEvents).toEqual(bridgeEvents);

        await mock.disconnect();
        await bridgeCall(host, 'bridge.disconnect');
        expect(mockEvents).toEqual(bridgeEvents);

        await mock.disconnect();
        await bridgeCall(host, 'bridge.disconnect');
        expect(mockEvents).toEqual([['disconnect', 'user-requested']]);
        expect(bridgeEvents).toEqual(mockEvents);
    });
});
