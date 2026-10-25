// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-account mutual exclusion for flows that rewrite a CoSignerAccount record.
//
// A policy edit and a co-sign decision both read the whole record and write
// it back (the decision persists its spending-window entry on the same
// record). Run concurrently, the later write replaces the earlier one: a lost
// window entry re-opens the spending budget, a lost edit leaves the old limits
// in force, and a decision that read the record before an edit signs under
// the policy the owner just replaced. Holding this lock from the read to the
// write (or to the verdict) makes each flow see the other's finished result.

const TAILS = new Map();

/**
 * Run `fn` once every earlier holder of the same account id has settled.
 *
 * @template T
 * @param {string} accountId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withAccountLock(accountId, fn) {
    const previous = TAILS.get(accountId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.then(() => {}, () => {});
    TAILS.set(accountId, tail);
    // Drop the slot once nothing is queued behind this holder.
    tail.then(() => {
        if (TAILS.get(accountId) === tail) TAILS.delete(accountId);
    });
    return run;
}
