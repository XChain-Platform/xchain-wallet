// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The confirm lane asks for the Taproot envelope for ANY action whose payload
// is over the legacy carrier, not only for Publish file.
//
// When only Publish file asks, a large MESSAGE or LIST from a Bitcoin
// software wallet fails at build time with "Combined compiled payload exceeds
// maximum (8192)" although the chain and the signer could carry it. The lane
// decides on payload size alone, so the generic compose route is driven here
// with a BROADCAST, the route every generic form shares.

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { envelopeEncoderOpts } from '../../../packages/core/src/flows/envelopeSelection.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        find: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value)
            .map((r) => JSON.parse(JSON.stringify(r))),
    };
}

const TAPROOT_CHAIN = {
    id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest',
    defaultAddressType: 'p2wpkh', addressTypes: ['p2pkh', 'p2wpkh', 'p2tr'], nativeTicker: 'BTC',
};
const LEGACY_CHAIN = {
    id: 'dogecoin-regtest', coin: 'dogecoin', networkKind: 'regtest',
    defaultAddressType: 'p2pkh', addressTypes: ['p2pkh'], nativeTicker: 'DOGE',
};
const DESCRIPTORS = [TAPROOT_CHAIN, LEGACY_CHAIN];

const chainRegistry = {
    has: (id) => DESCRIPTORS.some((d) => d.id === id),
    get: (id) => DESCRIPTORS.find((d) => d.id === id),
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    byNetworkKind: (kind) => DESCRIPTORS.filter((d) => d.networkKind === kind),
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
    supportedChains: () => DESCRIPTORS,
};

const SOURCE = 'addr_0_0_0';
// The spender's compressed key, which the encoder needs as the envelope internal key.
const PUBKEY = `02${'11'.repeat(32)}`;
const row = (id, source) => ({
    schemaVersion: 4, id, accountId: 'acct-1', chain: 'bitcoin', network: 'regtest',
    source, addressType: 'p2wpkh', derivationPath: "m/84'/1'/0'/0/0",
    address: SOURCE, publicKey: PUBKEY, label: 'BTC Address #1',
    pinned: false, hidden: false, signerId: 'signer-1', role: 'receive',
    createdAt: '2026-01-01T00:00:00.000Z',
});

// An action string as long as its params, so the payload size is real.
function makeSdk(createTx) {
    return {
        encoder: { createTx },
        actions: {
            createAction: vi.fn(({ action, params }) => ({
                actionString: `${action}|0|${Object.values(params || {}).join('|')}`, action, version: 0,
            })),
        },
        wallet: { decomposePsbt: vi.fn(() => ({ inputs: [{ value: 5000 }], outputs: [] })) },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: false, reason: 'stub' })),
            describe: vi.fn(() => ({ summary: 'act', details: [], warnings: [] })),
        },
    };
}

function makeHost() {
    const createTx = vi.fn(async () => ({ psbt: 'PSBTHEX', encoding: 'OP_RETURN' }));
    const vault = {
        wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'W', format: 'bip39', importedKeys: [] }]),
        accounts: memCollection([{
            schemaVersion: 2, id: 'acct-1', walletId: 'w1', index: 0, name: 'Main',
            activeAddressByChainId: {}, createdAt: '2026-01-01T00:00:00.000Z',
        }]),
        addresses: memCollection([row('addr-hd', 'hd'), row('addr-trezor', 'trezor')]),
        signers: memCollection(),
        settings: {
            _rec: {
                schemaVersion: 2, activeNetwork: 'regtest', fees: {},
                ads: { enabled: false, perChain: {} },
                privacy: { changeAddressRotation: false },
            },
            async get() { return JSON.parse(JSON.stringify(this._rec)); },
            async put(r) { this._rec = JSON.parse(JSON.stringify(r)); },
        },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => makeSdk(createTx) },
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, createTx };
}

function from(addressId, source) {
    return {
        address: SOURCE, publicKey: PUBKEY, derivationPath: "m/84'/1'/0'/0/0",
        addressId, source, signerId: 'signer-1',
    };
}

// The request BroadcastForm sends: action data and fee options, no encoding.
function broadcastRequest({ text, chainId = TAPROOT_CHAIN.id, addressId = 'addr-hd', source = 'hd' }) {
    return {
        walletId: 'w1', chainId, from: from(addressId, source),
        actionData: { action: 'BROADCAST', params: { VERSION: '0', TEXT: text } },
        encoderOpts: { payFeeInNativeCoin: false },
    };
}

// The encoder options the compose handed the encoder, whatever the check said after.
async function encoderRequestFor(type, request) {
    const { host, createTx } = makeHost();
    await host.handle({ type, request });
    expect(createTx).toHaveBeenCalled();
    return createTx.mock.calls[0][0];
}

describe('the confirm lane requests the Taproot envelope for any oversized action', () => {
    it('a BROADCAST over 8 KB from a Bitcoin software address asks for AUTO with tapscript asserted', async () => {
        const opts = await encoderRequestFor('action.composeForConfirm', broadcastRequest({ text: 'x'.repeat(9000) }));
        expect(opts.encoding).toBe('AUTO');
        expect(opts.options).toEqual({ signerSupportsTapscript: true });
        expect(opts.compressedPubKey).toBe(PUBKEY);
    });

    it('a MESSAGE over 8 KB asks for AUTO on the message route too', async () => {
        const opts = await encoderRequestFor('action.message.composeForConfirm', {
            walletId: 'w1', chainId: TAPROOT_CHAIN.id, from: from('addr-hd', 'hd'),
            destination: 'bcrt1qdest', message: 'y'.repeat(9000), method: null,
        });
        expect(opts.encoding).toBe('AUTO');
        expect(opts.options).toEqual({ signerSupportsTapscript: true });
        expect(opts.compressedPubKey).toBe(PUBKEY);
    });

    it('a short BROADCAST is requested exactly as before', async () => {
        const opts = await encoderRequestFor('action.composeForConfirm', broadcastRequest({ text: 'gm' }));
        expect(opts.encoding).toBeUndefined();
        expect(opts.options).toBeUndefined();
    });

    it('trusts the vault record over the request: a device address never asks', async () => {
        // The request claims a software source; the vault says it is a Trezor.
        const opts = await encoderRequestFor('action.composeForConfirm',
            broadcastRequest({ text: 'x'.repeat(9000), addressId: 'addr-trezor', source: 'hd' }));
        expect(opts.encoding).toBeUndefined();
    });

    it('a chain without Taproot never asks', async () => {
        const opts = await encoderRequestFor('action.composeForConfirm',
            broadcastRequest({ text: 'x'.repeat(9000), chainId: LEGACY_CHAIN.id }));
        expect(opts.encoding).toBeUndefined();
    });
});

describe('envelopeEncoderOpts', () => {
    const args = (over = {}) => ({
        descriptor: TAPROOT_CHAIN, signer: { source: 'hd' }, encoderOpts: { pubkey: PUBKEY }, compiledBytes: 9000, ...over,
    });

    it('asks only above the legacy ceiling', () => {
        expect(envelopeEncoderOpts(args({ compiledBytes: 8192 }))).toBeNull();
        expect(envelopeEncoderOpts(args({ compiledBytes: 8193 }))).toEqual({
            encoding: 'AUTO', options: { signerSupportsTapscript: true }, compressedPubKey: PUBKEY,
        });
    });

    it('keeps a legacy encoding the caller chose', () => {
        expect(envelopeEncoderOpts(args({ encoderOpts: { pubkey: PUBKEY, encoding: 'P2WSH' } }))).toBeNull();
    });

    // The real encoder answers AUTO without an internal key with P2WSH, which
    // refuses anything over 8 KB: exactly the failure this test guards against.
    it('completes a caller\'s own AUTO request with the internal key, at any size', () => {
        expect(envelopeEncoderOpts(args({ encoderOpts: { pubkey: PUBKEY, encoding: 'AUTO' }, compiledBytes: 100 }))).toEqual({
            encoding: 'AUTO', options: { signerSupportsTapscript: true }, compressedPubKey: PUBKEY,
        });
    });

    it('does not ask without a compressed key to build the envelope from', () => {
        expect(envelopeEncoderOpts(args({ encoderOpts: { pubkey: 'bcrt1qaddressnotakey' } }))).toBeNull();
    });

    it('never asks for a watch-only or hardware signer, or with no signer at all', () => {
        expect(envelopeEncoderOpts(args({ signer: { source: 'watch-only' } }))).toBeNull();
        expect(envelopeEncoderOpts(args({ signer: { source: 'ledger' } }))).toBeNull();
        expect(envelopeEncoderOpts(args({ signer: null }))).toBeNull();
    });
});
