// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// bridge-spec reads an empty SitePermissions.accounts as every current and
// future account. A connect approved while the vault holds nothing to grant
// must therefore store no grant, or the accounts created later would reach
// the site with no further approval.

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../../packages/extension/src/bridge/handlers.js';

const ORIGIN = 'https://dapp.example';
const chainRegistry = {
    get: (id) => (id === 'bitcoin-regtest' ? { id } : null),
    supportedChains: () => [{ id: 'bitcoin-regtest' }],
};
const DECISION = { approved: true, chains: ['bitcoin-regtest'], accounts: [], canSignMessage: false, canSignAction: {} };

function fakeVault({ accounts = [], wallets = [], walletsUnreadable = false } = {}) {
    const sites = new Map();
    return {
        _sites: sites,
        _accounts: accounts,
        settings: { get: async () => ({ developerMode: false, autoApproveLocalhost: false, fees: {} }) },
        accounts: { list: async () => [...accounts] },
        wallets: {
            list: async () => {
                if (walletsUnreadable) throw new Error('wallet store unreadable');
                return wallets;
            },
        },
        connectedSites: {
            findBy: async (field, value) => [...sites.values()].filter((s) => s[field] === value),
            put: async (s) => { sites.set(s.id, s); return s; },
            delete: async (id) => { sites.delete(id); },
            update: async (id, fn) => {
                const next = fn(sites.get(id) ?? null);
                if (next) sites.set(id, next);
                return next;
            },
        },
    };
}

function makeHost(vault) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals: { connect: async () => DECISION } });
    return host;
}

const call = (host, type) => host.handle({ type, request: { origin: ORIGIN, appName: 'dApp' } });

describe('bridge.connect stores no wildcard account grant for a vault with nothing to grant', () => {
    it('refuses a connect approved while the vault is empty and stores nothing', async () => {
        const vault = fakeVault();
        const host = makeHost(vault);
        const res = await call(host, 'bridge.connect');
        expect(res.ok).toBe(false);
        expect(vault._sites.size).toBe(0);
    });

    it('exposes no account created after the refused connect', async () => {
        const vault = fakeVault();
        const host = makeHost(vault);
        await call(host, 'bridge.connect');
        vault._accounts.push({ id: 'acct-1', name: 'Account 1' }, { id: 'acct-2', name: 'Account 2' });
        const res = await call(host, 'bridge.getAccounts');
        expect(res.ok).toBe(false);
        expect([...vault._sites.values()].some((s) => s.permissions.accounts.length === 0)).toBe(false);
    });

    it('refuses an account-free vault whose wallet store cannot be read', async () => {
        const vault = fakeVault({ walletsUnreadable: true });
        const res = await call(makeHost(vault), 'bridge.connect');
        expect(res.ok).toBe(false);
        expect(vault._sites.size).toBe(0);
    });

    it('still connects a vault of imported keys alone, which has no account to narrow to', async () => {
        const vault = fakeVault({ wallets: [{ id: 'w1', format: 'wif-only', importedKeys: [{ addressId: 'imp' }] }] });
        const res = await call(makeHost(vault), 'bridge.connect');
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(vault._sites.size).toBe(1);
    });

    it('narrows an empty selection to the primary account when the vault has one', async () => {
        const vault = fakeVault({ accounts: [{ id: 'acct-1', name: 'Account 1' }, { id: 'acct-2', name: 'Account 2' }] });
        const res = await call(makeHost(vault), 'bridge.connect');
        expect(res.ok).toBe(true);
        expect([...vault._sites.values()][0].permissions.accounts).toEqual(['acct-1']);
    });
});
