// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/** Remove live-only sibling links from one entry written to queue storage. */
export function toStoredQueueEntry(entry) {
    const { siblingPendingTxIds: _runtimeLinks, ...stored } = entry;
    return stored;
}

/** Build the durable queue snapshot shared by every queue writer. */
export function toStoredQueueSnapshot(queues) {
    const snapshot = {};
    for (const [walletId, entries] of queues.entries()) {
        if (entries.length > 0) snapshot[walletId] = entries.map(toStoredQueueEntry);
    }
    return snapshot;
}

/** Adopt stored rows while retaining sibling links only from matching live rows. */
export function adoptStoredQueueEntries(storedRows, liveEntries = []) {
    if (!Array.isArray(storedRows)) return [];
    const liveById = new Map(liveEntries.map((entry) => [entry.id, entry]));
    const liveByPendingTx = new Map(liveEntries
        .filter((entry) => entry.pendingTxId)
        .map((entry) => [entry.pendingTxId, entry]));
    return storedRows
        .filter((entry) => entry && typeof entry === 'object')
        .map(toStoredQueueEntry)
        .map((entry) => {
            const matchingLive = liveById.get(entry.id)
                ?? (entry.pendingTxId ? liveByPendingTx.get(entry.pendingTxId) : null);
            if (!matchingLive || matchingLive.signedTxHex !== entry.signedTxHex) return entry;
            const liveLinks = Array.isArray(matchingLive.siblingPendingTxIds)
                ? matchingLive.siblingPendingTxIds
                : [];
            const links = new Set([matchingLive.pendingTxId, ...liveLinks]
                .filter((id) => typeof id === 'string' && id && id !== entry.pendingTxId));
            return links.size > 0 ? { ...entry, siblingPendingTxIds: [...links] } : entry;
        });
}
