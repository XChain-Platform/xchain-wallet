// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// bridge.signAction / bridge.parallel contract pins:
//   - a stored 'always' grant never skips the review or the password: the
//     request still reaches approvals.signAction, flagged alreadyGranted so
//     the screen does not offer to save the grant again;
//   - a SEND naming both `amount` and `amountRaw` is refused before any prompt;
//   - the grouped parallel modal is handed the converted, protocol-shaped
//     payload, never the page's literal params.

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const ORIGIN = 'https://dapp.example';
const FROM = 'bcrt1qfrom';
const TO = 'bcrt1qto';

const descriptor = { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' };
const chainRegistry = {
    get: (id) => (id === descriptor.id ? descriptor : null),
    descriptorFor: (id) => (id === descriptor.id ? descriptor : null),
    supportedChains: () => [descriptor],
};

function fakeVault(canSignAction = {}) {
    const site = {
        id: 'site-1',
        origin: ORIGIN,
        permissions: { chains: [descriptor.id], accounts: [], canSignAction, canSignMessage: false },
    };
    return {
        settings: { get: async () => ({ activeNetwork: 'regtest', blockedOrigins: [] }) },
        connectedSites: {
            findBy: async (field, value) => [site].filter((s) => s[field] === value),
            put: async () => site,
            update: async (id, decide) => decide(site.id === id ? site : null) != null,
        },
        wallets: { list: async () => [{ id: 'wallet-1' }] },
        accounts: { list: async () => [], get: async () => ({ walletId: 'wallet-1' }) },
        addresses: {
            list: async () => [{
                id: 'addr-1',
                accountId: 'acct-1',
                chain: 'bitcoin',
                network: 'regtest',
                address: FROM,
                publicKey: '02aa',
                derivationPath: "m/84'/1'/0'/0/0",
            }],
        },
    };
}

const sdkRegistry = {
    get: () => ({
        getAddress: async () => ({ balances: { confirmed: '1.5' } }),
        getBalances: async () => ({ data: [] }),
    }),
};

function drive(type, request, { canSignAction, groupDecision = { approved: false } } = {}) {
    const calls = { signAction: [], parallel: [] };
    const approvals = {
        signAction: async (req) => { calls.signAction.push(req); return { approved: false }; },
        parallel: async (req) => { calls.parallel.push(req); return groupDecision; },
    };
    const host = new MessageHost({ vault: fakeVault(canSignAction), chainRegistry, sdkRegistry });
    registerBridgeHandlers(host, { approvals });
    return host.handle({ type, request: { origin: ORIGIN, ...request } }).then((resp) => ({ resp, calls }));
}

const sendParams = (extra) => ({ fromAddress: FROM, toAddress: TO, asset: 'BTC', ...extra });

describe('bridge.signAction: a stored always grant', () => {
    it('still prompts, flagged alreadyGranted so the save box is not re-offered', async () => {
        const { calls } = await drive('bridge.signAction', {
            chainId: descriptor.id,
            action: 'SEND',
            params: sendParams({ amountRaw: '10000' }),
        }, { canSignAction: { SEND: 'always' } });
        expect(calls.signAction).toHaveLength(1);
        expect(calls.signAction[0].payload.alreadyGranted).toBe(true);
        expect(calls.signAction[0].payload.AMOUNT).toBe('0.0001');
    });

    it('offers the save box on an ask grant', async () => {
        const { calls } = await drive('bridge.signAction', {
            chainId: descriptor.id,
            action: 'SEND',
            params: sendParams({ amountRaw: '10000' }),
        }, { canSignAction: { SEND: 'ask' } });
        expect(calls.signAction).toHaveLength(1);
        expect(calls.signAction[0].payload.alreadyGranted).toBeUndefined();
    });
});

describe('bridge.signAction: SEND carrying both amount fields', () => {
    it('is refused with INVALID_PARAMS before any prompt', async () => {
        const { resp, calls } = await drive('bridge.signAction', {
            chainId: descriptor.id,
            action: 'SEND',
            params: sendParams({ amountRaw: '10000', amount: '10000' }),
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toContain('INVALID_PARAMS');
        expect(calls.signAction).toHaveLength(0);
    });

    it('still accepts the legacy decimal alone', async () => {
        const { resp, calls } = await drive('bridge.signAction', {
            chainId: descriptor.id,
            action: 'SEND',
            params: sendParams({ amount: '0.5' }),
        });
        expect(resp.ok).toBe(false);
        expect(calls.signAction).toHaveLength(1);
        expect(calls.signAction[0].payload.AMOUNT).toBe('0.5');
    });

    it.each([
        { amount: 9007199254740993 },
        { amountRaw: 9007199254740993 },
    ])('refuses unsafe numeric amount input before any prompt', async (extra) => {
        const { resp, calls } = await drive('bridge.signAction', {
            chainId: descriptor.id,
            action: 'SEND',
            params: sendParams(extra),
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toContain('INVALID_PARAMS');
        expect(calls.signAction).toHaveLength(0);
    });

    it('refuses sub-satoshi native precision before any prompt', async () => {
        const { resp, calls } = await drive('bridge.signAction', {
            chainId: descriptor.id,
            action: 'SEND',
            params: sendParams({ amount: '1.000000009' }),
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toContain('INVALID_PARAMS');
        expect(calls.signAction).toHaveLength(0);
    });

    it('still prompts for an exact one-satoshi native amount', async () => {
        const { calls } = await drive('bridge.signAction', {
            chainId: descriptor.id,
            action: 'SEND',
            params: sendParams({ amount: '0.00000001' }),
        });
        expect(calls.signAction).toHaveLength(1);
    });
});

describe('bridge.parallel: the grouped modal payload', () => {
    it('shows the converted protocol shape, not the page params', async () => {
        const { calls } = await drive('bridge.parallel', {
            actions: [{
                chainId: descriptor.id,
                action: 'SEND',
                params: sendParams({ amountRaw: '10000' }),
            }],
        });
        expect(calls.parallel).toHaveLength(1);
        const row = calls.parallel[0].actions[0];
        expect(row.payload.AMOUNT).toBe('0.0001');
        expect(row.payload.TICK).toBe('BTC');
        expect(row.payload.DESTINATION).toBe(TO);
    });

    it('answers a slot that cannot be resolved without showing it', async () => {
        const { resp, calls } = await drive('bridge.parallel', {
            actions: [{
                chainId: descriptor.id,
                action: 'SEND',
                params: sendParams({ amountRaw: '10000', amount: '1' }),
            }],
        });
        expect(resp.ok).toBe(true);
        expect(resp.result[0].ok).toBe(false);
        expect(resp.result[0].message).toContain('INVALID_PARAMS');
        expect(calls.parallel).toHaveLength(0);
    });

    it('refuses an unsafe numeric slot before the grouped prompt', async () => {
        const { resp, calls } = await drive('bridge.parallel', {
            actions: [{
                chainId: descriptor.id,
                action: 'SEND',
                params: sendParams({ amount: 9007199254740993 }),
            }],
        });
        expect(resp.result[0].ok).toBe(false);
        expect(resp.result[0].message).toContain('INVALID_PARAMS');
        expect(calls.parallel).toHaveLength(0);
    });

    it('opens no modal when every slot is refused before it', async () => {
        const { resp, calls } = await drive('bridge.parallel', {
            actions: [
                { chainId: 'litecoin-regtest', action: 'SEND', params: sendParams({ amountRaw: '10000' }) },
                { chainId: descriptor.id, action: 'SEND', params: sendParams({ amountRaw: '10000' }) },
            ],
        }, { canSignAction: { SEND: 'never' }, groupDecision: { approved: true, password: 'pw' } });
        expect(resp.ok).toBe(true);
        expect(resp.result.map((r) => r.ok)).toEqual([false, false]);
        expect(resp.result[0].message).toContain('CHAIN_NOT_PERMITTED');
        expect(resp.result[1].message).toContain('ACTION_REJECTED_BY_POLICY');
        expect(calls.parallel).toHaveLength(0);
        expect(calls.signAction).toHaveLength(0);
    });

    it('lists only the slots that passed: one modal, no per-action prompt', async () => {
        const { resp, calls } = await drive('bridge.parallel', {
            actions: [
                { chainId: 'litecoin-regtest', action: 'SEND', params: sendParams({ amount: '1' }) },
                { chainId: descriptor.id, action: 'SEND', params: sendParams({ amountRaw: '10000' }) },
            ],
        }, { groupDecision: { approved: true, password: 'pw' } });
        expect(calls.parallel).toHaveLength(1);
        expect(calls.parallel[0].actions).toHaveLength(1);
        expect(calls.parallel[0].actions[0].chainId).toBe(descriptor.id);
        expect(calls.parallel[0].actions[0].payload.AMOUNT).toBe('0.0001');
        expect(calls.signAction).toHaveLength(0);
        expect(resp.result).toHaveLength(2);
        expect(resp.result[0].message).toContain('CHAIN_NOT_PERMITTED');
    });

    it('refuses a divergence key before the modal on a slot with no amountRaw', async () => {
        const { resp, calls } = await drive('bridge.parallel', {
            actions: [{
                chainId: descriptor.id,
                action: 'SEND',
                params: sendParams({ amount: '0.5', legs: [] }),
            }],
        });
        expect(resp.ok).toBe(true);
        expect(resp.result[0].ok).toBe(false);
        expect(resp.result[0].message).toContain('INVALID_PARAMS');
        expect(calls.parallel).toHaveLength(0);
    });
});
