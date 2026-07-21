// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Broadcast-failure permanence classifier ( §5.3.4).
//
// A post-sign broadcast failure splits two ways:
//
//   PERMANENT - the signed tx can NEVER confirm as-is: its inputs are
//     gone (spent/missing), or a conflicting tx has already confirmed.
//     Re-signing is pointless; the modal must offer a fresh re-compose,
//     and the PendingTx is marked `failed` (never queued).
//
//   TRANSIENT - the node/connection is momentarily unavailable
//     (connection refused, timeout, mempool full, min-relay-fee, chain
//     too long). The SAME signed tx can still confirm later, so it goes
//     to the §49.5 queued-rebroadcast surface.
//
// The queue applies this SAME classification on every retry (a queued
// tx whose inputs later vanish flips to `failed`; it never retries
// forever). Re-signing while a queued signed copy exists is forbidden
// (double-broadcast guard).
//
// Node reject strings are the ground truth here; the encoder/relay
// forwards them. When the reason is genuinely ambiguous we default to
// TRANSIENT: re-queuing a doomed tx wastes a retry, whereas discarding
// a still-valid signed tx as `failed` loses money (the fee) - the
// conservative default keeps the signed tx recoverable.

// Inputs spent or missing, or a confirmed conflicting tx: the signed tx
// is dead and only a re-compose (new inputs) can succeed.
const PERMANENT_PATTERNS = [
    /missing\s*or\s*spent/i,
    /missingorspent/i,
    /bad-txns-inputs-missingorspent/i,
    /bad-txns-inputs-spent/i,
    /missing\s+inputs/i,
    /txn-already-known/i,           // already confirmed under a different path
    /txn-already-in-mempool/i,      // an identical tx is already queued (not a re-sign case)
    /conflict.*confirmed/i,
    /already\s+spent/i,
];

// Node/connection is momentarily unavailable but the SAME signed tx can
// still confirm; queue and retry.
const TRANSIENT_PATTERNS = [
    /ECONNREFUSED/i, /ECONNRESET/i, /ETIMEDOUT/i, /ENOTFOUND/i,
    /timeout/i, /timed out/i, /network/i, /socket hang up/i,
    /too-long-mempool-chain/i, /mempool.*full/i, /mempool min fee/i,
    /min relay fee/i, /insufficient priority/i, /rate.?limit/i,
    /502|503|504/,
    /txn-mempool-conflict/i,        // a competing UNconfirmed tx; may clear
];

// Permanence has to survive the messaging boundary, and that envelope
// carries ONLY `{ name, message }` (MessageHost.serializeError) - a custom
// field would be silently dropped. So the classification is encoded in the
// error NAME, the same mechanism the wallet already uses to recognise
// InvalidPasswordError across the boundary. submitAction stamps one of
// these before rethrowing; the confirm hook reads it back.
export const BROADCAST_FAILED_PERMANENT_NAME = 'BroadcastFailedPermanentError';
export const BROADCAST_FAILED_TRANSIENT_NAME = 'BroadcastFailedTransientError';

/**
 * Recover the broadcast-failure permanence from an error that may have
 * crossed the messaging boundary (where only name + message survive).
 *
 * @param {unknown} err
 * @returns {'permanent' | 'transient' | null}   null when this is not a broadcast failure
 */
export function broadcastFailureKindFromError(err) {
    const name = err && /** @type {any} */ (err).name;
    if (name === BROADCAST_FAILED_PERMANENT_NAME) return 'permanent';
    if (name === BROADCAST_FAILED_TRANSIENT_NAME) return 'transient';
    return null;
}

/**
 * @param {unknown} err   a BroadcastFailedError, an Error, or a raw reason string
 * @returns {'permanent' | 'transient'}
 */
export function classifyBroadcastFailure(err) {
    const reason = extractReason(err);
    for (const re of PERMANENT_PATTERNS) if (re.test(reason)) return 'permanent';
    for (const re of TRANSIENT_PATTERNS) if (re.test(reason)) return 'transient';
    // Ambiguous: keep the signed tx recoverable (see header rationale).
    return 'transient';
}

// Pull the most specific reject string out of the error shape. A
// BroadcastFailedError carries `cause` (the node/encoder error) and may
// carry a structured `rejectReason`; fall back to the message.
function extractReason(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    const parts = [];
    if (err.rejectReason) parts.push(String(err.rejectReason));
    if (err.code) parts.push(String(err.code));
    if (err.cause) {
        const c = err.cause;
        if (typeof c === 'string') parts.push(c);
        else {
            if (c.code) parts.push(String(c.code));
            if (c.message) parts.push(String(c.message));
            // Node RPC errors nest the reject string under response.data.error.
            const nested = c.response && c.response.data && c.response.data.error;
            if (nested) parts.push(typeof nested === 'string' ? nested : JSON.stringify(nested));
        }
    }
    if (err.message) parts.push(String(err.message));
    return parts.join(' ');
}

export { extractReason as _extractReason };
