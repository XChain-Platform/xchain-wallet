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
import { AddressText, Button, ChainBadge, FeeSelector, Icon, Input, NetworkField, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import receivePickerStyles from './TokenPicker.module.css';
import { externalIndexOf } from '../addressSelection.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Sell-ownership surface: lists a token's ownership (the asset name) for
 * sale with GIVE_OWNERSHIP=1, via either mechanism:
 *   - ORDER: an open offer matched by a counterparty; native-coin payment
 *     settles via COINPAY, token payment settles atomically;
 *   - DISPENSER: an instant fixed-price buy (single-shot for ownership).
 * Both take the same fields here; only the action + submit handler differ.
 * Either side of the price can be native coin (GET_TICK empty) or a token.
 *
 * Unlike SwapForm (SWAP-based, no native coin), this reaches native-coin
 * sales. Ownership sales are single-fill/indivisible; escrowed ownership
 * returns to SOURCE on cancel/expiry. Launched from ManageToken's "Sell
 * name" action with the token + chain prefilled.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} props.chainId           the token's chain
 * @param {string} props.tick              the token whose ownership is for sale
 * @param {string} [props.initialFromAddress]   preferred signing address (issuer)
 */
export function SellOwnershipForm({ walletId, onBack, chainId: initialChainId, tick, initialFromAddress }) {
    // Seeded from the launching context; the Network field lets the user retarget.
    const [chainId, setChainId] = useState(initialChainId);
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    // 'order' → open ORDER (matched offer); 'dispenser' → DISPENSER (instant
    // fixed-price buy). Both escrow the name via GIVE_OWNERSHIP=1.
    const [mechanism, setMechanism] = useState(/** @type {'order' | 'dispenser'} */ ('order'));
    // 'coin' → sell for native coin (GET_TICK empty); 'token' → sell for a token.
    const [getMode, setGetMode] = useState(/** @type {'coin' | 'token'} */ ('coin'));
    const [getTick, setGetTick] = useState('');
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [price, setPrice] = useState('');
    const [expiration, setExpiration] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const all = (byChain || {})[chainId] || [];
                if (all.length === 0) {
                    setLoadError(`No address on this chain to sign from. Use Receive to generate one first.`);
                    return;
                }
                if (initialFromAddress) {
                    const match = all.find((a) => a.address === initialFromAddress);
                    if (match) { setFromAddressId(match.id); return; }
                }
                const hd = all.filter((a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null);
                const pick = (hd.length > 0 ? hd : all).slice().sort((a, b) => {
                    const ai = (externalIndexOf(a.derivationPath) ?? -1);
                    const bi = (externalIndexOf(b.derivationPath) ?? -1);
                    return bi - ai;
                })[0];
                setFromAddressId(pick.id);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging, initialFromAddress]);

    // Focus the password field when entering review, matching DestroyForm convention.
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    // PC-51: the native-coin protocol fee is MANDATORY off Bitcoin
    //Without this the composed ORDER/DISPENSER carries no fee
    // output, the transaction confirms, and the indexer rejects the action
    // with "insufficient fee (native coin output required)" while this form
    // reports the sale as open. Every other ORDER/DISPENSER authoring surface
    // (CreateOrderForm, PlaceOrderPanel, DispenserForm) already does this.
    const nativeFee = useNativeFee(chainId);
    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, chainId, fromAddressId]);

    const hw = isHwSource(fromAddress);
    const hwSignerInfo = useSignerInfo({ walletId, signerId: hw ? fromAddress?.signerId : null });
    const { isWatcherMode } = useWalletMode();

    const tokenUpper = (tick || '').toUpperCase();
    const wantLabel = getMode === 'coin' ? coinTicker : (getTick.trim().toUpperCase() || 'token');

    const validationError = useMemo(() => {
        if (getMode === 'token') {
            const gt = getTick.trim().toUpperCase();
            if (gt && gt === coinTicker) {
                return `Pick "Native coin" to sell for ${coinTicker}. The token field is for selling against another token.`;
            }
            if (gt && gt === tokenUpper) {
                return 'The price token must differ from the token being sold.';
            }
        }
        if (expiration.trim() && !/^[0-9]+$/.test(expiration.trim())) {
            return 'Expiration must be a whole number of blocks.';
        }
        return null;
    }, [getMode, getTick, coinTicker, tokenUpper, expiration]);

    const priceReady = /^[0-9]+(\.[0-9]+)?$/.test(price.trim()) && Number(price.trim()) > 0;
    const getTickReady = getMode === 'coin' || getTick.trim().length > 0;

    // Network fee: Low / Normal / Fast / Custom, editable via FeeSelector on
    // the form stage. `feeEstimate` backs the slider readout and the review
    // row; `feePerKb` prices the broadcast. Mirrors ComposeMessage.
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

    // Validate form fields and advance to the review stage; real signing
    // happens only after the user confirms on the review screen.
    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress || !chainId) return;
        if (validationError) return;
        if (!priceReady || !getTickReady) {
            setFormError(`Enter what you want in return and a price greater than 0.`);
            return;
        }
        setFormError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !chainId) return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;

        setStage('submitting');
        setSubmitError(null);
        try {
            // ORDER and DISPENSER ownership sales take the same fields; only
            // the action name + submit handler differ. GIVE_ESCROW is omitted
            // (must be empty for an ownership dispenser).
            const action = mechanism === 'dispenser' ? 'DISPENSER' : 'ORDER';
            const params = {
                VERSION: '0',
                GIVE_COIN: coinTicker,
                GIVE_TICK: tokenUpper,
                GIVE_OWNERSHIP: '1',
                GET_COIN: coinTicker,
                ...(getMode === 'token' ? { GET_TICK: getTick.trim().toUpperCase() } : {}),
                GET_AMOUNT: String(price).trim(),
                ...(expiration.trim() ? { EXPIRATION: expiration.trim() } : {}),
                ...(memo.trim() ? { MEMO: memo.trim() } : {}),
            };
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
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params },
                    // FOLLOW-UP: the watcher lane does NOT go through
                    // `base`, so the fee mode threaded onto the submit path
                    // above never reached it. Selling a name is priced
                    // (GAS_SCHEDULE.OWNERSHIP_ESCROW), so a watcher-mode sale
                    // off Bitcoin composed a PSBT with no FEE_DESTINATION
                    // output, the user approved it, and the indexer then
                    // rejected the action "insufficient fee (native coin output
                    // required)" while this form reported the sale as open -
                    // the exact bug a later change fixed, surviving on the one lane
                    // its fix did not touch.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (mechanism === 'dispenser') {
                r = hw
                    ? await messaging.dispenserActionHw({ ...base, signerId: fromAddress.signerId })
                    : await messaging.dispenserAction({ ...base, password });
            } else {
                r = hw
                    ? await messaging.orderActionHw({ ...base, signerId: fromAddress.signerId })
                    : await messaging.orderAction({ ...base, password });
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
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Sign failed.',
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

    // Header title switches to "Review sale" once the user leaves the form stage.
    const headerTitle = (stage === 'review' || stage === 'submitting')
        ? 'Review sale'
        : `Sell ${tokenUpper} name`;
    const header = (
        <PageHeader onBack={onBack} title={headerTitle} />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />,
            );
        }
        return wrap(
            <>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Name listed for sale</p>
                {txid ? <p style={{ margin: '0 0 0.5rem' }}>Transaction: <code>{txid}</code></p> : null}
                <p className={styles.hint}>
                    Your {mechanism === 'dispenser' ? 'dispenser' : 'offer'} to sell ownership of {tokenUpper} for {price} {wantLabel} is open.
                    {mechanism === 'dispenser'
                        ? ' A buyer can purchase it instantly at this price; close the dispenser to reclaim ownership.'
                        : ' Ownership is escrowed until a buyer matches; cancel before then to reclaim it.'}
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const mechanismLabel = mechanism === 'dispenser' ? 'Dispenser (instant buy)' : 'Open order';
        const priceLabel = `${price} ${wantLabel}`;
        const feeRow = feeEstimate
            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
            : 'Estimate unavailable';

        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Sell ownership of {tokenUpper} for {priceLabel} via {mechanismLabel}.
                </p>
                <dl className={styles.detailsList}>
                    <DetailRow label="Chain" value={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId} />
                    <DetailRow label="From" value={<AddressText address={fromAddress.address} />} />
                    <DetailRow label="Selling" value={`${tokenUpper} (ownership)`} />
                    <DetailRow label="Mechanism" value={mechanismLabel} />
                    <DetailRow label="Price" value={priceLabel} />
                    {expiration.trim() ? (
                        <DetailRow label="Expires after" value={`${expiration.trim()} blocks`} />
                    ) : null}
                    {memo.trim() ? (
                        <DetailRow label="Memo" value={memo.trim()} />
                    ) : null}
                    <DetailRow label="Network fee" value={feeRow} />
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
                                : 'List name for sale'}
                    </Button>
                </div>
            </form>,
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                title="Select price token"
                networkFilter={coinFromChainId(chainId)}
                onSelect={(sel) => { setGetTick(String(sel.tick || '').toUpperCase()); setTokenPickerOpen(false); }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <NetworkField value={chainId} onChange={(cid) => { setChainId(cid); setFromAddressId(null); }} chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]} chainRegistry={chainRegistry} />

            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Selling the name</dt>
                <dd className={styles.detailsValue} style={{ fontWeight: 700 }}>{tokenUpper}</dd>
                {fromAddress ? (
                    <>
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    </>
                ) : null}
            </dl>

            <p className={styles.hint} style={{ marginTop: 0 }}>
                You're selling the entire ownership of {tokenUpper}. Single sale, no partial fills.
            </p>

            <div
                className={receivePickerStyles.kindSegments}
                role="tablist"
                aria-label="How to sell"
                style={{ width: '100%', margin: 'var(--xc-space-2) 0' }}
            >
                {[
                    { id: 'order', label: 'Open order' },
                    { id: 'dispenser', label: 'Instant buy' },
                ].map((opt) => (
                    <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={mechanism === opt.id}
                        className={`${receivePickerStyles.kindSegment} ${mechanism === opt.id ? receivePickerStyles.kindSegmentActive : ''}`}
                        style={{ flex: 1 }}
                        onClick={() => setMechanism(/** @type {'order' | 'dispenser'} */ (opt.id))}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
            <p className={styles.hint} style={{ marginTop: 0 }}>
                {mechanism === 'order'
                    ? 'Open order: anyone can take the offer at your price; cancel before it matches.'
                    : 'Instant buy: a dispenser sells the name to the first buyer who pays your price.'}
            </p>

            <div
                className={receivePickerStyles.kindSegments}
                role="tablist"
                aria-label="What you want in return"
                style={{ width: '100%', margin: 'var(--xc-space-2) 0' }}
            >
                {[
                    { id: 'coin', label: `Native coin (${coinTicker || 'coin'})` },
                    { id: 'token', label: 'Another token' },
                ].map((opt) => (
                    <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={getMode === opt.id}
                        className={`${receivePickerStyles.kindSegment} ${getMode === opt.id ? receivePickerStyles.kindSegmentActive : ''}`}
                        style={{ flex: 1 }}
                        onClick={() => setGetMode(/** @type {'coin' | 'token'} */ (opt.id))}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {getMode === 'token' ? (
                <TokenField
                    label="Price token"
                    value={getTick && chainId ? { chainId, tick: getTick } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                />
            ) : null}

            <Input
                label={`Price${wantLabel ? ` (in ${wantLabel})` : ''}`}
                hint={getMode === 'coin'
                    ? 'When a buyer matches, they pay this in coin and ownership is delivered on settlement.'
                    : 'The buyer transfers this many tokens; ownership swaps atomically on match.'}
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                autoComplete="off"
            />

            <Input
                label="Expires after (blocks, optional)"
                hint="Leave blank for no expiry. The order stays open until matched or cancelled."
                type="text"
                inputMode="numeric"
                value={expiration}
                onChange={(e) => setExpiration(e.target.value)}
                autoComplete="off"
            />

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />

            {/* On LTC/DOGE this is mandatory and the toggle renders
                as a disclosure rather than a choice, which is the same
                treatment the other ORDER/DISPENSER forms give it. */}
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} />

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

            {validationError ? (
                <p role="alert" className={styles.error} style={{ marginTop: '0.5rem' }}>{validationError}</p>
            ) : null}

            {formError ? (
                <p role="alert" className={styles.error} style={{ marginTop: '0.5rem' }}>{formError}</p>
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!!validationError || !fromAddress || !priceReady || !getTickReady}
                >
                    Review
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
