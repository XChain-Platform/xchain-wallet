// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Glue between the §46 NotificationService and the PendingTx ledger. A shell
// wires these into the service's `getPendingTxids` / `onTxConfirmed` hooks so
// (a) tx-confirmed notifications only fire for transactions this wallet
// actually broadcast, and (b) a confirmation flips the record to 'indexed',
// keeping the tx-status timeline in sync with the live WS event.

/**
 * Set of txids the wallet broadcast and is still awaiting confirmation
 * (PendingTx.status === 'broadcast').
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @returns {Promise<Set<string>>}
 */
export async function getBroadcastTxids(vault) {
    if (!vault) return new Set();
    const rows = await vault.pendingTxs.list();
    const out = new Set();
    for (const r of rows) {
        if (r && r.txid && r.status === 'broadcast') out.add(r.txid);
    }
    return out;
}

/**
 * Flip every PendingTx with this txid from 'broadcast' to 'indexed' and stamp
 * `confirmedAt`. No-op when nothing matches or it's already indexed.
 *
 * `opts.inclusion` is set by the reconcile that proved the block itself
 * rather than learning of an action: it marks the record `chainConfirmed`
 * (and names the block when the source knew it) so History keeps a
 * confirmed row for a transaction no explorer feed will ever list, a plain
 * coin transfer or an action the service rejected. A feed-driven retire
 * leaves both fields alone, because the explorer's own row takes over.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} txid
 * @param {{ now?: () => string, inclusion?: { blockIndex?: number | null } }} [opts]
 *        `now` is the injectable ISO-timestamp source (tests)
 * @returns {Promise<boolean>}  true if a record changed
 */
export async function markPendingTxIndexed(vault, txid, opts = {}) {
    if (!vault || !txid) return false;
    const stamp = typeof opts.now === 'function' ? opts.now : () => new Date().toISOString();
    const inclusion = opts.inclusion && typeof opts.inclusion === 'object' ? opts.inclusion : null;
    const block = Number(inclusion?.blockIndex);
    const matches = await vault.pendingTxs.findBy('txid', txid);
    let changed = false;
    for (const rec of matches) {
        if (rec.status === 'indexed') continue;
        await vault.pendingTxs.put({
            ...rec,
            status: 'indexed',
            confirmedAt: rec.confirmedAt || stamp(),
            ...(inclusion ? {
                chainConfirmed: true,
                confirmedBlockIndex: Number.isInteger(block) && block > 0 ? block : null,
            } : {}),
        });
        changed = true;
    }
    return changed;
}

/**
 * Stamp `mempoolSeenAt` on every PendingTx with this txid: the network has
 * reported holding it (§4 M2.2). FIRST sighting wins, so a record that is
 * already stamped is left alone. That idempotence is load-bearing rather than
 * defensive: one transaction that pays two of our own addresses arrives once
 * per address channel, and a re-stamped record would keep resetting the clock
 * the "dropped or replaced?" reading is measured against.
 *
 * A record the indexer has already confirmed is skipped: a mempool sighting is
 * pre-validation and cannot add anything to a transaction that is in a block.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} txid
 * @param {{ now?: () => string }} [opts]  injectable ISO-timestamp source (tests)
 * @returns {Promise<boolean>}  true if a record changed
 */
export async function markPendingTxMempoolSeen(vault, txid, opts = {}) {
    if (!vault || !txid) return false;
    const stamp = typeof opts.now === 'function' ? opts.now : () => new Date().toISOString();
    const matches = await vault.pendingTxs.findBy('txid', txid);
    let changed = false;
    for (const rec of matches) {
        if (rec.status === 'indexed') continue;
        if (rec.mempoolSeenAt) continue;
        await vault.pendingTxs.put({ ...rec, mempoolSeenAt: stamp() });
        changed = true;
    }
    return changed;
}
