// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Signing routes decide the signer from the vault's own record of the address a
// request names, never from the request's say-so alone: a device address needs
// its own device's signerId, a software address takes none, a watch-only address
// is refused, and the hardware lane resolves an address only inside the request
// wallet, by id or by string on the request chain, refusing an ambiguous string.

import { describe, it, expect, vi } from 'vitest';

const { sendTokenMock } = vi.hoisted(() => ({ sendTokenMock: vi.fn() }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, sendToken: sendTokenMock } };
});

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

function memCollection(initial = []) {
    const clone = (r) => JSON.parse(JSON.stringify(r));
    const m = new Map(initial.map((r) => [r.id, clone(r)]));
    return {
        get: async (id) => (m.has(id) ? clone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, clone(rec)); },
        list: async () => Array.from(m.values()).map(clone),
        delete: async (id) => { m.delete(id); },
        find: async (id) => (m.has(id) ? clone(m.get(id)) : null),
        findBy: async (field, value) => Array.from(m.values()).filter((r) => r[field] === value).map(clone),
    };
}

const DESCRIPTORS = [
    { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'], nativeTicker: 'BTC' },
    { id: 'bitcoin-testnet', coin: 'bitcoin', networkKind: 'testnet', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'], nativeTicker: 'BTC' },
];
const chainRegistry = {
    has: (id) => DESCRIPTORS.some((d) => d.id === id),
    get: (id) => DESCRIPTORS.find((d) => d.id === id),
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    byNetworkKind: (kind) => DESCRIPTORS.filter((d) => d.networkKind === kind),
    chainIdFor: (coin, kind) => DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === kind)?.id ?? null,
    supportedChains: () => DESCRIPTORS,
};

const SHARED = 'bcrt1qshared';
const row = (over) => ({
    schemaVersion: 4, id: 'a', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest',
    source: 'hd', addressType: 'p2wpkh', derivationPath: "m/84'/1'/0'/0/0", address: 'bcrt1qa',
    publicKey: 'pub', label: 'A', pinned: false, hidden: false, signerId: null, role: 'receive',
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const signer = (id, walletId, kind = 'ledger') => ({
    schemaVersion: 1, id, walletId, kind, label: id, createdAt: '2026-01-01T00:00:00.000Z',
});

const ADDRESSES = [
    row({ id: 'hd-1', address: 'bcrt1qhd' }),
    row({ id: 'led-1', source: 'ledger', signerId: 'dev-1', address: 'bcrt1qled' }),
    row({ id: 'wo-1', source: 'watch-only', accountId: null, derivationPath: null, address: 'bcrt1qwo' }),
    row({ id: 'other-led', source: 'ledger', signerId: 'dev-2', accountId: 'acct-2', address: 'bcrt1qother' }),
    row({ id: 'shared-w1', source: 'ledger', signerId: 'dev-1', address: SHARED }),
    row({ id: 'shared-w2', source: 'ledger', signerId: 'dev-2', accountId: 'acct-2', address: SHARED }),
    row({ id: 'shared-w1-testnet', source: 'ledger', signerId: 'dev-1', network: 'testnet', address: SHARED }),
    row({ id: 'solo-w1', source: 'ledger', signerId: 'dev-1', address: 'bcrt1qsolo' }),
    row({ id: 'solo-w2', source: 'ledger', signerId: 'dev-2', accountId: 'acct-2', address: 'bcrt1qsolo' }),
    row({ id: 'dup-a', source: 'ledger', signerId: 'dev-1', address: 'bcrt1qdup' }),
    row({ id: 'dup-b', source: 'ledger', signerId: 'dev-1', address: 'bcrt1qdup' }),
];

function makeHost() {
    const vault = {
        wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'W', format: 'bip39', importedKeys: [] }]),
        accounts: memCollection([
            { schemaVersion: 2, id: 'acct-1', walletId: 'w1', index: 0, name: 'One', activeAddressByChainId: {}, createdAt: '2026-01-01T00:00:00.000Z' },
            { schemaVersion: 2, id: 'acct-2', walletId: 'w2', index: 0, name: 'Two', activeAddressByChainId: {}, createdAt: '2026-01-01T00:00:00.000Z' },
        ]),
        addresses: memCollection(ADDRESSES),
        signers: memCollection([signer('dev-1', 'w1'), signer('dev-2', 'w2')]),
        settings: {
            _rec: { schemaVersion: 2, activeNetwork: 'regtest', fees: {}, ads: { enabled: false, perChain: {} }, privacy: {} },
            async get() { return JSON.parse(JSON.stringify(this._rec)); },
            async put(r) { this._rec = JSON.parse(JSON.stringify(r)); },
        },
    };
    return createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => ({ wallet: { decomposePsbt: () => ({ inputs: [], outputs: [] }) } }) },
        signerPool: { get: () => ({ kind: 'software' }), has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

const base = { walletId: 'w1', chainId: 'bitcoin-regtest', params: {} };
const from = (id, extra = {}) => ({ addressId: id, address: 'x', publicKey: 'pub', derivationPath: null, ...extra });

async function send(host, request, type = 'action.send') {
    return host.handle({ type, request: { ...base, ...request } });
}

describe('a software route signs only with the signer the stored address calls for', () => {
    it('signs a software address with the pooled signer when no signerId rides along', async () => {
        sendTokenMock.mockReset().mockResolvedValue({ txid: 't' });
        const res = await send(makeHost(), { from: from('hd-1', { source: 'hd' }) });
        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        expect(sendTokenMock).toHaveBeenCalledTimes(1);
    });

    it('refuses a device address sent without a signerId, whatever source the request claims', async () => {
        sendTokenMock.mockReset();
        const res = await send(makeHost(), { from: from('led-1', { source: 'hd' }), password: 'pw' });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/ledger address; sign it with its own device/);
        expect(sendTokenMock).not.toHaveBeenCalled();
    });

    it('refuses a device address sent with another device signerId', async () => {
        sendTokenMock.mockReset();
        const res = await send(makeHost(), { from: from('led-1'), signerId: 'dev-2' });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/own device/);
        expect(sendTokenMock).not.toHaveBeenCalled();
    });

    it('refuses a software address sent with a device signerId', async () => {
        sendTokenMock.mockReset();
        const res = await send(makeHost(), { from: from('hd-1', { source: 'ledger' }), signerId: 'dev-1' });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/not a hardware address/);
        expect(sendTokenMock).not.toHaveBeenCalled();
    });

    it('refuses a watch-only address even when the request claims hd', async () => {
        sendTokenMock.mockReset();
        const res = await send(makeHost(), { from: from('wo-1', { source: 'hd' }) });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/watch-only/);
        expect(sendTokenMock).not.toHaveBeenCalled();
    });

    it('refuses auth.signMessage for a device address named by addressId with no signerId', async () => {
        const res = await send(makeHost(), { addressId: 'led-1', message: 'hi', password: 'pw' }, 'auth.signMessage');
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/own device/);
    });

    it('refuses auth.signMessage for a device address sent with another device signerId', async () => {
        const res = await send(makeHost(), { addressId: 'led-1', signerId: 'dev-2', message: 'hi' }, 'auth.signMessage');
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/own device/);
    });

    it('leaves an unknown address id to the flow', async () => {
        sendTokenMock.mockReset().mockResolvedValue({ txid: 't' });
        const res = await send(makeHost(), { from: from('missing', { source: 'hd' }) });
        expect(res.ok, JSON.stringify(res.error)).toBe(true);
    });
});

const NOT_CONNECTED = /Hardware signer is not connected/;

describe('the hardware lane resolves the address inside the request wallet', () => {
    it('accepts an address of this wallet by id', async () => {
        const res = await send(makeHost(), { from: from('led-1'), signerId: 'dev-1' }, 'action.send.hw');
        expect(res.error?.message).toMatch(NOT_CONNECTED);
    });

    it('refuses an address id that belongs to another wallet', async () => {
        const res = await send(makeHost(), { from: from('other-led'), signerId: 'dev-2' }, 'action.send.hw');
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/not in this wallet/);
    });

    it('refuses a request with no walletId', async () => {
        const res = await send(makeHost(), { walletId: undefined, from: from('led-1'), signerId: 'dev-1' }, 'action.send.hw');
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/walletId is required/);
    });

    it('picks this wallet\'s record when another wallet holds the same address string', async () => {
        const res = await send(makeHost(), { from: { address: 'bcrt1qsolo' } }, 'action.send.hw');
        expect(res.error?.message).toMatch(NOT_CONNECTED);
    });

    it('does not fall back to a string held only by another wallet', async () => {
        const res = await send(makeHost(), { from: { address: 'bcrt1qother' } }, 'action.send.hw');
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/could not resolve source address record/);
    });

    // This wallet holds the string on regtest and on testnet: only the chain
    // filter leaves one record, so an unfiltered match would be ambiguous.
    it('narrows the string fallback to the request chain', async () => {
        const regtest = await send(makeHost(), { from: { address: SHARED } }, 'action.send.hw');
        expect(regtest.error?.message).toMatch(NOT_CONNECTED);
        const testnet = await send(makeHost(), { chainId: 'bitcoin-testnet', from: { address: SHARED } }, 'action.send.hw');
        expect(testnet.error?.message).toMatch(NOT_CONNECTED);
    });

    it('matches the delivery chain when a message names another chain for the recipient', async () => {
        const res = await send(makeHost(), {
            chainId: 'bitcoin-testnet', broadcastChainId: 'bitcoin-regtest', from: { address: 'bcrt1qsolo' },
        }, 'action.message.hw');
        expect(res.error?.message).toMatch(NOT_CONNECTED);
    });

    it('refuses a string that still matches two records of the wallet and chain', async () => {
        const res = await send(makeHost(), { from: { address: 'bcrt1qdup' } }, 'action.send.hw');
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/more than one address/);
    });
});

describe('auth.signPsbt.hw signs only an address of the request wallet', () => {
    const psbtRequest = (addressId) => ({ walletId: 'w1', addressId, psbtHex: '00' });

    it('refuses an address that belongs to another wallet', async () => {
        const res = await makeHost().handle({ type: 'auth.signPsbt.hw', request: psbtRequest('other-led') });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/not in this wallet/);
    });

    it('resolves this wallet\'s own device address', async () => {
        const res = await makeHost().handle({ type: 'auth.signPsbt.hw', request: psbtRequest('led-1') });
        expect(res.error?.message).toMatch(NOT_CONNECTED);
    });
});
