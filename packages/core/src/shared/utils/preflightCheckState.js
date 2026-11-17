// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which state a pre-flight report puts the confirm screen in, decided in one
// place for the confirm page (ConfirmSummary's clean-pass line) and the
// PreflightPanel chip. Zero dependencies on purpose: the panel renders inside
// the extension approval root and must not pull the SDK into that bundle.
//
// A pass needs a POSITIVE answer from the indexer. The old test only looked
// for reasons to refuse, so a report the indexer never answered (no Tier-1
// finding at all) or the dev shell's mock finding read as "Checked against
// the network: this will go through".
//
// The positive answer is the finding the SDK pushes on a valid dry-run
// verdict (xchain-sdk src/preflight/index/tier1_findings.js applyValidVerdict):
// code DRYRUN_VALID, severity info, source 'dryrun', and a `data` object that
// is `{}` for one action or `{ subCommandCount, accepted }` for a batch. The
// dev mock (packages/web/src/hostBridge.js) stamps the same code with source
// 'client' and no `data`, so source and data are what tell them apart.

const DRYRUN_VALID = 'DRYRUN_VALID';
const DRYRUN_UNAVAILABLE = 'DRYRUN_UNAVAILABLE';
const DRYRUN_SUBCOMMAND_UNJUDGED = 'DRYRUN_SUBCOMMAND_UNJUDGED';

export const PREFLIGHT_CHECK_STATES = Object.freeze({
    PASS: 'pass',
    NOT_CHECKED: 'notChecked',
    PARTIAL: 'partial',
    WARN: 'warn',
    FAIL: 'fail',
});

/**
 * Whether a finding is the indexer's own valid verdict on this action.
 *
 * @param {any} f
 * @returns {boolean}
 */
export function isNetworkApprovalFinding(f) {
    return f?.code === DRYRUN_VALID
        && f.severity === 'info'
        && f.source === 'dryrun'
        && f.data !== null
        && typeof f.data === 'object'
        && !Array.isArray(f.data);
}

/**
 * Whether a network approval left part of a batch unjudged or rejected. A
 * finding that carries either count must carry both, and they must match;
 * anything else is read as partly judged rather than as a full approval.
 *
 * @param {any} f   a finding for which isNetworkApprovalFinding is true
 * @returns {boolean}
 */
export function networkApprovalIsPartial(f) {
    const data = f?.data || {};
    const hasTotal = Object.hasOwn(data, 'subCommandCount');
    const hasAccepted = Object.hasOwn(data, 'accepted');
    if (!hasTotal && !hasAccepted) return false;
    return !(Number.isInteger(data.subCommandCount)
        && Number.isInteger(data.accepted)
        && data.accepted === data.subCommandCount);
}

/**
 * The confirm-screen state for a pre-flight report.
 *
 *   fail        the verdict is fail, or any error finding stands
 *   warn        the verdict is warn, or any warning stands (the panel's
 *               "Review warnings"; never a pass)
 *   notChecked  no report, a report with no indexer verdict, a timeout or
 *               decline (DRYRUN_UNAVAILABLE), or a finding that only looks
 *               like an approval (no `dryrun` source, no `data`)
 *   partial     the indexer approved, but a batch was only partly judged, the
 *               report is restricted, or some checks could not be verified
 *   pass        the indexer approved all of it and nothing above applies
 *
 * A thrown or failed pre-flight reaches the screen as a null report
 * (useConfirmAction), so it is notChecked.
 *
 * @param {any} report
 * @returns {'pass'|'notChecked'|'partial'|'warn'|'fail'}
 */
export function preflightCheckState(report) {
    const S = PREFLIGHT_CHECK_STATES;
    if (!report || typeof report !== 'object' || !Array.isArray(report.findings)) return S.NOT_CHECKED;
    const findings = report.findings;
    if (report.verdict === 'fail' || findings.some((f) => f?.severity === 'error')) return S.FAIL;
    if (report.verdict === 'warn' || findings.some((f) => f?.severity === 'warning')) return S.WARN;
    // A timeout or decline outranks any approval in the same report: the two
    // contradict each other, and the safe reading is that nothing was checked.
    if (findings.some((f) => f?.code === DRYRUN_UNAVAILABLE)) return S.NOT_CHECKED;
    const approvals = findings.filter(isNetworkApprovalFinding);
    if (approvals.length === 0 || report.verdict !== 'pass') return S.NOT_CHECKED;
    if (approvals.some(networkApprovalIsPartial)) return S.PARTIAL;
    if (findings.some((f) => f?.code === DRYRUN_SUBCOMMAND_UNJUDGED)) return S.PARTIAL;
    if (report.restricted) return S.PARTIAL;
    if (Array.isArray(report.unverified) && report.unverified.length > 0) return S.PARTIAL;
    return S.PASS;
}
