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
// signed PSBT. Every variant (an action, a caller's PSBT, a message) draws the
// one Confirm Standard body (G127 revised 2026-11-16, ConfirmStandard.jsx):
// the status notice, the one hero icon, the name and sentence, the address
// once, the one facts card with the fees, the short warning, what the signer
// needs, and Reject and Approve docked below.
//
// Interaction contract (§5.1, page form): exactly two exits, approve or
// back/reject; the header back arrow rejects the request. Both exits stay
// reachable however long the intent is (§5.2.7 - a safety property, not
// cosmetic). Once a signature exists both exits lock until a terminal state.
// Approve goes busy synchronously in the click handler's tick, before any
// await. A blocking pre-flight finding disables it; other incomplete steps
// answer a tap with the reason at the top of the page (G129).

import { useState, useCallback, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { Notice, NoticeList, Screen, PageHeader, StatusMessage } from '@xchain-wallet/core/ui';
import { LearnNote } from './LearnNote.jsx';
import { xchainProtocolFeeLine } from '../../flows/protocolFeeDisclosure.js';
import { FEE_BEARING_ACTIONS, isFeeBearingAction } from '../../flows/feeBearingActions.js';
import { oracleUsageFeeLine } from '../../flows/oracleFeeDisclosure.js';
import { envelopeTransactionLines } from '../../flows/envelopeFeeDisclosure.js';
import { isSettleTimeUnverified } from '../utils/preflightCheckState.js';
import { automaticDonationLine } from '../utils/adsDonationLine.js';
import { actionWarningLines, actionWarningTitle, withoutCoveredWarnings } from '../../flows/actionWarnings.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { formatDisplayAmount, groupDecodedAmounts } from '../utils/amountFormat.js';
import { directionForVerb, summaryFromDecoded } from './ConfirmSummary.jsx';
import { ConfirmDecisionFooter, ConfirmStandard } from './ConfirmStandard.jsx';
import {
    confirmHeadline,
    confirmStatus,
    confirmWarning,
    composedRecipients,
    decodedFacts,
    feeFacts,
    recipientFacts,
} from '../utils/confirmStandardModel.js';
import { TickerIcon } from './TickerIcon.jsx';
import { formatUnixSecondsLocal } from '../utils/dateTime.js';
import { formatNativeBaseUnits } from '../../registry/coinTicker.js';
import { defaultRegistry } from '../../registry/index.js';
import { OriginIdentity } from './OriginIdentity.jsx';
import { useFocusTrap } from '../utils/focusTrap.js';
import { approveSettle } from '../utils/approveSettle.js';
import { useLongOperationStatus } from '../hooks/useLongOperationStatus.js';
import { MessagingContext } from '../MessagingContext.js';
import { readActiveWallet } from '../utils/activeWalletMemory.js';
import styles from './ConfirmActionModal.module.css';
import { t } from '../../i18n/index.js';
import { useSuppressSpamToastsOnConfirm } from './ToastHost.jsx';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/confirmStandard.js';
import '../../i18n/locales/en/extension.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/execute.js';
import '../../i18n/locales/en/actionWarnings.js';

const OPEN_PHASES = new Set(['preflighting', 'ready', 'signing', 'rechecking', 'done', 'error', 'signed-not-broadcast']);
const chainRegistry = defaultRegistry();

function useSigningWallet(wallet) {
    const messaging = useContext(MessagingContext)?.messaging;
    // Read once: a wallet switch in another surface rewrites the stored active
    // wallet, and this screen still signs for the wallet it opened on.
    const [walletAtOpen] = useState(readActiveWallet);
    const walletId = wallet ? null : walletAtOpen;
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
    // Every other quantity row (Give, Get, supply, price, escrow) groups too.
    return groupDecodedAmounts({ ...decoded, summary, details });
}

// True only when the composed action is positively known to carry no protocol
// fee. An unnamed action, or a variant name built on a fee-bearing one
// (ORDER_MATCH, a DEPLOY chunk), is not known, and ISSUE is treated as fee
// bearing because the envelope does not say whether it creates a token.
export function composedActionName(composed) {
    const carriers = [composed];
    const seen = new Set();
    for (let index = 0; index < carriers.length; index += 1) {
        const carrier = carriers[index];
        if (!carrier || typeof carrier !== 'object' || seen.has(carrier)) continue;
        seen.add(carrier);

        const direct = typeof carrier.action === 'string' ? carrier.action.trim() : '';
        if (direct) return direct;
        const fromString = typeof carrier.actionString === 'string'
            ? carrier.actionString.split('|')[0].trim()
            : '';
        if (fromString) return fromString;

        // The generic host envelope uses the fields above. Request-preserving
        // adapters keep actionData, while decoded and two-transaction adapters
        // can put the action on an envelope, commit, or reveal record instead.
        for (const key of ['actionData', 'decoded', 'envelope', 'commit', 'reveal']) {
            if (carrier[key] && typeof carrier[key] === 'object') carriers.push(carrier[key]);
        }
    }
    return '';
}

function isKnownFreeAction(composed) {
    const raw = composedActionName(composed);
    const name = String(raw || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return false;
    if (name === 'ISSUE') return false;
    if (isFeeBearingAction(name)) return false;
    return !FEE_BEARING_ACTIONS.some((fee) => name.startsWith(`${fee}_`));
}

export function reportWithoutUnverifiedNativeFeeWarning(report) {
    if (!Array.isArray(report?.findings)) return report;
    const findings = report.findings.filter((finding) => (
        finding?.code !== 'NATIVE_FEE_FORFEIT'
    ));
    if (findings.length === report.findings.length) return report;
    const hasFinding = findings.some((finding) => (
        finding?.severity === 'warning' || finding?.severity === 'error'
    ));
    // A dry run that never answered (aborted, timed out or declined) leaves the
    // report not checked whatever else missed beside it: the warn notice shows
    // no unverified line, so holding warn would read as a reason the action
    // fails. preflightCheckState keeps it notChecked, never a pass.
    const unanswered = findings.some((finding) => finding?.code === 'DRYRUN_UNAVAILABLE');
    const hasVisibleConcern = hasFinding || (!unanswered && (report.restricted
        // A check settlement decides is the blue note, never a concern that holds warn.
        || (report.unverified || []).some((u) => !isSettleTimeUnverified(u))));
    return {
        ...report,
        findings,
        verdict: report.verdict === 'warn' && !hasVisibleConcern ? 'pass' : report.verdict,
    };
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
 * What a transaction does that cannot be taken back, as one notice, from the
 * ids the host classified off the parsed composed action
 * (flows/actionWarnings.js). The confirm page itself states these lines in
 * its warning slot; a watcher form's own review stage renders this card so
 * both reviews say the same title and lines. Renders nothing for an action
 * with nothing to warn about.
 *
 * @param {{ ids: unknown }} props
 */
export function ActionWarningsCard({ ids }) {
    const lines = actionWarningLines(ids);
    if (lines.length === 0) return null;
    // The kind's title ("You can't undo this") carries what the short lines
    // no longer repeat, so a watcher's review says it too.
    const title = actionWarningTitle(ids) || t('actionWarnings.title');
    return (
        <StatusMessage variant="warning" role={null} testId="confirm-action-warnings" title={title}>
            <NoticeList
                label={title}
                items={lines.map((item) => ({ key: item.key, content: item.text, attrs: { 'data-testid': 'confirm-action-warning' } }))}
            />
        </StatusMessage>
    );
}

function isPositiveDecimal(value) {
    return value !== null && value !== undefined && Number(value) > 0;
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
 * @param {object|null} [props.simulation]                   accepted for callers; the page shows no before and after
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
 * @param {string} [props.requestOrigin]                     browser-verified origin of the site
 *   that requested this approval; omitted for a wallet-initiated action
 * @param {string} [props.headline]                          the page's accessible name; defaults to the
 *   action sentence
 * @param {string|null} [props.refusal]                      fail-closed refusal (§5.5): renders a
 *   blocking alert INSTEAD of the credentials + Approve, for requests the wallet
 *   will not sign at all. Distinct from a pre-flight error, which the user may
 *   acknowledge; a refusal has no override.
 * @param {string|null} [props.sourceAddress] the single spending address on an
 *   action, or the signing address on a message. A caller-supplied PSBT may spend
 *   several owned addresses at once, so its input list identifies them instead.
 * @param {string} [props.sourceName] the address-record label, followed by the
 *   wallet name when more than one wallet exists
 * @param {{ id: string, name?: string } | null} [props.signingWallet] wallet that will approve the
 *   request, named on the facts card's "Signing with" row (else the wallet active when the page opened)
 * @param {boolean} [props.hardwareSigner] whether approval happens on a hardware device
 * @param {string} [props.nativeTicker]                      the chain's native ticker, for coin-denominated lines
 *   read off the composed envelope (the oracle usage fee, the envelope's two transactions)
 * @param {(amount: string) => string|null} [props.formatNativeFee]
 * @param {(amount: string) => string|null} [props.formatProtocolFee]
 * @param {(parts: { native?: string[], protocol?: string|null }) => string|null} [props.formatFeeTotal]
 *   accepted for callers; each fee row now carries its own fiat figure (no Total block)
 * @param {(reason: 'refusal'|'checking'|'fails'|'signAnyway'|'credentials') => void} [props.onApproveBlocked]
 *   a tap on Approve that cannot go ahead yet: the page says why at its top, and
 *   the caller marks its own field (the password's error) for 'credentials'
 * @param {string} [props.credentialsBlockedText]  what is still missing when credentialsReady is false
 *   (the password, a typed confirmation word, a device); a generic "finish the step" line otherwise
 * @param {import('./ConfirmSummary.jsx').ConfirmSummaryInput|null} [props.summary]   action
 *   variant: what only the form knows (ActionConfirmScreen resolves a fallback)
 * @param {{ amount: string, ticker: string, fiat?: string|null, estimate?: boolean }|null} [props.networkFee]
 *   the network fee as a figure (the composed fee, or the form's estimate marked as one)
 * @param {string|null} [props.paymentAmount]               native coin the action itself sends; a "You send" row when the sentence does not say it
 * @param {{ amount: string, ticker: string }|null} [props.dustChange]   no change output: a remainder under this went to the fee
 * @param {import('react').ReactNode} [props.technicalDetails]   form-specific rows, shown in the page (never folded)
 */
export function ConfirmActionModal({
    phase, composed, report, reportLoading, acknowledged, onAcknowledge,
    canApprove, onApprove, onReject, decoded, chainLabel,
    credentials, credentialsReady = false, variant = 'action',
    screenVariant = 'small', error = null,
    psbtPanel = null, messageText, requestOrigin = '', refusal = null, headline,
    sourceAddress = null, sourceName = '', nativeTicker = '',
    signingWallet = null, hardwareSigner = false,
    formatNativeFee, formatProtocolFee,
    summary = null, networkFee = null, paymentAmount = null, dustChange = null, technicalDetails = null,
    extraWarnings = [], warningTestId, onApproveBlocked, credentialsBlockedText = '',
}) {
    // The decoder's lines that the warning slot states from the action's own
    // warning ids are left out, so each line shows once.
    const cardIds = variant === 'action' ? composed?.actionWarnings : null;
    const reviewFormatted = formatReviewDecoded(decoded);
    const formattedDecoded = reviewFormatted && Array.isArray(cardIds) && cardIds.length > 0
        ? { ...reviewFormatted, warnings: withoutCoveredWarnings(reviewFormatted.warnings, cardIds) }
        : reviewFormatted;
    const decodedHeadline = formattedDecoded?.summary?.split('\n')[0] || '';
    const isContractCall = variant === 'action'
        && /^(?:contract call|call contract\b)/i.test(headline !== undefined ? String(headline || '') : decodedHeadline);
    //Read off the composed envelope rather than taken as a prop: a rule
    // every adapter has to remember is a rule one of them will forget, and the
    // one that forgets shows a "not checked" warning on an ordinary payment.
    const preflightNotApplicable = !!composed?.bareNativePayment;
    // The protocol fee in the DEFAULT (XCHAIN) payment lane, read from the
    // pre-flight report. The native lane uses the exact coin-denominated
    // output below, so the helper returns null there rather than labelling
    // the same charge as an XCHAIN debit.
    //
    // Action variant only. A caller-supplied PSBT (the psbt variant) was built
    // elsewhere and the wallet cannot tell which lane paid its fee; a bare
    // native payment has no protocol fee at all.
    const protocolFee = (variant === 'action' && !preflightNotApplicable)
        ? xchainProtocolFeeLine({ report, composed })
        : null;
    const protocolFeeFiat = protocolFee && typeof formatProtocolFee === 'function'
        ? formatProtocolFee(protocolFee.amount)
        : null;
    const reportedProtocolFee = report?.quote?.xchainFee;
    const protocolFeeKnownFree = composed?.protocolFeeKnownFree === true
        || (reportedProtocolFee !== undefined
            && reportedProtocolFee !== null
            && /^0+(?:\.0+)?$/.test(String(reportedProtocolFee).trim()));
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
        && !paysProtocolFeeNatively
        && !isKnownFreeAction(composed);
    // The SDK advisory is action-based and does not know whether these bytes
    // contain a native-coin fee output. The exact protocol fee row is the one
    // reliable disclosure: it shows once when an output is present and is
    // absent when the fee uses XCHAIN or the action is free.
    const displayedReport = reportWithoutUnverifiedNativeFeeWarning(report);
    // A Mode B dispenser's oracle usage fee: a coin output in these bytes that
    // neither fee line covers. Action variant only, for the reason above.
    const oracleFee = variant === 'action'
        ? oracleUsageFeeLine({ composed, ticker: nativeTicker })
        : null;
    // A Taproot envelope is a commit and a reveal signed on one Approve; list
    // both with their own fees so the fee rows are not read as one transaction.
    const envelopeLines = variant === 'action'
        ? envelopeTransactionLines({ composed, ticker: nativeTicker })
        : null;
    // §36: the wallet's queued automatic donation, when these bytes carry it.
    // It is a real coin output, so it is named on its own row before Approve.
    const adsDonation = variant === 'action'
        ? automaticDonationLine({ composed, descriptor, ticker: nativeTicker })
        : null;
    const resolvedSigningWallet = useSigningWallet(signingWallet);
    const [approvalAttempt, setApprovalAttempt] = useState(null);
    const signaturePhase = phase === 'signing' || phase === 'rechecking';
    const terminal = phase === 'done' || phase === 'error' || phase === 'signed-not-broadcast';
    const open = OPEN_PHASES.has(phase);
    useSuppressSpamToastsOnConfirm(open);
    const pageRef = useRef(null);
    const titleRef = useRef(null);
    useFocusTrap(pageRef, { active: open, initialFocusRef: titleRef });
    const previewReady = phase === 'ready' && !reportLoading;
    const [settledRequest, setSettledRequest] = useState(null);
    const [settleEpoch, setSettleEpoch] = useState(0);
    useEffect(() => {
        if (!open) return undefined;
        const restartSettle = () => {
            setSettledRequest(null);
            setSettleEpoch((epoch) => epoch + 1);
        };
        window.addEventListener('resize', restartSettle);
        window.addEventListener('xchain:native-fold', restartSettle);
        return () => {
            window.removeEventListener('resize', restartSettle);
            window.removeEventListener('xchain:native-fold', restartSettle);
        };
    }, [open]);
    useEffect(() => {
        if (!previewReady || approveSettle.ms <= 0) return undefined;
        const timer = setTimeout(() => setSettledRequest(composed ?? true), approveSettle.ms);
        return () => clearTimeout(timer);
    }, [previewReady, composed, settleEpoch]);
    const approveSettled = previewReady && (approveSettle.ms <= 0 || settledRequest === (composed ?? true));
    const approveInFlight = approvalAttempt !== null && approvalAttempt.request === composed;
    const signingTime = useLongOperationStatus(signaturePhase);

    // The status notice, first on the page. Pre-flight applies to an action
    // and to a caller's PSBT (report-only there, §5.5: it informs and never
    // gates). It does not apply to a bare coin payment, to a PSBT that carries
    // no XChain action (an ordinary payment), or to a message, which have no
    // chain state to check, so those pages make no claim either way; a pass
    // report must never turn an ordinary payment green.
    const preflightApplies = (variant === 'action' || (variant === 'psbt' && !!decoded))
        && !preflightNotApplicable;
    const status = confirmStatus({
        report: displayedReport,
        applies: preflightApplies,
        loading: reportLoading,
        acknowledged,
        approveGated: variant === 'action',
    });

    // Why a tap on Approve cannot go ahead yet, or null when it can. Approve
    // never looks disabled (G130), so each of these is answered at the top of
    // the page (G129) and sends nothing.
    const blockedReason = refusal
        ? { key: 'refusal', text: String(refusal) }
        : !previewReady && !terminal && !signaturePhase
            ? { key: 'checking', text: t('confirmStandard.blocked.checking') }
            : previewReady && !canApprove
                ? (status?.overrides?.length > 0
                    && status.overrides.length === (displayedReport?.findings || []).filter((f) => f?.severity === 'error').length
                    ? { key: 'signAnyway', text: t('confirmStandard.blocked.signAnyway') }
                    : { key: 'fails', text: t('confirmStandard.blocked.fails') })
                : previewReady && !credentialsReady
                    ? {
                        key: 'credentials',
                        // A caller that knows what is missing names it; the
                        // fallback names the step without guessing it is a
                        // password (a typed DESTROY gate rides here too).
                        text: credentialsBlockedText
                            || (hardwareSigner ? t('confirmStandard.blocked.device') : t('confirmStandard.blocked.confirmStep')),
                    }
                    : null;
    const [blockedTap, setBlockedTap] = useState(null);
    // The notice stays only while the reason it answered still holds: typing
    // the password or ticking Sign anyway clears it.
    const shownBlocked = blockedTap && blockedReason && blockedTap.key === blockedReason.key && blockedTap.request === composed
        ? blockedReason
        : null;
    const statusRef = useRef(null);

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

    // Approve goes busy SYNCHRONOUSLY in the click handler's tick, before any
    // await (§5.1). The parent's onApprove runs the async signing. The ref is
    // the guard: two clicks dispatched in one task both read the render's
    // in-flight state before React re-renders, so state alone let a double tap
    // start two signing requests. The ref holds the same attempt as the
    // state, so a newly composed request is never blocked by an older one.
    const approveInFlightRef = useRef(null);
    const handleApprove = useCallback((e) => {
        if (e) e.preventDefault();
        if (approveInFlightRef.current && approveInFlightRef.current.request === composed) return;
        if (approveInFlight || signaturePhase || terminal) return;
        if (blockedReason) {
            // Nothing is sent: the reason goes to the top of the page, which
            // scrolls there and takes focus so it is read out (G129).
            setBlockedTap({ key: blockedReason.key, request: composed });
            const scroller = pageRef.current?.querySelector('main');
            if (scroller) scroller.scrollTop = 0;
            statusRef.current?.focus?.({ preventScroll: true });
            onApproveBlocked?.(blockedReason.key);
            return;
        }
        // The short settle after the page opens (approveSettle) guards a tap
        // that began on the form behind it; it is not a reason to report.
        if (!approveSettled) return;
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
    }, [approveInFlight, signaturePhase, terminal, blockedReason, approveSettled, composed, onApprove, onApproveBlocked]);

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
    // A tap on Approve that could not go ahead: the reason, directly under
    // the status notice at the top of the page (G129, G130).
    const blockedBlock = shownBlocked ? (
        <Notice tone="danger" role="alert" testId="confirm-blocked" data-reason={shownBlocked.key} flush>
            {shownBlocked.text}
        </Notice>
    ) : null;
    // §5.3.4: a credential failure returns the page to `ready` with this error
    // set, so the user retypes and re-approves the SAME PSBT. It sits at the
    // top of the page, under the status notice.
    const errorBlock = error?.presentation === 'status' ? (
        <div className={styles.hwNote} role="status" data-testid="confirm-notice">
            {userFacingMessage(
                error,
                'The request stopped because the wallet service returned no explanation.',
            )}
        </div>
    ) : error ? (
        <StatusMessage variant="error" role="alert" testId="confirm-error" flush>
            {userFacingMessage(
                error,
                'The request stopped because the wallet service returned no explanation.',
            )}
        </StatusMessage>
    ) : null;

    // --- the sentence, the address and the icon ---
    const form = variant === 'action'
        ? (summary || summaryFromDecoded({ decoded: formattedDecoded, actionName: composedActionName(composed) }))
        : null;
    const chainId = form?.chainId || composed?.chainId || '';
    const chainDescriptor = chainId ? chainRegistry.get(chainId) : descriptor;
    const chainName = chainDescriptor?.displayName || (typeof chainLabel === 'string' ? chainLabel : '');
    const head = confirmHeadline({
        variant,
        actionName: composedActionName(composed),
        decoded: formattedDecoded,
        summary: form,
        sourceAddress,
        chainName,
    });
    // The one hero icon: the token or coin the action is about, with its
    // network pip; a kind with no token shows its own icon in a disc.
    const mark = variant === 'action' && head.heroTick && chainDescriptor
        ? <TickerIcon chainId={chainDescriptor.id} tick={head.heroTick} context="hero" />
        : null;

    // #40: the spender is the confirm hook's source, else the address the
    // form says the action happens on; the one address line is labelled when
    // it is the spender's.
    const spender = sourceAddress || (variant === 'action' ? form?.address || null : null);
    const addressIsSource = Boolean(spender) && head.address === spender;
    const sourceWord = variant === 'message'
        ? t('components.confirmActionModal.signingAddress')
        : t('send.fields.from');
    const sourceLabel = sourceName ? `${sourceWord} · ${sourceName}` : sourceWord;

    // --- the fees, each named once ---
    /** @type {import('../utils/confirmStandardModel.js').ConfirmFee[]} */
    const fees = [];
    if (variant === 'action') {
        fees.push({
            key: 'network',
            label: composed?.envelopeFees
                ? t('components.confirmSummary.networkFeeBoth')
                : networkFee?.estimate
                    ? t('components.confirmSummary.networkFeeEstimate')
                    : t('send.networkFee'),
            // Every transaction pays a network fee: an unknown amount stays a
            // fee ("plus network fee"), never a silent zero.
            amount: networkFee?.amount ? String(networkFee.amount) : null,
            ticker: networkFee?.ticker || nativeTicker,
            fiat: networkFee?.fiat || null,
        });
        // The protocol fee as the screen knows it: the XCHAIN lane from the
        // pre-flight quote, the native lane from the composed output, else
        // the form's own positive figure. Only the confirmation data can show
        // an action is free, so a form's zero never hides the unknown row.
        const formProtocolFee = summary?.protocolFee?.amount ? summary.protocolFee : null;
        const protocolLabel = t('execute.protocolFee');
        if (protocolFee) {
            fees.push({ key: 'protocol', label: protocolLabel, amount: String(protocolFee.amount), ticker: 'XCHAIN', fiat: protocolFeeFiat });
        } else if (nativeProtocolFeeAmount) {
            fees.push({ key: 'protocol', label: protocolLabel, amount: String(nativeProtocolFeeAmount), ticker: nativeTicker, fiat: nativeProtocolFeeFiat, notRefunded: true });
        } else if (formProtocolFee && isPositiveDecimal(formProtocolFee.amount)) {
            const tick = String(formProtocolFee.ticker || 'XCHAIN').toUpperCase();
            const isCoin = tick === String(nativeTicker).toUpperCase();
            const fiat = isCoin
                ? (typeof formatNativeFee === 'function' ? formatNativeFee(formProtocolFee.amount) : null)
                : (typeof formatProtocolFee === 'function' ? formatProtocolFee(formProtocolFee.amount) : null);
            fees.push({ key: 'protocol', label: protocolLabel, amount: String(formProtocolFee.amount), ticker: tick, fiat });
        } else if (protocolFeeUnavailable) {
            fees.push({ key: 'protocol', label: protocolLabel, amount: null, ticker: 'XCHAIN' });
        }
        if (oracleFee) {
            fees.push({
                key: 'oracle',
                label: t('components.confirmSummary.oracleFee'),
                amount: String(oracleFee.amount),
                ticker: nativeTicker,
                fiat: typeof formatNativeFee === 'function' ? formatNativeFee(oracleFee.amount) : null,
            });
        }
        if (adsDonation) {
            fees.push({
                key: 'donation',
                label: t('components.confirmSummary.automaticDonation'),
                amount: String(adsDonation.coin),
                ticker: nativeTicker,
                display: adsDonation.value,
            });
        }
    }

    // --- the one facts card: the action's rows, who signs, the network and each fee ---
    // There is no Total block (G127 revised 2026-11-16): the sentence says
    // what the action moves and each fee is its own row with its fiat value.
    const formRecipients = Array.isArray(form?.recipients) ? form.recipients.filter((row) => row && row.to) : [];
    // A multi-send's per-asset rows come from the legs the host decoded out of
    // the composed bytes. The form's rows only stand in without a full decode.
    const composedLegs = variant === 'action' && head.kind === 'multiSend' ? composedRecipients(decoded) : null;
    const recipients = composedLegs || formRecipients;
    const feeLabels = new Set(fees.map((fee) => fee.label));
    // A caller's PSBT shows its decoded action in its own panel
    // (PsbtIntentPanel), so only the action variant draws the decode here.
    const composedFacts = variant === 'action'
        ? decodedFacts({
            decoded: formattedDecoded,
            sentence: head.sentence,
            name: head.name,
            address: head.address,
            recipientsShown: recipients.length > 1,
            kind: head.kind,
            summary: form,
        }).filter((fact) => !feeLabels.has(fact.label))
        : [];
    // A row the decode already states (its Memo) is the composed truth, so
    // the form's own row of that name is left out rather than said twice.
    const decodedLabels = new Set(composedFacts.map((fact) => fact.label.toLowerCase()));
    const formFacts = (Array.isArray(summary?.facts) ? summary.facts : [])
        .filter((fact) => fact && fact.label && String(fact.value ?? '').trim() !== '')
        .filter((fact) => !decodedLabels.has(String(fact.label).toLowerCase()))
        // The name line above the sentence already says it.
        .filter((fact) => !head.name || String(fact.value).trim() !== head.name)
        .map((fact, index) => ({ key: `form-${index}`, label: String(fact.label), value: String(fact.value), address: Boolean(fact.address), testId: fact.testId }));
    // What leaves the wallet, when the sentence does not already say it (a
    // dividend's whole payout, a coin buy's payment): one "You send" row in
    // place of the retired Total's large figure.
    const direction = form ? (form.direction || directionForVerb(form.verb)) : 'none';
    // A form amount can arrive as "1000" or "1000 PEPE"; only its number is
    // kept, and the ticker is added once.
    const amountNumber = (value) => String(value ?? '').trim().split(/\s+/)[0];
    const sentPayment = recipients.length > 1 ? null
        : (direction === 'out' && form?.amount && form?.ticker)
            ? `${formatDisplayAmount(amountNumber(form.amount))} ${String(form.ticker).toUpperCase()}`
            : (paymentAmount ? `${formatDisplayAmount(amountNumber(paymentAmount))} ${String(nativeTicker).toUpperCase()}`.trim() : null);
    // The sentence may group the digits ("1,000") where the form did not.
    const ungrouped = (text) => String(text).replace(/(\d),(?=\d{3})/g, '$1');
    const sentenceSays = (text) => new RegExp(`(^|\\s)${escapeRegExp(ungrouped(text))}(?=\\s|$|[,.])`).test(ungrouped(head.sentence));
    const sentFact = variant === 'action' && sentPayment && !sentenceSays(sentPayment.split(' ')[0])
        ? [{ key: 'you-send', label: t('confirmStandard.fact.youSend'), value: sentPayment, testId: 'confirm-you-send' }]
        : [];
    const facts = [
        ...recipientFacts(recipients, chainId),
        ...sentFact,
        ...composedFacts,
        ...formFacts,
        // #40: the page names the spender. When the one address line shows
        // something else (a send's recipient), the source is a From row, so
        // each address still shows once. A caller's PSBT lists its inputs,
        // and a kind whose signing wallet says enough (a list transfer) has none.
        ...(spender && !addressIsSource && variant !== 'psbt' && head.showSource
            && !recipients.some((row) => row.to === spender)
            ? [{ key: 'from', label: sourceLabel, value: spender, address: true, testId: 'confirm-source' }]
            : []),
        // The wallet that signs, which a switch in another surface must not
        // change under an open review. Plain text: the hero is the page's
        // one icon (G127).
        ...(resolvedSigningWallet?.name
            ? [{
                key: 'wallet',
                label: t('components.confirmActionModal.signingWith'),
                value: resolvedSigningWallet.name,
                testId: 'confirm-signing-wallet',
            }]
            : []),
        ...(dustChange?.amount
            ? [{ key: 'change', label: t('confirmStandard.change'), value: t('confirmStandard.changeNone', { amount: dustChange.amount, ticker: dustChange.ticker }), testId: 'confirm-dust-change' }]
            : []),
        ...feeFacts(fees),
    ];
    const messageFacts = variant === 'message' ? [
        ...facts.filter((fact) => fact.key === 'wallet'),
        ...(chainName ? [{ key: 'network', label: 'Network', value: chainName, testId: 'confirm-network' }] : []),
        ...(head.address ? [{
            key: 'address',
            label: 'Address',
            value: head.address,
            address: true,
            testId: 'confirm-address',
        }] : []),
    ] : null;

    // --- the short warning after the details ---
    const warning = confirmWarning({
        actionWarningIds: cardIds,
        decodedWarnings: variant === 'action' && Array.isArray(formattedDecoded?.warnings) ? formattedDecoded.warnings : [],
        extraWarnings: [
            ...(isContractCall ? [t('common.contractCallWarning')] : []),
            ...(Array.isArray(extraWarnings) ? extraWarnings : []),
        ],
        testId: warningTestId,
    });
    // Reject and Approve, docked. A failed gated pre-flight holds Approve
    // until every permitted override is acknowledged.
    const footer = (
        <ConfirmDecisionFooter
            onReject={handleReject}
            onApprove={handleApprove}
            rejectDisabled={exitsLocked}
            approveDisabled={variant === 'action' && status?.state === 'fail' && !canApprove}
            approveLoading={approveInFlight || signaturePhase}
            approveSettled={approveSettled}
        />
    );

    // Fail-closed refusal (§5.5): no credentials, no Approve, no override.
    // Rendered where the credentials would be so the user sees WHY there is
    // nothing to sign with.
    const refusalBlock = refusal ? (
        <StatusMessage variant="error" role="alert" testId="confirm-refusal" flush>
            {refusal}
        </StatusMessage>
    ) : null;
    const credentialsBlock = refusal ? null : (
        <div className={styles.credentials}>
            {credentials}
        </div>
    );
    // Transaction-signing caveat only. Message signing moves no coins and has
    // no outputs, so this note would be nonsense on that variant.
    const hardwareNote = variant !== 'message' && hardwareSigner ? (
        <p className={styles.hwNote}>
            {t('components.confirmActionModal.aHardwareDeviceVerifiesNative')}
        </p>
    ) : null;
    const confirmName = (headline !== undefined ? headline : head.sentence) || '';
    const pageLabel = t('components.confirmActionModal.confirm', { nameState: confirmName ? 'named' : 'unnamed', value: confirmName });

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
            <ConfirmStandard
                label={pageLabel}
                status={status}
                statusRef={statusRef}
                acknowledged={acknowledged}
                onAcknowledge={onAcknowledge}
                top={blockedBlock || errorBlock ? <>{blockedBlock}{errorBlock}</> : null}
                mark={mark}
                icon={head.icon}
                name={head.name}
                actionCode={head.actionCode}
                sentence={head.sentence}
                address={variant === 'message' ? null : head.address}
                chainName={variant === 'message' ? '' : chainName}
                addressIsSource={addressIsSource}
                addressLabel={addressIsSource ? sourceLabel : head.addressLabel}
                afterAddress={(
                    <OriginIdentity
                        origin={requestOrigin}
                        label={t('extension.approval.requestingSite')}
                        testId="confirm-request-origin"
                    />
                )}
                facts={messageFacts || facts}
                preserveFactOrder={variant === 'message'}
                information={variant === 'action' ? summary?.notice : ''}
                messageText={variant === 'message' ? messageText : undefined}
                warning={warning}
            >
                {/* Settings > Developer Mode > Learn Mode. Renders nothing
                    unless the user asked for it. */}
                <LearnNote variant={variant} chainLabel={chainLabel} />
                {envelopeLines ? (
                    <div className={styles.envelope} data-testid="confirm-envelope-transactions">
                        <p>{t('components.confirmActionModal.twoTransactionsBothSignedNow')}</p>
                        {envelopeLines.map((line) => (
                            <p key={line.role} data-testid={`confirm-envelope-${line.role}`}>{line.text}</p>
                        ))}
                    </div>
                ) : null}
                {/* §5.5 PSBT variant: the input/output enumeration is the
                    foregrounded content for a caller's transaction. */}
                {variant === 'psbt' ? psbtPanel : null}
                {technicalDetails}
                {refusalBlock}
                {credentialsBlock}
                {hardwareNote}
                {phase === 'rechecking' ? (
                    <p className={styles.recheck} data-testid="confirm-rechecking">{t('components.confirmActionModal.reChecking')}</p>
                ) : null}
                {signingTime.showElapsed ? (
                    <p className={styles.recheck} role="status" data-testid="confirm-signing-elapsed">
                        {t('components.confirmActionModal.signingFor')} {signingTime.elapsedSeconds} {t('components.confirmActionModal.secondsCheckYourHardwareWallet')}
                    </p>
                ) : null}
                {signingTime.timedOut ? (
                    <StatusMessage variant="error" role="alert" testId="confirm-signing-timeout" flush>
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
            </ConfirmStandard>
        </Screen>
    );
}
