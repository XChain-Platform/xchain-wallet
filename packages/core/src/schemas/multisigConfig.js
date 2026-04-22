// MultisigConfig — §11.3.6. Reserved in Phase 1; implemented in Phase 4.
// Data-model slot exists now so migrations are not needed when multisig
// ships. No factory exported yet — Phase 4 will add one.

import {
    check,
    checkEach,
    isNonEmptyString,
    isNonNegativeInteger,
    isOneOf,
    isPlainObject,
    result,
} from './validate.js';

export const CURRENT_VERSION = 1;

export const MULTISIG_SCHEMES = /** @type {const} */ ([
    'p2sh-multisig',
    'p2wsh-multisig',
    'taproot-musig2',
]);

export const COSIGNER_ORIGINS = /** @type {const} */ ([
    'local',
    'external-xpub',
    'hardware',
]);

/**
 * @typedef {Object} Cosigner
 * @property {string} name
 * @property {string} pubkey
 * @property {typeof COSIGNER_ORIGINS[number]} origin
 * @property {string | null} localAccountId
 * @property {string | null} xpub
 */

/**
 * @typedef {Object} MultisigConfig
 * @property {1} schemaVersion
 * @property {typeof MULTISIG_SCHEMES[number]} scheme
 * @property {number} threshold
 * @property {Cosigner[]} cosigners
 * @property {string} scriptTemplate
 */

const isCosigner = (v) =>
    isPlainObject(v) &&
    isNonEmptyString(v.name) &&
    isNonEmptyString(v.pubkey) &&
    isOneOf(v.origin, COSIGNER_ORIGINS) &&
    (v.localAccountId === null || isNonEmptyString(v.localAccountId)) &&
    (v.xpub === null || isNonEmptyString(v.xpub));

export function validateMultisigConfig(record) {
    const errors = [];
    if (!check(errors, 'multisigConfig', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {MultisigConfig} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'scheme', isOneOf(r.scheme, MULTISIG_SCHEMES), `must be one of ${MULTISIG_SCHEMES.join(', ')}`);
    check(errors, 'threshold', isNonNegativeInteger(r.threshold) && r.threshold > 0, 'must be a positive integer');
    checkEach(errors, 'cosigners', r.cosigners, isCosigner, 'malformed');
    check(errors, 'scriptTemplate', isNonEmptyString(r.scriptTemplate), 'must be a non-empty string');
    return result(errors);
}
