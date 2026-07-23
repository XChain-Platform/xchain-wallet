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
import {
    Screen,
    PageHeader,
    Button,
    Input,
    Select,
    Textarea,
    ChainBadge,
    NetworkField,
    AddressText,
    FeeSelector,
    AddressField,
} from '@xchain-wallet/core/ui';
import { registry as registryLib, decoder as decoderLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
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
import styles from './IssueTokenForm.module.css';

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
        return p;
    }, [tick, endBlock, cleanOptions, maxSelections, tallyMode, weightMode, question, quorum, minVoters, minVoteBalance, decideThreshold, deposit]);

    // Wire-format VOTE v0 params: what the encoder actually sees. The host's
    // sdk.voting.createPollParams builds the same shape from `pollParams`;
    // watcher mode and the single-encode confirm page both need it here.
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
    }), [pollParams, cleanOptions]);

    //  ( §5.6 slice 2): software polls go through the
    // single-encode confirm page; hardware + watcher keep the legacy
    // review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = actionConfirm.enabled && !isWatcherMode && !isHwSource;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    const decoded = useMemo(() => {
        if (!actionConfirm.open) return null;
        return decoderLib.decodeAction({
            action: 'VOTE', params: wireParams, chainId: chainId || undefined, chainRegistry,
        });
    }, [actionConfirm.open, wireParams, chainId]);

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
                actionData: { action: 'VOTE', params: wireParams },
                ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                onApprove: (prebuiltPsbt) => messaging.createPollAction({
                    walletId,
                    chainId,
                    from,
                    params: pollParams,
                    password: passwordValueRef.current,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.message || 'Create poll failed.');
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) { setFormError('No source address available.'); return; }
        if (!tick.trim()) { setFormError('Governance token is required.'); return; }
        if (!endBlock.trim() || !/^\d+$/.test(endBlock.trim())) { setFormError('End block must be a block height (a future block).'); return; }
        if (cleanOptions.length < 2) { setFormError('Add at least two non-empty options.'); return; }
        if (cleanOptions.some((o) => o.includes(','))) { setFormError('Option labels cannot contain a comma.'); return; }
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
            setSubmitError(isBadPassword ? 'Incorrect password.' : err?.message || 'Create poll failed.');
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
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!addressesByChain) return wrap(<p>Loading addresses…</p>);

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
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
                {(isWatcherMode || isHwSource) && submitError ? (<div role="alert" className={styles.error}>{submitError}</div>) : null}
                <div className={styles.actions}>
                    <Button type="submit" variant="primary" loading={stage === 'submitting'}
                        disabled={isWatcherMode ? false : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)}>
                        {isWatcherMode ? 'Create unsigned transaction' : isHwSource ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}` : 'Create poll'}
                    </Button>
                </div>
            </form>,
        );
    }

    //  confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                decoded={decoded}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
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

            {formError ? <div role="alert" className={styles.error}>{formError}</div> : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !tick.trim() || cleanOptions.length < 2 || !endBlock.trim() || actionConfirm.composing}
                >
                    {singleEncode ? 'Create poll' : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}
