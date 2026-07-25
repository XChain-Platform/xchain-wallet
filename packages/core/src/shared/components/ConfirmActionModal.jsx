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
 * @param {import('react').ReactNode} [props.psbtPanel]      §5.5 PSBT variant: the input/output
 *   enumeration, which IS the foregrounded content on that variant (the theft in a
 *   hostile PSBT is the output set, not the action data)
 * @param {string} [props.messageText]                       §5.5 message variant: the full
 *   message text being signed, shown verbatim
 * @param {string} [props.headline]                          header line; defaults to the
 *   decoded summary. The psbt/message variants set it explicitly, since neither
 *   renders a composed action's intent as its headline.
 * @param {string|null} [props.refusal]                      fail-closed refusal (§5.5): renders a
 *   blocking alert INSTEAD of the credentials + Approve, for requests the wallet
 *   will not sign at all. Distinct from a pre-flight error, which the user may
 *   acknowledge; a refusal has no override.
 */
export function ConfirmActionModal({
    phase, composed, report, reportLoading, acknowledged, onAcknowledge,
    canApprove, onApprove, onReject, decoded, simulation, chainLabel,
    credentials, credentialsReady = false, variant = 'action',
    screenVariant = 'small', feeText, error = null,
    psbtPanel = null, messageText, refusal = null, headline,
}) {
    const headlineText = headline !== undefined
        ? headline
        : decoded?.summary?.split('\n')[0];
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
        if (approveDisabled || !canApprove || !credentialsReady || refusal) return;
        setApproveDisabled(true);      // sync, this tick
        Promise.resolve(onApprove({})).catch(() => {}).finally(() => setApproveDisabled(false));
    }, [approveDisabled, canApprove, credentialsReady, refusal, onApprove]);

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
                aria-label={`Confirm ${headlineText || 'action'}`}
            >
                <div className={styles.header}>
                    <span className={styles.actionLabel}>{headlineText}</span>
                    <span className={styles.chainBadge} data-testid="confirm-chain-badge">{chainLabel}</span>
                </div>

                <div className={styles.body}>
                    {/* §5.5 PSBT variant: the input/output enumeration is the
                        foregrounded content, ABOVE any action-data intent. */}
                    {variant === 'psbt' ? psbtPanel : null}

                    {/* §5.5 message variant: the full text, verbatim and
                        never truncated - it is the whole thing being signed. */}
                    {variant === 'message' && messageText !== undefined ? (
                        <pre className={styles.messageText} data-testid="confirm-message-text">
                            {messageText}
                        </pre>
                    ) : null}

                    {variant === 'action' && decoded ? (
                        <ActionIntentSummary decoded={decoded} simulation={simulation} />
                    ) : null}

                    {/* Pre-flight on the PSBT variant is REPORT-ONLY (§5.5): the
                        wallet cannot rebuild a caller's PSBT, so findings inform
                        but never block. The caller controls `canApprove`; this
                        renders the panel either way so the user still sees them. */}
                    {variant === 'action' || variant === 'psbt' ? (
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

                    {/* Fail-closed refusal (§5.5): no credentials, no Approve,
                        no override. Rendered where the credentials would be so
                        the user sees WHY there is nothing to sign with. */}
                    {refusal ? (
                        <p className={styles.refusal} role="alert" data-testid="confirm-refusal">
                            {refusal}
                        </p>
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

                    {refusal ? null : (
                        <div className={styles.credentials}>
                            {credentials}
                        </div>
                    )}

                    {/* Transaction-signing caveat only. Message signing moves no
                        coins and has no outputs, so this note would be nonsense
                        on that variant. */}
                    {variant === 'message' ? null : (
                        <p className={styles.hwNote}>
                            A hardware device verifies native outputs and destinations only; the action
                            data is obfuscated on-chain, so this screen is where you verify the action intent.
                        </p>
                    )}

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
                        disabled={approveDisabled || signaturePhase || terminal || !canApprove || !credentialsReady || !!refusal}
                        data-testid="confirm-approve"
                    >
                        Approve
                    </Button>
                </footer>
            </div>
        </Screen>
    );
}
