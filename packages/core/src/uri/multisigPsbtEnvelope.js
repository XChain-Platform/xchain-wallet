// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Multisig PSBT-QR envelope — §22.3 cosigner round-trip transport.
// Phase 4 Step 20 of 23.
//
// The §20 chunked-QR layer (psbtQr.js) is byte-oriented; for the
// multisig spend protocol we wrap a tiny JSON envelope inside those
// bytes so each cosigner can recognize what they're being asked to
// do (or what response they're being given) without reaching into the
// underlying PSBT bytes.
//
// Two-way protocol:
//
//   coordinator ─request-nonce────►  cosigner       (MuSig2 round 1 ask)
//   coordinator ◄round-1-reply───── cosigner        (publicNonce)
//   coordinator ─request-partial─►  cosigner        (MuSig2 round 2 ask, carries aggNonce)
//   coordinator ◄round-2-reply───── cosigner        (32-byte partial sig)
//
//   coordinator ─request-signature─►cosigner        (P2SH / P2WSH single round)
//   coordinator ◄classical-reply─── cosigner        (DER ECDSA signature)
//
//   coordinator ─finalized────────► all             (broadcast-of-record)
//
// Every envelope carries a `fingerprint` derived from the session's
// invariants (scheme + threshold + cosignerPubkeys + msgHash + psbtHex).
// A cosigner's wallet finds-or-creates the matching local session by
// fingerprint when it receives a request envelope; on reply, the
// coordinator routes by fingerprint into the right ongoing session.
//
// On-the-wire shape (after the JSON encoder):
//
//   {
//     "v": 1,                                 // envelope schema version
//     "kind": "<one of MULTISIG_ENVELOPE_KINDS>",
//     "fingerprint": "<32-byte hex>",
//     "sessionRef": { ... }    // present on request-* and finalized; omitted from reply-*
//     "contribution": { ... }  // present on reply-* and finalized; omitted from request-*
//   }
//
// `sessionRef` mirrors the persistent `MultisigSigningSession` shape
// just enough that a cosigner's wallet can call
// `flows.startMultisigSigningSession` from the request envelope alone.

import { sha256 } from '@noble/hashes/sha2';

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_PREFIX = 'XCW-MS:';

export const MULTISIG_ENVELOPE_KINDS = /** @type {const} */ ([
    'multisig-request-nonce',
    'multisig-round-1-reply',
    'multisig-request-partial',
    'multisig-round-2-reply',
    'multisig-request-signature',
    'multisig-classical-reply',
    'multisig-finalized',
]);

const HEX_RE = /^[0-9a-f]+$/;
const isHexLength = (v, byteLen) =>
    typeof v === 'string' && HEX_RE.test(v.toLowerCase()) && v.length === byteLen * 2;

export class MultisigEnvelopeError extends Error {
    constructor(msg) {
        super(`multisig-envelope: ${msg}`);
        this.name = 'MultisigEnvelopeError';
    }
}

/**
 * Stable identifier for a multisig sign round. Two cosigners' wallets
 * compute the same fingerprint from the same `sessionRef`, which lets
 * them route incoming envelopes to the right local session without
 * shipping a UUID on the wire.
 *
 * @param {object} sessionRef
 * @returns {string}        32-byte hex
 */
export function fingerprintSessionRef(sessionRef) {
    if (!sessionRef || typeof sessionRef !== 'object') {
        throw new MultisigEnvelopeError('sessionRef must be an object');
    }
    const canonical = canonicalizeSessionRef(sessionRef);
    const bytes = new TextEncoder().encode(JSON.stringify(canonical));
    return bytesToHex(sha256(bytes));
}

function canonicalizeSessionRef(ref) {
    return {
        scheme: ref.scheme,
        threshold: ref.threshold,
        cosignerPubkeys: (ref.cosignerPubkeys || []).map((p) => String(p).toLowerCase()),
        msgHash: String(ref.msgHash || '').toLowerCase(),
        psbtHex: String(ref.psbtHex || '').toLowerCase(),
    };
}

function assertSessionRef(ref) {
    if (!ref || typeof ref !== 'object') {
        throw new MultisigEnvelopeError('sessionRef is required');
    }
    if (!['p2sh-multisig', 'p2wsh-multisig', 'taproot-musig2'].includes(ref.scheme)) {
        throw new MultisigEnvelopeError(`sessionRef.scheme "${ref.scheme}" is invalid`);
    }
    if (!Number.isInteger(ref.threshold) || ref.threshold <= 0) {
        throw new MultisigEnvelopeError('sessionRef.threshold must be a positive integer');
    }
    if (!Array.isArray(ref.cosignerPubkeys) || ref.cosignerPubkeys.length < 2) {
        throw new MultisigEnvelopeError('sessionRef.cosignerPubkeys must be ≥ 2 entries');
    }
    if (ref.threshold > ref.cosignerPubkeys.length) {
        throw new MultisigEnvelopeError('sessionRef.threshold must be ≤ cosignerPubkeys.length');
    }
    if (!isHexLength(ref.msgHash, 32)) {
        throw new MultisigEnvelopeError('sessionRef.msgHash must be 32-byte hex');
    }
    if (typeof ref.psbtHex !== 'string') {
        throw new MultisigEnvelopeError('sessionRef.psbtHex must be a string');
    }
}

function assertContribution(kind, contribution) {
    if (!contribution || typeof contribution !== 'object') {
        throw new MultisigEnvelopeError(`contribution is required for "${kind}"`);
    }
    switch (kind) {
        case 'multisig-round-1-reply':
            if (!isHexLength(contribution.pubkey, 33)) {
                throw new MultisigEnvelopeError('contribution.pubkey must be 33-byte hex');
            }
            if (!isHexLength(contribution.publicNonce, 66)) {
                throw new MultisigEnvelopeError('contribution.publicNonce must be 66-byte hex');
            }
            return;
        case 'multisig-round-2-reply':
            if (!isHexLength(contribution.pubkey, 33)) {
                throw new MultisigEnvelopeError('contribution.pubkey must be 33-byte hex');
            }
            if (!isHexLength(contribution.sig, 32)) {
                throw new MultisigEnvelopeError('contribution.sig must be 32-byte hex');
            }
            return;
        case 'multisig-classical-reply':
            if (!isHexLength(contribution.pubkey, 33)) {
                throw new MultisigEnvelopeError('contribution.pubkey must be 33-byte hex');
            }
            if (typeof contribution.sig !== 'string' || !HEX_RE.test(contribution.sig.toLowerCase())) {
                throw new MultisigEnvelopeError('contribution.sig must be hex');
            }
            if (contribution.sig.length < 16 || contribution.sig.length > 200) {
                throw new MultisigEnvelopeError('contribution.sig length out of expected range');
            }
            return;
        case 'multisig-finalized':
            if (typeof contribution.txHex !== 'string'
                || !HEX_RE.test(contribution.txHex.toLowerCase())) {
                throw new MultisigEnvelopeError('contribution.txHex must be hex');
            }
            if (contribution.txid !== undefined
                && (typeof contribution.txid !== 'string' || contribution.txid.length === 0)) {
                throw new MultisigEnvelopeError('contribution.txid must be a non-empty string');
            }
            return;
        default:
            return;
    }
}

function assertAggNonce(kind, aggNonceHex) {
    if (kind === 'multisig-request-partial') {
        if (!isHexLength(aggNonceHex, 66)) {
            throw new MultisigEnvelopeError('aggNonceHex must be 66-byte hex for round-2 requests');
        }
    }
}

/**
 * Build a request envelope. The coordinator emits one of these on each
 * round of the protocol; cosigner wallets parse it, find-or-create
 * the matching local session, and reply with `buildReplyEnvelope`.
 *
 * @param {object} opts
 * @param {'multisig-request-nonce' | 'multisig-request-partial' | 'multisig-request-signature'} opts.kind
 * @param {object} opts.sessionRef
 * @param {string} [opts.aggNonceHex]    required when kind = multisig-request-partial
 */
export function buildRequestEnvelope(opts) {
    if (!opts) throw new MultisigEnvelopeError('opts is required');
    if (![
        'multisig-request-nonce',
        'multisig-request-partial',
        'multisig-request-signature',
    ].includes(opts.kind)) {
        throw new MultisigEnvelopeError(`unknown request kind "${opts.kind}"`);
    }
    assertSessionRef(opts.sessionRef);
    assertAggNonce(opts.kind, opts.aggNonceHex);
    /** @type {object} */
    const envelope = {
        v: ENVELOPE_VERSION,
        kind: opts.kind,
        fingerprint: fingerprintSessionRef(opts.sessionRef),
        sessionRef: canonicalizeSessionRef(opts.sessionRef),
    };
    if (opts.kind === 'multisig-request-partial') {
        envelope.aggNonce = String(opts.aggNonceHex).toLowerCase();
    }
    return envelope;
}

/**
 * Build a reply envelope. Cosigner wallets emit one of these in
 * response to a matching request envelope.
 *
 * @param {object} opts
 * @param {'multisig-round-1-reply' | 'multisig-round-2-reply' | 'multisig-classical-reply'} opts.kind
 * @param {string} opts.fingerprint
 * @param {object} opts.contribution
 */
export function buildReplyEnvelope(opts) {
    if (!opts) throw new MultisigEnvelopeError('opts is required');
    if (![
        'multisig-round-1-reply',
        'multisig-round-2-reply',
        'multisig-classical-reply',
    ].includes(opts.kind)) {
        throw new MultisigEnvelopeError(`unknown reply kind "${opts.kind}"`);
    }
    if (!isHexLength(opts.fingerprint, 32)) {
        throw new MultisigEnvelopeError('fingerprint must be 32-byte hex');
    }
    assertContribution(opts.kind, opts.contribution);
    return {
        v: ENVELOPE_VERSION,
        kind: opts.kind,
        fingerprint: String(opts.fingerprint).toLowerCase(),
        contribution: { ...opts.contribution },
    };
}

/**
 * Build a finalized-broadcast envelope. The coordinator emits this
 * once threshold contributions have been aggregated and the spend has
 * been (or is about to be) broadcast.
 *
 * @param {object} opts
 * @param {object} opts.sessionRef
 * @param {string} opts.txHex
 * @param {string} [opts.txid]
 */
export function buildFinalizedEnvelope(opts) {
    if (!opts) throw new MultisigEnvelopeError('opts is required');
    assertSessionRef(opts.sessionRef);
    assertContribution('multisig-finalized', { txHex: opts.txHex, txid: opts.txid });
    return {
        v: ENVELOPE_VERSION,
        kind: 'multisig-finalized',
        fingerprint: fingerprintSessionRef(opts.sessionRef),
        sessionRef: canonicalizeSessionRef(opts.sessionRef),
        contribution: {
            txHex: opts.txHex.toLowerCase(),
            ...(opts.txid ? { txid: opts.txid } : {}),
        },
    };
}

/**
 * Validate + normalize a parsed envelope. Returns a fresh object with
 * lowercased fingerprint + canonicalized sessionRef so downstream
 * consumers don't need to re-validate inputs.
 *
 * @param {unknown} value
 * @returns {object}
 */
export function validateEnvelope(value) {
    if (!value || typeof value !== 'object') {
        throw new MultisigEnvelopeError('envelope must be an object');
    }
    const e = /** @type {any} */ (value);
    if (e.v !== ENVELOPE_VERSION) {
        throw new MultisigEnvelopeError(
            `unsupported envelope version "${e.v}" (expected ${ENVELOPE_VERSION})`,
        );
    }
    if (!MULTISIG_ENVELOPE_KINDS.includes(e.kind)) {
        throw new MultisigEnvelopeError(`unknown envelope kind "${e.kind}"`);
    }
    if (!isHexLength(e.fingerprint, 32)) {
        throw new MultisigEnvelopeError('fingerprint must be 32-byte hex');
    }
    const out = {
        v: ENVELOPE_VERSION,
        kind: e.kind,
        fingerprint: String(e.fingerprint).toLowerCase(),
    };
    const isRequest = e.kind.startsWith('multisig-request-');
    const isReply = e.kind.endsWith('-reply');
    const isFinalized = e.kind === 'multisig-finalized';
    if (isRequest || isFinalized) {
        assertSessionRef(e.sessionRef);
        const ref = canonicalizeSessionRef(e.sessionRef);
        const expected = fingerprintSessionRef(ref);
        if (expected !== out.fingerprint) {
            throw new MultisigEnvelopeError(
                'fingerprint does not match sessionRef — envelope is malformed or tampered',
            );
        }
        out.sessionRef = ref;
    }
    if (e.kind === 'multisig-request-partial') {
        assertAggNonce(e.kind, e.aggNonce);
        out.aggNonce = String(e.aggNonce).toLowerCase();
    }
    if (isReply || isFinalized) {
        assertContribution(e.kind, e.contribution);
        out.contribution = { ...e.contribution };
        if (out.contribution.pubkey) {
            out.contribution.pubkey = out.contribution.pubkey.toLowerCase();
        }
        if (out.contribution.publicNonce) {
            out.contribution.publicNonce = out.contribution.publicNonce.toLowerCase();
        }
        if (out.contribution.sig) {
            out.contribution.sig = out.contribution.sig.toLowerCase();
        }
        if (out.contribution.txHex) {
            out.contribution.txHex = out.contribution.txHex.toLowerCase();
        }
    }
    return out;
}

/**
 * Serialize an envelope object to UTF-8 bytes. Pass these to
 * `encodeXcwChunks` for animated-QR display.
 *
 * @param {object} envelope
 * @returns {Uint8Array}
 */
export function encodeEnvelope(envelope) {
    const validated = validateEnvelope(envelope);
    const json = JSON.stringify(validated);
    return new TextEncoder().encode(json);
}

/**
 * Parse UTF-8 bytes back into a normalized envelope object.
 *
 * @param {Uint8Array} bytes
 * @returns {object}
 */
export function decodeEnvelope(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw new MultisigEnvelopeError('decodeEnvelope: input must be Uint8Array');
    }
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        throw new MultisigEnvelopeError(`JSON.parse failed: ${e?.message ?? e}`);
    }
    return validateEnvelope(parsed);
}

function bytesToHex(bytes) {
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return s;
}
