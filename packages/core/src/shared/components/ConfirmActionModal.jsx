// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ConfirmActionModal (§5.1-5.2) is the wallet's standardized full-screen
// confirmation surface. It replaces the action form within the same Screen
// frame and uses the single-encode pipeline, so the previewed PSBT is the
// signed PSBT. Anatomy top-to-bottom (§5.2): "Confirm" header, intent,
// balance deltas, fee and total section, pre-flight panel, credentials and
// hardware note, then the pinned reject and approve footer.
//
// Interaction contract (§5.1, page form): exactly two exits, approve or
// back/reject; the header back arrow rejects the request. Both exits stay
// reachable however long the intent is (§5.2.7 - a safety property, not
// cosmetic). Once a signature exists both exits
// lock until a terminal state. Approve disables synchronously in the
// click handler's tick, before any await.

import { useState, useCallback, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { AddressText, Button, Icon, Screen, PageHeader, StatusMessage } from '@xchain-wallet/core/ui';
import { ActionIntentSummary } from './ActionIntentSummary.jsx';
import { PreflightPanel } from './PreflightPanel.jsx';
import { LearnNote } from './LearnNote.jsx';
import { xchainProtocolFeeLine } from '../../flows/protocolFeeDisclosure.js';
import { oracleUsageFeeLine } from '../../flows/oracleFeeDisclosure.js';
import { envelopeTransactionLines } from '../../flows/envelopeFeeDisclosure.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { formatDisplayAmount } from '../utils/amountFormat.js';
import { formatUnixSecondsLocal } from '../utils/dateTime.js';
import { formatNativeBaseUnits } from '../../registry/coinTicker.js';
import { defaultRegistry } from '../../registry/index.js';
import { OriginIdentity } from './OriginIdentity.jsx';
import { useFocusTrap } from '../utils/focusTrap.js';
import { approveSettle } from '../utils/approveSettle.js';
import { useLongOperationStatus } from '../hooks/useLongOperationStatus.js';
import { CONTRACT_CALL_WARNING } from '../utils/securityMomentCopy.js';
import { WalletIdentity } from './WalletIdentity.jsx';
import { MessagingContext } from '../MessagingContext.js';
import { readActiveWallet } from '../utils/activeWalletMemory.js';
import styles from './ConfirmActionModal.module.css';
import { t } from '../../i18n/index.js';

const OPEN_PHASES = new Set(['preflighting', 'ready', 'signing', 'rechecking', 'done', 'error', 'signed-not-broadcast']);
const chainRegistry = defaultRegistry();

function useSigningWallet(wallet) {
    const messaging = useContext(MessagingContext)?.messaging;
    const walletId = wallet ? null : readActiveWallet();
    const [resolution, setResolution] = useState(null);

    useEffect(() => {
        let cancelled = false;
        if (wallet) return undefined;
        if (!walletId || typeof messaging?.listWallets !== 'function') return undefined;
        Promise.resolve().then(() => messaging.listWallets()).then((walletsValue) => {
            if (cancelled) return;
            const wallets = Array.isArray(walletsValue) ? walletsValue : [];
            setResolution({
                messaging,
                walletId,
                wallet: wallets.find((candidate) => candidate.id === walletId) || null,
            });
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [messaging, wallet, walletId]);

    if (wallet) return wallet;
    return resolution?.messaging === messaging && resolution?.walletId === walletId
        ? resolution.wallet
        : null;
}

function formatReviewDecoded(decoded) {
    if (!decoded) return decoded;
    let summary = String(decoded.summary || '');
    const details = (decoded.details || []).map((detail) => {
        // An EXPIRATION travels as Unix seconds; the review shows the moment it names.
        if (String(detail?.label || '') === 'Expiration') {
            const when = formatUnixSecondsLocal(detail.value);
            return when ? { ...detail, value: when } : detail;
        }
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

function reportWithoutUnverifiedNativeFeeWarning(report) {
    if (!Array.isArray(report?.findings)) return report;
    const findings = report.findings.filter((finding) => (
        finding?.code !== 'NATIVE_FEE_FORFEIT'
    ));
    if (findings.length === report.findings.length) return report;
    const hasVisibleConcern = findings.some((finding) => (
        finding?.severity === 'warning' || finding?.severity === 'error'
    )) || report.restricted || (report.unverified?.length > 0);
    return {
        ...report,
        findings,
        verdict: report.verdict === 'warn' && !hasVisibleConcern ? 'pass' : report.verdict,
    };
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function reviewDetailLabel(label) {
    const value = String(label || '');
    if (value === 'Give') return 'You send';
    if (value === 'Get') return 'You get';
    if (/^(?:Destination|Receive address|Dispenser address|Delegate to)$/.test(value)) return 'To';
    return value.replace(/^Recipient(?=\s|$)/, 'To');
}

export function reviewActionLabel(decoded, fallback, chainLabel) {
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

    const withoutChain = typeof chainLabel === 'string' && chainLabel
        ? summary.replace(new RegExp(`\\s+on\\s+${escapeRegExp(chainLabel)}(?=\\s|:|\\(|$)`, 'i'), '')
        : summary;
    const actionPhrase = withoutChain
        .split(/:\s|\s+to\s+/i)[0]
        .replace(/\s+\([^)]*\)\s*$/, '')
        .trim();
    const words = actionPhrase.split(/\s+/);
    // A list of categories ("Sweep balances, ownerships, open orders, open
    // dispensers") cut at three words reads "Sweep balances, ownerships," or
    // "Sweep balances, open": a trailing comma, and a button that hides the
    // orders and dispensers the sweep closes. The verb alone is accurate; the
    // summary line above the details lists everything.
    if (words.length > 3 && actionPhrase.includes(',')) return words[0] || fallback;
    return words.slice(0, 3).join(' ') || fallback;
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
 * @param {{ id: string, name?: string } | null} [props.signingWallet] wallet that will approve the request
 * @param {boolean} [props.hardwareSigner] whether approval happens on a hardware device
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
    signingWallet = null, hardwareSigner = false,
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
    const actionHeaderLabel = variant === 'action' && formattedDecoded
        ? resolvedApproveLabel
        : headlineText;
    const isContractCall = variant === 'action'
        && /^(?:contract call|call contract\b)/i.test(headlineText);
    const reviewDetails = (formattedDecoded?.details || []).map((detail, index) => ({
        ...detail,
        label: reviewDetailLabel(detail.label),
        index,
    })).sort((left, right) => {
        const rank = (label) => {
            if (/^To(?:\s|$)/.test(label)) return 0;
            if (label === 'You send') return 1;
            if (label === 'You get') return 2;
            if (label === 'Amount' || label === 'Quantity') return 3;
            if (/fee/i.test(label)) return 4;
            if (/^total/i.test(label)) return 5;
            return 3;
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
    const descriptor = composed?.chainId ? chainRegistry.get(composed.chainId) : null;
    const nativeProtocolFeeAmount = Number.isFinite(nativeProtocolFeeSats)
        ? formatNativeBaseUnits(nativeProtocolFeeSats, descriptor)
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
    // The SDK advisory is action-based and does not know whether these bytes
    // contain a native-coin fee output. The exact fee row above is the one
    // reliable disclosure: it renders once when an output is present and is
    // absent when the fee uses XCHAIN or the action is free.
    const displayedReport = reportWithoutUnverifiedNativeFeeWarning(report);
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
    const resolvedSigningWallet = useSigningWallet(signingWallet);
    const [approvalAttempt, setApprovalAttempt] = useState(null);
    const signaturePhase = phase === 'signing' || phase === 'rechecking';
    const terminal = phase === 'done' || phase === 'error' || phase === 'signed-not-broadcast';
    const open = OPEN_PHASES.has(phase);
    const pageRef = useRef(null);
    const titleRef = useRef(null);
    useFocusTrap(pageRef, { active: open, initialFocusRef: titleRef });
    const previewReady = phase === 'ready' && !reportLoading;
    const [settledRequest, setSettledRequest] = useState(null);
    useEffect(() => {
        if (!previewReady || approveSettle.ms <= 0) return undefined;
        const timer = setTimeout(() => setSettledRequest(composed ?? true), approveSettle.ms);
        return () => clearTimeout(timer);
    }, [previewReady, composed]);
    const approveSettled = previewReady && (approveSettle.ms <= 0 || settledRequest === (composed ?? true));
    const approveDisabled = approvalAttempt !== null && approvalAttempt.request === composed;
    const signingTime = useLongOperationStatus(signaturePhase);

    useLayoutEffect(() => {
        if (!open) return;
        const scroller = pageRef.current?.querySelector('main');
        if (scroller) scroller.scrollTop = 0;
        titleRef.current?.focus({ preventScroll: true });
    }, [composed, open]);

    useEffect(() => {
        if (!open) return;
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.closest('[data-testid="confirm-modal"]')) {
            active.blur();
        }
    }, [composed, open]);

    // A signature exists once we leave the pre-sign phases into signing and
    // the signer has produced it. We approximate "signature exists" as any
    // non-pre-sign, non-terminal signing phase where reject is unsafe.
    const exitsLocked = signaturePhase && !terminal;

    useEffect(() => {
        if (!open || exitsLocked) return undefined;
        const handleEscape = (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            onReject();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [exitsLocked, onReject, open]);

    // Approve disables SYNCHRONOUSLY in the click handler's tick, before any
    // await (§5.1). The parent's onApprove runs the async signing. The ref is
    // the guard: two clicks dispatched in one task both read the render's
    // approveDisabled before React re-renders, so state alone let a double tap
    // start two signing requests. The ref holds the same attempt as the
    // state, so a newly composed request is never blocked by an older one.
    const approveInFlightRef = useRef(null);
    const handleApprove = useCallback((e) => {
        if (e) e.preventDefault();
        if (approveInFlightRef.current && approveInFlightRef.current.request === composed) return;
        if (approveDisabled || !approveSettled || !canApprove || !credentialsReady || refusal) return;
        const attempt = { request: composed };
        const finish = () => {
            if (approveInFlightRef.current === attempt) approveInFlightRef.current = null;
            setApprovalAttempt((current) => current === attempt ? null : current);
        };
        approveInFlightRef.current = attempt;
        setApprovalAttempt(attempt);      // sync, this tick
        try {
            Promise.resolve(onApprove({})).catch(() => {}).finally(finish);
        } catch {
            finish();
        }
    }, [approveDisabled, approveSettled, canApprove, credentialsReady, refusal, composed, onApprove]);

    const handleReject = useCallback((e) => {
        if (e) e.preventDefault();
        try {
            Promise.resolve(onReject()).catch(() => {});
        } catch { /* Event callbacks have no rejection consumer. */ }
    }, [onReject]);

    if (!open) return null;

    // Back = Reject; the chevron stays visible but inert while a
    // signature is in flight (both exits locked).
    const header = (
        <PageHeader
            nested
            onBack={handleReject}
            backDisabled={exitsLocked}
            title={t('common.confirm')}
            titleRef={titleRef}
        />
    );
    const footer = (
        <div className={styles.footer}>
            <Button
                variant="secondary"
                icon={<Icon.ThumbsDownIcon />}
                onClick={handleReject}
                disabled={exitsLocked}
                data-testid="confirm-reject"
            >
                {t('extension.approval.reject')}
            </Button>
            <Button
                variant="success"
                icon={<Icon.ThumbsUpIcon />}
                onClick={handleApprove}
                disabled={approveDisabled || !approveSettled || signaturePhase || terminal || !canApprove || !credentialsReady || !!refusal}
                data-testid="confirm-approve"
                aria-label={resolvedApproveLabel}
            >
                {resolvedApproveLabel}
            </Button>
        </div>
    );

    // The confirm page always opens at its top; it must not inherit how far
    // the form behind it was scrolled.
    return (
        <Screen
            rootRef={pageRef}
            variant={screenVariant}
            header={header}
            footer={footer}
            restoreScroll={false}
        >
            <div
                className={styles.page}
                data-testid="confirm-modal"
                aria-label={t('components.confirmActionModal.confirm', { value: headlineText || 'action' })}
            >
                <div className={styles.header}>
                    <span className={styles.actionLabel}>{actionHeaderLabel}</span>
                    <span className={styles.chainBadge} data-testid="confirm-chain-badge">{chainLabel}</span>
                </div>

                <div className={styles.body}>
                    <WalletIdentity wallet={resolvedSigningWallet} label={t('components.confirmActionModal.signingWith')} />
                    <OriginIdentity
                        origin={requestOrigin}
                        label={t('extension.approval.requestingSite')}
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
                        <section className={styles.messageBox} aria-label={t('components.confirmActionModal.messageToSign')}>
                            <p className={styles.messageLabel}>{t('components.confirmActionModal.messageToSign')}</p>
                            <pre className={styles.messageText} data-testid="confirm-message-text" dir="auto">
                                {messageText}
                            </pre>
                        </section>
                    ) : null}

                    {variant === 'action' && reviewDecoded ? (
                        <ActionIntentSummary decoded={reviewDecoded} simulation={simulation} />
                    ) : null}

                    {isContractCall ? (
                        <p className={styles.hwNote} data-testid="contract-call-warning">
                            {CONTRACT_CALL_WARNING}
                        </p>
                    ) : null}

                    {/* The wallet can hold several addresses per chain, so the
                        action row names the spender alongside the balance debit.
                        Message signing uses the same row for its signing address. */}
                    {(variant === 'action' || variant === 'message') && sourceAddress ? (
                        <dl className={styles.sourceRow} data-testid="confirm-source">
                            <dt className={styles.sourceLabel}>
                                {variant === 'message' ? t('components.confirmActionModal.signingAddress') : t('send.fields.from')}
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
                            <div>{t('components.confirmActionModal.twoTransactionsBothSignedNow')}</div>
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
                            {t('components.confirmActionModal.protocolFee')} {nativeProtocolFeeAmount} {nativeTicker}
                            {nativeProtocolFeeFiat ? ` (${nativeProtocolFeeFiat})` : ''}
                            {t('components.confirmActionModal.sentOnChainAndNot')}
                        </div>
                    ) : null}

                    {protocolFeeUnavailable ? (
                        <div className={styles.fee} data-testid="confirm-protocol-fee-unavailable">
                            {t('components.confirmActionModal.protocolFeeEstimateUnavailable')}
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
                            report={displayedReport}
                            loading={reportLoading}
                            acknowledged={acknowledged}
                            onAcknowledge={onAcknowledge}
                        />
                    ) : null}

                    {/* Fail-closed refusal (§5.5): no credentials, no Approve,
                        no override. Rendered where the credentials would be so
                        the user sees WHY there is nothing to sign with. */}
                    {refusal ? (
                        <StatusMessage variant="error" role="alert" testId="confirm-refusal">
                            {refusal}
                        </StatusMessage>
                    ) : null}

                    {/* §5.3.4: a credential failure returns the page to `ready`
                        with this error set, so the user retypes and re-approves
                        the SAME PSBT. Sits directly above the credentials block
                        so the message is adjacent to the field it refers to. */}
                    {error?.presentation === 'status' ? (
                        <div className={styles.hwNote} role="status" data-testid="confirm-notice">
                            {userFacingMessage(
                                error,
                                'The request stopped because the wallet service returned no explanation.',
                            )}
                        </div>
                    ) : error ? (
                        <StatusMessage variant="error" role="alert" testId="confirm-error">
                            {userFacingMessage(
                                error,
                                'The request stopped because the wallet service returned no explanation.',
                            )}
                        </StatusMessage>
                    ) : null}

                    {refusal ? null : (
                        <div className={styles.credentials}>
                            {credentials}
                        </div>
                    )}

                    {/* Transaction-signing caveat only. Message signing moves no
                        coins and has no outputs, so this note would be nonsense
                        on that variant. */}
                    {variant !== 'message' && hardwareSigner ? (
                        <p className={styles.hwNote}>
                            {t('components.confirmActionModal.aHardwareDeviceVerifiesNative')}
                        </p>
                    ) : null}

                    {phase === 'rechecking' ? (
                        <p className={styles.recheck} data-testid="confirm-rechecking">{t('components.confirmActionModal.reChecking')}</p>
                    ) : null}
                    {signingTime.showElapsed ? (
                        <p className={styles.recheck} role="status" data-testid="confirm-signing-elapsed">
                            {t('components.confirmActionModal.signingFor')} {signingTime.elapsedSeconds} {t('components.confirmActionModal.secondsCheckYourHardwareWallet')}
                        </p>
                    ) : null}
                    {signingTime.timedOut ? (
                        <StatusMessage variant="error" role="alert" testId="confirm-signing-timeout">
                            {t('components.confirmActionModal.signingIsTakingLongerThan')}
                        </StatusMessage>
                    ) : null}
                    {/* The queue holds the signed transaction until the user
                        broadcasts it from the queued-transactions banner. */}
                    {phase === 'signed-not-broadcast' ? (
                        <p className={styles.queued} data-testid="confirm-queued">
                            {t('components.confirmActionModal.signedNotBroadcastYet')}
                        </p>
                    ) : null}
                </div>
            </div>
        </Screen>
    );
}
