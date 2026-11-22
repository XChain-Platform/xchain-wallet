// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isDeviceAddressSource } from '../../schemas/constants.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    FieldIconButton,
    Icon,
    Input,
    ListPage,
    Notice,
    NoticeList,
    PageHeader,
    Screen,
    Select,
    StatusMessage,
    Textarea,
} from '@xchain-wallet/core/ui';
// The Wallet Form Standard frame (From, main section, other sections
// closed, Network fee, one action). Its FormSection is the collapsible one,
// not the settings block of the same name in core/ui.
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, joinSummary, useFormSections } from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { blockDateEstimateText } from '../utils/blockDateEstimate.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import {
    isVoteBindingMinimumsActive,
    isVoteCallbackTimelockActive,
} from '../../flows/protocolActivations.js';
import { bindingPollErrors, CALLBACK_ON_VALUES } from '../../flows/bindingPoll.js';
import styles from './IssueTokenForm.module.css';
// Review and done facts as label-left value-right rows, never stacked uppercase labels.
import facts from './FactRows.module.css';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import {
    compareDecimalStrings,
    formatWithThousands,
    subtractDecimalStrings,
    sumDecimalStrings,
    tokenAmountPrecisionError,
    trimAmountTail,
} from '../utils/amountFormat.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/governance.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Static mode lists (mirror sdk.voting.TALLY_MODES / WEIGHT_MODES). The SDK's
// createPollParams is the authoritative validator; these just populate the pickers.
const TALLY_MODES = ['approval', 'split'];
const WEIGHT_MODES = ['balance', 'flat', 'quadratic', 'time_weighted'];
const WEIGHT_MODE_HINT = {
    balance: 'Weight = token balance at close',
    flat: 'One address, one vote',
    quadratic: 'Weight = square root of balance (needs a per-voter floor)',
    time_weighted: 'Weight = time-averaged balance',
};
// Display labels for the pickers. The protocol enum ids above stay the submitted
// `value`; only the visible text is humanized (otherwise a voter sees raw ids like
// `time_weighted`, underscore and all).
const TALLY_MODE_LABEL = {
    approval: 'Approval',
    split: 'Split',
};
const WEIGHT_MODE_LABEL = {
    balance: 'Balance',
    flat: 'Flat (one address, one vote)',
    quadratic: 'Quadratic',
    time_weighted: 'Time-weighted',
};

/**
 * VOTE v0: create a governance poll. Core fields (token, question, options,
 * close block, tally + weight mode) are always shown; participation gates and
 * the anti-spam deposit sit behind an "Advanced" disclosure. Binding-poll
 * callbacks (which require a deployed contract) are out of scope for this form.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} [props.presetTick]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onCreated]
 */
// The form uses the standard's one collapsible section
// (shared/components/formStandard).
export function CreatePollForm(props) {
    const { walletId, chainId, presetTick } = props;
    return <CreatePollFormState key={JSON.stringify([walletId, chainId, presetTick])} {...props} />;
}

function CreatePollFormState({ walletId, chainId: initialChainId, presetTick, onBack, onCreated }) {
    // Seeded from the launching context; the Network field lets the user retarget.
    const [chainId, setChainId] = useState(initialChainId);
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    const [tick, setTick] = useState(presetTick || '');
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);
    const [endBlock, setEndBlock] = useState('');
    const [tallyMode, setTallyMode] = useState('approval');
    const [weightMode, setWeightMode] = useState('balance');
    const [maxSelections, setMaxSelections] = useState('1');
    const [quorum, setQuorum] = useState('');
    const [minVoters, setMinVoters] = useState('');
    const [minVoteBalance, setMinVoteBalance] = useState('');
    const [decideThreshold, setDecideThreshold] = useState('');
    const [deposit, setDeposit] = useState('');
    // PC-42 binding-poll fields. A blank callback contract keeps the poll
    // advisory and the rest of these are never emitted.
    const [callbackContract, setCallbackContract] = useState('');
    // Set by a Create poll press; each required field that is still
    // empty or wrong then shows red with its own message.
    const [attempted, setAttempted] = useState(false);
    const [callbackMethod, setCallbackMethod] = useState('');
    const [callbackParams, setCallbackParams] = useState('');
    const [callbackOn, setCallbackOn] = useState('pass');
    const [gasEscrow, setGasEscrow] = useState('');
    const [callbackDelayBlocks, setCallbackDelayBlocks] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitInFlightRef = useRef(false);
    // The standard's open state, held above the early returns (the
    // picker pages) so it survives them; only the main section starts open.
    const formSections = useFormSections({
        from: false, poll: true, voting: false, rules: false, deposit: false, contract: false, fee: false,
    });
    // Counts Create Poll presses, so a section holding the error reopens on each.
    const [validationAttempt, setValidationAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoadError(null);
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId)
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) { setLoadError('No address on this network. Use Receive to generate one first.'); return; }
                setFromAddressId(sourceId);
                setLoadError(null);
            })
            .catch((err) => { if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.')); });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const isHwSource = isDeviceAddressSource(fromAddress?.source);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const governanceBalance = useTickBalance({
        messaging, walletId, chainId, address: fromAddress?.address, tick,
    });
    const xchainBalance = useTickBalance({
        messaging, walletId, chainId, address: fromAddress?.address, tick: 'XCHAIN',
    });
    const governanceTokenInfo = useTokenInfo({ chainId, tick, skip: !tick.trim() });
    const xchainTokenInfo = useTokenInfo({ chainId, tick: 'XCHAIN' });
    const maxXchainAfter = (otherAmount) => {
        if (xchainBalance == null) return null;
        const other = /^\d+(?:\.\d+)?$/.test(otherAmount.trim()) ? otherAmount.trim() : '0';
        const remaining = subtractDecimalStrings(xchainBalance, other);
        return remaining !== null && compareDecimalStrings(remaining, '0') === -1 ? '0' : remaining;
    };
    const maxDeposit = maxXchainAfter(gasEscrow);
    const maxGasEscrow = maxXchainAfter(deposit);

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices the broadcast (mirrors DispenserForm / SwapForm).
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

    const cleanOptionsForMarks = options.map((o) => o.trim()).filter((o) => o.length > 0);
    const tokenMark = attempted && !tick.trim() ? 'Pick the token whose holders vote on this poll.' : undefined;
    const questionMark = attempted && !question.trim() ? 'Enter the question voters will answer.' : undefined;
    const optionsMissing = attempted && cleanOptionsForMarks.length < 2;
    const endBlockMark = attempted && !/^[1-9]\d*$/.test(endBlock.trim()) ? 'Enter the block the poll closes at.' : undefined;
    const cleanOptions = useMemo(() => options.map((o) => o.trim()).filter((o) => o.length > 0), [options]);

    const [currentHeight, setCurrentHeight] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        if (typeof messaging?.getIndexerWatermark !== 'function') { setCurrentHeight(null); return undefined; }
        let cancelled = false;
        setCurrentHeight(null);
        messaging.getIndexerWatermark({ chainId })
            .then((res) => {
                if (cancelled) return;
                if (res?.watermark == null || res.watermark === '') { setCurrentHeight(null); return; }
                const height = Number(res?.watermark);
                setCurrentHeight(Number.isFinite(height) ? height : null);
            })
            .catch(() => { if (!cancelled) setCurrentHeight(null); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);
    const endBlockEstimate = blockDateEstimateText({
        coin: descriptor?.coin,
        currentHeight,
        targetBlock: endBlock,
    });

    // PC-42: a poll is binding the moment it names a callback contract. Every
    // other callback field only means something once it does.
    const isBinding = callbackContract.trim() !== '';

    // The timelock field is offered only once VOTE_CALLBACK_TIMELOCK is live on
    // THIS chain, measured against the chain's own latest block time (the same
    // quantity the indexer gates on). Before activation the indexer accepts the
    // poll and silently nulls the delay, so an early field would promise a
    // reaction window that does not exist - and a poll is permanent. A failed
    // lookup leaves blockTime null, which reads as not-active.
    const [tipBlockTime, setTipBlockTime] = useState(/** @type {number | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.getChainTipBlockTime !== 'function') { setTipBlockTime(null); return undefined; }
        messaging.getChainTipBlockTime({ chainId })
            .then((res) => { if (!cancelled) setTipBlockTime(Number.isFinite(res?.blockTime) ? res.blockTime : null); })
            .catch(() => { if (!cancelled) setTipBlockTime(null); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const timelockActive = isVoteCallbackTimelockActive({ chainId, blockTime: tipBlockTime });
    const minimumsActive = isVoteBindingMinimumsActive({ chainId, blockTime: tipBlockTime });

    const bindingErrors = useMemo(() => bindingPollErrors({
        callbackContract, callbackMethod, callbackParams, callbackOn, gasEscrow,
        // Only validate the delay when it can actually be emitted.
        ...(timelockActive ? { callbackDelayBlocks } : {}),
        quorum, minVoters,
    }), [callbackContract, callbackMethod, callbackParams, callbackOn, gasEscrow,
        callbackDelayBlocks, timelockActive, quorum, minVoters]);

    function setOptionAt(i, value) {
        setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
    }
    function addOption() { setOptions((prev) => [...prev, '']); }
    function removeOption(i) { setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_o, idx) => idx !== i))); }

    // UI-level params for sdk.voting.createPollParams (the authoritative validator).
    const pollParams = useMemo(() => {
        const p = {
            tick: tick.trim(),
            endBlock: endBlock.trim(),
            options: cleanOptions,
            maxSelections: maxSelections.trim() || '1',
            tallyMode,
            weightMode,
        };
        if (question.trim()) p.question = question.trim();
        if (quorum.trim()) p.quorum = quorum.trim();
        if (minVoters.trim()) p.minVoters = minVoters.trim();
        if (minVoteBalance.trim()) p.minVoteBalance = minVoteBalance.trim();
        if (decideThreshold.trim()) p.decideThreshold = decideThreshold.trim();
        if (deposit.trim()) p.deposit = trimAmountTail(deposit.trim());
        if (isBinding) {
            p.callbackContract = callbackContract.trim();
            p.callbackMethod = callbackMethod.trim();
            if (callbackParams.trim()) p.callbackParams = callbackParams.trim();
            p.callbackOn = callbackOn;
            if (gasEscrow.trim()) p.gasEscrow = trimAmountTail(gasEscrow.trim());
            // Emitted only when the network will actually honor it.
            if (timelockActive && callbackDelayBlocks.trim()) {
                p.callbackDelayBlocks = callbackDelayBlocks.trim();
            }
        }
        return p;
    }, [tick, endBlock, cleanOptions, maxSelections, tallyMode, weightMode, question, quorum, minVoters,
        minVoteBalance, decideThreshold, deposit, isBinding, callbackContract, callbackMethod,
        callbackParams, callbackOn, gasEscrow, callbackDelayBlocks, timelockActive]);

    // Wire-format VOTE v0 params, for the WATCHER branch only: that path
    // encodes through buildActionPsbtRequest and cannot run the sdk.voting
    // builder. a later change moved the confirm path off this mirror and onto
    // `action.vote.composeForConfirm`, which runs the real
    // sdk.voting.createPollParams host-side - a mirror that drifts here would
    // be SIGNED rather than caught, because the tamper check verifies the PSBT
    // against whatever params the encoder was handed.
    const wireParams = useMemo(() => ({
        VERSION: '0',
        TICK: pollParams.tick,
        END_BLOCK: pollParams.endBlock,
        OPTIONS: cleanOptions.join(','),
        MAX_SELECTIONS: pollParams.maxSelections,
        TALLY_MODE: pollParams.tallyMode,
        WEIGHT_MODE: pollParams.weightMode,
        ...(pollParams.quorum && { QUORUM: pollParams.quorum }),
        ...(pollParams.minVoters && { MIN_VOTERS: pollParams.minVoters }),
        ...(pollParams.minVoteBalance && { MIN_VOTE_BALANCE: pollParams.minVoteBalance }),
        ...(pollParams.decideThreshold && { DECIDE_THRESHOLD: pollParams.decideThreshold }),
        ...(pollParams.question && { QUESTION: pollParams.question }),
        ...(pollParams.deposit && { DEPOSIT: pollParams.deposit }),
        ...(pollParams.callbackContract && { CALLBACK_CONTRACT: pollParams.callbackContract }),
        ...(pollParams.callbackMethod && { CALLBACK_METHOD: pollParams.callbackMethod }),
        ...(pollParams.callbackParams && { CALLBACK_PARAMS: pollParams.callbackParams }),
        ...(pollParams.callbackContract && { CALLBACK_ON: pollParams.callbackOn }),
        ...(pollParams.gasEscrow && { GAS_ESCROW: pollParams.gasEscrow }),
        ...(pollParams.callbackDelayBlocks && { CALLBACK_DELAY_BLOCKS: pollParams.callbackDelayBlocks }),
    }), [pollParams, cleanOptions]);
    const legacyDecoded = useMemo(() => (
        stage === 'review' || stage === 'submitting'
            ? decoderLib.decodeAction({ action: 'VOTE', params: wireParams, chainId: chainId || undefined, chainRegistry })
            : null
    ), [stage, wireParams, chainId]);
    const legacyComposed = useMemo(() => (legacyDecoded ? {
        action: 'VOTE',
        chainId,
        decoded: legacyDecoded,
        protocolFeeKnownFree: true,
    } : null), [chainId, legacyDecoded]);
    const pollConfirmFacts = useMemo(() => [
        { label: 'Maximum selections', value: pollParams.maxSelections },
        ...(pollParams.deposit ? [{
            label: 'Creation deposit',
            value: `${formatWithThousands(pollParams.deposit)} XCHAIN`,
        }] : []),
        ...(pollParams.callbackContract ? [
            { label: 'Contract to call', value: pollParams.callbackContract },
            { label: 'Method to run', value: pollParams.callbackMethod },
        ] : []),
        ...(pollParams.gasEscrow ? [{
            label: 'Callback escrow',
            value: `${formatWithThousands(pollParams.gasEscrow)} XCHAIN`,
        }] : []),
    ], [pollParams]);

    // (§5.6 slice 2): polls go through the single-encode
    // confirm page, hardware included. Watcher mode still
    // branches: it encodes, it never signs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'createPollAction',
        hardware: 'createPollActionHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT via createPollAction.prebuiltPsbt.
    async function openConfirmScreen() {
        if (submitInFlightRef.current) return;
        submitInFlightRef.current = true;
        setSubmitError(null);
        try {
            const from = {
                address: fromAddress.address,
                publicKey: fromAddress.publicKey,
                derivationPath: fromAddress.derivationPath,
                addressId: fromAddress.id,
                source: fromAddress.source,
                signerId: fromAddress.signerId,
            };
            const res = await actionConfirm.run({
                chainId,
                from,
                // Compose through the SDK's own createPollParams,
                // host-side, instead of the client-side wire mirror below.
                compose: () => messaging.composeVoteForConfirm(withAdvancedOptions({
                    walletId,
                    chainId,
                    from,
                    builder: 'createPollParams',
                    params: pollParams,
                    ...(feePerKb != null ? { feePerKb } : {}),
                })),
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: pollParams,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || 'Create poll failed.',
            }));
        } finally {
            submitInFlightRef.current = false;
        }
    }

    function handleReview(event) {
        event.preventDefault();
        setAttempted(true);
        setValidationAttempt((n) => n + 1); // Reopens the section holding the error.
        {
            const first = !tick.trim() ? 'poll-token'
                : !question.trim() ? 'poll-question'
                    : cleanOptions.length < 2 ? 'poll-option-0'
                        : !/^[1-9]\d*$/.test(endBlock.trim()) ? 'poll-end-block' : null;
            if (first) setTimeout(() => document.getElementById(first)?.focus(), 0);
        }
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (!fromAddress) { setFormError('No source address available.'); return; }
        if (!tick.trim()) { setFormError('Governance token is required.'); return; }
        // The wallet requires the question (the protocol allows a poll without one).
        if (!question.trim()) { setFormError('Enter the question voters will answer.'); return; }
        const tickError = tickerReferenceError(tick, { noun: 'Governance token' });
        if (tickError) { setFormError(tickError); return; }
        const governanceBalanceComparison = compareDecimalStrings(governanceBalance, '0');
        if (governanceBalanceComparison !== null && governanceBalanceComparison !== 1) {
            setFormError(`This address must hold some ${tick.trim().toUpperCase()} to create its poll.`);
            return;
        }
        if (!/^[1-9]\d*$/.test(endBlock.trim())) { setFormError('End block must be a positive whole block height.'); return; }
        if (currentHeight != null && Number(endBlock) <= currentHeight) { setFormError(`End block must be above the current indexed block (${currentHeight}).`); return; }
        if (cleanOptions.length < 2) { setFormError('Add at least two non-empty options.'); return; }
        const pollTextError = actionTextSafetyError(question, 'Question')
            || cleanOptions.map((option) => actionTextSafetyError(option, 'Option')).find(Boolean);
        if (pollTextError) { setFormError(pollTextError); return; }
        if (cleanOptions.some((o) => o.includes(','))) { setFormError('Option labels cannot contain a comma.'); return; }
        const selectionCount = Number(maxSelections);
        if (!/^\d+$/.test(maxSelections.trim()) || !Number.isInteger(selectionCount) || selectionCount < 1 || selectionCount > cleanOptions.length) {
            setFormError(`Max selections must be a whole number from 1 to ${cleanOptions.length}.`);
            return;
        }
        const minBalanceText = minVoteBalance.trim();
        if (minBalanceText && !/^\d+(?:\.\d+)?$/.test(minBalanceText)) {
            setFormError('Minimum vote balance must be a non-negative amount.');
            return;
        }
        const minBalancePrecisionError = tokenAmountPrecisionError(minBalanceText, {
            divisibility: governanceTokenInfo?.divisibility,
            tick,
            noun: 'Minimum vote balance',
        });
        if (minBalancePrecisionError) { setFormError(minBalancePrecisionError); return; }
        if (weightMode === 'quadratic' && compareDecimalStrings(minBalanceText, '0') !== 1) {
            setFormError('Quadratic weighting requires a minimum vote balance greater than 0.');
            return;
        }
        if (quorum.trim() && (!/^\d+(?:\.\d+)?$/.test(quorum.trim()) || !(Number(quorum) > 0) || Number(quorum) > 1)) {
            setFormError('Quorum must be a fraction greater than 0 and no more than 1.');
            return;
        }
        if (decideThreshold.trim() && (!/^\d+(?:\.\d+)?$/.test(decideThreshold.trim()) || !(Number(decideThreshold) > 0) || Number(decideThreshold) > 1)) {
            setFormError('Early-decide threshold must be a fraction greater than 0 and no more than 1.');
            return;
        }
        if (minVoters.trim() && (!/^\d+$/.test(minVoters.trim()) || !Number.isInteger(Number(minVoters)))) {
            setFormError('Minimum voters must be a non-negative whole number.');
            return;
        }
        const depositText = deposit.trim();
        if (depositText && !/^\d+(?:\.\d+)?$/.test(depositText)) {
            setFormError('Creation deposit must be a non-negative XCHAIN amount.');
            return;
        }
        const depositPrecisionError = tokenAmountPrecisionError(depositText, {
            divisibility: xchainTokenInfo?.divisibility,
            tick: 'XCHAIN',
            noun: 'Creation deposit',
        });
        if (depositPrecisionError) { setFormError(depositPrecisionError); return; }
        if (bindingErrors.length > 0) { setFormError(bindingErrors[0]); return; }
        const gasEscrowText = isBinding ? gasEscrow.trim() : '';
        const escrowPrecisionError = tokenAmountPrecisionError(gasEscrowText, {
            divisibility: xchainTokenInfo?.divisibility,
            tick: 'XCHAIN',
            noun: 'Escrow for the call',
        });
        if (escrowPrecisionError) { setFormError(escrowPrecisionError); return; }
        const totalEscrow = sumDecimalStrings([depositText || '0', gasEscrowText || '0']);
        if (xchainBalance != null && compareDecimalStrings(totalEscrow, xchainBalance) === 1) {
            setFormError(`This address holds only ${formatWithThousands(xchainBalance)} XCHAIN. The creation deposit and callback escrow together must stay within that balance.`);
            return;
        }
        setFormError(null);
        if (singleEncode) { void openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (submitInFlightRef.current) return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        submitInFlightRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                params: pollParams,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                    // Watcher mode can't run the sdk.voting builder here; hand the wire-form
                    // params through directly (OPTIONS is a comma-joined label list).
                    actionData: { action: 'VOTE', params: wireParams },
                });
            } else {
                const fn = isHwSource ? messaging.createPollActionHw : messaging.createPollAction;
                const args = isHwSource ? { ...base, signerId: fromAddress.signerId } : { ...base, password };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || 'Create poll failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !isHwSource) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        } finally {
            submitInFlightRef.current = false;
        }
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting' ? 'Review Poll' : 'Create Poll'}
        />
    );
    const wrap = (children) => <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>{children}</Screen>;

    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain) return wrap(<ListPage><p>Loading addresses…</p></ListPage>);

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) return wrap(<ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result.unsaved} />);
        if (result?.psbtHex && !txid) {
            return wrap(<ResultScreen state="unsigned" result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />);
        }
        return wrap(
            <ListPage>
                <p className={styles.summary}>
                    Poll created. Holders of {tick} can vote once the network records the action;
                    it closes at block {endBlock}.
                </p>
                <dl className={facts.list}>
                    <dt className={facts.label}>Transaction ID</dt>
                    <dd className={facts.value}>{String(txid || 'n/a')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onCreated || onBack}>Done</Button>
                </div>
            </ListPage>,
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
                onReject={() => { setSubmitError(null); setStage('form'); }}
                decoded={legacyDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('components.confirmSummary.verbCreatePoll'),
                    ...(question.trim() ? { target: question.trim() } : {}),
                    ...(pollParams.tick ? { ticker: String(pollParams.tick).toUpperCase() } : {}),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    facts: pollConfirmFacts,
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        // The poll's question when it has one, else the token it polls.
        const pollQuestion = String(pollParams.question || '').trim();
        const pollSummary = {
            verb: t('components.confirmSummary.verbCreatePoll'),
            ...(pollQuestion ? { target: pollQuestion } : {}),
            ...(pollParams.tick ? { ticker: String(pollParams.tick).toUpperCase() } : {}),
            direction: 'none',
            chainId,
            address: fromAddress?.address,
            facts: pollConfirmFacts,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={pollSummary}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
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
                onChainChange={(cid) => { setChainId(cid); setFromAddressId(null); }}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select Token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => { setTick(String(sel.tick || '').toUpperCase()); setTokenPickerOpen(false); }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // The section each form error belongs to, so that section reopens
    // on every Create Poll press. Fields marked red open theirs by themselves.
    const feeStopNow = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
    const errorSection = (() => {
        if (!formError) return null;
        if (feeStopNow && formError === feeStopNow.formError) return 'fee';
        if (/source address/i.test(formError)) return 'from';
        if (/^End block/.test(formError)) return 'voting';
        if (bindingErrors.includes(formError)) {
            return /quorum|minimum number of voters/i.test(formError) ? 'rules' : 'contract';
        }
        if (/^Escrow for the call/.test(formError)) return 'contract';
        if (/^(Quorum|Minimum voters|Minimum vote balance|Early-decide|Quadratic)/.test(formError)) return 'rules';
        if (/^Creation deposit|creation deposit and callback escrow/.test(formError)) return 'deposit';
        return 'poll';
    })();
    // A section also reopens on each press while one of its own required
    // fields is still red, so a red Closing block reopens Voting even when
    // the message at the top names an earlier field.
    const sectionMarked = {
        poll: Boolean(tokenMark || questionMark || optionsMissing),
        voting: Boolean(endBlockMark),
    };
    const sectionErrorKey = (id) => (errorSection === id || sectionMarked[id] ? validationAttempt + 1 : 0);
    const pollSummary = joinSummary(tick.trim().toUpperCase(), question.trim()) || 'No question yet';

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Create poll"
            onSubmit={handleReview}
            status={formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
            action={(
                <FormAction
                    icon={<Icon.PlusIcon />}
                    loading={actionConfirm.composing}
                    disabled={actionConfirm.composing}
                >
                    Create Poll
                </FormAction>
            )}
            /* The standard order: From (closed) holds Network and the From
               address; Poll (open) the token, question and options; then
               Voting, Rules to Pass, Deposit, contract call (closed) and fee. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]}
                    chainRegistry={chainRegistry}
                    onNetworkChange={(cid) => { setChainId(cid); setFromAddressId(null); }}
                    lockNetwork={Boolean(presetTick)}
                    networkHelp="The chain the poll is recorded on. Your From address and the fee are on this network, and the governance token must live on it."
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp="The address that creates and pays for this poll. It must hold some of the governance token."
                    revealKey={sectionErrorKey('from')}
                />
            )}
            fee={feeTiers ? (
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey('fee')}
                />
            ) : null}
        >
            <FormSection
                id="poll"
                title="Poll"
                icon={Icon.MessageIcon}
                {...formSections.bind('poll')}
                revealKey={sectionErrorKey('poll')}
                summary={pollSummary}
            >
            <TokenField
                id="poll-token"
                error={tokenMark}
                label="Governance token"
                help="The token whose holders can vote on this poll."
                value={tick && chainId ? { chainId, tick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />

            {/* The question is required, with its count on the label line (wallet cap 250, like Memo). */}
            <Textarea id="poll-question" error={questionMark} label="Question"
                help="What this poll asks governance-token holders to decide."
                maxLength={250}
                value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} />

            {/* The options are the poll's outcomes, so they sit in the
                main section under the question. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-form-gap)' }}>
                    {options.map((opt, i) => (
                        <Input key={i} id={`poll-option-${i}`} error={optionsMissing && !opt.trim() ? 'Enter this option.' : undefined}
                            label={`Option ${i + 1}`} help="A choice voters can select. Option labels cannot contain commas."
                            maxLength={100}
                            value={opt} onChange={(e) => setOptionAt(i, e.target.value)} autoComplete="off"
                            fieldAction={(
                                <FieldIconButton
                                    icon={<Icon.TrashIcon />}
                                    label={`Remove option ${i + 1}`}
                                    onClick={() => removeOption(i)}
                                    lockedReason={options.length <= 2 ? 'A poll needs at least two options' : undefined}
                                />
                            )} />
                    ))}
                    {/* The standard secondary button with its icon, never a custom grey one. */}
                    <Button type="button" variant="secondary" icon={<Icon.PlusIcon />} onClick={addOption}>{t('governance.action.addOption')}</Button>
                </div>
                <Input label="Voters can pick up to" help="How many options one ballot may list (1 = a single choice)."
                    value={maxSelections} onChange={(e) => setMaxSelections(e.target.value)} inputMode="numeric" autoComplete="off" />
            </FormSection>

            {/* Required (the closing block), so no Optional tag; a red
                closing block opens it by itself. */}
            <FormSection
                id="voting"
                title="Voting"
                icon={Icon.ClockIcon}
                {...formSections.bind('voting')}
                revealKey={sectionErrorKey('voting')}
                summary={[
                    endBlock.trim() ? `Closes at block ${endBlock.trim()}` : 'Closing block not set',
                    TALLY_MODE_LABEL[tallyMode] || tallyMode,
                    WEIGHT_MODE_LABEL[weightMode] || weightMode,
                ].join(', ')}
            >
                <Input id="poll-end-block" error={endBlockMark} label="Closes at block"
                    help="A future block height. Voting is accepted up to and including this block."
                    hint={endBlockEstimate ? `Estimated close: ${endBlockEstimate}.` : undefined}
                    value={endBlock} onChange={(e) => setEndBlock(e.target.value)} inputMode="numeric" autoComplete="off" />
                <Select label="Tally mode" value={tallyMode} onChange={(e) => setTallyMode(e.target.value)}
                    help="Approval: full weight on each chosen option. Split: weight divided by your per-option shares.">
                    {TALLY_MODES.map((m) => <Select.Option key={m} value={m} icon={m === 'split' ? <Icon.ForkIcon /> : <Icon.CheckIcon />}>{TALLY_MODE_LABEL[m] || m}</Select.Option>)}
                </Select>
                <Select label="Weight mode" value={weightMode} onChange={(e) => setWeightMode(e.target.value)}
                    help={WEIGHT_MODE_HINT[weightMode]}>
                    {WEIGHT_MODES.map((m) => <Select.Option key={m} value={m} icon={m === 'flat' ? <Icon.UserIcon /> : m === 'time_weighted' ? <Icon.ClockIcon /> : m === 'quadratic' ? <Icon.LineChartIcon /> : <Icon.CoinsIcon />}>{WEIGHT_MODE_LABEL[m] || m}</Select.Option>)}
                </Select>
            </FormSection>

            {/* Optional sections; the fields inside drop their own
                Optional tags, as the standard asks. */}
            <FormSection
                id="rules"
                title="Rules to Pass"
                icon={Icon.VerifyIcon}
                optional
                {...formSections.bind('rules')}
                revealKey={sectionErrorKey('rules')}
                summary={[
                    quorum.trim() ? `Quorum ${quorum.trim()}` : null,
                    minVoters.trim() ? `${minVoters.trim()} voters` : null,
                    minVoteBalance.trim() ? `Min balance ${minVoteBalance.trim()}` : null,
                    decideThreshold.trim() ? `Early decide ${decideThreshold.trim()}` : null,
                ].filter(Boolean).join(', ') || 'Not set'}
            >
                <Input label="Quorum" help="Smallest share of the token supply that must vote for the result to count, e.g. 0.2 means 20%."
                    value={quorum} onChange={(e) => setQuorum(e.target.value)} inputMode="decimal" autoComplete="off" />
                <Input label="Minimum voters" help="Minimum distinct qualifying voters."
                    value={minVoters} onChange={(e) => setMinVoters(e.target.value)} inputMode="numeric" autoComplete="off" />
                <Input label="Minimum vote balance" help="A voter counts toward the participation gate only if they hold at least this much. Required for quadratic weighting."
                    value={minVoteBalance} onChange={(e) => setMinVoteBalance(e.target.value)} inputMode="decimal" autoComplete="off" />
                <Input label="Early-decide threshold" help="Fraction of supply an option must reach to close the poll early."
                    value={decideThreshold} onChange={(e) => setDecideThreshold(e.target.value)} inputMode="decimal" autoComplete="off" />
            </FormSection>

            <FormSection
                id="deposit"
                title="Deposit"
                icon={Icon.DollarIcon}
                optional
                {...formSections.bind('deposit')}
                revealKey={sectionErrorKey('deposit')}
                summary={deposit && String(deposit).trim() ? String(deposit).trim() : 'Not set'}
                summaryUnit={deposit && String(deposit).trim() ? 'XCHAIN' : undefined}
            >
                <AmountField label="Creation deposit" tick="XCHAIN"
                    help="XCHAIN held while the poll runs as anti-spam. It is returned when the poll closes and kept if too few people vote."
                    amount={deposit} divisibility={xchainTokenInfo?.divisibility}
                    onAmountFieldChange={setDeposit}
                    onMax={maxDeposit === null ? undefined : () => setDeposit(maxDeposit)}
                    maxDisabled={maxDeposit === null}
                    balanceText={xchainBalance == null ? undefined : `${formatWithThousands(xchainBalance)} XCHAIN available`} />
            </FormSection>

            <FormSection
                id="contract"
                title="Run a Contract When It Ends"
                icon={Icon.ContractIcon}
                optional
                {...formSections.bind('contract')}
                revealKey={sectionErrorKey('contract')}
                summary={callbackContract.trim() ? `Contract ${callbackContract.trim()}` : 'Off'}
            >
                <Input label="Contract to call"
                    help="The contract's number, shown on its explorer page. When the poll finishes, the network calls this contract with the result; leave it blank to keep the poll advisory."
                    value={callbackContract} onChange={(e) => setCallbackContract(e.target.value)} inputMode="numeric" autoComplete="off" />
                {isBinding ? (
                    <>
                        <Input label="Method to run" help="The method name on that contract, e.g. releaseFunds."
                            value={callbackMethod} onChange={(e) => setCallbackMethod(e.target.value)} autoComplete="off" />
                        <Select label="When to call it" value={callbackOn} onChange={(e) => setCallbackOn(e.target.value)}
                            help="Only on a pass runs the contract when the poll wins its vote. On every result also runs it when the poll fails its turnout gate.">
                            {CALLBACK_ON_VALUES.map((v) => (
                                <Select.Option key={v} value={v} icon={v === 'pass' ? <Icon.CheckIcon /> : <Icon.ListIcon />}>
                                    {v === 'pass' ? 'Only when the poll passes' : 'On every result'}
                                </Select.Option>
                            ))}
                        </Select>
                        <Input label="Extra arguments" help='A JSON list appended after the poll result, e.g. ["treasury", 1000].'
                            value={callbackParams} onChange={(e) => setCallbackParams(e.target.value)} autoComplete="off" />
                        <AmountField label="Escrow to fund the call" tick="XCHAIN"
                            help="XCHAIN locked at creation to pay for running the contract and released when the poll finishes."
                            amount={gasEscrow} divisibility={xchainTokenInfo?.divisibility}
                            onAmountFieldChange={setGasEscrow}
                            onMax={maxGasEscrow === null ? undefined : () => setGasEscrow(maxGasEscrow)}
                            maxDisabled={maxGasEscrow === null}
                            balanceText={xchainBalance == null ? undefined : `${formatWithThousands(xchainBalance)} XCHAIN available`} />
                        {timelockActive ? (
                            <Input label="Delay before the call runs" help="Blocks between the poll closing and the contract running. A delay gives holders time to react to a result before it takes effect."
                                value={callbackDelayBlocks} onChange={(e) => setCallbackDelayBlocks(e.target.value)} inputMode="numeric" autoComplete="off" />
                        ) : null}
                        {/* The note sits in the one warning card; any rule it still misses is one danger notice beside it, never a box in the card. */}
                        <WarningCard data-poll-binding-note="">
                            <WarningLine>
                                Because this poll can move value, it needs a quorum and a
                                minimum voter count (set both under Rules to Pass).
                            </WarningLine>
                        </WarningCard>
                        {bindingErrors.length > 0 ? (
                            <Notice tone="danger" role="note" data-poll-binding-errors="">
                                <NoticeList items={bindingErrors.map((e) => ({ key: e, content: e }))} />
                            </Notice>
                        ) : null}
                    </>
                ) : null}
            </FormSection>
        </FormFrame>,
    );
}
