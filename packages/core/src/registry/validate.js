// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Validator for ChainDescriptor (§9.7). Shape matches the spec; callers
// use this to accept user-submitted descriptors (Developer Mode) before
// installing them into the registry.

import { NETWORKS } from '../schemas/constants.js';
import {
    check,
    checkEach,
    isArray,
    isBoolean,
    isNonEmptyString,
    isNonNegativeInteger,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from '../schemas/validate.js';

// §5.5 + §36.3: donation addresses are TBD per chain at launch. Any
// descriptor with this literal string in `adsDonationAddress` is
// treated as "not configured": the ADS resolver refuses to submit a
// donation output for that chain, and the submitAction integration
// advances the accumulator as if ADS were disabled. A grep-replace
// before mainnet release physically can't be missed because the
// sentinel is an obvious non-address string.
export const ADS_DONATION_ADDRESS_PLACEHOLDER = 'PLACEHOLDER_REPLACE_BEFORE_MAINNET';

/**
 * @param {Pick<ChainDescriptor, 'adsDonationAddress'>} descriptor
 * @returns {boolean}
 */
export function isDonationAddressConfigured(descriptor) {
    if (!descriptor || typeof descriptor.adsDonationAddress !== 'string') return false;
    return descriptor.adsDonationAddress !== ADS_DONATION_ADDRESS_PLACEHOLDER;
}

export const FEE_UNITS = /** @type {const} */ ([
    'sats-per-vbyte',
    'sats-per-kbyte',
]);

export const FEE_STRATEGY_NAMES = /** @type {const} */ ([
    'low',
    'normal',
    'fast',
    'custom',
]);

/**
 * @typedef {Object} FeeStrategyConfig
 * @property {typeof FEE_UNITS[number]} unit
 * @property {(typeof FEE_STRATEGY_NAMES[number])[]} supportedStrategies
 * @property {boolean} rbfSupported
 * @property {typeof FEE_STRATEGY_NAMES[number]} defaultStrategy
 */

/**
 * @typedef {Object} EndpointConfig
 * @property {string} defaultUrl
 * @property {number} defaultPort
 */

/**
 * @typedef {Object} ChainDescriptor
 * @property {string} id                          e.g. 'bitcoin-mainnet'
 * @property {string} coin                        e.g. 'bitcoin'
 * @property {string} displayName
 * @property {typeof NETWORKS[number]} networkKind
 * @property {string} color                       CSS hex like '#F7931A'
 * @property {string} icon                        Asset filename in packages/core/src/branding/images/ (resolve with branding.brandingUrl); empty string for developer-mode chains without an icon
 * @property {Record<string, string>} derivationPaths  addressType -> BIP-style path template (A/C/I placeholders)
 * @property {string[]} addressTypes
 * @property {string} defaultAddressType
 * @property {FeeStrategyConfig} feeStrategy
 * @property {string[]} supportedActions
 * @property {string} uriScheme                   e.g. 'bitcoin' for BIP21
 * @property {number} wifVersionByte              leading byte for WIF-encoded private keys on this network
 * @property {EndpointConfig} explorer
 * @property {EndpointConfig} encoder
 * @property {EndpointConfig} hub
 * @property {string} adsDonationAddress          §36.3 destination for Automatic Donation System output; `ADS_DONATION_ADDRESS_PLACEHOLDER` disables submission
 * @property {boolean} [isUserAdded]              set by registry for Developer Mode entries
 */

// Endpoint URLs are consumed directly for live balance/PSBT/hub requests
// (SDKRegistry): the signed registry authenticates the descriptor blob once,
// but the API calls it configures carry no signature, so a cleartext scheme
// is a standing MITM primitive. Require https/wss everywhere except regtest
// chains and loopback hosts (cleartext to the local machine is not
// interceptable in transit).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const isSecureEndpointUrl = (raw, allowInsecure) => {
    let url;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol === 'https:' || url.protocol === 'wss:') return true;
    if (url.protocol !== 'http:' && url.protocol !== 'ws:') return false;
    return allowInsecure || LOOPBACK_HOSTS.has(url.hostname);
};

const isEndpoint = (v, allowInsecure = false) =>
    isPlainObject(v) &&
    isString(v.defaultUrl) &&
    isSecureEndpointUrl(v.defaultUrl, allowInsecure) &&
    isNonNegativeInteger(v.defaultPort);

const isFeeStrategy = (v) => {
    if (!isPlainObject(v)) return false;
    if (!isOneOf(v.unit, FEE_UNITS)) return false;
    if (!isArray(v.supportedStrategies)) return false;
    for (const s of v.supportedStrategies) {
        if (!isOneOf(s, FEE_STRATEGY_NAMES)) return false;
    }
    if (!v.supportedStrategies.includes(v.defaultStrategy)) return false;
    if (!isBoolean(v.rbfSupported)) return false;
    return true;
};

// A derivation-path template is `m/<purpose>'/<coin-type>'/A'/C/I`: two
// hardened numeric segments (purpose, coin-type) followed by the fixed
// account/change/index placeholders. Anchoring the shape here means the
// placeholder expansion in derivationPathFor (index.js) can never land a
// substitution in the wrong segment, and a malformed untrusted descriptor
// (Developer Mode paste, remote sync) is rejected at install time instead
// of silently deriving a wrong-but-plausible path into the signer (§16).
const DERIVATION_TEMPLATE_RE = /^m\/\d+'\/\d+'\/A'\/C\/I$/;

// SLIP-44 mainnet coin-type slot per known chain family. Every network in a
// family (testnet/regtest included) anchors to the mainnet slot to match
// xchain-sdk and the backend CryptoNetworks, not SLIP-44's generic 1'
// testnet slot. Promoted from the derivation-parity integration test so that
// remote/custom descriptor installs enforce the same invariant the bundled
// descriptors are CI-tested against; unknown families stay unconstrained.
export const FAMILY_MAINNET_COIN_TYPE_SLOT = { bitcoin: "0'", litecoin: "2'", dogecoin: "3'" };

// WIF version byte per known chain family and network. Like the coin-type
// slot above, wifVersionByte is a hand-maintained copy of an xchain-sdk
// registry value (SoftwareSigner WIF-encodes with descriptor.wifVersionByte,
// while address encoding rides the SDK's own networks.js). Range-checking it
// alone lets a remote/Developer-Mode descriptor override e.g. bitcoin-regtest
// with the mainnet prefix 0x80, so the wallet WIF-encodes regtest keys with a
// prefix the SDK decodes differently. Pinning known (coin, networkKind) pairs
// here closes the second leg of the descriptor<->SDK parity contract; unknown
// families stay range-checked only, so custom chains remain installable.
export const FAMILY_NETWORK_WIF_BYTE = {
    bitcoin: { mainnet: 0x80, testnet: 0xef, regtest: 0xef },
    litecoin: { mainnet: 0xb0, testnet: 0xef, regtest: 0xef },
    dogecoin: { mainnet: 0x9e, testnet: 0xf1, regtest: 0xef },
};

const isDerivationPaths = (v) => {
    if (!isPlainObject(v)) return false;
    for (const [k, val] of Object.entries(v)) {
        if (!isNonEmptyString(k)) return false;
        if (!isNonEmptyString(val)) return false;
        if (!DERIVATION_TEMPLATE_RE.test(val)) return false;
    }
    return true;
};

/**
 * @param {unknown} record
 * @returns {{ ok: true, errors: [] } | { ok: false, errors: string[] }}
 */
export function validateChainDescriptor(record) {
    const errors = [];
    if (!check(errors, 'descriptor', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {ChainDescriptor} */ (record);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'coin', isNonEmptyString(r.coin), 'must be a non-empty string');
    check(errors, 'displayName', isNonEmptyString(r.displayName), 'must be a non-empty string');
    check(errors, 'networkKind', isOneOf(r.networkKind, NETWORKS), `must be one of ${NETWORKS.join(', ')}`);
    check(errors, 'color', isNonEmptyString(r.color), 'must be a non-empty string');
    check(errors, 'icon', isString(r.icon), 'must be a string');
    check(errors, 'derivationPaths', isDerivationPaths(r.derivationPaths), 'malformed');
    // Reserved-id integrity. Both parity pins below key off the free-form `coin`
    // field, while the registry overrides entries by `id` (index.js) and every
    // other seam (SDK NETWORKS[id], ADDRESS_PARAMS id.split('-')) keys off `id`.
    // So a descriptor keeping a bundled id (e.g. `bitcoin-mainnet`) but a
    // mismatched coin (`btc`) would override the bundled network yet escape both
    // coin-keyed pins. When the id is an exact `${knownFamily}-${networkKind}`
    // (prefix present in the family map), require coin/networkKind to match it,
    // so `coin` is trustworthy for pinned families. Genuine custom chains whose
    // id prefix is not a known family (e.g. `forkcoin-mainnet`, `bitcoin-cash-
    // mainnet`) stay entirely unconstrained.
    if (isNonEmptyString(r.id)) {
        const idMatch = r.id.match(/^(.+)-([^-]+)$/);
        const idFamily = idMatch && idMatch[1];
        const idNetworkKind = idMatch && idMatch[2];
        if (idMatch && Object.prototype.hasOwnProperty.call(FAMILY_MAINNET_COIN_TYPE_SLOT, idFamily)) {
            check(errors, 'coin', r.coin === idFamily,
                `must be "${idFamily}" to match the reserved id "${r.id}"`);
            check(errors, 'networkKind', r.networkKind === idNetworkKind,
                `must be "${idNetworkKind}" to match the reserved id "${r.id}"`);
        }
    }
    // For a known coin family, every template's coin-type slot must equal the
    // family's mainnet SLIP-44 slot. A remote/custom descriptor overriding a
    // bundled id with a drifted slot (e.g. the SLIP-44 1' "testnet fix" on
    // bitcoin-testnet) would otherwise install cleanly and silently derive
    // addresses the backend does not watch (funds appear missing).
    const familySlot = FAMILY_MAINNET_COIN_TYPE_SLOT[r.coin];
    if (familySlot && isPlainObject(r.derivationPaths)) {
        for (const [addressType, template] of Object.entries(r.derivationPaths)) {
            const m = typeof template === 'string' ? template.match(/^m\/\d+'\/(\d+')\//) : null;
            check(
                errors,
                `derivationPaths.${addressType}`,
                Boolean(m) && m[1] === familySlot,
                `coin-type slot must be ${familySlot} for the ${r.coin} family`,
            );
        }
    }
    checkEach(errors, 'addressTypes', r.addressTypes, isNonEmptyString, 'must be a non-empty string');
    check(
        errors,
        'defaultAddressType',
        isNonEmptyString(r.defaultAddressType) &&
            isArray(r.addressTypes) &&
            r.addressTypes.includes(r.defaultAddressType),
        'must be one of addressTypes',
    );
    check(errors, 'feeStrategy', isFeeStrategy(r.feeStrategy), 'malformed');
    checkEach(errors, 'supportedActions', r.supportedActions, isNonEmptyString, 'must be a non-empty string');
    check(errors, 'uriScheme', isNonEmptyString(r.uriScheme), 'must be a non-empty string');
    check(
        errors,
        'wifVersionByte',
        Number.isInteger(r.wifVersionByte) && r.wifVersionByte >= 0 && r.wifVersionByte <= 0xff,
        'must be an integer in [0, 255]',
    );
    // For a known coin family/network, wifVersionByte must equal the SDK's
    // pinned value. Prevents an override from WIF-encoding testnet/regtest keys
    // with a mainnet prefix (see FAMILY_NETWORK_WIF_BYTE above). Unknown coins
    // and networkKinds fall through to the range check only.
    const familyWifByte = FAMILY_NETWORK_WIF_BYTE[r.coin]?.[r.networkKind];
    if (familyWifByte !== undefined) {
        check(
            errors,
            'wifVersionByte',
            r.wifVersionByte === familyWifByte,
            `must be ${familyWifByte} for ${r.coin} ${r.networkKind}`,
        );
    }
    // http/ws endpoints are only acceptable where transit interception is
    // structurally impossible: regtest chains and loopback hosts.
    const allowInsecure = r.networkKind === 'regtest';
    const endpointMsg = 'must be a well-formed https/wss endpoint (http/ws only on regtest or loopback)';
    check(errors, 'explorer', isEndpoint(r.explorer, allowInsecure), endpointMsg);
    check(errors, 'encoder', isEndpoint(r.encoder, allowInsecure), endpointMsg);
    check(errors, 'hub', isEndpoint(r.hub, allowInsecure), endpointMsg);
    check(
        errors,
        'adsDonationAddress',
        isNonEmptyString(r.adsDonationAddress),
        `must be a non-empty string (use ADS_DONATION_ADDRESS_PLACEHOLDER "${ADS_DONATION_ADDRESS_PLACEHOLDER}" when unset)`,
    );
    if (r.isUserAdded !== undefined) {
        check(errors, 'isUserAdded', isBoolean(r.isUserAdded), 'must be a boolean');
    }

    // Cross-field: every addressType must have a derivation path template.
    if (isArray(r.addressTypes) && isPlainObject(r.derivationPaths)) {
        for (const t of r.addressTypes) {
            if (!isNonEmptyString(r.derivationPaths[t])) {
                errors.push(`derivationPaths: missing template for addressType "${t}"`);
            }
        }
    }

    return result(errors);
}
