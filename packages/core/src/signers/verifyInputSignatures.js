// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Does every signature a hardware signer handed back verify against the coin
// it spends?
//
// assertSignedTxMatchesPsbt (verifySignedTx.js) proves the reply spends and
// pays what the approved PSBT said and that each input carries signature
// material. It cannot tell a valid signature from bytes that only look like
// one, so a reply carrying a garbage signature, a signature made for another
// input, a signature under a sighash type the PSBT did not ask for, or one
// computed over a different amount reaches broadcast, the node refuses it, and
// the send stalls after the user approved it on the device. This module
// recomputes each input's signature hash from the reply's own transaction and
// the PSBT's prevout script and amount, and verifies the signature with
// secp256k1 against the public key the reply supplies, after binding that key
// to the prevout script.
//
// Scope. The device converters (ledgerFormat.js, trezorFormat.js) sign only
// p2pkh, p2wpkh and p2sh-p2wpkh inputs, so those are the three checked here:
//   - p2pkh: the legacy signature hash, scriptCode = the prevout script.
//   - p2wpkh and p2sh-p2wpkh: the BIP143 signature hash, which commits to the
//     amount, scriptCode = OP_DUP OP_HASH160 <keyhash> OP_EQUALVERIFY OP_CHECKSIG.
// Both converters refuse p2tr, so no Schnorr case exists on this lane, and any
// other script type is refused here as unverifiable. Litecoin and Dogecoin use
// the same two signature-hash algorithms and the same ECDSA as Bitcoin, with no
// fork id in the sighash type, so one path serves all three chains.
//
// The sighash type must equal the one the PSBT input requests, SIGHASH_ALL when
// it requests none. Only SIGHASH_ALL is computed, since it is the only type the
// devices sign; a signature carrying any other type is refused before its digest
// is computed. The signature hash uses the reply's version, which
// assertSignedTxMatchesPsbt allows to differ from the PSBT's by a 1-for-2 swap.
//
// Cost: BIP143 caches the three whole-transaction hashes once, so a segwit
// input costs one short hash plus one ECDSA verify. A legacy input rehashes the
// whole transaction, which is quadratic in the input count but small next to
// the verify at any size a device can sign.

import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';
import { readSignedRawTx } from './verifySignedTx.js';

export const SIGNATURE_MISMATCH_MESSAGE =
    'The signer returned a signature that does not match this transaction. Nothing was broadcast.';

const SIGHASH_ALL = 0x01;

/**
 * A reply whose signature does not verify for the input it sits on. The
 * message is the sentence the confirm screen shows; `detail` names the input
 * and the reason for diagnostics and is never shown in place of the message.
 */
export class SignatureMismatchError extends Error {
    constructor(signerId, detail) {
        super(SIGNATURE_MISMATCH_MESSAGE);
        this.name = 'SignatureMismatchError';
        this.code = 'SIGNATURE_MISMATCH';
        this.signerId = signerId;
        this.detail = detail;
    }
}

export function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}

export function bytesToHex(bytes) {
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}

function reverseHex(hex) {
    let out = '';
    for (let i = hex.length - 2; i >= 0; i -= 2) out += hex.slice(i, i + 2);
    return out;
}

export function uintLE(value, bytes) {
    let v = BigInt(value);
    let out = '';
    for (let i = 0; i < bytes; i++) {
        out += Number(v & 0xffn).toString(16).padStart(2, '0');
        v >>= 8n;
    }
    return out;
}

function varint(n) {
    if (n < 0xfd) return uintLE(n, 1);
    if (n <= 0xffff) return `fd${uintLE(n, 2)}`;
    if (n <= 0xffffffff) return `fe${uintLE(n, 4)}`;
    return `ff${uintLE(n, 8)}`;
}

export function varSlice(hex) {
    return `${varint(hex.length / 2)}${hex}`;
}

function hash256(hex) {
    return sha256(sha256(hexToBytes(hex)));
}

export function hash160(hex) {
    return bytesToHex(ripemd160(sha256(hexToBytes(hex))));
}

/** The data pushes of a push-only script, or null when it holds any other opcode. */
function scriptPushes(hex) {
    const pushes = [];
    let pos = 0;
    const len = hex.length / 2;
    const byteAt = (p) => parseInt(hex.slice(p * 2, p * 2 + 2), 16);
    while (pos < len) {
        const op = byteAt(pos);
        pos += 1;
        let size;
        if (op >= 0x01 && op <= 0x4b) {
            size = op;
        } else if (op === 0x4c && pos + 1 <= len) {
            size = byteAt(pos);
            pos += 1;
        } else if (op === 0x4d && pos + 2 <= len) {
            size = byteAt(pos) | (byteAt(pos + 1) << 8);
            pos += 2;
        } else {
            return null;
        }
        if (pos + size > len) return null;
        pushes.push(hex.slice(pos * 2, (pos + size) * 2));
        pos += size;
    }
    return pushes;
}

/** `value` as a BigInt satoshi count, or null when it is missing or inexact. */
export function exactSats(value) {
    if (typeof value === 'bigint') return value >= 0n ? value : null;
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    return null;
}

export function serializeOutputs(outputs) {
    return outputs.map((o) => `${uintLE(o.valueSat, 8)}${varSlice(o.scriptPubKeyHex)}`).join('');
}

export function outpoint(input) {
    return `${reverseHex(input.prevTxHash)}${uintLE(input.prevTxIndex, 4)}`;
}

/** The legacy (pre-segwit) SIGHASH_ALL digest for input `index`. */
export function legacyDigest(tx, index, scriptCodeHex) {
    let body = uintLE(tx.version >>> 0, 4) + varint(tx.inputs.length);
    tx.inputs.forEach((input, i) => {
        body += outpoint(input) + (i === index ? varSlice(scriptCodeHex) : '00') + uintLE(input.sequence, 4);
    });
    body += varint(tx.outputs.length) + serializeOutputs(tx.outputs)
        + uintLE(tx.locktime, 4) + uintLE(SIGHASH_ALL, 4);
    return hash256(body);
}

/** The BIP143 SIGHASH_ALL digest builder, with its whole-transaction hashes computed once. */
export function bip143Digester(tx) {
    const hashPrevouts = bytesToHex(hash256(tx.inputs.map(outpoint).join('')));
    const hashSequence = bytesToHex(hash256(tx.inputs.map((input) => uintLE(input.sequence, 4)).join('')));
    const hashOutputs = bytesToHex(hash256(serializeOutputs(tx.outputs)));
    return (index, scriptCodeHex, amountSats) => {
        const input = tx.inputs[index];
        return hash256(uintLE(tx.version >>> 0, 4) + hashPrevouts + hashSequence + outpoint(input)
            + varSlice(scriptCodeHex) + uintLE(amountSats, 8) + uintLE(input.sequence, 4)
            + hashOutputs + uintLE(tx.locktime, 4) + uintLE(SIGHASH_ALL, 4));
    };
}

export function p2pkhScript(keyHashHex) {
    return `76a914${keyHashHex}88ac`;
}

/**
 * Check one DER signature plus its trailing sighash byte against `digest` and
 * `pubkeyHex`. Returns a reason string on failure, null on success.
 */
export function checkSignature(sigHex, pubkeyHex, digestFor, wantSighash) {
    if (typeof sigHex !== 'string' || sigHex.length < 4) return 'the signature is empty';
    const sighashType = parseInt(sigHex.slice(-2), 16);
    if (sighashType !== wantSighash) {
        return `the signature's sighash type is 0x${sighashType.toString(16)}, the PSBT asked for 0x${wantSighash.toString(16)}`;
    }
    if (wantSighash !== SIGHASH_ALL) return `sighash type 0x${wantSighash.toString(16)} cannot be checked`;
    const der = hexToBytes(sigHex.slice(0, -2));
    let canonical;
    try {
        canonical = secp256k1.Signature.fromBytes(der, 'der').toBytes('der');
    } catch {
        return 'the signature is not DER encoded';
    }
    if (bytesToHex(canonical) !== bytesToHex(der)) return 'the signature is not strictly DER encoded';
    let ok = false;
    try {
        ok = secp256k1.verify(der, digestFor(), hexToBytes(pubkeyHex), { format: 'der', lowS: false, prehash: false });
    } catch {
        ok = false;
    }
    return ok ? null : 'the signature does not verify for this input';
}

export function isPubkey(hex) {
    return (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03')))
        || (hex.length === 130 && hex.startsWith('04'));
}

/**
 * Refuse a device reply when any input's signature fails to verify against the
 * approved PSBT's prevout script and amount. Run after assertSignedTxMatchesPsbt,
 * which has already proven the reply's outpoints, sequences, outputs and
 * locktime equal the PSBT's.
 *
 * @param {Object} params
 * @param {string} params.txHex                                     the device's reply
 * @param {import('./types.js').DecomposedPsbt} params.decomposed   decomposePsbt(approved PSBT)
 * @param {string} params.signerId
 * @throws {SignatureMismatchError}
 */
export function assertInputSignaturesVerify({ txHex, decomposed, signerId }) {
    let tx;
    let signatures;
    try {
        ({ tx, signatures } = readSignedRawTx(txHex));
    } catch (err) {
        throw new SignatureMismatchError(signerId, `the reply could not be decoded (${err.message})`);
    }
    if (!decomposed || !Array.isArray(decomposed.inputs) || decomposed.inputs.length !== tx.inputs.length) {
        throw new SignatureMismatchError(signerId, 'the reply and the PSBT spend a different number of inputs');
    }
    let bip143 = null;
    for (let i = 0; i < tx.inputs.length; i++) {
        const want = decomposed.inputs[i];
        const { scriptSigHex, witness } = signatures[i];
        const prevScript = String(want.scriptPubKeyHex || want.witnessUtxoScriptHex || '').toLowerCase();
        const wantSighash = want.sighashType === null || want.sighashType === undefined
            ? SIGHASH_ALL : Number(want.sighashType);
        const fail = (reason) => new SignatureMismatchError(signerId, `input ${i} (${want.scriptType}): ${reason}`);
        let sigHex;
        let pubkeyHex;
        let digestFor;
        if (want.scriptType === 'p2pkh') {
            const keyHash = /^76a914([0-9a-f]{40})88ac$/.exec(prevScript)?.[1];
            const pushes = scriptPushes(scriptSigHex);
            if (!keyHash) throw fail('the PSBT prevout script is not p2pkh');
            if (!pushes || pushes.length !== 2) throw fail('the scriptSig is not <signature> <pubkey>');
            if (witness.some((item) => item.length > 0)) throw fail('a p2pkh input carries a witness');
            [sigHex, pubkeyHex] = pushes;
            if (!isPubkey(pubkeyHex) || hash160(pubkeyHex) !== keyHash) throw fail('the public key does not own the prevout');
            digestFor = () => legacyDigest(tx, i, prevScript);
        } else if (want.scriptType === 'p2wpkh' || want.scriptType === 'p2sh-p2wpkh') {
            let program;
            if (want.scriptType === 'p2wpkh') {
                program = prevScript;
                if (scriptSigHex.length !== 0) throw fail('a p2wpkh input carries a scriptSig');
            } else {
                const scriptHash = /^a914([0-9a-f]{40})87$/.exec(prevScript)?.[1];
                const pushes = scriptPushes(scriptSigHex);
                if (!scriptHash) throw fail('the PSBT prevout script is not p2sh');
                if (!pushes || pushes.length !== 1) throw fail('the scriptSig is not the redeem script push');
                [program] = pushes;
                if (hash160(program) !== scriptHash) throw fail('the redeem script does not match the prevout');
            }
            const keyHash = /^0014([0-9a-f]{40})$/.exec(program)?.[1];
            if (!keyHash) throw fail('the witness program is not p2wpkh');
            if (witness.length !== 2) throw fail('the witness is not <signature> <pubkey>');
            [sigHex, pubkeyHex] = witness;
            if (pubkeyHex.length !== 66 || !isPubkey(pubkeyHex) || hash160(pubkeyHex) !== keyHash) {
                throw fail('the public key does not own the prevout');
            }
            const amount = exactSats(want.value);
            if (amount === null) throw fail('the PSBT carries no exact amount for this input');
            if (!bip143) bip143 = bip143Digester(tx);
            digestFor = () => bip143(i, p2pkhScript(keyHash), amount);
        } else {
            throw fail('this script type cannot be verified');
        }
        const reason = checkSignature(sigHex, pubkeyHex, digestFor, wantSighash);
        if (reason) throw fail(reason);
    }
}
