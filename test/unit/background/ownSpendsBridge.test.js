// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A dApp SEND is approved as an intent and its PSBT is built afterwards, so it
// claims its coins when the encoder returns that PSBT, before it signs. A
// second request built over the same coins (from the same site, another site
// or the wallet's own Send form) is refused instead of replacing the first.
//
// Driven through the real background host, bridge handlers, sendToken,
// submitAction and submitWithSigner. Only the edges are fakes: the vault, the
// approval (which says yes), the wallet unlock and the SDK.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const signer = {
    kind: 'software',
    signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    lock: vi.fn(),
};

vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => ({
    ...(await importOriginal()),
    unlockWallet: vi.fn(async () => signer),
}));

const { createBackgroundHost } = await import('../../../packages/extension/src/background/createBackgroundHost.js');

const ORIGIN = 'https://dapp.example';
// BIP173 regtest vectors, so address validation passes on the real path.
const FROM = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const TO = 'bcrt1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qzf4jry';
const ATTACKER = 'bcrt1q0xcqpzrky6eff2g52qdye53xkk9jxkvrh6yhyw';

const descriptor = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    networkKind: 'regtest',
    nativeTick: 'BTC',
    addressTypes: ['p2wpkh'],
};
const chainRegistry = {
    get: (id) => (id === descriptor.id ? descriptor : null),
    descriptorFor: (id) => (id === descriptor.id ? descriptor : null),
    supportedChains: () => [descriptor],
    chainIdFor: () => descriptor.id,
    list: () => [descriptor],
};

function fakeVault() {
    const site = {
        id: 'site-1',
        origin: ORIGIN,
        permissions: { chains: [descriptor.id], accounts: [], canSignAction: {}, canSignMessage: false },
    };
    const pending = new Map();
    return {
        settings: { get: async () => ({ blockedOrigins: [] }), put: async () => {} },
        connectedSites: {
            findBy: async (field, value) => [site].filter((s) => s[field] === value),
            put: async () => site,
        },
        wallets: { list: async () => [{ id: 'wallet-1' }], get: async () => ({ id: 'wallet-1' }) },
        accounts: { list: async () => [], get: async () => ({ id: 'acct-1', walletId: 'wallet-1' }) },
        addresses: {
            list: async () => [{
                id: 'addr-1',
                accountId: 'acct-1',
                chain: 'bitcoin',
                network: 'regtest',
                address: FROM,
                publicKey: `02${'aa'.repeat(32)}`,
                derivationPath: "m/84'/1'/0'/0/0",
            }],
        },
        pendingTxs: {
            put: async (r) => { pending.set(r.id, r); },
            get: async (id) => pending.get(id) ?? null,
            list: async () => [...pending.values()],
            findBy: async () => [],
        },
    };
}

const CHANGE = { address: FROM, scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 90000 };
const pay = (address, value) => ({ address, scriptPubKeyHex: '0014bb', scriptType: 'p2wpkh', value });

// Every build spends the same coin, as two builds do once the encoder's own
// five-minute hold on it has lapsed.
const COIN = { prevTxHash: 'aa'.repeat(32), prevTxIndex: 0 };

function fakeSdkRegistry() {
    let built = null;
    const sdk = {
        config: { network: 'regtest' },
        encoder: {
            createTx: vi.fn(async (opts) => { built = opts; return { psbt: 'BUILT', encoding: 'OP_RETURN' }; }),
            broadcastTx: vi.fn(async () => ({ txid: 'txid-BUILT' })),
            getUTXOs: async () => ({ utxos: [] }),
        },
        actions: {
            createAction: (actionData) => ({
                actionString: `${actionData.action}|${JSON.stringify(actionData.params)}`,
                action: actionData.action,
                version: 0,
            }),
        },
        wallet: { decomposePsbt: () => ({ inputs: [COIN], outputs: [pay(TO, '10000'), CHANGE] }) },
        decoder: {
            decodeActionStringFromPsbt: () => ({ ok: true, actionString: built?.data }),
        },
        getAddress: async () => ({ balances: { confirmed: '1.5' } }),
        getBalances: async () => ({ data: [] }),
        getGatedKeys: async () => [],
        getTokenInfo: async () => null,
    };
    return { sdk, sdkRegistry: { get: () => sdk, for: () => sdk } };
}

function makeHost(sdkRegistry) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { signAction: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: fakeVault(),
        chainRegistry,
        sdkRegistry,
    });
}

const dappSend = (amountRaw) => ({
    type: 'bridge.signAction',
    request: {
        origin: ORIGIN,
        chainId: descriptor.id,
        action: 'SEND',
        params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw },
    },
});

beforeEach(() => {
    signer.signPsbt.mockClear();
});

describe('a dApp SEND built after its approval', () => {
    it('refuses a second build over the coins the first one sent, before it signs', async () => {
        const { sdk, sdkRegistry } = fakeSdkRegistry();
        const host = makeHost(sdkRegistry);

        const first = await host.handle(dappSend('10000'));
        expect(first).toMatchObject({ ok: true, result: { ok: true } });
        expect(sdk.encoder.broadcastTx).toHaveBeenCalledTimes(1);
        expect(signer.signPsbt).toHaveBeenCalledTimes(1);

        const second = await host.handle(dappSend('10000'));
        expect(second.ok).toBe(false);
        expect(second.error?.message ?? '').toMatch(/already been used/);
        expect(signer.signPsbt).toHaveBeenCalledTimes(1);
        expect(sdk.encoder.broadcastTx).toHaveBeenCalledTimes(1);
    });
});
