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
// Constraints (protocol + SDK validator + BatchBuilder; canonical statement
// of these rules lives in xchain-sdk/src/batchLimits.js, which this file
// matches in semantics without importing from it): a BATCH may not contain
// a nested BATCH, may hold at most one DEPLOY (every DEPLOY runs a
// constructor through the VM, by far the most expensive per-command work
// the chain does, so the cap protects worst-case cost, not transaction
// size), at most one FILE (one rawData payload per transaction), and at
// most one TOP-LEVEL (undotted) ISSUE - but any number of CHILD ISSUEs,
// whose TICK contains a '.', are exempt from that slot (a parent plus any
// number of child tokens in one transaction). A caret TICK (first
// character '^') is NEVER exempt, even when it contains a dot: its dot is
// an id separator, not a namespace separator, so two caret ISSUEs still
// hit the one-ISSUE limit. MINT may repeat any number of DISTINCT tokens,
// capped at one MINT per token: the chain judges "same token" by its
// resolved id, and a caret-form entry (an id number rather than a name)
// can secretly name the same token as a plain-name entry, which a client
// holding only strings cannot always tell apart - see mintTickCounts
// below for the conservative rule this enforces. A BATCH may also carry
// at most 250 commands total, and, separately, a total COST WEIGHT of at
// most 250: VM actions (DEPLOY, EXECUTE, XEXEC) weigh 30 each and
// fan-out actions (AIRDROP, DIVIDEND) 25 each, everything else 1, so a
// batch can be over budget with far fewer than 250 commands (see
// batchQueueWeight). This file also exports a pure, synchronous
// pre-check so the form can flag violations live without a host
// round-trip; the authoritative check still runs in the SDK at compose
// time.

/** Actions a BATCH can never contain (SDK BatchBuilder + validator). */
export const BATCH_FORBIDDEN_ACTIONS = ['BATCH'];

/**
 * Actions a BATCH may contain at most once, counted flatly. ISSUE only
 * spends this slot for a TOP-LEVEL (undotted, or caret) issuance; see
 * classifyIssueTick. MINT is NOT here: it is capped per distinct token
 * instead, via mintTickCounts.
 */
export const BATCH_SINGLETON_ACTIONS = ['ISSUE', 'DEPLOY', 'FILE'];

/** Maximum number of commands (queued sub-actions) a BATCH may carry. */
export const BATCH_MAX_COMMANDS = 250;

/**
 * Budget the batch's summed cost weight is compared against (the SDK
 * mirror's BATCH_WEIGHT_BUDGET; canonical in xchain-sdk/src/batchLimits.js).
 * Equal to the command cap on purpose: with a default weight of 1 an
 * ordinary all-SEND batch is decided identically by either rule.
 */
export const BATCH_WEIGHT_BUDGET = 250;

/**
 * Per-action COST WEIGHTS (the SDK mirror's BATCH_COMMAND_WEIGHTS). An
 * action absent here weighs the default 1. AIRDROP and DIVIDEND write a
 * row per recipient and take a flat 25; DEPLOY, EXECUTE and XEXEC run
 * contract code and take 30. Every weight is an integer >= 1, which is
 * what keeps the command-count cap a sound pre-filter for the weighted
 * check (count over budget implies weight over budget).
 */
export const BATCH_COMMAND_WEIGHTS = Object.freeze({
    AIRDROP:  25,
    DIVIDEND: 25,
    DEPLOY:   30,
    EXECUTE:  30,
    XEXEC:    30,
});

/**
 * Wire aliases the chain expands before weighing (the SDK decoder's
 * ACTION_ALIASES). Load-bearing for the weights: a DROP is an AIRDROP to
 * the chain, so it must cost 25 here too, not the default 1.
 */
const BATCH_ACTION_ALIASES = Object.freeze({
    TRANSFER: 'SEND',
    ADDR:     'ADDRESS',
    DROP:     'AIRDROP',
    CAST:     'BROADCAST',
    MSG:      'MESSAGE',
});

/**
 * Read a queued entry's VERSION param under any of the key spellings the
 * SDK's createAction accepts (VERSION / version / Version), and resolve it
 * to an integer format number the way the chain does: absent or '' means
 * format 0, an integer (or integer-valued numeric string) up to 255 is
 * taken as-is, anything else is unreadable (null).
 *
 * @param {{ params?: Record<string, unknown> }} entry
 * @returns {number | null}
 */
function entryFormatVersion(entry) {
    const params = entry?.params;
    if (!params || typeof params !== 'object') return 0;
    let raw;
    let found = false;
    for (const key of Object.keys(params)) {
        if (key.replace(/_/g, '').toLowerCase() === 'version') { raw = params[key]; found = true; break; }
    }
    if (!found || raw === undefined || raw === null || raw === '') return 0;
    if (typeof raw === 'number') return (Number.isInteger(raw) && raw <= 255) ? raw : null;
    const str = String(raw).replace(/"|'/g, '');
    if (str === '') return 0;
    const num = Number(str);
    if (Number.isFinite(num) && Number.isInteger(num) && num <= 255) return num;
    return null;
}

/**
 * Cost weight of ONE queued sub-action. Uppercases and alias-expands the
 * action name the same way the rest of this pre-check does, then reads the
 * weight table, with one carve-out mirrored from the chain: a format-4
 * DEPLOY is a chunk carrier that runs no constructor, so it takes the
 * default row-write weight of 1 rather than DEPLOY's VM weight. An entry
 * whose VERSION cannot be read is charged the full weight, the safe
 * (over-charging) direction.
 *
 * @param {{ action: string, params?: Record<string, unknown> }} entry
 * @returns {number}
 */
export function batchEntryWeight(entry) {
    const raw = String(entry?.action || '').toUpperCase();
    const action = Object.prototype.hasOwnProperty.call(BATCH_ACTION_ALIASES, raw)
        ? BATCH_ACTION_ALIASES[raw]
        : raw;
    const weight = BATCH_COMMAND_WEIGHTS[action];
    if (weight === undefined) return 1;
    if (action === 'DEPLOY' && entryFormatVersion(entry) === 4) return 1;
    return (Number.isInteger(weight) && weight >= 1) ? weight : 1;
}

/**
 * Total cost weight of a queued sub-action list. Plain integer arithmetic:
 * these are small counts, not token amounts.
 *
 * @param {Array<{ action: string, params?: Record<string, unknown> }>} subActions
 * @returns {number}
 */
export function batchQueueWeight(subActions) {
    const list = Array.isArray(subActions) ? subActions : [];
    let total = 0;
    for (const entry of list) total += batchEntryWeight(entry);
    return total;
}

/**
 * Classify a queued ISSUE sub-action by its TICK, mirroring the indexer's
 * dotted-TICK exemption (xchain-indexer/src/actions/batch.js
 * classifyLimitAction): a dotted, non-caret TICK is a CHILD issuance and
 * is exempt from the top-level ISSUE slot; everything else (undotted, or
 * any caret TICK regardless of dots) is TOP_LEVEL and counts against it.
 * The TICK lives at `entry.params.TICK`, the same field name the SDK
 * validator requires for ISSUE (`ACTION_REQUIRED_FIELDS.ISSUE`); an entry
 * queued before its params are known (no TICK yet) is treated as
 * TOP_LEVEL so an incomplete row cannot silently claim the exempt slot.
 *
 * @param {{ params?: Record<string, unknown> }} entry
 * @returns {'TOP_LEVEL' | 'CHILD'}
 */
export function classifyIssueTick(entry) {
    const tick = String(entry?.params?.TICK ?? '');
    if (tick.startsWith('^')) return 'TOP_LEVEL';
    return tick.includes('.') ? 'CHILD' : 'TOP_LEVEL';
}

/**
 * Distinctness key for one queued MINT, client-side. Mirrors the SDK
 * mirror's mintTickKey (xchain-sdk/src/batchLimits.js): the literal TICK
 * string is the key, and a caret-form entry (e.g. "^614") is flagged so
 * the caller can tell it apart from a plain name that might secretly name
 * the same token. A TICK not chosen yet shares one bucket ('') the same
 * way the chain buckets every not-yet-created token together.
 *
 * @param {{ params?: Record<string, unknown> }} entry
 * @returns {{ key: string, caret: boolean }}
 */
function mintTickKey(entry) {
    const tick = String(entry?.params?.TICK ?? '').trim();
    if (tick === '') return { key: '', caret: false };
    return { key: tick, caret: tick.charAt(0) === '^' };
}

/**
 * Count queued MINTs per DISTINCT token, as far as a client holding only
 * strings can tell. The chain judges distinctness by the token's resolved
 * id, so a name ("JDOG") and an id-number entry ("^614") can secretly name
 * the SAME token; this function cannot resolve that, so whenever an
 * id-number entry sits alongside any other distinct-looking entry it
 * reports `ambiguous` instead of guessing. See the "THE MIRROR CANNOT BE
 * EXACT ON MINT" section of xchain-sdk/src/batchLimits.js for the full
 * rationale (this is the wallet's copy of the same conservative rule).
 *
 * @param {Array<{ params?: Record<string, unknown> }>} mintEntries
 * @returns {{ maxCount: number, ambiguous: boolean }}
 */
function mintTickCounts(mintEntries) {
    const counts = new Map();
    let maxCount = 0;
    let sawCaret = false;
    for (const entry of mintEntries) {
        const { key, caret } = mintTickKey(entry);
        if (caret) sawCaret = true;
        const count = (counts.get(key) || 0) + 1;
        counts.set(key, count);
        if (count > maxCount) maxCount = count;
    }
    return { maxCount, ambiguous: sawCaret && counts.size > 1 };
}

/**
 * Pure, synchronous BATCH-constraint pre-check over a queued sub-action
 * list. Returns an array of human-readable error strings (empty = ok).
 * Mirrors BatchBuilder._validate so the form can warn before composing;
 * the SDK re-checks authoritatively at compose time.
 *
 * @param {Array<{ action: string, params?: Record<string, unknown> }>} subActions
 * @returns {string[]}
 */
export function validateBatchConstraints(subActions) {
    const errors = [];
    const list = Array.isArray(subActions) ? subActions : [];
    if (list.length === 0) {
        errors.push('Add at least one action to the batch.');
        return errors;
    }
    if (list.length > BATCH_MAX_COMMANDS) {
        errors.push(`A batch can contain at most ${BATCH_MAX_COMMANDS} actions (found ${list.length}).`);
    } else {
        // Weighed only when the count fits, mirroring the chain's ordering: a
        // batch breaking both caps reports the count cap alone, and every
        // weight is >= 1, so a fitting count is the only case worth weighing.
        const weight = batchQueueWeight(list);
        if (weight > BATCH_WEIGHT_BUDGET) {
            errors.push(`These ${list.length} actions have a combined cost weight of ${weight}, `
                + `over the batch budget of ${BATCH_WEIGHT_BUDGET}. Contract actions (DEPLOY, EXECUTE) `
                + `weigh 30 each and mass-distribution actions (AIRDROP, DIVIDEND) weigh 25 each; `
                + `every other action weighs 1. Remove some heavy actions or split the batch.`);
        }
    }
    const counts = { ISSUE: 0, DEPLOY: 0, FILE: 0 };
    const mintEntries = [];
    for (const entry of list) {
        const action = String(entry?.action || '').toUpperCase();
        if (action === 'BATCH') errors.push('A batch cannot contain another batch.');
        if (action === 'ISSUE') {
            if (classifyIssueTick(entry) === 'TOP_LEVEL') counts.ISSUE += 1;
        } else if (action === 'DEPLOY' || action === 'FILE') {
            counts[action] += 1;
        } else if (action === 'MINT') {
            mintEntries.push(entry);
        }
    }
    for (const action of BATCH_SINGLETON_ACTIONS) {
        if (counts[action] > 1) {
            errors.push(`A batch can contain at most one ${action} action (found ${counts[action]}).`);
        }
    }
    const mint = mintTickCounts(mintEntries);
    if (mint.ambiguous) {
        errors.push('Some of these MINTs name a token by its ID number instead of its name, so we cannot tell whether that is the same token as another MINT in this batch. Please spell every token by name and try again.');
    } else if (mint.maxCount > 1) {
        errors.push(`A batch can mint each token at most once (found ${mint.maxCount} MINTs for the same token).`);
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
