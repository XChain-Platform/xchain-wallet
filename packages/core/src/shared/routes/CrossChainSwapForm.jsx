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
import { AddressField, AddressText, Button, ChainBadge, ChainPicker, FeeSelector, Icon, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { activeSourceId } from '../addressSelection.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Same ticker map SwapForm uses. descriptor.coin is long-form
// ('bitcoin' / 'litecoin' / 'dogecoin'); SWAP serializes the
// short-form tickers in GIVE_COIN / GET_COIN.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Maps descriptor.coin to the display ticker shown next to the fee
// estimate on the review screen.
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

/**
 * §42.8.3 Cross-chain SWAP authoring surface.
 *
 * Same SWAP action as §41.5 with one structural difference:
 * `GIVE_COIN ≠ GET_COIN`. The wallet signs the offer on the give-
 * chain; a counterparty fills it on the get-chain. SDK 1.10's SWAP
 * encoder handles both same-chain and cross-chain variants; this
 * form is a separate route purely for clarity and so the §41.5
 * SwapForm doesn't grow a "cross-chain mode" toggle.
 *
 * Native-coin rejection still applies (GIVE_TICK / GET_TICK cannot
 * be a coin's native ticker (that's DISPENSER territory).
 *
 * Receiver address (`GET_ADDRESS`) defaults to the user's newest
 * address on the get-chain, surfaced via `messaging.getNewestAddress`.
 * Users can override to a different known address if they want the
 * SWAP fill to land at a different account.
 *
 * Expiration is entered as a block-height delta from the give-chain's
 * current tip; the form does not consult the tip and forwards the
 * raw delta value as the EXPIRATION field. (The SDK validator
 * accepts an integer block height; the indexer enforces the
 * absolute-vs-relative semantics.)
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function CrossChainSwapForm({ walletId, onBack }) {
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

    const [giveChainId, setGiveChainId] = useState(/** @type {string | null} */ (null));
    const [getChainId, setGetChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [getAddress, setGetAddress] = useState('');
    const [getAddressTouched, setGetAddressTouched] = useState(false);
    const [giveTick, setGiveTick] = useState('');
    const [giveAmount, setGiveAmount] = useState('');
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    // PC-18: EXPIRATION is a wall-clock Unix timestamp, NOT a block count
    // (the indexer rejects EXPIRATION <= BLOCK_TIME as "past", so the old
    // block-count value indexed every cross-chain swap invalid).
    const [expMode, setExpMode] = useState(/** @type {'default' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(false);
    const [getOwnership, setGetOwnership] = useState(false);
    const [memo, setMemo] = useState('');
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
                setAddressesByChain(byChain || {});
                setActiveByChain(active || {});
                const chains = Object.entries(byChain || {})
                    .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                    .map(([cid]) => cid);
                if (chains.length === 0) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate addresses on at least two chains before composing a cross-chain swap.',
                    );
                    return;
                }
                if (chains.length === 1) {
                    setLoadError(
                        'A cross-chain swap needs addresses on two different chains. Use Receive on a second chain (e.g. DOGE or LTC) and try again.',
                    );
                    return;
                }
                setGiveChainId(chains[0]);
                setGetChainId(chains[1]);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load wallet.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!addressesByChain || !giveChainId) {
            setFromAddressId(null);
            return;
        }
        const addrs = addressesByChain[giveChainId] || [];
        // Prefer the give-chain's active address; fall back to the existing
        // newest-HD (or any-address) heuristic when none is set.
        const activeId = activeSourceId(addrs, activeByChain[giveChainId]);
        if (activeId) {
            setFromAddressId(activeId);
            return;
        }
        const hd = addrs.filter(
            (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
        );
        const pool = hd.length > 0 ? hd : addrs;
        if (pool.length > 0) {
            const sorted = [...pool].sort((a, b) => {
                const ai = (externalIndexOf(a.derivationPath) ?? -1);
                const bi = (externalIndexOf(b.derivationPath) ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        } else {
            setFromAddressId(null);
        }
    }, [giveChainId, addressesByChain, activeByChain]);

    // Auto-fill receiver address on the get-chain (newest external HD
    // index). Only fills when the user hasn't typed something custom.
    useEffect(() => {
        if (!getChainId || getAddressTouched) return;
        if (typeof messaging.getNewestAddress !== 'function') return;
        let cancelled = false;
        messaging.getNewestAddress(walletId, getChainId)
            .then((rec) => {
                if (cancelled) return;
                if (rec?.address) setGetAddress(rec.address);
            })
            .catch(() => { /* non-fatal; user can enter manually */ });
        return () => { cancelled = true; };
    }, [walletId, getChainId, getAddressTouched, messaging]);

    // Focus the password field when entering review, matching the
    // DestroyForm convention for the confirmation stage.
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !giveChainId) return null;
        return (addressesByChain[giveChainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, giveChainId, fromAddressId]);

    const giveDescriptor = giveChainId ? chainRegistry.get(giveChainId) : null;
    const getDescriptor = getChainId ? chainRegistry.get(getChainId) : null;
    const giveCoinTicker = giveDescriptor ? PROTOCOL_COIN_TICKER[giveDescriptor.coin] || '' : '';
    const getCoinTicker = getDescriptor ? PROTOCOL_COIN_TICKER[getDescriptor.coin] || '' : '';

    // Source balance of the give ticker on the give chain, backing the
    // give AmountField's Max button + "available" footer.
    const giveBalance = useTickBalance({
        messaging,
        walletId,
        chainId: giveChainId,
        address: fromAddress?.address,
        tick: giveTick,
    });
    const hw = isHwSource(fromAddress);

    const validationError = useMemo(() => {
        if (!giveCoinTicker || !getCoinTicker) return null;
        if (giveCoinTicker === getCoinTicker) {
            return 'Give and get chains must differ. For same-chain swaps use Swap tokens.';
        }
        if (giveTick && giveTick.toUpperCase() === giveCoinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot give ${giveCoinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (getTick && getTick.toUpperCase() === getCoinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot get ${getCoinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (expMode === 'custom' && expInput.trim()) {
            const ms = Date.parse(expInput.trim());
            if (!Number.isFinite(ms)) return 'Pick a valid expiration date and time.';
            if (Math.floor(ms / 1000) <= Math.floor(Date.now() / 1000)) return 'Expiration must be in the future.';
        }
        return null;
    }, [giveCoinTicker, getCoinTicker, giveTick, getTick, expMode, expInput]);

    // Network fee for the give chain (the chain that pays the on-chain fee):
    // Low / Normal / Fast / Custom, editable via FeeSelector on the form
    // stage. `feeEstimate` backs both the slider readout and the review row;
    // `feePerKb` prices the broadcast. Mirrors ComposeMessage.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    // PC-51: a cross-chain SWAP is composed and paid on the GIVE
    // chain, so that is the chain whose native-fee rule applies. Off Bitcoin
    // the native-coin output IS the protocol fee; without it the SWAP
    // confirms and the indexer rejects it "insufficient fee (native coin output
    // required)" while this form reports the swap as open.
    const nativeFee = useNativeFee(giveChainId);

    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId: giveChainId, chainRegistry }),
        [giveChainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId: giveChainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [giveChainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId: giveChainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;
    const giveTicker = giveDescriptor?.coin
        ? NATIVE_TICKER_BY_COIN[giveDescriptor.coin] || giveDescriptor.coin.toUpperCase()
        : null;
    const feeText = feeEstimate && giveTicker
        ? `${feeEstimate.coinAmount} ${giveTicker}` + (feeEstimate.rate ? ` (${feeEstimate.rate})` : '')
        : 'Estimate unavailable';

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    // The wire params, named once so the confirm lane and the watcher lane
    // encode the same SWAP. GET_ADDRESS is the field this migration is for:
    // it names a destination on ANOTHER chain, which only the confirm page's
    // output-set cross-check binds to the bytes that get signed.
    const swapParams = useMemo(() => ({
        VERSION: '0',
        GIVE_COIN: giveCoinTicker,
        GIVE_TICK: giveTick.trim(),
        ...(giveOwnership ? { GIVE_OWNERSHIP: '1' } : { GIVE_AMOUNT: String(giveAmount).trim() }),
        GET_COIN: getCoinTicker,
        GET_TICK: getTick.trim(),
        ...(getOwnership ? { GET_OWNERSHIP: '1' } : { GET_AMOUNT: String(getAmount).trim() }),
        GET_ADDRESS: (getAddress || '').trim(),
        ...((() => {
            if (expMode !== 'custom' || !expInput.trim()) return {};
            const ms = Date.parse(expInput.trim());
            return Number.isFinite(ms) ? { EXPIRATION: String(Math.floor(ms / 1000)) } : {};
        })()),
        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
    }), [giveCoinTicker, giveTick, giveOwnership, giveAmount, getCoinTicker, getTick,
        getOwnership, getAmount, getAddress, expMode, expInput, memo]);

    // §5.6: SwapForm already composes one PSBT host-side and approves it on
    // the shared confirm page; the cross-chain variant now does the same.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'swapAction',
        hardware: 'swapActionHw',
    });

    // Compose, tamper-check and pre-flight run HOST-side; Approve signs the
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
            const r = await actionConfirm.run({
                chainId: giveChainId,
                from,
                actionData: { action: 'SWAP', params: swapParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId: giveChainId,
                    from,
                    params: swapParams,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(r);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId: giveChainId,
                coinTicker: giveTicker || '',
                mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Sign failed.',
            }));
        }
    }

    // Validate the form fields and advance to the review stage. The
    // actual sign/broadcast only fires from handleSubmit, which is
    // reachable only from the review screen.
    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress || !giveChainId || !getChainId) return;
        if (validationError) return;
        if (!giveTick || (!giveOwnership && !giveAmount) || !getTick || (!getOwnership && !getAmount)) {
            setFormError('Fill give/get tickers and amounts (or select ownership) before reviewing.');
            return;
        }
        if (!getAddress) {
            setFormError('Receiver address on the get-chain is required.');
            return;
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !giveChainId || !getChainId) return;
        if (validationError) return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;

        setStage('submitting');
        setSubmitError(null);
        try {
            const params = swapParams;
            const base = {
                walletId,
                chainId: giveChainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                params,
                ...(feePerKb != null ? { feePerKb } : {}),
                // PC-51: off Bitcoin the native-coin output IS the
                // protocol fee. `flag` is true or undefined, never
                // false, so this leaves the Bitcoin payload untouched.
                payFeeInNativeCoin: nativeFee.flag,
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId: giveChainId,
                    from: base.from,
                    actionData: { action: 'SWAP', params },
                    // The flag must reach COMPOSE too, so the
                    // FEE_DESTINATION output sits inside the PSBT the user
                    // approves. This lane does NOT go through `base`, and a
                    // form that threads only the submit path silently drops
                    // the fee mode here - which is the whole reason
                    // useNativeFee exists rather than per-form state.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
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
            const bad = err?.name === 'InvalidPasswordError';
            // A native-fee refusal arrives as wire wording ("native-coin
            // fee pre-flight failed (dust): ...") which is not a sentence anyone
            // can act on. Now that this form has a native-fee lane it
            // needs the same mapping every other swept form uses.
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId: giveChainId,
                coinTicker: giveTicker || '',
                mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Sign failed.',
            }));
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
                : 'Cross-chain swap'}
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
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
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
        // A queued result is SIGNED and not broadcast: the confirm lane
        // resolves a transient broadcast failure that way, and the success
        // copy below would report an escrow that is not open yet.
        if (result?.queued) {
            return wrap(<QueuedResultPanel onDone={onBack} what="cross-chain swap" />);
        }
        return wrap(
            <>
                <p className={styles.successTitle}>Cross-chain swap broadcast</p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Give-chain transaction</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <p className={styles.hint}>
                    Your offer is open on {giveDescriptor?.displayName}. The
                    swap settles atomically when a counterparty fills it on{' '}
                    {getDescriptor?.displayName}; until then no funds move.
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

    // Review and submitting stages: show a confirmation summary with
    // all swap terms before the user signs. The real broadcast only fires
    // from here, keeping the form stage completely read-only.
    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Offer to give {giveAmount} {giveTick} on {giveDescriptor?.displayName || giveChainId} in exchange
                    for {getAmount} {getTick} on {getDescriptor?.displayName || getChainId}.
                </p>
                <dl className={styles.detailsList}>
                    <DetailRow
                        label="Give chain"
                        value={giveDescriptor ? <ChainBadge descriptor={giveDescriptor} size="sm" /> : giveChainId}
                    />
                    <DetailRow
                        label="Give"
                        value={`${giveAmount} ${giveTick}`}
                    />
                    <DetailRow
                        label="From"
                        value={<AddressText address={fromAddress.address} />}
                    />
                    <DetailRow
                        label="Get chain"
                        value={getDescriptor ? <ChainBadge descriptor={getDescriptor} size="sm" /> : getChainId}
                    />
                    <DetailRow
                        label="Get"
                        value={`${getAmount} ${getTick}`}
                    />
                    <DetailRow
                        label="Receive at"
                        value={<AddressText address={getAddress} />}
                    />
                    <DetailRow
                        label="Expiration"
                        value={expMode === 'custom' && expInput.trim() ? new Date(expInput).toLocaleString() : 'Default window'}
                    />
                    {giveOwnership || getOwnership ? (
                        <DetailRow label="Ownership" value={[giveOwnership ? 'give' : null, getOwnership ? 'get' : null].filter(Boolean).join(' + ')} />
                    ) : null}
                    {memo ? (
                        <DetailRow label="Memo" value={memo} />
                    ) : null}
                    <DetailRow label="Network fee" value={feeText} />
                </dl>
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
                        chainId={giveChainId}
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
                    />
                )}
                {(isWatcherMode || hw) && submitError ? (
                    <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : hw
                                    ? hwStatus !== 'available'
                                    : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : hw
                                ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : 'Sign cross-chain swap'}
                    </Button>
                </div>
            </form>,
        );
    }

    const chainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);

    // Confirm page, rendered in place of the form; form state stays intact
    // behind it, exactly as the picker screens below do.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={giveDescriptor?.displayName || giveChainId}
                feeText={feeEstimate?.coinAmount && giveTicker
                    ? `Network fee: ${feeEstimate.coinAmount} ${giveTicker}`
                    : undefined}
                coinTicker={giveTicker || ''}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={giveChainId}
                getSignerStatus={messaging.getSignerStatus}
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
                networkFilter={coinFromChainId(giveChainId)}
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
                networkFilter={coinFromChainId(getChainId)}
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
                    ) : null}
                    <TokenField
                        label="Give token"
                        value={giveTick && giveChainId ? { chainId: giveChainId, tick: giveTick } : null}
                        onOpenPicker={() => setGivePickerOpen(true)}
                    />
                    <label style={{ display: 'block', margin: '0.25rem 0' }}>
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
                            onMax={giveBalance && Number(giveBalance) > 0
                                ? () => setGiveAmount(giveBalance)
                                : undefined}
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
                        onChange={(cid) => {
                            setGetChainId(cid);
                            setGetAddressTouched(false);
                        }}
                        chainIds={chainIds}
                        chainRegistry={chainRegistry}
                    />
                    <Input
                        label="Receive at"
                        value={getAddress}
                        onChange={(e) => {
                            setGetAddress(e.target.value);
                            setGetAddressTouched(true);
                        }}
                        placeholder="auto-filled from your get-chain wallet"
                    />
                    <TokenField
                        label="Get token"
                        value={getTick && getChainId ? { chainId: getChainId, tick: getTick } : null}
                        onOpenPicker={() => setGetPickerOpen(true)}
                    />
                    <label style={{ display: 'block', margin: '0.25rem 0' }}>
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

            <label style={{ display: 'block', margin: '0.5rem 0 0.25rem', fontWeight: 600 }}>Expiration</label>
            <label style={{ display: 'block' }}>
                <input type="radio" name="xswap-exp" checked={expMode === 'default'} onChange={() => setExpMode('default')} />
                {' '}Default window
            </label>
            <label style={{ display: 'block' }}>
                <input type="radio" name="xswap-exp" checked={expMode === 'custom'} onChange={() => setExpMode('custom')} />
                {' '}Expire at a specific time
            </label>
            {expMode === 'custom' ? (
                <Input
                    label="Expires"
                    type="datetime-local"
                    value={expInput}
                    onChange={(e) => setExpInput(e.target.value)}
                />
            ) : null}

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />

            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={giveTicker || ''}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}
            {/* Off Bitcoin this is mandatory, so it renders as a
                disclosure rather than a choice - the same treatment every other
                ORDER/SWAP authoring surface gives it. */}
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={giveTicker || ''} />

            {validationError ? (
                <StatusMessage variant="error" className={styles.error}>{validationError}</StatusMessage>
            ) : null}

            {formError ? (
                <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    loading={actionConfirm.composing}
                    disabled={!!validationError
                        || !fromAddress
                        || !giveTick || (!giveOwnership && !giveAmount) || !getTick || (!getOwnership && !getAmount) || !getAddress
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
