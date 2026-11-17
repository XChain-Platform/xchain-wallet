// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The two batch history reads Home's value chart replays balances from:
//
//   POST /{COIN}/api/history         every action of up to 20 addresses, one
//                                    merged page newest first, each action
//                                    carrying what it did to each requested
//                                    address's balance of each token (base units)
//   POST /{COIN}/api/native_history  the coin's own confirmed transactions for
//                                    up to 20 addresses, passed through to the
//                                    chain's UTXO tracker
//
// One call serves up to 20 addresses, so a wallet's reads grow with its
// address count over 20 and its pages, never per address or per row. The
// installed SDK predates both routes: a later SDK that carries
// getHistoryBatch / getNativeHistoryBatch is used as it is, and otherwise the
// read goes through the SDK's own explorer transport (sdk.explorer.post), so
// it keeps the SDK's retry policy, hooks and typed errors.
//
// An explorer without the route answers an unknown POST with a JSON-RPC
// error object at HTTP 200 (see the SDK's assertBatchBody), so a body without
// the route's own fields is refused here as EXPLORER_BATCH_UNSUPPORTED rather
// than read as an empty history.

/** Addresses one batch read carries (the explorer refuses more). */
export const WALLET_HISTORY_BATCH_MAX = 20;
/** Actions per /history page (the explorer's ceiling). */
export const WALLET_HISTORY_PAGE_LIMIT = 100;

const HISTORY_FIELDS = ['before', 'since', 'until', 'limit'];
const NATIVE_FIELDS = ['cursor', 'from_height', 'to_height', 'from_time', 'to_time', 'limit'];

function unsupported(path, body) {
    const err = new Error(`Explorer does not serve ${path}: the answer is not that route's shape`);
    err.name = 'SDKExplorerError';
    /** @type {any} */ (err).code = 'EXPLORER_BATCH_UNSUPPORTED';
    /** @type {any} */ (err).data = body && typeof body === 'object' ? { error: body.error ?? null } : null;
    return err;
}

function checkAddresses(name, addresses) {
    if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new Error(`${name}: addresses must be a non-empty array`);
    }
    if (addresses.length > WALLET_HISTORY_BATCH_MAX) {
        throw new Error(`${name}: at most ${WALLET_HISTORY_BATCH_MAX} addresses per read`);
    }
    for (const address of addresses) {
        if (typeof address !== 'string' || address.length === 0 || address.length > 128) {
            throw new Error(`${name}: every address must be a non-empty string`);
        }
    }
}

function pick(source, fields) {
    const out = {};
    for (const field of fields) {
        const value = source?.[field];
        if (value === undefined || value === null || value === '') continue;
        if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) continue;
        if (typeof value !== 'number' && typeof value !== 'string') continue;
        out[field] = value;
    }
    return out;
}

function sdkFor(name, sdkRegistry, chainId) {
    if (!sdkRegistry) throw new Error(`${name}: sdkRegistry is required`);
    if (!chainId || typeof chainId !== 'string') throw new Error(`${name}: chainId is required`);
    const sdk = sdkRegistry.get(chainId);
    if (!sdk) throw new Error(`${name}: SDK unavailable for "${chainId}"`);
    return sdk;
}

// The SDK's explorer transport, the way its own batch read reaches it: through
// requireExplorer() when the SDK has it, so an SDK without an explorer fails
// with its own EXPLORER_NOT_CONFIGURED rather than reading as an old explorer.
function explorerOf(sdk) {
    if (typeof sdk.requireExplorer === 'function') return sdk.requireExplorer();
    return sdk.explorer || null;
}

/**
 * One page of the wallet's merged token history: POST /history.
 *
 * @param {object} args
 * @param {any} args.sdkRegistry
 * @param {string} args.chainId
 * @param {string[]} args.addresses             1 to 20
 * @param {string | number} [args.before]       the previous page's next_cursor
 * @param {number} [args.since]                 unix seconds
 * @param {number} [args.until]                 unix seconds
 * @param {number} [args.limit]                 1 to 100
 * @returns {Promise<{ amount_unit: 'base', addresses: string[], next_cursor: string | null, actions: any[] }>}
 */
export async function walletHistoryBatch({ sdkRegistry, chainId, addresses, ...query }) {
    checkAddresses('walletHistoryBatch', addresses);
    const sdk = sdkFor('walletHistoryBatch', sdkRegistry, chainId);
    const body = { addresses, ...pick(query, HISTORY_FIELDS) };
    let answer;
    if (typeof sdk.getHistoryBatch === 'function') {
        answer = await sdk.getHistoryBatch(addresses, pick(query, HISTORY_FIELDS));
    } else {
        const explorer = explorerOf(sdk);
        if (typeof explorer?.post !== 'function') throw unsupported('/history', null);
        answer = await explorer.post('/history', body, { noRetry: true });
    }
    if (!answer || typeof answer !== 'object' || !Array.isArray(answer.actions) || answer.amount_unit !== 'base') {
        throw unsupported('/history', answer);
    }
    return answer;
}

/**
 * One page of the wallet's native coin history: POST /native_history.
 *
 * @param {object} args
 * @param {any} args.sdkRegistry
 * @param {string} args.chainId
 * @param {string[]} args.addresses             1 to 20
 * @param {string} [args.cursor]                the previous page's cursor
 * @param {number} [args.from_height]
 * @param {number} [args.to_height]
 * @param {number} [args.from_time]             unix seconds
 * @param {number} [args.to_time]               unix seconds
 * @param {number} [args.limit]
 * @returns {Promise<{ transactions: any[], cursor: string | null, history_from_height: number | null, sync?: any }>}
 */
export async function walletNativeHistoryBatch({ sdkRegistry, chainId, addresses, ...query }) {
    checkAddresses('walletNativeHistoryBatch', addresses);
    const sdk = sdkFor('walletNativeHistoryBatch', sdkRegistry, chainId);
    const fields = pick(query, NATIVE_FIELDS);
    let answer;
    if (typeof sdk.getNativeHistoryBatch === 'function') {
        answer = await sdk.getNativeHistoryBatch(addresses, fields);
    } else {
        const explorer = explorerOf(sdk);
        if (typeof explorer?.post !== 'function') throw unsupported('/native_history', null);
        answer = await explorer.post('/native_history', { addresses, ...fields }, { noRetry: true });
    }
    if (!answer || typeof answer !== 'object' || !Array.isArray(answer.transactions)) {
        throw unsupported('/native_history', answer);
    }
    return answer;
}
