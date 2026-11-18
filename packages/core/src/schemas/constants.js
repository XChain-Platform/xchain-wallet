// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared enums used across multiple schemas. Schema-specific enums
// (Wallet.origin, PendingTx.status, etc.) live next to their owning schema.

import { SIGNER_KINDS } from './signer.js';

export const NETWORKS = /** @type {const} */ (['mainnet', 'testnet', 'regtest']);

export const ACTION_PERMISSIONS = /** @type {const} */ (['always', 'ask', 'never']);

export const ADDRESS_SOURCES = /** @type {const} */ ([
    'hd',
    'imported-wif',
    'watch-only',
    'trezor',
    'ledger',
]);

/** @param {unknown} source */
export function isDerivedAddressSource(source) {
    return source === 'hd' || isDeviceAddressSource(source);
}

const ADDRESS_SOURCE_BY_SIGNER_KIND = Object.freeze({
    software: 'hd',
    trezor: 'trezor',
    ledger: 'ledger',
});

/**
 * Map every signer kind that can derive a persisted address to its source tag.
 * New signer kinds must be added explicitly with a value from ADDRESS_SOURCES.
 *
 * @param {unknown} kind
 * @returns {typeof ADDRESS_SOURCES[number]}
 */
export function addressSourceForSignerKind(kind) {
    if (typeof kind !== 'string' || !Object.hasOwn(ADDRESS_SOURCE_BY_SIGNER_KIND, kind)) {
        throw new Error(`Signer kind "${String(kind)}" has no Address.source mapping`);
    }
    return /** @type {typeof ADDRESS_SOURCES[number]} */ (ADDRESS_SOURCE_BY_SIGNER_KIND[kind]);
}

export const DEVICE_SIGNER_KINDS = Object.freeze([...SIGNER_KINDS]);
export const DEVICE_ADDRESS_SOURCES = Object.freeze(
    DEVICE_SIGNER_KINDS.map(addressSourceForSignerKind),
);

/** @param {unknown} kind */
export function isDeviceSignerKind(kind) {
    return typeof kind === 'string' && DEVICE_SIGNER_KINDS.includes(kind);
}

/** @param {unknown} source */
export function isDeviceAddressSource(source) {
    return typeof source === 'string' && DEVICE_ADDRESS_SOURCES.includes(source);
}

// Derivation role of an HD address (§16). 'receive' and 'change' mirror
// the BIP44 external/internal branches (change 0/1). 'dispenser' is a
// metadata tag on a normal external (change=0) address that hosts a
// dispenser, NOT a separate branch. Watch-only / imported keys have no
// branch and default to 'receive'.
export const ADDRESS_ROLES = /** @type {const} */ ([
    'receive',
    'change',
    'dispenser',
]);
