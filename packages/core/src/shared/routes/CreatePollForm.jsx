// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressField, AddressText, Button, ChainBadge, FeeSelector, Input, NetworkField, PageHeader, Screen, Select, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import {
    isVoteBindingMinimumsActive,
    isVoteCallbackTimelockActive,
} from '../../flows/protocolActivations.js';
import { bindingPollErrors, CALLBACK_ON_VALUES } from '../../flows/bindingPoll.js';
import styles from './IssueTokenForm.module.css';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

const chainRegistry = registryLib.defaultRegistry();

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
export function CreatePollForm({ walletId, chainId: initialChainId, presetTick, onBack, onCreated }) {
    // Seeded from the launching context; the Network field lets the user retarget.
    const [chainId, setChainId] = useState(initialChainId);
    const { messaging, shell } = useMessaging();
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
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [quorum, setQuorum] = useState('');
    const [minVoters, setMinVoters] = useState('');
    const [minVoteBalance, setMinVoteBalance] = useState('');
    const [decideThreshold, setDecideThreshold] = useState('');
    const [deposit, setDeposit] = useState('');
    // PC-42 binding-poll fields. A blank callback contract keeps the poll
    // advisory and the rest of these are never emitted.
    const [showBinding, setShowBinding] = useState(false);
    const [callbackContract, setCallbackContract] = useState('');
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

    useEffect(() => {
        let cancelled = false;
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
                if (!sourceId) { setLoadError('No address on this chain. Use Receive to generate one first.'); return; }
                setFromAddressId(sourceId);
            })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.'); });
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

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

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

    const cleanOptions = useMemo(() => options.map((o) => o.trim()).filter((o) => o.length > 0), [options]);

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
        if (deposit.trim()) p.deposit = deposit.trim();
        if (isBinding) {
            p.callbackContract = callbackContract.trim();
            p.callbackMethod = callbackMethod.trim();
            if (callbackParams.trim()) p.callbackParams = callbackParams.trim();
            p.callbackOn = callbackOn;
            if (gasEscrow.trim()) p.gasEscrow = gasEscrow.trim();
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
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                // Compose through the SDK's own createPollParams,
                // host-side, instead of the client-side wire mirror below.
                compose: () => messaging.composeVoteForConfirm({
                    walletId,
                    chainId,
                    from,
                    builder: 'createPollParams',
                    params: pollParams,
                    ...(feePerKb != null ? { feePerKb } : {}),
                }),
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
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) { setFormError('No source address available.'); return; }
        if (!tick.trim()) { setFormError('Governance token is required.'); return; }
        if (!endBlock.trim() || !/^\d+$/.test(endBlock.trim())) { setFormError('End block must be a block height (a future block).'); return; }
        if (cleanOptions.length < 2) { setFormError('Add at least two non-empty options.'); return; }
        if (cleanOptions.some((o) => o.includes(','))) { setFormError('Option labels cannot contain a comma.'); return; }
        if (bindingErrors.length > 0) { setFormError(bindingErrors[0]); return; }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
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
        }
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review poll' : 'Create poll'}
        />
    );
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
            </>,
        );
    }
    if (!addressesByChain) return wrap(<p>Loading addresses…</p>);

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) return wrap(<QueuedResultPanel onDone={onBack} />);
        if (result?.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />);
        }
        return wrap(
            <>
                <p className={styles.summary}>
                    Poll created. Holders of {tick} can vote once the network records the action;
                    it closes at block {endBlock}.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'n/a')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onCreated || onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>Create a {tick} governance poll closing at block {endBlock}.</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <dt className={styles.detailsLabel}>Token</dt>
                    <dd className={styles.detailsValue}>{tick}</dd>
                    {question.trim() ? (<><dt className={styles.detailsLabel}>Question</dt><dd className={styles.detailsValue}>{question.trim()}</dd></>) : null}
                    <dt className={styles.detailsLabel}>Options</dt>
                    <dd className={styles.detailsValue}>{cleanOptions.map((o, i) => `${i}: ${o}`).join(' · ')}</dd>
                    <dt className={styles.detailsLabel}>Mode</dt>
                    <dd className={styles.detailsValue}>{tallyMode} / {weightMode}</dd>
                    {deposit.trim() ? (<><dt className={styles.detailsLabel}>Deposit</dt><dd className={styles.detailsValue}>{deposit.trim()} (GAS)</dd></>) : null}
                    {isBinding ? (
                        <>
                            <dt className={styles.detailsLabel}>When this poll ends</dt>
                            <dd className={styles.detailsValue}>
                                The network runs <strong>{callbackMethod.trim()}</strong> on contract
                                {' '}#{callbackContract.trim()}
                                {callbackOn === 'always' ? ', on every result.' : ', but only if the poll passes.'}
                                {pollParams.callbackDelayBlocks
                                    ? ` It runs ${pollParams.callbackDelayBlocks} blocks after the poll closes.`
                                    : ' It runs in the same block the poll closes in.'}
                            </dd>
                            {callbackParams.trim() ? (
                                <>
                                    <dt className={styles.detailsLabel}>Extra arguments</dt>
                                    <dd className={styles.detailsValue}>{callbackParams.trim()}</dd>
                                </>
                            ) : null}
                            {gasEscrow.trim() ? (
                                <>
                                    <dt className={styles.detailsLabel}>Escrow for the call</dt>
                                    <dd className={styles.detailsValue}>{gasEscrow.trim()} (GAS)</dd>
                                </>
                            ) : null}
                            <dt className={styles.detailsLabel}>Turnout needed</dt>
                            <dd className={styles.detailsValue}>
                                {quorum.trim()} of supply and at least {minVoters.trim()} voter(s).
                            </dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    </dd>
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>Watcher mode: this wallet will build an unsigned transaction. Sign it on your Signer-mode wallet, then broadcast from a Full-mode wallet.</p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                {(isWatcherMode || isHwSource) && submitError ? (<StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>) : null}
                <div className={styles.actions}>
                    <Button type="submit" variant="primary" loading={stage === 'submitting'}
                        disabled={isWatcherMode ? false : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)}>
                        {isWatcherMode ? 'Create unsigned transaction' : isHwSource ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}` : 'Create poll'}
                    </Button>
                </div>
            </form>,
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
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
                title="From address"
                walletId={walletId}
                chainId={chainId}
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
                title="Select token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => { setTick(String(sel.tick || '').toUpperCase()); setTokenPickerOpen(false); }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <NetworkField value={chainId} onChange={(cid) => { setChainId(cid); setFromAddressId(null); }} chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]} chainRegistry={chainRegistry} />
            {fromAddress ? (
                <AddressField
                    label="From"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
            ) : null}

            <TokenField
                label="Governance token"
                value={tick && chainId ? { chainId, tick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />

            <Textarea label="Question (optional)" hint="What the poll is asking holders to decide."
                value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span className={styles.fromLabel}>Options</span>
                {options.map((opt, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                            <Input label={`Option ${i}`} value={opt} onChange={(e) => setOptionAt(i, e.target.value)} autoComplete="off" />
                        </div>
                        {options.length > 2 ? (
                            <Button type="button" variant="ghost" onClick={() => removeOption(i)}>Remove</Button>
                        ) : null}
                    </div>
                ))}
                <Button type="button" variant="ghost" onClick={addOption}>Add option</Button>
            </div>

            <Input label="Closes at block" hint="A future block height. Voting is accepted up to and including this block."
                value={endBlock} onChange={(e) => setEndBlock(e.target.value)} inputMode="numeric" autoComplete="off" />

            <Select label="Tally mode" value={tallyMode} onChange={(e) => setTallyMode(e.target.value)}
                hint="Approval: full weight on each chosen option. Split: weight divided by your per-option shares.">
                {TALLY_MODES.map((m) => <option key={m} value={m}>{TALLY_MODE_LABEL[m] || m}</option>)}
            </Select>

            <Select label="Weight mode" value={weightMode} onChange={(e) => setWeightMode(e.target.value)}
                hint={WEIGHT_MODE_HINT[weightMode]}>
                {WEIGHT_MODES.map((m) => <option key={m} value={m}>{WEIGHT_MODE_LABEL[m] || m}</option>)}
            </Select>

            <Input label="Max selections" hint="How many options one ballot may list (1 = single choice)."
                value={maxSelections} onChange={(e) => setMaxSelections(e.target.value)} inputMode="numeric" autoComplete="off" />

            <Button type="button" variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide advanced' : 'Advanced (gates + deposit)'}
            </Button>
            {showAdvanced ? (
                <>
                    <Input label="Quorum (optional)" hint="Smallest share of the token supply that must vote for the result to count, e.g. 0.2 means 20%."
                        value={quorum} onChange={(e) => setQuorum(e.target.value)} autoComplete="off" />
                    <Input label="Minimum voters (optional)" hint="Minimum distinct qualifying voters."
                        value={minVoters} onChange={(e) => setMinVoters(e.target.value)} inputMode="numeric" autoComplete="off" />
                    <Input label="Minimum vote balance (optional)" hint="A voter counts toward the participation gate only if they hold at least this much. Required for quadratic weighting."
                        value={minVoteBalance} onChange={(e) => setMinVoteBalance(e.target.value)} autoComplete="off" />
                    <Input label="Early-decide threshold (optional)" hint="Fraction of supply an option must reach to close the poll early."
                        value={decideThreshold} onChange={(e) => setDecideThreshold(e.target.value)} autoComplete="off" />
                    <Input label="Creation deposit (optional)" hint="A GAS deposit held while the poll runs as anti-spam: returned when the poll closes, kept if too few people vote."
                        value={deposit} onChange={(e) => setDeposit(e.target.value)} autoComplete="off" />
                </>
            ) : null}

            <Button type="button" variant="ghost" onClick={() => setShowBinding((v) => !v)}>
                {showBinding ? 'Hide binding poll' : 'Binding poll (run a contract on the result)'}
            </Button>
            {showBinding ? (
                <>
                    <p className={styles.hint}>
                        A binding poll doesn&rsquo;t just record an opinion: when it
                        finishes, the network calls a contract with the result. Use it to
                        release funds or change a setting automatically. Leave the contract
                        blank to keep this poll advisory.
                    </p>
                    <Input label="Contract to call (optional)" hint="The contract's number, shown on its page in the explorer."
                        value={callbackContract} onChange={(e) => setCallbackContract(e.target.value)} inputMode="numeric" autoComplete="off" />
                    {isBinding ? (
                        <>
                            <Input label="Method to run" hint="The method name on that contract, e.g. releaseFunds."
                                value={callbackMethod} onChange={(e) => setCallbackMethod(e.target.value)} autoComplete="off" />
                            <Select label="When to call it" value={callbackOn} onChange={(e) => setCallbackOn(e.target.value)}
                                hint="Only on a pass runs the contract when the poll wins its vote. On every result also runs it when the poll fails its turnout gate.">
                                {CALLBACK_ON_VALUES.map((v) => (
                                    <option key={v} value={v}>
                                        {v === 'pass' ? 'Only when the poll passes' : 'On every result'}
                                    </option>
                                ))}
                            </Select>
                            <Input label="Extra arguments (optional)" hint='A JSON list appended after the poll result, e.g. ["treasury", 1000].'
                                value={callbackParams} onChange={(e) => setCallbackParams(e.target.value)} autoComplete="off" />
                            <Input label="Escrow to fund the call (optional)" hint="GAS locked at creation to pay for running the contract; released when the poll finishes."
                                value={gasEscrow} onChange={(e) => setGasEscrow(e.target.value)} autoComplete="off" />
                            {timelockActive ? (
                                <Input label="Delay before the call runs (optional)" hint="Blocks between the poll closing and the contract running. A delay gives holders time to react to a result before it takes effect."
                                    value={callbackDelayBlocks} onChange={(e) => setCallbackDelayBlocks(e.target.value)} inputMode="numeric" autoComplete="off" />
                            ) : (
                                <p className={styles.hint}>
                                    A delay between the poll closing and the contract running
                                    isn&rsquo;t available on this network yet. Setting one now
                                    would have no effect, and a poll can&rsquo;t be edited
                                    afterwards, so the option appears once the network starts
                                    honoring it.
                                </p>
                            )}
                            <p className={styles.hint}>
                                Because this poll can move value, it needs a quorum and a
                                minimum voter count (set both under Advanced).
                                {minimumsActive
                                    ? ' The network requires them too.'
                                    : ' The network will require them from its next upgrade; this wallet asks for them now so the poll stays valid either side of it.'}
                            </p>
                            {bindingErrors.length > 0 ? (
                                <ul className={styles.hint} style={{ paddingLeft: '1.25rem' }}>
                                    {bindingErrors.map((e) => <li key={e}>{e}</li>)}
                                </ul>
                            ) : null}
                        </>
                    ) : null}
                </>
            ) : null}

            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}

            {formError ? <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage> : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !tick.trim() || cleanOptions.length < 2 || !endBlock.trim()
                        || bindingErrors.length > 0 || actionConfirm.composing}
                >
                    {singleEncode ? 'Create poll' : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}
