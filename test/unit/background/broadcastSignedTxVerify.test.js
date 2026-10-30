// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// broadcast.signedTx sends bytes this wallet's signer did not produce: a raw
// transaction pasted on the Broadcast screen, or the transaction a signed PSBT
// round trip finalizes. Every input's signature is verified against the coin it
// spends before anything is recorded or broadcast: against the PSBT's prevouts
// when the caller sends the PSBT, otherwise against the UTXO tracker's.

import { describe, expect, it, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { SIGNATURE_MISMATCH_MESSAGE } from '../../../packages/core/src/signers/verifyInputSignatures.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';

const WALLET = 'wallet-1';
const CHAIN = 'bitcoin-regtest';

function memCollection() {
    const records = new Map();
    return {
        get: async (id) => records.get(id) ?? null,
        put: vi.fn(async (record) => { records.set(record.id, JSON.parse(JSON.stringify(record))); }),
        list: async () => Array.from(records.values()),
        delete: async (id) => records.delete(id),
        find: async (id) => records.get(id) ?? null,
        findBy: async (key, value) => Array.from(records.values()).filter((r) => r[key] === value),
    };
}

/** A host whose tracker lists `listed` and whose PSBT decomposes to `psbtPrevouts`. */
function makeHost({ listed, psbtPrevouts = null }) {
    const pendingTxs = memCollection();
    const tracker = trackerFor(listed, networks.regtest);
    const broadcastTx = vi.fn(async () => ({ txid: 'a'.repeat(64) }));
    const decomposePsbt = vi.fn(() => {
        if (!psbtPrevouts) throw new Error('not a PSBT');
        return { inputs: psbtPrevouts, outputs: [], txVersion: 2, locktime: 0 };
    });
    const sdk = {
        encoder: { broadcastTx, getUTXOs: tracker.getUTXOs },
        wallet: { getBitcoinNetwork: () => networks.regtest, decomposePsbt },
    };
    const host = createBackgroundHost({
        vault: {
            pendingTxs,
            wallets: { list: async () => [{ id: WALLET, name: 'Wallet' }] },
            settings: { get: async () => null, put: async () => {} },
        },
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            list: () => [],
            chainIdFor: () => CHAIN,
        },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const broadcast = (request) => host.handle({
        type: 'broadcast.signedTx',
        request: { walletId: WALLET, chainId: CHAIN, ...request },
    });
    return { broadcast, broadcastTx, pendingTxs, tracker, decomposePsbt };
}

async function expectRefusedWithNothingSent(h, response) {
    expect(response.ok).toBe(false);
    expect(response.error.name).toBe('SignatureMismatchError');
    expect(response.error.message).toBe(SIGNATURE_MISMATCH_MESSAGE);
    expect(h.broadcastTx).not.toHaveBeenCalled();
    expect(await h.pendingTxs.list()).toEqual([]);
}

describe('broadcast.signedTx: a pasted raw transaction', () => {
    const shapes = ['p2pkh', 'p2wpkh', 'p2sh-p2wpkh', 'p2wsh-multisig', 'p2sh-multisig'];

    it('broadcasts when every signature verifies against the coins the tracker reports', async () => {
        const built = signedTxFor({ inputs: shapes.map((type) => ({ type })) });
        const h = makeHost({ listed: built.prevouts });
        const response = await h.broadcast({ txHex: built.txHex });
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(h.broadcastTx).toHaveBeenCalledWith(built.txHex);
        expect(h.tracker.reads).toHaveLength(shapes.length);
    });

    it('refuses a tampered signature and broadcasts nothing', async () => {
        const built = signedTxFor({ inputs: shapes.map((type) => ({ type })), tamper: { input: 3, kind: 'flip' } });
        const h = makeHost({ listed: built.prevouts });
        await expectRefusedWithNothingSent(h, await h.broadcast({ txHex: built.txHex }));
    });

    it('refuses a signature over another amount than the tracker reports', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }], tamper: { input: 0, kind: 'amount', value: 2_000_000 } });
        const h = makeHost({ listed: built.prevouts });
        await expectRefusedWithNothingSent(h, await h.broadcast({ txHex: built.txHex }));
    });

    it('refuses a spend of a coin the tracker does not list', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }, { type: 'p2pkh' }] });
        const h = makeHost({ listed: built.prevouts.slice(0, 1) });
        await expectRefusedWithNothingSent(h, await h.broadcast({ txHex: built.txHex }));
    });

    it('refuses a taproot key-path spend it cannot look up', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2tr' }] });
        const h = makeHost({ listed: built.prevouts });
        await expectRefusedWithNothingSent(h, await h.broadcast({ txHex: built.txHex }));
    });
});

describe('broadcast.signedTx: a signed PSBT round trip', () => {
    it('verifies against the PSBT the caller sends, taproot included, with no tracker read', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2tr' }, { type: 'p2wpkh' }, { type: 'p2sh-p2wsh-multisig' }] });
        const h = makeHost({ listed: [], psbtPrevouts: built.prevouts });
        const response = await h.broadcast({ txHex: built.txHex, psbtHex: '70736274ff01' });
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(h.decomposePsbt).toHaveBeenCalledWith('70736274ff01');
        expect(h.tracker.reads).toEqual([]);
        expect(h.broadcastTx).toHaveBeenCalledTimes(1);
    });

    it('refuses a tampered signature against the PSBT and broadcasts nothing', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2tr' }, { type: 'p2wpkh' }], tamper: { input: 0, kind: 'flip' } });
        const h = makeHost({ listed: built.prevouts, psbtPrevouts: built.prevouts });
        await expectRefusedWithNothingSent(h, await h.broadcast({ txHex: built.txHex, psbtHex: '70736274ff01' }));
    });

    it('refuses a transaction that spends other coins than the PSBT', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
        const other = [{ ...built.prevouts[0], prevTxIndex: 2 }];
        const h = makeHost({ listed: built.prevouts, psbtPrevouts: other });
        await expectRefusedWithNothingSent(h, await h.broadcast({ txHex: built.txHex, psbtHex: '70736274ff01' }));
    });
});
