// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// ConnectedSite record — §11.3.5. Per-origin permissions for dApps that
// have called the bridge. Granularity matches the bridge-spec permissions
// model (@xchain-wallet/bridge-spec SitePermissions).

import { ACTION_PERMISSIONS } from './constants.js';
import {
    check,
    checkEach,
    isArray,
    isBoolean,
    isIsoTimestamp,
    isNonEmptyString,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 1;

/**
 * @typedef {Object} SitePermissions
 * @property {string[]} chains
 * @property {string[]} accounts
 * @property {boolean} canSignMessage
 * @property {Record<string, typeof ACTION_PERMISSIONS[number]>} canSignAction
 */

/**
 * @typedef {Object} SessionHistoryEntry
 * @property {string} timestamp
 * @property {string} action
 * @property {boolean} approved
 */

/**
 * @typedef {Object} ConnectedSite
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} origin
 * @property {string} appName
 * @property {string} appIcon
 * @property {string} connectedAt
 * @property {string} lastUsedAt
 * @property {SitePermissions} permissions
 * @property {SessionHistoryEntry[]} sessionHistory
 */

/**
 * @param {Object} input
 * @param {string} input.origin
 * @param {string} input.appName
 * @param {string} [input.appIcon]
 * @param {SitePermissions} input.permissions
 * @returns {ConnectedSite}
 */
export function createConnectedSite(input) {
    const now = new Date().toISOString();
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        origin: input.origin,
        appName: input.appName,
        appIcon: input.appIcon ?? '',
        connectedAt: now,
        lastUsedAt: now,
        permissions: input.permissions,
        sessionHistory: [],
    };
}

const isPermissions = (v) => {
    if (!isPlainObject(v)) return false;
    if (!isArray(v.chains) || !v.chains.every(isNonEmptyString)) return false;
    if (!isArray(v.accounts) || !v.accounts.every(isNonEmptyString)) return false;
    if (!isBoolean(v.canSignMessage)) return false;
    if (!isPlainObject(v.canSignAction)) return false;
    for (const [k, val] of Object.entries(v.canSignAction)) {
        if (!isNonEmptyString(k)) return false;
        if (!isOneOf(val, ACTION_PERMISSIONS)) return false;
    }
    return true;
};

const isSessionEntry = (v) =>
    isPlainObject(v) &&
    isIsoTimestamp(v.timestamp) &&
    isNonEmptyString(v.action) &&
    isBoolean(v.approved);

export function validateConnectedSite(record) {
    const errors = [];
    if (!check(errors, 'connectedSite', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {ConnectedSite} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'origin', isNonEmptyString(r.origin), 'must be a non-empty string');
    check(errors, 'appName', isNonEmptyString(r.appName), 'must be a non-empty string');
    check(errors, 'appIcon', isString(r.appIcon), 'must be a string');
    check(errors, 'connectedAt', isIsoTimestamp(r.connectedAt), 'must be an ISO timestamp');
    check(errors, 'lastUsedAt', isIsoTimestamp(r.lastUsedAt), 'must be an ISO timestamp');
    check(errors, 'permissions', isPermissions(r.permissions), 'malformed');
    checkEach(errors, 'sessionHistory', r.sessionHistory, isSessionEntry, 'malformed');
    return result(errors);
}
