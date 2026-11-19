// @vitest-environment node

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The broadcast check on a two-phase action's reveal transaction, signed by the
// SDK's own reveal signer: it must verify the real `<signature> <pubkey>
// <script>` spend of a data-carrier output on both encodings, and still refuse
// every spend that is not exactly that.

import { describe, it, expect } from 'vitest';
import { Transaction, networks, opcodes, script as bscript } from 'bitcoinjs-lib';
import {
    assertBroadcastSignaturesVerify,
    assertTxSignaturesVerify,
    prevoutsFromTracker,
} from '../../../packages/core/src/signers/verifyTxSignatures.js';
import { parseCarrierScript } from '../../../packages/core/src/signers/verifyCarrierReveal.js';
import { SIGNATURE_MISMATCH_MESSAGE, hash160 } from '../../../packages/core/src/signers/verifyInputSignatures.js';
import { carrierScriptFor, signedReveal, withStack } from '../../helpers/carrierReveal.js';
import { pubkeyOf, TEST_KEYS } from '../../helpers/hwSignedReply.js';
import { trackerFor } from '../../helpers/signedTx.js';

const ENCODINGS = ['P2SH', 'P2WSH'];
const NETWORK = networks.regtest;

/** Verify through the tracker, the route a queued entry takes. */
async function verifyBroadcast(txHex, prevouts) {
    const tracker = trackerFor(prevouts, NETWORK);
    const sdk = { wallet: { getBitcoinNetwork: () => NETWORK }, encoder: { getUTXOs: tracker.getUTXOs } };
    await assertBroadcastSignaturesVerify({ sdk, txHex, signerId: 'queue' });
    return tracker;
}

describe.each(ENCODINGS)('a %s data-carrier reveal signed by the SDK', (encoding) => {
    it('verifies against the prevouts the tracker reports', async () => {
        const reveal = signedReveal({ encoding });
        const tracker = await verifyBroadcast(reveal.txHex, reveal.prevouts);
        expect(tracker.reads).toHaveLength(1);
    });

    it('verifies against explicit prevouts', () => {
        const reveal = signedReveal({ encoding });
        expect(() => assertTxSignaturesVerify({ txHex: reveal.txHex, prevouts: reveal.prevouts, signerId: 't' })).not.toThrow();
    });

    it('verifies a chunk whose data push needs OP_PUSHDATA2', async () => {
        const keyHash = signedReveal({ encoding }).script.subarray(-22, -2).toString('hex');
        const script = carrierScriptFor(keyHash, Buffer.alloc(300, 0x5a));
        const reveal = signedReveal({ encoding, script });
        await verifyBroadcast(reveal.txHex, reveal.prevouts);
    });

    it('verifies a reveal that spends two chunks with distinct carrier scripts', async () => {
        const reveal = signedReveal({ encoding, chunks: 2 });
        expect(new Set(reveal.prevouts.map((p) => p.scriptPubKeyHex)).size).toBe(2);
        const tracker = await verifyBroadcast(reveal.txHex, reveal.prevouts);
        expect(tracker.reads).toHaveLength(2);
    });

    it('refuses a two-chunk reveal whose second input signature was flipped', async () => {
        const reveal = signedReveal({ encoding, chunks: 2 });
        const tx = Transaction.fromHex(reveal.txHex);
        const at = encoding === 'P2WSH'
            ? () => { const sig = tx.ins[1].witness[0]; sig[10] ^= 1; }
            : () => {
                const stack = bscript.decompile(tx.ins[1].script);
                stack[0][10] ^= 1;
                tx.setInputScript(1, bscript.compile(stack));
            };
        at();
        await expect(verifyBroadcast(tx.toHex(), reveal.prevouts)).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a tracker that reports another script for the coin', async () => {
        const reveal = signedReveal({ encoding });
        const tracker = trackerFor(reveal.prevouts, NETWORK);
        for (const rows of tracker.byAddress.values()) rows[0].scriptPubKey = `0014${'ab'.repeat(20)}`;
        await expect(prevoutsFromTracker({
            txHex: reveal.txHex, getUtxos: tracker.getUTXOs, network: NETWORK, signerId: 'queue',
        })).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });
});

describe.each(ENCODINGS)('a %s data-carrier reveal that was altered or is not the carrier shape', (encoding) => {
    it('refuses a flipped signature byte', async () => {
        const reveal = signedReveal({ encoding });
        const txHex = withStack(reveal.txHex, encoding, (stack) => {
            const sig = stack[0];
            return [`${sig.slice(0, 10)}${(parseInt(sig.slice(10, 12), 16) ^ 1).toString(16).padStart(2, '0')}${sig.slice(12)}`, ...stack.slice(1)];
        });
        await expect(verifyBroadcast(txHex, reveal.prevouts)).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a public key whose hash is not the script\'s key hash', async () => {
        const reveal = signedReveal({ encoding });
        const txHex = withStack(reveal.txHex, encoding, (stack) => [stack[0], pubkeyOf(TEST_KEYS[1]), stack[2]]);
        await expect(verifyBroadcast(txHex, reveal.prevouts)).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a tampered output, which the signature no longer covers', async () => {
        const reveal = signedReveal({ encoding });
        const tx = Transaction.fromHex(reveal.txHex);
        tx.outs[0].value = 95_000;
        await expect(verifyBroadcast(tx.toHex(), reveal.prevouts)).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses an extra item beside the signature and key', async () => {
        const reveal = signedReveal({ encoding });
        const txHex = withStack(reveal.txHex, encoding, (stack) => [stack[0], stack[1], stack[1], stack[2]]);
        await expect(verifyBroadcast(txHex, reveal.prevouts)).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a missing public key', async () => {
        const reveal = signedReveal({ encoding });
        const txHex = withStack(reveal.txHex, encoding, (stack) => [stack[0], stack[2]]);
        await expect(verifyBroadcast(txHex, reveal.prevouts)).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses explicit prevouts that commit to another script', () => {
        const reveal = signedReveal({ encoding });
        const other = signedReveal({ encoding, key: TEST_KEYS[1] });
        expect(() => assertTxSignaturesVerify({
            txHex: reveal.txHex, prevouts: [{ ...reveal.prevouts[0], scriptPubKeyHex: other.prevouts[0].scriptPubKeyHex }], signerId: 't',
        })).toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });

    it('refuses a script that is not exactly the carrier shape, even when the SDK signed it', async () => {
        const base = signedReveal({ encoding }).script;
        const extraOpcode = Buffer.concat([base.subarray(0, -1), Buffer.from([opcodes.OP_NOP, opcodes.OP_CHECKSIG])]);
        const reveal = signedReveal({ encoding, script: extraOpcode });
        await expect(verifyBroadcast(reveal.txHex, reveal.prevouts)).rejects.toThrow(SIGNATURE_MISMATCH_MESSAGE);
        expect(() => assertTxSignaturesVerify({ txHex: reveal.txHex, prevouts: reveal.prevouts, signerId: 't' }))
            .toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });
});

describe('a carrier spend wrapped in p2sh-p2wsh', () => {
    it('is refused, since the SDK never emits it', () => {
        const reveal = signedReveal({ encoding: 'P2WSH' });
        const program = reveal.prevouts[0].scriptPubKeyHex;
        const tx = Transaction.fromHex(reveal.txHex);
        tx.setInputScript(0, bscript.compile([Buffer.from(program, 'hex')]));
        const wrapped = { ...reveal.prevouts[0], scriptPubKeyHex: `a914${hash160(program)}87` };
        expect(() => assertTxSignaturesVerify({ txHex: tx.toHex(), prevouts: [wrapped], signerId: 't' }))
            .toThrow(SIGNATURE_MISMATCH_MESSAGE);
    });
});

describe('parseCarrierScript', () => {
    const hash = 'ab'.repeat(20);
    const gate = (h = hash) => `75${'76a914'}${h}88ac`;
    const data = (n) => `${n.toString(16).padStart(2, '0')}${'11'.repeat(n)}`;

    it('reads the key hash of the exact shape', () => {
        expect(parseCarrierScript(data(20) + gate())).toEqual({ keyHash: hash });
        expect(parseCarrierScript(`4c${'c8'}${'11'.repeat(200)}${gate()}`)).toEqual({ keyHash: hash });
        expect(parseCarrierScript(`4d${'2c01'}${'11'.repeat(300)}${gate()}`)).toEqual({ keyHash: hash });
    });

    it.each([
        ['an empty script', ''],
        ['no data push', gate()],
        ['an empty data push', `00${gate()}`],
        ['a push longer than its bytes', `4c${'ff'}${'11'.repeat(10)}${gate()}`],
        ['a 19-byte key hash', `${data(8)}7576a913${'ab'.repeat(19)}88ac`],
        ['a 21-byte key hash', `${data(8)}7576a915${'ab'.repeat(21)}88ac`],
        ['a trailing opcode', `${data(8)}${gate()}61`],
        ['OP_CHECKSIGVERIFY in place of OP_CHECKSIG', `${data(8)}7576a914${hash}88ad`],
        ['a missing OP_DROP', `${data(8)}76a914${hash}88ac`],
        ['uppercase hex', (data(8) + gate()).toUpperCase()],
        ['odd-length hex', `${data(8)}${gate()}0`],
    ])('refuses %s', (_name, hex) => {
        expect(parseCarrierScript(hex)).toBeNull();
    });

    it('refuses a bitcoinjs-compiled script with a second data push', () => {
        const hex = bscript.compile([
            Buffer.alloc(4), Buffer.alloc(4), opcodes.OP_DROP, opcodes.OP_DUP, opcodes.OP_HASH160, Buffer.alloc(20), opcodes.OP_EQUALVERIFY, opcodes.OP_CHECKSIG,
        ]).toString('hex');
        expect(parseCarrierScript(hex)).toBeNull();
    });
});
