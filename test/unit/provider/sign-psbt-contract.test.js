// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const flowMocks = vi.hoisted(() => ({ signPsbtFlow: vi.fn() }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, ...flowMocks } };
});

const { MessageHost } = await import(
    '../../../packages/extension/src/background/MessageHost.js'
);
const { registerBridgeHandlers } = await import(
    '../../../packages/extension/src/bridge/handlers.js'
);

const ORIGIN = 'https://dapp.example';
const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qfromaddress';
const SITE = {
    id: 'site-1',
    origin: ORIGIN,
    appName: 'dApp',
    permissions: {
        chains: [CHAIN],
        accounts: ['acct-1'],
        canSignMessage: true,
        canSignAction: {},
    },
};
const DESCRIPTOR = {
    id: CHAIN,
    coin: 'bitcoin',
    networkKind: 'regtest',
};
const chainRegistry = {
    get: (id) => (id === CHAIN ? DESCRIPTOR : null),
    descriptorFor: (id) => (id === CHAIN ? DESCRIPTOR : null),
    chainIdFor: () => CHAIN,
    supportedChains: () => [DESCRIPTOR],
};
const approvals = { signPsbt: vi.fn() };

function makeVault(settings = { activeNetwork: 'regtest', blockedOrigins: [] }) {
    return {
        settings: { get: async () => settings },
        connectedSites: {
            list: async () => [SITE],
            findBy: async (field, value) => (SITE[field] === value ? [SITE] : []),
            put: async (site) => site,
        },
        accounts: {
            list: async () => [{ id: 'acct-1', name: 'Primary', walletId: 'wallet-1' }],
            get: async (id) => (id === 'acct-1'
                ? { id, name: 'Primary', walletId: 'wallet-1' }
                : null),
        },
        addresses: {
            list: async () => [{
                id: 'addr-1',
                accountId: 'acct-1',
                address: ADDRESS,
                chain: 'bitcoin',
                network: 'regtest',
                derivationPath: "m/84'/1'/0'/0/0",
            }],
        },
        wallets: { list: async () => [{ id: 'wallet-1' }] },
    };
}

function buildHost(vault = makeVault()) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, {
        approvals,
        signThrottle: { check: () => ({ allowed: true }) },
    });
    return host;
}

function request(broadcast) {
    return {
        type: 'bridge.signPsbt',
        request: {
            origin: ORIGIN,
            chainId: CHAIN,
            psbtHex: '70736274',
            signingPaths: [{ inputIndex: 0, address: ADDRESS }],
            ...(broadcast === undefined ? {} : { broadcast }),
        },
    };
}

beforeEach(() => {
    approvals.signPsbt.mockReset().mockResolvedValue({ approved: true, password: 'pw' });
    flowMocks.signPsbtFlow.mockReset().mockResolvedValue({
        signedPsbtHex: 'signed',
        txHex: 'finalized',
        txid: 'calculated-not-broadcast',
    });
});

describe('bridge.signPsbt broadcast contract', () => {
    it.each([undefined, false])(
        'returns signed payloads without a broadcast receipt for %s',
        async (broadcast) => {
            const response = await buildHost().handle(request(broadcast));

            expect(response.ok).toBe(true);
            expect(response.result).toEqual({
                ok: true,
                signedPsbtHex: 'signed',
                txHex: 'finalized',
            });
            expect(approvals.signPsbt).toHaveBeenCalledOnce();
            expect(flowMocks.signPsbtFlow).toHaveBeenCalledOnce();
        },
    );

    it.each([true, 'yes'])(
        'refuses unsupported broadcast value %s before prompting',
        async (broadcast) => {
            const response = await buildHost().handle(request(broadcast));

            expect(response.ok).toBe(false);
            expect(response.error.code).toBe('INVALID_PARAMS');
            expect(approvals.signPsbt).not.toHaveBeenCalled();
            expect(flowMocks.signPsbtFlow).not.toHaveBeenCalled();
        },
    );

    it('refuses an inactive network before prompting', async () => {
        const response = await buildHost(makeVault({ activeNetwork: 'mainnet', blockedOrigins: [] }))
            .handle(request(false));

        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/CHAIN_NOT_PERMITTED/);
        expect(approvals.signPsbt).not.toHaveBeenCalled();
        expect(flowMocks.signPsbtFlow).not.toHaveBeenCalled();
    });

    it('keeps INVALID_PARAMS for broadcast true on an inactive network', async () => {
        const response = await buildHost(makeVault({ activeNetwork: 'mainnet', blockedOrigins: [] }))
            .handle(request(true));

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('INVALID_PARAMS');
        expect(approvals.signPsbt).not.toHaveBeenCalled();
    });

    it('refuses when the network changes during approval', async () => {
        const settings = { activeNetwork: 'regtest', blockedOrigins: [] };
        approvals.signPsbt.mockImplementationOnce(async () => {
            settings.activeNetwork = 'mainnet';
            return { approved: true, password: 'pw' };
        });
        const response = await buildHost(makeVault(settings)).handle(request(false));

        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/CHAIN_NOT_PERMITTED/);
        expect(flowMocks.signPsbtFlow).not.toHaveBeenCalled();
    });
});
