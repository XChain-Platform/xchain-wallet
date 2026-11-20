// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';
import { useEffect, useMemo, useRef, useState } from 'react';
// Network, From and the fee selector come from the standard FromSection and
// FeeSection.
import { Button, FormNotice, Icon, Input, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
// The Wallet Form Standard frame (From, main section, Memo, Network fee,
// status slot, one action).
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    MemoSection,
    useFormSections,
} from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import '../../i18n/locales/en/balances.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/send.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { prebuiltPsbtFromComposed } from '../../flows/prebuiltPsbtFromComposed.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import {
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { formatWithThousands, groupDecodedAmounts } from '../utils/amountFormat.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
// The Fees card and its pay-in-native switch render inside FeeSection.
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import styles from './IssueTokenForm.module.css';
import facts from './FactRows.module.css';
import cbStyles from './CallbackForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { isExactTypedConfirmation } from '../../flows/typedConfirmation.js';
import { APPROVE_REFUSAL_NAME, approveRefusal } from '../utils/approveRefusal.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import {
    UNKNOWN_TOKEN_ISSUER_MESSAGE,
    tokenIssuerEligibility,
} from '../utils/tokenIssuerEligibility.js';
import { invalidateTokenInfo } from '../utils/tokenInfoCache.js';
import { compareDecimalStrings, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();
const CALLBACK_PAYOUT_WARNING = 'The holder count and payout can change until the callback confirms. Holders can split balances across new addresses, so the final payout may be higher than shown.';

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

const WHOLE_NUMBER_RE = /^\d+$/;
const POSITIVE_DECIMAL_RE = /^\d+(?:\.\d+)?$/;

export function callbackTermsError(info, payoutDivisibility = null) {
    // A record without an owner was not read well enough to establish its
    // callback state. Keep that distinct from a readable record whose callback
    // fields are genuinely absent.
    if (!info || typeof info !== 'object' || info.loadError
        || !String(info.creator || '').trim()) {
        return UNKNOWN_TOKEN_ISSUER_MESSAGE;
    }
    const callbackTick = String(info?.callbackTick || '').trim();
    const callbackAmount = String(info?.callbackAmount ?? '').trim();
    const callbackBlock = String(info?.callbackBlock ?? '').trim();
    if (!callbackTick || !callbackAmount || !callbackBlock) {
        return 'This token does not have a complete callback configuration.';
    }
    const tickError = tickerReferenceError(callbackTick, { noun: 'Callback token' });
    if (tickError) return tickError;
    if (!POSITIVE_DECIMAL_RE.test(callbackAmount)
        || compareDecimalStrings(callbackAmount, '0') !== 1) {
        return 'Callback payout per unit must be a positive number.';
    }
    const precisionError = tokenAmountPrecisionError(callbackAmount, {
        divisibility: payoutDivisibility,
        tick: callbackTick,
        noun: 'Callback payout per unit',
    });
    if (precisionError) return precisionError;
    if (!WHOLE_NUMBER_RE.test(callbackBlock)
        || !Number.isSafeInteger(Number(callbackBlock))) {
        return 'Callback block must be a whole block height within the supported range.';
    }
    return null;
}
function sameCallbackTerms(left, right) {
    return String(left?.callbackTick || '').trim()
            === String(right?.callbackTick || '').trim()
        && compareDecimalStrings(left?.callbackAmount, right?.callbackAmount) === 0
        && String(BigInt(String(left?.callbackBlock || '0')))
            === String(BigInt(String(right?.callbackBlock || '0')))
        && String(left?.creator || '').toLowerCase() === String(right?.creator || '').toLowerCase();
}

function tokenBalanceAt(byChain, chainId, address, tick) {
    const entries = byChain?.[chainId];
    if (!Array.isArray(entries)) return null;
    const entry = entries.find((candidate) => candidate?.address === address);
    if (!entry || entry.balances?.unavailable?.includes('tokens')) return null;
    const balances = decoderLib.balancesFromSdk(entry.balances) || [];
    const match = balances.find((balance) => (
        String(balance?.tick || '') === String(tick || '')
    ));
    if (match?.unknown || (match && compareDecimalStrings(match.amount, '0') == null)) return null;
    return match ? String(match.amount) : '0';
}

/**
 * Execute-callback form (PC-03, CALLBACK v0).
 *
 * A danger-styled flow that force-recalls ALL of a token's supply back
 * to the owner address, paying every non-owner holder CALLBACK_AMOUNT of
 * CALLBACK_TICK per unit they held. Owner-only and only valid after the
 * token's CALLBACK_BLOCK; both are enforced on-chain, so this form leads
 * with an honest preview (live holder count, total payout owed, the
 * dust-split griefing caveat) and blocks submission until the block gate
 * is met and the config is complete.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} props.initialChainId
 * @param {string} props.initialTick
 * @param {string} [props.initialFromAddress]
 */
export function CallbackForm({ walletId, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);

    const lockedToken = !!(initialChainId && initialTick);
    const {
        addressesByChain,
        loadError,
        chainId,
        setChainId,
        fromAddress,
        fromAddressId,
        setFromAddressId,
        chainsWithAddresses,
        descriptor,
        signerReady,
        isWatcherMode,
        isHwSource,
        hwStatus,
        onHwStatusChange,
        buildFrom,
        submit,
    } = useActionForm({
        walletId,
        action: 'CALLBACK',
        submitMethods: { hw: 'callbackActionHw', software: 'callbackAction' },
        initialChainId,
        initialFromAddress,
        lockedToken,
        noAddressMessage:
            'No addresses on any network yet. Use Receive to generate one before a callback.',
    });

    const [ticker, setTicker] = useState(initialTick || '');
    // Network stays an ordinary field even with a preset token. The token
    // still decides the network: picking one moves Network to its chain, and
    // moving Network off the token's chain clears the token (handleChainChange).
    const [tickerChainId, setTickerChainId] = useState(
        initialTick && initialChainId ? initialChainId : null,
    );
    useEffect(() => {
        if (ticker && !tickerChainId && chainId) setTickerChainId(chainId);
    }, [chainId, ticker, tickerChainId]);
    const [memo, setMemo] = useState('');
    const trimmedMemo = memo.trim();
    const memoTooLong = memoLengthError(trimmedMemo);
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    // The standard sections' open state, held above the picker pages
    // (early returns) so it survives them, and a count of Review presses so
    // the section holding the refused value reopens on every press.
    const formSections = useFormSections({ from: false, main: true, memo: false, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);
    // Set by an Execute Callback press (G22): an empty Token then shows red.
    const [attempted, setAttempted] = useState(false);
    const [errorSection, setErrorSection] = useState(/** @type {'from' | 'main' | 'memo' | 'fee' | null} */ (null));

    // Typed-confirmation gate: a token recall takes every holder's tokens, so
    // it keeps a typed word like DESTROY and SWEEP. The hint only says how to
    // type it; what is recalled is said in the review's warnings card.
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = isExactTypedConfirmation(typedConfirm, 'RECALL');

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (CALLBACK is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    // Token record: the callback config (CALLBACK_TICK/AMOUNT/BLOCK) and
    // owner, used for the payout preview and the block-height gate.
    const assetInfo = useTokenInfo({ chainId, tick: ticker, skip: !ticker });
    const cbTick = assetInfo?.callbackTick || null;
    const cbAmount = assetInfo?.callbackAmount || null;
    const cbBlockText = assetInfo?.callbackBlock != null
        ? String(assetInfo.callbackBlock).trim()
        : '';
    const cbBlock = WHOLE_NUMBER_RE.test(cbBlockText) && Number.isSafeInteger(Number(cbBlockText))
        ? Number(cbBlockText)
        : null;
    const owner = assetInfo?.creator || null;
    const issuerEligibility = tokenIssuerEligibility({
        tokenInfo: assetInfo,
        addressesByChain,
        chainId,
        tick: ticker,
        sourceAddress: fromAddress?.address,
    });
    // An owner read can answer after the shared hook chose its default source.
    // Move that untouched default to the owner, but preserve a user's pick.
    const defaultFromIdRef = useRef(/** @type {string | null} */ (null));
    useEffect(() => {
        if (!addressesByChain || !fromAddressId) return;
        if (!defaultFromIdRef.current) defaultFromIdRef.current = fromAddressId;
        if (fromAddressId !== defaultFromIdRef.current || !owner) return;
        const match = (addressesByChain[chainId] || []).find((address) => address.address === owner);
        if (match && match.id !== fromAddressId) {
            defaultFromIdRef.current = null;
            setFromAddressId(match.id);
        }
    }, [addressesByChain, chainId, fromAddressId, owner, setFromAddressId]);
    const payoutInfo = useTokenInfo({ chainId, tick: cbTick, skip: !cbTick });
    // Unknown until the payout token answers: a failed read carries no
    // decimals, and guessing 0 floors every holder's payout to whole units.
    const payoutPending = !!cbTick && payoutInfo == null;
    const payoutDivisibility = payoutInfo == null || payoutInfo.loadError
        ? null
        : Number.isInteger(Number(payoutInfo.divisibility))
            && Number(payoutInfo.divisibility) >= 0
            && Number(payoutInfo.divisibility) <= 8
            ? Number(payoutInfo.divisibility)
            : 0;

    // Current indexed height for the after-CALLBACK_BLOCK gate.
    const [currentHeight, setCurrentHeight] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        if (!chainId) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.getIndexerWatermark !== 'function') return undefined;
        let cancelled = false;
        messaging.getIndexerWatermark({ chainId })
            .then((r) => { if (!cancelled) setCurrentHeight(r && r.watermark != null ? Number(r.watermark) : null); })
            .catch(() => { if (!cancelled) setCurrentHeight(null); });
        return () => { cancelled = true; };
    }, [chainId, messaging, walletId]);

    // Holder / payout summary (PC-03 preview). callbackAmount + the
    // CALLBACK_TICK's decimals drive the total-payout figure the owner
    // must be able to cover. Indicative: the holder set can change until
    // the CALLBACK confirms, which the copy states.
    const [summary, setSummary] = useState(/** @type {any | null} */ (null));
    const [summaryLoading, setSummaryLoading] = useState(false);
    useEffect(() => {
        if (!chainId || !ticker || !cbTick) {
            setSummary(null);
            setSummaryLoading(false);
            return undefined;
        }
        if (flowsLib.isDemoWallet(walletId)) {
            setSummaryLoading(false);
            return undefined;
        }
        if (typeof messaging?.tokenHolderSummary !== 'function') {
            setSummaryLoading(false);
            return undefined;
        }
        // The payout figure is floored to the payout token's decimals, so it
        // waits for them instead of showing a short total meanwhile.
        if (payoutDivisibility == null) {
            setSummary(null);
            setSummaryLoading(payoutPending);
            return undefined;
        }
        let cancelled = false;
        setSummaryLoading(true);
        messaging.tokenHolderSummary({
            chainId, tick: ticker, owner,
            callbackAmount: cbAmount,
            callbackDecimals: payoutDivisibility,
        })
            .then((s) => { if (!cancelled) setSummary(s || null); })
            .catch(() => { if (!cancelled) setSummary(null); })
            .finally(() => { if (!cancelled) setSummaryLoading(false); });
        return () => { cancelled = true; };
    }, [chainId, ticker, cbTick, cbAmount, owner, payoutDivisibility, payoutPending, messaging, walletId]);

    const demoWallet = flowsLib.isDemoWallet(walletId);
    const blockReached = cbBlock != null
        && (demoWallet || (currentHeight != null && currentHeight >= cbBlock));
    const configComplete = !!(cbTick && cbAmount && cbBlockText);
    // A token record the explorer did not answer for carries no callback
    // fields, which is not the same as a token with no callback: the terms
    // are unknown, and the issuer refusal above already says to try again.
    const termsUnread = !!assetInfo?.loadError;

    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const handleChainChange = (nextChainId) => {
        setChainId(nextChainId);
        if (ticker && tickerChainId && tickerChainId !== nextChainId) {
            setTicker('');
            setTickerChainId(null);
        }
        setFormError(null);
    };
    const [refreshing, setRefreshing] = useState(false);
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '0', TICK: ticker };
        if (memo.trim().length > 0) p.MEMO = memo.trim();
        return p;
    }, [ticker, memo]);
    const quoteActionData = useMemo(() => {
        const sourceValid = Boolean(fromAddress?.address && descriptor?.coin && descriptor?.networkKind
            && isValidAddressForChain(fromAddress.address, descriptor.coin, descriptor.networkKind));
        const memoValid = !/[|;]/.test(trimmedMemo) && !memoTooLong;
        const tickerValid = Boolean(ticker) && !tickerReferenceError(ticker, { noun: 'Token ticker' });
        const termsValid = configComplete && !callbackTermsError(assetInfo, payoutDivisibility);
        if (!sourceValid || !tickerValid || !memoValid || !termsValid
            || issuerEligibility.pending || issuerEligibility.error || !blockReached) return null;
        return { action: 'CALLBACK', params: actionParams };
    }, [actionParams, assetInfo, blockReached, configComplete, descriptor, fromAddress,
        issuerEligibility.error, issuerEligibility.pending, memoTooLong, payoutDivisibility,
        ticker, trimmedMemo]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });

    const decoded = useMemo(() => {
        // residual (§5.6 slice 5): the confirm page renders the intent
        // the HOST described from the composed action string
        // (`composed.decoded`), so this local describer serves the LEGACY
        // review stage only - the watcher, demo and locked-ECDH path. It used
        // to also recompute while the confirm page was open, which was work
        // nothing read and, worse, read like the confirm surface still
        // depended on form state.
        if (stage !== 'review' && stage !== 'submitting') return null;
        return groupDecodedAmounts(decoderLib.decodeAction({
            action: 'CALLBACK',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        }));
    }, [stage, confirmModalOpen, actionParams, chainId]);

    const paysText = `${cbAmount} ${cbTick} per unit of ${ticker}`;
    const blockText = cbBlock == null
        ? ''
        : `${String(cbBlock)}${currentHeight != null
            ? (blockReached ? ' (reached)' : ` (current ${String(currentHeight)})`)
            : ''}`;
    const holdersText = summaryLoading && !summary
        ? 'Loading…'
        : summary
            ? `${(Number(summary.recipientCount) || 0).toLocaleString('en-US')}${summary.partial ? '+' : ''}`
            : 'Unavailable';
    const payoutText = summary && summary.totalPayout != null
        ? `${formatWithThousands(summary.totalPayout)} ${cbTick}${summary.partial ? ' (at least)' : ''}`
        : '';
    const callbackFacts = [
        ...(configComplete ? [{ label: 'Pays holders', value: paysText }] : []),
        ...(blockText ? [{ label: 'Allowed from block', value: blockText }] : []),
        { label: 'Holders to pay', value: holdersText === 'Unavailable' ? 'Could not check' : holdersText },
        ...(payoutText ? [{ label: 'Total payout', value: payoutText }] : []),
    ];
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const reviewDecoded = useMemo(() => (decoded ? {
        ...decoded,
        warnings: [...(decoded.warnings || []), CALLBACK_PAYOUT_WARNING],
    } : null), [decoded]);
    const legacyComposed = useMemo(() => (reviewDecoded ? {
        action: 'CALLBACK',
        chainId,
        decoded: reviewDecoded,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
        actionWarnings: ['CALLBACK'],
    } : null), [chainId, quotedProtocolFee.free, quotedProtocolFee.known, reviewDecoded]);
    const confirmComposed = useMemo(() => {
        const composed = confirmAction.composed;
        if (!composed?.decoded) return composed;
        return {
            ...composed,
            decoded: {
                ...composed.decoded,
                warnings: [...(composed.decoded.warnings || []), CALLBACK_PAYOUT_WARNING],
            },
        };
    }, [confirmAction.composed]);

    // Shared preview block: config, live holder count and total payout.
    const previewBlock = (
        <>
        {/* The shared FactRows look: one row per fact, one divider per row.
            Every label and value holds one line; a long value truncates and
            keeps its full text in a title. Read-only facts carry no help icon. */}
        <dl className={`${facts.list} ${cbStyles.facts}`} data-callback-facts="">
            <dt className={facts.label} title="Pays holders">Pays holders</dt>
            <dd className={facts.value} title={paysText}>
                {configComplete
                    ? paysText
                    : termsUnread
                        ? t('balances.unavailable')
                        : <em>No callback configured for {ticker || 'this token'}.</em>}
            </dd>
            {cbBlock != null ? (
                <>
                    <dt className={facts.label} title="Allowed from block">Allowed from block</dt>
                    <dd className={facts.value} title={blockText}>{blockText}</dd>
                </>
            ) : null}
            <dt className={facts.label} title="Holders to pay">Holders to pay</dt>
            <dd className={facts.value} title={holdersText}>{holdersText}</dd>
            {summary && summary.totalPayout != null ? (
                <>
                    <dt className={facts.label} title="Total payout">Total payout</dt>
                    <dd className={facts.value} title={payoutText}>{payoutText}</dd>
                </>
            ) : null}
        </dl>
        <p className={styles.hint} data-callback-estimate-hint="">
            The holder count and payout are indicative: they can change until the callback confirms. Holders can split their balance across new addresses to inflate the payout you owe, so the final cost may be higher than shown.
        </p>
        </>
    );

    async function openConfirmModal() {
        const from = buildFrom();
        if (!chainId || !from) return;
        setSubmitError(null);
        setTypedConfirm('');
        try {
            const res = await confirmAction.confirm({
                chainId,
                source: from.address,
                preflightOpts: {
                    mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report',
                },
                compose: () => messaging.composeForConfirm(withAdvancedOptions({
                    walletId,
                    chainId,
                    from,
                    actionData: { action: 'CALLBACK', params: actionParams },
                    // PC-51: the opt-in must reach COMPOSE so the FEE_DESTINATION
                    // output sits inside the PSBT the user approves.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                })),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                // §4.6: the input-liveness half of the Approve-time re-check,
                // the same one useActionConfirmFlow.run gives every migrated form.
                checkInputs: (psbtHex) => messaging.checkInputLiveness({ chainId, psbtHex }),
                releaseEncoderInputs: (token) => messaging.releaseEncoderInputs({ token }),
                // §4.7: reserve the debited balance on the host-shared ledger,
                // so two windows cannot both approve against the same balance.
                reservationLedger: {
                    reserve: (e) => messaging.reserve(e),
                    release: (id) => messaging.releaseReservation({ id }),
                },
                // Re-price the native-coin protocol fee at Approve.
                // The output was sized at compose, and the amount consensus
                // requires moves inversely with the coin price, so a move while
                // the confirm screen sits open leaves it short - which the
                // chain rejects while keeping the fee.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
                onApprove: async (_creds, composed) => {
                    // Review read the owner, terms, height and payout before
                    // composing. The confirm page can stay open past an
                    // ownership transfer or a payout-token spend, and its
                    // pre-flight re-check waits for its report to age, so
                    // Approve reads them all again and stops before signing.
                    const approveError = await refreshBeforeReview();
                    if (approveError) throw approveRefusal(approveError);
                    return submit({
                        params: actionParams,
                        password: passwordValueRef.current,
                        extraBase: {
                            payFeeInNativeCoin: nativeFee.flag,
                            ...(feePerKb != null ? { feePerKb } : {}),
                            // The shared mapping, envelope and deferred outputs included.
                            prebuiltPsbt: prebuiltPsbtFromComposed(composed),
                        },
                    });
                },
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            // The form's own Approve-time refusal is an answer, not a fault.
            if (err?.name !== APPROVE_REFUSAL_NAME) console.error('Callback (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: humanizeError(err, 'callback').message,
            }));
        }
    }

    function guardBeforeSign() {
        // Each refusal names the section that holds its value, so
        // that section opens with the message (From, Memo, else the main one).
        setErrorSection('main');
        if (!chainId || !fromAddress) {
            setErrorSection('from');
            setFormError('Pick a source address first.');
            return false;
        }
        if (!descriptor?.coin || !descriptor?.networkKind || !isValidAddressForChain(
            fromAddress.address,
            descriptor.coin,
            descriptor.networkKind,
        )) {
            setErrorSection('from');
            setFormError('The selected source address is not valid for this network.');
            return false;
        }
        if (!ticker) {
            setFormError('No token selected.');
            return false;
        }
        const tickerError = tickerReferenceError(ticker, { noun: 'Token ticker' });
        if (tickerError) {
            setFormError(tickerError);
            return false;
        }
        if (issuerEligibility.pending) {
            // A tick read before it was issued can sit cached as unknown, so
            // the refused tap asks again.
            invalidateTokenInfo(chainId, ticker);
            setFormError(`Wait for the wallet to verify the current owner of ${ticker}.`);
            return false;
        }
        if (issuerEligibility.error) {
            setFormError(issuerEligibility.error);
            return false;
        }
        if (!configComplete) {
            return false;
        }
        const termsError = callbackTermsError(assetInfo, payoutDivisibility);
        if (termsError) {
            setFormError(termsError);
            return false;
        }
        const m = trimmedMemo;
        if (m.includes('|') || m.includes(';')) {
            setErrorSection('memo');
            setFormError('Memo cannot contain "|" or ";".');
            return false;
        }
        // Refuse a memo the indexer would reject before the form composes it.
        if (memoTooLong) {
            setErrorSection('memo');
            setFormError(memoTooLong);
            return false;
        }
        return true;
    }

    // Review and Approve re-read past the explorer reuse window, so a change
    // that lands seconds before Approve is seen before anything is signed.
    async function refreshBeforeReview() {
        if (demoWallet) {
            if (!blockReached) {
                return `Callback is not allowed until block ${String(cbBlock)}.`;
            }
            return null;
        }
        if (typeof messaging?.getTokenInfo !== 'function') {
            return 'Could not refresh callback terms. Try again.';
        }
        if (typeof messaging?.getIndexerWatermark !== 'function') {
            return 'Could not refresh the current block height. Try again.';
        }
        try {
            const [freshInfo, watermark] = await Promise.all([
                Promise.resolve()
                    .then(() => messaging.getTokenInfo({ chainId, tick: ticker, demo: false, fresh: true }))
                    .catch(() => ({ loadError: true })),
                messaging.getIndexerWatermark({ chainId, fresh: true }),
            ]);
            const freshTick = String(freshInfo?.callbackTick || '').trim();
            const freshPayoutInfo = freshTick
                ? await messaging.getTokenInfo({ chainId, tick: freshTick, demo: false, fresh: true })
                : null;
            if (freshTick && !freshPayoutInfo) {
                return 'Could not refresh the callback payout token. Try again.';
            }
            const freshDivisibility = Number.isInteger(Number(freshPayoutInfo?.divisibility))
                && Number(freshPayoutInfo.divisibility) >= 0
                && Number(freshPayoutInfo.divisibility) <= 8
                ? Number(freshPayoutInfo.divisibility)
                : 0;
            const freshTermsError = callbackTermsError(freshInfo, freshDivisibility);
            if (freshTermsError) return freshTermsError;
            if (!sameCallbackTerms(assetInfo, freshInfo)) {
                return 'Callback terms changed since this form opened. Return to token details and reopen the callback.';
            }
            if (!freshInfo.creator
                || String(freshInfo.creator).toLowerCase() !== String(fromAddress.address).toLowerCase()) {
                return 'The selected source address is not the current token owner.';
            }
            const height = Number(watermark?.watermark);
            if (!Number.isSafeInteger(height) || height < 0) {
                return 'Could not refresh the current block height. Try again.';
            }
            setCurrentHeight(height);
            const freshBlock = Number(freshInfo.callbackBlock);
            if (height < freshBlock) {
                return `Callback is not allowed until block ${String(freshBlock)}. The network is at ${String(height)}.`;
            }
            if (typeof messaging?.tokenHolderSummary !== 'function') {
                return 'Could not refresh the callback payout. Try again.';
            }
            if (typeof messaging?.getWalletBalances !== 'function') {
                return 'Could not refresh the payout-token balance. Try again.';
            }
            const [freshSummary, balancesByChain] = await Promise.all([
                messaging.tokenHolderSummary({
                    chainId,
                    tick: ticker,
                    owner: freshInfo.creator || null,
                    callbackAmount: freshInfo.callbackAmount,
                    callbackDecimals: freshDivisibility,
                }),
                messaging.getWalletBalances(walletId, undefined, undefined, { fresh: true }),
            ]);
            if (!freshSummary || freshSummary.totalPayout == null) {
                return 'Could not refresh the callback payout. Try again.';
            }
            const payoutBalance = tokenBalanceAt(
                balancesByChain,
                chainId,
                fromAddress.address,
                freshInfo.callbackTick,
            );
            if (payoutBalance == null) {
                return 'Could not refresh the payout-token balance. Try again.';
            }
            const payoutComparison = compareDecimalStrings(freshSummary.totalPayout, payoutBalance);
            if (payoutComparison == null) {
                return 'Could not refresh the callback payout. Try again.';
            }
            if (payoutComparison === 1) {
                return `This address holds only ${formatWithThousands(payoutBalance)} ${freshInfo.callbackTick}. The current callback payout is ${formatWithThousands(freshSummary.totalPayout)} ${freshInfo.callbackTick}.`;
            }
            // A capped holder page sums only the holders it lists, so its
            // payout is a floor. The indexer refuses a CALLBACK whose full
            // payout exceeds the owner's balance after the fee is spent, so a
            // floor within balance proves nothing and Approve stops here.
            if (freshSummary.partial !== false) {
                setSummary(freshSummary);
                return `The callback payout is at least ${formatWithThousands(freshSummary.totalPayout)} ${freshInfo.callbackTick}, and this wallet cannot read every holder, so it cannot confirm this address holds enough ${freshInfo.callbackTick} to cover it.`;
            }
            setSummary(freshSummary);
            return null;
        } catch {
            return 'Could not refresh callback terms, block height, and payout. Try again.';
        }
    }

    async function handleReview(event) {
        event.preventDefault();
        // Every press counts, so the section that holds the refused
        // value opens again even after the user closed it.
        setReviewAttempt((n) => n + 1);
        setAttempted(true);
        // G22: an empty Token is marked on the field and takes the cursor.
        if (!ticker) {
            setErrorSection('main');
            setFormError(null);
            setTimeout(() => document.getElementById('callback-token')?.focus(), 0);
            return;
        }
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setErrorSection('fee'); setFormError(feeStop.formError); return; }
        // A token with no callback set stops here with no second notice:
        // its Pays holders row already reads "No callback configured" (U86).
        if (refreshing || !guardBeforeSign()) return;
        setFormError(null);
        setRefreshing(true);
        const refreshError = await refreshBeforeReview();
        setRefreshing(false);
        if (refreshError) {
            setFormError(refreshError);
            return;
        }
        setTypedConfirm('');
        if (!isWatcherMode) {
            openConfirmModal();
            return;
        }
        setStage('review');
    }

    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await submit({
                params: actionParams,
                password,
                extraBase: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                    chainId,
                    coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Callback failed.',
                }),
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setAttempted(false); // a fresh form opens with no G22 marks
        setSubmitError(null);
        setStage('form');
    }

    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting' || refreshing}
            title={stage === 'review' || stage === 'submitting' ? 'Review Token Recall' : 'Recall Tokens'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
        </Screen>
    );
    const wrapForm = (form) => <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>{form}</Screen>;

    if (loadError) {
        return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <ResultScreen state="unsigned" result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />,
            );
        }
        // Signed but not broadcast, so nothing is on its way to
        // confirming and no holder is being paid yet.
        if (result?.queued) {
            return wrap(
                <ResultScreen state="signed-not-broadcast" onDone={onBack} what="token recall" unsaved={result?.unsaved} />,
            );
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Token recall broadcast</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <p className={styles.hint}>
                    All {ticker} supply returns to your address and holders are paid in {cbTick}
                    {' '}once this confirms and indexes.
                </p>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return (
            <ConfirmActionModal
                phase={stage === 'submitting' ? 'signing' : 'ready'}
                composed={legacyComposed}
                report={null}
                reportLoading={false}
                acknowledged={NO_ACKNOWLEDGMENTS}
                onAcknowledge={() => {}}
                canApprove={stage === 'review'}
                onApprove={() => handleSubmit({ preventDefault() {} })}
                onReject={() => { setSubmitError(null); setTypedConfirm(''); setStage('form'); }}
                decoded={reviewDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentialsReady={typedConfirmOk}
                credentials={(
                    <>
                        <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                        <Input
                            label="Type RECALL to confirm"
                            help={t('common.typedConfirmationHint', { word: 'RECALL' })}
                            value={typedConfirm}
                            onChange={(event) => setTypedConfirm(event.target.value)}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                    </>
                )}
                summary={{
                    verb: t('components.confirmSummary.verbExecuteCallback'),
                    ...(actionParams.TICK ? { ticker: String(actionParams.TICK).toUpperCase() } : {}),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    facts: callbackFacts,
                    ...(!nativeFee.flag && quotedProtocolFee.known ? {
                        protocolFee: {
                            amount: quotedProtocolFee.free ? '0' : String(quotedProtocolFee.amount ?? ''),
                            ticker: 'XCHAIN',
                        },
                    } : {}),
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={{ ...confirmAction, composed: confirmComposed }}
                summary={{
                    verb: t('components.confirmSummary.verbExecuteCallback'),
                    ...(actionParams.TICK ? { ticker: String(actionParams.TICK).toUpperCase() } : {}),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    facts: callbackFacts,
                }}
                screenVariant={variant}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                credentialsReady={(isHwSource
                    ? hwStatus === 'available'
                    : (signerReady || password.length > 0)) && typedConfirmOk}
                extraCredentials={(
                    <Input
                        label='Type "RECALL" to confirm'
                        help={t('common.typedConfirmationHint', { word: 'RECALL' })}
                        value={typedConfirm}
                        onChange={(e) => setTypedConfirm(e.target.value)}
                        autoComplete="off"
                    />
                )}
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                onChainChange={handleChainChange}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                    setFormError(null);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                // CALLBACK recalls a token's supply; the network coin cannot be called back.
                kindFilter="tokens"
                kindLocked
                title="Select Token"
                onSelect={(selection) => {
                    const nextChainId = String(selection.chainId || chainId || '');
                    setTicker(String(selection.tick || ''));
                    setTickerChainId(nextChainId || null);
                    if (nextChainId) setChainId(nextChainId);
                    setTokenPickerOpen(false);
                    setFormError(null);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // Section helpers. The section holding the last refusal reopens
    // on every Review press.
    const errorKey = (id) => (
        (formError && errorSection === id) || (id === 'main' && attempted && !ticker) ? reviewAttempt + 1 : 0
    );
    return wrapForm(
        <FormFrame
            demoGuard={demoGuard}
            label="Recall tokens"
            onSubmit={handleReview}
            data-form-standard="execute-callback"
            status={[formError || issuerEligibility.error ? (
                <StatusMessage key="error" variant="error">{formError || issuerEligibility.error}</StatusMessage>
            ) : null]}
            action={(
                <FormAction
                    icon={<Icon.ContractIcon />}
                    loading={refreshing || confirmAction.composing}
                    // G22: enabled whatever the fields hold; a press with
                    // the Token empty marks it, and every other refusal
                    // (no callback set, memo too long) shows in the slot.
                    disabled={refreshing || confirmAction.composing}
                >
                    Recall Tokens
                </FormAction>
            )}
            /* From holds the Network and the token owner's address. Network
               is always the normal field: the Token picker moves it to the
               token's chain, and a Network change off that chain clears the
               token. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses.length
                        ? chainsWithAddresses
                        : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                    onNetworkChange={handleChainChange}
                    networkHelp={t('routes.callback.networkHelp')}
                    disabled={refreshing}
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp="The token owner's address. Only the owner can run a callback, so this must be the address that owns the token."
                    missing={(
                        <FormNotice variant="error">
                            {t('send.source.noAddress')}
                        </FormNotice>
                    )}
                    revealKey={errorKey('from')}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    disabled={refreshing}
                    revealKey={errorKey('fee')}
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        nativeFeeProps: { ...nativeFee.toggleProps, disabled: refreshing },
                    }}
                />
            )}
        >
            <FormSection
                id="main"
                title="Callback"
                icon={Icon.ContractIcon}
                {...formSections.bind('main')}
                revealKey={errorKey('main')}
                summary={ticker ? String(ticker).toUpperCase() : null}
            >
            {(
                <TokenField
                    id="callback-token"
                    error={attempted && !ticker ? 'Pick the token whose callback to run.' : undefined}
                    label="Token"
                    help={t('routes.callback.tokenHelp')}
                    value={ticker && chainId ? { chainId, tick: ticker } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                    disabled={refreshing}
                />
            )}

            {/* The facts sit directly in the section, no card of their own. */}
            {previewBlock}
            {summaryLoading ? <p className={styles.hint}>Loading holder preview…</p> : null}
            {termsUnread || !configComplete ? null : !blockReached ? (
                <FormNotice variant="warning" role="alert">
                    {`Callback is not allowed yet. It becomes available at block ${cbBlock == null ? '' : String(cbBlock)}`
                        + `${currentHeight != null ? ` (network is at ${String(currentHeight)})` : ''}.`}
                </FormNotice>
            ) : null}
            </FormSection>
            {/* Memo is its own optional section holding only the memo: the
                section title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={errorKey('memo')}
                summary={trimmedMemo || 'None'}
                maxLength={MAX_MEMO_LENGTH}
                error={memoTooLong || undefined}
                value={memo}
                onChange={(e) => { setMemo(e.target.value); setFormError(null); }}
                disabled={refreshing}
            />
        </FormFrame>,
    );
}
