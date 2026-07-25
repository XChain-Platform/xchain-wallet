// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AutopayLease record (PC-16). Single-active-payer arbitration:
// check-then-pay is a race, and a duplicate COINPAY's coin output
// moves real funds even though the indexer skips the duplicate action.
// Exactly one engine instance may hold the 'payer' lease per vault;
// everyone else stays notify-only. The lease is renewed every watcher
// cycle and expires after 3 unrenewed cycles, so a dead payer never
// blocks payment for long.
//
// Scope honesty: vaults are per-shell at HEAD (no synced state), so
// the instances this lease arbitrates are same-vault contexts - two
// web tabs on one origin, or an MV3 worker that restarted while its
// predecessor's cycle was mid-flight. The `shellKind` field records
// the spec's desktop > extension > web precedence for the day a sync
// layer makes cross-shell claims possible; today claims are
// first-comer within the one shell that can read this vault.

import {
    check,
    isIsoTimestamp,
    isNonEmptyString,
    isPlainObject,
    result,
} from './validate.js';

export const CURRENT_VERSION = 1;

/** The one record id: a vault has at most one payer lease. */
export const PAYER_LEASE_ID = 'payer';

export const AUTOPAY_SHELL_KINDS = ['desktop', 'extension', 'web'];

/**
 * @typedef {Object} AutopayLease
 * @property {1} schemaVersion
 * @property {string} id          always PAYER_LEASE_ID
 * @property {string} holderId    random per-engine-instance token
 * @property {'desktop' | 'extension' | 'web'} shellKind
 * @property {string} renewedAt   ISO timestamp of the last renewal
 */

/**
 * @param {Object} input
 * @param {string} input.holderId
 * @param {'desktop' | 'extension' | 'web'} input.shellKind
 * @returns {AutopayLease}
 */
export function createAutopayLease(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: PAYER_LEASE_ID,
        holderId: input.holderId,
        shellKind: input.shellKind,
        renewedAt: new Date().toISOString(),
    };
}

export function validateAutopayLease(record) {
    const errors = [];
    if (!check(errors, 'autopayLease', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {AutopayLease} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', r.id === PAYER_LEASE_ID, `must be "${PAYER_LEASE_ID}"`);
    check(errors, 'holderId', isNonEmptyString(r.holderId), 'must be a non-empty string');
    check(errors, 'shellKind', AUTOPAY_SHELL_KINDS.includes(r.shellKind),
        `must be one of ${AUTOPAY_SHELL_KINDS.join(', ')}`);
    check(errors, 'renewedAt', isIsoTimestamp(r.renewedAt), 'must be an ISO timestamp');
    return result(errors);
}
