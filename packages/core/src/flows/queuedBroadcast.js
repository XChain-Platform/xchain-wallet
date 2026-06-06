// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Queued broadcasts — §49.5. When the user signs a tx while offline,
// the signed hex is stashed in a PendingTx record with `status='queued'`
// and `txHex` populated. On reconnection the user explicitly drains
// each record (§49.5 explicitly rules out automatic re-broadcast).
//
// Flows:
//   - `enqueueSignedTx`           — create or update a queued PendingTx
//   - `listQueuedBroadcasts`      — read all status='queued' records
//   - `drainQueuedBroadcast`      — attempt to broadcast a single queued
//                                   record; transition state on result
//   - `discardQueuedBroadcast`    — delete a queued record ("Discard" button)
//
// `submitAction` remains the normal path; this module is the offline
// fallback. Callers wrap `submitAction` calls with try/catch; on a
// broadcast failure that's demonstrably network-related (encoder
// unreachable), they can call `enqueueSignedTx` with the pending-tx
// record to preserve the work.

import { createPendingTx } from '../schemas/pendingTx.js';

export class NoQueuedTxError extends Error {
    constructor(id) {
        super(`queuedBroadcast: no queued PendingTx with id "${id}"`);
        this.name = 'NoQueuedTxError';
        this.pendingTxId = id;
    }
}

/**
 * @typedef {Object} EnqueueSignedTxOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} chain                       coin id (e.g. 'bitcoin')
 * @property {import('../schemas/constants.js').NETWORKS[number]} network
 * @property {string} fromAddress
 * @property {string} toAddress
 * @property {string} action                      e.g. 'SEND'
 * @property {string} actionSummary               plain-English summary
 * @property {string} txHex                       signed tx
 * @property {string} [psbtHex]                   optional — retained for parity with PendingTx shape
 * @property {string} [existingPendingTxId]       if set, update that record instead of creating a new one
 */

/**
 * @typedef {Object} EnqueueSignedTxResult
 * @property {string} pendingTxId
 * @property {import('../schemas/pendingTx.js').PendingTx} pendingTx
 */

/**
 * @param {EnqueueSignedTxOpts} opts
 * @returns {Promise<EnqueueSignedTxResult>}
 */
export async function enqueueSignedTx({
    vault,
    chain,
    network,
    fromAddress,
    toAddress,
    action,
    actionSummary,
    txHex,
    psbtHex = '',
    existingPendingTxId,
}) {
    if (!vault) throw new Error('enqueueSignedTx: vault is required');
    if (typeof txHex !== 'string' || txHex.length === 0) {
        throw new Error('enqueueSignedTx: txHex is required');
    }

    let record;
    if (existingPendingTxId) {
        const existing = await vault.pendingTxs.get(existingPendingTxId);
        if (!existing) throw new NoQueuedTxError(existingPendingTxId);
        record = {
            ...existing,
            status: 'queued',
            txHex,
            psbtHex: existing.psbtHex || psbtHex,
            error: null,
        };
    } else {
        record = createPendingTx({
            chain, network, fromAddress, toAddress, action, actionSummary,
            psbtHex,
        });
        record = { ...record, status: 'queued', txHex };
    }
    await vault.pendingTxs.put(record);
    return { pendingTxId: record.id, pendingTx: record };
}

/**
 * @param {{ vault: import('../storage/Vault.js').Vault, chainId?: string, chainRegistry?: import('../registry/index.js').ChainRegistry }} opts
 * @returns {Promise<import('../schemas/pendingTx.js').PendingTx[]>}
 */
export async function listQueuedBroadcasts({ vault, chainId, chainRegistry }) {
    if (!vault) throw new Error('listQueuedBroadcasts: vault is required');
    const all = await vault.pendingTxs.findBy('status', 'queued');
    if (!chainId) return all;
    const descriptor = chainRegistry?.get?.(chainId);
    if (!descriptor) return all.filter((p) => p.chain === chainId);
    return all.filter(
        (p) => p.chain === descriptor.coin && p.network === descriptor.networkKind,
    );
}

/**
 * @typedef {Object} DrainQueuedBroadcastOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {string} pendingTxId
 * @property {(phase: string, data: object) => void} [onProgress]
 */

/**
 * Attempt to broadcast a single queued PendingTx. Transitions:
 *   success → status='broadcast', broadcastAt = now
 *   failure → stays 'queued', error is recorded for the caller
 *
 * @param {DrainQueuedBroadcastOpts} opts
 * @returns {Promise<{ pendingTx: import('../schemas/pendingTx.js').PendingTx, broadcast: boolean, error: string | null }>}
 */
export async function drainQueuedBroadcast({
    vault,
    sdkRegistry,
    chainRegistry,
    pendingTxId,
    onProgress,
}) {
    if (!vault) throw new Error('drainQueuedBroadcast: vault is required');
    if (!sdkRegistry) throw new Error('drainQueuedBroadcast: sdkRegistry is required');
    if (!chainRegistry) throw new Error('drainQueuedBroadcast: chainRegistry is required');
    if (typeof pendingTxId !== 'string' || !pendingTxId) {
        throw new Error('drainQueuedBroadcast: pendingTxId is required');
    }

    const existing = await vault.pendingTxs.get(pendingTxId);
    if (!existing) throw new NoQueuedTxError(pendingTxId);
    if (existing.status !== 'queued') {
        throw new Error(
            `drainQueuedBroadcast: PendingTx "${pendingTxId}" is not queued (status=${existing.status})`,
        );
    }
    if (!existing.txHex) {
        throw new Error(`drainQueuedBroadcast: PendingTx "${pendingTxId}" has no txHex`);
    }

    // Resolve the SDK instance for the chain by matching (coin, network)
    // in the registry.
    const chainId = chainRegistry.chainIdFor(existing.chain, existing.network);
    if (!chainId) {
        throw new Error(
            `drainQueuedBroadcast: no registered chain for ${existing.chain}/${existing.network}`,
        );
    }
    const sdk = sdkRegistry.get(chainId);

    if (onProgress) {
        try { onProgress('broadcasting', { pendingTxId }); } catch { /* swallow */ }
    }
    try {
        await sdk.encoder.broadcastTx(existing.txHex);
    } catch (err) {
        const msg = err && err.message ? String(err.message) : String(err);
        await vault.pendingTxs.put({ ...existing, error: msg });
        const refreshed = await vault.pendingTxs.get(pendingTxId);
        return { pendingTx: refreshed, broadcast: false, error: msg };
    }

    const broadcast = {
        ...existing,
        status: 'broadcast',
        broadcastAt: new Date().toISOString(),
        error: null,
    };
    await vault.pendingTxs.put(broadcast);
    if (onProgress) {
        try { onProgress('broadcast', { pendingTxId }); } catch { /* swallow */ }
    }
    return { pendingTx: broadcast, broadcast: true, error: null };
}

/**
 * Discard a queued broadcast — user's "Discard" button. Idempotent.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, pendingTxId: string }} opts
 * @returns {Promise<boolean>}   true if a record was removed
 */
export async function discardQueuedBroadcast({ vault, pendingTxId }) {
    if (!vault) throw new Error('discardQueuedBroadcast: vault is required');
    if (typeof pendingTxId !== 'string' || !pendingTxId) {
        throw new Error('discardQueuedBroadcast: pendingTxId is required');
    }
    const existing = await vault.pendingTxs.get(pendingTxId);
    if (!existing || existing.status !== 'queued') return false;
    return await vault.pendingTxs.delete(pendingTxId);
}
