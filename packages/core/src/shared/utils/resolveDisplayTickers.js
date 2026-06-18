// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A token can be referenced on the wire by its full name (JDOG) or by its
// numeric id with a caret prefix (^1234). The SDK's ticker compaction emits
// the `^id` form by default, so an action a dApp asks the wallet to sign may
// carry `^1234` in a ticker field. For DISPLAY (the approval screen, balance
// preview) the user should see the readable name, not `^1234`. This helper
// swaps any `^id` ticker reference in an action's params for its resolved name.

// Fields that hold a token reference and should be shown as a name. The
// defining TICK of an ISSUE is excluded: a brand-new token has no id yet, so
// its TICK is always a literal name.
const TICK_REF_FIELDS = ['TICK', 'GIVE_TICK', 'GET_TICK', 'DIVIDEND_TICK', 'CALLBACK_TICK'];

const ID_REF = /^\^\d+$/;

/**
 * Replace any `^<id>` ticker reference in an action's params with its resolved
 * ticker name, for display only. `lookupName(ref)` resolves a single `^<id>`
 * to a name, returning a falsy value when it cannot. Unresolvable references
 * keep their `^id` form, and resolution never throws.
 *
 * Returns the SAME params reference when nothing changed (so a caller can skip
 * a re-render); otherwise a shallow copy with the resolved fields.
 *
 * @param {string} action                       e.g. 'SEND', 'DIVIDEND'
 * @param {Record<string, any>} params          action params (may be mutated-free)
 * @param {(ref: string) => Promise<string|null|undefined>} lookupName
 * @returns {Promise<Record<string, any>>}
 */
export async function resolveDisplayTickers(action, params, lookupName) {
    if (!params || typeof params !== 'object') return params;
    const isIssue = String(action || '').toUpperCase() === 'ISSUE';

    const resolveOne = async (v) => {
        if (typeof v !== 'string' || !ID_REF.test(v)) return v;
        try {
            const name = await lookupName(v);
            return name || v;
        } catch {
            return v;
        }
    };

    let out = params;
    let changed = false;
    for (const field of TICK_REF_FIELDS) {
        if (isIssue && field === 'TICK') continue;
        if (!(field in params)) continue;
        const val = params[field];
        let next;
        let fieldChanged = false;
        if (Array.isArray(val)) {
            next = await Promise.all(val.map(resolveOne));
            fieldChanged = next.some((v, i) => v !== val[i]);
        } else {
            next = await resolveOne(val);
            fieldChanged = next !== val;
        }
        if (!fieldChanged) continue;
        if (!changed) { out = { ...params }; changed = true; }
        out[field] = next;
    }
    return out;
}
