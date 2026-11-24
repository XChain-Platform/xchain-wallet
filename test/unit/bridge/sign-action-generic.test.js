// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const flowMocks = vi.hoisted(() => ({
    advancedAction: vi.fn(async () => ({ txid: 'generic-tx' })),
    sendToken: vi.fn(async () => ({ txid: 'send-tx' })),
    sweepToken: vi.fn(async () => ({ txid: 'sweep-tx' })),
    signPsbtFlow: vi.fn(async () => ({ signedPsbtHex: 'aa', txHex: 'bb' })),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: {
            ...actual.flows,
            ...flowMocks,
        },
    };
});

const { MessageHost } = await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } = await import('../../../packages/extension/src/bridge/handlers.js');

const ORIGIN = 'https://generic.example';
const CHAIN_ID = 'bitcoin-regtest';
const FROM = 'bcrt1qsource';
const TO = 'bcrt1qdestination';

const descriptor = { id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' };
const chainRegistry = {
    get: (id) => (id === CHAIN_ID ? descriptor : null),
    descriptorFor: (id) => (id === CHAIN_ID ? descriptor : null),
    supportedChains: () => [descriptor],
};

function fakeVault(settings) {
    const site = {
        id: 'site-1',
        origin: ORIGIN,
        permissions: {
            chains: [CHAIN_ID],
            accounts: [],
            canSignAction: {},
            canSignMessage: false,
        },
    };
    return {
        settings: { get: async () => settings, put: async () => {} },
        connectedSites: {
            findBy: async (field, value) => [site].filter((row) => row[field] === value),
            update: async (id, decide) => decide(id === site.id ? site : null) != null,
        },
        wallets: { list: async () => [{ id: 'wallet-1' }] },
        accounts: { list: async () => [], get: async () => ({ walletId: 'wallet-1' }) },
        addresses: {
            list: async () => [{
                id: 'address-1',
                accountId: 'account-1',
                chain: 'bitcoin',
                network: 'regtest',
                address: FROM,
                publicKey: '02aa',
                derivationPath: "m/84'/1'/0'/0/0",
            }],
        },
    };
}

function harness({ validation = { valid: true, errors: [] } } = {}) {
    const settings = { activeNetwork: 'regtest', blockedOrigins: [] };
    const sdk = {
        validateAction: vi.fn(async () => validation),
        actions: {
            composeActionString: vi.fn(({ action }) => ({
                action,
                version: 0,
                actionString: `${action}|0|BTC|1|${TO}`,
            })),
        },
    };
    const sdkRegistry = { get: () => sdk };
    const calls = [];
    const approvals = {
        signAction: vi.fn(async (request) => {
            calls.push(request);
            return { approved: true, password: 'pw', walletId: 'wallet-1' };
        }),
        signPsbt: vi.fn(async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' })),
    };
    const host = new MessageHost({
        vault: fakeVault(settings),
        chainRegistry,
        sdkRegistry,
    });
    registerBridgeHandlers(host, { approvals });
    return { approvals, calls, host, sdk, settings };
}

function signAction(host, params, from = FROM) {
    return host.handle({
        type: 'bridge.signAction',
        request: {
            origin: ORIGIN,
            chainId: CHAIN_ID,
            ...(from === null ? {} : { from }),
            action: 'SEND',
            params,
        },
    });
}

function uint32LE(value) {
    return [0, 8, 16, 24]
        .map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, '0'))
        .join('');
}

function psbtEntry(key, value) {
    const keyLength = (key.length / 2).toString(16).padStart(2, '0');
    const valueLength = (value.length / 2).toString(16).padStart(2, '0');
    return `${keyLength}${key}${valueLength}${value}`;
}

function versionedPsbt(transactionVersion) {
    const unsignedTransaction = `${uint32LE(transactionVersion)}000000000000`;
    return `70736274ff${psbtEntry('00', unsignedTransaction)}00`;
}

beforeEach(() => {
    for (const mock of Object.values(flowMocks)) mock.mockClear();
});

describe('bridge.signAction generic action path', () => {
    it('uses advancedAction for SDK-shaped SEND and forwards only screened params', async () => {
        const h = harness();
        const params = {
            TICK: 'BTC',
            AMOUNT: '1',
            DESTINATION: TO,
            fee: 99,
            feePerKb: 88,
            rbf: true,
        };

        const response = await signAction(h.host, params);

        expect(response.result, JSON.stringify(response)).toEqual({
            ok: true, txid: 'generic-tx', chainId: CHAIN_ID,
        });
        expect(flowMocks.sendToken).not.toHaveBeenCalled();
        expect(flowMocks.advancedAction).toHaveBeenCalledTimes(1);
        const options = flowMocks.advancedAction.mock.calls[0][0];
        expect(options.from).toMatchObject({ address: FROM, publicKey: '02aa' });
        expect(options.params).toMatchObject({
            TICK: 'BTC', AMOUNT: '1', DESTINATION: TO,
        });
        expect(options.params).not.toHaveProperty('fee');
        expect(options.params).not.toHaveProperty('feePerKb');
        expect(options.params).not.toHaveProperty('rbf');
        expect(options).toMatchObject({ adsPayout: false, trackPendingTx: true });
        expect(options.beforeBroadcast).toEqual(expect.any(Function));
        expect(h.sdk.validateAction).toHaveBeenCalledWith('SEND', options.params);
        expect(h.calls[0].payload).toMatchObject({
            TICK: 'BTC', AMOUNT: '1', DESTINATION: TO, from: { address: FROM },
        });
        expect(h.calls[0].payload.actionString).toContain('SEND|0|');
    });

    it('keeps fromAddress on the SEND compatibility path', async () => {
        const h = harness();

        const response = await signAction(h.host, {
            fromAddress: FROM,
            toAddress: TO,
            asset: 'BTC',
            amount: '1',
        }, null);

        expect(response.result).toEqual({ ok: true, txid: 'send-tx', chainId: CHAIN_ID });
        expect(flowMocks.sendToken).toHaveBeenCalledTimes(1);
        expect(flowMocks.advancedAction).not.toHaveBeenCalled();
        expect(h.sdk.validateAction).not.toHaveBeenCalled();
    });

    it('keeps the internal params.from alias on its existing transfer path', async () => {
        const h = harness();

        const response = await signAction(h.host, {
            from: FROM,
            to: TO,
            tick: 'BTC',
            amount: '1',
        }, null);

        expect(response.result).toEqual({ ok: true, txid: 'send-tx', chainId: CHAIN_ID });
        expect(flowMocks.sendToken).toHaveBeenCalledTimes(1);
        expect(flowMocks.advancedAction).not.toHaveBeenCalled();
    });

    it.each(['legs', 'prebuiltPsbt', 'utxos', 'customOutputs', 'encoding'])(
        'refuses %s before validation or approval',
        async (field) => {
            const h = harness();

            const response = await signAction(h.host, {
                TICK: 'BTC',
                AMOUNT: '1',
                DESTINATION: TO,
                [field]: 'attack',
            });

            expect(response.error.code).toBe('INVALID_PARAMS');
            expect(response.error.message).toContain(field);
            expect(h.sdk.validateAction).not.toHaveBeenCalled();
            expect(h.approvals.signAction).not.toHaveBeenCalled();
            expect(flowMocks.advancedAction).not.toHaveBeenCalled();
        },
    );

    it('returns SDK validation errors before approval', async () => {
        const h = harness({
            validation: { valid: false, errors: [{ message: 'AMOUNT is required' }] },
        });

        const response = await signAction(h.host, { TICK: 'BTC' });

        expect(response.error.code).toBe('INVALID_PARAMS');
        expect(response.error.message).toContain('AMOUNT is required');
        expect(h.approvals.signAction).not.toHaveBeenCalled();
        expect(flowMocks.advancedAction).not.toHaveBeenCalled();
    });

    it('rechecks the active network immediately before broadcast', async () => {
        const h = harness();
        await signAction(h.host, {
            TICK: 'BTC', AMOUNT: '1', DESTINATION: TO,
        });
        const { beforeBroadcast } = flowMocks.advancedAction.mock.calls[0][0];

        h.settings.activeNetwork = 'mainnet';

        await expect(beforeBroadcast()).rejects.toMatchObject({ internalCode: 'CHAIN_NOT_PERMITTED' });
    });
});

describe('bridge.signPsbt BIP-322 guard', () => {
    it('refuses a to_sign input before opening an approval', async () => {
        const h = harness();

        const response = await h.host.handle({
            type: 'bridge.signPsbt',
            request: {
                origin: ORIGIN,
                chainId: CHAIN_ID,
                psbtHex: versionedPsbt(0),
                signingPaths: [{ inputIndex: 0, address: FROM }],
            },
        });

        expect(response.error.code).toBe('INVALID_PARAMS');
        expect(h.approvals.signPsbt).not.toHaveBeenCalled();
        expect(flowMocks.signPsbtFlow).not.toHaveBeenCalled();
    });

    it('leaves other PSBT validation to the existing signing flow', async () => {
        const h = harness();

        const response = await h.host.handle({
            type: 'bridge.signPsbt',
            request: {
                origin: ORIGIN,
                chainId: CHAIN_ID,
                psbtHex: '70736274',
                signingPaths: [{ inputIndex: 0, address: FROM }],
            },
        });

        expect(response.result).toEqual({ ok: true, signedPsbtHex: 'aa', txHex: 'bb' });
        expect(h.approvals.signPsbt).toHaveBeenCalledTimes(1);
        expect(flowMocks.signPsbtFlow).toHaveBeenCalledTimes(1);
    });
});
