// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Mirrors LIST_SHARE_MAX_MEMBERS in xchain-documentation/protocol/constants.js.
export const LIST_SHARE_MAX_MEMBERS = 10000;

/**
 * @param {{ type: unknown, memberCount: unknown, isShared: boolean }} params
 * @returns {{ ok: boolean, reasons: Array<{ code: string, text: string }>, countKnown: boolean }}
 */
export function listShareEligibility({ type, memberCount, isShared }) {
    const reasons = [];
    const normalizedType = String(type);

    if (normalizedType === '3') {
        reasons.push({
            code: 'union',
            text: 'A union list cannot be shared in this release.',
        });
    }
    if (!['1', '2', '3'].includes(normalizedType)) {
        reasons.push({
            code: 'type',
            text: 'Only token and address lists can be shared.',
        });
    }
    if (isShared === true) {
        reasons.push({
            code: 'already-shared',
            text: 'This list is already shared; a shared list cannot be shared again.',
        });
    }
    if (typeof memberCount === 'number' && memberCount > LIST_SHARE_MAX_MEMBERS) {
        reasons.push({
            code: 'too-many',
            text: 'A list over 10,000 members cannot be shared.',
        });
    }

    return {
        ok: reasons.length === 0,
        reasons,
        countKnown: memberCount !== null && memberCount !== undefined,
    };
}

/**
 * @param {unknown} typed
 * @returns {boolean}
 */
export function isShareConfirmed(typed) {
    return String(typed).trim() === 'SHARE';
}
