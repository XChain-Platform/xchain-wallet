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
    ChainBadge,
    ChainPicker,
    AddressText,
    FeeSelector,
    AddressField,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib, decoder as decoderLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { preferredSourceId } from '../addressSelection.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Protocol coin tickers per xchain-sdk VALID_COINS. `descriptor.coin` is
// long-form ('bitcoin' / 'litecoin' / 'dogecoin'); SWAP serializes the
// short-form tickers in GIVE_COIN / GET_COIN.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * §41.5 SWAP authoring surface.
 *
 * Builds a v0 Create SWAP: atomic token-pair swap that settles in one
 * transaction with no COINPAY follow-up. The v0 form is deliberately
 * single-chain in the default UX (GIVE_COIN = GET_COIN = current
 * chain's native ticker) because the common case is "swap MYTOKEN for
 * COOLCOIN on Bitcoin". Cross-chain swaps use the same SWAP primitive
 * but are out-of-scope for the Phase 3 form.
 *
 * SWAP does NOT work with native coin (BTC / LTC / DOGE). That's
 * what DISPENSER is for. The form rejects inputs where GIVE_TICK or
 * GET_TICK match the chain's native ticker.
 *
 * Ownership trading: either side can trade the token's *ownership
 * record* (the asset name) instead of a balance via the give/get
 * ownership toggles (GIVE_OWNERSHIP / GET_OWNERSHIP). Ownership trades
 * carry no amount and are single-fill; ownership-for-ownership swaps set
 * both toggles.
 *
 * Cancel (v1) and Edit (v2) share the same `swapAction` core flow
 * but route through a future "My swaps" surface; not built here.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]       seed the chain (e.g. launched from ManageToken)
 * @param {string} [props.initialGiveTick]      prefill the give ticker
 * @param {boolean} [props.initialGiveOwnership] open in give-ownership mode (sell a token name)
 */
export function SwapForm({ walletId, onBack, initialChainId, initialGiveTick, initialGiveOwnership }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ ({}),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    const [giveTick, setGiveTick] = useState((initialGiveTick || '').toUpperCase());
    // PC-26: swap settlement carries no gated-key handoff; warn when the
    // give-side token has gated content.
    const gatedGiveNotice = useGatedTickNotice({ messaging, chainId, tick: giveTick });
    const [giveAmount, setGiveAmount] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(!!initialGiveOwnership);
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    const [getOwnership, setGetOwnership] = useState(false);
    const [memo, setMemo] = useState('');
    const [payFeeInNativeCoin, setPayFeeInNativeCoin] = useState(false);
    const [password, setPassword] = useState('');
    const [givePickerOpen, setGivePickerOpen] = useState(false);
    const [getPickerOpen, setGetPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

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
                setAddressesByChain(byChain);
                setActiveByChain(active || {});
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before creating a swap.',
                    );
                    return;
                }
                // Don't clobber a caller-seeded chain (ManageToken sell flow).
                setChainId((c) => c || first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        // Default the from-address to the chain's active address (else newest
        // HD external), matching Send. The user can still override via the
        // dropdown; that doesn't change these deps, so it isn't clobbered.
        setFromAddressId(preferredSourceId(addressesByChain[chainId] || [], activeByChain[chainId]));
    }, [chainId, addressesByChain, activeByChain]);

    // Focus password field immediately on entering review so the user can
    // sign without reaching for the mouse (mirrors DestroyForm behaviour).
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !chainId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, chainId, fromAddressId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Source balance of the give ticker, backing the give AmountField's
    // Max button + "available" footer.
    const giveBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: giveTick,
    });
    const hw = isHwSource(fromAddress);
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: hw ? fromAddress?.signerId : null,
    });

    const validationError = useMemo(() => {
        if (!giveTick) return null;
        if (!getTick) return null;
        // SWAP does NOT work with native coin per protocol rules.
        if (coinTicker && giveTick.toUpperCase() === coinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot give ${coinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (coinTicker && getTick.toUpperCase() === coinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot get ${coinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (giveTick.toUpperCase() === getTick.toUpperCase()) {
            return 'Give and get tickers must differ.';
        }
        return null;
    }, [giveTick, getTick, coinTicker]);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    // Network fee: Low / Normal / Fast / Custom, editable via FeeSelector on
    // the form stage. `feeEstimate` is the estimate for the current pick and
    // backs both the slider readout and the review row; `feePerKb` prices the
    // broadcast. Mirrors ComposeMessage / DispenserDetail.
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

    // Wire-format SWAP v0 params: the one definition the confirm compose and
    // the legacy submit both use.
    const swapParams = useMemo(() => ({
        VERSION: '0',
        GIVE_COIN: coinTicker,
        GIVE_TICK: giveTick.trim(),
        // Ownership side escrows the token's ownership record. No amount;
        // otherwise serialize the balance amount.
        ...(giveOwnership
            ? { GIVE_OWNERSHIP: '1' }
            : { GIVE_AMOUNT: String(giveAmount).trim() }),
        GET_COIN: coinTicker,
        GET_TICK: getTick.trim(),
        ...(getOwnership
            ? { GET_OWNERSHIP: '1' }
            : { GET_AMOUNT: String(getAmount).trim() }),
        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
    }), [coinTicker, giveTick, giveOwnership, giveAmount, getTick, getOwnership, getAmount, memo]);

    //  ( §5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page; hardware +
    // watcher keep the legacy review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = actionConfirm.enabled && !isWatcherMode && !hw;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
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
                actionData: { action: 'SWAP', params: swapParams },
                encoderOpts: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => messaging.swapAction({
                    walletId,
                    chainId,
                    from,
                    params: swapParams,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
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
            setFormError(err?.message || 'Swap failed.');
        }
    }

    // handleReview validates the form then moves to the review stage.
    // No signing happens here: the actual flow calls live in handleSubmit
    // and are only reachable after the user confirms on the review screen.
    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress || !chainId) return;
        if (validationError) return;
        if (!giveTick || !getTick
            || (!giveOwnership && !giveAmount)
            || (!getOwnership && !getAmount)) {
            setFormError('Fill the give/get tickers and amounts before reviewing.');
            return;
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !chainId) return;
        if (validationError) return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;

        setStage('submitting');
        setSubmitError(null);
        try {
            const params = swapParams;
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
                params,
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'SWAP', params },
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (hw) {
                r = await messaging.swapActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                r = await messaging.swapAction({ ...base, password });
            }
            setResult(r);
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            const isNativeFeeErr = err?.name === 'NativeFeeForfeitError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : isNativeFeeErr && err?.reason === 'unsupported'
                        ? `Paying the protocol fee in ${coinTicker || 'the native coin'} is not available for this action. Turn it off to pay in XCHAIN.`
                    : isNativeFeeErr
                        ? 'The native-coin fee price is temporarily unavailable. Try again in a moment, or turn off native-coin fee payment.'
                    : err?.message || 'Sign failed.',
            );
            // Stay on review rather than dropping back to the form so the
            // user can correct their password without re-entering swap terms.
            setStage('review');
            if (!isWatcherMode && !hw) {
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
                ? 'Review swap'
                : `Swap tokens`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        return wrap(
            <>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Swap sent</p>
                {txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>
                        Transaction: <code>{txid}</code>
                    </p>
                ) : null}
                <p className={styles.hint}>
                    Your swap is now open. It settles automatically when a
                    counterparty matches it; until then you can cancel or edit
                    it from its entry in your activity.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    // --- Review / submitting screen -------------------------------------
    if (stage === 'review' || stage === 'submitting') {
        const giveSide = giveOwnership
            ? `ownership of ${giveTick.trim().toUpperCase()}`
            : `${giveAmount} ${giveTick.trim().toUpperCase()}`;
        const getSide = getOwnership
            ? `ownership of ${getTick.trim().toUpperCase()}`
            : `${getAmount} ${getTick.trim().toUpperCase()}`;
        const feeLabel = feeEstimate
            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
            : 'Estimate unavailable';

        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Swap {giveSide} for {getSide}
                    {descriptor ? ` on ${descriptor.displayName}` : ''}.
                </p>
                <dl className={styles.detailsList}>
                    <DetailRow label="Chain" value={
                        descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId
                    } />
                    <DetailRow label="From" value={<AddressText address={fromAddress.address} />} />
                    <DetailRow label="Give" value={giveSide} />
                    <DetailRow label="Get" value={getSide} />
                    {!giveOwnership && !getOwnership ? (
                        <DetailRow
                            label="Price"
                            value={
                                Number(giveAmount) > 0 && Number(getAmount) > 0
                                    ? `1 ${giveTick.trim().toUpperCase()} = ${
                                        (Number(getAmount) / Number(giveAmount)).toFixed(8).replace(/\.?0+$/, '')
                                    } ${getTick.trim().toUpperCase()}`
                                    : 'n/a'
                            }
                        />
                    ) : null}
                    {memo.trim() ? <DetailRow label="Memo" value={memo.trim()} /> : null}
                    <DetailRow label="Network fee" value={feeLabel} />
                </dl>
                {payFeeInNativeCoin ? (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>{NATIVE_FEE_WARNING}</p>
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
                {(isWatcherMode || hw) && submitError ? (
                    <p role="alert" style={{ margin: '0.25rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                        {submitError}
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : hw
                                ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : 'Sign swap'}
                    </Button>
                </div>
            </form>,
        );
    }

    // --- Form screen ----------------------------------------------------
    const chainIds = Object.keys(addressesByChain || {});

    //  confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                decoded={decoderLib.decodeAction({
                    action: 'SWAP',
                    params: swapParams,
                    chainId: chainId || undefined,
                    chainRegistry,
                })}
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
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (givePickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select give token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    setGiveTick(String(sel.tick || '').toUpperCase());
                    setGivePickerOpen(false);
                }}
                onBack={() => setGivePickerOpen(false)}
            />
        );
    }

    if (getPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                title="Select get token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => {
                    setGetTick(String(sel.tick || '').toUpperCase());
                    setGetPickerOpen(false);
                }}
                onBack={() => setGetPickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <ChainPicker
                label="Chain"
                value={chainId}
                onChange={setChainId}
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
            ) : null}

            <TokenField
                label="Give token"
                value={giveTick && chainId ? { chainId, tick: giveTick } : null}
                onOpenPicker={() => setGivePickerOpen(true)}
            />
            {gatedGiveNotice.gated && !giveOwnership ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        {gatedTickWarningCopy(giveTick, 'the swap counterparty')}
                    </p>
                </div>
            ) : null}
            {giveOwnership ? null : (
                <AmountField
                    label="Give amount"
                    amount={giveAmount}
                    tick={giveTick}
                    onAmountFieldChange={(rawValue) => {
                        const stripped = String(rawValue).replace(/,/g, '');
                        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                        setGiveAmount(stripped);
                    }}
                    onMax={giveBalance && Number(giveBalance) > 0
                        ? () => setGiveAmount(giveBalance)
                        : undefined}
                    maxDisabled={!giveBalance}
                    balanceText={giveBalance != null && giveTick.trim()
                        ? `${formatWithThousands(giveBalance)} ${giveTick.trim().toUpperCase()} available`
                        : null}
                />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', margin: '0.25rem 0 0.5rem' }}>
                <input
                    type="checkbox"
                    checked={giveOwnership}
                    onChange={(e) => setGiveOwnership(e.target.checked)}
                />
                Give this token&apos;s ownership instead of an amount
            </label>
            {giveOwnership ? (
                <p className={styles.hint} style={{ margin: '0 0 0.5rem' }}>
                    Transfers the entire ownership of {giveTick.trim() ? giveTick.trim().toUpperCase() : 'this token'} (single-fill, no partial matches).
                </p>
            ) : null}

            <TokenField
                label="Get token"
                value={getTick && chainId ? { chainId, tick: getTick } : null}
                onOpenPicker={() => setGetPickerOpen(true)}
            />
            {getOwnership ? null : (
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
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', margin: '0.25rem 0 0.5rem' }}>
                <input
                    type="checkbox"
                    checked={getOwnership}
                    onChange={(e) => setGetOwnership(e.target.checked)}
                />
                Require the matcher to give that token&apos;s ownership instead of an amount
            </label>
            {getOwnership ? (
                <p className={styles.hint} style={{ margin: '0 0 0.5rem' }}>
                    The matcher must currently own {getTick.trim() ? getTick.trim().toUpperCase() : 'this token'}; on match its ownership transfers to you.
                </p>
            ) : null}

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
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

            <NativeFeeToggle
                checked={payFeeInNativeCoin}
                onChange={setPayFeeInNativeCoin}
                coinTicker={coinTicker}
            />

            {validationError ? (
                <p role="alert" className={styles.error} style={{ marginTop: '0.5rem' }}>
                    {validationError}
                </p>
            ) : null}

            {formError ? (
                <p role="alert" className={styles.error} style={{ marginTop: '0.5rem' }}>
                    {formError}
                </p>
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!!validationError
                        || !fromAddress
                        || !giveTick || !getTick
                        || (!giveOwnership && !giveAmount)
                        || (!getOwnership && !getAmount)
                        || actionConfirm.composing}
                >
                    {singleEncode ? 'Swap' : 'Review'}
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
