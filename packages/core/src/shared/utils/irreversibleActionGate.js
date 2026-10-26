// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The word a person types before an irreversible raw action can be approved.
// The dedicated Destroy, Lock and address-lock forms each carry that typed
// gate; the Advanced action form composes the same actions from raw fields
// and applies the same gate through this one function.

const isSet = (value) => {
    const text = String(value ?? '').trim();
    return text !== '' && text !== '0';
};

/**
 * @param {string} action   action code, e.g. 'DESTROY'
 * @param {Record<string, unknown> | null | undefined} params   the action's wire params
 * @returns {'DESTROY' | 'LOCK' | null}   the word to type, or null when the action can be undone
 */
export function irreversibleConfirmWord(action, params) {
    const p = params || {};
    if (action === 'DESTROY') return 'DESTROY';
    if (action === 'ISSUE' && Object.keys(p).some((key) => key.startsWith('LOCK_') && isSet(p[key]))) {
        return 'LOCK';
    }
    // SLEEP v0 (no TICK; the form leaves VERSION blank for it) locks the signing address, and a locked
    // address cannot wake itself; a resume (0) is the exception.
    const locksAddress = String(p.TICK ?? '').trim() === '' && String(p.VERSION ?? '0') !== '1';
    if (action === 'SLEEP' && locksAddress && String(p.RESUME_BLOCK ?? '').trim() !== '0') {
        return 'LOCK';
    }
    return null;
}
