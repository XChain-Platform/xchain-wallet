// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A dApp SEND whose broadcast fails transiently waits in the broadcast queue,
// and its queue entry holds its coins: a second dApp send built over the same
// coin is refused before it signs, so the queued bytes and a re-signed copy
// can never both pay.
//
// Driven through the real background host, bridge handlers, sendToken,
// submitAction and submitWithSigner. Only the edges are fakes: the vault, the
// approval, the wallet unlock and the SDK, whose broadcast cannot reach a node.

import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';

const COIN = { prevTxHash: 'aa'.repeat(32), prevTxIndex: 0 };

// The raw transaction the signer hands back spends COIN, which is what the
// queue entry's coin hold reads: version 2, one input (COIN, empty scriptSig,
// RBF sequence), one 10000-sat P2WPKH output, locktime 0. Written as bytes so
// the fixture does not depend on which bitcoinjs-lib major resolves.
const RAW = `02000000 01 ${'aa'.repeat(32)} 00000000 00 fdffffff 01 1027000000000000 16 0014${'11'.repeat(20)} 00000000`
    .replace(/ /g, '');
const sha256 = (buf) => createHash('sha256').update(buf).digest();
const TXID = Buffer.from(sha256(sha256(Buffer.from(RAW, 'hex')))).reverse().toString('hex');

const signer = {
    kind: 'software',
    signPsbt: vi.fn(async () => ({ txHex: RAW, txid: TXID })),
    lock: vi.fn(),
};

vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => ({
    ...(await importOriginal()),
    unlockWallet: vi.fn(async () => signer),
}));

const { createBackgroundHost } = await import('../../../packages/extension/src/background/createBackgroundHost.js');

const ORIGIN = 'https://dapp.example';
const FROM = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const TO = 'bcrt1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qzf4jry';
const descriptor = { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest', nativeTick: 'BTC', addressTypes: ['p2wpkh'] };

function fakeVault() {
    const site = { id: 'site-1', origin: ORIGIN, permissions: { chains: [descriptor.id], accounts: [], canSignAction: {}, canSignMessage: false } };
    const account = { id: 'acct-1', walletId: 'wallet-1' };
    const pending = new Map();
    return {
        settings: { get: async () => ({ activeNetwork: 'regtest', blockedOrigins: [] }), put: async () => {} },
        connectedSites: { findBy: async (f, v) => [site].filter((s) => s[f] === v), put: async () => site },
        wallets: { list: async () => [{ id: 'wallet-1' }], get: async () => ({ id: 'wallet-1' }) },
        accounts: { list: async () => [account], get: async () => account, findBy: async (f, v) => [account].filter((a) => a[f] === v) },
        addresses: {
            list: async () => [{
                id: 'addr-1', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest', address: FROM,
                publicKey: `02${'aa'.repeat(32)}`, derivationPath: "m/84'/1'/0'/0/0",
            }],
        },
        pendingTxs: {
            put: async (r) => { pending.set(r.id, { ...r }); },
            get: async (id) => (pending.has(id) ? { ...pending.get(id) } : null),
            list: async () => [...pending.values()],
            findBy: async (k, v) => [...pending.values()].filter((r) => r[k] === v),
        },
    };
}

function makeHost() {
    const pay = { address: TO, scriptPubKeyHex: '0014bb', scriptType: 'p2wpkh', value: '10000' };
    const change = { address: FROM, scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 90000 };
    const sdk = {
        config: { network: 'regtest' },
        encoder: {
            createTx: vi.fn(async () => ({ psbt: 'BUILT', encoding: 'OP_RETURN' })),
            broadcastTx: vi.fn(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:18443'); }),
            getUTXOs: async () => ({ utxos: [] }),
        },
        actions: { createAction: (a) => ({ actionString: `${a.action}|x`, action: a.action, version: 0 }) },
        wallet: { decomposePsbt: () => ({ inputs: [COIN], outputs: [pay, change] }) },
        decoder: { decodeActionStringFromPsbt: () => ({ ok: false }) },
        getAddress: async () => ({ balances: { confirmed: '1.5' } }),
        getBalances: async () => ({ data: [] }),
        getGatedKeys: async () => [],
        getTokenInfo: async () => null,
    };
    const host = createBackgroundHost({
        broadcastQueueStorage: { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { signAction: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: fakeVault(),
        chainRegistry: { get: () => descriptor, descriptorFor: () => descriptor, supportedChains: () => [descriptor], chainIdFor: () => descriptor.id, list: () => [descriptor] },
        sdkRegistry: { get: () => sdk, for: () => sdk },
    });
    return { sdk, call: (type, request) => host.handle({ type, request }) };
}

const SEND = { origin: ORIGIN, chainId: descriptor.id, action: 'SEND', params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' } };

describe('a dApp SEND whose broadcast fails transiently', () => {
    it('waits in the queue and keeps its coin from a second dApp send', async () => {
        const { sdk, call } = makeHost();
        expect((await call('broadcast.queue.list', { walletId: 'wallet-1' })).result).toEqual([]);

        const first = await call('bridge.signAction', SEND);
        expect(first.ok).toBe(false);
        expect(sdk.encoder.broadcastTx).toHaveBeenCalledTimes(1);
        const listed = (await call('broadcast.queue.list', { walletId: 'wallet-1' })).result;
        expect(listed).toHaveLength(1);
        expect(listed[0].signedTxHex).toBe(RAW);

        const second = await call('bridge.signAction', SEND);
        expect(second.ok).toBe(false);
        expect(second.error?.message ?? '').toMatch(/already been used/);
        expect(signer.signPsbt).toHaveBeenCalledTimes(1);
    });
});
