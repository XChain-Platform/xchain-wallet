// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A two-phase action's reveal transaction as the SDK signs it: a P2SH or P2WSH
// data-carrier output is funded, then spent through the SDK's own
// wallet.signRevealPsbt, whose finalizer assembles `<signature> <pubkey>
// <script>`. The carrier script is built here with bitcoinjs-lib, so the wallet's
// verifier is checked against the SDK's signer and not against itself.

import { Psbt, Transaction, payments, networks, opcodes, crypto, script as bscript } from 'bitcoinjs-lib';
import { encode as encodeWif } from 'wif';
import { requireSdkDeep } from './sdkDeepPaths.js';
import { TEST_KEYS, pubkeyOf } from './hwSignedReply.js';

const NETWORK = networks.regtest;

/** The carrier script for `keyHash`: `<data> OP_DROP OP_DUP OP_HASH160 <h160> OP_EQUALVERIFY OP_CHECKSIG`. */
export function carrierScriptFor(keyHash, data = Buffer.from('chunk-payload-0123456789', 'utf8')) {
    return bscript.compile([
        data, opcodes.OP_DROP, opcodes.OP_DUP, opcodes.OP_HASH160, Buffer.from(keyHash, 'hex'),
        opcodes.OP_EQUALVERIFY, opcodes.OP_CHECKSIG,
    ]);
}

/**
 * Fund one carrier output per chunk of `encoding` ('P2SH' | 'P2WSH') and spend
 * them all in one reveal with the SDK's reveal signer. Each chunk carries its
 * own data, so each input has its own carrier script.
 *
 * @param {{ encoding: 'P2SH'|'P2WSH', key?: string, script?: Buffer, chunks?: number, outputs?: Array<{ script: Buffer, value: number }> }} spec
 * @returns {{ txHex: string, txid: string, prevouts: object[], script: Buffer, fundingTxHex: string, keyHex: string }}
 */
export function signedReveal({ encoding, key = TEST_KEYS[0], script = null, chunks = 1, outputs = null }) {
    const keyHex = pubkeyOf(key);
    const keyHash = crypto.hash160(Buffer.from(keyHex, 'hex')).toString('hex');
    const scripts = Array.from({ length: chunks }, (_, i) => (i === 0 && script
        ? script
        : carrierScriptFor(keyHash, Buffer.from(`chunk-payload-${i}-0123456789`, 'utf8'))));
    const make = encoding === 'P2WSH' ? payments.p2wsh : payments.p2sh;
    const committed = scripts.map((output) => make({ redeem: { output, network: NETWORK }, network: NETWORK }).output);

    const funding = new Transaction();
    funding.version = 2;
    funding.addInput(Buffer.alloc(32, 7), 0);
    committed.forEach((out) => funding.addOutput(out, 100_000));

    const psbt = new Psbt({ network: NETWORK });
    psbt.setVersion(2);
    scripts.forEach((redeem, index) => {
        const spent = { hash: funding.getId(), index };
        if (encoding === 'P2WSH') {
            psbt.addInput({ ...spent, witnessUtxo: { script: committed[index], value: 100_000 }, witnessScript: redeem });
        } else {
            psbt.addInput({ ...spent, nonWitnessUtxo: funding.toBuffer(), redeemScript: redeem });
        }
    });
    for (const o of outputs ?? [{ script: Buffer.concat([Buffer.from('0014', 'hex'), Buffer.alloc(20, 0xcc)]), value: 90_000 }]) {
        psbt.addOutput(o);
    }

    const Wallet = requireSdkDeep('wallet');
    const signed = new Wallet('bitcoin-regtest').signRevealPsbt(psbt.toHex(), encodeWif({
        version: NETWORK.wif,
        privateKey: Buffer.from(key, 'hex'),
        compressed: true,
    }));
    return {
        txHex: signed.txHex,
        txid: signed.txid,
        script: scripts[0],
        fundingTxHex: funding.toHex(),
        keyHex,
        prevouts: committed.map((out, index) => ({
            prevTxHash: funding.getId(), prevTxIndex: index, scriptPubKeyHex: out.toString('hex'), value: 100_000, sighashType: null,
        })),
    };
}

/**
 * The same transaction with input 0's spending data rewritten: `mutate` gets
 * the stack (hex strings, the script last) and returns the stack to write.
 */
export function withStack(txHex, encoding, mutate) {
    const tx = Transaction.fromHex(txHex);
    const input = tx.ins[0];
    if (encoding === 'P2WSH') {
        tx.setWitness(0, mutate(input.witness.map((w) => w.toString('hex'))).map((h) => Buffer.from(h, 'hex')));
    } else {
        const stack = bscript.decompile(input.script).map((p) => (Buffer.isBuffer(p) ? p.toString('hex') : ''));
        tx.setInputScript(0, bscript.compile(mutate(stack).map((h) => Buffer.from(h, 'hex'))));
    }
    return tx.toHex();
}
