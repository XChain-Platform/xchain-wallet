// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Confirm-screen hero parts read from composed wire params that several
// forms share, so each form's summary states the same thing for the same
// action. Each helper returns only the keys it has a value for: a key set to
// an empty value would hide the host's own decode of the action.

/**
 * The give side of an ORDER: what the order offers. A token given is held by
 * this transaction, so it leaves the signer; a coin given is paid only when
 * the order matches, so it is shown without a sign and is not part of this
 * transaction's total cost.
 *
 * @param {Record<string, any>|null|undefined} params   ORDER wire params
 * @param {string} [nativeTicker]
 * @returns {{ amount?: string, ticker?: string, direction?: 'out'|'none' }}
 */
export function orderGiveParts(params, nativeTicker = '') {
    const p = params || {};
    const giveTick = String(p.GIVE_TICK || '').trim().toUpperCase();
    if (String(p.GIVE_OWNERSHIP || '') === '1') {
        return giveTick ? { ticker: giveTick, direction: 'none' } : { direction: 'none' };
    }
    const amount = String(p.GIVE_AMOUNT ?? '').trim();
    const coin = String(p.GIVE_COIN || nativeTicker || '').trim().toUpperCase();
    if (!amount) return { direction: 'none' };
    if (giveTick) return { amount, ticker: giveTick, direction: 'out' };
    return coin ? { amount, ticker: coin, direction: 'none' } : { direction: 'none' };
}
