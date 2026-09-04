// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PreflightPanel (§5.2.4). Renders a PreflightReport: a verdict
// chip, findings grouped by severity with per-finding override affordances
// (non-overridable client errors have none; network-sourced errors carry an
// explicit acknowledgment checkbox), the Tier-1 notice saying which party
// answered, a "Could not verify" list, and the "checked at block N" stamp.
// aria-live=polite (assertive on fail).
//
// Exported standalone so the extension approval screen and the co-signer
// preview surface can reuse it (§5.5).

import styles from './PreflightPanel.module.css';
// Zero-dependency helper, deliberately not the useConfirmAction module: the
// override identity must be ONE definition shared with the Approve gate, and
// this component is rendered by the extension approval root, so it pulls in
// nothing but the key function.
import { preflightFindingKey } from '../utils/preflightFindingKey.js';

// Tier-1 headline codes (xchain-sdk preflight constants.js). Duplicated as
// literals rather than imported: this component is rendered by the extension
// approval root too, and it must not pull the SDK into that bundle.
const DRYRUN_VALID       = 'DRYRUN_VALID';
const DRYRUN_UNAVAILABLE = 'DRYRUN_UNAVAILABLE';
// The two info-severity Tier-1 codes the arbiter answers a BATCH with. Both
// land in the notice list, so both need copy written for a signer; the SDK's
// own sentence still renders beneath, because it carries the command position
// and the amounts owed.
const DRYRUN_SUBCOMMAND_UNJUDGED = 'DRYRUN_SUBCOMMAND_UNJUDGED';
const DRYRUN_ORACLE_FEES_OWED    = 'DRYRUN_ORACLE_FEES_OWED';

// Export the set so a test can pin it against the SDK registry without this
// component importing the SDK (#3935). Adds no runtime import, no bundle weight.
//
// Only codes this panel keys on BY NAME belong here. DRYRUN_INVALID and
// DRYRUN_SUBCOMMAND_INVALID arrive at severity 'error' and render generically
// in the errors list, so a rename of either cannot break this surface, and
// pinning them would register a name with no consumer - the
// second-list-with-no-owner the SDK's own registry header forbids. The parity
// test names those two explicitly instead, so a code ADDED to the Tier-1 family
// still fails there and reaches a human.
export const TIER1_NOTICE_CODES = Object.freeze({
    DRYRUN_VALID,
    DRYRUN_UNAVAILABLE,
    DRYRUN_SUBCOMMAND_UNJUDGED,
    DRYRUN_ORACLE_FEES_OWED,
});

// The preflight report schema version this panel is WRITTEN AGAINST.
//
// The report contract is additive-only by convention (REPORT_SCHEMA_VERSION
// in the SDK's src/preflight/constants.js, which names this pin as the
// enforcement point): this panel reads `verdict`, `findings[].severity`,
// `findings[].code`, `findings[].message`, `findings[].overridable`,
// `findings[]._downgradedBy`, `findings[].data.commandIndex` (the override
// identity is (code, commandIndex), and that pair is what stops one
// "Sign anyway" clearing several network-rejected batch commands at once - see
// utils/preflightFindingKey.js), `findings[].data.subCommandCount` and
// `findings[].data.accepted` (whether the network judged a batch in FULL; the
// notice copy and the verdict chip both branch on them),
// `restricted` (defined beside REPORT_SCHEMA_VERSION there: a proper-subset
// report, never a completeness claim; the "Partial check" chip below),
// `stateHeight`, and `unverified[].check` / `unverified[].reason` straight off
// the report and never looks at
// `report.schemaVersion`. So a bump that changed what any of those MEAN would
// be processed silently under v1 assumptions.
//
// The list is named element-by-element on purpose: a bare `findings` or
// `unverified` reads as covered while the field inside it that actually
// carries safety - `data.commandIndex` - goes unreviewed.
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
// someone about to sign. The SDK's own text still renders underneath as the
// diagnostic detail wherever it says more than the headline does, because the
// REASON is what made cost a session: "timeout after 4000ms" names a slow
// venue, and nothing on the screen used to say it.
//
// An entry is a string where its code carries ONE state and a function of the
// finding where it carries several. The rule is the one the unavailable entry
// below already follows: the sentence must be true of EVERY state its code can
// carry. A fixed string is only safe while that holds, and DRYRUN_VALID stopped
// holding it when the arbiter began answering a BATCH at two levels.
const NOTICE_COPY = {
    // A batch is answered twice over: the transaction is accepted, and each
    // command inside it is judged separately - or not judged at all, because a
    // settlement leg inside a batch answers with no status the probe can read.
    // So `data.accepted` below `data.subCommandCount` means the network did NOT
    // approve everything, and "expects it to succeed" is false of exactly that
    // state. A finding with no sub-command counts is a single action, where it
    // is true; a finding with no `data` at all came from a producer this panel
    // knows nothing about (the dev-shell mock stamps this code over "no
    // on-chain dry-run"), so its own words stand instead of ours.
    [DRYRUN_VALID]: (f) => {
        if (!f || !f.data) return null;
        const total = f.data.subCommandCount;
        const accepted = f.data.accepted;
        if (Number.isInteger(total) && Number.isInteger(accepted) && accepted < total) {
            return `The network accepted this transaction but did NOT confirm every command in it`
                + ` (${accepted} of ${total} confirmed). The rest carry no network approval.`;
        }
        return 'The network checked this action and expects it to succeed.';
    },
    // Covers both ways a Tier-1 verdict goes missing: the network was
    // unreachable, and the network answered but declined to judge (a
    // controller-bound action, a denylisted VM action, a fee-exempt reply).
    // The per-finding message beneath says which, so this line must be true of
    // either - "the network was not reached" was a lie on the declined half.
    [DRYRUN_UNAVAILABLE]: 'A network verdict was not reached, so only local checks ran. This is not a network approval.',
    // One finding per command the network left unjudged. The SDK's sentence
    // names the position and the reason and renders as the detail; the headline
    // has to say what the silence MEANS, which "relying on client checks for
    // it" says only to someone who already knows the trust model.
    [DRYRUN_SUBCOMMAND_UNJUDGED]: 'The network did not judge this command, so only local checks cover it. This is not a network approval of it.',
    // A disclosure, not a verdict: a probe carries no outputs, so the arbiter
    // reports the fees owed instead of checking they are paid. The SDK's text
    // is addressed to whoever SIZES the outputs, which is not the person this
    // screen is in front of, so the amounts render as the detail and the
    // headline says what it means for signing.
    [DRYRUN_ORACLE_FEES_OWED]: 'This batch owes oracle usage fees the pre-flight cannot check are covered. Confirm the amounts below before signing.',
};

/*
 * Resolve one notice into the headline the panel vouches for and the
 * producer's own words beneath it.
 *
 * The detail used to be gated on a single code, which is how the panel came to
 * overwrite a message the SDK had begun varying per outcome: a batch the
 * network only partly accepted read as an unconditional approval, because the
 * fixed copy won and the sentence saying otherwise was never rendered. Showing
 * the producer's sentence whenever it differs from the headline needs no
 * maintenance the next time a code starts varying, and costs one muted line on
 * the cases where it does not.
 */
function noticeText(f) {
    const copy = NOTICE_COPY[f.code];
    const headline = (typeof copy === 'function' ? copy(f) : copy) || f.message;
    return { headline, detail: f.message && f.message !== headline ? f.message : null };
}

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

    //`info` findings used to render NOWHERE, and DRYRUN_UNAVAILABLE is
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

    // The outer answer on a BATCH is not a verdict on the commands inside it,
    // so a network approval can arrive with commands rejected or left unjudged.
    // The rejected half already fails loudly - those findings are errors, so
    // the verdict is 'fail' and the chip says so. The UNJUDGED half is all
    // `info`, which is what let a batch the network explicitly declined to
    // judge arrive here as a clean pass wearing the approval chip.
    const partlyJudged = report.findings.some((f) => f.code === DRYRUN_VALID
        && Number.isInteger(f?.data?.subCommandCount)
        && Number.isInteger(f?.data?.accepted)
        && f.data.accepted < f.data.subCommandCount);

    // The chip is the one thing a hurried user reads. A clean local pass with
    // no network answer is not "Looks good"; it is "nobody checked but us".
    // Neither is a pass the network gave the transaction but not its contents.
    const chipText = report.verdict === 'fail' ? 'Will likely fail'
        : report.verdict === 'warn' ? 'Review warnings'
        : unreached ? 'Local checks only'
        : partlyJudged ? 'Partly checked'
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
            data-dryrun={unreached ? 'unreached'
                : partlyJudged ? 'partial'
                : notices.some((f) => f.code === DRYRUN_VALID) ? 'approved' : 'none'}
            aria-live={isFail ? 'assertive' : 'polite'}
        >
            <div
                // The muted "unreached" palette applies to a PASS only. A warn
                // or fail chip keeps its own colour: the network being silent
                // does not make a client-proven failure less urgent, and this
                // rule is declared after the verdict rules in the stylesheet,
                // so it would otherwise win the cascade and mute them.
                className={`${styles.chip} ${styles[`chip_${report.verdict}`] || ''} ${(unreached || partlyJudged) && report.verdict === 'pass' ? styles.chip_unreached : ''}`.trim()}
                data-testid="preflight-chip"
            >
                {chipText}
            </div>

            {report.restricted ? (
                <div className={styles.restrictedChip} data-testid="preflight-restricted">Partial check</div>
            ) : null}

            {errors.length > 0 ? (
                <ul className={styles.errors}>
                    {/* Keyed on the finding, never on the code: a BATCH report
                        carries one error per rejected sub-command under one
                        shared code, so a code key both collided in React and
                        made a single "Sign anyway" clear every one of them.
                        The list key carries the position too, because two
                        findings CAN share a (code, commandIndex) and a
                        duplicate React key is a dropped row. The override
                        identity deliberately does not: see
                        utils/preflightFindingKey.js. */}
                    {errors.map((f, i) => (
                        <li key={`${preflightFindingKey(f)}-${i}`} className={`${styles.finding} ${styles.findingError}`}>
                            <span className={styles.findingMsg}>{f.message}</span>
                            {f.overridable ? (
                                <label className={styles.ack}>
                                    <input
                                        type="checkbox"
                                        checked={acknowledged.has(preflightFindingKey(f))}
                                        onChange={() => onAcknowledge(preflightFindingKey(f))}
                                        data-testid={`ack-${preflightFindingKey(f)}`}
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
                    {notices.map((f, i) => {
                        const { headline, detail } = noticeText(f);
                        return (
                            <li
                                key={`${f.code}-${i}`}
                                className={`${styles.finding} ${f.code === DRYRUN_UNAVAILABLE ? styles.findingUnreached : styles.findingNotice}`}
                                data-testid={`preflight-notice-${f.code}`}
                            >
                                <span className={styles.findingMsg}>{headline}</span>
                                {detail ? (
                                    <span className={styles.noticeDetail}>{detail}</span>
                                ) : null}
                            </li>
                        );
                    })}
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
