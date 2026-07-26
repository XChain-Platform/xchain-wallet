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
import { SignCredentials } from '../components/SignCredentials.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// datetime-local string -> Unix seconds (the indexer compares ORDER
// EXPIRATION as a wall-clock Unix timestamp, NOT a block height).
function localInputToUnix(localStr) {
    const ms = Date.parse(String(localStr));
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
}

const isPlainPositive = (v) => /^\d+(\.\d+)?$/.test(String(v).trim()) && Number(String(v).trim()) > 0;

/**
 * Standalone Create Order form (PC-17). Composes a full ORDER v0 across
 * arbitrary same-chain pairs, including native-coin sides:
 *   VERSION|GIVE_COIN|GIVE_TICK|GIVE_AMOUNT|GIVE_OWNERSHIP|GET_COIN|GET_TICK|GET_AMOUNT|GET_OWNERSHIP|GET_ADDRESS|EXPIRATION|ALLOW_LIST|BLOCK_LIST|MEMO
 * An empty tick on a side = the chain's native coin (the COINPay-settled
 * lane); at least one side must carry a token (coin-for-coin is a regular
 * payment, matching the SDK validator). When the GIVE side is native coin,
 * the PC-16 auto-pay checkbox arms unattended settlement of the resulting
 * obligation (software signers only). Signs through the shared
 * software/HW/watcher lanes (orderAction / orderActionHw / watcher
 * encode-only) with the  single-encode confirm page for software.
 *
 * Same-chain only in v0 (GIVE_COIN = GET_COIN = the posting chain's coin),
 * matching PlaceOrderPanel; cross-chain GET (validator-federated) is a
 * separate lane not authored here.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialFromAddress]
 * @param {() => void} [props.onManageOrders]   optional deep-link to My Orders
 */
export function CreateOrderForm({ walletId, onBack, initialChainId, initialFromAddress, onManageOrders }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { isWatcherMode } = useWalletMode();

    const {
        addressesByChain,
        loadError,
        chainId,
        fromAddress,
        setFromAddressId,
        descriptor,
        signerReady,
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
        noAddressMessage: 'No addresses on any chain yet. Use Receive to generate one first.',
    });

    const coinTicker = descriptor ? (PROTOCOL_COIN_TICKER[descriptor.coin] || '') : '';

    // PC-51: opt-in native-coin protocol fee (ORDER is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee();

    // GIVE / GET side state. type: 'token' (a tick) or 'coin' (native).
    const [giveType, setGiveType] = useState(/** @type {'token' | 'coin'} */ ('token'));
    const [giveTick, setGiveTick] = useState('');
    const [giveAmount, setGiveAmount] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(false);
    const [getType, setGetType] = useState(/** @type {'token' | 'coin'} */ ('coin'));
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    const [getOwnership, setGetOwnership] = useState(false);

    const [getAddress, setGetAddress] = useState('');
    const [expMode, setExpMode] = useState(/** @type {'default' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [allowListIdx, setAllowListIdx] = useState('');
    const [allowListCount, setAllowListCount] = useState(/** @type {number | null} */ (null));
    const [blockListIdx, setBlockListIdx] = useState('');
    const [blockListCount, setBlockListCount] = useState(/** @type {number | null} */ (null));
    const [memo, setMemo] = useState('');

    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));

    // PC-16 auto-pay: only a native-coin GIVE settles via COINPay and can
    // arm auto-pay; HW / watch-only can never sign unattended, so they stay
    // notify-only (checkbox hidden, copy explains).
    const [autopayEnabled, setAutopayEnabled] = useState(true);
    const [keepOpenAck, setKeepOpenAck] = useState(false);
    const [exposure, setExposure] = useState(/** @type {any | null} */ (null));
    const giveIsNative = giveType === 'coin';
    const autopayEligible = giveIsNative && !isWatcherMode && !isHwSource;
    const autopayArm = autopayEligible && autopayEnabled;
    const ackKey = 'xchain-wallet:autopay-keep-open-ack';
    const ackDone = shell === 'web'
        ? (() => { try { return globalThis.localStorage?.getItem(ackKey) === '1'; } catch { return false; } })()
        : true;
    const ackRequired = shell === 'web' && autopayArm && !ackDone;

    useEffect(() => {
        if (!autopayArm || typeof messaging.getAutopayExposure !== 'function') { setExposure(null); return undefined; }
        let cancelled = false;
        messaging.getAutopayExposure({ walletId })
            .then((e) => { if (!cancelled) setExposure(e || {}); })
            .catch(() => { if (!cancelled) setExposure(null); });
        return () => { cancelled = true; };
    }, [messaging, walletId, autopayArm]);

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
    const singleEncode = isConfirmModalSliceEnabled(settings, 'actionForms') && !isWatcherMode;
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    // Build the ORDER v0 params. Blank optional fields are omitted (the
    // wire encodes an omitted positional field as "unset").
    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '0', GIVE_COIN: coinTicker, GET_COIN: coinTicker };
        if (giveType === 'token') {
            p.GIVE_TICK = giveTick.trim().toUpperCase();
            if (giveOwnership) p.GIVE_OWNERSHIP = '1'; else p.GIVE_AMOUNT = giveAmount.trim();
        } else {
            p.GIVE_TICK = '';
            p.GIVE_AMOUNT = giveAmount.trim();
        }
        if (getType === 'token') {
            p.GET_TICK = getTick.trim().toUpperCase();
            if (getOwnership) p.GET_OWNERSHIP = '1'; else p.GET_AMOUNT = getAmount.trim();
        } else {
            p.GET_TICK = '';
            p.GET_AMOUNT = getAmount.trim();
        }
        if (getAddress.trim()) p.GET_ADDRESS = getAddress.trim();
        if (expMode === 'custom' && expInput.trim()) {
            const unix = localInputToUnix(expInput.trim());
            if (unix) p.EXPIRATION = String(unix);
        }
        if (allowListIdx) p.ALLOW_LIST = allowListIdx;
        if (blockListIdx) p.BLOCK_LIST = blockListIdx;
        if (memo.trim()) p.MEMO = memo.trim();
        return p;
    }, [coinTicker, giveType, giveTick, giveAmount, giveOwnership, getType, getTick, getAmount, getOwnership, getAddress, expMode, expInput, allowListIdx, blockListIdx, memo]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting' && !confirmModalOpen) return null;
        return decoderLib.decodeAction({
            action: 'ORDER', params: actionParams, chainId: chainId || undefined, chainRegistry,
        });
    }, [stage, confirmModalOpen, actionParams, chainId]);

    function guardBeforeSign() {
        if (!chainId || !fromAddress) { setFormError('Pick a source address first.'); return false; }
        if (giveType === 'coin' && getType === 'coin') {
            setFormError('At least one side must be a token; coin-for-coin is a regular payment, not an order.');
            return false;
        }
        // GIVE side.
        if (giveType === 'token') {
            if (!giveTick.trim()) { setFormError('Enter the ticker you are offering.'); return false; }
            if (!giveOwnership && !isPlainPositive(giveAmount)) { setFormError('Enter a positive amount to give.'); return false; }
        } else if (!isPlainPositive(giveAmount)) {
            setFormError(`Enter a positive amount of ${coinTicker} to give.`); return false;
        }
        // GET side.
        if (getType === 'token') {
            if (!getTick.trim()) { setFormError('Enter the ticker you want in return.'); return false; }
            if (!getOwnership && !isPlainPositive(getAmount)) { setFormError('Enter a positive amount to receive.'); return false; }
        } else if (!isPlainPositive(getAmount)) {
            setFormError(`Enter a positive amount of ${coinTicker} to receive.`); return false;
        }
        const ga = getAddress.trim();
        if (ga && (ga.includes('|') || ga.includes(';'))) { setFormError('Receive address is invalid.'); return false; }
        if (expMode === 'custom') {
            const raw = expInput.trim();
            if (!raw) { setFormError('Pick an expiration date and time, or switch to the default window.'); return false; }
            const unix = localInputToUnix(raw);
            if (!unix || unix <= Math.floor(Date.now() / 1000)) { setFormError('Expiration must be a future date and time.'); return false; }
        }
        const m = memo.trim();
        if (m.includes('|') || m.includes(';')) { setFormError('Memo cannot contain "|" or ";".'); return false; }
        if (ackRequired && !keepOpenAck) {
            setFormError('Acknowledge the auto-pay requirement (or turn auto-pay off) to continue.');
            return false;
        }
        return true;
    }

    function persistAckIfNeeded() {
        if (shell === 'web' && autopayArm && !ackDone && keepOpenAck) {
            try { globalThis.localStorage?.setItem(ackKey, '1'); } catch { /* per-shell nicety only */ }
        }
    }

    const extraBaseFor = (composed) => ({
        payFeeInNativeCoin: nativeFee.flag,
        ...(feePerKb != null ? { feePerKb } : {}),
        ...(autopayArm ? { autopay: { enabled: true } } : {}),
        ...(composed ? {
            prebuiltPsbt: {
                psbtHex: composed.psbt,
                encoding: composed.encoding,
                actionString: composed.actionString,
                version: composed.version,
            },
        } : {}),
    });

    async function openConfirmModal() {
        const from = buildFrom();
        if (!chainId || !from) return;
        setSubmitError(null);
        try {
            const res = await confirmAction.confirm({
                chainId,
                source: from.address,
                preflightOpts: { mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report' },
                compose: () => messaging.composeForConfirm({
                    walletId, chainId, from,
                    actionData: { action: 'ORDER', params: actionParams },
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
                    extraBase: extraBaseFor(composed),
                }),
            });
            persistAckIfNeeded();
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            console.error('Create order (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(humanizeError(err, 'order').message);
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
            persistAckIfNeeded();
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : err?.message || 'Order failed.');
            setStage('review');
            if (!isWatcherMode && !isHwSource) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        }
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review order' : 'Create order'}
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
        const autopayNote = autopayArm
            ? (result?.autopayArmed === false
                ? 'Auto-pay could not be armed for this order; you will be prompted to pay any match manually.'
                : 'Auto-pay is armed: matches on this order will be paid automatically while a wallet holding it is unlocked.')
            : null;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Order broadcast</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : <p className={styles.hint}>Broadcast complete.</p>}
                {autopayNote ? <p className={styles.hint}>{autopayNote}</p> : null}
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
                decoded={decoded}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim() : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                credentialsReady={isHwSource ? hwStatus === 'available' : (signerReady || password.length > 0)}
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

    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={addressesByChain?.[chainId] || []}
                filterType="2"
                title={listPickerFor === 'allow' ? 'Choose allow-list' : 'Choose block-list'}
                onSelect={(row) => {
                    if (listPickerFor === 'allow') { setAllowListIdx(row.actionIndex); setAllowListCount(row.memberCount); }
                    else { setBlockListIdx(row.actionIndex); setBlockListCount(row.memberCount); }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

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
                {getType === 'coin' ? (
                    <p className={styles.hint}>
                        You are requesting native {coinTicker}. When matched, this creates a CoinPay
                        obligation the buyer must pay within the expiration window (tokens stay escrowed
                        until they do).
                    </p>
                ) : null}
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
                                : (descriptor ? `Place order on ${descriptor.displayName}` : 'Place order')}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {fromAddress ? (
                <AddressField
                    label="From address"
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

            <SideEditor
                heading="You give"
                type={giveType}
                onType={setGiveType}
                tick={giveTick}
                onTick={setGiveTick}
                amount={giveAmount}
                onAmount={setGiveAmount}
                ownership={giveOwnership}
                onOwnership={setGiveOwnership}
                coinTicker={coinTicker}
                styles={styles}
            />

            <SideEditor
                heading="You get"
                type={getType}
                onType={setGetType}
                tick={getTick}
                onTick={setGetTick}
                amount={getAmount}
                onAmount={setGetAmount}
                ownership={getOwnership}
                onOwnership={setGetOwnership}
                coinTicker={coinTicker}
                styles={styles}
            />

            {giveType === 'coin' && getType === 'coin' ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>At least one side must be a token. Coin-for-coin is a regular payment, not an order.</p>
                </div>
            ) : null}

            <Input
                label="Receive at (optional)"
                hint="Address to receive the GET side on. Defaults to your source address."
                value={getAddress}
                onChange={(e) => setGetAddress(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />

            <p className={styles.successLabel}>Expiration</p>
            <label className={styles.checkRow}>
                <input type="radio" name="order-exp" checked={expMode === 'default'} onChange={() => setExpMode('default')} />
                {' '}Default window
            </label>
            <label className={styles.checkRow}>
                <input type="radio" name="order-exp" checked={expMode === 'custom'} onChange={() => setExpMode('custom')} />
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

            <button type="button" className={styles.linkButton} onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide advanced options' : 'Advanced options (lists, memo)'}
            </button>
            {showAdvanced ? (
                <>
                    <p className={styles.successLabel}>Restrict who can match (optional)</p>
                    <div className={styles.actions}>
                        <Button variant="secondary" size="sm" onClick={() => setListPickerFor('allow')}>
                            {allowListIdx ? `Allow-list #${allowListIdx}${allowListCount != null ? ` (${allowListCount})` : ''}` : 'Set allow-list'}
                        </Button>
                        {allowListIdx ? <Button variant="secondary" size="sm" onClick={() => { setAllowListIdx(''); setAllowListCount(null); }}>Clear</Button> : null}
                    </div>
                    <div className={styles.actions}>
                        <Button variant="secondary" size="sm" onClick={() => setListPickerFor('block')}>
                            {blockListIdx ? `Block-list #${blockListIdx}${blockListCount != null ? ` (${blockListCount})` : ''}` : 'Set block-list'}
                        </Button>
                        {blockListIdx ? <Button variant="secondary" size="sm" onClick={() => { setBlockListIdx(''); setBlockListCount(null); }}>Clear</Button> : null}
                    </div>
                    <p className={styles.hint}>Allow/block lists are address lists you published (see My Lists).</p>
                    <Input label="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} autoComplete="off" />
                </>
            ) : null}

            {autopayEligible ? (
                <>
                    <label className={styles.checkRow}>
                        <input type="checkbox" checked={autopayEnabled} onChange={(e) => setAutopayEnabled(e.target.checked)} />
                        {' '}<span><strong>Enable CoinPay auto-pay</strong><br />We watch for matches on this order and pay each one automatically.</span>
                    </label>
                    {autopayArm && exposure && Number.isFinite(Number(exposure.total)) ? (
                        <p className={styles.hint}>
                            Under full indexer compromise, the most auto-pay could send across all your armed
                            orders is bounded by their combined GIVE amounts.
                        </p>
                    ) : null}
                    {ackRequired ? (
                        <label className={styles.checkRow}>
                            <input type="checkbox" checked={keepOpenAck} onChange={(e) => setKeepOpenAck(e.target.checked)} />
                            {' '}I understand this web wallet only auto-pays while it is open and unlocked.
                        </label>
                    ) : null}
                </>
            ) : giveIsNative ? (
                <p className={styles.hint}>
                    {isWatcherMode
                        ? 'Watcher and hardware wallets cannot auto-pay; you will be notified to pay any match manually.'
                        : 'Hardware wallets cannot auto-pay; you will be notified to pay any match manually.'}
                </p>
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
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} />
            {formError ? <div role="alert" className={styles.error}>{formError}</div> : null}
            <div className={styles.actions}>
                {onManageOrders ? <Button variant="secondary" onClick={onManageOrders}>My orders</Button> : null}
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={confirmAction.composing}
                    disabled={!fromAddress || confirmAction.composing}
                >
                    {singleEncode ? 'Place order' : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}

function SideEditor({ heading, type, onType, tick, onTick, amount, onAmount, ownership, onOwnership, coinTicker, styles }) {
    return (
        <>
            <p className={styles.successLabel}>{heading}</p>
            <label className={styles.checkRow}>
                <input type="radio" name={`${heading}-type`} checked={type === 'token'} onChange={() => onType('token')} />
                {' '}A token
            </label>
            <label className={styles.checkRow}>
                <input type="radio" name={`${heading}-type`} checked={type === 'coin'} onChange={() => onType('coin')} />
                {' '}Native {coinTicker || 'coin'}
            </label>
            {type === 'token' ? (
                <>
                    <Input
                        label="Ticker"
                        value={tick}
                        onChange={(e) => onTick(e.target.value.toUpperCase())}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <label className={styles.checkRow}>
                        <input type="checkbox" checked={ownership} onChange={(e) => onOwnership(e.target.checked)} />
                        {' '}Trade ownership of this ticker (not a balance)
                    </label>
                </>
            ) : null}
            {!(type === 'token' && ownership) ? (
                <Input
                    label={type === 'coin' ? `Amount (${coinTicker})` : 'Amount'}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => onAmount(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
        </>
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
