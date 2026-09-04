// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The gate that stops a hardware device's rebuilt transaction from being
// broadcast as though it were the PSBT the user approved.
//
// The two raw transactions below were serialized by bitcoinjs-lib, not by this
// repo, so the parser is measured against an independent encoder rather than
// against a mirror of itself. LEGACY_TX is a one-input, two-output legacy
// transaction with a real scriptSig and an OP_RETURN carrier; SEGWIT_TX is a
// BIP144 transaction with two inputs (one of them a P2SH-wrapped segwit input
// with both a scriptSig and a witness, the other with an EMPTY witness stack)
// and p2wpkh / p2tr / p2sh outputs, at a non-zero locktime.

import { describe, it, expect } from 'vitest';
import {
    parseRawTx,
    assertSignedTxMatchesPsbt,
} from '../../../packages/core/src/signers/verifySignedTx.js';

const LEGACY_TX = '0200000001aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03000000474830450221001111111111111111111111111111111111111111111111111111111111110121023333333333333333333333333333333333333333333333333333333333333333fdffffff0240e20100000000001976a914444444444444444444444444444444444444444488ac00000000000000001c6a1a58434841494eabababababababababababababababababababab00000000';

const SEGWIT = '02000000000102aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000ffffffffbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb07000000171600145555555555555555555555555555555555555555feffffff0300f2052a01000000160014666666666666666666666666666666666666666622020000000000002251207777777777777777777777777777777777777777777777777777777777777777e70300000000000017a914888888888888888888888888888888888888888887022830450221222222222222222222222222222222222222222222222222222222222222222222222201210299999999999999999999999999999999999999999999999999999999999999990000350c00';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** The decomposePsbt shape for LEGACY_TX: what the user approved. */
function legacyDecomposed() {
    return {
        txVersion: 2,
        locktime: 0,
        network: 'bitcoin-mainnet',
        inputs: [{ prevTxHash: A, prevTxIndex: 3 }],
        outputs: [
            { address: '1x', scriptPubKeyHex: '76a914' + '44'.repeat(20) + '88ac', scriptType: 'p2pkh', value: 123456 },
            { address: null, scriptPubKeyHex: '6a1a58434841494e' + 'ab'.repeat(20), scriptType: 'op_return', value: 0 },
        ],
    };
}

const SIGNER = 'ledger-0';
const verify = (txHex, decomposed) => assertSignedTxMatchesPsbt({ txHex, decomposed, signerId: SIGNER });

describe('parseRawTx', () => {
    it('decodes a legacy transaction, outpoint in display order', () => {
        const tx = parseRawTx(LEGACY_TX);
        expect(tx.version).toBe(2);
        expect(tx.locktime).toBe(0);
        expect(tx.inputs).toEqual([{ prevTxHash: A, prevTxIndex: 3, sequence: 0xfffffffd }]);
        expect(tx.outputs).toHaveLength(2);
        expect(tx.outputs[0].valueSat).toBe(123456n);
        expect(tx.outputs[0].scriptPubKeyHex).toBe('76a914' + '44'.repeat(20) + '88ac');
        expect(tx.outputs[1].valueSat).toBe(0n);
        expect(tx.outputs[1].scriptPubKeyHex).toBe('6a1a58434841494e' + 'ab'.repeat(20));
    });

    it('walks the witness stacks of a segwit transaction to reach the locktime', () => {
        const tx = parseRawTx(SEGWIT);
        expect(tx.version).toBe(2);
        // Reading the locktime correctly is the whole proof that the witness
        // section was skipped by the right number of bytes: get it wrong and
        // this is 0, or the parse throws on trailing bytes.
        expect(tx.locktime).toBe(800000);
        expect(tx.inputs.map((i) => `${i.prevTxHash}:${i.prevTxIndex}`)).toEqual([`${A}:0`, `${B}:7`]);
        expect(tx.outputs.map((o) => o.valueSat)).toEqual([5000000000n, 546n, 999n]);
        expect(tx.outputs[1].scriptPubKeyHex).toBe('5120' + '77'.repeat(32));
    });

    it('reads an output value above 2^53 exactly', () => {
        // 21 million BTC does not reach 2^53, but a malformed or hostile reply
        // can carry any 8-byte value, and Number would round it into agreement
        // with whatever it was compared against.
        const big = 'ffffffffffffff7f';                 // 2^63 - 1 satoshi
        const tx = parseRawTx(
            '02000000' + '01' + '00'.repeat(32) + '00000000' + '00' + 'ffffffff'
            + '01' + big + '02' + '0000' + '00000000',
        );
        expect(tx.outputs[0].valueSat).toBe(9223372036854775807n);
    });

    it('refuses a truncated transaction rather than returning a short one', () => {
        expect(() => parseRawTx(LEGACY_TX.slice(0, LEGACY_TX.length - 8))).toThrow(/truncated|trailing/);
    });

    it('refuses trailing bytes after the locktime', () => {
        expect(() => parseRawTx(LEGACY_TX + 'deadbeef')).toThrow(/trailing/);
    });

    it('refuses a non-hex reply', () => {
        expect(() => parseRawTx('not-hex')).toThrow(/hex/);
    });
});

describe('assertSignedTxMatchesPsbt', () => {
    it('passes the transaction the PSBT actually described', () => {
        expect(() => verify(LEGACY_TX, legacyDecomposed())).not.toThrow();
    });

    it('passes a segwit transaction with p2wpkh, p2tr and p2sh outputs', () => {
        expect(() => verify(SEGWIT, {
            txVersion: 2,
            locktime: 800000,
            inputs: [{ prevTxHash: A, prevTxIndex: 0 }, { prevTxHash: B, prevTxIndex: 7 }],
            outputs: [
                { scriptPubKeyHex: '0014' + '66'.repeat(20), value: 5000000000 },
                { scriptPubKeyHex: '5120' + '77'.repeat(32), value: 546 },
                { scriptPubKeyHex: 'a914' + '88'.repeat(20) + '87', value: 999 },
            ],
        })).not.toThrow();
    });

    it('ignores the transaction version, which no converter forwards', () => {
        // hw-app-btc picks the version itself and the Trezor payload carries
        // none, so a version comparison would refuse every legitimate hardware
        // send. Pinned so nobody "tightens" it back into a false-refusal.
        const d = legacyDecomposed();
        d.txVersion = 1;
        expect(() => verify(LEGACY_TX, d)).not.toThrow();
    });

    it('refuses a reordered output set', () => {
        const d = legacyDecomposed();
        d.outputs.reverse();
        expect(() => verify(LEGACY_TX, d)).toThrow(/output 0 pays script/);
    });

    it('refuses a one-satoshi value change', () => {
        const d = legacyDecomposed();
        d.outputs[0].value = 123457;
        expect(() => verify(LEGACY_TX, d)).toThrow(/output 0 pays 123456 sat, the PSBT paid 123457 sat/);
    });

    it('refuses a flipped byte in the OP_RETURN payload', () => {
        const d = legacyDecomposed();
        d.outputs[1].scriptPubKeyHex = d.outputs[1].scriptPubKeyHex.replace(/ab$/, 'ac');
        expect(() => verify(LEGACY_TX, d)).toThrow(/output 1 pays script/);
    });

    it('refuses a dropped output', () => {
        const d = legacyDecomposed();
        d.outputs.pop();
        expect(() => verify(LEGACY_TX, d)).toThrow(/pays 2 output\(s\), the PSBT paid 1/);
    });

    it('refuses a substituted input outpoint', () => {
        const d = legacyDecomposed();
        d.inputs[0].prevTxIndex = 4;
        expect(() => verify(LEGACY_TX, d)).toThrow(/input 0 spends/);
    });

    it('refuses an approved value JS has already rounded, instead of comparing it lossily', () => {
        const d = legacyDecomposed();
        d.outputs[0].value = 2 ** 53 + 1;               // not a safe integer
        expect(() => verify(LEGACY_TX, d)).toThrow(/not an exact satoshi amount/);
    });

    it('refuses a reply it cannot decode at all', () => {
        expect(() => verify('00', legacyDecomposed())).toThrow(/could not be decoded/);
    });

    it('says nothing was broadcast, because nothing was', () => {
        const d = legacyDecomposed();
        d.outputs[0].value = 1;
        expect(() => verify(LEGACY_TX, d)).toThrow(/Nothing was broadcast/);
    });
});
