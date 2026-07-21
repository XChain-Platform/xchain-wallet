// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PreflightPanel ( §5.2.4). Renders a PreflightReport: a verdict
// chip, findings grouped by severity with per-finding override affordances
// (non-overridable client errors have none; network-sourced errors carry an
// explicit acknowledgment checkbox), a "Could not verify" list, and the
// "checked at block N" stamp. aria-live=polite (assertive on fail).
//
// Exported standalone so the extension approval screen and the co-signer
// preview surface can reuse it (§5.5).

/**
 * @param {object} props
 * @param {import('xchain-sdk').PreflightReport | null} props.report
 * @param {boolean} [props.loading]                       true while the report streams in
 * @param {Set<string>} props.acknowledged                codes the user has explicitly acknowledged
 * @param {(code: string) => void} props.onAcknowledge
 */
export function PreflightPanel({ report, loading, acknowledged, onAcknowledge }) {
    if (loading && !report) {
        return (
            <div className="preflight-panel" data-testid="preflight-panel" aria-live="polite" aria-busy="true">
                <span className="preflight-spinner">Checking…</span>
            </div>
        );
    }
    if (!report) {
        return (
            <div className="preflight-panel" data-testid="preflight-panel" aria-live="polite">
                <span className="preflight-unverified">Pre-flight unavailable; proceeding is at your discretion.</span>
            </div>
        );
    }

    const errors = report.findings.filter((f) => f.severity === 'error');
    const warnings = report.findings.filter((f) => f.severity === 'warning');
    const isFail = report.verdict === 'fail';

    return (
        <div
            className="preflight-panel"
            data-testid="preflight-panel"
            data-verdict={report.verdict}
            aria-live={isFail ? 'assertive' : 'polite'}
        >
            <div className={`preflight-chip preflight-chip--${report.verdict}`} data-testid="preflight-chip">
                {report.verdict === 'pass' ? 'Looks good' : report.verdict === 'warn' ? 'Review warnings' : 'Will likely fail'}
            </div>

            {report.restricted ? (
                <div className="preflight-restricted-chip" data-testid="preflight-restricted">Partial check</div>
            ) : null}

            {errors.length > 0 ? (
                <ul className="preflight-errors">
                    {errors.map((f) => (
                        <li key={f.code} className="preflight-finding preflight-finding--error">
                            <span className="preflight-finding-msg">{f.message}</span>
                            {f.overridable ? (
                                <label className="preflight-ack">
                                    <input
                                        type="checkbox"
                                        checked={acknowledged.has(f.code)}
                                        onChange={() => onAcknowledge(f.code)}
                                        data-testid={`ack-${f.code}`}
                                    />
                                    Sign anyway
                                </label>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}

            {warnings.length > 0 ? (
                <ul className="preflight-warnings">
                    {warnings.map((f, i) => (
                        <li key={`${f.code}-${i}`} className="preflight-finding preflight-finding--warning">
                            {f.message}
                        </li>
                    ))}
                </ul>
            ) : null}

            {report.unverified && report.unverified.length > 0 ? (
                <details className="preflight-unverified-list">
                    <summary>Could not verify ({report.unverified.length})</summary>
                    <ul>
                        {report.unverified.map((u, i) => (<li key={`${u.check}-${i}`}>{u.reason}</li>))}
                    </ul>
                </details>
            ) : null}

            {typeof report.stateHeight === 'number' ? (
                <div className="preflight-stamp">Checked at block {report.stateHeight}</div>
            ) : null}
        </div>
    );
}
