// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// batchCommand (PC-36): assemble a BATCH's COMMAND string from queued
// sub-actions, and pre-check the BATCH constraints client-side.
//
// A BATCH executes several actions atomically in one transaction; the
// wire format is `VERSION|COMMAND` where COMMAND is the sub-actions'
// canonical strings joined by ';' (each sub-action already carries its
// own explicit VERSION). The heavy lifting - per-sub-action validation,
// ticker/address compaction, canonical serialization, and the joined
// command - is done by the SDK's BatchBuilder (sdk.batch()); this flow
// wraps it so the composer can (1) get a preview command + per-step
// strings to show before signing, and (2) reuse the generic advancedAction
// signing path with action='BATCH', params={ COMMAND }.
//
// Constraints (protocol + SDK validator + BatchBuilder): a BATCH may not
// contain a nested BATCH or a DEPLOY, and may hold at most one each of
// ISSUE, MINT, and FILE (one rawData per transaction). This file also
// exports a pure, synchronous pre-check so the form can flag violations
// live without a host round-trip; the authoritative check still runs in
// the SDK at compose time.

/** Actions a BATCH can never contain (SDK BatchBuilder + validator). */
export const BATCH_FORBIDDEN_ACTIONS = ['BATCH', 'DEPLOY'];

/** Actions a BATCH may contain at most once. */
export const BATCH_SINGLETON_ACTIONS = ['ISSUE', 'MINT', 'FILE'];

/**
 * Pure, synchronous BATCH-constraint pre-check over a queued sub-action
 * list. Returns an array of human-readable error strings (empty = ok).
 * Mirrors BatchBuilder._validate so the form can warn before composing;
 * the SDK re-checks authoritatively at compose time.
 *
 * @param {Array<{ action: string }>} subActions
 * @returns {string[]}
 */
export function validateBatchConstraints(subActions) {
    const errors = [];
    const list = Array.isArray(subActions) ? subActions : [];
    if (list.length === 0) {
        errors.push('Add at least one action to the batch.');
        return errors;
    }
    const counts = { ISSUE: 0, MINT: 0, FILE: 0 };
    for (const entry of list) {
        const action = String(entry?.action || '').toUpperCase();
        if (action === 'BATCH') errors.push('A batch cannot contain another batch.');
        if (action === 'DEPLOY') errors.push('A batch cannot contain a DEPLOY (too large for one transaction).');
        if (action in counts) counts[action] += 1;
    }
    for (const action of BATCH_SINGLETON_ACTIONS) {
        if (counts[action] > 1) {
            errors.push(`A batch can contain at most one ${action} action (found ${counts[action]}).`);
        }
    }
    return errors;
}

/**
 * Build the BATCH COMMAND string (and the per-step canonical strings) for
 * a queued sub-action list via the SDK BatchBuilder. The builder validates
 * every sub-action, enforces the BATCH constraints (throwing a structured
 * SDKValidationError on violation), resolves tickers/addresses to their
 * wire form, and joins the sub-actions with ';'. No encoder pubkey is
 * passed, so this composes the command string only - no PSBT is built and
 * nothing is signed.
 *
 * FILE sub-actions that carry a `rawData` payload are out of scope here
 * (the generic composer does not move file bytes; the dedicated gated /
 * file publishers own that BATCH shape). The caller is expected to keep
 * FILE out of the queue; if one slips through without rawData the builder
 * still serializes it, and the constraint pre-check bounds it to one.
 *
 * @param {{ sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry, chainId: string, subActions: Array<{ action: string, params: Record<string, unknown> }> }} params
 * @returns {Promise<{ command: string, subStrings: string[] }>}
 */
export async function buildBatchCommand({ sdkRegistry, chainId, subActions }) {
    if (!sdkRegistry) throw new Error('buildBatchCommand: sdkRegistry is required');
    if (!chainId) throw new Error('buildBatchCommand: chainId is required');
    if (!Array.isArray(subActions) || subActions.length === 0) {
        throw new Error('buildBatchCommand: at least one sub-action is required');
    }
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.batch !== 'function') {
        throw new Error('buildBatchCommand: this SDK build has no BATCH support');
    }
    const builder = sdk.batch();
    for (const entry of subActions) {
        builder.add(entry.action, entry.params || {});
    }
    // No encoder opts -> command-only build (no pubkey, so no PSBT is
    // constructed); constraint + per-sub-action validation still runs and
    // throws on violation.
    const built = await builder.build();
    const actionString = String(built?.actionString || '');
    // BATCH v0 is `BATCH|0|<command>`; recover COMMAND for the reusable
    // advancedAction signing path. Guard the shape so a format change here
    // surfaces loudly instead of signing a malformed command.
    const prefix = 'BATCH|0|';
    if (!actionString.startsWith(prefix)) {
        throw new Error(`buildBatchCommand: unexpected BATCH action string "${actionString.slice(0, 24)}…"`);
    }
    const command = actionString.slice(prefix.length);
    return { command, subStrings: command.split(';') };
}
