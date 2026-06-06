// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// WatchlistEntry record — §41.2. One row per market the user pinned to
// their DEX watchlist. Per-wallet (walletId), per-chain (chainId —
// XChain markets never cross chains; each listing lives on a specific
// native chain). tick1 is conventionally the tick, tick2 the quote
// (e.g. `{tick1: 'MYTOKEN', tick2: 'BTC'}` for MYTOKEN/BTC).
//
// The record is tiny by design: the wallet re-queries explorer for
// last price / depth on render. Persisting cached market data here
// would just bit-rot.

import {
    check,
    isIsoTimestamp,
    isNonEmptyString,
    isPlainObject,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 1;

/**
 * @typedef {Object} WatchlistEntry
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} tick1
 * @property {string} tick2
 * @property {string} createdAt
 */

/**
 * @param {Object} input
 * @param {string} input.walletId
 * @param {string} input.chainId
 * @param {string} input.tick1
 * @param {string} input.tick2
 * @returns {WatchlistEntry}
 */
export function createWatchlistEntry(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        chainId: input.chainId,
        tick1: input.tick1,
        tick2: input.tick2,
        createdAt: new Date().toISOString(),
    };
}

export function validateWatchlistEntry(record) {
    const errors = [];
    if (!check(errors, 'watchlistEntry', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {WatchlistEntry} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(errors, 'chainId', isNonEmptyString(r.chainId), 'must be a non-empty string');
    check(errors, 'tick1', isNonEmptyString(r.tick1), 'must be a non-empty string');
    check(errors, 'tick2', isNonEmptyString(r.tick2), 'must be a non-empty string');
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    return result(errors);
}

/** Canonical key so callers can dedupe without importing the comparator. */
export function watchlistEntryKey(entry) {
    return `${entry.chainId}::${entry.tick1}::${entry.tick2}`;
}
