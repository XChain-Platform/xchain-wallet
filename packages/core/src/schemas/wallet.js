// Wallet record — §11.3.1. Persists one entry per HD seed (or imported
// mnemonic / WIF-only wallet). Encrypted seed material is stored with the
// record; the master key that decrypts it is derived from the user's
// password via Argon2id (§11.4).

import {
    check,
    checkEach,
    isArray,
    isBoolean,
    isIsoTimestamp,
    isNonEmptyString,
    isNonNegativeInteger,
    isNull,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from './validate.js';
import { validateMultisigConfig } from './multisigConfig.js';

export const CURRENT_VERSION = 1;

export const WALLET_ORIGINS = /** @type {const} */ ([
    'created',
    'imported-mnemonic',
    'imported-wif',
    'imported-xchain-backup',
    'imported-freewallet',
]);

export const WALLET_FORMATS = /** @type {const} */ ([
    'bip39',
    'counterwallet-legacy',
]);

/**
 * @typedef {Object} KdfParams
 * @property {'argon2id'} algorithm
 * @property {string} salt            base64
 * @property {number} iterations
 * @property {number} memory
 * @property {number} parallelism
 */

/**
 * @typedef {Object} ImportedKey
 * @property {string} addressId       UUID of the corresponding Address
 * @property {string} encryptedWif    AES-256-GCM ciphertext, base64
 * @property {string} importedAt      ISO timestamp
 */

/**
 * @typedef {Object} Wallet
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {string} createdAt
 * @property {typeof WALLET_ORIGINS[number]} origin
 * @property {typeof WALLET_FORMATS[number]} format
 * @property {boolean} passphraseEnabled
 * @property {'aes-256-gcm'} encryptionAlgorithm
 * @property {string} encryptedSeed   base64 ciphertext
 * @property {KdfParams} kdfParams
 * @property {ImportedKey[]} importedKeys
 * @property {import('./multisigConfig.js').MultisigConfig | null} multisig
 */

/**
 * @param {Object} input
 * @param {string} input.name
 * @param {typeof WALLET_ORIGINS[number]} input.origin
 * @param {typeof WALLET_FORMATS[number]} input.format
 * @param {boolean} input.passphraseEnabled
 * @param {string} input.encryptedSeed
 * @param {KdfParams} input.kdfParams
 * @returns {Wallet}
 */
export function createWallet(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: crypto.randomUUID(),
        name: input.name,
        createdAt: new Date().toISOString(),
        origin: input.origin,
        format: input.format,
        passphraseEnabled: input.passphraseEnabled,
        encryptionAlgorithm: 'aes-256-gcm',
        encryptedSeed: input.encryptedSeed,
        kdfParams: input.kdfParams,
        importedKeys: [],
        multisig: null,
    };
}

const isKdfParams = (v) =>
    isPlainObject(v) &&
    v.algorithm === 'argon2id' &&
    isNonEmptyString(v.salt) &&
    isNonNegativeInteger(v.iterations) &&
    isNonNegativeInteger(v.memory) &&
    isNonNegativeInteger(v.parallelism);

const isImportedKey = (v) =>
    isPlainObject(v) &&
    isNonEmptyString(v.addressId) &&
    isNonEmptyString(v.encryptedWif) &&
    isIsoTimestamp(v.importedAt);

/**
 * @param {unknown} record
 * @returns {{ ok: true, errors: [] } | { ok: false, errors: string[] }}
 */
export function validateWallet(record) {
    const errors = [];
    if (!check(errors, 'wallet', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {Wallet} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'name', isNonEmptyString(r.name), 'must be a non-empty string');
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    check(errors, 'origin', isOneOf(r.origin, WALLET_ORIGINS), `must be one of ${WALLET_ORIGINS.join(', ')}`);
    check(errors, 'format', isOneOf(r.format, WALLET_FORMATS), `must be one of ${WALLET_FORMATS.join(', ')}`);
    check(errors, 'passphraseEnabled', isBoolean(r.passphraseEnabled), 'must be a boolean');
    check(errors, 'encryptionAlgorithm', r.encryptionAlgorithm === 'aes-256-gcm', 'must be "aes-256-gcm"');
    check(errors, 'encryptedSeed', isNonEmptyString(r.encryptedSeed), 'must be a non-empty string');
    check(errors, 'kdfParams', isKdfParams(r.kdfParams), 'malformed');
    checkEach(errors, 'importedKeys', r.importedKeys, isImportedKey, 'malformed');

    if (r.multisig !== null && !isNull(r.multisig)) {
        const m = validateMultisigConfig(r.multisig);
        if (!m.ok) m.errors.forEach((e) => errors.push(`multisig.${e}`));
    } else if (r.multisig !== null) {
        errors.push('multisig: must be null or a MultisigConfig');
    }

    return result(errors);
}
