// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// envelopeSelection. Whether the confirm lane asks the encoder for a Taproot
// envelope, decided once for every action rather than per form.
//
// A payload over the legacy compiled ceiling cannot ride one data carrier, and
// the encoder only reaches for the envelope when asked with `encoding: 'AUTO'`
// and the signer's tapscript capability asserted. Deciding it here, once,
// means no action (a long broadcast, a large list) fails at build time on a
// chain and signer that could have carried it because its form never opted in.

import { MAX_COMPILED_ACTION_BYTES } from './fileSizeLimits.js';
import { encoderSignerOptions, signerSupportsTapscript } from './signerCapability.js';

/**
 * Whether this chain and signer can carry a Taproot envelope at all.
 *
 * @param {{ addressTypes?: string[] }|null|undefined} descriptor  chain descriptor
 * @param {{ source?: string }|null|undefined} signer               the spending Address record
 * @returns {boolean}
 */
export function envelopeAvailableFor(descriptor, signer) {
    // The chain half: `p2tr` is the descriptor's own statement that it does Taproot.
    if (!Array.isArray(descriptor?.addressTypes) || !descriptor.addressTypes.includes('p2tr')) return false;
    // The signer half: a reveal nobody can sign would strand the commit.
    return signerSupportsTapscript(signer);
}

// The envelope internal key the encoder requires: a compressed secp256k1 key.
const COMPRESSED_PUBKEY_RE = /^(02|03)[0-9a-fA-F]{64}$/;

/**
 * The encoder options that request the envelope, or null to leave the request as is.
 *
 * A payload over the legacy ceiling asks with `encoding: 'AUTO'`; below it the
 * request stays byte-identical to what it always was. A caller that already
 * asked for AUTO or TAPROOT gets the fields that make that request buildable,
 * and a caller that chose any other encoding keeps it.
 *
 * The encoder picks the envelope only when it also has the spender's compressed
 * public key, which becomes the envelope's internal key. Without it AUTO falls
 * back to P2WSH and refuses the payload at the legacy 8 KB ceiling.
 *
 * @param {object} args
 * @param {{ addressTypes?: string[] }|null|undefined} args.descriptor
 * @param {{ source?: string }|null|undefined} args.signer
 * @param {object} args.encoderOpts           the request's encoder options, pubkey included
 * @param {number} args.compiledBytes         compiled action-plus-data size, uncompressed
 * @returns {{ encoding: string, options: object, compressedPubKey: string } | null}
 */
export function envelopeEncoderOpts({ descriptor, signer, encoderOpts, compiledBytes }) {
    const requested = encoderOpts?.encoding ?? null;
    const asksEnvelope = requested === 'AUTO' || requested === 'TAPROOT';
    // A legacy encoding the caller chose is its decision, never overridden here.
    if (requested !== null && !asksEnvelope) return null;
    // Small payloads fit the legacy carrier; an unasked request stays as it was.
    const oversized = Number.isFinite(compiledBytes) && compiledBytes > MAX_COMPILED_ACTION_BYTES;
    if (!asksEnvelope && !oversized) return null;
    if (!envelopeAvailableFor(descriptor, signer)) return null;
    // No usable internal key means no envelope; the request stays as it was.
    const internalKey = [encoderOpts?.compressedPubKey, encoderOpts?.pubkey]
        .find((k) => typeof k === 'string' && COMPRESSED_PUBKEY_RE.test(k));
    if (!internalKey) return null;
    return {
        encoding: requested ?? 'AUTO',
        options: { ...(encoderOpts?.options || {}), ...encoderSignerOptions(signer) },
        compressedPubKey: internalKey,
    };
}
