// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which of a chain's registry address types the installed SDK can generate.
//
// The chain registry lists every type the PROTOCOL defines for a chain, but an
// SDK release builds only some of them (0.23.0 builds p2pkh, p2wpkh and
// p2sh-p2wpkh and refuses p2tr). The SDK exports no supported-types list, so
// the wallet asks it: derive one address of each type from a fixed public key
// and treat the SDK's own INVALID_ADDRESS_TYPE refusal as "not supported".
// Any other failure (a segwit refusal on a chain without segwit, say) is about
// the chain, not the type, and leaves the type listed. Nothing here names an
// SDK version, so a release that learns a type offers it with no wallet change.

// secp256k1 generator point, compressed: a valid key that is never a user's.
const PROBE_PUBLIC_KEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

/**
 * @param {unknown} err
 * @returns {boolean} true when the SDK refused the type itself
 */
export function isUnknownAddressTypeError(err) {
    if (!err || typeof err !== 'object') return false;
    const e = /** @type {any} */ (err);
    return e.code === 'INVALID_ADDRESS_TYPE' || /unknown address type/i.test(String(e.message || ''));
}

/**
 * @param {any} sdk                the chain's SDK instance
 * @param {string[]} addressTypes  the descriptor's address types
 * @returns {string[]|null} the types the SDK can generate, in registry order;
 *   null when the SDK cannot be asked (not loaded yet, no derive method), so
 *   callers keep the registry list instead of hiding everything
 */
export function sdkSupportedAddressTypes(sdk, addressTypes) {
    const list = Array.isArray(addressTypes) ? addressTypes : [];
    let derive;
    try {
        derive = sdk?.wallet?.deriveAddress;
    } catch {
        return null;
    }
    if (typeof derive !== 'function') return null;
    const supported = [];
    for (const type of list) {
        try {
            sdk.wallet.deriveAddress(PROBE_PUBLIC_KEY, { type });
            supported.push(type);
        } catch (err) {
            if (!isUnknownAddressTypeError(err)) {
                // The probe could not run (loading placeholder, config error): the
                // answer is unknown, not "unsupported".
                if (!(err && typeof err === 'object' && /** @type {any} */ (err).code)) return null;
                supported.push(type);
            }
        }
    }
    return supported;
}
