// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Does the transaction the device handed back still spend and pay what the
// PSBT the user approved said it would?
//
// On the software lane that question answers itself: SoftwareSigner signs the
// approved PSBT's own bytes, so the broadcast transaction IS the previewed one.
// The hardware lane does not get it for free. Neither device takes a PSBT: the
// converters decompose it and REBUILD the transaction in the vendor's own
// dialect (ledgerFormat.serializeOutputs re-serializes the output set;
// trezorFormat re-encodes each output into Connect's PAYTOADDRESS /
// PAYTOOPRETURN form, OP_RETURN payloads included). Everything the pre-sign
// checks in flows/confirmChecks.js verified was verified against the PSBT, and
// the bytes that actually reach the network are the device's reply to the
// rebuild. A converter bug - a reordered output, an OP_RETURN push mis-parsed,
// a value widened past 2^53, an output dropped - lands on chain unremarked, and
// the device screen cannot catch it because the device is showing what the
// converter told it.
//
// So the rebuilt transaction is re-decomposed here and compared back to the
// PSBT before its txid is ever handed to a caller.
//
// WHAT IS COMPARED, and why not more. The output set (count, order,
// scriptPubKey, value) and the input outpoints (txid:vout, in order) are the
// whole of "where the money goes and what is spent", and they are the fields
// both converters carry across. The locktime is compared too, because a reply
// that dropped it is spendable now rather than at the height the user
// approved: toLedgerCreatePayment forwards lockTime (ledgerFormat.js) and
// toTrezorSignTransaction refuses a nonzero one pre-device (its payload cannot
// carry the field), so neither lane can legitimately return a locktime other
// than the one the PSBT asked for. Version is still deliberately NOT compared:
// toLedgerCreatePayment passes none at all and hw-app-btc picks one, so
// comparing it would refuse every legitimate hardware send rather than catch a
// tampered one. Witness and scriptSig data are not compared either - they are
// the signature, which is exactly what the device is there to add.

import { SignerStatusError } from './Signer.js';

/** Reader over a hex string, byte-addressed, that refuses to run off the end. */
class Cursor {
    constructor(hex) {
        if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
            throw new Error('parseRawTx: txHex is not an even-length hex string');
        }
        this.hex = hex.toLowerCase();
        this.pos = 0;                                   // in BYTES, not hex chars
    }

    get remaining() { return this.hex.length / 2 - this.pos; }

    take(n) {
        if (n < 0 || n > this.remaining) throw new Error(`parseRawTx: truncated at byte ${this.pos}`);
        const out = this.hex.slice(this.pos * 2, (this.pos + n) * 2);
        this.pos += n;
        return out;
    }

    /** Little-endian unsigned integer, as a BigInt so 8-byte values stay exact. */
    uintLE(n) {
        const bytes = this.take(n);
        let v = 0n;
        for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(parseInt(bytes.slice(i * 2, i * 2 + 2), 16));
        return v;
    }

    /** Bitcoin's CompactSize. Returned as a Number: a length this side of 2^53
     *  is already far past any transaction the take() bound would allow. */
    varint() {
        const first = Number(this.uintLE(1));
        if (first < 0xfd) return first;
        if (first === 0xfd) return Number(this.uintLE(2));
        if (first === 0xfe) return Number(this.uintLE(4));
        const v = this.uintLE(8);
        if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('parseRawTx: absurd varint');
        return Number(v);
    }

    varSlice() { return this.take(this.varint()); }
}

/** Internal byte order -> display order (the form decomposePsbt reports). */
function reverseHex(hex) {
    let out = '';
    for (let i = hex.length - 2; i >= 0; i -= 2) out += hex.slice(i, i + 2);
    return out;
}

/**
 * Decode a raw Bitcoin transaction, legacy or segwit serialization.
 *
 * @param {string} txHex
 * @returns {{ version: number, locktime: number,
 *   inputs: Array<{ prevTxHash: string, prevTxIndex: number, sequence: number }>,
 *   outputs: Array<{ valueSat: bigint, scriptPubKeyHex: string }> }}
 */
export function parseRawTx(txHex) {
    const c = new Cursor(txHex);
    const version = Number(BigInt.asIntN(32, c.uintLE(4)));

    // BIP144 puts a 0x00 marker + 0x01 flag where the input count would be. A
    // real transaction always has at least one input, so a zero input count is
    // never ambiguous with the marker.
    let segwit = false;
    if (c.remaining >= 2 && c.hex.slice(c.pos * 2, c.pos * 2 + 4) === '0001') {
        c.take(2);
        segwit = true;
    }

    const inputs = [];
    const inputCount = c.varint();
    if (inputCount === 0) throw new Error('parseRawTx: transaction has no inputs');
    for (let i = 0; i < inputCount; i++) {
        const prevTxHash = reverseHex(c.take(32));
        const prevTxIndex = Number(c.uintLE(4));
        c.varSlice();                                   // scriptSig: the signature, not compared
        const sequence = Number(c.uintLE(4));
        inputs.push({ prevTxHash, prevTxIndex, sequence });
    }

    const outputs = [];
    const outputCount = c.varint();
    for (let i = 0; i < outputCount; i++) {
        const valueSat = c.uintLE(8);
        outputs.push({ valueSat, scriptPubKeyHex: c.varSlice() });
    }

    // The witness stacks sit between the outputs and the locktime, so they have
    // to be walked even though nothing here reads them.
    if (segwit) {
        for (let i = 0; i < inputCount; i++) {
            const items = c.varint();
            for (let j = 0; j < items; j++) c.varSlice();
        }
    }

    const locktime = Number(c.uintLE(4));
    if (c.remaining !== 0) throw new Error(`parseRawTx: ${c.remaining} trailing byte(s) after locktime`);
    return { version, locktime, inputs, outputs };
}

/** `n` as a BigInt, refusing a satoshi count JS has already rounded. */
function exactSats(value, what) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    // Past 2^53 a Number has already lost the low bits, so comparing it would
    // pass a tampered value that differs only there. Refuse instead.
    throw new Error(`${what} is not an exact satoshi amount: ${String(value)}`);
}

/**
 * Refuse a signed transaction whose spend or payment set is not the one the
 * approved PSBT described.
 *
 * @param {Object} params
 * @param {string} params.txHex                                     the device's reply
 * @param {import('./types.js').DecomposedPsbt} params.decomposed   decomposePsbt(approved PSBT)
 * @param {string} params.signerId
 * @throws {SignerStatusError} on any divergence, or on a reply that will not parse
 */
export function assertSignedTxMatchesPsbt({ txHex, decomposed, signerId }) {
    // Returns the error rather than throwing it, so every refusal below reads as
    // a `throw` at its own site and no control-flow analysis has to guess.
    const refusal = (detail) => new SignerStatusError(signerId, 'error',
        `the signed transaction does not match the approved PSBT: ${detail}. Nothing was broadcast.`);

    if (!decomposed || !Array.isArray(decomposed.outputs) || !Array.isArray(decomposed.inputs)) {
        throw refusal('the approved PSBT could not be decomposed, so there is nothing to compare against');
    }

    let tx;
    try {
        tx = parseRawTx(txHex);
    } catch (err) {
        // An unparseable reply is not a pass. It is a reply nothing can vouch
        // for, which is the same refusal as a mismatched one.
        throw refusal(`it could not be decoded (${err.message})`);
    }

    if (tx.outputs.length !== decomposed.outputs.length) {
        throw refusal(`it pays ${tx.outputs.length} output(s), the PSBT paid ${decomposed.outputs.length}`);
    }
    for (let i = 0; i < tx.outputs.length; i++) {
        const want = decomposed.outputs[i];
        const got = tx.outputs[i];
        const wantScript = String(want.scriptPubKeyHex || '').toLowerCase();
        if (wantScript !== got.scriptPubKeyHex) {
            throw refusal(`output ${i} pays script ${got.scriptPubKeyHex}, the PSBT paid ${wantScript}`);
        }
        let wantSats;
        try {
            wantSats = exactSats(want.value, `output ${i}`);
        } catch (err) {
            throw refusal(err.message);
        }
        if (wantSats !== got.valueSat) {
            throw refusal(`output ${i} pays ${got.valueSat} sat, the PSBT paid ${wantSats} sat`);
        }
    }

    if (tx.inputs.length !== decomposed.inputs.length) {
        throw refusal(`it spends ${tx.inputs.length} input(s), the PSBT spent ${decomposed.inputs.length}`);
    }
    for (let i = 0; i < tx.inputs.length; i++) {
        const want = decomposed.inputs[i];
        const got = tx.inputs[i];
        const wantPoint = `${String(want.prevTxHash || '').toLowerCase()}:${want.prevTxIndex}`;
        const gotPoint = `${got.prevTxHash}:${got.prevTxIndex}`;
        if (wantPoint !== gotPoint) {
            throw refusal(`input ${i} spends ${gotPoint}, the PSBT spent ${wantPoint}`);
        }
    }

    // Compare the timelock too: a reply that dropped it is spendable NOW,
    // which is the opposite of what the user approved, and no other check
    // here would notice. Both lanes can carry the field honestly now - Ledger
    // forwards lockTime into createPaymentTransaction, and the Trezor
    // converter refuses a nonzero one before the device sees it - so a
    // mismatch is a real divergence rather than a converter that never had it.
    const wantLocktime = Number(decomposed.locktime || 0);
    if (!Number.isFinite(wantLocktime)) {
        throw refusal(`the PSBT's locktime ${String(decomposed.locktime)} is not a number`);
    }
    if (tx.locktime !== wantLocktime) {
        throw refusal(`it has locktime ${tx.locktime}, the PSBT asked for ${wantLocktime}`);
    }
}
