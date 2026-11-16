// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// uploadMethod: the user's choice of how a file's bytes ride the chain, shared
// by Publish file, Gated publish and Attach artwork.
//
//   taproot   the Taproot envelope (taproot-envelope.md): a commit funds one
//             P2TR output and the reveal spends it with the whole file in one
//             tapscript witness. The compose asks the encoder for AUTO with the
//             signer's tapscript capability asserted; the ceiling is the
//             envelope ceiling.
//   standard  what the encoder builds when no encoding is requested
//             (xchain-encoder payload_preparation.js prepareData): one OP_RETURN
//             output when the payload fits 80 bytes, otherwise P2SH chunk
//             outputs that a second transaction reveals. Legacy ceiling, no
//             `encoding` on the request.
//
// Availability is decided here once so the three forms cannot disagree, and it
// fails closed exactly as flows/signerCapability.js does: a reveal nobody can
// sign strands the commit.

import {
    AES_GCM_ENVELOPE_BYTES,
    compiledCeilingFor,
    gatedBatchActionString,
    publicFileActionString,
} from './fileSizeLimits.js';
import { compiledPayloadByteLen, envelopeAvailableFor } from './envelopeSelection.js';
import { encoderSignerOptions } from './signerCapability.js';
import { displayRateToPerByte, satsToCoinDecimal } from './feeEstimate.js';

export const UPLOAD_METHOD_TAPROOT = 'taproot';
export const UPLOAD_METHOD_STANDARD = 'standard';
/** Display order: Taproot first, since it is the cheapest and the default. */
export const UPLOAD_METHODS = Object.freeze([UPLOAD_METHOD_TAPROOT, UPLOAD_METHOD_STANDARD]);

/**
 * Compiled size (action push plus file push) of a public FILE upload, before
 * compression: the payload the fee estimate prices.
 *
 * @param {{ name: string, type: string, title?: string, memo?: string }} meta
 * @param {number} fileBytes
 * @returns {number}
 */
export function publicFileCompiledBytes(meta, fileBytes) {
    return compiledPayloadByteLen(publicFileActionString(meta), { byteLength: fileBytes });
}

/**
 * Compiled size of a gated publish: the BATCH string (fixed-width key fields)
 * plus the ciphertext, which is the plaintext plus its AES-GCM envelope.
 *
 * @param {Parameters<typeof gatedBatchActionString>[0]} meta
 * @param {number} plainBytes
 * @returns {number}
 */
export function gatedFileCompiledBytes(meta, plainBytes) {
    return compiledPayloadByteLen(gatedBatchActionString(meta), { byteLength: plainBytes + AES_GCM_ENVELOPE_BYTES });
}

const ENVELOPE_CAPABLE_SOURCE = Object.freeze({ source: 'hd' });
const HARDWARE_SOURCES = Object.freeze(['trezor', 'ledger']);

/**
 * Why the Taproot envelope cannot carry this upload, or null when it can.
 * Chain reasons come first because no signer change fixes them.
 *
 * @param {object} args
 * @param {{ coin?: string, taprootEnvelope?: boolean, addressTypes?: string[] } | null | undefined} args.descriptor
 * @param {{ source?: string } | null | undefined} args.fromAddress  the spending Address record
 * @param {boolean} [args.isWatcherMode]  another phone signs: the watch-only lane builds one unsigned PSBT and no reveal
 * @returns {null | 'noTaproot' | 'chain' | 'watcher' | 'hardware' | 'watchOnly' | 'signer'}
 */
export function taprootUnavailableReason({ descriptor, fromAddress, isWatcherMode = false }) {
    if (!envelopeAvailableFor(descriptor, ENVELOPE_CAPABLE_SOURCE)) {
        if (descriptor?.coin === 'dogecoin') return 'noTaproot';
        return 'chain';
    }
    if (isWatcherMode) return 'watcher';
    const source = fromAddress?.source;
    if (HARDWARE_SOURCES.includes(source)) return 'hardware';
    if (source === 'watch-only') return 'watchOnly';
    if (!envelopeAvailableFor(descriptor, fromAddress)) return 'signer';
    return null;
}

/**
 * Why Standard cannot carry this upload, or null when it can: a file already
 * larger than the legacy ceiling (picked under the envelope) does not fit it.
 *
 * @param {{ fileBytes?: number | null, standardCap?: number | null }} args
 * @returns {null | 'tooLarge'}
 */
export function standardUnavailableReason({ fileBytes, standardCap }) {
    if (Number.isFinite(fileBytes) && Number.isFinite(standardCap) && fileBytes > standardCap) return 'tooLarge';
    return null;
}

/**
 * The method the form actually uses. An explicit pick holds while it is
 * usable; otherwise the Taproot envelope is the default whenever it is
 * available, then Standard.
 *
 * @param {{ picked?: string | null, reasons: Record<string, string | null> }} args
 * @returns {string}
 */
export function resolveUploadMethod({ picked = null, reasons }) {
    if (picked && UPLOAD_METHODS.includes(picked) && !reasons?.[picked]) return picked;
    for (const method of UPLOAD_METHODS) {
        if (!reasons?.[method]) return method;
    }
    return UPLOAD_METHOD_STANDARD;
}

/**
 * The `encoding` the ceiling helpers (maxPublicFileBytes, maxGatedPlaintextBytes)
 * size against for a method.
 *
 * @param {string} method
 * @returns {{ encoding?: string }}
 */
export function uploadMethodCeilingOpts(method) {
    return method === UPLOAD_METHOD_TAPROOT ? { encoding: 'TAPROOT' } : {};
}

/**
 * The encoder options a compose sends for a method: AUTO with the signer's
 * capability asserted for the envelope, nothing for Standard (the encoder's
 * long-standing default lane).
 *
 * @param {string} method
 * @param {{ source?: string } | null | undefined} fromAddress
 * @returns {{ encoding?: string, options?: { signerSupportsTapscript: boolean } }}
 */
export function uploadMethodEncoderOpts(method, fromAddress) {
    return method === UPLOAD_METHOD_TAPROOT
        ? { encoding: 'AUTO', options: encoderSignerOptions(fromAddress) }
        : {};
}

// ---- Size model --------------------------------------------------------
//
// The wallet's fee helpers (flows/feeEstimate.js) price a rate, not a payload:
// their tiers assume one 250-vbyte send. The two lanes differ by how many bytes
// the same payload costs, so each option's fee is that rate times the lane's
// transaction size for this payload. The sizes mirror the encoder's own
// estimators (xchain-encoder src/build/tx_size_estimator.js and
// src/XChainEncoder/size_estimation.js); both transactions of a pair are
// counted. They are upper bounds: compression only ever shrinks the payload,
// and the confirm screen shows the exact fee of the composed transactions.

const MAGIC_BYTES = 4;             // "XCHN"
const OP_RETURN_SIZE = 80;         // encoder OP_RETURN_SIZE
const CHUNK_DATA_BYTES = 476;      // encoder P2SH_SIZE 520 minus its 44-byte reservation
const ENVELOPE_PUSH_BYTES = 520;   // encoder TAPROOT_ENVELOPE_CHUNK_SIZE
const P2SH_GATE_TRAILER = 26;      // OP_DROP OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
const P2SH_OUTPUT_BYTES = 32;
const P2TR_OUTPUT_BYTES = 43;
const MARKER_OUTPUT_BYTES = 19;    // the reveal's OP_RETURN "XCHN" + lane tag

function compactSizeLen(n) {
    if (n < 0xfd) return 1;
    if (n <= 0xffff) return 3;
    return 5;
}

function pushPrefixLen(n) {
    if (n < 0x4c) return 1;
    if (n <= 0xff) return 2;
    if (n <= 0xffff) return 3;
    return 5;
}

/** Byte sizes of one funding input, one change output and the tx overhead. */
function walletShape(descriptor) {
    const segwit = Array.isArray(descriptor?.addressTypes) && descriptor.addressTypes.includes('p2wpkh');
    return segwit
        ? { input: 68, change: 31, overhead: 11 }
        : { input: 148, change: 34, overhead: 10 };
}

/** Sizes of `total` bytes cut into pieces of at most `size`. */
function pieces(total, size) {
    const out = [];
    for (let left = total; left > 0; left -= size) out.push(Math.min(left, size));
    return out;
}

function opReturnTxBytes(compiledBytes, shape) {
    const script = 1 + pushPrefixLen(compiledBytes + MAGIC_BYTES) + compiledBytes + MAGIC_BYTES;
    return shape.overhead + shape.input + (8 + compactSizeLen(script) + script) + shape.change;
}

/** Commit plus reveal of the P2SH chunk lane (Standard above 80 bytes). */
function standardPairBytes(compiledBytes, shape) {
    const chunks = pieces(compiledBytes + MAGIC_BYTES, CHUNK_DATA_BYTES);
    const commit = shape.overhead + shape.input + chunks.length * P2SH_OUTPUT_BYTES + shape.change;
    let revealInputs = 0;
    for (const chunk of chunks) {
        const redeem = pushPrefixLen(chunk) + chunk + P2SH_GATE_TRAILER;
        const scriptSig = (1 + 72) + (1 + 33) + pushPrefixLen(redeem) + redeem;
        // estimateP2shInputWithRedeem plus the encoder's 8-byte DER margin.
        revealInputs += 40 + (scriptSig < 253 ? 1 : 3) + scriptSig + 8;
    }
    const reveal = 10 + revealInputs + MARKER_OUTPUT_BYTES + shape.change;
    return commit + reveal;
}

/** Commit plus reveal of the Taproot envelope, in vbytes. */
function envelopePairVbytes(compiledBytes, shape) {
    const commit = shape.overhead + shape.input + P2TR_OUTPUT_BYTES + shape.change;
    const pushes = pieces(compiledBytes, ENVELOPE_PUSH_BYTES);
    const pushBytes = pushes.reduce((sum, n) => sum + pushPrefixLen(n) + n, 0);
    // OP_FALSE OP_IF, <"XCHN">, <format byte>, payload pushes, OP_ENDIF, <key> OP_CHECKSIG
    const script = 2 + (1 + MAGIC_BYTES) + 2 + pushBytes + 1 + 34 + 1;
    const witness = 2 + 1 + (1 + 65) + compactSizeLen(script) + script + (1 + 33);
    const strippedReveal = 10 + 41 + shape.change;
    // estimateEnvelopeRevealTx, with its 2-vbyte slack.
    const reveal = strippedReveal + Math.ceil(witness / 4) + 2;
    return commit + reveal;
}

/**
 * Transaction size, in vbytes (raw bytes on a chain without segwit), of each
 * method for a compiled payload of `compiledBytes` (the action push plus the
 * file push). Null for a method this chain cannot build.
 *
 * @param {{ compiledBytes: number, descriptor: object | null | undefined }} args
 * @returns {{ taproot: number | null, standard: number | null }}
 */
export function uploadMethodSizes({ compiledBytes, descriptor }) {
    if (!Number.isFinite(compiledBytes) || compiledBytes <= 0) return { taproot: null, standard: null };
    const shape = walletShape(descriptor);
    // Both lanes put a payload this small in one OP_RETURN output: AUTO and the
    // no-encoding default make the same choice there.
    const tiny = compiledBytes + MAGIC_BYTES <= OP_RETURN_SIZE;
    const taprootChain = envelopeAvailableFor(descriptor, ENVELOPE_CAPABLE_SOURCE);
    const standardFits = compiledBytes <= compiledCeilingFor(undefined);
    const taprootFits = compiledBytes <= compiledCeilingFor('TAPROOT');
    return {
        taproot: taprootChain && taprootFits
            ? (tiny ? opReturnTxBytes(compiledBytes, shape) : envelopePairVbytes(compiledBytes, shape))
            : null,
        standard: standardFits
            ? (tiny ? opReturnTxBytes(compiledBytes, shape) : standardPairBytes(compiledBytes, shape))
            : null,
    };
}

/**
 * The pair-size estimators a multi-part quote prices each piece with, for one
 * chain. The host binds these itself (handleFileMultipart drops any sizes a
 * renderer sends), so without them every multi-part start fails its quote.
 *
 * Every piece is forced onto the commit and reveal pair of its lane (TAPROOT or
 * P2SH), so a small piece is priced as that pair, never as the one OP_RETURN
 * transaction uploadMethodSizes picks for a small single upload. The quote
 * passes 0 bytes for the manifest slot, whose action string it does not hold,
 * so that slot is priced at MULTIPART_MANIFEST_ALLOWANCE_BYTES: a manifest
 * funded as an empty payload could not pay its own reveal.
 *
 * @param {object | null | undefined} descriptor
 * @returns {{ envelopePairVbytes: (bytes: number) => number | null,
 *             standardPairBytes: (bytes: number) => number | null }}
 */
export const MULTIPART_MANIFEST_ALLOWANCE_BYTES = 1024;

export function multipartPairSizes(descriptor) {
    const shape = walletShape(descriptor);
    const pieceBytes = (bytes) => (bytes > 0 ? bytes : MULTIPART_MANIFEST_ALLOWANCE_BYTES);
    return {
        envelopePairVbytes: (bytes) => envelopePairVbytes(pieceBytes(bytes), shape),
        standardPairBytes: (bytes) => standardPairBytes(pieceBytes(bytes), shape),
    };
}

/**
 * The estimated total network fee of each method, at the rate of the fee the
 * form already shows (its Low / Normal / Fast / Custom estimate from
 * flows/feeEstimate.js). One call prices every option.
 *
 * @param {object} args
 * @param {number | null} args.compiledBytes
 * @param {object | null | undefined} args.descriptor
 * @param {{ unit?: string, rateValue?: number | string } | null | undefined} args.feeEstimate
 * @returns {{ taproot: { sats: number, coinAmount: string, vbytes: number } | null,
 *             standard: { sats: number, coinAmount: string, vbytes: number } | null }}
 */
export function estimateUploadMethodFees({ compiledBytes, descriptor, feeEstimate }) {
    const none = { taproot: null, standard: null };
    const rateValue = Number(feeEstimate?.rateValue);
    const unit = feeEstimate?.unit;
    if (!unit || !Number.isFinite(rateValue) || rateValue <= 0) return none;
    // Per vbyte on BTC and LTC, per byte (from a per-kB rate) on DOGE.
    const perByte = displayRateToPerByte(unit, rateValue);
    if (!Number.isFinite(perByte) || perByte <= 0) return none;
    const sizes = uploadMethodSizes({ compiledBytes, descriptor });
    const price = (vbytes) => {
        if (!Number.isFinite(vbytes)) return null;
        const sats = Math.ceil(perByte * vbytes);
        return { sats, coinAmount: satsToCoinDecimal(sats), vbytes };
    };
    return { taproot: price(sizes.taproot), standard: price(sizes.standard) };
}
