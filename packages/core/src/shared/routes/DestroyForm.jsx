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
 NetworkField,  Icon, FeeSelector, AddressField,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import {
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { TokenPicker } from './TokenPicker.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import styles from './IssueTokenForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Destroy form (§40.4).
 *
 * Burns `AMOUNT` of the caller's balance of `TICK`. Irreversible at
 * the protocol level: once broadcast and mined, the destroyed balance
 * is gone. The review screen leads with the decoder's "Destroy is
 * irreversible" warning (see action-decoder.smoke.js case 2h) and the
 * form prefaces the ticker field with the same prose.
 *
 * Until the Token detail page (§40.5 context) ships, the ticker is
 * user-entered. From Token detail, callers will pass in a prefilled
 * ticker.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function DestroyForm({ walletId, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const lockedToken = !!(initialChainId && initialTick);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    // Shared source-loading + `from` descriptor + signer dispatch (G6).
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
        action: 'DESTROY',
        submitMethods: { hw: 'destroyAssetHw', software: 'destroyToken' },
        initialChainId,
        initialFromAddress,
        lockedToken,
        noAddressMessage:
            'No addresses on any chain yet. Use Receive to generate one before destroying.',
    });


    // Typed-confirmation gate on the review stage. User must type
    // DESTROY before the Sign button enables, on top of the existing
    // password / HW gate. Reset on every stage transition so the
    // confirmation can't carry forward from a previously-cancelled
    // review.
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = typedConfirm.trim().toUpperCase() === 'DESTROY';

    const [ticker, setTicker] = useState((initialTick || '').toUpperCase());

    // Balance of the amount tick at the source address (Max + "available").
    const tickAmtBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: ticker,
    });
    const [amount, setAmount] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (DESTROY is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

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

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    //  §5.6 slice 2 (actionForms): destroys go through the single-encode
    // confirm page (compose + tamper + sdk.preflight all host-side), hardware
    // included . Watcher mode keeps the legacy review stage: it
    // encodes, it never signs. The typed-DESTROY gate rides in the confirm
    // page's credentials block.
    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);
    // The modal's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const actionParams = useMemo(() => ({
        VERSION: '0',
        TICK: ticker.trim().toUpperCase(),
        AMOUNT: String(amount).trim(),
    }), [ticker, amount]);

    const decoded = useMemo(() => {
        //  residual (§5.6 slice 5): the confirm page renders the intent
        // the HOST described from the composed action string
        // (`composed.decoded`), so this local describer serves the LEGACY
        // review stage only - the watcher, demo and locked-ECDH path. It used
        // to also recompute while the confirm page was open, which was work
        // nothing read and, worse, read like the confirm surface still
        // depended on form state.
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'DESTROY',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, confirmModalOpen, actionParams, chainId]);

    // Single-encode confirm (mirrors Send slice 1): compose + tamper-check +
    // pre-flight run HOST-side; Approve signs the byte-identical prebuilt
    // PSBT via destroyToken.prebuiltPsbt. Reject is a calm no-op back to
    // the form; real failures land in the form error banner.
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
                    actionData: { action: 'DESTROY', params: actionParams },
                    // PC-51: the opt-in must reach COMPOSE so the FEE_DESTINATION
                    // output sits inside the PSBT the user approves.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                }),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                // : re-price the native-coin protocol fee at Approve.
                // The output was sized at compose, and the amount consensus
                // requires moves inversely with the coin price, so a move while
                // the confirm screen sits open leaves it short - which the
                // chain rejects while keeping the fee.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
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
            console.error('Destroy (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(submitFailureMessage(err, {
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: humanizeError(err, 'destroy').message,
            }));
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!ticker.trim()) {
            setFormError('Ticker is required.');
            return;
        }
        if (!/^[A-Za-z0-9.]+$/.test(ticker.trim())) {
            setFormError('Ticker must be A–Z, 0–9 (subtokens may include a period).');
            return;
        }
        const amt = String(amount).trim();
        if (!amt || Number(amt) <= 0) {
            setFormError('Amount must be a positive number.');
            return;
        }
        setFormError(null);
        //  slice 2: with the flag on, software destroys go straight
        // to the single-encode confirm modal instead of the legacy review
        // stage. Hardware + watcher keep the legacy path for this slice.
        if (!isWatcherMode) {
            openConfirmModal();
            return;
        }
        setStage('review');
    }

    // §18.4 / Cluster N: HW signer info threads into <SignCredentials>.
    // `isHwSource` + `fromAddress` come from the shared hook.
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
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Destroy failed.',
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
        setSubmitError(null);
        setStage('form');
    }
        const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting'
                    ? 'Review destroy'
                    : `Destroy`}
        />
    );
    const wrap = (children, footer = null) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
            {footer}
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
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        // : signed but not broadcast. Nothing has been destroyed yet.
        if (result?.queued) {
            return wrap(<QueuedResultPanel onDone={onBack} what="destroy" />);
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Destroyed</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

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
                    {(decoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
                </dl>
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
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
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
                    label="Type DESTROY to confirm"
                    hint="This burns the amount above and cannot be undone."
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
                                : (descriptor ? `Destroy on ${descriptor.displayName}` : 'Destroy')}
                    </Button>
                </div>
            </form>,
        );
    }

    //  confirm page, rendered in place of the form (operator
    // direction 2026-07-22: the overlay modal didn't fit small/mobile
    // viewports). All other form state stays intact behind it; the
    // typed-DESTROY gate rides in the credentials block.
    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                // Fallback only: the composed PSBT's exact fee wins (§5.2.5).
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // The typed-DESTROY gate is ANDed onto whichever credential the
                // source needs: a password, or an available device .
                credentialsReady={(isHwSource
                    ? hwStatus === 'available'
                    : (signerReady || password.length > 0)) && typedConfirmOk}
                extraCredentials={(
                    <Input
                        label='Type "DESTROY" to confirm'
                        hint="Destroying tokens is irreversible."
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

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select token"
                onSelect={(sel) => {
                    setTicker(String(sel.tick || '').toUpperCase());
                    if (!lockedToken && sel.chainId) setChainId(sel.chainId);
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div role="alert" className={styles.warnings}>
                <p className={styles.warning}>
                    <strong>Destroy is irreversible.</strong> The burned amount cannot be recovered.
                </p>
            </div>

            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={ticker} />
            ) : (
                <>
                    <NetworkField value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />
                </>
            )}

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
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            {lockedToken ? null : (
                <TokenField
                    label="Token"
                    value={ticker && chainId ? { chainId, tick: ticker } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                />
            )}
            <AmountField
                label="Amount"
                hint="How much to destroy."
                amount={amount}
                tick={ticker}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setAmount(stripped);
                }}
                onMax={tickAmtBalance && Number(tickAmtBalance) > 0
                    ? () => setAmount(tickAmtBalance)
                    : undefined}
                maxDisabled={!tickAmtBalance}
                balanceText={tickAmtBalance != null && (ticker)
                    ? `${formatWithThousands(tickAmtBalance)} ${String(ticker).toUpperCase()} available`
                    : null}
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
                    disabled={!fromAddress || !ticker || !amount || confirmAction.composing}
                >
                    {!isWatcherMode ? 'Destroy' : 'Preview'}
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
