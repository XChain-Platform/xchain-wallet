// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A hardware reply whose signatures do not verify against the approved PSBT's
// prevout scripts and amounts is refused before broadcast, on every chain the
// device lane signs, and leaves no queued row.

import { describe, it, expect } from 'vitest';
import {
    assertInputSignaturesVerify, SIGNATURE_MISMATCH_MESSAGE,
} from '../../../packages/core/src/signers/verifyInputSignatures.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';
import { RemoteSigner } from '../../../packages/core/src/signers/RemoteSigner.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { decomposedFor, signedReplyFor, TEST_KEYS } from '../../helpers/hwSignedReply.js';

// BIP143 P2SH-P2WPKH example: the signed transaction, its prevout and amount.
const BIP143_P2SH_P2WPKH_SIGNED = '01000000000101db6b1b20aa0fd7b23880be2ecbd4a98130974cf4748fb66092ac4d3ceb1a5477'
    + '010000001716001479091972186c449eb1ded22b78e40d009bdf0089feffffff02b8b4eb0b000000001976a914a457b684d7f0d539'
    + 'a46a45bbc043f35b59d0d96388ac0008af2f000000001976a914fd270b1ee6abcaea97fea7ad0402e8bd8ad6d77c88ac02473044'
    + '022047ac8e878352d3ebbde1c94ce3a10d057c24175747116f8288e5d794d12d482f0220217f36a485cae903c713331d877c1f64'
    + '677e3622ad4010726870540656fe9dcb012103ad1d8e89212f0b92c74d23bb710c00662ad1470198ac48c43f7d6f93a2a2687392040000';
const bip143Decomposed = (value) => ({
    txVersion: 1,
    locktime: 1170,
    inputs: [{
        prevTxHash: '77541aeb3c4dac9260b68f74f44c973081a9d4cb2ebe8038b2d70faa201b6bdb',
        prevTxIndex: 1,
        sequence: 0xfffffffe,
        value,
        scriptPubKeyHex: 'a9144733f37cf4db86fbc2efed2500b4f4e49f31202387',
        scriptType: 'p2sh-p2wpkh',
        sighashType: null,
    }],
});

const check = (txHex, decomposed) => () => assertInputSignaturesVerify({ txHex, decomposed, signerId: 's1' });

describe('assertInputSignaturesVerify', () => {
    it('accepts the BIP143 P2SH-P2WPKH vector and refuses it over another amount', () => {
        expect(check(BIP143_P2SH_P2WPKH_SIGNED, bip143Decomposed(1_000_000_000))).not.toThrow();
        expect(check(BIP143_P2SH_P2WPKH_SIGNED, bip143Decomposed(999_999_999))).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    for (const scriptType of ['p2pkh', 'p2wpkh', 'p2sh-p2wpkh']) {
        describe(scriptType, () => {
            const decomposed = decomposedFor({
                inputs: [
                    { scriptType, key: TEST_KEYS[0], value: 150_000 },
                    { scriptType, key: TEST_KEYS[1], value: 70_000 },
                ],
            });
            const keys = [TEST_KEYS[0], TEST_KEYS[1]];

            it('accepts a valid signature on every input', () => {
                expect(check(signedReplyFor(decomposed, { keys }), decomposed)).not.toThrow();
            });

            it('refuses a garbage signature', () => {
                const txHex = signedReplyFor(decomposed, { keys, tamper: { input: 1, kind: 'garbage' } });
                expect(check(txHex, decomposed)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
            });

            it('refuses a signature made for another input', () => {
                // Both inputs spent by one key, so only the digest tells the two apart.
                const oneKey = [TEST_KEYS[0], TEST_KEYS[0]];
                const sameKey = decomposedFor({
                    inputs: [{ scriptType, key: TEST_KEYS[0] }, { scriptType, key: TEST_KEYS[0] }],
                });
                expect(check(signedReplyFor(sameKey, { keys: oneKey }), sameKey)).not.toThrow();
                const txHex = signedReplyFor(sameKey, { keys: oneKey, tamper: { input: 0, kind: 'otherInput', from: 1 } });
                expect(check(txHex, sameKey)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
            });

            it('refuses a signature under a sighash type the PSBT did not ask for', () => {
                for (const type of [0x81, 0x02, 0x03]) {
                    const txHex = signedReplyFor(decomposed, { keys, tamper: { input: 0, kind: 'sighash', type } });
                    let err = null;
                    try { check(txHex, decomposed)(); } catch (e) { err = e; }
                    expect(err?.message).toBe(SIGNATURE_MISMATCH_MESSAGE);
                    expect(err?.detail).toMatch(/sighash type/);
                }
            });

            it('refuses a signature by a key that does not own the prevout', () => {
                const txHex = signedReplyFor(decomposed, { keys: [TEST_KEYS[2], TEST_KEYS[1]] });
                expect(check(txHex, decomposed)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
            });
        });
    }

    for (const scriptType of ['p2wpkh', 'p2sh-p2wpkh']) {
        it(`refuses a ${scriptType} signature computed over another amount`, () => {
            const decomposed = decomposedFor({ inputs: [{ scriptType, value: 150_000 }] });
            const txHex = signedReplyFor(decomposed, { tamper: { input: 0, kind: 'amount', value: 150_001 } });
            expect(check(txHex, decomposed)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
        });
    }

    it('refuses a p2pkh reply whose PSBT prevout script is another key', () => {
        // A legacy signature does not commit to the amount; what binds it to the
        // coin is the prevout script, which here belongs to another key.
        const decomposed = decomposedFor({ inputs: [{ scriptType: 'p2pkh', key: TEST_KEYS[0] }] });
        const txHex = signedReplyFor(decomposed);
        const other = decomposedFor({ inputs: [{ scriptType: 'p2pkh', key: TEST_KEYS[1] }] });
        expect(check(txHex, other)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a segwit input whose PSBT carries no exact amount', () => {
        const decomposed = decomposedFor({ inputs: [{ scriptType: 'p2wpkh' }] });
        const txHex = signedReplyFor(decomposed);
        decomposed.inputs[0].value = null;
        expect(check(txHex, decomposed)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a script type the device lane does not sign', () => {
        const decomposed = decomposedFor({ inputs: [{ scriptType: 'p2wpkh' }] });
        const txHex = signedReplyFor(decomposed);
        decomposed.inputs[0].scriptType = 'p2tr';
        expect(check(txHex, decomposed)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('verifies against the version the reply carries when the device swapped 2 for 1', () => {
        const decomposed = decomposedFor({ inputs: [{ scriptType: 'p2wpkh', sequence: 0xffffffff }], txVersion: 1 });
        const txHex = signedReplyFor(decomposed);
        expect(check(txHex, { ...decomposed, txVersion: 2 })).not.toThrow();
    });
});

function memCollection() {
    const m = new Map();
    return {
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        get: async (id) => m.get(id) ?? null,
        list: async () => Array.from(m.values()),
    };
}

const TICKS = { 'bitcoin-mainnet': 'BTC', 'litecoin-mainnet': 'LTC', 'dogecoin-mainnet': 'DOGE' };

async function sendThroughTrezor({ chainId, decomposed, serializedTx }) {
    const broadcasts = [];
    const connect = {
        getFeatures: async () => ({ success: true, payload: { device_id: 'dev1' } }),
        signTransaction: async () => ({ success: true, payload: { serializedTx } }),
    };
    const sdk = {
        encoder: { broadcastTx: async (hex) => { broadcasts.push(hex); } },
        wallet: { decomposePsbt: () => decomposed, txidOf: () => 'f'.repeat(64) },
    };
    const sdkRegistry = { get: () => sdk };
    const signer = new TrezorSigner({
        id: 's1', displayName: 'Trezor', model: 'T2T1', deviceIdentifier: 'dev1', connect, sdkRegistry,
    });
    const pendingTxs = memCollection();
    const purpose = decomposed.inputs[0].scriptType === 'p2pkh' ? 44 : 84;
    let error = null;
    try {
        await submitAction({
            vault: { pendingTxs, settings: { get: async () => ({}), put: async () => {} } },
            walletId: 'w1',
            chainRegistry: { get: () => ({ coin: chainId.split('-')[0], networkKind: 'mainnet' }) },
            sdkRegistry,
            chainId,
            actionData: { action: 'SEND', params: { TICK: TICKS[chainId], AMOUNT: '0.0009', DESTINATION: 'x' } },
            encoderOpts: { pubkey: '02aa' },
            signingPaths: decomposed.inputs.map((_, inputIndex) => ({ inputIndex, path: `m/${purpose}'/0'/0'/0/${inputIndex}` })),
            signer,
            prebuiltPsbt: { psbtHex: '70736274ff00', encoding: 'OP_RETURN', actionString: 'x' },
            pendingTxMeta: { fromAddress: 'a', toAddress: 'b', actionSummary: 's' },
        });
    } catch (err) {
        error = err;
    }
    return { error, broadcasts, rows: await pendingTxs.list() };
}

describe('a Trezor send whose reply does not verify', () => {
    const cases = [
        ['bitcoin-mainnet', 'p2wpkh'],
        ['litecoin-mainnet', 'p2sh-p2wpkh'],
        ['dogecoin-mainnet', 'p2pkh'],
    ];
    for (const [chainId, scriptType] of cases) {
        it(`broadcasts a verified ${chainId} reply and refuses a bad one with nothing queued`, async () => {
            const decomposed = decomposedFor({ inputs: [{ scriptType }, { scriptType, key: TEST_KEYS[1] }], network: chainId });
            const keys = [TEST_KEYS[0], TEST_KEYS[1]];
            const good = await sendThroughTrezor({ chainId, decomposed, serializedTx: signedReplyFor(decomposed, { keys }) });
            expect(good.error).toBeNull();
            expect(good.broadcasts).toHaveLength(1);

            const bad = await sendThroughTrezor({
                chainId,
                decomposed,
                serializedTx: signedReplyFor(decomposed, { keys, tamper: { input: 1, kind: 'otherInput', from: 0 } }),
            });
            expect(bad.error?.message).toBe(SIGNATURE_MISMATCH_MESSAGE);
            expect(bad.broadcasts).toHaveLength(0);
            // The audit row submitAction writes before signing is retired, never
            // queued, and carries no signed bytes a retry could send.
            expect(bad.rows.map((row) => row.status)).toEqual(['failed']);
            expect(bad.rows[0].txHex ?? null).toBeNull();
        });
    }
});

describe('RemoteSigner relaying a refused reply', () => {
    it('keeps the sentence whole across the signer port', async () => {
        const transport = async () => {
            const err = new Error(SIGNATURE_MISMATCH_MESSAGE);
            err.name = 'SignatureMismatchError';
            throw err;
        };
        const signer = new RemoteSigner({ id: 'r1', kind: 'trezor', displayName: 'Trezor', transport });
        await expect(signer.signPsbt({ psbtHex: '70736274ff00', chainId: 'bitcoin-mainnet', signingPaths: [] }))
            .rejects.toMatchObject({ name: 'SignatureMismatchError', message: SIGNATURE_MISMATCH_MESSAGE });
    });
});

describe('the send form copy for a refused reply', () => {
    it('shows the sentence, not the form fallback or the generic line', () => {
        // The shape that crosses the messaging boundary: name and message only.
        const err = { name: 'SignatureMismatchError', message: SIGNATURE_MISMATCH_MESSAGE };
        expect(submitFailureMessage(err)).toBe(SIGNATURE_MISMATCH_MESSAGE);
        expect(submitFailureMessage(err, { fallback: 'Could not send. Try again.' })).toBe(SIGNATURE_MISMATCH_MESSAGE);
    });
});
