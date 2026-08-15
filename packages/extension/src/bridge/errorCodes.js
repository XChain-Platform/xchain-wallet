// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Internal wallet error vocabulary -> published BridgeErrorCode.
//
// The bridge handlers speak a wallet-internal dialect: CHAIN_NOT_PERMITTED,
// ADDRESS_NOT_PERMITTED, MISSING_ORIGIN, NO_PASSWORD and nine more. None of
// those are in bridge-spec's `BridgeErrorCode` union, so a dApp following the
// spec's own instruction to "branch on `error` only" hit its default case for
// every one of them: the wallet's most common refusals - wrong chain, address
// out of scope, no connection - were indistinguishable from an unknown crash.
//
// The internal names are worth keeping. They are more precise than the
// published union (CHAIN_NOT_PERMITTED says the site was never granted this
// chain; CHAIN_NOT_SUPPORTED says the wallet cannot speak it at all) and they
// carry the diagnosis in the Developer-Mode log. So the wallet keeps its own
// vocabulary internally and translates once, at the boundary, exactly where a
// value stops being ours and becomes the page's.
//
// The mapping is deliberately lossy in one direction only: it widens. Every
// internal code lands on the published code whose dApp-side HANDLING is right,
// never on one that would send a dApp down a wrong recovery path. The full
// internal code stays in `message` (BridgeError formats it as
// `bridge: <INTERNAL_CODE> (detail)`), so a developer reading a log still sees
// which of the two CHAIN_* refusals fired.

import { isBridgeErrorCode } from '@xchain-wallet/bridge-spec';

/**
 * The twelve codes bridge handlers emit that the published union does not
 * contain, each mapped to the published code a dApp should act on.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const INTERNAL_TO_BRIDGE_ERROR_CODE = Object.freeze({
    // Malformed / incomplete request. All three mean the page sent a call the
    // wallet cannot even route, which is the dApp's bug to fix.
    MISSING_ORIGIN: 'INVALID_PARAMS',
    MISSING_CHAIN_ID: 'INVALID_PARAMS',
    MISSING_ADDRESS: 'INVALID_PARAMS',

    // Chain refusals. Both end the same way for a dApp: do not retry on this
    // chain, offer the user another one.
    UNKNOWN_CHAIN: 'CHAIN_NOT_SUPPORTED',
    CHAIN_NOT_PERMITTED: 'CHAIN_NOT_SUPPORTED',

    // Address refusals. ADDRESS_NOT_FOUND is "the vault holds no such address",
    // ADDRESS_NOT_PERMITTED is "it holds it but this site was not granted it";
    // from the page both mean "you may not use this address".
    ADDRESS_NOT_PERMITTED: 'ADDRESS_NOT_AUTHORIZED',
    ADDRESS_NOT_FOUND: 'ADDRESS_NOT_AUTHORIZED',

    // No co-signer account backs the aggregate address the agent named.
    UNKNOWN_COSIGNER_ACCOUNT: 'ACCOUNT_NOT_AUTHORIZED',

    // canSignAction[KIND] === 'never'. The user's standing answer is no, which
    // is a rejection, not a fault.
    ACTION_REJECTED_BY_POLICY: 'USER_REJECTED',

    // Shell contract violations: the approval surface returned `approved: true`
    // without the credentials it is required to carry, or a supported action
    // fell through the dispatch. These are wallet bugs, and INTERNAL_ERROR is
    // the honest thing to tell a page about a wallet bug.
    NO_PASSWORD: 'INTERNAL_ERROR',
    NO_CREDENTIALS: 'INTERNAL_ERROR',
    UNREACHABLE: 'INTERNAL_ERROR',
});

/**
 * Error CLASSES that carry no `code` of their own but whose identity already
 * names the outcome. Keyed by `err.name` because these cross package
 * boundaries (core flows, storage, signers) where `instanceof` is unreliable
 * once a bundler has been through them.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ERROR_NAME_TO_BRIDGE_ERROR_CODE = Object.freeze({
    UserRejectedError: 'USER_REJECTED',
    PanicModeActiveError: 'PANIC_MODE',
    VaultLockedError: 'WALLET_LOCKED',
    VaultClosedError: 'WALLET_LOCKED',
    SignerLockedError: 'WALLET_LOCKED',
    BroadcastFailedError: 'BROADCAST_FAILED',

    // Transport-level refusals raised by MessageHost BEFORE a handler is
    // found, so they never pass the handlers' own translation wrapper. Both
    // mean the page sent a call the wallet cannot even route, which is the
    // same thing INVALID_PARAMS tells a dApp about a malformed request.
    UnknownMessageTypeError: 'INVALID_PARAMS',
    InvalidMessageError: 'INVALID_PARAMS',
});

/**
 * Translate one code string into a published BridgeErrorCode.
 *
 * @param {unknown} code
 * @returns {string | null} the published code, or null when `code` is neither
 *   published nor a known internal name (the caller decides the fallback).
 */
export function toBridgeErrorCode(code) {
    if (isBridgeErrorCode(code)) return /** @type {string} */ (code);
    if (typeof code === 'string' && INTERNAL_TO_BRIDGE_ERROR_CODE[code]) {
        return INTERNAL_TO_BRIDGE_ERROR_CODE[code];
    }
    return null;
}

/**
 * The published BridgeErrorCode for any error a bridge handler can throw.
 *
 * Falls back to INTERNAL_ERROR rather than passing an unrecognized string
 * through: the whole point of the union is that a dApp can exhaustively switch
 * on it, and one leaked internal name re-opens the hole this closes.
 *
 * @param {unknown} err
 * @returns {string} a member of BRIDGE_ERROR_CODES
 */
export function bridgeErrorCodeFor(err) {
    if (!err || typeof err !== 'object') return 'INTERNAL_ERROR';
    const fromCode = toBridgeErrorCode(/** @type {any} */ (err).code);
    if (fromCode) return fromCode;
    const name = /** @type {any} */ (err).name;
    if (typeof name === 'string' && ERROR_NAME_TO_BRIDGE_ERROR_CODE[name]) {
        return ERROR_NAME_TO_BRIDGE_ERROR_CODE[name];
    }
    return 'INTERNAL_ERROR';
}

/**
 * The spec-shaped failure result for a thrown error: `{ ok: false, error,
 * message }` plus the THROTTLED hints when the error carries them.
 *
 * @param {unknown} err
 * @returns {{ ok: false, error: string, message?: string, retryAfterMs?: number, burst?: number, windowMs?: number }}
 */
export function bridgeErrorResult(err) {
    const any = /** @type {any} */ (err ?? {});
    /** @type {any} */
    const out = { ok: false, error: bridgeErrorCodeFor(err) };
    if (typeof any.message === 'string' && any.message) out.message = any.message;
    for (const field of ['retryAfterMs', 'burst', 'windowMs']) {
        if (typeof any[field] === 'number' && Number.isFinite(any[field])) {
            out[field] = any[field];
        }
    }
    return out;
}
