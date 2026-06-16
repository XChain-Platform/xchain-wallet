// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PriceAlert record — §46 price-alert delivery. One row per "notify me
// when {chain} goes {above|below} {targetFiat}" the user armed. Per-wallet
// (walletId), per-chain (chainId — a native-coin chain that has price data,
// i.e. a mainnet entry in priceOracle's COINGECKO_ID_BY_CHAIN).
//
// One-shot by design: an `armed` alert fires once when its threshold is
// satisfied, then flips to `triggered` (records `triggeredAt`) so the
// background PriceAlertWatcher never re-fires it. The user re-arms or
// deletes a triggered alert from the manager UI.
//
// The record carries no price history — the watcher re-queries the live
// price each poll. `targetFiat` is the threshold in `fiatCurrency` (the
// user's display currency at creation time).

import {
    check,
    isIsoTimestamp,
    isNonEmptyString,
    isNull,
    isNumber,
    isOneOf,
    isPlainObject,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 1;

export const PRICE_ALERT_DIRECTIONS = /** @type {const} */ (['above', 'below']);
export const PRICE_ALERT_STATUSES = /** @type {const} */ (['armed', 'triggered']);

/**
 * @typedef {Object} PriceAlert
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} chainId
 * @property {'above' | 'below'} direction
 * @property {number} targetFiat            threshold price in fiatCurrency
 * @property {string} fiatCurrency          e.g. 'usd'
 * @property {'armed' | 'triggered'} status
 * @property {string} createdAt
 * @property {string | null} triggeredAt    ISO timestamp the alert fired, or null while armed
 */

/**
 * @param {Object} input
 * @param {string} input.walletId
 * @param {string} input.chainId
 * @param {'above' | 'below'} input.direction
 * @param {number} input.targetFiat
 * @param {string} input.fiatCurrency
 * @returns {PriceAlert}
 */
export function createPriceAlert(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        chainId: input.chainId,
        direction: input.direction,
        targetFiat: input.targetFiat,
        fiatCurrency: String(input.fiatCurrency || 'usd').toLowerCase(),
        status: 'armed',
        createdAt: new Date().toISOString(),
        triggeredAt: null,
    };
}

export function validatePriceAlert(record) {
    const errors = [];
    if (!check(errors, 'priceAlert', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {PriceAlert} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(errors, 'chainId', isNonEmptyString(r.chainId), 'must be a non-empty string');
    check(errors, 'direction', isOneOf(r.direction, PRICE_ALERT_DIRECTIONS), `must be one of ${PRICE_ALERT_DIRECTIONS.join(', ')}`);
    check(errors, 'targetFiat', isNumber(r.targetFiat) && r.targetFiat > 0, 'must be a positive number');
    check(errors, 'fiatCurrency', isNonEmptyString(r.fiatCurrency), 'must be a non-empty string');
    check(errors, 'status', isOneOf(r.status, PRICE_ALERT_STATUSES), `must be one of ${PRICE_ALERT_STATUSES.join(', ')}`);
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    check(errors, 'triggeredAt', isNull(r.triggeredAt) || isIsoTimestamp(r.triggeredAt), 'must be null or an ISO timestamp');
    return result(errors);
}

/** Canonical key so callers can dedupe without importing the comparator. */
export function priceAlertKey(alert) {
    return `${alert.chainId}::${alert.direction}::${alert.targetFiat}`;
}
