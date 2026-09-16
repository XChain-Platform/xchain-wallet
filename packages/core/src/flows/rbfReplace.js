// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// RBF replacement flow (§29.9): Speed-up / Cancel from History.
//
// The §29 cluster ships the UI surfaces (pending-tx rows in
// History.jsx surface Speed up + Cancel buttons). This flow is the
// contract those buttons call into. Real broadcast wiring depends on
// SDK / encoder support that lands as part of the §44.4 / §44.5
// cluster: building a replacement transaction that respends the
// original tx's UTXOs at a higher fee (Speed up) or routes them to a
// self-controlled output (Cancel).
//
// Until that engine wiring lands, this flow probes for a host-side
// `tx.replace` handler via the shell's messaging layer. Shells that
// haven't registered the handler (which is all of them at the time
// of writing) surface a clear, honest "RBF not yet supported in this
// build" error instead of pretending success.
//
// Output shape: `{ replacementTxHash, broadcastedAt, feeIncrease }`.
// matches what the eventual handler will return; UI written against
// this contract today won't change when the engine ships.

export class RbfNotSupportedError extends Error {
    constructor(reason) {
        super(reason || 'RBF replacement is not supported by this build.');
        this.name = 'RbfNotSupportedError';
    }
}

export class RbfInvalidEntryError extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'RbfInvalidEntryError';
    }
}

/**
 * @typedef {object} RbfRequest
 * @property {string} chainId
 * @property {string} originalTxHash          the tx being replaced (for 'restore' this is the CANCEL tx)
 * @property {'speedup' | 'cancel' | 'restore'} strategy
 * @property {string} [restoreTxHash]         'restore' only: the spend being re-issued
 * @property {string} [feeRate]                explicit fee rate; when omitted, host picks a sensible bump
 * @property {string} [walletId]
 */

/**
 * @typedef {object} RbfResult
 * @property {string} replacementTxHash
 * @property {string} broadcastedAt           ISO timestamp
 * @property {string} [feeIncrease]           coin-denominated decimal string
 */

/**
 * Validate that a History entry is replaceable.
 *
 * Replaceable when:
 *   - blockIndex === 0 (still in mempool)
 *   - action is a coin-moving kind (SEND / SWEEP / DISPENSE / DIVIDEND
 *     / AIRDROP / EXECUTE / DEPOSIT / WITHDRAW)
 *   - txHash is present
 *
 * Phase 4 adds support for additional action kinds; the kind list is
 * deliberately conservative for now.
 *
 * @param {{ action?: string, blockIndex?: number, txHash?: string }} entry
 * @returns {{ ok: boolean, reason?: string }}
 */
export function isEntryReplaceable(entry) {
    if (!entry || typeof entry !== 'object') {
        return { ok: false, reason: 'No entry to replace.' };
    }
    if (typeof entry.txHash !== 'string' || entry.txHash.length === 0) {
        return { ok: false, reason: 'No transaction hash on this entry.' };
    }
    if (Number(entry.blockIndex) !== 0) {
        return { ok: false, reason: 'Already confirmed.' };
    }
    // A blockless entry in shape only: the wallet proved the block itself
    // and keeps the entry so History can show it. Replacing it would bump
    // the fee on a transaction that is already mined.
    if (entry.pending?.chainConfirmed === true) {
        return { ok: false, reason: 'Already confirmed.' };
    }
    const action = String(entry.action || '').toUpperCase();
    const REPLACEABLE_ACTIONS = new Set([
        'SEND', 'SWEEP', 'DISPENSE', 'DIVIDEND', 'AIRDROP',
        'EXECUTE', 'DEPOSIT', 'WITHDRAW',
    ]);
    if (!REPLACEABLE_ACTIONS.has(action)) {
        return { ok: false, reason: `${action} actions are not RBF-replaceable.` };
    }
    return { ok: true };
}

/**
 * Send the replacement request through the shell's messaging layer.
 *
 * @param {object} opts
 * @param {{ replaceTx?: (req: RbfRequest) => Promise<RbfResult> }} opts.messaging
 * @param {RbfRequest} opts.request
 * @returns {Promise<RbfResult>}
 */
export async function sendRbfRequest({ messaging, request } = {}) {
    if (!messaging || typeof messaging.replaceTx !== 'function') {
        throw new RbfNotSupportedError(
            'Replacement engine pending; track §44.4 / §44.5 for the SDK + encoder work.',
        );
    }
    if (!request || typeof request !== 'object') {
        throw new RbfInvalidEntryError('replaceTx: request is required');
    }
    if (typeof request.chainId !== 'string' || request.chainId.length === 0) {
        throw new RbfInvalidEntryError('replaceTx: chainId is required');
    }
    if (typeof request.originalTxHash !== 'string' || request.originalTxHash.length === 0) {
        throw new RbfInvalidEntryError('replaceTx: originalTxHash is required');
    }
    if (request.strategy !== 'speedup'
        && request.strategy !== 'cancel'
        && request.strategy !== 'restore') {
        throw new RbfInvalidEntryError(`replaceTx: unknown strategy "${request.strategy}"`);
    }
    if (request.strategy === 'restore') {
        if (typeof request.restoreTxHash !== 'string' || request.restoreTxHash.length === 0) {
            throw new RbfInvalidEntryError('replaceTx: restoreTxHash is required for the restore strategy');
        }
        // A restore whose two hashes agree asks the engine to replace a
        // transaction with itself: it burns a fee bump and moves nothing.
        // The shape that produces it is a caller passing the ORIGINAL
        // hash as originalTxHash, which is the natural mistake here
        // (every other strategy takes the original), so it is rejected
        // rather than forwarded.
        if (request.restoreTxHash === request.originalTxHash) {
            throw new RbfInvalidEntryError(
                'replaceTx: restoreTxHash must differ from originalTxHash; '
                + 'originalTxHash is the cancel transaction being replaced.',
            );
        }
    }
    return messaging.replaceTx(request);
}

/**
 * Convenience wrapper: validate the entry, build the request, send it.
 *
 * @param {{ messaging: any, entry: any, strategy: 'speedup' | 'cancel', walletId?: string, feeRate?: string }} opts
 * @returns {Promise<RbfResult>}
 */
export async function replaceFromHistoryEntry({ messaging, entry, strategy, walletId, feeRate } = {}) {
    const check = isEntryReplaceable(entry);
    if (!check.ok) throw new RbfInvalidEntryError(check.reason);
    return sendRbfRequest({
        messaging,
        request: {
            chainId: entry.chainId,
            originalTxHash: entry.txHash,
            strategy,
            walletId,
            feeRate,
        },
    });
}

// ── Cancel undo (§37.2 / Cluster D FOLLOWUP 3) ──────────────────────
//
// Undoing a cancel is NOT re-broadcasting the original bytes. Once the
// cancel replacement is in the mempool it owns those UTXOs, and the
// original spend is now the lower-fee conflicting transaction every
// node will refuse. The only move that puts the money back on its way
// is a THIRD transaction that replaces the CANCEL at a higher fee and
// re-issues the original spend's outputs.
//
// That is what `strategy: 'restore'` asks the engine for, and it is why
// `originalTxHash` on a restore request carries the cancel's hash while
// the spend being reproduced rides in `restoreTxHash`. Getting those
// two backwards is the bug this pair of helpers exists to make
// impossible from the UI: `buildCancelUndo` is the only supported way
// to assemble the request.
//
// The window is short and the flow says so rather than pretending
// otherwise: once the cancel confirms, nothing can be replaced and the
// undo is gone for good.

/**
 * Snapshot taken at the moment a cancel is broadcast, carrying exactly
 * what the undo needs. Held by the UI for the life of the toast.
 *
 * @typedef {object} CancelUndoSnapshot
 * @property {string} chainId
 * @property {string} originalTxHash    the spend the user cancelled
 * @property {string} cancelTxHash      the replacement that cancelled it
 * @property {string} [walletId]
 */

/**
 * Build the undo snapshot from the cancelled entry plus the RbfResult
 * the cancel returned. Returns null when the pair cannot support an
 * undo, which is the UI's signal to show no Undo affordance at all
 * rather than a button that fails when pressed.
 *
 * @param {{ entry?: any, result?: any, walletId?: string }} opts
 * @returns {CancelUndoSnapshot | null}
 */
export function cancelUndoSnapshot({ entry, result, walletId } = {}) {
    const originalTxHash = entry?.txHash;
    const cancelTxHash = result?.replacementTxHash;
    const chainId = entry?.chainId;
    if (typeof chainId !== 'string' || chainId.length === 0) return null;
    if (typeof originalTxHash !== 'string' || originalTxHash.length === 0) return null;
    if (typeof cancelTxHash !== 'string' || cancelTxHash.length === 0) return null;
    // A host that echoed the original hash back as the replacement did
    // not actually broadcast a replacement; there is nothing to undo and
    // a restore built from it would be a self-replacement.
    if (cancelTxHash === originalTxHash) return null;
    return { chainId, originalTxHash, cancelTxHash, walletId };
}

/**
 * Is this snapshot still undoable? Fails closed on a confirmed cancel:
 * a mined transaction cannot be replaced, so the affordance has to be
 * withdrawn rather than left to fail at the node.
 *
 * @param {{ snapshot?: CancelUndoSnapshot | null, cancelBlockIndex?: number | null }} opts
 * @returns {{ ok: boolean, reason?: string }}
 */
export function isCancelUndoable({ snapshot, cancelBlockIndex } = {}) {
    if (!snapshot) return { ok: false, reason: 'Nothing to undo.' };
    if (Number(cancelBlockIndex) > 0) {
        return { ok: false, reason: 'The cancellation already confirmed.' };
    }
    return { ok: true };
}

/**
 * Assemble the restore request for a cancel snapshot. Separated from
 * the send so the mapping (cancel hash replaces, original hash is
 * re-issued) has one testable home.
 *
 * @param {{ snapshot: CancelUndoSnapshot, feeRate?: string }} opts
 * @returns {RbfRequest}
 */
export function buildCancelUndo({ snapshot, feeRate } = {}) {
    if (!snapshot) throw new RbfInvalidEntryError('undoCancel: snapshot is required');
    return {
        chainId: snapshot.chainId,
        // The cancel is what sits in the mempool now, so it is what the
        // undo replaces.
        originalTxHash: snapshot.cancelTxHash,
        strategy: 'restore',
        // The spend being put back on the wire.
        restoreTxHash: snapshot.originalTxHash,
        walletId: snapshot.walletId,
        feeRate,
    };
}

/**
 * Undo a cancel: replace the cancel transaction with a re-issue of the
 * spend it killed. Throws RbfNotSupportedError on a host without the
 * engine, exactly as the cancel itself does.
 *
 * @param {{ messaging: any, snapshot: CancelUndoSnapshot, cancelBlockIndex?: number | null, feeRate?: string }} opts
 * @returns {Promise<RbfResult>}
 */
export async function undoCancel({ messaging, snapshot, cancelBlockIndex, feeRate } = {}) {
    const check = isCancelUndoable({ snapshot, cancelBlockIndex });
    if (!check.ok) throw new RbfInvalidEntryError(check.reason);
    return sendRbfRequest({ messaging, request: buildCancelUndo({ snapshot, feeRate }) });
}
