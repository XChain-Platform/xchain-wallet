// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (§4.7): what does this action spend, so a SECOND approval
// window can be told about it?
//
// The reservation ledger closes the two-windows-same-balance race:
// `approvalBroker` intentionally allows N concurrent approval windows, so
// without it both windows fetch the same balance, both look affordable, and
// the second transaction fails on-chain after the user approved it. Send has
// always passed its own `{tick, amount}`. The ~24 forms migrated onto the
// confirm pipeline passed nothing, so they had no protection at all.
//
// Threading a reserve descriptor through 24 forms is the per-form drift the
// pipeline exists to remove, so it is derived instead from the projected
// balances the compose envelope already carries (§5.2.3): a debit is
// `before - after` on any non-coin, non-fee row.
//
// Deliberately conservative. The ledger keys one reservation per (id, tick),
// so a multi-tick action cannot be expressed as one reservation; rather than
// reserve one leg and let the UI imply full coverage, it reserves nothing and
// says so by returning null. Partial protection that reads as full protection
// is worse than none, because it is invisible.

import { subtractAmounts } from '../market/orderMath.js';

/**
 * @typedef {{ tick: string, before: string, after: string, isCoin?: boolean, isFee?: boolean }} BalanceDelta
 */

/**
 * Derive the single-token debit to reserve at Approve.
 *
 * The native coin is excluded on purpose: its debit is dominated by the miner
 * fee, it is not the balance a concurrent token spend would race on, and Send
 * (the reference implementation) reserves the token tick only.
 *
 * @param {{ deltas?: BalanceDelta[] } | null | undefined} simulation
 * @returns {{ tick: string, amount: string } | null}
 */
export function reserveFromSimulation(simulation) {
    const deltas = Array.isArray(simulation?.deltas) ? simulation.deltas : null;
    if (!deltas) return null;

    /** @type {{ tick: string, amount: string }[]} */
    const debits = [];
    for (const d of deltas) {
        if (!d || d.isCoin || d.isFee) continue;
        const tick = typeof d.tick === 'string' ? d.tick.trim() : '';
        if (!tick) continue;
        // subtractAmounts returns null for a credit, a no-op, or anything that
        // is not a plain decimal, so this is also the input-validity gate.
        const amount = subtractAmounts(d.before, d.after);
        if (amount) debits.push({ tick, amount });
    }

    // Exactly one debited token, or nothing. See the note above on why a
    // multi-tick action reserves nothing rather than one leg.
    return debits.length === 1 ? debits[0] : null;
}
