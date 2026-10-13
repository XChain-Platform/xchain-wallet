// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ConfirmActionModal (§5.1-5.2). The wallet's single standardized
// confirmation surface. Originally an overlay modal; per operator
// direction 2026-07-22 it renders as a full PAGE in the same frame as the
// action forms (the overlay didn't fit small/mobile viewports), shown in
// place of the form the way picker screens are. The exported name stays
// `ConfirmActionModal` so the slice wiring and its tests keep
// their vocabulary. Built on the single-encode pipeline (the previewed
// PSBT is the signed PSBT). Anatomy top-to-bottom (§5.2): "Confirm"
// header, intent, balance deltas, fee and total section, pre-flight panel,
// credentials + HW note, back/reject and approve footer.
//
// Interaction contract (§5.1, page form): exactly two exits, approve or
// back/reject; the header back arrow rejects the request. Both exits stay
// reachable however long the intent is (§5.2.7 - a safety property, not
// cosmetic). Once a signature exists both exits
// lock until a terminal state. Approve disables synchronously in the
// click handler's tick, before any await.

import { useState, useCallback } from 'react';
import { AddressText, Button, Icon, Screen, PageHeader } from '@xchain-wallet/core/ui';
import { ActionIntentSummary } from './ActionIntentSummary.jsx';
import { PreflightPanel } from './PreflightPanel.jsx';
import { LearnNote } from './LearnNote.jsx';
import { xchainProtocolFeeLine } from '../../flows/protocolFeeDisclosure.js';
import { oracleUsageFeeLine } from '../../flows/oracleFeeDisclosure.js';
import { envelopeTransactionLines } from '../../flows/envelopeFeeDisclosure.js';
import { satsToCoinDecimal } from '../../flows/feeEstimate.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { formatDisplayAmount } from '../utils/amountFormat.js';
import { OriginIdentity } from './OriginIdentity.jsx';
import { useLongOperationStatus } from '../hooks/useLongOperationStatus.js';
import styles from './ConfirmActionModal.module.css';

const OPEN_PHASES = new Set(['preflighting', 'ready', 'signing', 'rechecking', 'done', 'error', 'signed-not-broadcast']);

function formatReviewDecoded(decoded) {
    if (!decoded) return decoded;
    let summary = String(decoded.summary || '');
    const details = (decoded.details || []).map((detail) => {
        if (!/(^|\s)(amount|quantity)$/i.test(String(detail?.label || ''))) return detail;
        const value = String(detail.value ?? '');
        const formatted = formatDisplayAmount(value);
        if (value !== formatted) {
            const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            summary = summary.replace(
                new RegExp(`(^|\\s)${escaped}(?=\\s|$|[),])`),
                (match, prefix) => `${prefix}${formatted}`,
            );
        }
        return { ...detail, value: formatted };
    });
    return { ...decoded, summary, details };
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function reviewActionLabel(decoded, fallback, chainLabel) {
    const summary = String(decoded?.summary || '').trim();
    if (!summary) return fallback;

    const details = decoded?.details || [];
    const amountDetail = details.find((detail) => /^(amount|quantity)$/i.test(String(detail?.label || '')));
    const tokenDetail = details.find((detail) => /^token$/i.test(String(detail?.label || '')));
    const amount = String(amountDetail?.value || '').trim();
    if (amount) {
        const amountMatch = new RegExp(`(^|\\s)${escapeRegExp(amount)}(?=\\s|$)`).exec(summary);
        if (amountMatch) {
            const amountStart = amountMatch.index + amountMatch[1].length;
            const action = summary.slice(0, amountStart).trim();
            const remainder = summary.slice(amountStart + amount.length).trim();
            const token = String(tokenDetail?.value || '').trim()
                || remainder.match(/^([^\s,:;)]+)/)?.[1]
                || '';
            if (action) return [action, amount, token].filter(Boolean).join(' ');
        }
    }

    // Some host decoders carry the amount only in their summary. Keep the
    // visible action, amount and unit while dropping destinations and detail.
    const inlineAmount = summary.match(/^([^:]+?)\s+((?:<\s*)?\d[\d.,]*(?:[eE][+-]?\d+)?)\s+([^\s,:;)]+)/);
    if (inlineAmount) {
        const unit = /^(to|on|for|of|per)$/i.test(inlineAmount[3]) ? '' : inlineAmount[3];
        return [inlineAmount[1], inlineAmount[2], unit].filter(Boolean).join(' ');
    }

    const withoutChain = chainLabel
        ? summary.replace(new RegExp(`\\s+on\\s+${escapeRegExp(chainLabel)}(?=\\s|:|\\(|$)`, 'i'), '')
        : summary;
    const actionPhrase = withoutChain
        .split(/:\s|\s+to\s+/i)[0]
        .replace(/\s+\([^)]*\)\s*$/, '')
        .trim();
    return actionPhrase.split(/\s+/).slice(0, 3).join(' ') || fallback;
}

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
 * @param {string} [props.approveLabel]   overrides the footer action label
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
 * @param {string} [props.requestOrigin]                     browser-verified origin of the site
 *   that requested this approval; omitted for a wallet-initiated action
 * @param {string} [props.headline]                          header line; defaults to the
 *   decoded summary. The psbt/message variants set it explicitly, since neither
 *   renders a composed action's intent as its headline.
 * @param {string|null} [props.refusal]                      fail-closed refusal (§5.5): renders a
 *   blocking alert INSTEAD of the credentials + Approve, for requests the wallet
 *   will not sign at all. Distinct from a pre-flight error, which the user may
 *   acknowledge; a refusal has no override.
 * @param {string|null} [props.sourceAddress] the single spending address on an
 *   action, or the signing address on a message. A caller-supplied PSBT may spend
 *   several owned addresses at once, so its input list identifies them instead.
 * @param {string} [props.sourceName] the address-record label, followed by the
 *   wallet name when more than one wallet exists
 * @param {string} [props.nativeTicker]                      the chain's native ticker, for coin-denominated lines
 *   read off the composed envelope (the oracle usage fee, the envelope's two transactions)
 * @param {(amount: string) => string|null} [props.formatNativeFee]
 * @param {(amount: string) => string|null} [props.formatProtocolFee]
 * @param {string} [props.totalText]                         total debit when amount and fees share one unit
 */
export function ConfirmActionModal({
    phase, composed, report, reportLoading, acknowledged, onAcknowledge,
    canApprove, onApprove, onReject, decoded, simulation, chainLabel,
    approveLabel,
    credentials, credentialsReady = false, variant = 'action',
    screenVariant = 'small', feeText, totalText, error = null,
    psbtPanel = null, messageText, requestOrigin = '', refusal = null, headline,
    sourceAddress = null, sourceName = '', nativeTicker = '',
    formatNativeFee, formatProtocolFee,
}) {
    const formattedDecoded = formatReviewDecoded(decoded);
    const fallbackHeadline = variant === 'message'
        ? 'Sign message'
        : variant === 'psbt'
            ? 'Sign transaction'
            : 'Review action';
    const headlineText = headline !== undefined
        ? headline
        : (formattedDecoded?.summary?.split('\n')[0] || fallbackHeadline);
    const defaultApproveLabel = 'Approve';
    const resolvedApproveLabel = approveLabel || (variant === 'action'
        ? reviewActionLabel(formattedDecoded, defaultApproveLabel, chainLabel)
        : headlineText);
    const reviewDetails = (formattedDecoded?.details || []).map((detail, index) => ({
        ...detail,
        label: detail.label === 'Destination'
            ? 'To'
            : detail.label.replace(/^Recipient(?=\s|$)/, 'To'),
        index,
    })).sort((left, right) => {
        const rank = (label) => {
            if (/^To(?:\s|$)/.test(label)) return 0;
            if (label === 'Amount' || label === 'Quantity') return 1;
            if (/fee/i.test(label)) return 2;
            if (/^total/i.test(label)) return 3;
            return 1;
        };
        return rank(left.label) - rank(right.label) || left.index - right.index;
    }).map(({ index, ...detail }) => detail);
    const reviewDecoded = formattedDecoded
        ? { ...formattedDecoded, details: reviewDetails }
        : formattedDecoded;
    //Read off the composed envelope rather than taken as a prop, for
    // the same reason as the label above: a rule every adapter has to remember
    // is a rule one of them will forget, and the one that forgets shows a
    // "pre-flight unavailable" warning on an ordinary payment.
    const preflightNotApplicable = !!composed?.bareNativePayment;
    // The protocol fee in the DEFAULT (XCHAIN) payment lane, read from
    // the pre-flight report the panel above already renders. The native lane
    // uses the exact coin-denominated line below, so the helper returns null
    // there rather than labelling the same charge as an XCHAIN debit.
    //
    // Action variant only. A caller-supplied PSBT (the psbt variant) was built
    // elsewhere and the wallet cannot tell which lane paid its fee, so a line
    // claiming "from your XCHAIN balance" could be flatly wrong; a bare native
    // payment has no protocol fee at all.
    const protocolFee = (variant === 'action' && !preflightNotApplicable)
        ? xchainProtocolFeeLine({ report, composed })
        : null;
    const protocolFeeFiat = protocolFee && typeof formatProtocolFee === 'function'
        ? formatProtocolFee(protocolFee.amount)
        : null;
    const reportedProtocolFee = report?.quote?.xchainFee;
    const protocolFeeKnownFree = reportedProtocolFee !== undefined
        && reportedProtocolFee !== null
        && /^0+(?:\.0+)?$/.test(String(reportedProtocolFee).trim());
    const paysProtocolFeeNatively = Number(composed?.quote?.requiredFeeSats) > 0
        || Number(composed?.protocolFeeSats) > 0;
    const nativeProtocolFeeSats = paysProtocolFeeNatively
        ? Number(composed?.protocolFeeSats || composed?.quote?.requiredFeeSats)
        : null;
    const nativeProtocolFeeAmount = Number.isFinite(nativeProtocolFeeSats)
        ? satsToCoinDecimal(nativeProtocolFeeSats)
        : null;
    const nativeProtocolFeeFiat = nativeProtocolFeeAmount
        && typeof formatNativeFee === 'function'
        ? formatNativeFee(nativeProtocolFeeAmount)
        : null;
    const protocolFeeUnavailable = variant === 'action'
        && !preflightNotApplicable
        && !reportLoading
        && !protocolFee
        && !protocolFeeKnownFree
        && !paysProtocolFeeNatively;
    // A Mode B dispenser's oracle usage fee: a coin output in these bytes that
    // neither fee line covers. Action variant only, for the reason above.
    const oracleFee = variant === 'action'
        ? oracleUsageFeeLine({ composed, ticker: nativeTicker })
        : null;
    // A Taproot envelope is a commit and a reveal signed on one Approve; list
    // both with their own fees so the total above is not read as one transaction.
    const envelopeLines = variant === 'action'
        ? envelopeTransactionLines({ composed, ticker: nativeTicker })
        : null;
    const [approveDisabled, setApproveDisabled] = useState(false);
    const signaturePhase = phase === 'signing' || phase === 'rechecking';
    const terminal = phase === 'done' || phase === 'error' || phase === 'signed-not-broadcast';
    const open = OPEN_PHASES.has(phase);
    const signingTime = useLongOperationStatus(signaturePhase);

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
                    <OriginIdentity
                        origin={requestOrigin}
                        label="Requesting site"
                        testId="confirm-request-origin"
                    />

                    {/* Settings > Developer Mode > Learn Mode. Renders
                        nothing unless the user asked for it; first in the body
                        because it frames everything under it. */}
                    <LearnNote variant={variant} chainLabel={chainLabel} />

                    {/* §5.5 PSBT variant: the input/output enumeration is the
                        foregrounded content, ABOVE any action-data intent. */}
                    {variant === 'psbt' ? psbtPanel : null}

                    {/* §5.5 message variant: the full text, verbatim and
                        never truncated - it is the whole thing being signed. */}
                    {variant === 'message' && messageText !== undefined ? (
                        <section className={styles.messageBox} aria-label="Message to sign">
                            <p className={styles.messageLabel}>Message to sign</p>
                            <pre className={styles.messageText} data-testid="confirm-message-text">
                                {messageText}
                            </pre>
                        </section>
                    ) : null}

                    {variant === 'action' && reviewDecoded ? (
                        <ActionIntentSummary decoded={reviewDecoded} simulation={simulation} />
                    ) : null}

                    {/* The wallet can hold several addresses per chain, so the
                        action row names the spender alongside the balance debit.
                        Message signing uses the same row for its signing address. */}
                    {(variant === 'action' || variant === 'message') && sourceAddress ? (
                        <dl className={styles.sourceRow} data-testid="confirm-source">
                            <dt className={styles.sourceLabel}>
                                {variant === 'message' ? 'Signing address' : 'From'}
                            </dt>
                            <dd className={styles.sourceValue}>
                                {sourceName ? (
                                    <span className={styles.sourceName}>{sourceName}</span>
                                ) : null}
                                <AddressText address={sourceAddress} highlight truncate={false} />
                            </dd>
                        </dl>
                    ) : null}

                    {/* Pre-flight on the PSBT variant is REPORT-ONLY (§5.5): the
                        wallet cannot rebuild a caller's PSBT, so findings inform
                        but never block. The caller controls `canApprove`; this
                        renders the panel either way so the user still sees them. */}
                    {/* A plain native-coin payment has no XChain action,
                        so pre-flight does not apply to it. Rendering the panel's
                        null-report state here would tell the user "Pre-flight
                        unavailable; proceeding is at your discretion" on an
                        ordinary payment - alarming, and false: nothing failed
                        and nothing is missing. Not applicable means not shown. */}
                    {feeText ? (
                        <div className={styles.fee} data-testid="confirm-fee">{feeText}</div>
                    ) : null}

                    {envelopeLines ? (
                        <div className={styles.fee} data-testid="confirm-envelope-transactions">
                            <div>Two transactions, both signed now and broadcast in order:</div>
                            {envelopeLines.map((line) => (
                                <div key={line.role} data-testid={`confirm-envelope-${line.role}`}>{line.text}</div>
                            ))}
                        </div>
                    ) : null}

                    {/* Directly under the miner fee so the two costs read as
                        one section, and named as itself so neither passes for
                        the other (the same rule the delta rows follow). */}
                    {protocolFee ? (
                        <div className={styles.fee} data-testid="confirm-protocol-fee">
                            {protocolFee.text}{protocolFeeFiat ? ` (${protocolFeeFiat})` : ''}
                        </div>
                    ) : null}

                    {nativeProtocolFeeAmount ? (
                        <div className={styles.fee} data-testid="confirm-native-protocol-fee">
                            Protocol fee: {nativeProtocolFeeAmount} {nativeTicker}
                            {nativeProtocolFeeFiat ? ` (${nativeProtocolFeeFiat})` : ''}
                            {' (sent on-chain and not refunded if the action is rejected)'}
                        </div>
                    ) : null}

                    {protocolFeeUnavailable ? (
                        <div className={styles.fee} data-testid="confirm-protocol-fee-unavailable">
                            Protocol fee estimate unavailable.
                        </div>
                    ) : null}

                    {oracleFee ? (
                        <div className={styles.fee} data-testid="confirm-oracle-fee">{oracleFee.text}</div>
                    ) : null}

                    {totalText ? (
                        <div className={styles.fee} data-testid="confirm-total">{totalText}</div>
                    ) : null}

                    {(variant === 'action' || variant === 'psbt') && !preflightNotApplicable ? (
                        <PreflightPanel
                            report={report}
                            loading={reportLoading}
                            acknowledged={acknowledged}
                            onAcknowledge={onAcknowledge}
                        />
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
                            {typeof error === 'string'
                                ? error
                                : (error?.message || 'The request stopped because the wallet service returned no explanation.')}
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
                    {signingTime.showElapsed ? (
                        <p className={styles.recheck} role="status" data-testid="confirm-signing-elapsed">
                            Signing for {signingTime.elapsedSeconds} seconds. Check your hardware wallet screen if one is connected.
                        </p>
                    ) : null}
                    {signingTime.timedOut ? (
                        <div className={styles.error} role="alert" data-testid="confirm-signing-timeout">
                            Signing is taking longer than expected. Keep this screen open and check the device or wallet service. Before trying again, check History and the queued-transactions banner so you do not submit the same transaction twice.
                        </div>
                    ) : null}
                    {/* this line used to promise a retry, and nothing retries
                        on its own. The queue holds the signed transaction until the
                        user broadcasts it from the queued-transactions banner. */}
                    {phase === 'signed-not-broadcast' ? (
                        <p className={styles.queued} data-testid="confirm-queued">
                            Signed - not broadcast yet.
                        </p>
                    ) : null}
                </div>

                {/* Both exits remain grouped at the end of the review (§5.2.7). */}
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
                        // The explicit accessible name stays identical to the
                        // visible action and amount.
                        aria-label={resolvedApproveLabel}
                    >
                        {resolvedApproveLabel}
                    </Button>
                </footer>
            </div>
        </Screen>
    );
}
