// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
    FeeSelector,
    AddressField,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import {
    isConfirmModalSliceEnabled,
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { interpretSleep } from '../../flows/sleepQueries.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { blockDateEstimateText } from '../utils/blockDateEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * SLEEP form (PC-05). Two modes:
 *
 *  - `'tick'`: the token owner pauses/resumes a tick (SLEEP v1). Pause
 *    until a block, pause indefinitely (-1), or resume now (0). Reversible;
 *    honors LOCK_SLEEP. Copy states that open trades/dispenses still settle.
 *
 *  - `'address'`: the holder self-locks their own address (SLEEP v0). While
 *    asleep the address cannot submit ANY action, INCLUDING a resume, so a
 *    large or indefinite block freezes it with no undo. Guarded with a typed
 *    confirm and an irreversibility warning; no "resume now" option (an
 *    address sleep auto-resumes at its block and cannot be lifted early).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {'tick' | 'address'} props.mode
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialTick]              tick mode: the token to pause
 * @param {string} [props.initialFromAddress]
 */
export function SleepForm({ walletId, onBack, mode, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const isTick = mode === 'tick';

    const lockedToken = isTick && !!(initialChainId && initialTick);
    const {
        addressesByChain,
        loadError,
        chainId,
        setChainId,
        fromAddress,
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
        action: 'SLEEP',
        submitMethods: { hw: 'sleepActionHw', software: 'sleepAction' },
        initialChainId,
        initialFromAddress,
        lockedToken,
        noAddressMessage:
            'No addresses on any chain yet. Use Receive to generate one first.',
    });

    const ticker = isTick ? (initialTick || '').toUpperCase() : '';
    // Pause target: the tick (v1) or the signing address itself (v0).
    const [resumeMode, setResumeMode] = useState(
        /** @type {'until' | 'indefinite' | 'resume'} */ ('until'),
    );
    const [resumeBlockInput, setResumeBlockInput] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    // Address self-lock is irreversible: gate it behind a typed confirm.
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = isTick || typedConfirm.trim().toUpperCase() === 'SLEEP';

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Tick record: LOCK_SLEEP gate (tick mode only).
    const assetInfo = useTokenInfo({ chainId, tick: ticker, skip: !isTick || !ticker });
    const sleepLocked = isTick && !!assetInfo?.locks?.sleep;

    // Current chain height (future-block validation + date estimate + state).
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

    // Current pause state of the target (tick name, or the signing address).
    const stateQuery = isTick ? ticker : fromAddress?.address;
    const [sleepRow, setSleepRow] = useState(/** @type {any | null} */ (null));
    useEffect(() => {
        if (!chainId || !stateQuery) { setSleepRow(null); return undefined; }
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.sleepState !== 'function') return undefined;
        let cancelled = false;
        messaging.sleepState({ chainId, query: stateQuery, type: isTick ? 'token' : 'address' })
            .then((s) => { if (!cancelled) setSleepRow(s || null); })
            .catch(() => { if (!cancelled) setSleepRow(null); });
        return () => { cancelled = true; };
    }, [chainId, stateQuery, isTick, messaging, walletId]);
    const currentState = useMemo(
        () => interpretSleep(sleepRow ? sleepRow.resumeBlock : null, currentHeight),
        [sleepRow, currentHeight],
    );

    const resumeBlockEstimate = blockDateEstimateText({ coin: descriptor?.coin, currentHeight, targetBlock: resumeBlockInput });

    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom' ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 }) : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const singleEncode = isConfirmModalSliceEnabled(settings, 'actionForms');
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    // The RESUME_BLOCK value the chosen option produces.
    const resumeBlockValue = resumeMode === 'indefinite' ? '-1'
        : resumeMode === 'resume' ? '0'
            : String(resumeBlockInput).trim();

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = isTick
            ? { VERSION: '1', RESUME_BLOCK: resumeBlockValue, TICK: ticker }
            : { VERSION: '0', RESUME_BLOCK: resumeBlockValue };
        if (memo.trim().length > 0) p.MEMO = memo.trim();
        return p;
    }, [isTick, resumeBlockValue, ticker, memo]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting' && !confirmModalOpen) return null;
        return decoderLib.decodeAction({
            action: 'SLEEP', params: actionParams, chainId: chainId || undefined, chainRegistry,
        });
    }, [stage, confirmModalOpen, actionParams, chainId]);

    function guardBeforeSign() {
        if (!chainId || !fromAddress) { setFormError('Pick a source address first.'); return false; }
        if (isTick && !ticker) { setFormError('No token selected.'); return false; }
        if (isTick && sleepLocked) { setFormError(`Pausing is permanently locked for ${ticker} (LOCK_SLEEP).`); return false; }
        if (resumeMode === 'until') {
            const rb = String(resumeBlockInput).trim();
            if (!/^\d+$/.test(rb)) { setFormError('Enter a whole block height to pause until.'); return false; }
            if (currentHeight != null && Number(rb) <= currentHeight) {
                setFormError(`The resume block must be in the future (chain is at ${currentHeight.toLocaleString('en-US')}).`);
                return false;
            }
        }
        const m = memo.trim();
        if (m.includes('|') || m.includes(';')) { setFormError('Memo cannot contain "|" or ";".'); return false; }
        return true;
    }

    async function openConfirmModal() {
        const from = buildFrom();
        if (!chainId || !from) return;
        setSubmitError(null);
        setTypedConfirm('');
        try {
            const res = await confirmAction.confirm({
                chainId,
                source: from.address,
                preflightOpts: { mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report' },
                compose: () => messaging.composeForConfirm({
                    walletId, chainId, from,
                    actionData: { action: 'SLEEP', params: actionParams },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                }),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                onApprove: (_creds, composed) => submit({
                    params: actionParams,
                    password: passwordValueRef.current,
                    extraBase: {
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt: {
                            psbtHex: composed.psbt,
                            encoding: composed.encoding,
                            actionString: composed.actionString,
                            version: composed.version,
                        },
                    },
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            console.error('Sleep (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(humanizeError(err, 'sleep').message);
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!guardBeforeSign()) return;
        setFormError(null);
        // Address self-lock always uses the legacy review stage so the typed
        // confirm + irreversibility warning sit in front of the signature.
        if (singleEncode && !isWatcherMode && isTick) { openConfirmModal(); return; }
        setStage('review');
    }

    const hwSignerInfo = useSignerInfo({ walletId, signerId: isHwSource ? fromAddress?.signerId : null });

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        if (!typedConfirmOk) return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await submit({
                params: actionParams,
                password,
                ...(feePerKb != null ? { extraBase: { feePerKb }, encoderOpts: { feePerKb } } : {}),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : err?.message || 'Sleep failed.');
            setStage('review');
            if (!isWatcherMode && !isHwSource) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        }
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const titleNoun = isTick ? (resumeMode === 'resume' ? 'Resume token' : 'Pause token') : 'Lock address';
    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? `Review ${titleNoun.toLowerCase()}` : titleNoun}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    if (!addressesByChain || !chainId) return wrap(<p className={styles.hint}>Loading…</p>);

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />);
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>{titleNoun} broadcast</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : <p className={styles.hint}>Broadcast complete.</p>}
                <div className={styles.actions}><Button variant="primary" onClick={onBack}>Done</Button></div>
            </>,
        );
    }

    const stateLine = (
        <p className={styles.hint}>
            {isTick ? `${ticker} is currently ` : 'This address is currently '}
            {currentState.paused
                ? (currentState.indefinite
                    ? 'PAUSED indefinitely.'
                    : `PAUSED${currentState.resumeBlock ? ` until block ${currentState.resumeBlock.toLocaleString('en-US')}` : ''}.`)
                : 'active (not paused).'}
        </p>
    );

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}` : 'Estimate unavailable'}
                    />
                </dl>
                {isTick ? (
                    <p className={styles.hint}>
                        Pausing {ticker} does not stop already-open orders, swaps, or dispensers
                        from settling. It blocks new actions on the token until it resumes.
                    </p>
                ) : (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>
                            <strong>This locks your own address.</strong> While it is asleep you cannot
                            send anything from it, including a command to wake it up. It unlocks on its
                            own only when the resume block is reached
                            {resumeMode === 'indefinite' ? ', which for an indefinite lock is NEVER' : ''}.
                        </p>
                    </div>
                )}
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => <p key={i} className={styles.warning}>{w}</p>)}
                    </div>
                ) : null}
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction. Sign it on your
                        Signer-mode wallet, then broadcast from a Full-mode wallet.
                    </p>
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
                        signerInfo={hwSignerInfo}
                    />
                )}
                {(isWatcherMode || isHwSource) && submitError ? <div role="alert" className={styles.error}>{submitError}</div> : null}
                {!isTick ? (
                    <Input
                        label="Type SLEEP to confirm"
                        hint="This locks your address and cannot be undone before the resume block."
                        value={typedConfirm}
                        onChange={(e) => setTypedConfirm(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant={isWatcherMode ? 'primary' : (isTick && resumeMode === 'resume') ? 'primary' : 'danger'}
                        loading={stage === 'submitting'}
                        disabled={!typedConfirmOk || (
                            isWatcherMode ? false : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)
                        )}
                    >
                        {isWatcherMode ? 'Create unsigned transaction'
                            : isHwSource ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `${titleNoun} on ${descriptor.displayName}` : titleNoun)}
                    </Button>
                </div>
            </form>,
        );
    }

    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                screenVariant={variant}
                decoded={decoded}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim() : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                credentialsReady={isHwSource ? hwStatus === 'available' : (signerReady || password.length > 0)}
                extraCredentials={(
                    <p className={styles.hint}>
                        Pausing {ticker} does not stop already-open orders, swaps, or dispensers from settling.
                    </p>
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
                title="From address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {isTick ? (
                <>
                    {lockedToken && chainId ? <LockedTokenContext chainId={chainId} tick={ticker} /> : null}
                    <p className={styles.hint}>
                        Pausing a token blocks new actions on it until you resume. Open orders, swaps,
                        and dispensers still settle (funds are never trapped mid-trade).
                    </p>
                    {sleepLocked ? (
                        <div role="alert" className={styles.warnings}>
                            <p className={styles.warning}>Pausing is permanently locked for {ticker} (LOCK_SLEEP).</p>
                        </div>
                    ) : null}
                </>
            ) : (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        <strong>Locking an address is a one-way freeze.</strong> A slept address can't
                        send anything, including a wake-up, so it stays locked until the resume block
                        arrives. Choose the block carefully; an indefinite lock is permanent.
                    </p>
                </div>
            )}

            {stateLine}

            {fromAddress ? (
                <AddressField
                    label={isTick ? 'From (token owner)' : 'Address to lock'}
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
            ) : (
                <div role="alert" className={styles.error}>No address on this chain. Use Receive to generate one first.</div>
            )}

            <p className={styles.successLabel}>{isTick ? 'Pause setting' : 'Lock duration'}</p>
            {isTick ? (
                <label className={styles.checkRow}>
                    <input type="radio" name="sleep-mode" checked={resumeMode === 'resume'} onChange={() => setResumeMode('resume')} disabled={sleepLocked} />
                    {' '}Resume now (unpause)
                </label>
            ) : null}
            <label className={styles.checkRow}>
                <input type="radio" name="sleep-mode" checked={resumeMode === 'until'} onChange={() => setResumeMode('until')} disabled={isTick && sleepLocked} />
                {' '}{isTick ? 'Pause until a block' : 'Lock until a block'}
            </label>
            {resumeMode === 'until' ? (
                <Input
                    label="Resume at block"
                    hint={resumeBlockEstimate ? `Actions resume at this block. Est. ${resumeBlockEstimate}.` : 'Block height when actions resume. Must be a future block.'}
                    inputMode="decimal"
                    value={resumeBlockInput}
                    onChange={(e) => setResumeBlockInput(e.target.value)}
                    autoComplete="off"
                    disabled={isTick && sleepLocked}
                />
            ) : null}
            <label className={styles.checkRow}>
                <input type="radio" name="sleep-mode" checked={resumeMode === 'indefinite'} onChange={() => setResumeMode('indefinite')} disabled={isTick && sleepLocked} />
                {' '}{isTick ? 'Pause indefinitely' : 'Lock indefinitely (permanent)'}
            </label>
            {currentHeight != null ? (
                <p className={styles.hint}>Current block on {descriptor?.displayName || chainId}: {currentHeight.toLocaleString('en-US')}.</p>
            ) : null}

            <Input label="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} autoComplete="off" />

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
                    loading={confirmAction.composing}
                    disabled={!fromAddress || (isTick && sleepLocked) || (resumeMode === 'until' && !resumeBlockInput) || confirmAction.composing}
                >
                    {(singleEncode && !isWatcherMode && isTick) ? titleNoun : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}
