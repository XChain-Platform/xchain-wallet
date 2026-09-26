// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * The identity a pre-flight finding is acknowledged under (§4.2 override).
 *
 * The override gate cannot key on `f.code` alone. That holds only while a
 * report could carry at most one error per code. It cannot: the SDK's
 * `pushSubCommandFindings` (xchain-sdk/src/preflight/index.js) pushes one
 * `DRYRUN_SUBCOMMAND_INVALID` error PER invalid batch sub-command, and the
 * batch check pushes one `PARSE_INVALID` per unparseable command, each tagged
 * with its own `data.commandIndex`. Under a code-scoped set, ticking
 * "Sign anyway" on batch command 2 also satisfied command 5, so one click
 * cleared several distinct network-rejected commands. That is the unsafe
 * direction for an overridable-error gate.
 *
 * `commandIndex` is the discriminator the SDK already stamps and the one
 * Tier-1 precedence reads, so the identity is (code, commandIndex) and NOT the
 * finding's position in `report.findings`. Position is not usable here: the
 * Approve-time re-check replaces the report (useConfirmAction's `setReport`)
 * without clearing the acknowledged set, so an index-keyed override would
 * silently transfer to whatever finding landed in that slot next.
 *
 * A finding with no `commandIndex` keys on its bare code exactly as before, so
 * every single-command report's override identity is unchanged.
 *
 * @param {{ code?: string, data?: { commandIndex?: number } }} f
 * @returns {string | undefined}
 */
export function preflightFindingKey(f) {
    const ci = f?.data?.commandIndex;
    return Number.isInteger(ci) ? `${f.code}#${ci}` : f?.code;
}

const CONSENSUS_INVALID = /^\s*invalid:\s*(.+?)\s*\.?\s*$/i;

/**
 * Return the reason supplied by a completed consensus validation, or null
 * when the finding only describes uncertainty or advice.
 *
 * The encoder and indexer put their authoritative rejection in `status` or
 * `error` with an `invalid:` prefix. This extracts the reason for display;
 * `isHardPreflightFinding` separately applies the producer's override policy.
 *
 * @param {{ severity?: string, data?: { status?: unknown, error?: unknown } }} f
 * @returns {string | null}
 */
export function consensusRefusalReason(f) {
    if (f?.severity !== 'error') return null;
    const candidates = [f?.data?.status, f?.data?.error];
    for (const value of candidates) {
        if (typeof value !== 'string') continue;
        const match = value.match(CONSENSUS_INVALID);
        if (match && match[1].trim()) return match[1].trim().replace(/\.+$/, '');
    }
    return null;
}

/**
 * Format a consensus refusal for the signer without protocol status syntax.
 *
 * @param {{ severity?: string, data?: { status?: unknown, error?: unknown, commandIndex?: number } }} f
 * @returns {string | null}
 */
export function consensusRefusalMessage(f) {
    const reason = consensusRefusalReason(f);
    if (!reason) return null;
    const plainReason = reason.charAt(0).toUpperCase() + reason.slice(1);
    const subject = Number.isInteger(f?.data?.commandIndex)
        ? `batch command ${f.data.commandIndex + 1}`
        : 'this action';
    return `The network refused ${subject}: ${plainReason}.`;
}

/**
 * Decide whether an error is proven and cannot be acknowledged away.
 *
 * A producer's explicit override policy wins over status wording. Batch
 * sub-command refusals are also scoped to one command rather than the whole
 * action, so they stay eligible for per-command acknowledgement.
 *
 * @param {{ severity?: string, overridable?: boolean, data?: object }} f
 * @returns {boolean}
 */
export function isHardPreflightFinding(f) {
    if (f?.severity !== 'error') return false;
    if (f.overridable !== undefined) return f.overridable === false;
    const isSubCommand = f.code === 'DRYRUN_SUBCOMMAND_INVALID'
        || Number.isInteger(f?.data?.commandIndex);
    return !isSubCommand && consensusRefusalReason(f) !== null;
}
