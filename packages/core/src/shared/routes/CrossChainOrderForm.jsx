// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AddressField, AddressText, Button, ChainBadge, ChainPicker, FeeSelector, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { resolvePreflightPrivacy } from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useGetChainAddress } from '../hooks/useGetChainAddress.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// descriptor.coin is long-form; ORDER serializes the short-form ticker in
// GIVE_COIN / GET_COIN.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// datetime-local string -> Unix seconds (the indexer compares ORDER
// EXPIRATION as a wall-clock Unix timestamp, not a block height).
function localInputToUnix(localStr) {
    const ms = Date.parse(String(localStr));
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
}

const isPlainPositive = (v) => /^\d+(\.\d+)?$/.test(String(v).trim()) && Number(String(v).trim()) > 0;

/**
 * Cross-chain ORDER authoring surface: GIVE_COIN != GET_COIN.
 *
 * The order is signed and broadcast on the give chain, where the GIVE side
 * is escrowed. It is not matched by that chain's DEX: the validator
 * federation matches it on a price-time book against orders resting on the
 * get chain, may fill it partially across several matches, and settles
 * each fill from escrow on both chains (CROSS_SETTLE), with no per-trade
 * transaction. GET_ADDRESS is mandatory here because the counterparty's
 * leg is released to it on the get chain.
 *
 * Token-only on both sides: a native-coin side has no escrow the
 * federation could release, so the same-chain CoinPay lane does not apply.
 * Same-chain orders (native sides, allow/block lists) stay on
 * CreateOrderForm.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialFromAddress]
 * @param {() => void} [props.onManageOrders]   optional deep-link to My Orders
 */
export function CrossChainOrderForm({ walletId, onBack, initialChainId, initialFromAddress, onManageOrders }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    // The give chain is the one chain this form signs on; useActionForm owns
    // it, the source address on it and the three-way signer dispatch.
    const {
        addressesByChain,
        loadError,
        chainId: giveChainId,
        setChainId: setGiveChainId,
        chainsWithAddresses,
        fromAddress,
        setFromAddressId,
        descriptor: giveDescriptor,
        signerReady,
        isWatcherMode,
        isHwSource,
        hwStatus,
        onHwStatusChange,
        buildFrom,
        submit,
    } = useActionForm({
        walletId,
        action: 'ORDER',
        submitMethods: { hw: 'orderActionHw', software: 'orderAction' },
        initialChainId,
        initialFromAddress,
        noAddressMessage: 'No addresses on any chain yet. Use Receive to generate addresses on at least two chains before creating a cross-chain order.',
    });

    const [getChainId, setGetChainId] = useState(/** @type {string | null} */ (null));
    const getDescriptor = getChainId ? chainRegistry.get(getChainId) : null;
    const giveCoinTicker = giveDescriptor ? (PROTOCOL_COIN_TICKER[giveDescriptor.coin] || '') : '';
    const getCoinTicker = getDescriptor ? (PROTOCOL_COIN_TICKER[getDescriptor.coin] || '') : '';

    // Default the get chain to the first chain whose coin differs from the
    // give chain's, once the address load has settled.
    useEffect(() => {
        if (getChainId || !giveChainId || chainsWithAddresses.length === 0) return;
        const other = chainsWithAddresses.find((cid) => {
            const d = chainRegistry.get(cid);
            return d && d.coin !== giveDescriptor?.coin;
        });
        if (other) setGetChainId(other);
    }, [giveChainId, giveDescriptor, chainsWithAddresses, getChainId]);

    const { getAddress, setGetAddress, resetGetAddress } = useGetChainAddress({ messaging, walletId, getChainId });

    const [giveTick, setGiveTick] = useState('');
    const [giveAmount, setGiveAmount] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(false);
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    const [getOwnership, setGetOwnership] = useState(false);
    const [expMode, setExpMode] = useState(/** @type {'default' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    const giveBalance = useTickBalance({
        messaging,
        walletId,
        chainId: giveChainId,
        address: fromAddress?.address,
        tick: giveTick,
    });

    // The protocol fee is paid on the give chain, the chain that is signed.
    const nativeFee = useNativeFee(giveCoinTicker);
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId: giveChainId, chainRegistry }), [giveChainId]);
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom' ? customFeeEstimate({ chainId: giveChainId, chainRegistry, rate: Number(feePick.customRate) || 0 }) : null),
        [giveChainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId: giveChainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;
    const feeText = feeEstimate
        ? `${feeEstimate.coinAmount} ${giveCoinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
        : 'Estimate unavailable';

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const singleEncode = !isWatcherMode;
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    // Give and get name different coins; GET_ADDRESS is required because the
    // fill is released on the get chain, where the source address does not
    // exist.
    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '0', GIVE_COIN: giveCoinTicker, GIVE_TICK: giveTick.trim().toUpperCase() };
        if (giveOwnership) p.GIVE_OWNERSHIP = '1'; else p.GIVE_AMOUNT = giveAmount.trim();
        p.GET_COIN = getCoinTicker;
        p.GET_TICK = getTick.trim().toUpperCase();
        if (getOwnership) p.GET_OWNERSHIP = '1'; else p.GET_AMOUNT = getAmount.trim();
        p.GET_ADDRESS = getAddress.trim();
        if (expMode === 'custom' && expInput.trim()) {
            const unix = localInputToUnix(expInput.trim());
            if (unix) p.EXPIRATION = String(unix);
        }
        if (memo.trim()) p.MEMO = memo.trim();
        return p;
    }, [giveCoinTicker, giveTick, giveAmount, giveOwnership, getCoinTicker, getTick, getAmount, getOwnership, getAddress, expMode, expInput, memo]);

    const validationError = useMemo(() => {
        if (!giveCoinTicker || !getCoinTicker) return null;
        if (giveCoinTicker === getCoinTicker) {
            return 'Give and get chains must differ. For a same-chain order use Create order.';
        }
        if (giveTick && giveTick.trim().toUpperCase() === giveCoinTicker) {
            return `A cross-chain order cannot give native ${giveCoinTicker}; only a token can be escrowed for the federation to settle.`;
        }
        if (getTick && getTick.trim().toUpperCase() === getCoinTicker) {
            return `A cross-chain order cannot get native ${getCoinTicker}; ask for a token on ${getDescriptor?.displayName || getChainId}.`;
        }
        return null;
    }, [giveCoinTicker, getCoinTicker, giveTick, getTick, getDescriptor, getChainId]);

    function guardBeforeSign() {
        if (!giveChainId || !fromAddress) { setFormError('Pick a source address first.'); return false; }
        if (!getChainId) { setFormError('Pick the chain you want to receive on.'); return false; }
        if (validationError) { setFormError(validationError); return false; }
        if (!giveTick.trim()) { setFormError('Enter the ticker you are offering.'); return false; }
        if (!giveOwnership && !isPlainPositive(giveAmount)) { setFormError('Enter a positive amount to give.'); return false; }
        if (!getTick.trim()) { setFormError('Enter the ticker you want in return.'); return false; }
        if (!getOwnership && !isPlainPositive(getAmount)) { setFormError('Enter a positive amount to receive.'); return false; }
        const ga = getAddress.trim();
        if (!ga) { setFormError(`Receive address on ${getDescriptor?.displayName || 'the get chain'} is required.`); return false; }
        if (ga.includes('|') || ga.includes(';')) { setFormError('Receive address is invalid.'); return false; }
        if (expMode === 'custom') {
            const raw = expInput.trim();
            if (!raw) { setFormError('Pick an expiration date and time, or switch to the default window.'); return false; }
            const unix = localInputToUnix(raw);
            if (!unix || unix <= Math.floor(Date.now() / 1000)) { setFormError('Expiration must be a future date and time.'); return false; }
        }
        const m = memo.trim();
        if (m.includes('|') || m.includes(';')) { setFormError('Memo cannot contain "|" or ";".'); return false; }
        return true;
    }

    const extraBaseFor = (composed) => ({
        payFeeInNativeCoin: nativeFee.flag,
        ...(feePerKb != null ? { feePerKb } : {}),
        ...(composed ? {
            prebuiltPsbt: {
                psbtHex: composed.psbt,
                encoding: composed.encoding,
                actionString: composed.actionString,
                version: composed.version,
                // Outputs compose left off the previewed PSBT because they
                // ride the reveal the submit path builds (see
                // useActionConfirmFlow); dropping them burns the reserved value.
                deferredFeeOutput: composed.deferredFeeOutput || null,
                deferredOutputs: composed.deferredOutputs || [],
                revealOpts: composed.revealOpts || null,
                adsDonation: { included: !!composed.adsPlan?.canSubmit },
            },
        } : {}),
    });

    async function openConfirmModal() {
        const from = buildFrom();
        if (!giveChainId || !from) return;
        setSubmitError(null);
        try {
            const res = await confirmAction.confirm({
                chainId: giveChainId,
                source: from.address,
                preflightOpts: { mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report' },
                compose: () => messaging.composeForConfirm({
                    walletId, chainId: giveChainId, from,
                    actionData: { action: 'ORDER', params: actionParams },
                    // The opt-in must reach COMPOSE so the FEE_DESTINATION
                    // output sits inside the PSBT the user approves.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                }),
                preflight: (o) => messaging.preflight({ chainId: giveChainId, ...o }),
                // Re-price the native-coin protocol fee at Approve: the amount
                // consensus requires moves with the coin price while the
                // confirm screen sits open.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId: giveChainId, actionString, source,
                }),
                onApprove: (_creds, composed) => submit({
                    params: actionParams,
                    password: passwordValueRef.current,
                    extraBase: extraBaseFor(composed),
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            console.error('Cross-chain order (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(submitFailureMessage(err, {
                chainId: giveChainId,
                coinTicker: giveCoinTicker,
                mandatory: nativeFee.mandatory,
                fallback: humanizeError(err, 'order').message,
            }));
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!guardBeforeSign()) return;
        setFormError(null);
        if (singleEncode) { openConfirmModal(); return; }
        setStage('review');
    }

    const hwSignerInfo = useSignerInfo({ walletId, signerId: isHwSource ? fromAddress?.signerId : null });

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
                extraBase: extraBaseFor(null),
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
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId: giveChainId,
                coinTicker: giveCoinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Order failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !isHwSource) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        }
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review order' : 'Cross-chain order'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    if (!addressesByChain || !giveChainId) return wrap(<p className={styles.hint}>Loading…</p>);

    const chainIds = chainsWithAddresses.length ? chainsWithAddresses : [giveChainId];
    const distinctCoins = new Set(chainIds.map((cid) => chainRegistry.get(cid)?.coin).filter(Boolean));
    if (distinctCoins.size < 2) {
        return wrap(
            <StatusMessage variant="error" className={styles.error}>
                A cross-chain order needs addresses on two different chains. Use Receive on a second chain and try again.
            </StatusMessage>,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />);
        }
        if (result?.queued) {
            return wrap(<QueuedResultPanel onDone={onBack} what="cross-chain order" />);
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Cross-chain order broadcast</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Give-chain transaction</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : <p className={styles.hint}>Broadcast complete.</p>}
                <p className={styles.hint}>
                    Your {giveTick.trim().toUpperCase()} is escrowed on {giveDescriptor?.displayName}. The validator
                    federation matches this order against the book on {getDescriptor?.displayName}; it may fill in
                    parts, and each fill is released from escrow on both chains with no further transaction from you.
                </p>
                <div className={styles.actions}>
                    {onManageOrders ? <Button variant="secondary" onClick={onManageOrders}>My orders</Button> : null}
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                screenVariant={variant}
                chainLabel={giveDescriptor?.displayName || giveChainId}
                feeText={feeEstimate?.coinAmount ? `Network fee: ${feeEstimate.coinAmount} ${giveCoinTicker}`.trim() : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                credentialsReady={isHwSource ? hwStatus === 'available' : (signerReady || password.length > 0)}
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={giveChainId}
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
                chainId={giveChainId}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Offer {giveOwnership ? `ownership of ${giveTick}` : `${giveAmount} ${giveTick}`} on {giveDescriptor?.displayName || giveChainId} for
                    {' '}{getOwnership ? `ownership of ${getTick}` : `${getAmount} ${getTick}`} on {getDescriptor?.displayName || getChainId}.
                </p>
                <dl className={styles.detailsList}>
                    <DetailRow label="Give chain" value={giveDescriptor ? <ChainBadge descriptor={giveDescriptor} size="sm" /> : giveChainId} />
                    <DetailRow label="From" value={<AddressText address={fromAddress.address} />} />
                    <DetailRow label="Get chain" value={getDescriptor ? <ChainBadge descriptor={getDescriptor} size="sm" /> : getChainId} />
                    <DetailRow label="Receive at" value={<AddressText address={getAddress} />} />
                    <DetailRow label="Expiration" value={expMode === 'custom' && expInput.trim() ? new Date(expInput).toLocaleString() : 'Default window'} />
                    {memo ? <DetailRow label="Memo" value={memo} /> : null}
                    <DetailRow label="Network fee" value={feeText} />
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction. Sign it on your
                        Signer-mode wallet, then broadcast from a Full-mode wallet.
                    </p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={giveChainId}
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
                {(isWatcherMode || isHwSource) && submitError ? <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage> : null}
                <div className={styles.actions}>
                    <Button variant="secondary" onClick={() => { setStage('form'); setSubmitError(null); }} disabled={stage === 'submitting'}>Edit</Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={isWatcherMode ? false : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {isWatcherMode ? 'Create unsigned transaction'
                            : isHwSource ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (giveDescriptor ? `Place order on ${giveDescriptor.displayName}` : 'Place order')}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <p className={styles.hint}>
                A cross-chain order rests on the federation&apos;s price-time book and can fill in parts.
                For an all-or-nothing single fill use Cross-chain swap.
            </p>
            <div style={{
                display: 'grid',
                gridTemplateColumns: isFull ? '1fr 1fr' : '1fr',
                gap: 'var(--xc-space-3)',
            }}>
                <fieldset style={fieldsetStyle}>
                    <legend style={legendStyle}>You give</legend>
                    <ChainPicker
                        label="Give chain"
                        value={giveChainId || ''}
                        onChange={setGiveChainId}
                        chainIds={chainIds}
                        chainRegistry={chainRegistry}
                    />
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
                        <StatusMessage variant="error" className={styles.error}>No address on this chain. Use Receive to generate one first.</StatusMessage>
                    )}
                    <Input
                        label="Give token"
                        value={giveTick}
                        onChange={(e) => setGiveTick(e.target.value.toUpperCase())}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <label className={styles.checkRow}>
                        <input type="checkbox" checked={giveOwnership} onChange={(e) => setGiveOwnership(e.target.checked)} />
                        {' '}Give this token&apos;s ownership (not a balance)
                    </label>
                    {!giveOwnership ? (
                        <AmountField
                            label="Give amount"
                            amount={giveAmount}
                            tick={giveTick}
                            onAmountFieldChange={(rawValue) => {
                                const stripped = String(rawValue).replace(/,/g, '');
                                if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                                setGiveAmount(stripped);
                            }}
                            onMax={giveBalance && Number(giveBalance) > 0 ? () => setGiveAmount(giveBalance) : undefined}
                            maxDisabled={!giveBalance}
                            balanceText={giveBalance != null && giveTick.trim()
                                ? `${formatWithThousands(giveBalance)} ${giveTick.trim().toUpperCase()} available`
                                : null}
                        />
                    ) : null}
                </fieldset>

                <fieldset style={fieldsetStyle}>
                    <legend style={legendStyle}>You get</legend>
                    <ChainPicker
                        label="Get chain"
                        value={getChainId || ''}
                        onChange={(cid) => { setGetChainId(cid); resetGetAddress(); }}
                        chainIds={chainIds}
                        chainRegistry={chainRegistry}
                    />
                    <Input
                        label="Receive at"
                        hint="Your address on the get chain. Each fill is released to it."
                        value={getAddress}
                        onChange={(e) => setGetAddress(e.target.value)}
                        placeholder="auto-filled from your get-chain wallet"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <Input
                        label="Get token"
                        value={getTick}
                        onChange={(e) => setGetTick(e.target.value.toUpperCase())}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <label className={styles.checkRow}>
                        <input type="checkbox" checked={getOwnership} onChange={(e) => setGetOwnership(e.target.checked)} />
                        {' '}Require the matcher to give that token&apos;s ownership
                    </label>
                    {!getOwnership ? (
                        <AmountField
                            label="Get amount"
                            amount={getAmount}
                            tick={getTick}
                            onAmountFieldChange={(rawValue) => {
                                const stripped = String(rawValue).replace(/,/g, '');
                                if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                                setGetAmount(stripped);
                            }}
                        />
                    ) : null}
                </fieldset>
            </div>

            <p className={styles.successLabel}>Expiration</p>
            <label className={styles.checkRow}>
                <input type="radio" name="xorder-exp" checked={expMode === 'default'} onChange={() => setExpMode('default')} />
                {' '}Default window
            </label>
            <label className={styles.checkRow}>
                <input type="radio" name="xorder-exp" checked={expMode === 'custom'} onChange={() => setExpMode('custom')} />
                {' '}Expire at a specific time
            </label>
            {expMode === 'custom' ? (
                <Input
                    label="Expires"
                    type="datetime-local"
                    hint="The order is valid until this wall-clock time. Must be in the future."
                    value={expInput}
                    onChange={(e) => setExpInput(e.target.value)}
                />
            ) : null}

            <Input label="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} autoComplete="off" />

            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={giveCoinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={giveCoinTicker} />

            {validationError ? <StatusMessage variant="error" className={styles.error}>{validationError}</StatusMessage> : null}
            {formError ? <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage> : null}
            <div className={styles.actions}>
                {onManageOrders ? <Button variant="secondary" onClick={onManageOrders}>My orders</Button> : null}
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={confirmAction.composing}
                    disabled={!fromAddress || !!validationError || confirmAction.composing}
                >
                    {singleEncode ? 'Place order' : 'Preview'}
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

const fieldsetStyle = {
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    padding: 'var(--xc-space-3)',
    margin: 0,
    background: 'var(--xc-bg-muted)',
};

const legendStyle = {
    fontWeight: 600,
    padding: '0 var(--xc-space-2)',
};
