// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// encoderErrorCode: reads which SDK encoder failure an error is, and whether the
// wallet has its own sentence for it, with no copy or formatting imports. The
// web initial bundle reaches it through userFacingMessage, so it stays light;
// the sentences live in encoderErrors.js.

import { hasEncoderFieldError } from './encoderFieldMatch.js';

// Match the encoder's own wording for NO_UTXOS / UTXO_TRACKER_STALE, which it
// forwards as an ENCODER_RPC_ERROR carrying the code in `data.reason` (the SDK
// pre-check wording is above). Stale patterns miss HALTED/NOT_READY and SYNC_MISSING.
const ENCODER_REASON_WORDING = [
    [/no utxos were provided and no utxos found on the blockchain/i, 'NO_UTXOS'],
    [/utxo-tracker view is stale\b/i, 'UTXO_TRACKER_STALE'],
    [/utxo-tracker did not assert that it is synced\b/i, 'UTXO_TRACKER_STALE'],
];
const LIFTED_RPC_REASONS = new Set(ENCODER_REASON_WORDING.map(([, code]) => code));

// A code recovered from the developer-facing message, for the boundary-crossed
// case where `err.code` is gone. Ordered most-specific first; ENCODER_HTTP_*
// carries its status through the capture group.
const MESSAGE_TO_CODE = [
    [/no spendable UTXOs found for the funding address/i, 'NO_UTXOS'],
    [/utxo-tracker view is not synced/i, 'UTXO_TRACKER_STALE'],
    ...ENCODER_REASON_WORDING,
    [/requires pubkey/i, 'MISSING_PUBKEY'],
    [/requires p2shHash/i, 'MISSING_P2SH_HASH'],
    [/requires p2shHex/i, 'MISSING_P2SH_HEX'],
    [/requires txHex/i, 'MISSING_TX_HEX'],
    [/getUTXOs requires address/i, 'MISSING_ADDRESS'],
    [/createTx requires data \(ACTION string\)/i, 'MISSING_DATA'],
    [/Encoder request timed out/i, 'ENCODER_TIMEOUT'],
    [/Encoder request failed:/i, 'ENCODER_NETWORK'],
    [/Encoder returned HTTP (\d{3})/i, 'ENCODER_HTTP_$1'],
    [/Encoder RPC error:/i, 'ENCODER_RPC_ERROR'],
];

// Codes that mean "this request was malformed before it ever left the wallet".
// A user cannot act on any of them; the honest sentence says so and asks for a
// report rather than implying they typed something wrong.
export const WALLET_BUG_CODES = new Set([
    'MISSING_PUBKEY', 'MISSING_ADDRESS', 'MISSING_DATA',
    'MISSING_TX_HEX', 'MISSING_P2SH_HASH', 'MISSING_P2SH_HEX',
]);

/**
 * The SDK encoder error code, however the error reached us.
 *
 * @param {unknown} err
 * @returns {string|null}   null when this is not a recognisable encoder error
 */
export function encoderErrorCode(err) {
    if (!err || typeof err !== 'object') return null;
    const e = /** @type {any} */ (err);
    const code = typeof e.code === 'string' ? e.code : '';
    if (code === 'ENCODER_RPC_ERROR') return liftedRpcReason(e) || code;
    // A raw axios/network error also has a `code` (ECONNABORTED, ENOTFOUND);
    // only codes the SDK actually mints count, so those fall through to the
    // message match and, failing that, to null.
    if (code && (WALLET_BUG_CODES.has(code) || code === 'NO_UTXOS' || code === 'UTXO_TRACKER_STALE'
        || code.startsWith('ENCODER_'))) {
        return code;
    }
    const message = String(e.message || '');
    // The SDK's rate-limit class is one class for two services, and its code
    // (`RATE_LIMITED`) names neither, so it is claimed here only when the error
    // says the ENCODER refused: the `service` field in-process, or the message
    // prefix across the messaging boundary, which the loop below matches. It
    // maps onto the existing 429 code so one branch serves both SDK vintages.
    if ((code === 'RATE_LIMITED' || e.name === 'SDKRateLimitedError') && e.service === 'encoder') {
        return 'ENCODER_HTTP_429';
    }
    for (const [pattern, mapped] of MESSAGE_TO_CODE) {
        const m = pattern.exec(message);
        if (m) return mapped.replace('$1', m[1] || '');
    }
    return null;
}

/**
 * True when `encoderErrorMessage` has the wallet's own sentence for this encoder
 * refusal: an empty funding address, a lagging spendable-balance tracker, or a
 * fee field under the relay floor. A refusal with no such sentence stays false,
 * so the node's own verdict can still be shown as written.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function hasWalletEncoderCopy(err) {
    const code = encoderErrorCode(err);
    if (code === 'NO_UTXOS' || code === 'UTXO_TRACKER_STALE') return true;
    return code === 'ENCODER_RPC_ERROR' && hasEncoderFieldError(err);
}

/**
 * NO_UTXOS / UTXO_TRACKER_STALE carried inside an in-process ENCODER_RPC_ERROR.
 *
 * Reads the same three spellings `insufficientFundsQuote` (flows/maxSendable.js)
 * does, then the encoder's own wording for an SDK build that attached no data.
 *
 * @param {any} e
 * @returns {string|null}
 */
function liftedRpcReason(e) {
    for (const data of [e.details?.context, e.details?.rpcError?.data, e.data]) {
        if (data && typeof data === 'object' && LIFTED_RPC_REASONS.has(data.reason)) return data.reason;
    }
    const message = String(e.message || '');
    const hit = ENCODER_REASON_WORDING.find(([pattern]) => pattern.test(message));
    return hit ? hit[1] : null;
}
