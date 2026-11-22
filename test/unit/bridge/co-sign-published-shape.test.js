// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// bridge.coSign answers with the published CoSignApprovedSuccess / CoSignRefused
// fields only, always carries `signatures` on an approval, and forwards the
// published `sighashType` to the co-sign flow that judges it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockXChainProvider } from '../../../packages/test-dapp/src/mock-provider.ts';

const flowMocks = vi.hoisted(() => ({
    passiveCoSignForAccount: vi.fn(),
    findCoSignerAccountByAddress: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, ...flowMocks } };
});

const { MessageHost } = await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } = await import('../../../packages/extension/src/bridge/handlers.js');

const ORIGIN = 'https://agent.example';
const CHAIN = 'bitcoin-regtest';
const SIGNATURE = { index: 0, publicNonce: 'aa', sig: 'bb', msg: 'cc' };

const specSource = readFileSync(join(process.cwd(), 'packages/bridge-spec/src/index.ts'), 'utf8');

function specFields(name) {
    const match = specSource.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
    expect(match, `${name} is present`).not.toBeNull();
    return [...match[1].matchAll(/^ {4}(\w+)\??:/gm)].map((field) => field[1]).sort();
}

function makeVault() {
    const site = {
        id: 'site-1', origin: ORIGIN, appName: 'agent',
        permissions: { chains: [CHAIN], accounts: [], canSignMessage: false, canSignAction: {} },
    };
    return {
        settings: { get: async () => ({ blockedOrigins: [] }) },
        addresses: { list: async () => [] },
        connectedSites: {
            findBy: async (field, value) => (site[field] === value ? [site] : []),
            put: async (entry) => entry,
            update: async (id, decide) => decide(site.id === id ? site : null) != null,
            delete: async () => {},
        },
    };
}

const approvals = {
    calls: [],
    coSign: async (request) => {
        approvals.calls.push(request);
        return { approved: true, password: 'pw' };
    },
};

async function coSign(extra = {}) {
    const host = new MessageHost({
        vault: makeVault(),
        chainRegistry: { get: () => ({ id: CHAIN }), supportedChains: () => [] },
        sdkRegistry: {},
    });
    registerBridgeHandlers(host, { approvals });
    return host.handle({
        type: 'bridge.coSign',
        request: {
            origin: ORIGIN, chainId: CHAIN, aggregateAddress: 'bcrt1pagg',
            psbtHex: '70736274', agentPublicNonce: '02ff', ...extra,
        },
    });
}

beforeEach(() => {
    approvals.calls.length = 0;
    flowMocks.passiveCoSignForAccount.mockReset();
    flowMocks.findCoSignerAccountByAddress.mockReset();
    flowMocks.findCoSignerAccountByAddress.mockResolvedValue({
        id: 'cosigner-1', aggregateAddress: 'bcrt1pagg', name: 'Policy signer', chainId: CHAIN,
    });
});

describe('bridge.coSign publishes only declared fields', () => {
    it('returns an approval as exactly the published shape and drops unpublished core fields', async () => {
        flowMocks.passiveCoSignForAccount.mockResolvedValue({
            approved: true, action: 'SEND', signatures: [{ ...SIGNATURE, extra: 'x' }], envelopeRole: 'commit',
        });
        const { result } = await coSign();
        expect(result).toStrictEqual({
            ok: true, approved: true, action: 'SEND', signatures: [SIGNATURE],
        });
        expect(Object.keys(result).sort()).toEqual(specFields('CoSignApprovedSuccess'));
    });

    it('rejects the retired top-level single-input outcome', async () => {
        flowMocks.passiveCoSignForAccount.mockResolvedValue({
            approved: true, publicNonce: 'aa', sig: 'bb', msg: 'cc', action: 'SEND',
        });
        const response = await coSign();
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('INTERNAL_ERROR');
        expect(response.error.message).toMatch(/invalid outcome/);
    });

    it('returns a refusal as exactly the published shape', async () => {
        flowMocks.passiveCoSignForAccount.mockResolvedValue({
            approved: false, reason: 'X', detail: null, envelopeRole: 'commit',
        });
        const { result } = await coSign();
        expect(result).toStrictEqual({ ok: true, approved: false, reason: 'X', detail: null });
    });

    it('serves the same published shape from the reference mock for both request forms', async () => {
        const provider = new MockXChainProvider();
        await provider.connect({ requestedChains: [CHAIN] });
        const base = { chainId: CHAIN, aggregateAddress: 'agg', psbtHex: '00' };
        const forms = [
            { ...base, agentPublicNonce: 'n' },
            { ...base, agentPublicNonce: 'n', inputIndex: 3 },
            { ...base, inputs: [{ index: 1, agentPublicNonce: 'a' }, { index: 4, agentPublicNonce: 'b' }] },
        ];
        const published = specFields('CoSignApprovedSuccess');
        const indexes = [[0], [3], [1, 4]];
        for (const [i, params] of forms.entries()) {
            const result = await provider.coSign(params);
            expect(Object.keys(result).sort()).toEqual(published);
            expect(result.signatures.map((entry) => entry.index)).toEqual(indexes[i]);
        }
    });
});

describe('bridge.coSign sighashType', () => {
    it('forwards an integer value, zero included, to the co-sign flow', async () => {
        flowMocks.passiveCoSignForAccount.mockResolvedValue({
            approved: false, reason: 'SIGHASH_TYPE_NOT_ALLOWED', detail: { sighashType: 1 },
        });
        const { result } = await coSign({ sighashType: 1 });
        expect(flowMocks.passiveCoSignForAccount.mock.calls[0][0].request.sighashType).toBe(1);
        expect(result).toStrictEqual({
            ok: true, approved: false, reason: 'SIGHASH_TYPE_NOT_ALLOWED', detail: { sighashType: 1 },
        });

        flowMocks.passiveCoSignForAccount.mockResolvedValue({ approved: true, signatures: [SIGNATURE] });
        await coSign({ sighashType: 0 });
        expect(flowMocks.passiveCoSignForAccount.mock.calls[1][0].request.sighashType).toBe(0);
    });

    it('sends no sighashType key when the page omitted it', async () => {
        flowMocks.passiveCoSignForAccount.mockResolvedValue({ approved: true, signatures: [SIGNATURE] });
        await coSign();
        expect(flowMocks.passiveCoSignForAccount.mock.calls[0][0].request).not.toHaveProperty('sighashType');
    });

    it('refuses a non-integer value before the user is prompted or the flow runs', async () => {
        for (const sighashType of ['1', 1.5, null, Number.NaN]) {
            const response = await coSign({ sighashType });
            expect(response.ok, String(sighashType)).toBe(false);
            expect(response.error.code, String(sighashType)).toBe('INVALID_PARAMS');
        }
        expect(approvals.calls).toHaveLength(0);
        expect(flowMocks.passiveCoSignForAccount).not.toHaveBeenCalled();
    });

    it('models the same contract on the reference mock', async () => {
        const provider = new MockXChainProvider();
        await provider.connect({ requestedChains: [CHAIN] });
        const base = { chainId: CHAIN, aggregateAddress: 'agg', psbtHex: '00', agentPublicNonce: 'n' };
        await expect(provider.coSign({ ...base, sighashType: 1 })).resolves.toEqual({
            ok: true, approved: false, reason: 'SIGHASH_TYPE_NOT_ALLOWED', detail: { sighashType: 1 },
        });
        await expect(provider.coSign({ ...base, sighashType: 1.5 })).resolves.toMatchObject({
            ok: false, error: 'INVALID_PARAMS',
        });
        await expect(provider.coSign({ ...base, sighashType: 0 })).resolves.toMatchObject({
            ok: true, approved: true,
        });
    });
});
