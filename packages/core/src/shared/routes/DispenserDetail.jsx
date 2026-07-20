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
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { multiplyAmounts } from '../../market/orderMath.js';
import * as branding from '../../branding/branding.js';
import styles from './IssueTokenForm.module.css';
import local from './DispenserDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Dispenser detail page (§40.7.1): management surface for a single
 * dispenser. Step 22a surfaces:
 *
 *   - Static metadata (rate, give/get coins + ticks, creator, memo,
 *     block + status) pulled via `dispensers.byActionIndex`.
 *   - Recent dispense events (fills) via `dispenses.query` with
 *     type='source' scoped to the dispenser's source address (the
 *     explorer doesn't yet have a by-dispenser-action-index dispense
 *     query).
 *   - For owners (source address is one of the wallet's addresses),
 *     a "Cancel dispenser" button that runs Step 21's v1 lane via
 *     `messaging.dispenserAction` with a password re-prompt.
 *
 * Live escrow balance + remaining-fills counts are deferred; the
 * indexer surface doesn't expose them yet (see xchain-explorer/src/
 * db.js getDispensers TODO).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {() => void} [props.onCanceled]           called after a successful cancel broadcast
 */
export function DispenserDetail({ walletId, chainId, actionIndex, onBack, onCanceled }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [dispenser, setDispenser] = useState(/** @type {any | null} */ (null));
    const [action, setAction] = useState(/** @type {any | null} */ (null));
    const [dispenses, setDispenses] = useState(/** @type {any[]} */ ([]));
    const [ownerAddress, setOwnerAddress] = useState(
        /** @type {any | null} */ (null),
    );
    const [buyerAddresses, setBuyerAddresses] = useState(/** @type {any[]} */ ([]));
    const [buyerAddressId, setBuyerAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    // Refill (DISPENSER v2 edit: top up GIVE_ESCROW) mirrors the cancel flow.
    const [refillStage, setRefillStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [refillAmount, setRefillAmount] = useState('');
    const [refillError, setRefillError] = useState(/** @type {string | null} */ (null));
    const [refillResult, setRefillResult] = useState(/** @type {any | null} */ (null));
    // Quick-action "More" popover.
    const [moreOpen, setMoreOpen] = useState(false);
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!moreOpen) return undefined;
        const onDown = (e) => {
            if (moreWrapRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [moreOpen]);
    const [cancelStage, setCancelStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [password, setPassword] = useState('');
    const [cancelError, setCancelError] = useState(/** @type {string | null} */ (null));
    const [cancelResult, setCancelResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Buy-one-fill state (token-paid lane only; coin-paid uses the
    // instructions panel rather than a signed XChain SEND).
    const [fills, setFills] = useState('1');
    const [buyStage, setBuyStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [buyPassword, setBuyPassword] = useState('');
    const [buyError, setBuyError] = useState(/** @type {string | null} */ (null));
    const [buyResult, setBuyResult] = useState(/** @type {any | null} */ (null));
    const buyPasswordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const [copied, setCopied] = useState(/** @type {string | null} */ (null));

    const descriptor = chainRegistry.get(chainId);

    // Load the dispenser action + wallet addresses (to detect ownership)
    // in parallel. Recent dispenses come on a best-effort basis;
    // failure there still lets the user see the dispenser metadata.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        // Demo wallet: resolve the fixture row (owned by the first address
        // on this chain) instead of querying an explorer.
        const isDemo = flowsLib.isDemoWallet(walletId);
        Promise.all([
            isDemo
                ? Promise.resolve(null)
                : messaging.getDispenserByActionIndex({ chainId, actionIndex })
                    .then((resp) => (cancelled ? null : resp))
                    .catch((err) => { if (!cancelled) throw err; }),
            messaging.getAddressesByChain(walletId)
                .then((byChain) => (cancelled ? null : byChain))
                .catch(() => null),
        ]).then(([realResp, addrsByChain]) => {
            let resp = realResp;
            if (isDemo && !cancelled) {
                const first = (addrsByChain?.[chainId] || [])[0]?.address;
                const rows = first ? flowsLib.synthesizeDemoDispensers(chainId, first) : [];
                resp = rows.find((r) => String(r.action_index) === String(actionIndex)) || null;
            }
            if (cancelled) return;
            const act = pickAction(resp);
            const disp = pickDispenser(resp);
            if (!act) {
                setLoadError('Action not found.');
                setLoading(false);
                return;
            }
            setAction(act);
            setDispenser(disp);

            const source = disp?.source || act?.source;
            if (addrsByChain) {
                const onChain = (addrsByChain[chainId] || []);
                if (source) {
                    const matches = onChain.find((a) => a.address === source);
                    if (matches) setOwnerAddress(matches);
                }
                // Pre-populate the buyer-address picker with this wallet's
                // HD addresses on the dispenser's chain. Non-HD (watch-
                // only) addresses are filtered out because they can't
                // sign. The default is the newest external address,
                // matching the convention used by Send / MintForm.
                const spendable = onChain.filter(
                    (a) => a.source === 'hd'
                        && a.derivationPath?.split('/')?.[4] === '0',
                );
                setBuyerAddresses(spendable);
                if (spendable.length > 0) {
                    const sorted = [...spendable].sort((a, b) => {
                        const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                        const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                        return bi - ai;
                    });
                    setBuyerAddressId(sorted[0].id);
                }
            }
            setLoading(false);

            if (isDemo) {
                setDispenses(flowsLib.synthesizeDemoDispenses(actionIndex));
            } else if (source) {
                messaging.getDispenses({ chainId, query: source, type: 'source' })
                    .then((d) => { if (!cancelled) setDispenses(extractRows(d)); })
                    .catch(() => { /* best-effort; detail still usable without dispenses */ });
            }
        }).catch((err) => {
            if (!cancelled) {
                setLoadError(err?.message || 'Failed to load dispenser.');
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [walletId, chainId, actionIndex, messaging]);

    useEffect(() => {
        if (cancelStage === 'confirm') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [cancelStage]);

    useEffect(() => {
        if (buyStage === 'confirm') {
            setTimeout(() => buyPasswordRef.current?.focus(), 0);
        }
    }, [buyStage]);

    const cancelParams = useMemo(() => ({
        VERSION: '1',
        DISPENSER_ACTION_INDEX: String(actionIndex),
    }), [actionIndex]);

    const decodedCancel = useMemo(() => {
        if (cancelStage !== 'confirm' && cancelStage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'DISPENSER',
            params: cancelParams,
            chainId,
            chainRegistry,
        });
    }, [cancelStage, cancelParams, chainId]);

    // Buyer lanes:
    //   - Token-paid (dispenser.get_tick non-empty): triggered by an
    //     XChain SEND of GET_TICK to the dispenser address. Uses the
    //     existing messaging.sendToken flow, so the wallet signs +
    //     broadcasts through the standard pipeline.
    //   - Coin-paid (dispenser.get_coin set, dispenser.get_tick empty):
    //     triggered by a bare native-coin payment to the dispenser
    //     address per DISPENSER.md ("no XChain action needed from the buyer").
    //     The wallet doesn't yet have a bare-coin-send path, so this lane
    //     renders a pay-here instruction panel that works with any native
    //     coin wallet (including this one, via future native-send infra).
    const getTick = dispenser?.get_tick || '';
    const getCoin = dispenser?.get_coin || '';
    const getAmount = dispenser?.get_amount;
    const giveTick = dispenser?.give_tick;
    const giveAmount = dispenser?.give_amount;
    const dispAddr = dispenser?.address;
    const isTokenPaid = Boolean(getTick) && !!getAmount;
    const isCoinPaid = !getTick && Boolean(getCoin) && !!getAmount;
    const canBuyWithSend = isTokenPaid && buyerAddresses.length > 0 && !ownerAddress;
    const showPayHere = isCoinPaid && !ownerAddress;

    const fillsNum = useMemo(() => {
        const n = Number(String(fills).trim());
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }, [fills]);

    const totalPayAmount = useMemo(() => {
        if (!getAmount || fillsNum <= 0) return null;
        // `handleBuy` sends this exact value on the wire as the SEND amount,
        // so it must be computed in exact decimal space. Float multiplication
        // drifts ('0.1' x 3 -> '0.30000000000000004') and collapses tiny
        // amounts to scientific notation ('0.00000001' x 3 -> '3e-8'), either
        // of which the encoder rejects or mis-prices. The display string is
        // derived from this same exact value.
        return multiplyAmounts(getAmount, String(fillsNum));
    }, [getAmount, fillsNum]);

    const totalReceive = useMemo(() => {
        if (!giveAmount || fillsNum <= 0) return null;
        return multiplyAmounts(giveAmount, String(fillsNum));
    }, [giveAmount, fillsNum]);

    async function handleCopy(text, label) {
        try {
            await navigator.clipboard?.writeText(text);
            setCopied(label);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* swallow; older browsers or locked-down contexts */
        }
    }

    const buyerAddress = useMemo(() => {
        if (!buyerAddressId) return null;
        return buyerAddresses.find((a) => a.id === buyerAddressId) || null;
    }, [buyerAddressId, buyerAddresses]);

    const buyHw = isHwSource(buyerAddress);
    const cancelHw = isHwSource(ownerAddress);
    const [buyHwStatus, setBuyHwStatus] = useState('idle');
    const [cancelHwStatus, setCancelHwStatus] = useState('idle');
    const onBuyHwStatusChange = useCallback(({ status }) => setBuyHwStatus(status), []);
    const onCancelHwStatusChange = useCallback(({ status }) => setCancelHwStatus(status), []);

    async function handleBuy(event) {
        event.preventDefault();
        if (buyStage === 'submitting' || !buyerAddress) return;
        if (!buyHw && (!signerReady && buyPassword.length === 0)) return;
        if (buyHw && buyHwStatus !== 'available') return;
        if (!isTokenPaid || !dispAddr || !totalPayAmount) return;
        setBuyStage('submitting');
        setBuyError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: buyerAddress.address,
                    publicKey: buyerAddress.publicKey,
                    derivationPath: buyerAddress.derivationPath,
                    addressId: buyerAddress.id,
                    source: buyerAddress.source,
                    signerId: buyerAddress.signerId,
                },
                to: dispAddr,
                tick: getTick,
                amount: totalPayAmount,
            };
            const res = buyHw
                ? await messaging.sendAssetHw({ ...base, signerId: buyerAddress.signerId })
                : await messaging.sendToken({ ...base, password: buyPassword });
            setBuyResult(res);
            setBuyPassword('');
            setBuyStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setBuyError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Buy failed.',
            );
            setBuyStage('confirm');
            if (!buyHw) {
                buyPasswordRef.current?.focus();
                buyPasswordRef.current?.select();
            }
        }
    }

    async function handleRefill(event) {
        event.preventDefault();
        if (refillStage === 'submitting' || !ownerAddress) return;
        const amt = refillAmount.trim();
        if (!amt || !(Number(amt) > 0)) { setRefillError('Enter a refill amount.'); return; }
        if (!cancelHw && (!signerReady && password.length === 0)) return;
        if (cancelHw && cancelHwStatus !== 'available') return;
        setRefillStage('submitting');
        setRefillError(null);
        // Demo wallet: fabricated dispensers can't broadcast; simulate.
        if (flowsLib.isDemoWallet(walletId)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setRefillResult({ txid: null });
            setPassword('');
            setRefillStage('done');
            return;
        }
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: ownerAddress.address,
                    publicKey: ownerAddress.publicKey,
                    derivationPath: ownerAddress.derivationPath,
                    addressId: ownerAddress.id,
                    source: ownerAddress.source,
                    signerId: ownerAddress.signerId,
                },
                params: {
                    VERSION: '2',
                    DISPENSER_ACTION_INDEX: String(actionIndex),
                    GIVE_ESCROW: amt,
                },
            };
            const res = cancelHw
                ? await messaging.dispenserActionHw({ ...base, signerId: ownerAddress.signerId })
                : await messaging.dispenserAction({ ...base, password });
            setRefillResult(res);
            setPassword('');
            setRefillStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setRefillError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Refill failed.',
            );
            setRefillStage('confirm');
            if (!cancelHw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    async function handleCancel(event) {
        event.preventDefault();
        if (cancelStage === 'submitting' || !ownerAddress) return;
        if (!cancelHw && (!signerReady && password.length === 0)) return;
        if (cancelHw && cancelHwStatus !== 'available') return;
        setCancelStage('submitting');
        setCancelError(null);
        // Demo wallet: fabricated dispensers can't broadcast; simulate.
        if (flowsLib.isDemoWallet(walletId)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setCancelResult({ txid: null });
            setPassword('');
            setCancelStage('done');
            return;
        }
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: ownerAddress.address,
                    publicKey: ownerAddress.publicKey,
                    derivationPath: ownerAddress.derivationPath,
                    addressId: ownerAddress.id,
                    source: ownerAddress.source,
                    signerId: ownerAddress.signerId,
                },
                params: cancelParams,
            };
            const res = cancelHw
                ? await messaging.dispenserActionHw({ ...base, signerId: ownerAddress.signerId })
                : await messaging.dispenserAction({ ...base, password });
            setCancelResult(res);
            setPassword('');
            setCancelStage('done');
            onCanceled?.();
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setCancelError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Cancel failed.',
            );
            setCancelStage('confirm');
            if (!cancelHw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

        const header = (
        <PageHeader
            onBack={onBack}
            titleIcon={<Icon.TokenIcon />}
            title={cancelStage === 'confirm' || cancelStage === 'submitting'
                    ? 'Confirm close'
                    : refillStage === 'confirm' || refillStage === 'submitting'
                        ? 'Refill dispenser'
                        : buyStage === 'confirm' || buyStage === 'submitting'
                            ? 'Review buy'
                            : 'Dispenser detail'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loading) return wrap(<p className={styles.hint}>Loading…</p>);
    if (loadError) return wrap(<div role="alert" className={styles.error}>{loadError}</div>);

    if (cancelStage === 'done') {
        const txid = cancelResult?.txid || cancelResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Cancel submitted</h2>
                <p className={styles.hint}>
                    The dispenser enters a 1-hour close window before remaining escrow is released.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (refillStage === 'done') {
        const txid = refillResult?.txid || refillResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Refill submitted</h2>
                <p className={styles.hint}>
                    {refillAmount} {giveTick} moves into escrow when the edit confirms.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={() => { setRefillStage('idle'); setRefillAmount(''); }}>
                        Done
                    </Button>
                </div>
            </>,
        );
    }

    if (refillStage === 'confirm' || refillStage === 'submitting') {
        return wrap(
            <form onSubmit={handleRefill} noValidate>
                <p className={styles.summary}>
                    Refill dispenser #{actionIndex}: add {giveTick} to escrow.
                </p>
                <Input
                    label={`Amount of ${giveTick || 'tokens'} to add`}
                    inputMode="decimal"
                    value={refillAmount}
                    onChange={(e) => {
                        setRefillAmount(e.target.value);
                        if (refillError) setRefillError(null);
                    }}
                    autoComplete="off"
                />
                <SignCredentials
                    unlocked={signerReady}
                    fromAddress={ownerAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => {
                        setPassword(v);
                        if (refillError) setRefillError(null);
                    }}
                    onStatusChange={onCancelHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={refillError}
                    disabled={refillStage === 'submitting'}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {cancelHw && refillError ? (
                    <div role="alert" className={styles.error}>{refillError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={refillStage === 'submitting'}
                        disabled={cancelHw ? cancelHwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {cancelHw
                            ? `Sign refill on ${ownerAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : 'Sign refill'}
                    </Button>
                </div>
            </form>,
        );
    }

    if (buyStage === 'done') {
        const txid = buyResult?.txid || buyResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Buy submitted</h2>
                <p className={styles.hint}>
                    You paid {totalPayAmount} {getTick}. If the dispenser is still open
                    when this confirms, you should receive {totalReceive} {giveTick}.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (buyStage === 'confirm' || buyStage === 'submitting') {
        return wrap(
            <form onSubmit={handleBuy} noValidate>
                <p className={styles.summary}>
                    Buy {fillsNum} fill{fillsNum === 1 ? '' : 's'}: pay {totalPayAmount} {getTick}
                    {' '}→ receive ~{totalReceive} {giveTick}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={buyerAddress?.address || ''} />
                    </dd>
                    <dt className={styles.detailsLabel}>Dispenser</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={dispAddr || ''} />
                    </dd>
                    <dt className={styles.detailsLabel}>Per-fill price</dt>
                    <dd className={styles.detailsValue}>{getAmount} {getTick}</dd>
                    <dt className={styles.detailsLabel}>Per-fill give</dt>
                    <dd className={styles.detailsValue}>{giveAmount} {giveTick}</dd>
                </dl>
                <p className={styles.hint}>
                    The dispenser triggers when your payment confirms. If the dispenser
                    closes or runs out before then, the payment reaches the creator but
                    no {giveTick} is released. This is a normal risk when buying on
                    these chains.
                </p>
                <SignCredentials
                        unlocked={signerReady}
                    fromAddress={buyerAddress}
                    chainId={chainId}
                    password={buyPassword}
                    onPasswordChange={(v) => {
                        setBuyPassword(v);
                        if (buyError) setBuyError(null);
                    }}
                    onStatusChange={onBuyHwStatusChange}
                    passwordRef={buyPasswordRef}
                    submitError={buyError}
                    disabled={buyStage === 'submitting'}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {buyHw && buyError ? (
                    <div role="alert" className={styles.error}>{buyError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={buyStage === 'submitting'}
                        disabled={buyHw ? buyHwStatus !== 'available' : (!signerReady && buyPassword.length === 0)}
                    >
                        {buyHw
                            ? `Sign buy on ${buyerAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : (descriptor ? `Sign buy on ${descriptor.displayName}` : 'Sign buy')}
                    </Button>
                </div>
            </form>,
        );
    }

    if (cancelStage === 'confirm' || cancelStage === 'submitting') {
        return wrap(
            <form onSubmit={handleCancel} noValidate>
                <p className={styles.summary}>{decodedCancel?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={ownerAddress?.address || ''} />
                    </dd>
                    {(decodedCancel?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                </dl>
                {decodedCancel && decodedCancel.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decodedCancel.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                <SignCredentials
                        unlocked={signerReady}
                    fromAddress={ownerAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => {
                        setPassword(v);
                        if (cancelError) setCancelError(null);
                    }}
                    onStatusChange={onCancelHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={cancelError}
                    disabled={cancelStage === 'submitting'}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {cancelHw && cancelError ? (
                    <div role="alert" className={styles.error}>{cancelError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="danger"
                        loading={cancelStage === 'submitting'}
                        disabled={cancelHw ? cancelHwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {cancelHw
                            ? `Sign cancel on ${ownerAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : 'Sign cancel'}
                    </Button>
                </div>
            </form>,
        );
    }

    const source = dispenser?.source || action?.source;
    const dispAddress = dispenser?.address;
    const matchingDispenses = dispenses.filter(
        (d) => String(d.get_tick || dispenser?.get_tick) === String(dispenser?.get_tick)
            && String(d.give_tick || dispenser?.give_tick) === String(dispenser?.give_tick),
    );

    return wrap(
        <>
            {/* Stats hero: what's dispensed at what rate, how it's paid,
                where it lives, how it's doing. Block height / action index
                are secondary (action index lives in the More menu). */}
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Dispensing</dt>
                <dd className={styles.detailsValue}>
                    {formatNum(giveAmount)} {giveTick || '?'} per fill
                </dd>
                <dt className={styles.detailsLabel}>Payment</dt>
                <dd className={styles.detailsValue}>
                    {formatNum(getAmount)} {getTick || getCoin || '?'}
                    {getTick ? ' (token)' : getCoin ? ' (native coin)' : ''}
                </dd>
                {dispenser?.escrow_remaining != null ? (
                    <>
                        <dt className={styles.detailsLabel}>Balance</dt>
                        <dd className={styles.detailsValue}>
                            {formatNum(dispenser.escrow_remaining)} {giveTick || ''} in escrow
                        </dd>
                    </>
                ) : null}
                {dispenser?.dispense_count != null ? (
                    <>
                        <dt className={styles.detailsLabel}>Dispenses</dt>
                        <dd className={styles.detailsValue}>{formatNum(dispenser.dispense_count)}</dd>
                    </>
                ) : null}
                {(dispAddress || source) ? (
                    <>
                        <dt className={styles.detailsLabel}>Address</dt>
                        <dd className={styles.detailsValue} style={{ overflowWrap: 'anywhere' }}>
                            <AddressText address={dispAddress || source} truncate={false} />
                            {ownerAddress ? ' (you)' : ''}
                        </dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Status</dt>
                <dd className={styles.detailsValue}>{String(dispenser?.status || 'unknown')}</dd>
                {dispenser?.memo ? (
                    <>
                        <dt className={styles.detailsLabel}>Memo</dt>
                        <dd className={styles.detailsValue}>{dispenser.memo}</dd>
                    </>
                ) : null}
            </dl>

            <div className={local.quickActions} role="group" aria-label="Dispenser actions">
                <button
                    type="button"
                    className={local.quickAction}
                    onClick={() => setCancelStage('confirm')}
                    disabled={!ownerAddress}
                    title={ownerAddress ? 'Close this dispenser' : 'Only the owner can close'}
                >
                    <span className={local.quickActionIcon} aria-hidden="true"><Icon.XIcon /></span>
                    <span>Close</span>
                </button>
                <button
                    type="button"
                    className={local.quickAction}
                    onClick={() => setRefillStage('confirm')}
                    disabled={!ownerAddress}
                    title={ownerAddress ? 'Add escrow to this dispenser' : 'Only the owner can refill'}
                >
                    <span className={local.quickActionIcon} aria-hidden="true"><Icon.PlusIcon /></span>
                    <span>Refill</span>
                </button>
                <button
                    type="button"
                    className={local.quickAction}
                    onClick={() => {
                        const base = descriptor?.explorer?.defaultUrl || branding.DEFAULT_EXPLORER_BASE;
                        try { window.open(`${base}/action/${actionIndex}`, '_blank', 'noopener'); } catch { /* no-op */ }
                    }}
                    title="View on the XChain explorer"
                >
                    <img src={branding.logoUrl()} alt="" aria-hidden="true" className={local.quickActionLogo} />
                    <span>XChain</span>
                </button>
                <div className={local.quickActionMoreWrap} ref={moreWrapRef}>
                    <button
                        type="button"
                        className={local.quickAction}
                        aria-haspopup="menu"
                        aria-expanded={moreOpen}
                        onClick={() => setMoreOpen((o) => !o)}
                    >
                        <span className={local.quickActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                        <span>More</span>
                    </button>
                    {moreOpen ? (
                        <div className={local.quickActionMoreMenu} role="menu">
                            <button
                                type="button"
                                role="menuitem"
                                className={local.quickActionMoreItem}
                                onClick={() => { setMoreOpen(false); handleCopy(dispAddress || source || '', 'address'); }}
                            >
                                <span aria-hidden="true"><Icon.CopyIcon /></span>
                                <span>{copied === 'address' ? 'Copied' : 'Copy dispenser address'}</span>
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={local.quickActionMoreItem}
                                onClick={() => { setMoreOpen(false); handleCopy(String(actionIndex), 'index'); }}
                            >
                                <span aria-hidden="true"><Icon.CopyIcon /></span>
                                <span>{copied === 'index' ? 'Copied' : 'Copy action index'}</span>
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>

            <div className={local.tabBar} role="tablist">
                <button type="button" role="tab" aria-selected="true" className={`${local.tab} ${local.tabActive}`}>
                    Dispenses
                </button>
            </div>
            <ul className={local.dispenseList}>
                {matchingDispenses.length === 0 ? (
                    <li><div className={local.dispenseEmpty}>No dispenses yet.</div></li>
                ) : matchingDispenses.slice(0, 25).map((d) => {
                    const paidAmount = d.get_amount ?? getAmount;
                    const paidUnit = d.get_tick || d.get_coin || getTick || getCoin || '';
                    return (
                        <li key={String(d.action_index)}>
                            <div className={local.dispenseRow}>
                                <span className={local.dispenseAmount}>
                                    {formatNum(d.give_amount)} {d.give_tick || giveTick || ''}
                                </span>
                                <span className={local.dispensePaid}>
                                    {paidAmount != null ? `for ${formatNum(paidAmount)} ${paidUnit}`.trim() : ''}
                                </span>
                                <span className={local.dispenseWhen}>
                                    {relativeTime(d.timestamp || d.block_time)}
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ul>

            {canBuyWithSend ? (
                <section style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid var(--xc-border)', borderRadius: '4px' }}>
                    <p className={styles.successLabel}>Buy from this dispenser</p>
                    <p className={styles.hint}>
                        Send {getAmount} {getTick} per fill. Tokens dispense when the SEND
                        confirms and the dispenser is still open.
                    </p>
                    {buyerAddresses.length > 1 ? (
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                            <span className={styles.detailsLabel}>Pay from</span>
                            <select
                                value={buyerAddressId || ''}
                                onChange={(e) => setBuyerAddressId(e.target.value)}
                                style={{ marginLeft: '0.5rem' }}
                            >
                                {buyerAddresses.map((a) => (
                                    <option key={a.id} value={a.id}>{a.address}</option>
                                ))}
                            </select>
                        </label>
                    ) : buyerAddress ? (
                        <p className={styles.entryDescription}>
                            Paying from <AddressText address={buyerAddress.address} />
                        </p>
                    ) : null}
                    <Input
                        label="Fills"
                        hint="Multiply per-fill amounts by this number (integer ≥ 1)."
                        inputMode="numeric"
                        value={fills}
                        onChange={(e) => setFills(e.target.value)}
                        autoComplete="off"
                    />
                    <Button
                        variant="primary"
                        onClick={() => setBuyStage('confirm')}
                        disabled={fillsNum <= 0 || !buyerAddress || !dispAddr}
                    >
                        Buy {fillsNum > 0 ? `${fillsNum} ` : ''}fill{fillsNum === 1 ? '' : 's'}
                    </Button>
                </section>
            ) : null}

            {showPayHere ? (
                <section style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid var(--xc-border)', borderRadius: '4px' }}>
                    <p className={styles.successLabel}>Pay to buy</p>
                    <p className={styles.hint}>
                        This dispenser accepts bare {getCoin} payments. Any {getCoin} wallet
                        can trigger a fill. Send exactly {getAmount} {getCoin} per fill to
                        the dispenser address.
                    </p>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Send to</dt>
                        <dd className={styles.detailsValue}>
                            <code style={{ wordBreak: 'break-all' }}>{dispAddr}</code>
                            {' '}
                            <button
                                type="button"
                                onClick={() => handleCopy(dispAddr, 'address')}
                                style={{ marginLeft: '0.5rem' }}
                            >
                                {copied === 'address' ? 'Copied' : 'Copy'}
                            </button>
                        </dd>
                        <dt className={styles.detailsLabel}>Send exactly</dt>
                        <dd className={styles.detailsValue}>
                            <code>{getAmount} {getCoin}</code>
                            {' '}
                            <button
                                type="button"
                                onClick={() => handleCopy(String(getAmount), 'amount')}
                                style={{ marginLeft: '0.5rem' }}
                            >
                                {copied === 'amount' ? 'Copied' : 'Copy amount'}
                            </button>
                            {' per fill'}
                        </dd>
                        <dt className={styles.detailsLabel}>Per-fill give</dt>
                        <dd className={styles.detailsValue}>{giveAmount} {giveTick}</dd>
                    </dl>
                    <p className={styles.hint}>
                        Native-coin sending from this wallet is on the roadmap; for now,
                        use any {getCoin} wallet to trigger the dispense.
                    </p>
                </section>
            ) : null}

        </>,
    );
}

// Thousands separators on the integer part of a decimal string, exact
// (no float round-trip): '4750' -> '4,750', '0.005' stays '0.005'.
function formatNum(v) {
    if (v == null || v === '') return '?';
    const s = String(v);
    const [int, frac] = s.split('.');
    if (!/^\d+$/.test(int)) return s;
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac != null ? `${grouped}.${frac}` : grouped;
}

// Human-readable "X ago". Accepts unix seconds or ms; '' for invalid
// input so the row just omits the time. (Same shape as TxStatusTimeline's.)
function relativeTime(ts) {
    const n = Number(ts);
    if (!n || !Number.isFinite(n)) return '';
    const ms = n < 1e12 ? n * 1000 : n;
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec} seconds ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(diffSec / 3600);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(diffSec / 86400);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
    const year = Math.floor(day / 365);
    return `${year} year${year === 1 ? '' : 's'} ago`;
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}

function rateLabel(row) {
    if (!row) return 'unknown';
    const give = `${row.give_amount ?? '?'} ${row.give_tick || '?'}`;
    const coin = row.get_coin || '';
    const tick = row.get_tick || '';
    const amt = row.get_amount ?? '?';
    const payAsset = tick || coin || '?';
    return `${give} per ${amt} ${payAsset}`;
}

function pickAction(resp) {
    if (!resp) return null;
    if (resp.action) return resp.action;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    return resp;
}

function pickDispenser(resp) {
    if (!resp) return null;
    if (resp.dispenser) return resp.dispenser;
    if (resp.data && resp.data.dispenser) return resp.data.dispenser;
    // Many explorer endpoints flatten DISPENSER fields onto the action.
    if (resp.give_tick || resp.get_amount) return resp;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    return null;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}
