// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A signing prompt can outlive the grant it was raised under: a site that
// disconnects itself, or a revoke that lands before the request parks its
// prompt, leaves an open window. The handler reads the grant again after the
// user answers, so an approval for a revoked or blocked site signs nothing.

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const ORIGIN = 'https://late.example';

const chainRegistry = {
    get: () => ({ id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' }),
    supportedChains: () => [],
};

function fakeVault({ blockedOrigins = [] } = {}) {
    const site = {
        id: 'site-1',
        origin: ORIGIN,
        appName: 'late dApp',
        permissions: { chains: [], accounts: [], canSignMessage: false, canSignAction: {} },
    };
    const sites = new Map([[site.id, site]]);
    const settings = { blockedOrigins };
    return {
        _sites: sites,
        _settings: settings,
        settings: { get: async () => settings },
        addresses: { list: async () => [] },
        wallets: { list: async () => [] },
        coSignerAccounts: { findBy: async () => [] },
        connectedSites: {
            findBy: async (field, value) => [...sites.values()].filter((s) => s[field] === value),
            put: async (s) => { sites.set(s.id, s); return s; },
            delete: async (id) => { sites.delete(id); },
        },
    };
}

function signMessageWith(vault, onPrompt) {
    const approvals = {
        signMessage: async () => {
            await onPrompt(vault);
            return { approved: true, password: 'pw' };
        },
    };
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals });
    return host.handle({
        type: 'bridge.signMessage',
        request: { origin: ORIGIN, chainId: 'bitcoin-regtest', address: 'addr-1', message: 'hello' },
    });
}

describe('signing re-reads the grant after the approval', () => {
    it('refuses to sign when the site is gone by the time the user approves', async () => {
        const vault = fakeVault();
        const res = await signMessageWith(vault, async (v) => { await v.connectedSites.delete('site-1'); });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/NOT_CONNECTED/);
    });

    it('refuses to sign when the origin is blocked by the time the user approves', async () => {
        const vault = fakeVault();
        const res = await signMessageWith(vault, async (v) => { v._settings.blockedOrigins = [ORIGIN]; });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/BLOCKED_BY_USER/);
    });

    it('refuses to sign when the site was replaced by a new grant during the prompt', async () => {
        const vault = fakeVault();
        const res = await signMessageWith(vault, async (v) => {
            const old = v._sites.get('site-1');
            await v.connectedSites.delete('site-1');
            await v.connectedSites.put({ ...old, id: 'site-2' });
        });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/NOT_CONNECTED/);
    });
});
