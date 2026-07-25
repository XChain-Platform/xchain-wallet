// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PendingTx record (§11.3.8): in-flight or recently confirmed transaction
// state. Drives the tx status timeline (§28.4) and RBF/cancel UX (§44.4).

import { NETWORKS } from './constants.js';
import {
    check,
    isIsoTimestamp,
    isNonEmptyString,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';

// v2 : additive structured amount fields. The pre-flight
// pending-delta machinery (§4.7) needs the tick + amount a pending tx
// will move, not just a human-readable summary string, so a concurrent
// approval window can net them against the fetched balance.
export const CURRENT_VERSION = 2;

export const PENDING_TX_STATUSES = /** @type {const} */ ([
    'composing',
    'awaiting-signature',
    'signed',
    'queued',
    'broadcasting',
    'broadcast',
    'indexed',
    'failed',
    'rbf-replaced',
]);

/**
 * @typedef {Object} PendingTx
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} chain
 * @property {typeof NETWORKS[number]} network
 * @property {string} fromAddress
 * @property {string} toAddress
 * @property {string} action
 * @property {string} actionSummary
 * @property {string} psbtHex
 * @property {string | null} txHex
 * @property {string | null} txid
 * @property {typeof PENDING_TX_STATUSES[number]} status
 * @property {string} createdAt
 * @property {string | null} broadcastAt
 * @property {string | null} confirmedAt
 * @property {string | null} rbfReplacement
 * @property {string | null} error
 * @property {string | null} [tick]     v2: the token this tx moves (null for native-only / multi-tick)
 * @property {string | null} [amount]   v2: decimal-string amount moved (NEVER a JS number, §4.5)
 * @property {object | null} [params]   v2: raw action params snapshot (optional)
 */

/**
 * @param {Object} input
 * @param {string} input.chain
 * @param {typeof NETWORKS[number]} input.network
 * @param {string} input.fromAddress
 * @param {string} input.toAddress
 * @param {string} input.action
 * @param {string} input.actionSummary
 * @param {string} input.psbtHex
 * @param {string} [input.tick]     v2: token moved (optional)
 * @param {string} [input.amount]   v2: decimal-string amount moved (optional)
 * @param {object} [input.params]   v2: raw action params snapshot (optional)
 * @returns {PendingTx}
 */
export function createPendingTx(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        chain: input.chain,
        network: input.network,
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        action: input.action,
        actionSummary: input.actionSummary,
        psbtHex: input.psbtHex,
        txHex: null,
        txid: null,
        status: 'composing',
        createdAt: new Date().toISOString(),
        broadcastAt: null,
        confirmedAt: null,
        rbfReplacement: null,
        error: null,
        // v2 structured amount (undefined-tolerant readers; null when the
        // caller didn't supply it, e.g. multi-tick or native-only actions).
        tick: input.tick === undefined ? null : String(input.tick),
        amount: input.amount === undefined || input.amount === null ? null : String(input.amount),
        params: input.params === undefined ? null : input.params,
    };
}

const isNullableNonEmptyString = (v) => v === null || isNonEmptyString(v);
const isNullableString = (v) => v === null || isString(v);
const isNullableObject = (v) => v === null || (typeof v === 'object');

export function validatePendingTx(record) {
    const errors = [];
    if (!check(errors, 'pendingTx', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {PendingTx} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'chain', isNonEmptyString(r.chain), 'must be a non-empty string');
    check(errors, 'network', isOneOf(r.network, NETWORKS), `must be one of ${NETWORKS.join(', ')}`);
    check(errors, 'fromAddress', isNonEmptyString(r.fromAddress), 'must be a non-empty string');
    // toAddress is null for data-only actions with no recipient (ISSUE, DESTROY,
    // STAKE, VOTE, AIRDROP, LINK, advancedAction, contract funds, ...); every
    // such flow passes `toAddress: null`. Only recipient-bearing actions (SEND,
    // sweep, coinpay) carry an address. Allow null; still reject empty string.
    check(errors, 'toAddress', isNullableNonEmptyString(r.toAddress), 'must be null or a non-empty string');
    check(errors, 'action', isNonEmptyString(r.action), 'must be a non-empty string');
    check(errors, 'actionSummary', isString(r.actionSummary), 'must be a string');
    check(errors, 'psbtHex', isString(r.psbtHex), 'must be a string');
    check(errors, 'txHex', isNullableString(r.txHex), 'must be null or a string');
    check(errors, 'txid', isNullableNonEmptyString(r.txid), 'must be null or a non-empty string');
    check(errors, 'status', isOneOf(r.status, PENDING_TX_STATUSES), `must be one of ${PENDING_TX_STATUSES.join(', ')}`);
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    check(
        errors,
        'broadcastAt',
        r.broadcastAt === null || isIsoTimestamp(r.broadcastAt),
        'must be null or an ISO timestamp',
    );
    check(
        errors,
        'confirmedAt',
        r.confirmedAt === null || isIsoTimestamp(r.confirmedAt),
        'must be null or an ISO timestamp',
    );
    check(errors, 'rbfReplacement', isNullableNonEmptyString(r.rbfReplacement), 'must be null or a non-empty string');
    check(errors, 'error', isNullableString(r.error), 'must be null or a string');
    // v2 additive fields: present (possibly null) on migrated + new records.
    check(errors, 'tick', r.tick === undefined || isNullableString(r.tick), 'must be null or a string');
    check(errors, 'amount', r.amount === undefined || isNullableString(r.amount), 'must be null or a string');
    check(errors, 'params', r.params === undefined || isNullableObject(r.params), 'must be null or an object');
    return result(errors);
}
