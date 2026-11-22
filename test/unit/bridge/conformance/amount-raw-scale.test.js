// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendToken } = vi.hoisted(() => ({ sendToken: vi.fn() }));
vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, sendToken } };
});

const { MessageHost } = await import(
    '../../../../packages/extension/src/background/MessageHost.js'
);
const { registerBridgeHandlers } = await import(
    '../../../../packages/extension/src/bridge/handlers.js'
);

const ORIGIN = 'app-origin';
const CHAIN = 'bitcoin-regtest';
const FROM = 'bcrt1qfromaddress';
const TO = 'bcrt1qtoaddress';
const descriptor = { id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' };
const site = {
    id: 'site-1',
    origin: ORIGIN,
    permissions: {
        chains: [CHAIN], accounts: [], canSignMessage: false, canSignAction: { SEND: 'ask' },
    },
};
const chainRegistry = {
    get: (id) => (id === CHAIN ? descriptor : null),
    descriptorFor: (id) => (id === CHAIN ? descriptor : null),
    supportedChains: () => [descriptor],
};

function makeVault() {
    return {
        settings: { get: async () => ({ activeNetwork: 'regtest', fees: { [CHAIN]: {} } }) },
        wallets: { list: async () => [] },
        pendingTxs: { list: async () => [] },
        accounts: {
            list: async () => [{ id: 'acct-1', walletId: 'wallet-1' }],
            get: async () => ({ id: 'acct-1', walletId: 'wallet-1' }),
        },
        addresses: {
            list: async () => [{
                id: 'addr-1', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest',
                address: FROM, publicKey: '02aa', derivationPath: "m/84'/1'/0'/0/0",
            }],
        },
        connectedSites: {
            list: async () => [site],
            findBy: async (field, value) => (site[field] === value ? [site] : []),
            put: async (stored) => stored,
        },
    };
}

function hostFor(tokens) {
    const sdkRegistry = {
        get: () => ({
            getAddress: async () => ({ balances: { confirmed: '1' } }),
            getBalances: async () => ({ data: tokens }),
        }),
    };
    const approvals = {
        signAction: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }),
    };
    const host = new MessageHost({ vault: makeVault(), chainRegistry, sdkRegistry });
    registerBridgeHandlers(host, { approvals, signThrottle: { check: () => ({ allowed: true }) } });
    return host;
}

function send(host, asset) {
    return host.handle({
        type: 'bridge.signAction',
        request: {
            origin: ORIGIN,
            chainId: CHAIN,
            action: 'SEND',
            params: { fromAddress: FROM, toAddress: TO, asset, amountRaw: '10000' },
        },
    });
}

beforeEach(() => {
    sendToken.mockReset().mockResolvedValue({ txid: 'txid' });
});

describe('amountRaw token scale', () => {
    it.each([
        ['missing', { tick: 'NODEC', amount: '3000' }],
        ['null', { tick: 'NODEC', amount: '3000', decimals: null }],
    ])('refuses a %s scale before signing', async (_label, row) => {
        const response = await send(hostFor([row]), 'NODEC');
        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/^bridge: INVALID_PARAMS/);
        expect(sendToken).not.toHaveBeenCalled();
    });

    it('keeps explicit zero divisibility valid', async () => {
        const response = await send(
            hostFor([{ tick: 'WHOLE', amount: '3000', decimals: 0 }]),
            'WHOLE',
        );
        expect(response.ok, response.error?.message).toBe(true);
        expect(sendToken).toHaveBeenCalledOnce();
        expect(sendToken.mock.calls[0][0].amount).toBe('10000');
    });
});
