// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Fully signed transactions over every input shape the broadcast check
// verifies, for tests of the routes that broadcast bytes the wallet's own
// software signer did not produce. Signature hashes come from bitcoinjs-lib, so
// the code under test is checked against an independent implementation; keys
// are the BIP143 example keys hwSignedReply.js uses.

import { Transaction, payments, networks } from 'bitcoinjs-lib';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';
import { TEST_KEYS, pubkeyOf } from './hwSignedReply.js';

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const bytes = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const hash160 = (h) => hex(ripemd160(sha256(bytes(h))));
const sha = (h) => hex(sha256(bytes(h)));

/** A 2-of-3 bare multisig script over the three test keys, in key order. */
export function multisigScript(keys = TEST_KEYS, m = 2) {
    const pushes = keys.map((k) => `21${pubkeyOf(k)}`).join('');
    return `${(0x50 + m).toString(16)}${pushes}${(0x50 + keys.length).toString(16)}ae`;
}

/** The x-only key a taproot test output pays: the test key itself, untweaked. */
export function taprootKeyOf(privHex) {
    return hex(schnorr.getPublicKey(bytes(privHex)));
}

/**
 * The prevout script for `type`, plus the redeem and witness scripts a spend
 * of it reveals.
 */
export function prevoutScripts(type, key = TEST_KEYS[0]) {
    const h = hash160(pubkeyOf(key));
    const ms = multisigScript();
    switch (type) {
    case 'p2pkh': return { script: `76a914${h}88ac` };
    case 'p2wpkh': return { script: `0014${h}` };
    case 'p2sh-p2wpkh': return { script: `a914${hash160(`0014${h}`)}87`, redeem: `0014${h}` };
    case 'p2sh-multisig': return { script: `a914${hash160(ms)}87`, redeem: ms };
    case 'p2wsh-multisig': return { script: `0020${sha(ms)}`, witnessScript: ms };
    case 'p2sh-p2wsh-multisig': {
        const redeem = `0020${sha(ms)}`;
        return { script: `a914${hash160(redeem)}87`, redeem, witnessScript: ms };
    }
    case 'p2tr': return { script: `5120${taprootKeyOf(key)}` };
    default: throw new Error(`signedTx: unsupported type ${type}`);
    }
}

/** The address of a prevout script on `network` (a bitcoinjs network), or null for taproot. */
export function addressOfScript(script, network = networks.bitcoin) {
    const output = Buffer.from(script, 'hex');
    for (const make of [payments.p2pkh, payments.p2sh, payments.p2wpkh, payments.p2wsh]) {
        try {
            return make({ output, network }).address;
        } catch {
            // not this shape
        }
    }
    return null;
}

function pushHex(dataHex) {
    const n = dataHex.length / 2;
    if (n === 0) return '00';
    if (n <= 75) return n.toString(16).padStart(2, '0') + dataHex;
    if (n <= 255) return `4c${n.toString(16).padStart(2, '0')}${dataHex}`;
    throw new Error('signedTx: push too long');
}

/**
 * A signed transaction spending one coin per `inputs` entry, with the prevouts
 * it spends (the shape the broadcast check reads).
 *
 * `tamper` bends one input: { input, kind: 'flip' } flips a byte inside its
 * first signature, { input, kind: 'amount', value } signs it over another
 * amount, { input, kind: 'swap' } puts a multisig input's signatures out of key
 * order.
 *
 * @param {{ inputs: Array<{ type: string, value?: number, key?: string }>,
 *   outputs?: Array<{ script: string, value: number }>, version?: number,
 *   tamper?: { input: number, kind: string, value?: number } }} spec
 */
export function signedTxFor(spec) {
    const tx = new Transaction();
    tx.version = spec.version ?? 2;
    const prevouts = spec.inputs.map((inp, i) => {
        const key = inp.key ?? TEST_KEYS[0];
        const s = prevoutScripts(inp.type, key);
        const txid = (i + 1).toString(16).padStart(4, '0').repeat(16);
        tx.addInput(Buffer.from(txid, 'hex').reverse(), i % 3, 0xfffffffd);
        return { prevTxHash: txid, prevTxIndex: i % 3, scriptPubKeyHex: s.script, value: inp.value ?? 100_000, sighashType: null, ...s, type: inp.type, key };
    });
    for (const o of spec.outputs ?? [{ script: `0014${'cc'.repeat(20)}`, value: 90_000 }]) {
        tx.addOutput(Buffer.from(o.script, 'hex'), o.value);
    }
    const t = spec.tamper;
    const ecdsa = (digest, key) => secp256k1.sign(Uint8Array.from(digest), bytes(key), { prehash: false, lowS: true }).toHex('der') + '01';
    const scripts = prevouts.map((p) => Buffer.from(p.scriptPubKeyHex, 'hex'));
    const values = prevouts.map((p) => p.value);
    const parts = prevouts.map((p, i) => {
        const amount = t && t.input === i && t.kind === 'amount' ? t.value : p.value;
        const legacy = (code) => tx.hashForSignature(i, Buffer.from(code, 'hex'), Transaction.SIGHASH_ALL);
        const v0 = (code) => tx.hashForWitnessV0(i, Buffer.from(code, 'hex'), amount, Transaction.SIGHASH_ALL);
        const pub = pubkeyOf(p.key);
        const multisigSigs = (digest) => {
            const sigs = [ecdsa(digest, TEST_KEYS[0]), ecdsa(digest, TEST_KEYS[2])];
            return t && t.input === i && t.kind === 'swap' ? sigs.reverse() : sigs;
        };
        switch (p.type) {
        case 'p2pkh': return { scriptSig: [ecdsa(legacy(p.scriptPubKeyHex), p.key), pub], witness: [] };
        case 'p2wpkh': return { scriptSig: [], witness: [ecdsa(v0(`76a914${hash160(pub)}88ac`), p.key), pub] };
        case 'p2sh-p2wpkh': return { scriptSig: [p.redeem], witness: [ecdsa(v0(`76a914${hash160(pub)}88ac`), p.key), pub] };
        case 'p2sh-multisig': return { scriptSig: ['', ...multisigSigs(legacy(p.redeem)), p.redeem], witness: [] };
        case 'p2wsh-multisig': return { scriptSig: [], witness: ['', ...multisigSigs(v0(p.witnessScript)), p.witnessScript] };
        case 'p2sh-p2wsh-multisig': return { scriptSig: [p.redeem], witness: ['', ...multisigSigs(v0(p.witnessScript)), p.witnessScript] };
        case 'p2tr': {
            const amounts = values.map((v, j) => (t && t.input === i && t.kind === 'amount' && j === i ? t.value : v));
            const digest = tx.hashForWitnessV1(i, scripts, amounts, Transaction.SIGHASH_DEFAULT);
            return { scriptSig: [], witness: [hex(schnorr.sign(Uint8Array.from(digest), bytes(p.key)))] };
        }
        default: throw new Error(`signedTx: unsupported type ${p.type}`);
        }
    });
    if (t && t.kind === 'flip') {
        const part = parts[t.input];
        const list = part.witness.length > 0 ? part.witness : part.scriptSig;
        const at = list.findIndex((item) => item.length >= 128);
        const sig = list[at];
        // A byte inside the signature's r value (or the BIP340 R), so the
        // encoding stays well formed and only the verify can fail.
        const pos = 10;
        list[at] = sig.slice(0, pos) + ((parseInt(sig.slice(pos, pos + 2), 16) ^ 0x01).toString(16).padStart(2, '0')) + sig.slice(pos + 2);
    }
    parts.forEach((part, i) => {
        tx.setInputScript(i, Buffer.from(part.scriptSig.map(pushHex).join(''), 'hex'));
        if (part.witness.length > 0) tx.setWitness(i, part.witness.map((w) => Buffer.from(w, 'hex')));
    });
    return {
        txHex: tx.toHex(),
        prevouts: prevouts.map(({ prevTxHash, prevTxIndex, scriptPubKeyHex, value, sighashType }) => ({
            prevTxHash, prevTxIndex, scriptPubKeyHex, value, sighashType,
        })),
    };
}

/**
 * A tracker stand-in answering getUTXOs with the given prevouts, keyed by the
 * address of each prevout's script, and counting reads per address.
 */
export function trackerFor(prevouts, network = networks.bitcoin) {
    const byAddress = new Map();
    for (const p of prevouts) {
        const address = addressOfScript(p.scriptPubKeyHex, network);
        if (!address) continue;
        if (!byAddress.has(address)) byAddress.set(address, []);
        byAddress.get(address).push({ txid: p.prevTxHash, vout: p.prevTxIndex, value: p.value, scriptPubKey: p.scriptPubKeyHex });
    }
    const reads = [];
    return {
        reads,
        byAddress,
        async getUTXOs(address) {
            reads.push(address);
            return { utxos: byAddress.get(address) ?? [] };
        },
    };
}
