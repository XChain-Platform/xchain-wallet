// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SignerRecord — §17.6 / §18.3. Persisted metadata for every signer
// the wallet has paired, across hardware kinds.
//
// The SoftwareSigner itself does *not* need a SignerRecord — the
// Wallet record is its identity (one software signer per wallet,
// driven by the seed). Hardware signers do: each Trezor / Ledger the
// user pairs becomes a distinct record, and `Address.signerId` points
// here.
//
// Stored fields deliberately leave out anything secret: no PINs, no
// seed material, no xpubs. (Xpubs live on the device; we re-derive as
// needed.) What lives here is the minimum needed to distinguish one
// device from another and render UI: vendor, model, device label,
// last-known firmware version, a device identifier (for matching the
// same physical device on reconnect), and an optional user-chosen
// label.
//
// `deviceIdentifier` is an opaque string the signer implementation
// provides — for Trezor it's typically the `deviceId` from Trezor
// Connect; for Ledger it's typically a fingerprint derived from a
// known xpub. The wallet treats it as-is; uniqueness within the
// wallet is enforced by the signer-registry flow, not the schema.

import {
    check,
    isIsoTimestamp,
    isNonEmptyString,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from './validate.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 1;

export const SIGNER_KINDS = ['trezor', 'ledger'];

/**
 * @typedef {typeof SIGNER_KINDS[number]} SignerKind
 *
 * @typedef {Object} SignerRecord
 * @property {1} schemaVersion
 * @property {string} id                   stable wallet-scoped id
 * @property {string} walletId             owning wallet
 * @property {SignerKind} kind             'trezor' | 'ledger'
 * @property {string} vendor               matches firmware-manifest.js keys ("trezor", "ledger")
 * @property {string} model                vendor-specific model code (e.g. "T2T1", "nanoX")
 * @property {string} deviceIdentifier     opaque per-device identifier from the signer backend
 * @property {string} label                user-facing label ("Trezor #1" etc.)
 * @property {string | null} firmwareVersion    last-observed firmware — null until first connect
 * @property {string} pairedAt             ISO timestamp
 * @property {string} lastSeenAt           ISO timestamp — bumped on each successful interaction
 */

/**
 * @param {Object} input
 * @param {string} input.walletId
 * @param {SignerKind} input.kind
 * @param {string} input.vendor
 * @param {string} input.model
 * @param {string} input.deviceIdentifier
 * @param {string} [input.label]
 * @param {string | null} [input.firmwareVersion]
 * @returns {SignerRecord}
 */
export function createSignerRecord(input) {
    const now = new Date().toISOString();
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        kind: input.kind,
        vendor: input.vendor,
        model: input.model,
        deviceIdentifier: input.deviceIdentifier,
        label: input.label ?? defaultLabel(input.kind),
        firmwareVersion: input.firmwareVersion ?? null,
        pairedAt: now,
        lastSeenAt: now,
    };
}

/** @param {SignerKind} kind */
function defaultLabel(kind) {
    if (kind === 'trezor') return 'Trezor';
    if (kind === 'ledger') return 'Ledger';
    return 'Hardware signer';
}

/**
 * @param {unknown} record
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSignerRecord(record) {
    const errors = [];
    if (!check(errors, 'signer', isPlainObject(record), 'must be an object')) {
        return result(errors);
    }
    const r = /** @type {SignerRecord} */ (record);
    check(
        errors,
        'schemaVersion',
        r.schemaVersion === CURRENT_VERSION,
        `must be ${CURRENT_VERSION}`,
    );
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(
        errors,
        'kind',
        isOneOf(r.kind, SIGNER_KINDS),
        `must be one of ${SIGNER_KINDS.join(', ')}`,
    );
    check(errors, 'vendor', isNonEmptyString(r.vendor), 'must be a non-empty string');
    check(errors, 'model', isNonEmptyString(r.model), 'must be a non-empty string');
    check(
        errors,
        'deviceIdentifier',
        isNonEmptyString(r.deviceIdentifier),
        'must be a non-empty string',
    );
    check(errors, 'label', isString(r.label), 'must be a string');
    check(
        errors,
        'firmwareVersion',
        r.firmwareVersion === null || isNonEmptyString(r.firmwareVersion),
        'must be null or a non-empty string',
    );
    check(errors, 'pairedAt', isIsoTimestamp(r.pairedAt), 'must be an ISO timestamp');
    check(errors, 'lastSeenAt', isIsoTimestamp(r.lastSeenAt), 'must be an ISO timestamp');
    return result(errors);
}
