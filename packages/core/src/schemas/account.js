// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Account record (§11.3.2). A BIP44-style account under one Wallet seed.
//
// v2 adds `activeAddressByChainId`: the single active (operating) address
// per chain for this account, the one Home shows the balance for and that
// actions (Send) run against. It is a SPARSE map of user overrides keyed by
// chainId; an absent entry means "use the default" (the lowest-index HD
// receive address for that chain), so fresh installs need no write. v1
// records migrate forward with an empty map.

import {
    check,
    isIsoTimestamp,
    isNonEmptyString,
    isNonNegativeInteger,
    isPlainObject,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 2;

/**
 * @typedef {Object} Account
 * @property {2} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} name
 * @property {number} index
 * @property {Record<string, string>} activeAddressByChainId   sparse chainId -> active addressId overrides (§11.3.2 v2)
 * @property {string} createdAt
 */

/**
 * @param {Object} input
 * @param {string} input.walletId
 * @param {string} input.name
 * @param {number} input.index
 * @param {Record<string, string>} [input.activeAddressByChainId]
 * @returns {Account}
 */
export function createAccount(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        name: input.name,
        index: input.index,
        activeAddressByChainId: input.activeAddressByChainId ?? {},
        createdAt: new Date().toISOString(),
    };
}

export function validateAccount(record) {
    const errors = [];
    if (!check(errors, 'account', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {Account} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(errors, 'name', isNonEmptyString(r.name), 'must be a non-empty string');
    check(errors, 'index', isNonNegativeInteger(r.index), 'must be a non-negative integer');
    check(errors, 'activeAddressByChainId', isPlainObject(r.activeAddressByChainId), 'must be an object');
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    return result(errors);
}
