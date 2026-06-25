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
    ScreenHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { activeSourceId } from '../addressSelection.js';
import { estimateNativeSendFee } from '../../flows/feeEstimate.js';
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
    const [expirationBlocks, setExpirationBlocks] = useState('1000');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

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
            (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
        );
        const pool = hd.length > 0 ? hd : addrs;
        if (pool.length > 0) {
            const sorted = [...pool].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
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
    const hw = isHwSource(fromAddress);

    const validationError = useMemo(() => {
        if (!giveCoinTicker || !getCoinTicker) return null;
        if (giveCoinTicker === getCoinTicker) {
            return 'Give and get chains must differ. For same-chain swaps use Swap tokens (§41.5).';
        }
        if (giveTick && giveTick.toUpperCase() === giveCoinTicker) {
            return `SWAP cannot give ${giveCoinTicker}. Use DISPENSER for token to native coin.`;
        }
        if (getTick && getTick.toUpperCase() === getCoinTicker) {
            return `SWAP cannot get ${getCoinTicker}. Use DISPENSER for token to native coin.`;
        }
        if (expirationBlocks && !/^\d+$/.test(expirationBlocks)) {
            return 'Expiration must be a positive integer.';
        }
        return null;
    }, [giveCoinTicker, getCoinTicker, giveTick, getTick, expirationBlocks]);

    // Network fee estimate for the give chain (the chain that pays the
    // on-chain fee). Computed synchronously from the placeholder table;
    // displayed on the review screen so the user sees a cost summary.
    const feeEstimate = useMemo(
        () => estimateNativeSendFee({ chainId: giveChainId, chainRegistry }),
        [giveChainId],
    );
    const giveTicker = giveDescriptor?.coin
        ? NATIVE_TICKER_BY_COIN[giveDescriptor.coin] || giveDescriptor.coin.toUpperCase()
        : null;
    const feeText = feeEstimate && giveTicker
        ? `${feeEstimate.coinAmount} ${giveTicker}` + (feeEstimate.rate ? ` (${feeEstimate.rate})` : '')
        : 'Estimate unavailable';

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    // Validate the form fields and advance to the review stage. The
    // actual sign/broadcast only fires from handleSubmit, which is
    // reachable only from the review screen.
    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress || !giveChainId || !getChainId) return;
        if (validationError) return;
        if (!giveTick || !giveAmount || !getTick || !getAmount) {
            setFormError('Fill give/get tickers and amounts before reviewing.');
            return;
        }
        if (!getAddress) {
            setFormError('Receiver address on the get-chain is required.');
            return;
        }
        setFormError(null);
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
            const params = {
                VERSION: '0',
                GIVE_COIN: giveCoinTicker,
                GIVE_TICK: giveTick.trim(),
                GIVE_AMOUNT: String(giveAmount).trim(),
                GET_COIN: getCoinTicker,
                GET_TICK: getTick.trim(),
                GET_AMOUNT: String(getAmount).trim(),
                GET_ADDRESS: getAddress.trim(),
                ...(expirationBlocks.trim() ? { EXPIRATION: expirationBlocks.trim() } : {}),
                ...(memo.trim() ? { MEMO: memo.trim() } : {}),
            };
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
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId: giveChainId,
                    from: base.from,
                    actionData: { action: 'SWAP', params },
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
            setSubmitError(bad ? 'Incorrect password.' : err?.message || 'Sign failed.');
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
        <ScreenHeader
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
                <p className={styles.successTitle}>Cross-chain SWAP broadcast</p>
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
                    {expirationBlocks ? (
                        <DetailRow label="Expiration" value={`${expirationBlocks} blocks`} />
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
                    <div role="alert" className={styles.error}>{submitError}</div>
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
                                : 'Sign cross-chain SWAP'}
                    </Button>
                </div>
            </form>,
        );
    }

    const chainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div style={{
                display: 'grid',
                gridTemplateColumns: isFull ? '1fr 1fr' : '1fr',
                gap: 'var(--xc-space-3)',
            }}>
                <fieldset style={fieldsetStyle}>
                    <legend style={legendStyle}>You give</legend>
                    <label className={styles.pickerLabel}>
                        <span>Give chain</span>
                        <select
                            className={styles.picker}
                            value={giveChainId || ''}
                            onChange={(e) => setGiveChainId(e.target.value)}
                        >
                            {chainIds.map((cid) => {
                                const d = chainRegistry.get(cid);
                                return (
                                    <option key={cid} value={cid}>
                                        {d ? d.displayName : cid}
                                    </option>
                                );
                            })}
                        </select>
                    </label>
                    <label className={styles.pickerLabel}>
                        <span>From address</span>
                        <select
                            className={styles.picker}
                            value={fromAddressId || ''}
                            onChange={(e) => setFromAddressId(e.target.value)}
                        >
                            {(addressesByChain[giveChainId] || []).map((a) => (
                                <option key={a.id} value={a.id}>{a.address}</option>
                            ))}
                        </select>
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Input
                            label="Give ticker"
                            value={giveTick}
                            onChange={(e) => setGiveTick(e.target.value)}
                            placeholder="e.g. RAREPEPE"
                            autoCapitalize="characters"
                            style={{ flex: 1 }}
                        />
                        <Input
                            label="Give amount"
                            type="text"
                            inputMode="decimal"
                            value={giveAmount}
                            onChange={(e) => setGiveAmount(e.target.value)}
                            style={{ flex: 1 }}
                        />
                    </div>
                </fieldset>

                <fieldset style={fieldsetStyle}>
                    <legend style={legendStyle}>You get</legend>
                    <label className={styles.pickerLabel}>
                        <span>Get chain</span>
                        <select
                            className={styles.picker}
                            value={getChainId || ''}
                            onChange={(e) => {
                                setGetChainId(e.target.value);
                                setGetAddressTouched(false);
                            }}
                        >
                            {chainIds.map((cid) => {
                                const d = chainRegistry.get(cid);
                                return (
                                    <option key={cid} value={cid}>
                                        {d ? d.displayName : cid}
                                    </option>
                                );
                            })}
                        </select>
                    </label>
                    <Input
                        label="Receive at"
                        value={getAddress}
                        onChange={(e) => {
                            setGetAddress(e.target.value);
                            setGetAddressTouched(true);
                        }}
                        placeholder="auto-filled from your get-chain wallet"
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Input
                            label="Get ticker"
                            value={getTick}
                            onChange={(e) => setGetTick(e.target.value)}
                            placeholder="e.g. PEPECASH"
                            autoCapitalize="characters"
                            style={{ flex: 1 }}
                        />
                        <Input
                            label="Get amount"
                            type="text"
                            inputMode="decimal"
                            value={getAmount}
                            onChange={(e) => setGetAmount(e.target.value)}
                            style={{ flex: 1 }}
                        />
                    </div>
                </fieldset>
            </div>

            <Input
                label="Expiration (blocks)"
                value={expirationBlocks}
                onChange={(e) => setExpirationBlocks(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
            />

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />

            {validationError ? (
                <p role="alert" className={styles.error}>{validationError}</p>
            ) : null}

            {formError ? (
                <p role="alert" className={styles.error}>{formError}</p>
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!!validationError
                        || !fromAddress
                        || !giveTick || !giveAmount || !getTick || !getAmount || !getAddress}
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
