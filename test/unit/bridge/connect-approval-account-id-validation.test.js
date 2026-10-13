// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: bridge.connect must not store an account id the approval
// decision names but the wallet does not hold.
//
// The decision's `accounts` is the user's selection in ConnectApproval.jsx,
// but it crosses a message boundary, so the background still checks it.
// Before the known-id filter the background stored that list into
// ConnectedSite.permissions.accounts with no check that each id names a real
// vault account, so a page could connect() with a made-up or guessed id and
// have it persisted as part of its own grant - every reader that trusts
// permissions.accounts (getAccounts, getAddresses, assertAddressPermitted,
// resolveBridgeSigningPaths, and now assertCoSignerAccountPermitted) would
// then treat that id as real.
//
// This is the manual-approval path (approvals.connect), distinct from
// connect-auto-approve-scope.test.js which covers the Developer-Mode
// auto-approve path (resolveAutoApproveScope already computes its scope from
// the real account list, so it was never exposed to this bug).

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const ORIGIN = 'https://dapp.example';

const chainRegistry = {
    get: () => null,
    supportedChains: () => [],
};

function fakeVault() {
    /** @type {Map<string, object>} */
    const sites = new Map();
    return {
        _sites: sites,
        settings: {
            get: async () => ({ developerMode: false, autoApproveLocalhost: false, fees: {} }),
        },
        accounts: {
            list: async () => [
                { id: 'acct-real', name: 'Account 1' },
                { id: 'acct-second', name: 'Account 2' },
            ],
        },
        connectedSites: {
            findBy: async (field, value) => [...sites.values()].filter((s) => s[field] === value),
            put: async (s) => { sites.set(s.id, s); return s; },
            delete: async (id) => { sites.delete(id); },
        },
    };
}

function fakeApprovals(decision) {
    const calls = [];
    return { calls, connect: async (req) => { calls.push(req); return decision; } };
}

function connect(vault, { approvals, req } = {}) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals });
    return host.handle({
        type: 'bridge.connect',
        request: { origin: ORIGIN, appName: 'dApp', ...req },
    });
}

describe('bridge.connect: a foreign account id cannot survive into the stored grant', () => {
    it('drops an id the vault does not hold and keeps the real one', async () => {
        const vault = fakeVault();
        // A decision naming an id the vault does not hold, as a tampered
        // approval answer would.
        const approvals = fakeApprovals({
            approved: true,
            chains: ['bitcoin-regtest'],
            accounts: ['acct-real', 'acct-does-not-exist'],
            canSignMessage: false,
            canSignAction: {},
        });
        const res = await connect(vault, { approvals });

        expect(res.ok).toBe(true);
        expect(res.result.permissions.accounts).toEqual(['acct-real']);
        expect(res.result.accounts).toEqual([{ id: 'acct-real', name: 'Account 1' }]);

        const [site] = [...vault._sites.values()];
        expect(site.permissions.accounts).toEqual(['acct-real']);
    });

    it('falls back to the primary account when every requested id is foreign', async () => {
        const vault = fakeVault();
        const approvals = fakeApprovals({
            approved: true,
            chains: [],
            accounts: ['not-a-real-account', 'also-not-real'],
            canSignMessage: false,
            canSignAction: {},
        });
        const res = await connect(vault, { approvals });

        expect(res.ok).toBe(true);
        // Read as an empty grant (every requested id was dropped), so it
        // narrows to the primary account exactly like naming no accounts at all.
        expect(res.result.permissions.accounts).toEqual(['acct-real']);

        const [site] = [...vault._sites.values()];
        expect(site.permissions.accounts).toEqual(['acct-real']);
    });

    it('persists the filtered list on the stored ConnectedSite record, not only the response', async () => {
        const vault = fakeVault();
        const approvals = fakeApprovals({
            approved: true,
            chains: [],
            accounts: ['acct-second', 'forged-id'],
            canSignMessage: false,
            canSignAction: {},
        });
        await connect(vault, { approvals });

        const [site] = [...vault._sites.values()];
        expect(site.permissions.accounts).toEqual(['acct-second']);
    });
});

describe('bridge.connect: the page has no say over the account grant', () => {
    it('offers the wallet accounts to the prompt and ignores accounts the page names', async () => {
        const vault = fakeVault();
        const approvals = fakeApprovals({
            approved: true,
            chains: ['bitcoin-regtest'],
            accounts: [],
            canSignMessage: false,
            canSignAction: {},
        });
        const res = await connect(vault, { approvals, req: { accounts: ['acct-second'] } });

        expect(res.ok).toBe(true);
        expect(approvals.calls[0].requestedAccounts).toBeUndefined();
        expect(approvals.calls[0].accountOptions).toEqual([
            { id: 'acct-real', name: 'Account 1' },
            { id: 'acct-second', name: 'Account 2' },
        ]);
        // The user ticked nothing beyond the default, so the page-named
        // account is not granted.
        const [site] = [...vault._sites.values()];
        expect(site.permissions.accounts).toEqual(['acct-real']);
    });

    it('still prompts with no account options when the account read fails', async () => {
        const vault = fakeVault();
        let reads = 0;
        vault.accounts.list = async () => {
            reads += 1;
            if (reads === 1) throw new Error('vault is locked');
            return [{ id: 'acct-real', name: 'Account 1' }];
        };
        const approvals = fakeApprovals({
            approved: true,
            chains: ['bitcoin-regtest'],
            accounts: [],
            canSignMessage: false,
            canSignAction: {},
        });
        const res = await connect(vault, { approvals });

        expect(res.ok).toBe(true);
        expect(approvals.calls[0].accountOptions).toEqual([]);
        expect(res.result.permissions.accounts).toEqual(['acct-real']);
    });
});
