// Account record — §11.3.2. A BIP44-style account under one Wallet seed.

import {
    check,
    isIsoTimestamp,
    isNonEmptyString,
    isNonNegativeInteger,
    isPlainObject,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 1;

/**
 * @typedef {Object} Account
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} name
 * @property {number} index
 * @property {string} createdAt
 */

/**
 * @param {Object} input
 * @param {string} input.walletId
 * @param {string} input.name
 * @param {number} input.index
 * @returns {Account}
 */
export function createAccount(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        name: input.name,
        index: input.index,
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
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    return result(errors);
}
