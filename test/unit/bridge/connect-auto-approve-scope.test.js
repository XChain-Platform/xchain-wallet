// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression ( / SIGN-3): Developer-Mode localhost auto-approve must not
// synthesize a WILDCARD permission grant.
//
// In the §43.3 permission model an empty `chains` / `accounts` list means "all
// permitted", not "nothing permitted": assertChainPermitted returns early on
// chains.length === 0, and getAccounts / getAddresses fall back to every account
// when the account set is empty. The auto-approve path used to echo the dApp's
// request back verbatim (`req.chains ?? []`), so a localhost dApp calling
// connect() with no chains/accounts named - the common case - persisted a
// ConnectedSite with read access to every chain and every account, with no
// prompt, and that grant survived turning Developer Mode back off.
//
// These tests drive bridge.connect through a real MessageHost.

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const ORIGIN = 'http://localhost:5173';

const DESCRIPTORS = {
    'bitcoin-regtest': { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' },
    'litecoin-regtest': { id: 'litecoin-regtest', coin: 'litecoin', networkKind: 'regtest' },
    // On a different network, so it must never be auto-granted while the user
    // is on regtest.
    'bitcoin-mainnet': { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet' },
};

const chainRegistry = {
    descriptorFor: (id) => DESCRIPTORS[id] ?? null,
    get: (id) => DESCRIPTORS[id] ?? null,
    supportedChains: () => Object.values(DESCRIPTORS),
};

function fakeVault({ developerMode = true, autoApproveLocalhost = true } = {}) {
    /** @type {Map<string, object>} */
    const sites = new Map();
    return {
        _sites: sites,
        settings: {
            get: async () => ({
                developerMode,
                autoApproveLocalhost,
                activeNetwork: 'regtest',
                // "Active" chains = those with seeded per-chain fee state.
                fees: { 'bitcoin-regtest': {}, 'litecoin-regtest': {}, 'bitcoin-mainnet': {} },
            }),
        },
        accounts: {
            list: async () => [
                { id: 'acct-primary', name: 'Account 1' },
                { id: 'acct-second', name: 'Account 2' },
                { id: 'acct-third', name: 'Account 3' },
            ],
        },
        connectedSites: {
            list: async () => [...sites.values()],
            findBy: async (field, value) => [...sites.values()].filter((s) => s[field] === value),
            put: async (s) => { sites.set(s.id, s); return s; },
            delete: async (id) => { sites.delete(id); },
        },
    };
}

// An approvals stub that records whether the user was actually prompted.
function fakeApprovals(decision) {
    const calls = [];
    return {
        calls,
        connect: async (req) => {
            calls.push(req);
            return decision;
        },
    };
}

function connect(vault, { approvals, req } = {}) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals: approvals ?? fakeApprovals({ approved: false }) });
    return host.handle({
        type: 'bridge.connect',
        request: { origin: ORIGIN, appName: 'dev dApp', ...req },
    });
}

describe('bridge.connect: Developer-Mode auto-approve grants a concrete scope', () => {
    let vault;
    beforeEach(() => { vault = fakeVault(); });

    it('does NOT grant a wildcard when the dApp names no chains or accounts', async () => {
        const res = await connect(vault, { req: {} });
        expect(res.ok).toBe(true);

        // The bug: both lists came back empty, which this permission model reads
        // as "everything permitted".
        expect(res.result.chains).not.toEqual([]);
        expect(res.result.accounts).not.toEqual([]);

        // Chains: every chain on the ACTIVE network, and nothing off it.
        expect(res.result.chains.sort()).toEqual(['bitcoin-regtest', 'litecoin-regtest']);
        expect(res.result.chains).not.toContain('bitcoin-mainnet');

        // Accounts: the primary account only. A dApp must not be able to
        // enumerate the user's other accounts by asking for nothing.
        // ConnectSuccess.accounts is `Account[]`, and `permissions.accounts`
        // is the id list the grant stores ().
        expect(res.result.accounts).toEqual([{ id: 'acct-primary', name: 'Account 1' }]);
        expect(res.result.permissions.accounts).toEqual(['acct-primary']);

        const [site] = [...vault._sites.values()];
        expect(site.permissions.chains).toEqual(res.result.chains);
        expect(site.permissions.accounts).toEqual(['acct-primary']);
        expect(site.autoApproved).toBe(true);
        // Signing is never auto-granted.
        expect(site.permissions.canSignMessage).toBe(false);
        expect(site.permissions.canSignAction).toEqual({});
    });

    it('narrows to the request, and never widens beyond the wallet state', async () => {
        const res = await connect(vault, {
            req: {
                chains: ['bitcoin-regtest', 'bitcoin-mainnet', 'dogecoin-regtest'],
                accounts: ['acct-second', 'acct-does-not-exist'],
            },
        });
        expect(res.ok).toBe(true);
        // Off-network and unknown chains are dropped; only the real intersection survives.
        expect(res.result.chains).toEqual(['bitcoin-regtest']);
        // A non-existent account id cannot conjure a grant.
        expect(res.result.permissions.accounts).toEqual(['acct-second']);
        expect(res.result.accounts).toEqual([{ id: 'acct-second', name: 'Account 2' }]);
    });

    it('falls back to the approval prompt when no concrete scope resolves', async () => {
        const approvals = fakeApprovals({ approved: false });
        // Asks only for chains the wallet does not have on the active network.
        const res = await connect(vault, {
            approvals,
            req: { chains: ['bitcoin-mainnet'] },
        });
        expect(approvals.calls.length, 'user was prompted').toBe(1);
        expect(res.ok).toBe(false); // stub rejects
        expect(vault._sites.size).toBe(0);
    });

    it('prompts (no auto-approve) for a non-localhost origin', async () => {
        const approvals = fakeApprovals({ approved: false });
        const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
        registerBridgeHandlers(host, { approvals });
        await host.handle({
            type: 'bridge.connect',
            request: { origin: 'https://evil.example', appName: 'evil' },
        });
        expect(approvals.calls.length).toBe(1);
    });

    it('prompts when Developer Mode is off, even on localhost', async () => {
        const approvals = fakeApprovals({ approved: false });
        await connect(fakeVault({ developerMode: false }), { approvals, req: {} });
        expect(approvals.calls.length).toBe(1);
    });
});

describe('bridge.connect: an auto-approved grant cannot outlive the setting', () => {
    it('re-prompts and drops the grant once auto-approve is turned off', async () => {
        // 1. Connect under Developer Mode: the grant is synthesized, no prompt.
        const vault = fakeVault();
        const first = await connect(vault, { req: {} });
        expect(first.ok).toBe(true);
        expect(vault._sites.size).toBe(1);
        const granted = [...vault._sites.values()][0];
        expect(granted.autoApproved).toBe(true);

        // 2. The user turns Developer Mode off. The old auto-approved record is
        //    still in the vault, and findConnectedSite would short-circuit on it.
        vault.settings.get = async () => ({
            developerMode: false,
            autoApproveLocalhost: false,
            activeNetwork: 'regtest',
            fees: { 'bitcoin-regtest': {} },
        });

        // 3. Reconnecting must NOT silently reuse the never-user-approved grant.
        const approvals = fakeApprovals({ approved: false });
        const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
        registerBridgeHandlers(host, { approvals });
        const second = await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dev dApp' },
        });

        expect(approvals.calls.length, 'user was prompted on reconnect').toBe(1);
        expect(second.ok).toBe(false);
        expect(vault._sites.size, 'stale auto-grant was dropped').toBe(0);
    });

    it('keeps a user-approved grant across a Developer-Mode change', async () => {
        // A site the USER approved carries no autoApproved flag, so it must
        // survive untouched: this re-gate targets synthesized grants only.
        const vault = fakeVault({ developerMode: false, autoApproveLocalhost: false });
        const approvals = fakeApprovals({
            approved: true,
            chains: ['bitcoin-regtest'],
            accounts: ['acct-second'],
            canSignMessage: true,
            canSignAction: { SEND: 'ask' },
        });
        const first = await connect(vault, { approvals, req: {} });
        expect(first.ok).toBe(true);
        const site = [...vault._sites.values()][0];
        expect(site.autoApproved).toBeUndefined();

        const second = await connect(vault, { approvals, req: {} });
        expect(second.ok).toBe(true);
        expect(second.result.permissions.accounts).toEqual(['acct-second']);
        // Still exactly one prompt: the second connect reused the stored grant.
        expect(approvals.calls.length).toBe(1);
        expect(vault._sites.size).toBe(1);
    });
});
