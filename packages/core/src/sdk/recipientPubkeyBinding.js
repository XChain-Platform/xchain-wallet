// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Single-key address types the compose path has historically verified.
const COMPOSE_ADDRESS_TYPES = ['p2pkh', 'p2wpkh', 'p2sh-p2wpkh'];

function isStandardPubkeyHex(pubkeyHex) {
    if (typeof pubkeyHex !== 'string' || !/^[0-9a-fA-F]+$/.test(pubkeyHex)) return false;
    if (pubkeyHex.length % 2 !== 0) return false;
    const byteLength = pubkeyHex.length / 2;
    return byteLength === 33 || byteLength === 65;
}

/**
 * Preserve the compose-path binding policy while sharing it with SDK guards.
 * Standard public keys must match a supported single-key address type. Key
 * shapes the compose path cannot derive remain available for SDK validation.
 *
 * @param {object} sdk
 * @param {string} pubkeyHex
 * @param {string} address
 * @param {object} descriptor
 * @returns {boolean}
 */
export function recipientPubkeyMatchesAddress(sdk, pubkeyHex, address, descriptor) {
    if (typeof pubkeyHex !== 'string' || !/^[0-9a-fA-F]+$/.test(pubkeyHex)) return false;
    if (pubkeyHex.length % 2 !== 0) return false;
    if (!isStandardPubkeyHex(pubkeyHex)) return true;
    if (!sdk?.wallet || typeof sdk.wallet.deriveAddress !== 'function') return true;

    const supported = Array.isArray(descriptor?.addressTypes) ? descriptor.addressTypes : [];
    const matchingTypes = COMPOSE_ADDRESS_TYPES.filter((type) => supported.includes(type));
    const candidates = matchingTypes.length > 0 ? matchingTypes : COMPOSE_ADDRESS_TYPES;
    let couldDeriveAny = false;
    for (const type of candidates) {
        try {
            if (sdk.wallet.deriveAddress(pubkeyHex, { type }) === address) return true;
            couldDeriveAny = true;
        } catch {
            // Unsupported address types do not make an otherwise valid compose fail.
        }
    }
    return !couldDeriveAny;
}

/**
 * Require an explorer key to derive to the requested address under one of the
 * chain descriptor's address types. This stricter SDK boundary fails closed
 * when the key shape, wallet helper, descriptor, or derivation is unusable.
 *
 * @param {object} sdk
 * @param {string} pubkeyHex
 * @param {string} address
 * @param {object} descriptor
 * @returns {boolean}
 */
export function explorerPubkeyMatchesAddress(sdk, pubkeyHex, address, descriptor) {
    if (!isStandardPubkeyHex(pubkeyHex)) return false;
    if (!sdk?.wallet || typeof sdk.wallet.deriveAddress !== 'function') return false;
    const candidates = Array.isArray(descriptor?.addressTypes)
        ? descriptor.addressTypes.filter((type) => typeof type === 'string' && type.length > 0)
        : [];
    if (candidates.length === 0) return false;

    for (const type of candidates) {
        try {
            if (sdk.wallet.deriveAddress(pubkeyHex, { type }) === address) return true;
        } catch {
            // A key passes only when one registered derivation succeeds and matches.
        }
    }
    return false;
}
