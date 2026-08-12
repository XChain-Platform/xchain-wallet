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
// explicit acknowledgment checkbox), the Tier-1 notice saying which party
// answered, a "Could not verify" list, and the "checked at block N" stamp.
// aria-live=polite (assertive on fail).
//
// Exported standalone so the extension approval screen and the co-signer
// preview surface can reuse it (§5.5).

import styles from './PreflightPanel.module.css';

// Tier-1 headline codes (xchain-sdk preflight constants.js). Duplicated as
// literals rather than imported: this component is rendered by the extension
// approval root too, and it must not pull the SDK into that bundle.
const DRYRUN_VALID       = 'DRYRUN_VALID';
const DRYRUN_UNAVAILABLE = 'DRYRUN_UNAVAILABLE';

// Export the pair so a test can pin it against the SDK registry without this
// component importing the SDK (#3935). Adds no runtime import, no bundle weight.
export const TIER1_NOTICE_CODES = Object.freeze({ DRYRUN_VALID, DRYRUN_UNAVAILABLE });

// The preflight report schema version this panel is WRITTEN AGAINST ().
//
// The report contract is additive-only by convention, and the SDK's own
// constants.js says so while noting the rule "has no enforcement point": this
// panel reads `verdict`, `findings[].severity`, `findings[].code`,
// `findings[].overridable`, `findings[]._downgradedBy`, `restricted`,
// `stateHeight` and `unverified` straight off the report and never looks at
// `report.schemaVersion`. So a bump that changed what any of those MEAN would
// be processed silently under v1 assumptions.
//
// This literal is that enforcement point, and it is deliberately build-time
// rather than a runtime check. The panel cannot read the version from the SDK
// (same reason the Tier-1 codes above are literals: it renders inside the
// extension approval root and must stay out of that bundle), and a runtime
// degrade path would be UX for a state that cannot occur - the wallet ships one
// lockfile-pinned SDK, so the report always comes from the version it was built
// against. What CAN happen is an SDK bump landing without anyone re-reading this
// file, and the parity test in test/unit/components/PreflightPanel.tier1Notice.test.jsx
// fails exactly then. Match this to a new REPORT_SCHEMA_VERSION only after
// re-reviewing every field listed above; matching it to silence the test is the
// one thing that turns the gate back into the gap it replaced.
export const SUPPORTED_SCHEMA_VERSION = 1;

// Plain-language copy for the Tier-1 notices. The SDK messages are written
// for a report reader ("relying on client checks"); this surface is read by
// someone about to sign. The SDK's own text still renders underneath the
// unavailable case as the diagnostic detail, because the REASON is what made
//  cost a session: "timeout after 4000ms" names a slow venue, and
// nothing on the screen used to say it.
const NOTICE_COPY = {
    [DRYRUN_VALID]:       'The network checked this action and expects it to succeed.',
    // Covers both ways a Tier-1 verdict goes missing: the network was
    // unreachable, and the network answered but declined to judge (a
    // controller-bound action, a denylisted VM action, a fee-exempt reply).
    // The per-finding message beneath says which, so this line must be true of
    // either - "the network was not reached" was a lie on the declined half.
    [DRYRUN_UNAVAILABLE]: 'A network verdict was not reached, so only local checks ran. This is not a network approval.',
};

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

    // . `info` findings used to render NOWHERE, and DRYRUN_UNAVAILABLE is
    // an `info` finding - so a confirm screen the network never answered was
    // pixel-identical to one the network approved, right down to the "Looks
    // good" chip. That is §4.2's "which party said what" failing in the unsafe
    // direction, and it read as a wallet defect to an experienced reader.
    //
    // Excluded: findings Tier-1 precedence DEMOTED to info (`_downgradedBy`).
    // Those are diagnostics kept for tests and support, and they contradict the
    // verdict by construction - rendering "insufficient balance" under a chip
    // that says the network accepted the action is worse than saying nothing.
    const notices = report.findings.filter((f) => f.severity === 'info' && !f._downgradedBy);
    const unreached = report.findings.some((f) => f.code === DRYRUN_UNAVAILABLE);
    const isFail = report.verdict === 'fail';

    // The chip is the one thing a hurried user reads. A clean local pass with
    // no network answer is not "Looks good"; it is "nobody checked but us".
    const chipText = report.verdict === 'fail' ? 'Will likely fail'
        : report.verdict === 'warn' ? 'Review warnings'
        : unreached ? 'Local checks only'
        : 'Looks good';

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
            // Machine-readable Tier-1 state, so an e2e can assert the network
            // was actually asked instead of inferring it from a chip that used
            // to look the same either way.
            data-dryrun={unreached ? 'unreached' : notices.some((f) => f.code === DRYRUN_VALID) ? 'approved' : 'none'}
            aria-live={isFail ? 'assertive' : 'polite'}
        >
            <div
                // The muted "unreached" palette applies to a PASS only. A warn
                // or fail chip keeps its own colour: the network being silent
                // does not make a client-proven failure less urgent, and this
                // rule is declared after the verdict rules in the stylesheet,
                // so it would otherwise win the cascade and mute them.
                className={`${styles.chip} ${styles[`chip_${report.verdict}`] || ''} ${unreached && report.verdict === 'pass' ? styles.chip_unreached : ''}`.trim()}
                data-testid="preflight-chip"
            >
                {chipText}
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

            {notices.length > 0 ? (
                <ul className={styles.notices} data-testid="preflight-notices">
                    {notices.map((f, i) => (
                        <li
                            key={`${f.code}-${i}`}
                            className={`${styles.finding} ${f.code === DRYRUN_UNAVAILABLE ? styles.findingUnreached : styles.findingNotice}`}
                            data-testid={`preflight-notice-${f.code}`}
                        >
                            <span className={styles.findingMsg}>{NOTICE_COPY[f.code] || f.message}</span>
                            {f.code === DRYRUN_UNAVAILABLE && f.message ? (
                                <span className={styles.noticeDetail}>{f.message}</span>
                            ) : null}
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
