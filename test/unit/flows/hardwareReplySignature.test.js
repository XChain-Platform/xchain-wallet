// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A hardware reply that spends and pays exactly what the PSBT approved but
// carries no signature is refused before broadcast, driven end to end through
// submitAction, submitWithSigner and a TrezorSigner over a mocked Connect.

import { describe, it, expect } from 'vitest';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';
import { assertSignedTxMatchesPsbt } from '../../../packages/core/src/signers/verifySignedTx.js';
import { decomposedFor as signedDecomposedFor, signedReplyFor } from '../../helpers/hwSignedReply.js';

const IN = 'ab'.repeat(32);
const OUTPUTS = `01905f010000000000160014${'cc'.repeat(20)}`;
// The approved transaction exactly, every input's scriptSig and witness empty.
const UNSIGNED_TX = `0200000001${IN}0000000000fdffffff${OUTPUTS}00000000`;
// The same transaction with a scriptSig but no witness on a p2wpkh input.
const SCRIPTSIG_ONLY_TX = `0200000001${IN}000000000151fdffffff${OUTPUTS}00000000`;
// The same transaction signed with a real key, so its witness verifies.
const SIGNED_DECOMPOSED = signedDecomposedFor({
    inputs: [{ scriptType: 'p2wpkh', txid: IN, value: 100_000 }],
    outputs: [{ address: 'bc1qout', scriptPubKeyHex: `0014${'cc'.repeat(20)}`, value: 90_000 }],
});
const SIGNED_TX = signedReplyFor(SIGNED_DECOMPOSED);

function decomposedFor(scriptType = 'p2wpkh') {
    return {
        txVersion: 2,
        locktime: 0,
        network: 'bitcoin-mainnet',
        inputs: [{
            prevTxHash: IN, prevTxIndex: 0, sequence: 0xfffffffd, value: 100_000,
            scriptPubKeyHex: `0014${'bb'.repeat(20)}`, scriptType, sighashType: null,
            nonWitnessUtxoHex: null, witnessUtxoScriptHex: `0014${'bb'.repeat(20)}`,
            redeemScriptHex: null, witnessScriptHex: null, address: 'bc1qin', prevTxInfo: null,
        }],
        outputs: [{ address: 'bc1qout', scriptPubKeyHex: `0014${'cc'.repeat(20)}`, scriptType: 'p2wpkh', value: 90_000 }],
    };
}

function memCollection() {
    const m = new Map();
    return {
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        get: async (id) => m.get(id) ?? null,
        list: async () => Array.from(m.values()),
    };
}

async function sendThroughTrezor(serializedTx, nodeReject, decomposed = decomposedFor()) {
    const broadcasts = [];
    const connect = {
        getFeatures: async () => ({ success: true, payload: { device_id: 'dev1' } }),
        signTransaction: async () => ({ success: true, payload: { serializedTx } }),
    };
    const sdk = {
        encoder: {
            broadcastTx: async (hex) => {
                broadcasts.push(hex);
                if (nodeReject) throw new Error(nodeReject);
            },
        },
        wallet: { decomposePsbt: () => decomposed, txidOf: () => 'f'.repeat(64) },
    };
    const sdkRegistry = { get: () => sdk };
    const signer = new TrezorSigner({
        id: 's1', displayName: 'Trezor', model: 'T2T1', deviceIdentifier: 'dev1', connect, sdkRegistry,
    });
    const pendingTxs = memCollection();
    let error = null;
    try {
        await submitAction({
            vault: { pendingTxs, settings: { get: async () => ({}), put: async () => {} } },
            walletId: 'w1',
            chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'mainnet' }) },
            sdkRegistry,
            chainId: 'bitcoin-mainnet',
            // A bare native payment: the one action a mainnet chain accepts before launch.
            actionData: { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '0.0009', DESTINATION: 'bc1qout' } },
            encoderOpts: { pubkey: '02aa' },
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
            signer,
            prebuiltPsbt: { psbtHex: '70736274ff00', encoding: 'OP_RETURN', actionString: 'x' },
            pendingTxMeta: { fromAddress: 'a', toAddress: 'b', actionSummary: 's' },
        });
    } catch (err) {
        error = err;
    }
    return { error, broadcasts, rows: await pendingTxs.list() };
}

describe('hardware reply signature presence', () => {
    it('refuses an unsigned reply before anything is broadcast', async () => {
        const out = await sendThroughTrezor(UNSIGNED_TX, 'mandatory-script-verify-flag-failed (Witness program was passed an empty witness)');
        expect(out.broadcasts).toHaveLength(0);
        expect(out.error?.message).toMatch(/input 0 carries no signature\. Nothing was broadcast/);
        expect(out.rows.every((row) => row.status !== 'queued')).toBe(true);
    });

    it('broadcasts a reply that carries a witness', async () => {
        const out = await sendThroughTrezor(SIGNED_TX, null, SIGNED_DECOMPOSED);
        expect(out.error).toBeNull();
        expect(out.broadcasts).toEqual([SIGNED_TX]);
    });

    it('refuses a p2wpkh input that carries a scriptSig and no witness', () => {
        expect(() => assertSignedTxMatchesPsbt({
            txHex: SCRIPTSIG_ONLY_TX, decomposed: decomposedFor('p2wpkh'), signerId: 's1',
        })).toThrow(/input 0 is p2wpkh and carries no witness signature/);
    });

    it('accepts a p2pkh input that carries only a scriptSig', () => {
        expect(() => assertSignedTxMatchesPsbt({
            txHex: SCRIPTSIG_ONLY_TX, decomposed: decomposedFor('p2pkh'), signerId: 's1',
        })).not.toThrow();
    });

    it('refuses a p2pkh input with an empty scriptSig', () => {
        expect(() => assertSignedTxMatchesPsbt({
            txHex: UNSIGNED_TX, decomposed: decomposedFor('p2pkh'), signerId: 's1',
        })).toThrow(/input 0 carries no signature/);
    });
});
