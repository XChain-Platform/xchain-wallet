// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const ORIGIN = `https://${['dapp', 'example'].join('.')}`;
const BUILTIN = { id: 'bitcoin-regtest', networkKind: 'regtest' };
const CUSTOM = { id: 'custom-regtest', networkKind: 'regtest' };

function makeRegistry() {
    const descriptors = new Map([[BUILTIN.id, BUILTIN]]);
    return {
        has: (id) => descriptors.has(id),
        addCustom: (descriptor) => descriptors.set(descriptor.id, descriptor),
        get: (id) => descriptors.get(id) ?? null,
        supportedChains: () => [...descriptors.values()],
    };
}

function fakeVault({ customChains = [] } = {}) {
    const sites = new Map();
    return {
        _sites: sites,
        settings: { get: async () => ({ customChains, developerMode: false, fees: {} }) },
        accounts: { list: async () => [{ id: 'acct-1', name: 'Account 1' }] },
        connectedSites: {
            findBy: async (field, value) => [...sites.values()].filter((site) => site[field] === value),
            put: async (site) => { sites.set(site.id, site); return site; },
            delete: async (id) => { sites.delete(id); },
        },
    };
}

function connect(decision, { customChains = [] } = {}) {
    const vault = fakeVault({ customChains });
    const host = new MessageHost({ vault, chainRegistry: makeRegistry(), sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals: { connect: async () => decision } });
    const response = host.handle({
        type: 'bridge.connect',
        request: { origin: ORIGIN, appName: 'dApp' },
    });
    return { response, vault };
}

describe('bridge.connect approval chain validation', () => {
    it.each([
        ['a missing list', undefined],
        ['an empty list', []],
        ['a non-array list', 'bitcoin-regtest'],
        ['only unknown ids', ['unknown-chain']],
    ])('rejects %s without storing a wildcard grant', async (_label, chains) => {
        const decision = { approved: true, accounts: ['acct-1'] };
        if (chains !== undefined) decision.chains = chains;
        const { response, vault } = connect(decision);
        expect((await response).ok).toBe(false);
        expect(vault._sites.size).toBe(0);
    });

    it('stores only known unique chain ids in approval order', async () => {
        const { response, vault } = connect({
            approved: true,
            accounts: ['acct-1'],
            chains: ['bitcoin-regtest', 'unknown-chain', 'bitcoin-regtest'],
        });
        const result = await response;
        expect(result.ok).toBe(true);
        expect(result.result.permissions.chains).toEqual(['bitcoin-regtest']);
        expect([...vault._sites.values()][0].permissions.chains).toEqual(['bitcoin-regtest']);
    });

    it('hydrates a persisted custom chain before validating the decision', async () => {
        const { response, vault } = connect({
            approved: true,
            accounts: ['acct-1'],
            chains: [CUSTOM.id],
        }, { customChains: [CUSTOM] });
        const result = await response;
        expect(result.ok).toBe(true);
        expect(result.result.permissions.chains).toEqual([CUSTOM.id]);
        expect([...vault._sites.values()][0].permissions.chains).toEqual([CUSTOM.id]);
    });
});
