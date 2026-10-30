// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Stand-in for a hardware device's signed reply in tests: builds a decomposed
// PSBT and the matching signed raw transaction with real keys. The signature
// hashes come from bitcoinjs-lib, independently of the wallet's verifier, and
// the signatures from @noble/curves.

import { Transaction } from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';

// Private keys from the BIP143 examples (public test vectors).
export const TEST_KEYS = Object.freeze([
    'eb696a065ef48a2192da5b28b694f87544b30fae8327c4510137a922f32c6dcf',
    '619c335025c7f4012e556c2a58b2506e30b8511b53ade95ea316fd8c3286feb9',
    'bbc27228ddcb9209d7fd6f36b02f7dfa6252af40bb2f1cbc7a557da8027ff866',
]);

const hex = (bytes) => Buffer.from(bytes).toString('hex');
// A plain Uint8Array: noble refuses a Buffer from another realm under jsdom.
const bytes = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const hash160 = (h) => hex(ripemd160(sha256(bytes(h))));

export function pubkeyOf(privHex) {
    return hex(secp256k1.getPublicKey(bytes(privHex), true));
}

/** The prevout script, and for p2sh-p2wpkh the redeem script, a key spends. */
export function scriptsFor(scriptType, privHex) {
    const h = hash160(pubkeyOf(privHex));
    if (scriptType === 'p2pkh') return { scriptPubKeyHex: `76a914${h}88ac`, redeemScriptHex: null };
    if (scriptType === 'p2wpkh') return { scriptPubKeyHex: `0014${h}`, redeemScriptHex: null };
    if (scriptType === 'p2sh-p2wpkh') {
        const redeem = `0014${h}`;
        return { scriptPubKeyHex: `a914${hash160(redeem)}87`, redeemScriptHex: redeem };
    }
    throw new Error(`hwSignedReply: unsupported scriptType ${scriptType}`);
}

/**
 * A decomposed PSBT spending one input per spec, paying `outputs`.
 *
 * @param {{ inputs: Array<{ scriptType: string, key?: string, value?: number, txid?: string, vout?: number, sequence?: number }>,
 *   outputs?: Array<{ scriptPubKeyHex: string, value: number }>, txVersion?: number, network?: string }} spec
 */
export function decomposedFor(spec) {
    const inputs = spec.inputs.map((inp, i) => {
        const key = inp.key ?? TEST_KEYS[0];
        const { scriptPubKeyHex, redeemScriptHex } = scriptsFor(inp.scriptType, key);
        return {
            prevTxHash: inp.txid ?? (i + 1).toString(16).padStart(2, '0').repeat(32),
            prevTxIndex: inp.vout ?? 0,
            sequence: inp.sequence ?? 0xfffffffd,
            value: inp.value ?? 100_000,
            scriptPubKeyHex,
            scriptType: inp.scriptType,
            sighashType: null,
            nonWitnessUtxoHex: null,
            witnessUtxoScriptHex: inp.scriptType === 'p2pkh' ? null : scriptPubKeyHex,
            redeemScriptHex,
            witnessScriptHex: null,
            address: null,
            prevTxInfo: null,
        };
    });
    const outputs = (spec.outputs ?? [{ address: 'out1', scriptPubKeyHex: `0014${'cc'.repeat(20)}`, value: 90_000 }])
        .map((o) => ({ address: null, scriptType: 'p2wpkh', ...o }));
    return { txVersion: spec.txVersion ?? 2, locktime: 0, network: spec.network ?? 'bitcoin-mainnet', inputs, outputs };
}

function pushHex(dataHex) {
    const n = dataHex.length / 2;
    if (n > 75) throw new Error('hwSignedReply: push too long');
    return n.toString(16).padStart(2, '0') + dataHex;
}

/**
 * The signed raw transaction a device would return for `decomposed`.
 *
 * `tamper` bends one input's signature to model a faulty or hostile reply:
 *   { input, kind: 'garbage' }        a DER-shaped signature over nothing
 *   { input, kind: 'otherInput' }     the signature made for input `from`
 *   { input, kind: 'sighash', type }  signed and tagged with another sighash type
 *   { input, kind: 'amount', value }  signed over another amount
 *
 * @param {ReturnType<typeof decomposedFor>} decomposed
 * @param {{ keys?: string[], tamper?: { input: number, kind: string, from?: number, type?: number, value?: number } }} [opts]
 */
export function signedReplyFor(decomposed, opts = {}) {
    const keys = opts.keys ?? decomposed.inputs.map(() => TEST_KEYS[0]);
    const tx = new Transaction();
    tx.version = decomposed.txVersion;
    tx.locktime = decomposed.locktime;
    for (const inp of decomposed.inputs) {
        tx.addInput(Buffer.from(inp.prevTxHash, 'hex').reverse(), inp.prevTxIndex, inp.sequence);
    }
    for (const out of decomposed.outputs) {
        tx.addOutput(Buffer.from(out.scriptPubKeyHex, 'hex'), Number(out.value));
    }
    const sign = (i, { type = Transaction.SIGHASH_ALL, value } = {}) => {
        const inp = decomposed.inputs[i];
        const pub = pubkeyOf(keys[i]);
        let digest;
        if (inp.scriptType === 'p2pkh') {
            digest = tx.hashForSignature(i, Buffer.from(inp.scriptPubKeyHex, 'hex'), type);
        } else {
            const scriptCode = Buffer.from(`76a914${hash160(pub)}88ac`, 'hex');
            digest = tx.hashForWitnessV0(i, scriptCode, Number(value ?? inp.value), type);
        }
        const sig = secp256k1.sign(Uint8Array.from(digest), bytes(keys[i]), { prehash: false, lowS: true });
        return sig.toHex('der') + type.toString(16).padStart(2, '0');
    };
    const sigs = decomposed.inputs.map((_, i) => sign(i));
    const t = opts.tamper;
    if (t) {
        if (t.kind === 'garbage') sigs[t.input] = `3044${'0220'}${'11'.repeat(32)}0220${'22'.repeat(32)}01`;
        else if (t.kind === 'otherInput') sigs[t.input] = sigs[t.from];
        else if (t.kind === 'sighash') sigs[t.input] = sign(t.input, { type: t.type });
        else if (t.kind === 'amount') sigs[t.input] = sign(t.input, { value: t.value });
        else throw new Error(`hwSignedReply: unknown tamper ${t.kind}`);
    }
    decomposed.inputs.forEach((inp, i) => {
        const pub = pubkeyOf(keys[i]);
        if (inp.scriptType === 'p2pkh') {
            tx.setInputScript(i, Buffer.from(pushHex(sigs[i]) + pushHex(pub), 'hex'));
        } else {
            if (inp.scriptType === 'p2sh-p2wpkh') tx.setInputScript(i, Buffer.from(pushHex(inp.redeemScriptHex), 'hex'));
            tx.setWitness(i, [Buffer.from(sigs[i], 'hex'), Buffer.from(pub, 'hex')]);
        }
    });
    return tx.toHex();
}
