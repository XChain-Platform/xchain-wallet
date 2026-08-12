// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Queued broadcasts (§49.5). When the user signs a tx while offline,
// the signed hex is stashed in a PendingTx record with `status='queued'`
// and `txHex` populated. On reconnection the user explicitly drains
// each record (§49.5 explicitly rules out automatic re-broadcast).
//
// Flows:
//   - `enqueueSignedTx`           : create or update a queued PendingTx
//   - `listQueuedBroadcasts`      : read all status='queued' records
//   - `drainQueuedBroadcast`      : attempt to broadcast a single queued
//                                   record; transition state on result
//   - `discardQueuedBroadcast`    : delete a queued record ("Discard" button)
//
// `submitAction` remains the normal path; this module is the offline
// fallback. Callers wrap `submitAction` calls with try/catch; on a
// broadcast failure that's demonstrably network-related (encoder
// unreachable), they can call `enqueueSignedTx` with the pending-tx
// record to preserve the work.

import { createPendingTx } from '../schemas/pendingTx.js';
import { assertSigningAllowed } from './panicMode.js';
import { classifyBroadcastFailure } from './broadcastPermanence.js';

// In-flight drain guard. `broadcastTx` is an irreversible effector, so two
// concurrent drains of the same record (double-click, or popup + background
// racing) must not both reach the network. A drain claims its id here
// synchronously before its first await, so a second call started in the same
// context sees the claim and short-circuits. Cross-context / crash recovery is
// handled by the persisted 'broadcasting' status transition.
const inFlightDrains = new Set();

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
 * @property {string} [psbtHex]                   optional; retained for parity with PendingTx shape
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
 *   success              → status='broadcast', broadcastAt = now
 *   transient failure    → stays 'queued', error recorded, retry allowed
 *   permanent failure    → status='failed' (§5.3: inputs gone; only a
 *                          re-compose can succeed, so it stops retrying)
 *
 * @param {DrainQueuedBroadcastOpts} opts
 * @returns {Promise<{ pendingTx: import('../schemas/pendingTx.js').PendingTx, broadcast: boolean, error: string | null, permanence?: 'permanent' | 'transient' }>}
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

    // Claim the drain synchronously, before any await, so a concurrent call in
    // the same context short-circuits instead of double-broadcasting.
    if (inFlightDrains.has(pendingTxId)) {
        throw new Error(
            `drainQueuedBroadcast: PendingTx "${pendingTxId}" is already being broadcast`,
        );
    }
    inFlightDrains.add(pendingTxId);
    try {
        const existing = await vault.pendingTxs.get(pendingTxId);
        if (!existing) throw new NoQueuedTxError(pendingTxId);
        // 'queued' is the normal case; 'broadcasting' means a previous drain was
        // interrupted (crash / SW teardown) after claiming the record but before
        // recording its result, so this is a deliberate resume rather than a
        // fresh broadcast. Any other status is terminal and must not re-broadcast.
        if (existing.status !== 'queued' && existing.status !== 'broadcasting') {
            throw new Error(
                `drainQueuedBroadcast: PendingTx "${pendingTxId}" is not queued (status=${existing.status})`,
            );
        }
        if (!existing.txHex) {
            throw new Error(`drainQueuedBroadcast: PendingTx "${pendingTxId}" has no txHex`);
        }

        // §26.5 panic-mode freeze. Broadcasting an already-signed tx invokes no
        // signer, so it would otherwise sail straight through an active freeze -
        // exactly the irreversible-effector gap the freeze exists to close.
        // Checked before touching the network; on a freeze the PendingTx stays
        // 'queued' (no mutation, no partial state) and PanicModeActiveError
        // propagates to the caller.
        assertSigningAllowed();

        // Resolve the SDK instance for the chain by matching (coin, network)
        // in the registry.
        const chainId = chainRegistry.chainIdFor(existing.chain, existing.network);
        if (!chainId) {
            throw new Error(
                `drainQueuedBroadcast: no registered chain for ${existing.chain}/${existing.network}`,
            );
        }
        const sdk = sdkRegistry.get(chainId);

        // Persist the in-flight status before the network call so a crash
        // between broadcast and the result write leaves a record that resumes
        // deliberately instead of re-broadcasting as a fresh 'queued' drain.
        const inFlight = { ...existing, status: 'broadcasting', error: null };
        await vault.pendingTxs.put(inFlight);

        if (onProgress) {
            try { onProgress('broadcasting', { pendingTxId }); } catch { /* swallow */ }
        }
        try {
            await sdk.encoder.broadcastTx(existing.txHex);
        } catch (err) {
            const msg = err && err.message ? String(err.message) : String(err);
            // The SAME permanence split the submit path applies,
            // applied again on EVERY retry. A queued transaction whose inputs
            // have since been spent can never confirm as signed, and leaving it
            // 'queued' invites the user to press "Broadcast now" forever on
            // something that is already dead - while the balance it reserves
            // stays committed in their mental model. Permanent failures go to
            // 'failed', where the surface can offer a re-compose instead.
            //
            // Ambiguity resolves to transient (the classifier's own default):
            // re-queuing a doomed transaction wastes a retry, whereas retiring a
            // still-valid signed one loses its fee.
            const permanence = classifyBroadcastFailure(err);
            const status = permanence === 'permanent' ? 'failed' : 'queued';
            await vault.pendingTxs.put({ ...existing, status, error: msg });
            const refreshed = await vault.pendingTxs.get(pendingTxId);
            return { pendingTx: refreshed, broadcast: false, error: msg, permanence };
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
    } finally {
        inFlightDrains.delete(pendingTxId);
    }
}

/**
 * Discard a queued broadcast (the "Discard" button). Idempotent.
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
