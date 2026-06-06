// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// PendingAirdrop record — §40.9. Crash-safe state for the AIRDROP
// two-transaction flow so the user can close the wallet between stages
// and resume. One record per in-flight airdrop:
//
//   stage = 'waiting-index'   — LIST signed + broadcast; polling for
//                               the ACTION_INDEX assignment.
//   stage = 'ready-to-airdrop' — ACTION_INDEX resolved; user needs to
//                                sign the AIRDROP.
//   stage = 'done'            — both tx broadcast; kept briefly so the
//                               success screen can render if the user
//                               returns. Home / resume surface filters
//                               'done' records and may clear on read.
//
// Recipients is stored verbatim (the already-de-duped, already-
// validated list the user pasted), so the stage-5 review is
// reproducible after a restart without re-parsing.

import {
    check,
    isArray,
    isIsoTimestamp,
    isNonEmptyString,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 1;

export const PENDING_AIRDROP_STAGES = /** @type {const} */ ([
    'waiting-index',
    'ready-to-airdrop',
    'done',
]);

/**
 * @typedef {Object} PendingAirdrop
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} fromAddress
 * @property {string} token
 * @property {string} amountPer
 * @property {string[]} recipients
 * @property {string} listTxid
 * @property {string | null} listActionIndex
 * @property {string | null} airdropTxid
 * @property {typeof PENDING_AIRDROP_STAGES[number]} stage
 * @property {string} createdAt
 * @property {string | null} memo
 */

/**
 * @param {Object} input
 * @param {string} input.walletId
 * @param {string} input.chainId
 * @param {string} input.fromAddress
 * @param {string} input.token
 * @param {string} input.amountPer
 * @param {string[]} input.recipients
 * @param {string} input.listTxid
 * @param {string} [input.memo]
 * @returns {PendingAirdrop}
 */
export function createPendingAirdrop(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        chainId: input.chainId,
        fromAddress: input.fromAddress,
        token: input.token,
        amountPer: input.amountPer,
        recipients: [...input.recipients],
        listTxid: input.listTxid,
        listActionIndex: null,
        airdropTxid: null,
        stage: 'waiting-index',
        createdAt: new Date().toISOString(),
        memo: input.memo ?? null,
    };
}

const isNullableNonEmptyString = (v) => v === null || isNonEmptyString(v);
const isNullableString = (v) => v === null || isString(v);

export function validatePendingAirdrop(record) {
    const errors = [];
    if (!check(errors, 'pendingAirdrop', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {PendingAirdrop} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(errors, 'chainId', isNonEmptyString(r.chainId), 'must be a non-empty string');
    check(errors, 'fromAddress', isNonEmptyString(r.fromAddress), 'must be a non-empty string');
    check(errors, 'token', isNonEmptyString(r.token), 'must be a non-empty string');
    check(errors, 'amountPer', isNonEmptyString(r.amountPer), 'must be a non-empty string');
    check(
        errors,
        'recipients',
        isArray(r.recipients) && r.recipients.length > 0 && r.recipients.every(isNonEmptyString),
        'must be a non-empty array of non-empty strings',
    );
    check(errors, 'listTxid', isNonEmptyString(r.listTxid), 'must be a non-empty string');
    check(errors, 'listActionIndex', isNullableNonEmptyString(r.listActionIndex), 'must be null or a non-empty string');
    check(errors, 'airdropTxid', isNullableNonEmptyString(r.airdropTxid), 'must be null or a non-empty string');
    check(errors, 'stage', isOneOf(r.stage, PENDING_AIRDROP_STAGES), `must be one of ${PENDING_AIRDROP_STAGES.join(', ')}`);
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    check(errors, 'memo', isNullableString(r.memo), 'must be null or a string');
    return result(errors);
}
