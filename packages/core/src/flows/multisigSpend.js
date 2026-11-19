// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { secp256k1 } from '@noble/curves/secp256k1';
import { parseRawTx } from '../signers/verifySignedTx.js';
import {
    bip143Digester,
    bytesToHex,
    legacyDigest,
    uintLE,
    varSlice,
} from '../signers/verifyInputSignatures.js';
import { parseMultisigScript } from '../signers/verifyTxSignatures.js';

const CLASSICAL_SCHEMES = new Set(['p2sh-multisig', 'p2wsh-multisig']);

export class InsufficientMultisigSignaturesError extends Error {
    constructor(threshold, supplied) {
        super(`Multisig transaction needs ${threshold} valid signatures; ${supplied} were supplied.`);
        this.name = 'InsufficientMultisigSignaturesError';
        this.code = 'MULTISIG_SIGNATURES_INSUFFICIENT';
    }
}

function assertScheme(scheme) {
    if (!CLASSICAL_SCHEMES.has(scheme)) {
        throw new Error(`multisigSpend: unsupported scheme "${scheme}"`);
    }
}

function exactSats(value, name) {
    if (typeof value === 'bigint' && value >= 0n) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    throw new Error(`multisigSpend: ${name} must be an exact non-negative satoshi amount`);
}

function assertHex(value, name, bytes = null) {
    if (typeof value !== 'string' || value.length === 0 || value.length % 2 !== 0
        || /[^0-9a-f]/i.test(value) || (bytes !== null && value.length !== bytes * 2)) {
        throw new Error(`multisigSpend: ${name} must be${bytes === null ? '' : ` ${bytes}-byte`} hex`);
    }
    return value.toLowerCase();
}

function reverseHex(hex) {
    let out = '';
    for (let i = hex.length - 2; i >= 0; i -= 2) out += hex.slice(i, i + 2);
    return out;
}

function compactSize(value) {
    const n = BigInt(value);
    if (n < 0xfdn) return uintLE(n, 1);
    if (n <= 0xffffn) return `fd${uintLE(n, 2)}`;
    if (n <= 0xffffffffn) return `fe${uintLE(n, 4)}`;
    return `ff${uintLE(n, 8)}`;
}

function pushData(hex) {
    const bytes = hex.length / 2;
    if (bytes <= 0x4b) return `${uintLE(bytes, 1)}${hex}`;
    if (bytes <= 0xff) return `4c${uintLE(bytes, 1)}${hex}`;
    if (bytes <= 0xffff) return `4d${uintLE(bytes, 2)}${hex}`;
    throw new Error('multisigSpend: script item exceeds the supported push size');
}

function transactionOutput(value, scriptPubKeyHex) {
    return `${uintLE(value, 8)}${varSlice(scriptPubKeyHex)}`;
}

/** Build the one-input unsigned transaction and its minimal BIP174 wrapper. */
export function buildUnsignedMultisigSpend({
    scheme,
    script,
    utxo,
    outputs,
    locktime = 0,
    sequence = 0xfffffffd,
}) {
    assertScheme(scheme);
    const scriptHex = assertHex(script, 'script');
    if (!parseMultisigScript(scriptHex)) throw new Error('multisigSpend: script is not bare multisig');
    if (!utxo || typeof utxo !== 'object') throw new Error('multisigSpend: utxo is required');
    const txid = assertHex(utxo.txid, 'utxo.txid', 32);
    const vout = Number(utxo.vout);
    if (!Number.isInteger(vout) || vout < 0 || vout > 0xffffffff) {
        throw new Error('multisigSpend: utxo.vout must be a uint32');
    }
    const inputValue = exactSats(utxo.value, 'utxo.value');
    const prevoutScript = assertHex(utxo.scriptPubKeyHex, 'utxo.scriptPubKeyHex');
    if (!Array.isArray(outputs) || outputs.length === 0) {
        throw new Error('multisigSpend: at least one output is required');
    }
    const normalizedOutputs = outputs.map((output, index) => ({
        value: exactSats(output?.value, `outputs[${index}].value`),
        scriptPubKeyHex: assertHex(output?.scriptPubKeyHex, `outputs[${index}].scriptPubKeyHex`),
    }));
    if (!Number.isInteger(locktime) || locktime < 0 || locktime > 0xffffffff) {
        throw new Error('multisigSpend: locktime must be a uint32');
    }
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff) {
        throw new Error('multisigSpend: sequence must be a uint32');
    }

    const unsignedTxHex = `0200000001${reverseHex(txid)}${uintLE(vout, 4)}00${uintLE(sequence, 4)}`
        + `${compactSize(normalizedOutputs.length)}`
        + normalizedOutputs.map((output) => transactionOutput(output.value, output.scriptPubKeyHex)).join('')
        + uintLE(locktime, 4);
    const witnessUtxo = transactionOutput(inputValue, prevoutScript);
    const scriptKeyType = scheme === 'p2wsh-multisig' ? '05' : '04';
    const inputMap = `0101${compactSize(witnessUtxo.length / 2)}${witnessUtxo}`
        + `01${scriptKeyType}${compactSize(scriptHex.length / 2)}${scriptHex}00`;
    const outputMaps = normalizedOutputs.map(() => '00').join('');
    const psbtHex = `70736274ff0100${compactSize(unsignedTxHex.length / 2)}${unsignedTxHex}00${inputMap}${outputMaps}`;
    return { unsignedTxHex, psbtHex };
}

/** Compute input zero's SIGHASH_ALL digest for a classical multisig spend. */
export function multisigSighash({ scheme, script, unsignedTxHex, amount }) {
    assertScheme(scheme);
    const scriptHex = assertHex(script, 'script');
    const tx = parseRawTx(assertHex(unsignedTxHex, 'unsignedTxHex'));
    if (tx.inputs.length !== 1) throw new Error('multisigSpend: only one-input transactions are supported');
    const digest = scheme === 'p2wsh-multisig'
        ? bip143Digester(tx)(0, scriptHex, exactSats(amount, 'amount'))
        : legacyDigest(tx, 0, scriptHex);
    return bytesToHex(digest);
}

function canonicalDer(sig) {
    try {
        const bytes = secp256k1.Signature.fromDER(assertHex(sig, 'signature')).toDERRawBytes();
        return bytesToHex(bytes);
    } catch {
        return null;
    }
}

/** Assemble exactly the threshold signatures in script-key order. */
export function assembleMultisigTx({ scheme, script, unsignedTxHex, signatures }) {
    assertScheme(scheme);
    const scriptHex = assertHex(script, 'script');
    const parsedScript = parseMultisigScript(scriptHex);
    if (!parsedScript) throw new Error('multisigSpend: script is not bare multisig');
    const tx = parseRawTx(assertHex(unsignedTxHex, 'unsignedTxHex'));
    if (tx.inputs.length !== 1) throw new Error('multisigSpend: only one-input transactions are supported');
    const supplied = new Map();
    for (const entry of Array.isArray(signatures) ? signatures : []) {
        const pubkey = typeof entry?.pubkey === 'string' ? entry.pubkey.toLowerCase() : '';
        const der = canonicalDer(entry?.sig);
        if (parsedScript.keys.includes(pubkey) && der && !supplied.has(pubkey)) supplied.set(pubkey, der);
    }
    const ordered = parsedScript.keys
        .filter((pubkey) => supplied.has(pubkey))
        .slice(0, parsedScript.m)
        .map((pubkey) => `${supplied.get(pubkey)}01`);
    if (ordered.length < parsedScript.m) {
        throw new InsufficientMultisigSignaturesError(parsedScript.m, ordered.length);
    }

    const input = tx.inputs[0];
    const outputsHex = tx.outputs.map((output) => transactionOutput(output.valueSat, output.scriptPubKeyHex)).join('');
    const outpoint = `${reverseHex(input.prevTxHash)}${uintLE(input.prevTxIndex, 4)}`;
    const tail = `${compactSize(tx.outputs.length)}${outputsHex}${uintLE(tx.locktime, 4)}`;
    if (scheme === 'p2sh-multisig') {
        const scriptSig = `00${ordered.map(pushData).join('')}${pushData(scriptHex)}`;
        return `${uintLE(tx.version >>> 0, 4)}01${outpoint}${varSlice(scriptSig)}${uintLE(input.sequence, 4)}${tail}`;
    }
    const witness = `${compactSize(ordered.length + 2)}00${ordered.map((sig) => varSlice(sig)).join('')}${varSlice(scriptHex)}`;
    return `${uintLE(tx.version >>> 0, 4)}000101${outpoint}00${uintLE(input.sequence, 4)}`
        + `${compactSize(tx.outputs.length)}${outputsHex}${witness}${uintLE(tx.locktime, 4)}`;
}

class PsbtCursor {
    constructor(hex) {
        this.hex = assertHex(hex, 'psbtHex');
        this.pos = 0;
    }

    take(bytes) {
        if (!Number.isInteger(bytes) || bytes < 0 || this.pos + bytes > this.hex.length / 2) {
            throw new Error('multisigSpend: truncated PSBT');
        }
        const value = this.hex.slice(this.pos * 2, (this.pos + bytes) * 2);
        this.pos += bytes;
        return value;
    }

    compactSize() {
        const first = Number.parseInt(this.take(1), 16);
        if (first < 0xfd) return first;
        const bytes = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
        const raw = this.take(bytes);
        let value = 0n;
        for (let index = bytes - 1; index >= 0; index -= 1) {
            value = (value << 8n) | BigInt(Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16));
        }
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('multisigSpend: PSBT length is too large');
        return Number(value);
    }

    item() {
        const keyLength = this.compactSize();
        if (keyLength === 0) return null;
        const key = this.take(keyLength);
        return { key, value: this.take(this.compactSize()) };
    }
}

/** Decode the transaction and prevout fields this flow binds to its message hash. */
export function decodeMultisigSpend(psbtHex) {
    const cursor = new PsbtCursor(psbtHex);
    if (cursor.take(5) !== '70736274ff') throw new Error('multisigSpend: PSBT magic is invalid');
    let unsignedTxHex = null;
    for (let item = cursor.item(); item; item = cursor.item()) {
        if (item.key === '00') unsignedTxHex = item.value;
    }
    if (!unsignedTxHex) throw new Error('multisigSpend: PSBT has no unsigned transaction');
    const tx = parseRawTx(unsignedTxHex);
    if (tx.inputs.length !== 1) throw new Error('multisigSpend: only one-input PSBTs are supported');
    let amount = null;
    let scriptPubKeyHex = null;
    let script = null;
    let partialSignatureCount = 0;
    for (let item = cursor.item(); item; item = cursor.item()) {
        if (item.key === '01') {
            const output = new PsbtCursor(item.value);
            const rawAmount = output.take(8);
            amount = 0n;
            for (let index = 7; index >= 0; index -= 1) {
                amount = (amount << 8n) | BigInt(Number.parseInt(rawAmount.slice(index * 2, index * 2 + 2), 16));
            }
            scriptPubKeyHex = output.take(output.compactSize());
        } else if (item.key === '04' || item.key === '05') {
            script = item.value;
        } else if (item.key.startsWith('02')) {
            partialSignatureCount += 1;
        }
    }
    if (amount === null || !scriptPubKeyHex) throw new Error('multisigSpend: PSBT input has no witness UTXO');
    return {
        unsignedTxHex,
        script,
        partialSignatureCount,
        input: {
            txid: tx.inputs[0].prevTxHash,
            vout: tx.inputs[0].prevTxIndex,
            amount,
            scriptPubKeyHex,
        },
        outputs: tx.outputs.map((output) => ({
            scriptPubKeyHex: output.scriptPubKeyHex,
            value: output.valueSat,
        })),
    };
}

