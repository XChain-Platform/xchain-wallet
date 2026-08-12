// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// on the path a real Send actually takes.
//
// Send.jsx composes through `action.composeForConfirm` and then signs those
// exact bytes on Approve (that single-encode pipeline, `prebuiltPsbt`).
// So a change address chosen anywhere later than this route never reaches
// the wire, and submitAction's own rotation is deliberately inert here.
// This pins the rotation at the step that decides the transaction.
//
// It also pins the coupling that makes the rotation usable: the freshly
// derived address has to be inside `ownAddresses` before the tamper check
// runs, or the wallet flags its own change output as a payment to a
// stranger and refuses every rotated send.

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

/**
 * Records the encoderOpts the encoder was handed, which is the whole point.
 * The stub PSBT pays change to whatever address createTx was told to use, so
 * the tamper check sees the transaction the wallet actually asked for rather
 * than a hard-coded one.
 */
function makeSdk(createTx) {
    return {
        encoder: { createTx },
        actions: { createAction: vi.fn(() => ({ actionString: 'SEND|0|JDOG|1|dest', action: 'SEND', version: 0 })) },
        wallet: {
            decomposePsbt: vi.fn(() => ({
                inputs: [{ value: 5000 }],
                outputs: [
                    { address: null, scriptPubKeyHex: '6a20deadbeef', scriptType: 'unknown', value: 0 },
                    {
                        address: createTx.mock.calls.at(-1)?.[0]?.change ?? SOURCE,
                        scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 4000,
                    },
                ],
            })),
        },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: 'SEND|0|JDOG|1|dest' })),
            describe: vi.fn(() => ({ summary: 'send', details: [], warnings: [] })),
        },
    };
}

function makeHost({ rotation, withSigner = true } = {}) {
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
                privacy: { changeAddressRotation: rotation },
            },
            async get() { return JSON.parse(JSON.stringify(this._rec)); },
            async put(r) { this._rec = JSON.parse(JSON.stringify(r)); },
        },
    };
    const signer = {
        id: 'signer-1',
        kind: 'software',
        async getAddresses({ accountIndex, change, startIndex }) {
            return [{
                index: startIndex,
                address: `addr_${accountIndex}_${change}_${startIndex}`,
                publicKey: `pub_${accountIndex}_${change}_${startIndex}`,
                path: `m/84'/1'/${accountIndex}'/${change}/${startIndex}`,
            }];
        },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => makeSdk(createTx) },
        signerPool: {
            get: () => (withSigner ? signer : null),
            has: () => withSigner,
        },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, vault, createTx };
}

const REQUEST = {
    walletId: 'w1',
    chainId: 'bitcoin-regtest',
    from: { address: SOURCE, publicKey: 'pub_0_0_0', derivationPath: "m/84'/1'/0'/0/0" },
    to: 'bcrt1qdest',
    tick: 'JDOG',
    amount: '1',
};

async function compose(host, request = REQUEST) {
    const res = await host.handle({ type: 'action.composeForConfirm', request });
    expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
    return res.result;
}

describe('action.composeForConfirm honours change-address rotation', () => {
    it('[REGRESSION] builds change back to the source address when rotation is off', async () => {
        const { host, createTx, vault } = makeHost({ rotation: false });
        await compose(host);
        expect(createTx.mock.calls[0][0].change).toBe(SOURCE);
        expect((await vault.addresses.list()).length).toBe(1);
    });

    it('builds change to a fresh internal address when rotation is on', async () => {
        const { host, createTx, vault } = makeHost({ rotation: true });
        await compose(host);
        const opts = createTx.mock.calls[0][0];
        expect(opts.change).toBe('addr_0_1_0');
        expect(opts.sourceAddress).toBe(SOURCE);

        const rows = await vault.addresses.list();
        const fresh = rows.find((a) => a.address === 'addr_0_1_0');
        expect(fresh).toBeTruthy();
        expect(fresh.role).toBe('change');
        expect(fresh.derivationPath).toBe("m/84'/1'/0'/1/0");
    });

    it('does not flag its own rotated change output as a payment to a stranger', async () => {
        // The stub PSBT pays 4000 sats to addr_0_1_0. Composing at all means
        // the tamper check accepted that output as the wallet's own.
        const { host } = makeHost({ rotation: true });
        const composed = await compose(host);
        expect(composed.tamperVerified).toBe(true);
    });

    it('falls back to the source address when the wallet is locked (no pooled signer)', async () => {
        const { host, createTx } = makeHost({ rotation: true, withSigner: false });
        await compose(host);
        expect(createTx.mock.calls[0][0].change).toBe(SOURCE);
    });
});
