// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Every confirm-time compose route asks the encoder for full previous
// transactions when the spender is a device address.
//
// A Ledger reads the outpoint it signs out of those bytes, so a
// witnessUtxo-only input (the encoder's default) cannot be signed on hardware
// at all, and §5.3 forbids hydrating them after the tamper check. The flag
// therefore has to be requested at the single compose, on EVERY route.
//
// It was requested on two of five. The vote, message and bet routes cloned the
// change/ownAddresses half of the preamble and not this half, so a VOTE, BET or
// MESSAGE from a device address composed a PSBT the device could not sign.

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

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

const DESCRIPTORS = [{
    id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest',
    defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'], nativeTicker: 'BTC',
}];

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
const SOURCE_ROW = {
    schemaVersion: 4, id: 'addr-src', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest',
    source: 'hd', addressType: 'p2wpkh', derivationPath: "m/84'/1'/0'/0/0",
    address: SOURCE, publicKey: 'pub_0_0_0', label: 'BTC Address #1',
    pinned: false, hidden: false, signerId: 'signer-1', role: 'receive',
    createdAt: '2026-01-01T00:00:00.000Z',
};

// Records the encoderOpts every route hands the encoder, which is the whole
// point. The stub PSBT pays change to whatever address createTx was told to
// use, so the tamper check sees the transaction the wallet asked for.
function makeSdk(createTx) {
    const lastChange = () => createTx.mock.calls.at(-1)?.[0]?.change ?? SOURCE;
    return {
        encoder: {
            createTx,
            // quoteMaxSendable probes the address's own utxo total first.
            getUTXOs: vi.fn(async () => ([{ txid: 't', vout: 0, value: 100000 }])),
        },
        actions: { createAction: vi.fn(() => ({ actionString: 'ACT|0|x', action: 'ACT', version: 0 })) },
        voting: {
            castBallotParams: vi.fn((p) => ({ VERSION: '0', POLL: p?.POLL || 'poll1', OPTION: '1' })),
        },
        betting: {
            placeBetParams: vi.fn((p) => ({ VERSION: '0', MARKET: p?.MARKET || 'mkt1', AMOUNT: '1' })),
        },
        wallet: {
            decomposePsbt: vi.fn(() => ({
                inputs: [{ value: 5000 }],
                outputs: [
                    { address: null, scriptPubKeyHex: '6a20deadbeef', scriptType: 'unknown', value: 0 },
                    {
                        address: lastChange(),
                        scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 4000,
                    },
                ],
            })),
        },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: 'ACT|0|x' })),
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
        addresses: memCollection([SOURCE_ROW]),
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
        // No pooled signer: change rotation is a no-op and the message route's
        // sessionSigner resolves to undefined, which the plaintext path allows.
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, createTx };
}

function from(source) {
    return {
        address: SOURCE,
        publicKey: 'pub_0_0_0',
        derivationPath: "m/84'/1'/0'/0/0",
        addressId: 'addr-src',
        source,
        signerId: 'signer-1',
    };
}

// One request per route. Each is the minimum that route validates.
const ROUTES = {
    'action.composeForConfirm': (src) => ({
        walletId: 'w1', chainId: 'bitcoin-regtest', from: from(src),
        to: 'bcrt1qdest', tick: 'JDOG', amount: '1',
    }),
    'action.quoteMaxSendable': (src) => ({
        walletId: 'w1', chainId: 'bitcoin-regtest', from: from(src), to: 'bcrt1qdest',
    }),
    'action.vote.composeForConfirm': (src) => ({
        walletId: 'w1', chainId: 'bitcoin-regtest', from: from(src),
        builder: 'castBallotParams', params: { POLL: 'poll1', OPTION: '1' },
    }),
    'action.bet.composeForConfirm': (src) => ({
        walletId: 'w1', chainId: 'bitcoin-regtest', from: from(src),
        builder: 'placeBetParams', params: { MARKET: 'mkt1', AMOUNT: '1' },
    }),
    'action.message.composeForConfirm': (src) => ({
        walletId: 'w1', chainId: 'bitcoin-regtest', from: from(src),
        destination: 'bcrt1qdest', message: 'hello', method: null,
    }),
};

// The quote route swallows every failure and returns null, so it is driven for
// its side effect on the encoder rather than for its result.
async function drive(host, type, request) {
    const res = await host.handle({ type, request });
    if (type !== 'action.quoteMaxSendable') {
        expect(res.ok, `${type}: ${JSON.stringify(res.error ?? {})}`).toBe(true);
    }
    return res;
}

describe('every confirm-compose route hardens the PSBT for a device source', () => {
    for (const [type, build] of Object.entries(ROUTES)) {
        it(`${type} attaches prev txs for a ledger source`, async () => {
            const { host, createTx } = makeHost();
            await drive(host, type, build('ledger'));
            expect(createTx).toHaveBeenCalled();
            expect(createTx.mock.calls[0][0].attachPrevTx).toBe(true);
        });

        it(`${type} attaches prev txs for a trezor source`, async () => {
            const { host, createTx } = makeHost();
            await drive(host, type, build('trezor'));
            expect(createTx.mock.calls[0][0].attachPrevTx).toBe(true);
        });

        // The negative control. Software sources must keep today's PSBT size,
        // so a helper that hardened unconditionally would fail here.
        it(`${type} leaves an hd source unhardened`, async () => {
            const { host, createTx } = makeHost();
            await drive(host, type, build('hd'));
            expect(createTx.mock.calls[0][0].attachPrevTx).toBeUndefined();
        });
    }

    // Route-specific opts must survive the wrapper.
    it('the bet route still forwards payFeeInNativeCoin', async () => {
        const { host, createTx } = makeHost();
        await drive(host, 'action.bet.composeForConfirm', {
            ...ROUTES['action.bet.composeForConfirm']('ledger'),
            payFeeInNativeCoin: false,
        });
        expect(createTx.mock.calls[0][0].payFeeInNativeCoin).toBe(false);
        expect(createTx.mock.calls[0][0].attachPrevTx).toBe(true);
    });
});
