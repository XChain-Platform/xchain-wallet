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
import { AddressText, Button, ChainBadge, ChainPicker, FeeSelector, Icon, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { humanizeError } from '../utils/humanizeError.js';
import styles from './IssueTokenForm.module.css';
import { externalIndexOf } from '../addressSelection.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';

const chainRegistry = registryLib.defaultRegistry();

// Protocol coin tickers for the LINK serialization. The chain
// descriptor's `coin` is long-form ('bitcoin' / 'litecoin' /
// 'dogecoin'); the LINK action serializes COIN1 / COIN2 as
// short-form tickers ('BTC' / 'LTC' / 'DOGE').
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Human-readable coin ticker for display in the Network fee row.
// Mirrors the keys used by the fee-estimate table.
const COIN_DISPLAY_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * §42.8.1 LINK creation: two-panel composer.
 *
 * Anchors a pair of existing actions across two chains. The form
 * builds a LINK action with `COIN1 / COIN1_ACTION_INDEX / COIN2 /
 * COIN2_ACTION_INDEX / MEMO` and submits it on whichever chain the
 * user picks (defaults to chain A, the first panel). The LINK
 * itself is a single on-chain action; both sides are still recorded
 * in the indexer's `links` table so the §23.5 cross-chain thread
 * rendering on History works regardless of which side the user
 * opens.
 *
 * Decoded preview: when the user types a valid action_index the
 * form fetches that side's ACTION via `messaging.getActionByIndex`
 * (debounced, cached per (chainId, actionIndex) pair) and renders
 * a one-line decoded summary so the user can confirm they're
 * linking the right pair before signing.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function LinkForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chain1Id, setChain1Id] = useState(/** @type {string | null} */ (null));
    const [chain2Id, setChain2Id] = useState(/** @type {string | null} */ (null));
    const [actionIndex1, setActionIndex1] = useState('');
    const [actionIndex2, setActionIndex2] = useState('');
    const [memo, setMemo] = useState('');
    const [submitOn, setSubmitOn] = useState(/** @type {'chain1' | 'chain2'} */ ('chain1'));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
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

    const [previewCache, setPreviewCache] = useState(
        /** @type {Record<string, { loading: boolean, action: any | null, error: string | null }>} */ ({}),
    );

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const chains = Object.entries(byChain || {})
                    .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                    .map(([cid]) => cid);
                if (chains.length === 0) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before creating a LINK.',
                    );
                    return;
                }
                setChain1Id(chains[0]);
                setChain2Id(chains[1] || chains[0]);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const submitChainId = submitOn === 'chain1' ? chain1Id : chain2Id;

    // The signing address must belong to the chain we're submitting
    // the LINK on. Reset fromAddressId when submitChainId changes.
    useEffect(() => {
        if (!addressesByChain || !submitChainId) {
            setFromAddressId(null);
            return;
        }
        const addrs = addressesByChain[submitChainId] || [];
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
    }, [submitChainId, addressesByChain]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !submitChainId) return null;
        return (addressesByChain[submitChainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, submitChainId, fromAddressId]);

    const descriptor1 = chain1Id ? chainRegistry.get(chain1Id) : null;
    const descriptor2 = chain2Id ? chainRegistry.get(chain2Id) : null;
    const ticker1 = descriptor1 ? PROTOCOL_COIN_TICKER[descriptor1.coin] || '' : '';
    const ticker2 = descriptor2 ? PROTOCOL_COIN_TICKER[descriptor2.coin] || '' : '';
    const hw = isHwSource(fromAddress);

    useEffect(() => {
        if (!chain1Id || !/^\d+$/.test(actionIndex1)) return;
        const key = `${chain1Id}:${actionIndex1}`;
        if (previewCache[key]) return;
        const t = setTimeout(() => {
            setPreviewCache((p) => ({ ...p, [key]: { loading: true, action: null, error: null } }));
            messaging.getActionByIndex({ chainId: chain1Id, actionIndex: actionIndex1 })
                .then((action) => {
                    setPreviewCache((p) => ({ ...p, [key]: { loading: false, action, error: null } }));
                })
                .catch((err) => {
                    setPreviewCache((p) => ({ ...p, [key]: { loading: false, action: null, error: err?.message || String(err) } }));
                });
        }, 350);
        return () => clearTimeout(t);
    }, [chain1Id, actionIndex1, messaging, previewCache]);

    useEffect(() => {
        if (!chain2Id || !/^\d+$/.test(actionIndex2)) return;
        const key = `${chain2Id}:${actionIndex2}`;
        if (previewCache[key]) return;
        const t = setTimeout(() => {
            setPreviewCache((p) => ({ ...p, [key]: { loading: true, action: null, error: null } }));
            messaging.getActionByIndex({ chainId: chain2Id, actionIndex: actionIndex2 })
                .then((action) => {
                    setPreviewCache((p) => ({ ...p, [key]: { loading: false, action, error: null } }));
                })
                .catch((err) => {
                    setPreviewCache((p) => ({ ...p, [key]: { loading: false, action: null, error: err?.message || String(err) } }));
                });
        }, 350);
        return () => clearTimeout(t);
    }, [chain2Id, actionIndex2, messaging, previewCache]);

    // Focus the password field when we land on the review stage so the
    // user can sign without reaching for the mouse.
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const validationError = useMemo(() => {
        if (!ticker1 || !ticker2) return null;
        if (!actionIndex1 || !actionIndex2) return null;
        if (!/^\d+$/.test(actionIndex1)) return 'The action number on chain A must be a whole number.';
        if (!/^\d+$/.test(actionIndex2)) return 'The action number on chain B must be a whole number.';
        if (ticker1 === ticker2 && actionIndex1 === actionIndex2) {
            return 'Cannot link an action to itself.';
        }
        return null;
    }, [ticker1, ticker2, actionIndex1, actionIndex2]);

    const { isWatcherMode } = useWalletMode();

    // Network fee: Low / Normal / Fast / Custom via FeeSelector on the
    // submit chain; feePerKb prices the broadcast.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId: submitChainId, chainRegistry }),
        [submitChainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId: submitChainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [submitChainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId: submitChainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // Derive the submit-chain coin ticker for the fee row display.
    const submitDescriptor = submitChainId ? chainRegistry.get(submitChainId) : null;
    const feeCoinTicker = submitDescriptor
        ? (COIN_DISPLAY_TICKER[submitDescriptor.coin] || submitDescriptor.coin)
        : null;

    // PC-51: native-coin protocol fee (LINK is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(submitDescriptor);

    // Form submit goes to the review stage, not directly to broadcast.
    // Runs the same guards that previously gated signing so nothing
    // reachable from the review screen is in an invalid state.
    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress || !submitChainId) return;
        if (!chain1Id || !chain2Id) return;
        if (validationError) return;
        if (!actionIndex1 || !actionIndex2) {
            setFormError('Provide both action indices before reviewing.');
            return;
        }
        setFormError(null);
        setStage('review');
    }

    // Sign and broadcast; only reachable from the review stage.
    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !submitChainId) return;
        if (!chain1Id || !chain2Id) return;
        if (validationError) return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;

        setStage('submitting');
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId: submitChainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                coin1: ticker1,
                coin1ActionIndex: actionIndex1,
                coin2: ticker2,
                coin2ActionIndex: actionIndex2,
                ...(memo.trim() ? { memo: memo.trim() } : {}),
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let r;
            if (isWatcherMode) {
                const linkParams = {
                    VERSION: '0',
                    COIN1: String(ticker1).toUpperCase(),
                    COIN1_ACTION_INDEX: actionIndex1,
                    COIN2: String(ticker2).toUpperCase(),
                    COIN2_ACTION_INDEX: actionIndex2,
                    MEMO: memo.trim() || '',
                };
                r = await messaging.buildActionPsbtRequest({
                    chainId: submitChainId,
                    from: base.from,
                    actionData: { action: 'LINK', params: linkParams },
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (hw) {
                r = await messaging.linkActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                r = await messaging.linkAction({ ...base, password });
            }
            setResult(r);
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                coinTicker: feeCoinTicker || '',
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

    const isReviewOrSubmitting = stage === 'review' || stage === 'submitting';
    const header = (
        <PageHeader
            onBack={onBack}
            title={isReviewOrSubmitting ? 'Review link' : 'Link two actions across chains'}
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
        return wrap(
            <>
                <p className={styles.successTitle}>LINK broadcast</p>
                {result?.txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction</p>
                        <code className={styles.txid}>{result.txid}</code>
                    </>
                ) : null}
                <p className={styles.hint}>
                    Once mined, both sides will thread together in History.
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

    // Review + submitting: show a summary dl, the decoded sub-action
    // previews, credentials, and the sign button. No form fields are
    // editable here; the user goes back to the form stage to change anything.
    if (stage === 'review' || stage === 'submitting') {
        const preview1Key = chain1Id && /^\d+$/.test(actionIndex1) ? `${chain1Id}:${actionIndex1}` : null;
        const preview2Key = chain2Id && /^\d+$/.test(actionIndex2) ? `${chain2Id}:${actionIndex2}` : null;
        const preview1 = preview1Key ? previewCache[preview1Key] : null;
        const preview2 = preview2Key ? previewCache[preview2Key] : null;

        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Link {ticker1} #{actionIndex1} to {ticker2} #{actionIndex2}
                    {memo.trim() ? `, memo: "${memo.trim()}"` : ''}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {submitDescriptor
                            ? <ChainBadge descriptor={submitDescriptor} size="sm" />
                            : submitChainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Linking</dt>
                    <dd className={styles.detailsValue}>
                        {ticker1} #{actionIndex1} {'↔'} {ticker2} #{actionIndex2}
                    </dd>
                    <dt className={styles.detailsLabel}>Side A decoded</dt>
                    <dd className={styles.detailsValue} style={{ fontSize: 'var(--xc-text-xs)', color: 'var(--xc-text-muted)' }}>
                        {preview1?.loading
                            ? 'Loading…'
                            : preview1?.error
                                ? humanizeError(preview1.error, 'load that action').message
                                : preview1?.action
                                    ? decodePreview(preview1.action)
                                    : '(preview not loaded)'}
                    </dd>
                    <dt className={styles.detailsLabel}>Side B decoded</dt>
                    <dd className={styles.detailsValue} style={{ fontSize: 'var(--xc-text-xs)', color: 'var(--xc-text-muted)' }}>
                        {preview2?.loading
                            ? 'Loading…'
                            : preview2?.error
                                ? humanizeError(preview2.error, 'load that action').message
                                : preview2?.action
                                    ? decodePreview(preview2.action)
                                    : '(preview not loaded)'}
                    </dd>
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate && feeCoinTicker
                            ? `${feeEstimate.coinAmount} ${feeCoinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    </dd>
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
                        chainId={submitChainId}
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
                    <p role="alert" style={{ margin: '0.25rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                        {submitError}
                    </p>
                ) : null}

                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={stage === 'submitting'}
                        onClick={() => setStage('form')}
                    >
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={isWatcherMode
                            ? false
                            : hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : hw
                                ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : 'Sign LINK'}
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
                <SidePanel
                    title="Chain A"
                    chainIds={chainIds}
                    chainId={chain1Id}
                    onChainChange={setChain1Id}
                    actionIndex={actionIndex1}
                    onActionIndexChange={setActionIndex1}
                    previewCache={previewCache}
                />
                <SidePanel
                    title="Chain B"
                    chainIds={chainIds}
                    chainId={chain2Id}
                    onChainChange={setChain2Id}
                    actionIndex={actionIndex2}
                    onActionIndexChange={setActionIndex2}
                    previewCache={previewCache}
                />
            </div>

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />

            <div role="group" aria-label="Submit LINK on" className={styles.checkRow}>
                <span style={{ marginRight: 'var(--xc-space-2)' }}>Submit LINK on:</span>
                <label className={styles.checkRow}>
                    <input
                        type="radio"
                        name="submitOn"
                        value="chain1"
                        checked={submitOn === 'chain1'}
                        onChange={() => setSubmitOn('chain1')}
                    />
                    <span>{descriptor1?.displayName || 'Chain A'}</span>
                </label>
                <label className={styles.checkRow}>
                    <input
                        type="radio"
                        name="submitOn"
                        value="chain2"
                        checked={submitOn === 'chain2'}
                        onChange={() => setSubmitOn('chain2')}
                        disabled={!chain2Id || chain2Id === chain1Id}
                    />
                    <span>{descriptor2?.displayName || 'Chain B'}</span>
                </label>
            </div>

            {validationError ? (
                <StatusMessage variant="error" className={styles.error}>
                    {validationError}
                </StatusMessage>
            ) : null}

            {fromAddress && submitChainId ? (
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Submit on</dt>
                    <dd className={styles.detailsValue}>
                        {chainRegistry.get(submitChainId)
                            ? <ChainBadge descriptor={chainRegistry.get(submitChainId)} size="sm" />
                            : submitChainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Pair</dt>
                    <dd className={styles.detailsValue}>
                        {ticker1} #{actionIndex1 || '?'}
                        {' ↔ '}
                        {ticker2} #{actionIndex2 || '?'}
                    </dd>
                </dl>
            ) : null}

            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={feeCoinTicker || ''}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={feeCoinTicker || ''} />

            {formError ? (
                <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!!validationError
                        || !fromAddress
                        || !actionIndex1 || !actionIndex2}
                >
                    Review
                </Button>
            </div>
        </form>,
    );
}

/** One side of the two-panel composer. */
function SidePanel({ title, chainIds, chainId, onChainChange, actionIndex, onActionIndexChange, previewCache }) {
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const previewKey = chainId && /^\d+$/.test(actionIndex)
        ? `${chainId}:${actionIndex}`
        : null;
    const preview = previewKey ? previewCache[previewKey] : null;

    return (
        <fieldset style={{
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
            padding: 'var(--xc-space-3)',
            margin: 0,
            background: 'var(--xc-bg-muted)',
        }}>
            <legend style={{ fontWeight: 600, padding: '0 var(--xc-space-2)' }}>
                {title}
            </legend>

            <ChainPicker
                label="Chain"
                value={chainId}
                onChange={onChainChange}
                chainIds={chainIds}
                chainRegistry={chainRegistry}
            />

            <Input
                label="Action to reference"
                hint="The number shown next to the action on the explorer."
                value={actionIndex}
                onChange={(e) => onActionIndexChange(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="e.g. 12345"
            />

            <div style={{
                marginTop: 'var(--xc-space-2)',
                fontSize: 'var(--xc-text-xs)',
                color: 'var(--xc-text-muted)',
                minHeight: '1.5rem',
            }}>
                {actionIndex && !/^\d+$/.test(actionIndex)
                    ? 'This must be a whole number.'
                    : preview?.loading
                        ? 'Looking up that action…'
                        : preview?.error
                            ? humanizeError(preview.error, 'load that action').message
                            : preview?.action
                                ? `Preview: ${decodePreview(preview.action)}`
                                : descriptor && actionIndex
                                    ? 'Enter the action number from the explorer to see a preview…'
                                    : ''}
            </div>
        </fieldset>
    );
}

function decodePreview(action) {
    if (!action) return '(empty)';
    const a = action.action || action.ACTION;
    if (!a) return JSON.stringify(action).slice(0, 80);
    // Show the humanized action label, never the raw all-caps opcode.
    const label = actionDisplayLabel(a);
    if (a === 'ISSUE') {
        const t = action.tick || action.TICK;
        const amt = action.amount || action.AMOUNT;
        return `${label} ${t || ''}${amt ? ` (${amt})` : ''}`.trim();
    }
    if (a === 'SEND') {
        const t = action.tick || action.TICK;
        const amt = action.amount || action.AMOUNT;
        return `${label} ${amt || ''} ${t || ''}`.trim();
    }
    if (a === 'BROADCAST') {
        const txt = action.text || action.TEXT || action.message;
        return txt ? `${label} "${String(txt).slice(0, 40)}"` : label;
    }
    return label;
}
