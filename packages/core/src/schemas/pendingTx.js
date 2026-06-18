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

export const CURRENT_VERSION = 1;

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
    };
}

const isNullableNonEmptyString = (v) => v === null || isNonEmptyString(v);
const isNullableString = (v) => v === null || isString(v);

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
    check(errors, 'toAddress', isNonEmptyString(r.toAddress), 'must be a non-empty string');
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
    return result(errors);
}
