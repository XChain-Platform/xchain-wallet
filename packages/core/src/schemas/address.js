// Address record — §11.3.3. One derived/imported/watch-only address.

import { ADDRESS_SOURCES, NETWORKS } from './constants.js';
import {
    check,
    isBoolean,
    isIsoTimestamp,
    isNonEmptyString,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from './validate.js';

export const CURRENT_VERSION = 1;

/**
 * @typedef {Object} Address
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string | null} accountId    null for watch-only / imported-WIF
 * @property {string} chain               coin identifier
 * @property {typeof NETWORKS[number]} network
 * @property {typeof ADDRESS_SOURCES[number]} source
 * @property {string} addressType         script format, e.g. 'p2wpkh'
 * @property {string | null} derivationPath null for imported/watch-only
 * @property {string} address
 * @property {string} publicKey           hex
 * @property {string} label
 * @property {boolean} pinned
 * @property {boolean} hidden
 * @property {string} createdAt
 */

/**
 * @param {Object} input
 * @param {string | null} input.accountId
 * @param {string} input.chain
 * @param {typeof NETWORKS[number]} input.network
 * @param {typeof ADDRESS_SOURCES[number]} input.source
 * @param {string} input.addressType
 * @param {string | null} input.derivationPath
 * @param {string} input.address
 * @param {string} input.publicKey
 * @param {string} [input.label]
 * @param {boolean} [input.pinned]
 * @param {boolean} [input.hidden]
 * @returns {Address}
 */
export function createAddress(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: crypto.randomUUID(),
        accountId: input.accountId,
        chain: input.chain,
        network: input.network,
        source: input.source,
        addressType: input.addressType,
        derivationPath: input.derivationPath,
        address: input.address,
        publicKey: input.publicKey,
        label: input.label ?? '',
        pinned: input.pinned ?? false,
        hidden: input.hidden ?? false,
        createdAt: new Date().toISOString(),
    };
}

export function validateAddress(record) {
    const errors = [];
    if (!check(errors, 'address', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {Address} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(
        errors,
        'accountId',
        r.accountId === null || isNonEmptyString(r.accountId),
        'must be null or a non-empty string',
    );
    check(errors, 'chain', isNonEmptyString(r.chain), 'must be a non-empty string');
    check(errors, 'network', isOneOf(r.network, NETWORKS), `must be one of ${NETWORKS.join(', ')}`);
    check(errors, 'source', isOneOf(r.source, ADDRESS_SOURCES), `must be one of ${ADDRESS_SOURCES.join(', ')}`);
    check(errors, 'addressType', isNonEmptyString(r.addressType), 'must be a non-empty string');
    check(
        errors,
        'derivationPath',
        r.derivationPath === null || isNonEmptyString(r.derivationPath),
        'must be null or a non-empty string',
    );
    check(errors, 'address', isNonEmptyString(r.address), 'must be a non-empty string');
    check(errors, 'publicKey', isNonEmptyString(r.publicKey), 'must be a non-empty string');
    check(errors, 'label', isString(r.label), 'must be a string');
    check(errors, 'pinned', isBoolean(r.pinned), 'must be a boolean');
    check(errors, 'hidden', isBoolean(r.hidden), 'must be a boolean');
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    return result(errors);
}
