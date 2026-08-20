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
