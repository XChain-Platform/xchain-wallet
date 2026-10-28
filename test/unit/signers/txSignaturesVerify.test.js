// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The broadcast check for transactions the wallet's software signer did not
// produce: every input shape it verifies, the shapes it refuses, and the two
// prevout sources (a held PSBT and the UTXO tracker).

import { describe, it, expect } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import {
    assertBroadcastSignaturesVerify,
    assertTxSignaturesVerify,
    prevoutsFromTracker,
} from '../../../packages/core/src/signers/verifyTxSignatures.js';
import { SIGNATURE_MISMATCH_MESSAGE } from '../../../packages/core/src/signers/verifyInputSignatures.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';

const TYPES = ['p2pkh', 'p2wpkh', 'p2sh-p2wpkh', 'p2sh-multisig', 'p2wsh-multisig', 'p2sh-p2wsh-multisig', 'p2tr'];
const verify = (built) => assertTxSignaturesVerify({ ...built, signerId: 'test' });

describe('assertTxSignaturesVerify', () => {
    for (const type of TYPES) {
        it(`passes a valid ${type} spend`, () => {
            expect(() => verify(signedTxFor({ inputs: [{ type }] }))).not.toThrow();
        });

        it(`refuses a ${type} spend with a flipped signature byte`, () => {
            const built = signedTxFor({ inputs: [{ type }, { type: 'p2wpkh' }], tamper: { input: 0, kind: 'flip' } });
            expect(() => verify(built)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
        });
    }

    for (const type of ['p2wpkh', 'p2sh-p2wpkh', 'p2wsh-multisig', 'p2sh-p2wsh-multisig', 'p2tr']) {
        it(`refuses a ${type} spend signed over another amount`, () => {
            const built = signedTxFor({ inputs: [{ type }], tamper: { input: 0, kind: 'amount', value: 99_999 } });
            expect(() => verify(built)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
        });
    }

    for (const type of ['p2sh-multisig', 'p2wsh-multisig']) {
        it(`refuses ${type} signatures out of key order`, () => {
            const built = signedTxFor({ inputs: [{ type }], tamper: { input: 0, kind: 'swap' } });
            expect(() => verify(built)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
        });
    }

    it('passes a transaction mixing every shape', () => {
        expect(() => verify(signedTxFor({ inputs: TYPES.map((type) => ({ type })) }))).not.toThrow();
    });

    it('refuses a taproot spend when another input reports a different amount', () => {
        const built = signedTxFor({ inputs: [{ type: 'p2tr' }, { type: 'p2wpkh' }] });
        built.prevouts[1] = { ...built.prevouts[1], value: 100_001 };
        expect(() => verify(built)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses prevouts that name another outpoint', () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
        built.prevouts[0] = { ...built.prevouts[0], prevTxIndex: 7 };
        expect(() => verify(built)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a script it cannot verify', () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
        built.prevouts[0] = { ...built.prevouts[0], scriptPubKeyHex: '6a0101' };
        expect(() => verify(built)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a sighash type the PSBT input did not request', () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
        built.prevouts[0] = { ...built.prevouts[0], sighashType: 0x83 };
        expect(() => verify(built)).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });
});

describe('prevoutsFromTracker', () => {
    const shapes = ['p2pkh', 'p2wpkh', 'p2sh-p2wpkh', 'p2sh-multisig', 'p2wsh-multisig', 'p2sh-p2wsh-multisig'];

    it('reads every prevout from the tracker by the address its spend names, once per address', async () => {
        const built = signedTxFor({ inputs: [...shapes, 'p2wpkh'].map((type) => ({ type })) });
        const tracker = trackerFor(built.prevouts);
        const prevouts = await prevoutsFromTracker({
            txHex: built.txHex, getUtxos: tracker.getUTXOs, network: networks.bitcoin, signerId: 'raw',
        });
        expect(prevouts.map((p) => p.scriptPubKeyHex)).toEqual(built.prevouts.map((p) => p.scriptPubKeyHex));
        expect(prevouts.map((p) => p.value)).toEqual(built.prevouts.map((p) => BigInt(p.value)));
        expect(tracker.reads).toHaveLength(shapes.length);
        expect(() => assertTxSignaturesVerify({ txHex: built.txHex, prevouts, signerId: 'raw' })).not.toThrow();
    });

    it('refuses an outpoint the tracker does not list', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
        const tracker = trackerFor([{ ...built.prevouts[0], prevTxIndex: 2 }]);
        await expect(prevoutsFromTracker({
            txHex: built.txHex, getUtxos: tracker.getUTXOs, network: networks.bitcoin, signerId: 'raw',
        })).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a tracker row whose script is not the one the spend commits to', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
        const tracker = trackerFor(built.prevouts);
        for (const rows of tracker.byAddress.values()) rows[0].scriptPubKey = `0014${'ab'.repeat(20)}`;
        await expect(prevoutsFromTracker({
            txHex: built.txHex, getUtxos: tracker.getUTXOs, network: networks.bitcoin, signerId: 'raw',
        })).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('takes the amount from the tracker, so a spend signed over another amount fails', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }], tamper: { input: 0, kind: 'amount', value: 5_000_000 } });
        const tracker = trackerFor(built.prevouts);
        const prevouts = await prevoutsFromTracker({
            txHex: built.txHex, getUtxos: tracker.getUTXOs, network: networks.bitcoin, signerId: 'raw',
        });
        expect(() => assertTxSignaturesVerify({ txHex: built.txHex, prevouts, signerId: 'raw' })).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a taproot key-path spend, whose witness names no address', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2tr' }] });
        const tracker = trackerFor(built.prevouts);
        await expect(prevoutsFromTracker({
            txHex: built.txHex, getUtxos: tracker.getUTXOs, network: networks.bitcoin, signerId: 'raw',
        })).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
        expect(tracker.reads).toHaveLength(0);
    });

    it('reads Litecoin and Dogecoin addresses under their own network bytes', async () => {
        const litecoin = { bech32: 'ltc', pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0, bip32: { public: 0x019da462, private: 0x019d9cfe }, messagePrefix: '\x19Litecoin Signed Message:\n' };
        const dogecoin = { pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e, bip32: { public: 0x02facafd, private: 0x02fac398 }, messagePrefix: '\x19Dogecoin Signed Message:\n' };
        for (const [network, types] of [[litecoin, ['p2pkh', 'p2wpkh', 'p2sh-p2wpkh']], [dogecoin, ['p2pkh', 'p2sh-multisig']]]) {
            const built = signedTxFor({ inputs: types.map((type) => ({ type })) });
            const tracker = trackerFor(built.prevouts, network);
            const prevouts = await prevoutsFromTracker({ txHex: built.txHex, getUtxos: tracker.getUTXOs, network, signerId: 'raw' });
            expect(() => assertTxSignaturesVerify({ txHex: built.txHex, prevouts, signerId: 'raw' })).not.toThrow();
        }
    });
});

describe('assertBroadcastSignaturesVerify', () => {
    it('verifies against the held PSBT and reads no tracker', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2tr' }, { type: 'p2wsh-multisig' }] });
        const tracker = trackerFor(built.prevouts);
        const sdk = {
            wallet: { decomposePsbt: () => ({ inputs: built.prevouts }), getBitcoinNetwork: () => networks.bitcoin },
            encoder: { getUTXOs: tracker.getUTXOs },
        };
        await assertBroadcastSignaturesVerify({ sdk, txHex: built.txHex, psbtHex: '70736274ff', signerId: 'psbt' });
        expect(tracker.reads).toHaveLength(0);
    });

    it('falls back to the tracker when no PSBT is held or it does not decompose', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
        const tracker = trackerFor(built.prevouts);
        const sdk = {
            wallet: { decomposePsbt: () => { throw new Error('opaque'); }, getBitcoinNetwork: () => networks.bitcoin },
            encoder: { getUTXOs: tracker.getUTXOs },
        };
        await assertBroadcastSignaturesVerify({ sdk, txHex: built.txHex, psbtHex: 'deadbeef', signerId: 'x' });
        await assertBroadcastSignaturesVerify({ sdk, txHex: built.txHex, signerId: 'x' });
        expect(tracker.reads).toHaveLength(2);
    });

    it('refuses when neither source can establish the prevouts', async () => {
        const built = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
        await expect(assertBroadcastSignaturesVerify({ sdk: { wallet: {} }, txHex: built.txHex, signerId: 'x' }))
            .rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });
});

describe('cost at 200 inputs', () => {
    it.each(['p2wpkh', 'p2pkh', 'p2tr', 'p2wsh-multisig'])('verifies 200 %s inputs', (type) => {
        const built = signedTxFor({ inputs: Array.from({ length: 200 }, () => ({ type })) });
        const start = performance.now();
        verify(built);
        const ms = performance.now() - start;
        // A loose ceiling, so a quadratic regression shows without timing flake.
        expect(ms).toBeLessThan(10_000);
        console.info(`[cost] 200 ${type} inputs verified in ${ms.toFixed(0)} ms`);
    });
});
