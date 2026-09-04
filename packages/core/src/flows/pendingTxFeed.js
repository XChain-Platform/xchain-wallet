// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet's own in-flight sends, read for display (§28.4 / M2.1).
//
// PendingTx records live host-side in the vault and, until now, only ever
// left it through the queued-broadcast lane (`listQueuedBroadcasts`, which
// deliberately sees only `status: 'queued'`: transactions we have NOT sent).
// History needs the opposite set, the ones we HAVE sent and are waiting on,
// because for the first ~85s after a broadcast our own record is the only
// thing on earth that knows the transaction exists: the decoder polls its
// node every 60s, so no mempool row and no WS event can have arrived yet.
//
// What crosses the messaging boundary is a projection, never the record.
// A PendingTx carries `psbtHex` / `txHex`, which are large and are transaction
// material the renderer has no use for; History wants identity, status and
// timing.

import { isLivePendingStatus } from '../shared/utils/pendingHistory.js';

/**
 * @typedef {Object} PendingTxSummary
 * @property {string} id
 * @property {string} chain
 * @property {string} network
 * @property {string} fromAddress
 * @property {string | null} toAddress
 * @property {string} action
 * @property {string} actionSummary
 * @property {string | null} txid
 * @property {string} status
 * @property {string} createdAt
 * @property {string | null} broadcastAt
 * @property {string | null} mempoolSeenAt   M2.2; absent on a v2 record
 * @property {string | null} rbfReplacement
 * @property {string | null} tick
 * @property {string | null} amount
 */

/**
 * @param {object} record
 * @returns {PendingTxSummary}
 */
function summarize(record) {
    return {
        id: String(record.id),
        chain: String(record.chain),
        network: String(record.network),
        fromAddress: String(record.fromAddress),
        toAddress: record.toAddress == null ? null : String(record.toAddress),
        action: String(record.action || ''),
        actionSummary: String(record.actionSummary || ''),
        txid: record.txid == null ? null : String(record.txid),
        status: String(record.status || ''),
        createdAt: String(record.createdAt || ''),
        broadcastAt: record.broadcastAt == null ? null : String(record.broadcastAt),
        mempoolSeenAt: record.mempoolSeenAt == null ? null : String(record.mempoolSeenAt),
        rbfReplacement: record.rbfReplacement == null ? null : String(record.rbfReplacement),
        tick: record.tick == null ? null : String(record.tick),
        amount: record.amount == null ? null : String(record.amount),
    };
}

/**
 * @typedef {Object} LivePendingTxsOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} [chainRegistry]
 * @property {string} chainId
 * @property {string} [address]   restrict to sends FROM this address
 */

/**
 * In-flight sends for one chain (optionally one address), as summaries.
 *
 * "In flight" is `broadcasting` / `broadcast` / `rbf-replaced`: on the
 * network, not yet confirmed. `indexed` is excluded because by then the
 * explorer's confirmed entry is the better record of the same transaction,
 * and `failed` because it never reached the network at all.
 *
 * A record whose chain the registry cannot resolve is matched on `chain`
 * alone, the same fallback `listQueuedBroadcasts` uses, so a custom chain
 * without a descriptor still shows its pending sends.
 *
 * @param {LivePendingTxsOpts} params
 * @returns {Promise<PendingTxSummary[]>}
 */
export async function livePendingTxs({ vault, chainRegistry, chainId, address }) {
    if (!vault) throw new Error('livePendingTxs: vault is required');
    if (!chainId) throw new Error('livePendingTxs: chainId is required');
    const all = await vault.pendingTxs.list();
    const descriptor = chainRegistry?.get?.(chainId) || null;
    const wanted = address ? String(address).toLowerCase() : null;
    const out = [];
    for (const record of Array.isArray(all) ? all : []) {
        if (!record || !record.txid) continue;
        if (!isLivePendingStatus(record.status)) continue;
        if (descriptor) {
            if (record.chain !== descriptor.coin) continue;
            if (record.network !== descriptor.networkKind) continue;
        } else if (record.chain !== chainId) {
            continue;
        }
        if (wanted && String(record.fromAddress || '').toLowerCase() !== wanted) continue;
        out.push(summarize(record));
    }
    return out;
}
