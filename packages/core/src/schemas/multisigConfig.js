// MultisigConfig — §11.3.6 + §22.2. Reserved in Phase 1; implemented in
// Phase 4 Step 17. Cosigner record matches §22.2 verbatim: name +
// pubkey + fingerprint + origin + localSignerId + xpub +
// derivationPath + addedAt.

import {
    check,
    checkEach,
    isIsoTimestamp,
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

// §22.2: 'local' covers both software accounts and paired hardware
// signers (the wallet has the signer record locally either way).
// 'external-xpub' is an xpub copied in from another wallet; we can
// build PSBTs for it but cannot sign. 'external-hardware' is a
// hardware device controlled by someone other than this wallet's
// user — interaction is via PSBT exchange.
export const COSIGNER_ORIGINS = /** @type {const} */ ([
    'local',
    'external-xpub',
    'external-hardware',
]);

/**
 * @typedef {Object} Cosigner
 * @property {string} name                                user-chosen
 * @property {string} pubkey                              hex — signing public key
 * @property {string} fingerprint                         4-byte BIP32 master key fingerprint, hex
 * @property {typeof COSIGNER_ORIGINS[number]} origin
 * @property {string | null} localSignerId                set when origin='local'; references a Signer record
 * @property {string | null} xpub                         set when origin='external-xpub'
 * @property {string} derivationPath                      from this cosigner's root → multisig address
 * @property {string} addedAt                             ISO timestamp
 */

/**
 * @typedef {Object} MultisigConfig
 * @property {1} schemaVersion
 * @property {typeof MULTISIG_SCHEMES[number]} scheme
 * @property {number} threshold
 * @property {Cosigner[]} cosigners
 * @property {string} scriptTemplate                      P2SH/P2WSH: "multi:<T>:<pk1>:<pk2>:..."; Taproot-MuSig2: "musig2:<aggXOnly>"
 */

const isCosigner = (v) =>
    isPlainObject(v) &&
    isNonEmptyString(v.name) &&
    isNonEmptyString(v.pubkey) &&
    isNonEmptyString(v.fingerprint) &&
    isOneOf(v.origin, COSIGNER_ORIGINS) &&
    (v.localSignerId === null || isNonEmptyString(v.localSignerId)) &&
    (v.xpub === null || isNonEmptyString(v.xpub)) &&
    isNonEmptyString(v.derivationPath) &&
    isIsoTimestamp(v.addedAt);

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
    if (Array.isArray(r.cosigners)) {
        if (r.cosigners.length < 2) {
            errors.push('cosigners: must contain at least 2 cosigners');
        }
        if (typeof r.threshold === 'number' && r.threshold > r.cosigners.length) {
            errors.push('threshold: must be ≤ cosigners.length');
        }
        const seenPubkeys = new Set();
        for (const c of r.cosigners) {
            if (c && typeof c.pubkey === 'string') {
                const key = c.pubkey.toLowerCase();
                if (seenPubkeys.has(key)) {
                    errors.push(`cosigners: duplicate pubkey ${c.pubkey}`);
                    break;
                }
                seenPubkeys.add(key);
            }
        }
    }
    return result(errors);
}

/**
 * Build a `MultisigConfig` from a normalized cosigner list + scheme +
 * threshold. The caller is responsible for resolving each cosigner's
 * `pubkey` / `fingerprint` / `derivationPath` / `localSignerId` /
 * `xpub` before invoking this factory — this function only assembles
 * the record and computes the `scriptTemplate` field.
 *
 * For Taproot-MuSig2: caller passes in `aggregatedXOnlyPubkey` (the
 * 32-byte x-only aggregated pubkey produced by
 * `sdk.musig2.aggregateKeys`); the factory encodes it into the
 * scriptTemplate as `musig2:<hex>`.
 *
 * For P2SH/P2WSH: scriptTemplate is encoded as
 * `multi:<threshold>:<pk1>:<pk2>:...`. The actual redeem-script
 * bytes are computed at PSBT-construction time (Step 19) from the
 * template — the wallet doesn't need bitcoinjs-lib here.
 *
 * @param {{
 *   scheme: typeof MULTISIG_SCHEMES[number],
 *   threshold: number,
 *   cosigners: Array<Omit<Cosigner, 'addedAt'>>,
 *   aggregatedXOnlyPubkey?: string,
 * }} input
 * @returns {MultisigConfig}
 */
export function buildMultisigConfig(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('buildMultisigConfig: input is required');
    }
    if (!MULTISIG_SCHEMES.includes(input.scheme)) {
        throw new Error(
            `buildMultisigConfig: scheme must be one of ${MULTISIG_SCHEMES.join(', ')}`,
        );
    }
    if (!Array.isArray(input.cosigners) || input.cosigners.length < 2) {
        throw new Error('buildMultisigConfig: cosigners must be an array of at least 2 entries');
    }
    if (!Number.isInteger(input.threshold) || input.threshold <= 0) {
        throw new Error('buildMultisigConfig: threshold must be a positive integer');
    }
    if (input.threshold > input.cosigners.length) {
        throw new Error('buildMultisigConfig: threshold must be ≤ cosigners.length');
    }

    const addedAt = new Date().toISOString();
    const cosigners = input.cosigners.map((c) => ({
        name: c.name,
        pubkey: c.pubkey,
        fingerprint: c.fingerprint,
        origin: c.origin,
        localSignerId: c.localSignerId ?? null,
        xpub: c.xpub ?? null,
        derivationPath: c.derivationPath,
        addedAt,
    }));

    let scriptTemplate;
    if (input.scheme === 'taproot-musig2') {
        if (typeof input.aggregatedXOnlyPubkey !== 'string'
            || input.aggregatedXOnlyPubkey.length === 0) {
            throw new Error(
                'buildMultisigConfig: taproot-musig2 requires aggregatedXOnlyPubkey',
            );
        }
        scriptTemplate = `musig2:${input.aggregatedXOnlyPubkey.toLowerCase()}`;
    } else {
        const parts = ['multi', String(input.threshold)];
        for (const c of cosigners) parts.push(c.pubkey.toLowerCase());
        scriptTemplate = parts.join(':');
    }

    /** @type {MultisigConfig} */
    const config = {
        schemaVersion: CURRENT_VERSION,
        scheme: input.scheme,
        threshold: input.threshold,
        cosigners,
        scriptTemplate,
    };
    const res = validateMultisigConfig(config);
    if (!res.ok) {
        throw new Error(`buildMultisigConfig: produced invalid config — ${res.errors.join('; ')}`);
    }
    return config;
}
