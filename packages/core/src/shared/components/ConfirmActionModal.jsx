// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ConfirmActionModal ( §5.1-5.2). The wallet's single standardized
// confirmation surface: a TRUE modal with exactly two exits, Approve & Sign
// or Reject. Built on the single-encode pipeline (the previewed PSBT is the
// signed PSBT). Anatomy top-to-bottom (§5.2): header, intent, balance
// deltas, pre-flight panel, fee section, credentials + HW note, footer.
//
// Interaction contract (§5.1): full-viewport backdrop, aria-modal, focus
// trap, background inert; backdrop click is a NO-OP (a deliberate difference
// from NoticeModal); Escape = Reject in preflighting/ready; once a signature
// exists both exits lock until a terminal state. Approve disables
// synchronously in the click handler's tick, before any await.

import { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@xchain-wallet/core/ui';
import { useFocusTrap, useInertBackground } from '../utils/focusTrap.js';
import { ActionIntentSummary } from './ActionIntentSummary.jsx';
import { PreflightPanel } from './PreflightPanel.jsx';
import styles from './ConfirmActionModal.module.css';

const PRE_SIGN_PHASES = new Set(['preflighting', 'ready']);
const OPEN_PHASES = new Set(['preflighting', 'ready', 'signing', 'rechecking', 'done', 'error', 'signed-not-broadcast']);

/**
 * @param {object} props
 * @param {import('../hooks/useConfirmAction.js').ConfirmPhase} props.phase
 * @param {object|null} props.composed
 * @param {object|null} props.report
 * @param {boolean} props.reportLoading
 * @param {Set<string>} props.acknowledged
 * @param {(code: string) => void} props.onAcknowledge
 * @param {boolean} props.canApprove
 * @param {(credentials: object) => void} props.onApprove
 * @param {() => void} props.onReject
 * @param {{ summary: string, details: Array<{label: string, value: string}>, warnings: string[] }} props.decoded
 * @param {object|null} [props.simulation]
 * @param {string} props.chainLabel
 * @param {import('react').ReactNode} props.credentials      the SignCredentials block (host wires it)
 * @param {'action'|'psbt'|'message'} [props.variant]
 * @param {boolean} [props.credentialsReady]                 whether credentials are complete (Enter/Approve enabled)
 * @param {Error|string|null} [props.error]                  §5.3.4 in-modal error (e.g. a credential failure that re-prompts)
 */
export function ConfirmActionModal({
    phase, composed, report, reportLoading, acknowledged, onAcknowledge,
    canApprove, onApprove, onReject, decoded, simulation, chainLabel,
    credentials, credentialsReady = false, variant = 'action', feeText, error = null,
}) {
    const rootRef = useRef(null);
    const panelRef = useRef(null);
    const initialFocusRef = useRef(null);
    const [approveDisabled, setApproveDisabled] = useState(false);
    const signaturePhase = phase === 'signing' || phase === 'rechecking';
    const terminal = phase === 'done' || phase === 'error' || phase === 'signed-not-broadcast';
    const open = OPEN_PHASES.has(phase);

    // A signature exists once we leave the pre-sign phases into signing and
    // the signer has produced it. We approximate "signature exists" as any
    // non-pre-sign, non-terminal signing phase where reject is unsafe.
    const exitsLocked = signaturePhase && !terminal;

    useFocusTrap(panelRef, { active: open, initialFocusRef });
    useInertBackground(rootRef, { active: open });

    // Escape = Reject, only in pre-sign phases (§5.1).
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape' && PRE_SIGN_PHASES.has(phase)) {
                e.preventDefault();
                onReject();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, phase, onReject]);

    // Approve disables SYNCHRONOUSLY in the click handler's tick, before any
    // await (§5.1). The parent's onApprove runs the async signing.
    const handleApprove = useCallback((e) => {
        if (e) e.preventDefault();
        if (approveDisabled || !canApprove || !credentialsReady) return;
        setApproveDisabled(true);      // sync, this tick
        Promise.resolve(onApprove({})).catch(() => {}).finally(() => setApproveDisabled(false));
    }, [approveDisabled, canApprove, credentialsReady, onApprove]);

    if (!open) return null;

    return (
        // The overlay is a presentational backdrop only: no onClick handler,
        // so a backdrop click is a true no-op (a deliberate difference from
        // NoticeModal, which dismisses on backdrop). The dialog semantics live
        // on the panel, which is what the focus trap operates over.
        <div
            ref={rootRef}
            className={styles.overlay}
            data-testid="confirm-modal"
        >
            <div
                ref={panelRef}
                className={styles.panel}
                role="dialog"
                aria-modal="true"
                aria-label={`Confirm ${decoded?.summary || 'action'}`}
            >
                {/* Header (pinned) */}
                <header className={styles.header}>
                    <span className={styles.actionLabel}>{decoded?.summary?.split('\n')[0]}</span>
                    <span className={styles.chainBadge} data-testid="confirm-chain-badge">{chainLabel}</span>
                </header>

                {/* Body (scrolls) */}
                <div className={styles.body}>
                    {variant !== 'message' && decoded ? (
                        <ActionIntentSummary decoded={decoded} simulation={simulation} />
                    ) : null}

                    {variant === 'action' ? (
                        <PreflightPanel
                            report={report}
                            loading={reportLoading}
                            acknowledged={acknowledged}
                            onAcknowledge={onAcknowledge}
                        />
                    ) : null}

                    {feeText ? (
                        <div className={styles.fee} data-testid="confirm-fee">{feeText}</div>
                    ) : null}

                    {/* §5.3.4: a credential failure returns the modal to `ready`
                        with this error set, so the user retypes and re-approves
                        the SAME PSBT. Sits directly above the credentials block
                        so the message is adjacent to the field it refers to. */}
                    {error ? (
                        <div className={styles.error} role="alert" data-testid="confirm-error">
                            {typeof error === 'string' ? error : (error?.message || 'Something went wrong.')}
                        </div>
                    ) : null}

                    <div className={styles.credentials} ref={initialFocusRef}>
                        {credentials}
                    </div>

                    <p className={styles.hwNote}>
                        A hardware device verifies native outputs and destinations only; the action
                        data is obfuscated on-chain, so this screen is where you verify the action intent.
                    </p>

                    {phase === 'rechecking' ? (
                        <p className={styles.recheck} data-testid="confirm-rechecking">Re-checking…</p>
                    ) : null}
                    {phase === 'signed-not-broadcast' ? (
                        <p className={styles.queued} data-testid="confirm-queued">
                            Signed - broadcast will retry.
                        </p>
                    ) : null}
                </div>

                {/* Footer (pinned) */}
                <footer className={styles.footer}>
                    <Button
                        variant="secondary"
                        onClick={onReject}
                        disabled={exitsLocked}
                        data-testid="confirm-reject"
                    >
                        Reject
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleApprove}
                        disabled={approveDisabled || signaturePhase || terminal || !canApprove || !credentialsReady}
                        data-testid="confirm-approve"
                    >
                        Approve &amp; Sign on {chainLabel}
                    </Button>
                </footer>
            </div>
        </div>
    );
}
