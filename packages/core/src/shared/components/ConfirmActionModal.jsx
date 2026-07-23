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
// confirmation surface. Originally an overlay modal; per operator
// direction 2026-07-22 it renders as a full PAGE in the same frame as the
// action forms (the overlay didn't fit small/mobile viewports), shown in
// place of the form the way picker screens are. The exported name stays
// `ConfirmActionModal` so the  slice wiring and its tests keep
// their vocabulary. Built on the single-encode pipeline (the previewed
// PSBT is the signed PSBT). Anatomy top-to-bottom (§5.2): "Confirm"
// header, intent, balance deltas, pre-flight panel, fee section,
// credentials + HW note, Approve/Reject footer.
//
// Interaction contract (§5.1, page form): exactly two exits, Approve or
// Reject; the header back arrow is Reject. The footer is STICKY so
// Approve/Reject stay reachable however long the intent is (§5.2.7 - a
// safety property, not cosmetic). Once a signature exists both exits
// lock until a terminal state. Approve disables synchronously in the
// click handler's tick, before any await.

import { useState, useCallback } from 'react';
import { Button, Icon, Screen, PageHeader } from '@xchain-wallet/core/ui';
import { ActionIntentSummary } from './ActionIntentSummary.jsx';
import { PreflightPanel } from './PreflightPanel.jsx';
import styles from './ConfirmActionModal.module.css';

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
 * @param {'small'|'full'} [props.screenVariant]             Screen sizing, the caller's shell variant (defaults to 'small')
 * @param {boolean} [props.credentialsReady]                 whether credentials are complete (Approve enabled)
 * @param {Error|string|null} [props.error]                  §5.3.4 in-page error (e.g. a credential failure that re-prompts)
 */
export function ConfirmActionModal({
    phase, composed, report, reportLoading, acknowledged, onAcknowledge,
    canApprove, onApprove, onReject, decoded, simulation, chainLabel,
    credentials, credentialsReady = false, variant = 'action',
    screenVariant = 'small', feeText, error = null,
}) {
    const [approveDisabled, setApproveDisabled] = useState(false);
    const signaturePhase = phase === 'signing' || phase === 'rechecking';
    const terminal = phase === 'done' || phase === 'error' || phase === 'signed-not-broadcast';
    const open = OPEN_PHASES.has(phase);

    // A signature exists once we leave the pre-sign phases into signing and
    // the signer has produced it. We approximate "signature exists" as any
    // non-pre-sign, non-terminal signing phase where reject is unsafe.
    const exitsLocked = signaturePhase && !terminal;

    // Approve disables SYNCHRONOUSLY in the click handler's tick, before any
    // await (§5.1). The parent's onApprove runs the async signing.
    const handleApprove = useCallback((e) => {
        if (e) e.preventDefault();
        if (approveDisabled || !canApprove || !credentialsReady) return;
        setApproveDisabled(true);      // sync, this tick
        Promise.resolve(onApprove({})).catch(() => {}).finally(() => setApproveDisabled(false));
    }, [approveDisabled, canApprove, credentialsReady, onApprove]);

    if (!open) return null;

    // Back = Reject; the chevron stays visible but inert while a
    // signature is in flight (both exits locked).
    const header = (
        <PageHeader
            onBack={onReject}
            backDisabled={exitsLocked}
            title="Confirm"
        />
    );

    return (
        <Screen variant={screenVariant} header={header}>
            <div
                className={styles.page}
                data-testid="confirm-modal"
                aria-label={`Confirm ${decoded?.summary || 'action'}`}
            >
                <div className={styles.header}>
                    <span className={styles.actionLabel}>{decoded?.summary?.split('\n')[0]}</span>
                    <span className={styles.chainBadge} data-testid="confirm-chain-badge">{chainLabel}</span>
                </div>

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

                    {/* §5.3.4: a credential failure returns the page to `ready`
                        with this error set, so the user retypes and re-approves
                        the SAME PSBT. Sits directly above the credentials block
                        so the message is adjacent to the field it refers to. */}
                    {error ? (
                        <div className={styles.error} role="alert" data-testid="confirm-error">
                            {typeof error === 'string' ? error : (error?.message || 'Something went wrong.')}
                        </div>
                    ) : null}

                    <div className={styles.credentials}>
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

                {/* Sticky footer: Approve/Reject stay reachable (§5.2.7). */}
                <footer className={styles.footer}>
                    <Button
                        variant="danger"
                        icon={<Icon.ThumbsDownIcon />}
                        onClick={onReject}
                        disabled={exitsLocked}
                        data-testid="confirm-reject"
                    >
                        Reject
                    </Button>
                    <Button
                        variant="success"
                        icon={<Icon.ThumbsUpIcon />}
                        onClick={handleApprove}
                        disabled={approveDisabled || signaturePhase || terminal || !canApprove || !credentialsReady}
                        data-testid="confirm-approve"
                    >
                        Approve
                    </Button>
                </footer>
            </div>
        </Screen>
    );
}
