// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Address record (§11.3.3).
//
// v2 adds `signerId` per §17.6: addresses are tied to a signer by stable
// id, so switching signers (e.g. pairing a new Trezor) re-associates
// addresses by path+pubkey match. v1 records migrate forward unlinked
// with `signerId: null`. Software routing does not read that field, and
// no runtime path reconciles it automatically; see migrations.js.
//
// v3 adds `role` per §16: 'receive' | 'change' | 'dispenser'.
// 'receive'/'change' track the BIP44 external/internal branch (change
// 0/1). 'dispenser' is a metadata tag on a normal external (change=0)
// address that hosts a dispenser, not a separate branch. v2 records
// migrate forward by parsing the change segment of `derivationPath`
// (legacy change=2 records, if any, map to 'dispenser').
//
// v4 (current) coin-prefixes the legacy default address label. The old
// default ("Address #N") was chain-agnostic, so BTC/LTC/DOGE under one
// account all rendered identically. v3 records whose label exactly matches
// the old default migrate to "<TICKER> Address #N"; custom labels are kept.

import { ADDRESS_ROLES, ADDRESS_SOURCES, NETWORKS } from './constants.js';
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
import { randomUUID } from '../util/uuid.js';
import { NAME_MAX_LENGTH, hasVisibleText, nameLength } from '../util/display_name.js';
import { tickerForCoin } from '../registry/coinTicker.js';

export const CURRENT_VERSION = 4;

export const ADDRESS_OWNERSHIP_RULES = Object.freeze({
    hd: 'required',
    'imported-wif': 'null',
    'watch-only': 'paired',
    trezor: 'required',
    ledger: 'required',
});

/**
 * Return the generated name an address receives when it has no custom label.
 * The derivation path's final segment is the zero-based address index.
 *
 * @param {Partial<Address>} record
 * @returns {string}
 */
export function defaultAddressLabel(record) {
    if (record?.source === 'imported-wif') return 'Imported Address';

    const ticker = tickerForCoin(record?.chain);
    const prefix = ticker ? `${ticker} ` : '';
    const finalSegment = String(record?.derivationPath || '').split('/').pop();
    const index = /^\d+$/.test(finalSegment || '') ? Number(finalSegment) : null;
    const number = index === null ? '' : ` #${index + 1}`;

    if (record?.role === 'change') return `${prefix}Change${number}`;
    if (record?.role === 'dispenser') return `${prefix}Dispenser${number}`;
    return `${prefix}Address${number}`;
}

/**
 * The label to store for a user-typed value. A value that draws no visible
 * character gets the generated default, and one longer than the shared name
 * cap is refused so a label cannot grow the encrypted label-sync payload
 * without bound.
 *
 * @param {unknown} label
 * @param {Partial<Address>} record
 * @returns {string}
 */
export function normalizeAddressLabel(label, record) {
    const trimmed = typeof label === 'string' ? label.trim() : '';
    if (!hasVisibleText(trimmed)) return defaultAddressLabel(record);
    if (nameLength(trimmed) > NAME_MAX_LENGTH) {
        throw new Error(`Address labels must be ${NAME_MAX_LENGTH} characters or fewer.`);
    }
    return trimmed;
}

/**
 * @typedef {Object} Address
 * @property {4} schemaVersion
 * @property {string} id
 * @property {string | null} accountId        required for derived sources, null for imported-WIF,
 *                                             paired with derivationPath for watch-only
 * @property {string} chain                   coin identifier
 * @property {typeof NETWORKS[number]} network
 * @property {typeof ADDRESS_SOURCES[number]} source
 * @property {string} addressType             script format, e.g. 'p2wpkh'
 * @property {string | null} derivationPath   required for derived sources, null for imported-WIF,
 *                                             paired with accountId for watch-only
 * @property {string} address
 * @property {string} publicKey               hex
 * @property {string} label
 * @property {boolean} pinned
 * @property {boolean} hidden
 * @property {string | null} signerId         owning signer id (§17.6); null = unlinked (invalid for hardware sources)
 * @property {typeof ADDRESS_ROLES[number]} role   'receive' | 'change' | 'dispenser' (§16)
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
 * @param {string} [input.signerId]
 * @param {string} [input.label]
 * @param {boolean} [input.pinned]
 * @param {boolean} [input.hidden]
 * @param {typeof ADDRESS_ROLES[number]} [input.role]   defaults to 'receive'
 * @returns {Address}
 */
export function createAddress(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
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
        signerId: input.signerId ?? null,
        role: input.role ?? 'receive',
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
    const validSource = isOneOf(r.source, ADDRESS_SOURCES);
    check(errors, 'source', validSource, `must be one of ${ADDRESS_SOURCES.join(', ')}`);
    check(errors, 'addressType', isNonEmptyString(r.addressType), 'must be a non-empty string');
    check(
        errors,
        'derivationPath',
        r.derivationPath === null || isNonEmptyString(r.derivationPath),
        'must be null or a non-empty string',
    );
    if (validSource) validateAddressOwnership(errors, r);
    check(errors, 'address', isNonEmptyString(r.address), 'must be a non-empty string');
    check(errors, 'publicKey', isNonEmptyString(r.publicKey), 'must be a non-empty string');
    check(errors, 'label', isString(r.label), 'must be a string');
    check(errors, 'pinned', isBoolean(r.pinned), 'must be a boolean');
    check(errors, 'hidden', isBoolean(r.hidden), 'must be a boolean');
    check(
        errors,
        'signerId',
        r.signerId === null || isNonEmptyString(r.signerId),
        'must be null or a non-empty string',
    );
    check(errors, 'role', isOneOf(r.role, ADDRESS_ROLES), `must be one of ${ADDRESS_ROLES.join(', ')}`);
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    return result(errors);
}

function validateAddressOwnership(errors, record) {
    const rule = ADDRESS_OWNERSHIP_RULES[record.source];
    if (!rule) {
        check(errors, 'source', false, `has no ownership rule for "${record.source}"`);
        return;
    }
    if (rule === 'required') {
        check(errors, 'accountId', isNonEmptyString(record.accountId),
            `must be a non-empty string for source "${record.source}"`);
        check(errors, 'derivationPath', isNonEmptyString(record.derivationPath),
            `must be a non-empty string for source "${record.source}"`);
        return;
    }
    if (rule === 'null') {
        check(errors, 'accountId', record.accountId === null,
            `must be null for source "${record.source}"`);
        check(errors, 'derivationPath', record.derivationPath === null,
            `must be null for source "${record.source}"`);
        return;
    }
    const paired = (record.accountId === null) === (record.derivationPath === null);
    check(errors, 'accountId', paired,
        `must be null exactly when derivationPath is null for source "${record.source}"`);
    check(errors, 'derivationPath', paired,
        `must be null exactly when accountId is null for source "${record.source}"`);
}
