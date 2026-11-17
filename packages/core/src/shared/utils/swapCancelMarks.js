// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Swaps whose cancel the current app session has broadcast but the cancels feed may not
// list yet. My Swaps and Swap Details are separate routes, so the
// "Cancelling" state a broadcast sets on the details page has to outlive it:
// the list remounts after Back and must not show the swap Open until the
// indexer catches up. Once the feed lists the cancel the swap reads
// Cancelled and the mark no longer matters.
//
// Marks are held per messaging client, so each shell (and each test, which
// builds its own client) sees only its own broadcasts.

const marksByClient = new WeakMap();
// Hosts without a messaging object still get one shared bucket.
const NO_CLIENT = {};

function marksFor(messaging) {
    const client = messaging && typeof messaging === 'object' ? messaging : NO_CLIENT;
    let marks = marksByClient.get(client);
    if (!marks) {
        marks = new Set();
        marksByClient.set(client, marks);
    }
    return marks;
}

/** Record that a cancel for this swap (`<chainId>:<actionIndex>`) was broadcast. */
export function markSwapCancelBroadcast(messaging, key) {
    marksFor(messaging).add(String(key));
}

/** Whether the current app session broadcast a cancel for the swap. */
export function hasSwapCancelBroadcast(messaging, key) {
    return marksFor(messaging).has(String(key));
}
