// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: bridge.coSign must enforce the connect-time per-account grant,
// the same gate every sibling signing route enforces (signMessage's
// assertAddressPermitted, signAction/parallel's chain+account scope,
// signPsbt's resolveBridgeSigningPaths). Before this fix, coSign checked only
// the chain grant (assertChainPermitted): a site connected for one account
// could name ANY enabled co-signer account's aggregate address and still
// reach the approval prompt, so only the human stood between it and a
// co-sign attempt for an account it was never granted.
//
// These tests drive bridge.coSign through a real MessageHost, exactly like
// connect-auto-approve-scope.test.js drives bridge.connect.

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const ORIGIN = 'https://agent.example';

const DESCRIPTORS = {
    'bitcoin-regtest': { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' },
};

const chainRegistry = {
    get: (id) => DESCRIPTORS[id] ?? null,
    supportedChains: () => Object.values(DESCRIPTORS),
};

// Account A's daemon key lives at m/86'/0'/0'/0/0 (owned by acct-a), account
// B's at m/86'/0'/1'/0/0 (owned by acct-b). Both co-signer accounts are
// enabled and reachable by aggregate address, mirroring two agent accounts
// the wallet has provisioned for two different vault accounts.
const ADDR_A = {
    id: 'addr-a', chain: 'bitcoin', network: 'regtest',
    derivationPath: "m/86'/0'/0'/0/0", accountId: 'acct-a',
};
const ADDR_B = {
    id: 'addr-b', chain: 'bitcoin', network: 'regtest',
    derivationPath: "m/86'/0'/1'/0/0", accountId: 'acct-b',
};

const COSIGNER_A = {
    id: 'cosigner-a', walletId: 'wallet-1', chainId: 'bitcoin-regtest',
    name: 'Agent A', aggregateAddress: 'bcrt1paggA',
    daemonDerivationPath: ADDR_A.derivationPath, enabled: true,
};
const COSIGNER_B = {
    id: 'cosigner-b', walletId: 'wallet-1', chainId: 'bitcoin-regtest',
    name: 'Agent B', aggregateAddress: 'bcrt1paggB',
    daemonDerivationPath: ADDR_B.derivationPath, enabled: true,
};

function fakeVault({ grantedAccounts = [] } = {}) {
    const site = {
        id: 'site-1',
        origin: ORIGIN,
        appName: 'agent dApp',
        permissions: {
            chains: [],
            accounts: grantedAccounts,
            canSignMessage: false,
            canSignAction: {},
        },
    };
    /** @type {Map<string, object>} */
    const sites = new Map([[site.id, site]]);
    const addresses = [ADDR_A, ADDR_B];
    const coSignerAccounts = [COSIGNER_A, COSIGNER_B];
    return {
        _sites: sites,
        settings: { get: async () => ({}) },
        addresses: { list: async () => addresses },
        coSignerAccounts: {
            findBy: async (field, value) => coSignerAccounts.filter((a) => a[field] === value),
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
    return {
        calls,
        coSign: async (req) => { calls.push(req); return decision; },
    };
}

function coSign(vault, { approvals, req } = {}) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals: approvals ?? fakeApprovals({ approved: false }) });
    return host.handle({
        type: 'bridge.coSign',
        request: {
            origin: ORIGIN,
            chainId: 'bitcoin-regtest',
            psbtHex: 'aabb',
            agentPublicNonce: '03' + 'c'.repeat(130),
            inputIndex: 0,
            ...req,
        },
    });
}

describe('bridge.coSign: connect-time account scope', () => {
    it('refuses a co-sign request for an account outside the grant, before any approval prompt', async () => {
        // Site was granted only acct-a, but names acct-b's aggregate address.
        const vault = fakeVault({ grantedAccounts: ['acct-a'] });
        const approvals = fakeApprovals({ approved: true, password: 'pw' });
        const res = await coSign(vault, { approvals, req: { aggregateAddress: COSIGNER_B.aggregateAddress } });

        expect(approvals.calls.length, 'user was never prompted').toBe(0);
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/ADDRESS_NOT_PERMITTED/);
    });

    it('still prompts for a co-sign request inside the grant', async () => {
        const vault = fakeVault({ grantedAccounts: ['acct-a'] });
        // The approval stub rejects, so the assertion below proves the scope
        // check let the request THROUGH to the prompt rather than proving the
        // full sign path (covered separately by passiveCoSignForAccount.test.js).
        const approvals = fakeApprovals({ approved: false });
        const res = await coSign(vault, { approvals, req: { aggregateAddress: COSIGNER_A.aggregateAddress } });

        expect(approvals.calls.length, 'user was prompted').toBe(1);
        expect(approvals.calls[0].payload.accountId).toBe(COSIGNER_A.id);
        expect(res.ok).toBe(false); // stub rejects
        expect(res.error.name).toBe('UserRejectedError');
    });

    it('an empty account grant (wildcard, §43.3) permits any enabled co-signer account', async () => {
        const vault = fakeVault({ grantedAccounts: [] });
        const approvals = fakeApprovals({ approved: false });
        const res = await coSign(vault, { approvals, req: { aggregateAddress: COSIGNER_B.aggregateAddress } });

        expect(approvals.calls.length, 'wildcard grant still prompts, never auto-denies').toBe(1);
        expect(res.error.name).toBe('UserRejectedError');
    });
});
