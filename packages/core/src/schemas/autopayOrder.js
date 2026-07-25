// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AutopayOrder record (PC-16, COINPAY.md / ORDER.md). One row per
// coin-GIVE order the user opted into CoinPay auto-pay for, written at
// placement time by orderAction. The record IS the trust anchor: every
// auto-payment is capped against the terms stored here (GIVE-side
// total, price ratio), never against indexer-reported values alone, so
// a compromised API can at worst drain up to the sum of these stored
// GIVE totals (the stated PC-16 residual) and never more.
//
// Keyed by `${chainId}::${txid}` because the order's action_index does
// not exist until the ORDER is indexed; the engine resolves and
// backfills `orderActionIndex` from the txid on a later cycle.
//
// `payments` is the cumulative-cap ledger: one entry per ORDER_MATCH
// this wallet auto-paid. The engine refuses a second payment for a
// match already listed here, and refuses any payment that would push
// the payments total past `giveCoinAmount`.
//
// Consent scope note: vaults are strictly per-shell at HEAD (no synced
// wallet state exists), so this record is readable only by the shell
// that placed the order, which is therefore the only shell that can
// ever act as its payer. Cross-shell payer migration waits on a sync
// layer.

import {
    check,
    checkEach,
    isBoolean,
    isIsoTimestamp,
    isNonEmptyString,
    isNull,
    isPlainObject,
    result,
} from './validate.js';

export const CURRENT_VERSION = 1;

/** Positive decimal amount string, e.g. "0.05" / "1000". */
const isDecimalAmount = (v) =>
    typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) && /[1-9]/.test(v);

/** Integer base-unit amount string (satoshi-scale), e.g. "5000000". */
const isBaseUnitAmount = (v) =>
    typeof v === 'string' && /^\d+$/.test(v) && /[1-9]/.test(v);

/**
 * @typedef {Object} AutopayPayment
 * @property {string} orderMatchActionIndex  ORDER_MATCH this payment settled
 * @property {string} coinAmountBase         native coin paid, base units (exact integer string)
 * @property {string} txid                   the COINPAY transaction
 * @property {string} at                     ISO timestamp of the broadcast
 */

/**
 * @typedef {Object} AutopayOrder
 * @property {1} schemaVersion
 * @property {string} id                 canonical `${chainId}::${txid}`
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} sourceAddress      the order's source = obligation payer; auto-pay signs this address only
 * @property {string} txid               ORDER placement transaction
 * @property {string | null} orderActionIndex  backfilled once the ORDER is indexed
 * @property {string} giveCoinAmount     order's total GIVE-side native amount, decimal string (hard cumulative cap)
 * @property {string} getTick            token requested in return
 * @property {string} getAmount          total GET-side token amount, decimal string (price-ratio denominator)
 * @property {boolean} autopay           consent flag; false = notify-only (revocable any time, no transaction)
 * @property {AutopayPayment[]} payments cumulative-cap ledger, one entry per auto-paid match
 * @property {string} createdAt
 */

/** Canonical id so puts are idempotent per (chain, placement tx). */
export function autopayOrderId({ chainId, txid }) {
    return `${chainId}::${String(txid).toLowerCase()}`;
}

/**
 * @param {Object} input
 * @param {string} input.walletId
 * @param {string} input.chainId
 * @param {string} input.sourceAddress
 * @param {string} input.txid
 * @param {string} input.giveCoinAmount
 * @param {string} input.getTick
 * @param {string} input.getAmount
 * @param {boolean} [input.autopay]
 * @returns {AutopayOrder}
 */
export function createAutopayOrder(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: autopayOrderId(input),
        walletId: input.walletId,
        chainId: input.chainId,
        sourceAddress: input.sourceAddress,
        txid: String(input.txid).toLowerCase(),
        orderActionIndex: null,
        giveCoinAmount: input.giveCoinAmount,
        getTick: String(input.getTick).toUpperCase(),
        getAmount: input.getAmount,
        autopay: input.autopay !== false,
        payments: [],
        createdAt: new Date().toISOString(),
    };
}

export function validateAutopayOrder(record) {
    const errors = [];
    if (!check(errors, 'autopayOrder', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {AutopayOrder} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(errors, 'chainId', isNonEmptyString(r.chainId), 'must be a non-empty string');
    check(errors, 'sourceAddress', isNonEmptyString(r.sourceAddress), 'must be a non-empty string');
    check(errors, 'txid', isNonEmptyString(r.txid), 'must be a non-empty string');
    check(errors, 'orderActionIndex',
        isNull(r.orderActionIndex) || isNonEmptyString(r.orderActionIndex),
        'must be null or a non-empty string');
    // The two term amounts are the cap inputs: enforce exact decimal-string
    // shape here so cap math never sees a Number (precision) or garbage.
    check(errors, 'giveCoinAmount', isDecimalAmount(r.giveCoinAmount),
        'must be a positive decimal amount string');
    check(errors, 'getTick', isNonEmptyString(r.getTick), 'must be a non-empty string');
    check(errors, 'getAmount', isDecimalAmount(r.getAmount),
        'must be a positive decimal amount string');
    check(errors, 'autopay', isBoolean(r.autopay), 'must be a boolean');
    if (check(errors, 'payments', Array.isArray(r.payments), 'must be an array')) {
        checkEach(errors, 'payments', r.payments, (p) =>
            isPlainObject(p) &&
            isNonEmptyString(p.orderMatchActionIndex) &&
            isBaseUnitAmount(p.coinAmountBase) &&
            isNonEmptyString(p.txid) &&
            isIsoTimestamp(p.at),
        'each entry must be {orderMatchActionIndex, coinAmountBase, txid, at}');
    }
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    return result(errors);
}
