// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// RBF replacement flow — §29.9 Speed-up / Cancel from History.
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
// Output shape — `{ replacementTxHash, broadcastedAt, feeIncrease }` —
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
 * @property {string} originalTxHash
 * @property {'speedup' | 'cancel'} strategy
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
            'Replacement engine pending — track §44.4 / §44.5 for the SDK + encoder work.',
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
    if (request.strategy !== 'speedup' && request.strategy !== 'cancel') {
        throw new RbfInvalidEntryError(`replaceTx: unknown strategy "${request.strategy}"`);
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
