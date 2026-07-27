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

import styles from './PreflightPanel.module.css';

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
            <div className={styles.panel} data-testid="preflight-panel" aria-live="polite" aria-busy="true">
                <span className={styles.spinner}>Checking…</span>
            </div>
        );
    }
    if (!report) {
        return (
            <div className={styles.panel} data-testid="preflight-panel" aria-live="polite">
                <span className={styles.unverified}>Pre-flight unavailable; proceeding is at your discretion.</span>
            </div>
        );
    }

    const errors = report.findings.filter((f) => f.severity === 'error');
    const warnings = report.findings.filter((f) => f.severity === 'warning');
    const isFail = report.verdict === 'fail';

    return (
        <div
            // A screen reader registers a live region's POLITENESS when it
            // first observes the node, and does not reliably pick up an
            // aria-live change made in place. Every branch of this component
            // renders a div at the same position with no key, so React
            // reconciles them to the SAME DOM node - which meant flipping
            // polite -> assertive on a pass -> fail transition (the §4.6
            // Approve-time re-check, or the user editing an amount) left the
            // announcement queued politely instead of interrupting. That is
            // the single most important thing this surface says: the network
            // expects your transaction to fail.
            //
            // Keying on the POLITENESS (not the verdict) remounts the region
            // exactly when the level changes, so the AT re-registers it, while
            // ordinary warn/pass content updates keep the same node and behave
            // like a normal live region. axe-core cannot see this: it checks
            // static violations, not announcement dynamics.
            key={isFail ? 'assertive' : 'polite'}
            className={styles.panel}
            data-testid="preflight-panel"
            data-verdict={report.verdict}
            aria-live={isFail ? 'assertive' : 'polite'}
        >
            <div className={`${styles.chip} ${styles[`chip_${report.verdict}`] || ''}`.trim()} data-testid="preflight-chip">
                {report.verdict === 'pass' ? 'Looks good' : report.verdict === 'warn' ? 'Review warnings' : 'Will likely fail'}
            </div>

            {report.restricted ? (
                <div className={styles.restrictedChip} data-testid="preflight-restricted">Partial check</div>
            ) : null}

            {errors.length > 0 ? (
                <ul className={styles.errors}>
                    {errors.map((f) => (
                        <li key={f.code} className={`${styles.finding} ${styles.findingError}`}>
                            <span className={styles.findingMsg}>{f.message}</span>
                            {f.overridable ? (
                                <label className={styles.ack}>
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
                <ul className={styles.warnings}>
                    {warnings.map((f, i) => (
                        <li key={`${f.code}-${i}`} className={`${styles.finding} ${styles.findingWarning}`}>
                            {f.message}
                        </li>
                    ))}
                </ul>
            ) : null}

            {report.unverified && report.unverified.length > 0 ? (
                <details className={styles.unverifiedList}>
                    <summary>Could not verify ({report.unverified.length})</summary>
                    <ul>
                        {report.unverified.map((u, i) => (<li key={`${u.check}-${i}`}>{u.reason}</li>))}
                    </ul>
                </details>
            ) : null}

            {typeof report.stateHeight === 'number' ? (
                <div className={styles.stamp}>Checked at block {report.stateHeight}</div>
            ) : null}
        </div>
    );
}
