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
//   - `discardQueuedBroadcast`    : delete a queued or interrupted record
//                                   ("Discard" button)
//
// `submitAction` remains the normal path; this module is the offline
// fallback. Callers wrap `submitAction` calls with try/catch; on a
// broadcast failure that's demonstrably network-related (encoder
// unreachable), they can call `enqueueSignedTx` with the pending-tx
// record to preserve the work.

import { createPendingTx, queuedRevealOf } from '../schemas/pendingTx.js';
import { rawTxid } from '../signers/verifySignedTx.js';
import { assertSigningAllowed } from './panicMode.js';
import { assertMainnetActionAllowed } from './mainnetPrelaunch.js';
import { classifyBroadcastFailure, isAlreadyOnNetworkRejection } from './broadcastPermanence.js';
import { releaseAdsReservation, settleAdsReservation } from './ads.js';
import { bookQueuedCommitLeg, bookQueuedDelivery } from './adsDelivery.js';

// §36: a queued send that carries the automatic donation holds the claim on
// the queue under its PendingTx id (submitAction). Delivery or a landed commit
// settles it; a refusal before any leg lands or a discard lets it go.
// Bookkeeping only: it never changes what this drain returns.
async function releaseAdsClaim(vault, pendingTxId) {
    try {
        await releaseAdsReservation({ vault, reservationId: pendingTxId });
    } catch {
        // A refused settings write leaves the claim for reconcileAdsReservation.
    }
}

// Settle the claim once either leg reached the network, even when a later leg
// was refused. The queued contribution belongs to the landed transaction.
async function settleAdsClaim(vault, pendingTxId, record) {
    const reservationId = typeof record?.adsCommit?.reservationId === 'string' && record.adsCommit.reservationId
        ? record.adsCommit.reservationId : pendingTxId;
    try {
        await settleAdsReservation({ vault, reservationId });
    } catch {
        // A refused settings write leaves the claim for reconcileAdsReservation.
    }
}

// In-flight send guard. `broadcastTx` is an irreversible effector, so drains
// and discards of the same record must exclude each other. Each operation
// claims its id synchronously before its first await. Cross-context / crash
// recovery is handled by the persisted 'broadcasting' status transition.
const inFlightDrains = new Set();

// The code a discard rejects with while another drain or discard holds the record.
export const QUEUED_BROADCAST_BUSY = 'QUEUED_BROADCAST_BUSY';

export class NoQueuedTxError extends Error {
    constructor(id) {
        super(`queuedBroadcast: no queued PendingTx with id "${id}"`);
        this.name = 'NoQueuedTxError';
        this.pendingTxId = id;
    }
}

function deliveredTxid(txHex, result, fallback) {
    if (typeof fallback === 'string' && fallback) return fallback;
    let fromBytes = null;
    try { fromBytes = rawTxid(txHex); } catch { /* response or stored id may still be usable */ }
    const response = typeof result === 'string' ? result : result?.txid;
    const normalized = (value) => (
        typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null
    );
    return normalized(fromBytes) ?? normalized(response);
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
 * @property {object | null} [adsCommit]           compose-time ADS verdict for eventual delivery
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
    adsCommit,
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
            ...(adsCommit !== undefined ? { adsCommit } : {}),
        };
    } else {
        record = createPendingTx({
            chain, network, fromAddress, toAddress, action, actionSummary,
            psbtHex,
        });
        record = { ...record, status: 'queued', txHex, ...(adsCommit !== undefined ? { adsCommit } : {}) };
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
 *   success              → status='broadcast', broadcastAt and txid recorded
 *   already on network   → status='broadcast', bytes-derived txid recorded
 *   transient failure    → stays 'queued', error recorded, retry allowed
 *   permanent failure    → status='failed' (§5.3: inputs gone; only a
 *                          re-compose can succeed, so it stops retrying)
 *
 * A record carrying a two-phase reveal (`revealTxHex`, commit not landed) sends
 * its commit and then its reveal. Once the commit is on the network the record
 * is rewritten as the reveal, marked commit-landed, and the transitions above
 * apply to the reveal.
 *
 * @param {DrainQueuedBroadcastOpts} opts
 * @returns {Promise<{ pendingTx: import('../schemas/pendingTx.js').PendingTx, broadcast: boolean, error: string | null, permanence?: 'permanent' | 'transient', alreadyOnNetwork?: boolean }>}
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

    // Claim the id synchronously, before any await, so a concurrent drain or
    // discard in the same context cannot race this irreversible operation.
    if (inFlightDrains.has(pendingTxId)) {
        throw new Error(
            `drainQueuedBroadcast: PendingTx "${pendingTxId}" is already being broadcast or discarded`,
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
        // A queued XChain action on *-mainnet stays queued (no mutation) until launch.
        assertMainnetActionAllowed({
            chainId,
            actionData: { action: existing.action, params: existing.params },
            descriptor: chainRegistry.get?.(chainId),
        });
        const sdk = sdkRegistry.get(chainId);

        // Persist the in-flight status before the network call so a crash
        // between broadcast and the result write leaves a record that resumes
        // deliberately instead of re-broadcasting as a fresh 'queued' drain.
        const inFlight = { ...existing, status: 'broadcasting', error: null };
        await vault.pendingTxs.put(inFlight);

        // The freeze is checked again once the claim is written, the last
        // moment before the bytes leave: a freeze armed during that write
        // (another tab, the popup, a duress entry) stops the send, and the
        // record goes back to 'queued' unsent.
        try {
            assertSigningAllowed();
        } catch (err) {
            await vault.pendingTxs.put(existing);
            throw err;
        }

        if (onProgress) {
            try { onProgress('broadcasting', { pendingTxId }); } catch { /* swallow */ }
        }

        // A two-phase record carries its signed reveal: the commit goes first and
        // the reveal follows in the same drain, so the commit is never sent alone.
        let current = existing;
        const reveal = queuedRevealOf(existing);
        if (reveal) {
            try {
                await sdk.encoder.broadcastTx(existing.txHex);
            } catch (err) {
                // "Already known" is the commit delivered, by an attempt that was
                // interrupted before its reveal: the reveal still has to go out.
                if (!isAlreadyOnNetworkRejection(err)) {
                    return await settleDrainFailure(vault, pendingTxId, existing, err);
                }
            }
            // The commit is on the network, so the record becomes its reveal,
            // marked commit-landed: a crash from here resumes with the reveal
            // alone, and a refused reveal keeps the record 'broadcast' on the
            // commit's txid instead of retiring the commit's spend as 'failed'.
            // The landed commit is booked as its own transaction first, as the live send books it.
            current = {
                ...existing,
                ...(await bookQueuedCommitLeg({ vault, chainRegistry, pendingTxId, adsCommit: existing.adsCommit ?? null })),
                status: 'broadcasting',
                error: null,
                txid: reveal.txid ?? existing.txid,
                txHex: reveal.txHex,
                commitLanded: true,
                commitTxid: existing.txid ?? null,
            };
            try {
                await vault.pendingTxs.put(current);
            } catch {
                // The commit is already out, so the reveal goes out regardless:
                // a refused write leaves the pair on disk, and a resume re-sends
                // the commit, which the node answers as already known.
            }
            // The commit request is a window in which another context can arm
            // the freeze. Keep its landed reveal queued until the freeze lifts.
            try {
                assertSigningAllowed();
            } catch (err) {
                try { await vault.pendingTxs.put({ ...current, status: 'queued', error: null }); } catch { /* retry resumes the pair */ }
                throw err;
            }
        }

        let broadcastResult;
        try {
            broadcastResult = await sdk.encoder.broadcastTx(current.txHex);
        } catch (err) {
            // Settle "already known" as delivery: the node holds this txid, so
            // retiring it as 'failed' would invite a re-compose that pays twice.
            if (isAlreadyOnNetworkRejection(err)) {
                const delivered = {
                    ...current,
                    txid: deliveredTxid(current.txHex, null, current.txid),
                    status: 'broadcast',
                    broadcastAt: new Date().toISOString(),
                    error: null,
                };
                await vault.pendingTxs.put(delivered);
                await bookQueuedDelivery({
                    vault, chainRegistry, pendingTxId, adsCommit: delivered.adsCommit ?? null,
                });
                if (onProgress) {
                    try { onProgress('broadcast', { pendingTxId }); } catch { /* swallow */ }
                }
                return { pendingTx: delivered, broadcast: true, error: null, alreadyOnNetwork: true };
            }
            return await settleDrainFailure(vault, pendingTxId, current, err);
        }

        const broadcast = {
            ...current,
            txid: deliveredTxid(current.txHex, broadcastResult, current.txid),
            status: 'broadcast',
            broadcastAt: new Date().toISOString(),
            error: null,
        };
        await vault.pendingTxs.put(broadcast);
        await bookQueuedDelivery({
            vault, chainRegistry, pendingTxId, adsCommit: broadcast.adsCommit ?? null,
        });
        if (onProgress) {
            try { onProgress('broadcast', { pendingTxId }); } catch { /* swallow */ }
        }
        return { pendingTx: broadcast, broadcast: true, error: null };
    } finally {
        inFlightDrains.delete(pendingTxId);
    }
}

/**
 * Record a drain's refused send. The SAME permanence split the submit path
 * applies, applied again on EVERY retry. A queued transaction whose inputs
 * have since been spent can never confirm as signed, and leaving it 'queued'
 * invites the user to press "Broadcast now" forever on something that is
 * already dead, while the balance it reserves stays committed in their mental
 * model. Permanent failures go to 'failed', where the surface can offer a
 * re-compose instead.
 *
 * Ambiguity resolves to transient (the classifier's own default): re-queuing
 * a doomed transaction wastes a retry, whereas retiring a still-valid signed
 * one loses its fee.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} pendingTxId
 * @param {object} record   the record as this drain last wrote it
 * @param {unknown} err
 */
async function settleDrainFailure(vault, pendingTxId, record, err) {
    const msg = err && err.message ? String(err.message) : String(err);
    const permanence = classifyBroadcastFailure(err);
    const status = permanence === 'permanent' ? 'failed' : 'queued';
    // A refused reveal whose commit landed stays 'broadcast', the rule submitAction applies.
    await vault.pendingTxs.put(status === 'failed' && record.commitLanded === true
        ? commitLandedRecord(record, msg)
        : { ...record, status, error: msg });
    // Settle once the commit landed; only a pair refused before either leg landed releases.
    if (status === 'failed') {
        if (record.commitLanded === true) await settleAdsClaim(vault, pendingTxId, record);
        else await releaseAdsClaim(vault, pendingTxId);
    }
    const refreshed = await vault.pendingTxs.get(pendingTxId);
    return { pendingTx: refreshed, broadcast: false, error: msg, permanence };
}

/**
 * Discard a queued broadcast (the "Discard" button). Idempotent.
 *
 * Removes a record in either status a drain will send: 'queued', or
 * 'broadcasting' left behind by an interrupted claim. A claimed record left in
 * place keeps netting its spend and is rebuilt into the queue on the next boot.
 * A live claim is kept: the operation holding that claim settles it, and this
 * call rejects with code QUEUED_BROADCAST_BUSY rather than resolving false,
 * because the holder can still fail and leave the record queued. A caller
 * keeps or journals its discard on that rejection, as on any other.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, pendingTxId: string }} opts
 * @returns {Promise<boolean>}   true if a record left the queue (removed, or kept as commit-landed);
 *   false when nothing is left to discard (missing or already terminal)
 */
export async function discardQueuedBroadcast({ vault, pendingTxId }) {
    if (!vault) throw new Error('discardQueuedBroadcast: vault is required');
    if (typeof pendingTxId !== 'string' || !pendingTxId) {
        throw new Error('discardQueuedBroadcast: pendingTxId is required');
    }
    if (inFlightDrains.has(pendingTxId)) {
        throw Object.assign(
            new Error(`discardQueuedBroadcast: PendingTx "${pendingTxId}" is already being broadcast or discarded`),
            { code: QUEUED_BROADCAST_BUSY },
        );
    }
    inFlightDrains.add(pendingTxId);
    try {
        const existing = await vault.pendingTxs.get(pendingTxId);
        if (!existing) return false;
        if (existing.status !== 'queued' && existing.status !== 'broadcasting') return false;
        // Keep a discarded reveal whose commit landed, so the commit's spend stays netted.
        if (existing.commitLanded === true) {
            await vault.pendingTxs.put(commitLandedRecord(existing, 'reveal discarded; its commit is already on the network'));
            await releaseAdsClaim(vault, pendingTxId);
            return true;
        }
        const removed = await vault.pendingTxs.delete(pendingTxId);
        // Discarded bytes never pay the donation, so the next send may carry it.
        await releaseAdsClaim(vault, pendingTxId);
        return removed;
    } finally {
        inFlightDrains.delete(pendingTxId);
    }
}

/**
 * Retire a queued reveal or phase-2 whose commit landed: 'broadcast' on the commit's
 * txid, never 'failed' or deleted, since the network holds that commit's spend.
 *
 * @param {object} existing
 * @param {string} error
 * @returns {object}
 */
function commitLandedRecord(existing, error) {
    return {
        ...existing,
        status: 'broadcast',
        broadcastAt: existing.broadcastAt ?? new Date().toISOString(),
        txid: existing.commitTxid ?? existing.txid,
        error,
    };
}
