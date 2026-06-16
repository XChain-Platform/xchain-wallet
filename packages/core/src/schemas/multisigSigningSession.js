// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MultisigSigningSession — §22.3 partial-signature tracking. Phase 4
// Step 19 of 23. Persists per-tx contribution state so a multisig
// spend can resume across wallet sessions.
//
// Two state machines collapsed into one record. The `scheme` field
// drives which lanes are populated:
//
//   p2sh-multisig / p2wsh-multisig (single round):
//     status: 'collecting-sigs' → 'ready-to-finalize' → 'finalized' → 'broadcast'
//     contributions: signatures[]      one DER-encoded ECDSA sig per cosigner
//
//   taproot-musig2 (two rounds):
//     status: 'collecting-nonces'      round 1 — collect 66-byte publicNonces
//          → 'collecting-sigs'         round 2 — aggNonce computed; collect 32-byte partial sigs
//          → 'ready-to-finalize'       partialSigs aggregated into a 64-byte Schnorr sig
//          → 'finalized' → 'broadcast'
//     contributions: nonces[], partialSigs[]
//
// `'cancelled'` is a terminal state from any non-terminal status.
//
// `psbtHex` carries the underlying unsigned tx in whatever form Step 20
// transports (vanilla PSBT for P2SH/P2WSH; envelope-wrapped for
// MuSig2). Step 19 treats it as opaque; Step 20+ owns construction +
// finalization.

import {
    check,
    checkEach,
    isIsoTimestamp,
    isInteger,
    isNonEmptyString,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from './validate.js';
import { MULTISIG_SCHEMES } from './multisigConfig.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 1;

export const MULTISIG_SESSION_STATUSES = /** @type {const} */ ([
    'collecting-nonces',
    'collecting-sigs',
    'ready-to-finalize',
    'finalized',
    'broadcast',
    'cancelled',
]);

const HEX_RE = /^[0-9a-f]+$/;
const isLowerHex = (v) => isNonEmptyString(v) && HEX_RE.test(v);
const isHexLength = (v, byteLen) => isLowerHex(v) && v.length === byteLen * 2;

/**
 * @typedef {Object} NonceContribution
 * @property {string} pubkey            66-char compressed-pubkey hex
 * @property {string} publicNonce       132-char (66-byte) hex
 * @property {string} contributedAt     ISO timestamp
 */

/**
 * @typedef {Object} SignatureContribution
 * @property {string} pubkey            66-char compressed-pubkey hex
 * @property {string} sig               DER-encoded ECDSA hex (P2SH/P2WSH) or 64-char (32-byte) hex (MuSig2 partial)
 * @property {string} contributedAt     ISO timestamp
 */

/**
 * @typedef {Object} MultisigSigningSession
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} chainId
 * @property {typeof MULTISIG_SCHEMES[number]} scheme
 * @property {number} threshold
 * @property {string[]} cosignerPubkeys      ordered same as MultisigConfig.cosigners
 * @property {string} msgHash                64-char hex; sighash being signed (single-input PSBTs in Step 19)
 * @property {string} psbtHex                opaque transport payload; Step 20 owns shape
 * @property {string} actionSummary          §21.1 plain-English summary for the sign screen
 * @property {NonceContribution[]} nonces           MuSig2 round 1 emissions; empty for P2SH/P2WSH
 * @property {string | null} aggNonce               66-byte hex once nonces threshold met (MuSig2 only)
 * @property {SignatureContribution[]} partialSigs  MuSig2 round 2 partials; unused for P2SH/P2WSH
 * @property {string | null} aggregatedSchnorrSig   64-byte hex once round 2 aggregated (MuSig2 only)
 * @property {SignatureContribution[]} signatures   P2SH/P2WSH single-round emissions; unused for MuSig2
 * @property {typeof MULTISIG_SESSION_STATUSES[number]} status
 * @property {string | null} finalizedTxHex
 * @property {string | null} txid
 * @property {string} createdAt
 * @property {string} updatedAt
 */

const isNullableLowerHex = (v) => v === null || isLowerHex(v);
const isNullableNonEmptyString = (v) => v === null || isNonEmptyString(v);
const isNullableString = (v) => v === null || isString(v);

const isNonceEntry = (v) =>
    isPlainObject(v) &&
    isHexLength(v.pubkey, 33) &&
    isHexLength(v.publicNonce, 66) &&
    isIsoTimestamp(v.contributedAt);

const isSignatureEntry = (v) =>
    isPlainObject(v) &&
    isHexLength(v.pubkey, 33) &&
    isLowerHex(v.sig) &&
    isIsoTimestamp(v.contributedAt);

/**
 * @param {object} input
 * @param {string} input.walletId
 * @param {string} input.chainId
 * @param {typeof MULTISIG_SCHEMES[number]} input.scheme
 * @param {number} input.threshold
 * @param {string[]} input.cosignerPubkeys
 * @param {string} input.msgHash
 * @param {string} input.psbtHex
 * @param {string} input.actionSummary
 * @returns {MultisigSigningSession}
 */
export function createMultisigSigningSession(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('createMultisigSigningSession: input is required');
    }
    if (!isNonEmptyString(input.walletId)) {
        throw new Error('createMultisigSigningSession: walletId is required');
    }
    if (!isNonEmptyString(input.chainId)) {
        throw new Error('createMultisigSigningSession: chainId is required');
    }
    if (!MULTISIG_SCHEMES.includes(input.scheme)) {
        throw new Error(
            `createMultisigSigningSession: scheme must be one of ${MULTISIG_SCHEMES.join(', ')}`,
        );
    }
    if (!Number.isInteger(input.threshold) || input.threshold <= 0) {
        throw new Error('createMultisigSigningSession: threshold must be a positive integer');
    }
    if (!Array.isArray(input.cosignerPubkeys) || input.cosignerPubkeys.length < 2) {
        throw new Error(
            'createMultisigSigningSession: cosignerPubkeys must be an array of at least 2 entries',
        );
    }
    if (input.threshold > input.cosignerPubkeys.length) {
        throw new Error(
            'createMultisigSigningSession: threshold must be ≤ cosignerPubkeys.length',
        );
    }
    if (!isHexLength(String(input.msgHash || '').toLowerCase(), 32)) {
        throw new Error('createMultisigSigningSession: msgHash must be 32-byte hex');
    }
    if (typeof input.psbtHex !== 'string') {
        throw new Error('createMultisigSigningSession: psbtHex must be a string');
    }
    const actionSummary = typeof input.actionSummary === 'string' ? input.actionSummary : '';

    const now = new Date().toISOString();
    const isMusig2 = input.scheme === 'taproot-musig2';
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        chainId: input.chainId,
        scheme: input.scheme,
        threshold: input.threshold,
        cosignerPubkeys: input.cosignerPubkeys.map((p) => p.toLowerCase()),
        msgHash: input.msgHash.toLowerCase(),
        psbtHex: input.psbtHex,
        actionSummary,
        nonces: [],
        aggNonce: null,
        partialSigs: [],
        aggregatedSchnorrSig: null,
        signatures: [],
        status: isMusig2 ? 'collecting-nonces' : 'collecting-sigs',
        finalizedTxHex: null,
        txid: null,
        createdAt: now,
        updatedAt: now,
    };
}

export function validateMultisigSigningSession(record) {
    const errors = [];
    if (!check(errors, 'multisigSigningSession', isPlainObject(record), 'must be an object')) {
        return result(errors);
    }
    const r = /** @type {MultisigSigningSession} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(errors, 'chainId', isNonEmptyString(r.chainId), 'must be a non-empty string');
    check(errors, 'scheme', isOneOf(r.scheme, MULTISIG_SCHEMES), `must be one of ${MULTISIG_SCHEMES.join(', ')}`);
    check(errors, 'threshold', isInteger(r.threshold) && r.threshold > 0, 'must be a positive integer');
    checkEach(errors, 'cosignerPubkeys', r.cosignerPubkeys, (v) => isHexLength(v, 33), 'must be 33-byte hex');
    if (Array.isArray(r.cosignerPubkeys) && isInteger(r.threshold)) {
        if (r.threshold > r.cosignerPubkeys.length) {
            errors.push('threshold: must be ≤ cosignerPubkeys.length');
        }
    }
    check(errors, 'msgHash', isHexLength(r.msgHash, 32), 'must be 32-byte hex');
    check(errors, 'psbtHex', isString(r.psbtHex), 'must be a string');
    check(errors, 'actionSummary', isString(r.actionSummary), 'must be a string');
    checkEach(errors, 'nonces', r.nonces, isNonceEntry, 'malformed');
    check(errors, 'aggNonce', r.aggNonce === null || isHexLength(r.aggNonce, 66), 'must be null or 66-byte hex');
    checkEach(errors, 'partialSigs', r.partialSigs, isSignatureEntry, 'malformed');
    check(errors, 'aggregatedSchnorrSig', r.aggregatedSchnorrSig === null || isHexLength(r.aggregatedSchnorrSig, 64), 'must be null or 64-byte hex');
    checkEach(errors, 'signatures', r.signatures, isSignatureEntry, 'malformed');
    check(errors, 'status', isOneOf(r.status, MULTISIG_SESSION_STATUSES), `must be one of ${MULTISIG_SESSION_STATUSES.join(', ')}`);
    check(errors, 'finalizedTxHex', isNullableLowerHex(r.finalizedTxHex), 'must be null or hex');
    check(errors, 'txid', isNullableNonEmptyString(r.txid), 'must be null or a non-empty string');
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    check(errors, 'updatedAt', isIsoTimestamp(r.updatedAt), 'must be an ISO timestamp');
    return result(errors);
}

/**
 * Cosigners that have not yet contributed for the current round. For
 * P2SH/P2WSH this is the single signature round; for MuSig2 it depends
 * on `status`.
 *
 * @param {MultisigSigningSession} session
 * @returns {string[]} pubkeys (lowercase hex)
 */
export function pendingCosignerPubkeys(session) {
    if (!session) return [];
    const all = session.cosignerPubkeys || [];
    if (session.scheme === 'taproot-musig2') {
        if (session.status === 'collecting-nonces') {
            const have = new Set(session.nonces.map((n) => n.pubkey));
            return all.filter((pk) => !have.has(pk));
        }
        if (session.status === 'collecting-sigs') {
            const have = new Set(session.partialSigs.map((s) => s.pubkey));
            return all.filter((pk) => !have.has(pk));
        }
        return [];
    }
    if (session.status === 'collecting-sigs') {
        const have = new Set(session.signatures.map((s) => s.pubkey));
        return all.filter((pk) => !have.has(pk));
    }
    return [];
}

/**
 * Human-readable summary for the sign screen header. For MuSig2 the
 * counter switches from "Nonces collected" to "Partial sigs collected"
 * as round 2 begins.
 *
 * @param {MultisigSigningSession} session
 */
export function progressSummary(session) {
    if (!session) return null;
    const t = session.threshold;
    const isMusig2 = session.scheme === 'taproot-musig2';
    if (session.status === 'cancelled') return { label: 'Cancelled', current: 0, threshold: t };
    if (session.status === 'broadcast') return { label: 'Broadcast', current: t, threshold: t };
    if (session.status === 'finalized') return { label: 'Finalized', current: t, threshold: t };
    if (session.status === 'ready-to-finalize') return { label: 'Ready to finalize', current: t, threshold: t };
    if (isMusig2) {
        if (session.status === 'collecting-nonces') {
            return {
                label: 'Nonces collected',
                current: session.nonces.length,
                threshold: t,
            };
        }
        return {
            label: 'Partial sigs collected',
            current: session.partialSigs.length,
            threshold: t,
        };
    }
    return {
        label: 'Signatures collected',
        current: session.signatures.length,
        threshold: t,
    };
}
