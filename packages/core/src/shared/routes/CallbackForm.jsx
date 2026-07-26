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
    Icon,
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
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

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
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const lockedToken = !!(initialChainId && initialTick);
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
        action: 'CALLBACK',
        submitMethods: { hw: 'callbackActionHw', software: 'callbackAction' },
        initialChainId,
        initialFromAddress,
        lockedToken,
        noAddressMessage:
            'No addresses on any chain yet. Use Receive to generate one before a callback.',
    });

    const ticker = (initialTick || '').toUpperCase();
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // Typed-confirmation gate (CALLBACK force-recalls everything; rides the
    // same typed-word rail as DESTROY / SWEEP).
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = typedConfirm.trim().toUpperCase() === 'CALLBACK';

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: opt-in native-coin protocol fee (CALLBACK is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee();

    // Token record: the callback config (CALLBACK_TICK/AMOUNT/BLOCK) and
    // owner, used for the payout preview and the block-height gate.
    const assetInfo = useTokenInfo({ chainId, tick: ticker, skip: !ticker });
    const cbTick = assetInfo?.callbackTick || null;
    const cbAmount = assetInfo?.callbackAmount || null;
    const cbBlock = assetInfo?.callbackBlock ? Number(assetInfo.callbackBlock) : null;
    const owner = assetInfo?.creator || null;

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
        if (!chainId || !ticker || !cbTick) { setSummary(null); return undefined; }
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.tokenHolderSummary !== 'function') return undefined;
        let cancelled = false;
        setSummaryLoading(true);
        messaging.tokenHolderSummary({
            chainId, tick: ticker, owner,
            callbackAmount: cbAmount,
            // Indicative precision: the on-chain payout floors at the
            // CALLBACK_TICK's real decimals (a different token we don't
            // fetch here); 8 keeps the preview from distorting fractional
            // payouts the way a 0-decimal floor would.
            callbackDecimals: 8,
        })
            .then((s) => { if (!cancelled) setSummary(s || null); })
            .catch(() => { if (!cancelled) setSummary(null); })
            .finally(() => { if (!cancelled) setSummaryLoading(false); });
        return () => { cancelled = true; };
    }, [chainId, ticker, cbTick, cbAmount, owner, messaging, walletId]);

    const blockReached = cbBlock == null || currentHeight == null || currentHeight >= cbBlock;
    const configComplete = !!(cbTick && cbAmount);

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

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting' && !confirmModalOpen) return null;
        return decoderLib.decodeAction({
            action: 'CALLBACK',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, confirmModalOpen, actionParams, chainId]);

    // Shared preview block: config, live holder count, total payout, and
    // the dust-split caveat. Rendered on the form and the review stage.
    const previewBlock = (
        <dl className={styles.detailsList}>
            <dt className={styles.detailsLabel}>Pays holders</dt>
            <dd className={styles.detailsValue}>
                {configComplete
                    ? `${cbAmount} ${cbTick} per unit of ${ticker}`
                    : <em>No callback configured for {ticker}.</em>}
            </dd>
            {cbBlock != null ? (
                <>
                    <dt className={styles.detailsLabel}>Allowed from block</dt>
                    <dd className={styles.detailsValue}>
                        {cbBlock.toLocaleString('en-US')}
                        {currentHeight != null
                            ? (blockReached ? ' (reached)' : ` (current ${currentHeight.toLocaleString('en-US')})`)
                            : ''}
                    </dd>
                </>
            ) : null}
            <dt className={styles.detailsLabel}>Holders to pay</dt>
            <dd className={styles.detailsValue}>
                {summaryLoading && !summary
                    ? 'Loading…'
                    : summary
                        ? `${(Number(summary.recipientCount) || 0).toLocaleString('en-US')}${summary.partial ? '+' : ''}`
                        : 'Unavailable'}
            </dd>
            {summary && summary.totalPayout != null ? (
                <>
                    <dt className={styles.detailsLabel}>Total payout</dt>
                    <dd className={styles.detailsValue}>
                        {formatWithThousands(summary.totalPayout)} {cbTick}
                        {summary.partial ? ' (at least)' : ''}
                    </dd>
                </>
            ) : null}
        </dl>
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
                compose: () => messaging.composeForConfirm({
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
                }),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                onApprove: (_creds, composed) => submit({
                    params: actionParams,
                    password: passwordValueRef.current,
                    extraBase: {
                        payFeeInNativeCoin: nativeFee.flag,
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
            console.error('Callback (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(humanizeError(err, 'callback').message);
        }
    }

    function guardBeforeSign() {
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return false;
        }
        if (!ticker) {
            setFormError('No token selected.');
            return false;
        }
        if (!configComplete) {
            setFormError(`${ticker} has no callback configured, so there is nothing to recall. Set the callback token and payout first.`);
            return false;
        }
        if (!blockReached) {
            setFormError(`Callback is not allowed until block ${cbBlock?.toLocaleString('en-US')}. The chain is at ${currentHeight?.toLocaleString('en-US')}.`);
            return false;
        }
        const m = memo.trim();
        if (m.includes('|') || m.includes(';')) {
            setFormError('Memo cannot contain "|" or ";".');
            return false;
        }
        return true;
    }

    function handleReview(event) {
        event.preventDefault();
        if (!guardBeforeSign()) return;
        setFormError(null);
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
                isBadPassword ? 'Incorrect password.' : err?.message || 'Callback failed.',
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
        setSubmitError(null);
        setStage('form');
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review callback' : 'Execute callback'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />,
            );
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Callback broadcast</h2>
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
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    const dustNote = (
        <p className={styles.hint}>
            The holder count and payout are indicative: they can change until the callback
            confirms. Holders can split their balance across new addresses to inflate the
            payout you owe, so the final cost may be higher than shown.
        </p>
    );

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
                </dl>
                {previewBlock}
                {dustNote}
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the signed
                        transaction to a Full-mode wallet to broadcast.
                    </p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => {
                            setPassword(v);
                            if (submitError) setSubmitError(null);
                        }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                        signerInfo={hwSignerInfo}
                    />
                )}
                {(isWatcherMode || isHwSource) && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <Input
                    label="Type CALLBACK to confirm"
                    hint="This recalls every unit of the token from all holders and pays them the amount above. It cannot be undone."
                    value={typedConfirm}
                    onChange={(e) => setTypedConfirm(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant={isWatcherMode ? 'primary' : 'danger'}
                        loading={stage === 'submitting'}
                        disabled={
                            !typedConfirmOk || (
                                isWatcherMode
                                    ? false
                                    : isHwSource
                                        ? hwStatus !== 'available'
                                        : (!signerReady && password.length === 0)
                            )
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `Call back on ${descriptor.displayName}` : 'Call back')}
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
                chainLabel={descriptor?.displayName || chainId}
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
                    <>
                        {previewBlock}
                        {dustNote}
                        <Input
                            label='Type "CALLBACK" to confirm'
                            hint="Recalls all supply and pays holders. Irreversible."
                            value={typedConfirm}
                            onChange={(e) => setTypedConfirm(e.target.value)}
                            autoComplete="off"
                        />
                    </>
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
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div role="alert" className={styles.warnings}>
                <p className={styles.warning}>
                    <strong>Callback recalls everything.</strong> Every unit of {ticker || 'this token'}
                    {' '}returns to your address, and each holder is paid the configured amount. This
                    cannot be undone.
                </p>
            </div>

            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={ticker} />
            ) : null}

            {fromAddress ? (
                <AddressField
                    label="From (token owner)"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            {previewBlock}
            {summaryLoading ? <p className={styles.hint}>Loading holder preview…</p> : null}
            {!configComplete ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        {ticker} has no callback configured. Set the callback token, payout, and
                        block in Callback settings before you can recall.
                    </p>
                </div>
            ) : !blockReached ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        Callback is not allowed yet. It becomes available at block{' '}
                        {cbBlock?.toLocaleString('en-US')}
                        {currentHeight != null ? ` (chain is at ${currentHeight.toLocaleString('en-US')})` : ''}.
                    </p>
                </div>
            ) : null}
            {dustNote}

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />

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
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} />
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={confirmAction.composing}
                    disabled={!fromAddress || !configComplete || !blockReached || confirmAction.composing}
                >
                    {!isWatcherMode ? 'Execute callback' : 'Preview'}
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
