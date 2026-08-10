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
import { AddressText, Button, ChainBadge, FeeSelector, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, decoder as decoderLib, airdrop as airdropLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { externalIndexOf } from '../addressSelection.js';
import { extractActionIndex } from '../utils/actionIndexFromTx.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';

const chainRegistry = registryLib.defaultRegistry();
const POLL_INTERVAL_MS = 10_000;

// PC-10 fork-repoint rail (spec §3): the three consumer classes that
// actually have (or will have) an edit action capable of repointing at
// a new list index. AIRDROP isn't here: an airdrop is a one-shot
// distribution against whatever list existed when it was signed, so
// there's nothing on an already-broadcast airdrop to repoint.
const REPOINT_TARGETS = [
    { id: 'issue-lists', label: 'Token allow/block lists', pcItem: 'PC-04', built: false },
    { id: 'dispenser-lists', label: 'Dispenser allow/block lists', pcItem: 'PC-19', built: false },
    { id: 'order-lists', label: 'Order allow/block lists', pcItem: 'PC-17', built: false },
];

/**
 * PC-10 "Fork & edit" (LIST v1): clone an existing list with ADD and/or
 * REMOVE deltas. Each v1 action produces a brand-new list index; the
 * protocol has no in-place edit (LIST.md), so this is always a fork,
 * never a mutation of the old index.
 *
 * The protocol only lets one v1 action carry ONE edit direction
 * (EDIT=1 add, or EDIT=2 remove; LIST.md's format is
 * VERSION|EDIT|LIST_ACTION_INDEX|ITEM, singular EDIT). A fork that
 * both adds and removes members is therefore two chained v1
 * transactions: an ADD forking the OLD index, then a REMOVE forking
 * the ADD's newly-assigned index. That inter-tx dependency needs the
 * same index-wait AirdropForm uses between its LIST and AIRDROP legs,
 * so it gets the same treatment: no crash-safe resume (mirrors
 * ProjectRosterForm's choice - the first tx is already on-chain if the
 * wallet closes mid-flow; finish the second leg later from My Lists),
 * and watcher mode is blocked only for the two-leg case, since a
 * watcher wallet can't observe the first leg landing on-chain to build
 * the second.
 *
 * Ends on a "now referenced by" step (§3): the OLD index keeps working
 * everywhere it's referenced (gates, dispensers, orders), so forking
 * never repoints anything by itself. That step lists the consumer
 * classes capable of repointing and deep-links to each one's edit
 * surface where it exists; today none of PC-04/17/19 ship that surface
 * yet (verified at HEAD), so every row renders disabled ("coming
 * soon") rather than a broken link. Whether or not the user visits any
 * of them, the warning that the old list stays live is unconditional:
 * there's no way for the wallet to know whether every consumer has
 * been repointed, so it can't promise otherwise.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {{ chainId: string, actionIndex: string, type: '1' | '2', items: string[] }} props.listRef
 * @param {() => void} props.onBack
 * @param {() => void} props.onDone
 */
export function ListForkForm({ walletId, listRef, onBack, onDone }) {
    const { chainId, actionIndex: oldIndex, type: listType, items: currentItems } = listRef;
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const isTick = String(listType) === '1';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    // Membership editor: every current item starts "kept" (checked); an
    // unchecked item is a REMOVE. New items typed/pasted below are ADDs.
    const [keep, setKeep] = useState(() => new Set(currentItems));
    const [addText, setAddText] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review-1' | 'wait-index' | 'review-2' | 'repoint'} */ ('compose'),
    );
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [tx1Txid, setTx1Txid] = useState(/** @type {string | null} */ (null));
    const [intermediateIndex, setIntermediateIndex] = useState(/** @type {string | null} */ (null));
    const [tx2Txid, setTx2Txid] = useState(/** @type {string | null} */ (null));
    const [waitElapsed, setWaitElapsed] = useState(0);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                if (!(byChain?.[chainId] || []).length) {
                    setLoadError('No address on this chain yet. Use Receive to generate one first.');
                }
            })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.'); });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        if (stage === 'review-1' || stage === 'review-2') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // Wait-index polling between the ADD and REMOVE legs (only reached
    // when both are needed): same shape as AirdropForm / ProjectRosterForm.
    useEffect(() => {
        if (stage !== 'wait-index' || !tx1Txid) return undefined;
        let cancelled = false;
        const started = Date.now();
        const tick = async () => {
            if (cancelled) return;
            setWaitElapsed(Math.floor((Date.now() - started) / 1000));
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getActionByTxid({ chainId, txid: tx1Txid });
                if (cancelled) return;
                const idx = extractActionIndex(resp);
                if (idx) {
                    setIntermediateIndex(idx);
                    setStage('review-2');
                }
            } catch (err) {
                // Keep polling through transient network errors.
            }
        };
        tick();
        const handle = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, tx1Txid, chainId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    useEffect(() => {
        if (!addressesByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        const hd = all.filter((a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null);
        const pool = hd.length > 0 ? hd : all;
        if (pool.length > 0) {
            const sorted = [...pool].sort((a, b) => {
                const ai = (externalIndexOf(a.derivationPath) ?? -1);
                const bi = (externalIndexOf(b.derivationPath) ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        }
    }, [addressesByChain, chainId, fromAddressId]);

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();

    const coinTicker = descriptor ? { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (LIST is quotable; both fork
    // legs are LIST creates so the opt-in rides both). Authoritative price
    // check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
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

    // New items to add: same paste parsing as ListCreateForm/AirdropForm
    // for addresses, or the ProjectRosterForm-style tick split for ticks.
    // Anything already on the list is dropped (it's a member either way).
    const toAdd = useMemo(() => {
        const currentSet = new Set(currentItems);
        if (isTick) {
            const seen = new Set();
            const out = [];
            for (const raw of addText.split(/[\n,]+/)) {
                const t = raw.trim().toUpperCase();
                if (!t || seen.has(t) || currentSet.has(t)) continue;
                seen.add(t);
                out.push(t);
            }
            return out;
        }
        // : validate additions against the chain this fork is published
        // to, not just against address shape, so a wrong-network paste cannot
        // ride into the new list and be dropped by the indexer afterwards.
        const parts = airdropLib.parsePaste(addText);
        const { valid } = airdropLib.classifyRecipients(parts, {
            coin: descriptor?.coin || null,
            network: descriptor?.networkKind || null,
        });
        return valid.filter((a) => !currentSet.has(a));
    }, [addText, currentItems, isTick, descriptor?.coin, descriptor?.networkKind]);

    const toRemove = useMemo(
        () => currentItems.filter((i) => !keep.has(i)),
        [currentItems, keep],
    );

    const needsAdd = toAdd.length > 0;
    const needsRemove = toRemove.length > 0;
    const twoPhase = needsAdd && needsRemove;

    function toggleKeep(item) {
        setKeep((prev) => {
            const next = new Set(prev);
            if (next.has(item)) next.delete(item); else next.add(item);
            return next;
        });
    }

    const firstParams = useMemo(() => ({
        VERSION: '1',
        EDIT: needsAdd ? '1' : '2',
        LIST_ACTION_INDEX: String(oldIndex),
        ITEM: needsAdd ? toAdd : toRemove,
    }), [needsAdd, toAdd, toRemove, oldIndex]);

    const secondParams = useMemo(() => ({
        VERSION: '1',
        EDIT: '2',
        LIST_ACTION_INDEX: intermediateIndex || '',
        ITEM: toRemove,
    }), [intermediateIndex, toRemove]);

    const firstDecoded = useMemo(() => (
        stage === 'review-1' || stage === 'wait-index'
            ? decoderLib.decodeAction({ action: 'LIST', params: firstParams, chainId: chainId || undefined, chainRegistry })
            : null
    ), [stage, firstParams, chainId]);

    const secondDecoded = useMemo(() => (
        stage === 'review-2'
            ? decoderLib.decodeAction({ action: 'LIST', params: secondParams, chainId: chainId || undefined, chainRegistry })
            : null
    ), [stage, secondParams, chainId]);

    function sourceDescriptor() {
        return {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
    }

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) { setFormError('No signing address available on this chain.'); return; }
        if (!needsAdd && !needsRemove) {
            setFormError('Nothing changed: add or remove at least one item.');
            return;
        }
        setFormError(null);
        setStage('review-1');
    }

    async function handleSignFirst(event) {
        event.preventDefault();
        if (submitting) return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const from = sourceDescriptor();
            const base = { walletId, chainId, from, params: firstParams, payFeeInNativeCoin: nativeFee.flag, ...(feePerKb != null ? { feePerKb } : {}) };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from,
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                    actionData: { action: 'LIST', params: firstParams },
                });
            } else {
                res = hw
                    ? await messaging.createListHw({ ...base, signerId: fromAddress.signerId })
                    : await messaging.createList({ ...base, password });
            }
            const txid = res?.txid || res?.broadcast?.txid;
            if (isWatcherMode) {
                // A watcher wallet can only build this leg unsigned; the
                // two-leg fork's index-wait needs a Full-mode wallet to
                // finish, same limitation as Airdrop/ProjectRoster.
                setSubmitError(null);
                setTx1Txid(null);
                setStage('repoint');
                setPassword('');
                return;
            }
            if (!txid) throw new Error('List fork broadcast did not return a txid.');
            setTx1Txid(txid);
            setPassword('');
            setStage(twoPhase ? 'wait-index' : 'repoint');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'List fork broadcast failed.',
            }));
            if (!hw && !isWatcherMode) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleSignSecond(event) {
        event.preventDefault();
        if (submitting || !intermediateIndex) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const from = sourceDescriptor();
            const base = { walletId, chainId, from, params: secondParams, payFeeInNativeCoin: nativeFee.flag, ...(feePerKb != null ? { feePerKb } : {}) };
            const res = hw
                ? await messaging.createListHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.createList({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('List fork broadcast did not return a txid.');
            setTx2Txid(txid);
            setPassword('');
            setStage('repoint');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'List fork broadcast failed.',
            }));
            if (!hw) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        } finally {
            setSubmitting(false);
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review-1' ? 'Review add/remove'
                : stage === 'wait-index' ? 'Waiting for fork to be indexed'
                    : stage === 'review-2' ? 'Review remove'
                        : stage === 'repoint' ? 'Fork published'
                            : 'Fork & edit list'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    if (!addressesByChain) return wrap(<p className={styles.hint}>Loading…</p>);

    if (stage === 'repoint') {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Fork submitted</h2>
                {tx1Txid ? (
                    <>
                        <p className={styles.successLabel}>{needsAdd && !twoPhase ? 'Fork transaction' : 'First transaction (add)'}</p>
                        <code className={styles.txid}>{tx1Txid}</code>
                    </>
                ) : null}
                {tx2Txid ? (
                    <>
                        <p className={styles.successLabel}>Second transaction (remove)</p>
                        <code className={styles.txid}>{tx2Txid}</code>
                    </>
                ) : null}
                <p className={styles.hint}>
                    This fork gets a brand-new list index once indexed (check My
                    Lists to find it). List #{oldIndex} itself is unchanged and
                    keeps working exactly as before.
                </p>

                <h3 className={styles.successLabel}>Now referenced by</h3>
                <p className={styles.hint}>
                    Every gate, dispenser, and order that references list
                    #{oldIndex} keeps using that index until someone repoints it
                    at the new fork. Repoint from each consumer's own edit
                    surface as it ships:
                </p>
                <ul className={styles.detailsList} style={{ display: 'block' }}>
                    {REPOINT_TARGETS.map((t) => (
                        <li key={t.id} style={{ padding: '4px 0' }}>
                            <Button type="button" variant="ghost" disabled={!t.built}>
                                {t.label} {t.built ? '' : `(coming soon, ${t.pcItem})`}
                            </Button>
                        </li>
                    ))}
                </ul>
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        List #{oldIndex} stays live everywhere it is referenced
                        until you repoint each consumer by hand. The wallet has
                        no way to confirm whether that has happened, so this
                        warning shows regardless of what you do next.
                    </p>
                </div>

                <div className={styles.actions}>
                    <Button variant="primary" onClick={onDone}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'wait-index') {
        const minutes = Math.floor(waitElapsed / 60);
        const slow = minutes >= 5;
        return wrap(
            <>
                <p className={styles.summary}>{firstDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>First transaction</dt>
                    <dd className={styles.detailsValue}><code className={styles.txid}>{tx1Txid}</code></dd>
                    <dt className={styles.detailsLabel}>Elapsed</dt>
                    <dd className={styles.detailsValue}>{minutes > 0 ? `${minutes} min ${waitElapsed % 60}s` : `${waitElapsed}s`}</dd>
                </dl>
                <p className={styles.hint}>
                    Waiting for the add-transaction to be indexed so the
                    remove-transaction can reference its new list index. Safe to
                    close the wallet; the add is already on-chain, and you can
                    finish the remove step later from My Lists.
                </p>
                {slow ? (
                    <p className={styles.hint}>This is taking longer than usual. Typical wait is 1-2 block confirmations.</p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack}>Close (keep waiting)</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review-2' && fromAddress) {
        return wrap(
            <form onSubmit={handleSignSecond} noValidate>
                <p className={styles.summary}>{secondDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <dt className={styles.detailsLabel}>Forking list</dt>
                    <dd className={styles.detailsValue}>#{intermediateIndex}</dd>
                    <dt className={styles.detailsLabel}>Removing</dt>
                    <dd className={styles.detailsValue}>{toRemove.length} item{toRemove.length === 1 ? '' : 's'}</dd>
                </dl>
                <SignCredentials
                    unlocked={signerReady}
                    fromAddress={fromAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
                    onStatusChange={onHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={submitError}
                    disabled={submitting}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (<StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {hw ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}` : 'Publish remove'}
                    </Button>
                </div>
            </form>,
        );
    }

    if (stage === 'review-1' && fromAddress) {
        if (isWatcherMode && twoPhase) {
            return wrap(
                <>
                    <h2 className={styles.successTitle}>Not available in watcher mode</h2>
                    <p className={styles.hint}>
                        Adding and removing in the same fork is two chained
                        transactions: the wallet has to see the add land on-chain
                        before it can build the remove. A watcher-mode wallet
                        can't observe that, so this combination can't be split
                        across an air-gapped boundary today.
                    </p>
                    <p className={styles.hint}>
                        Switch to a Full-mode wallet, or fork with only an add or
                        only a remove (each of those is a single transaction and
                        works fine in watcher mode).
                    </p>
                    <div className={styles.actions}>
                        <Button variant="primary" onClick={() => setStage('compose')}>Back</Button>
                    </div>
                </>,
            );
        }
        return wrap(
            <form onSubmit={handleSignFirst} noValidate>
                <p className={styles.summary}>{firstDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <dt className={styles.detailsLabel}>Forking list</dt>
                    <dd className={styles.detailsValue}>#{oldIndex}</dd>
                    <dt className={styles.detailsLabel}>{needsAdd ? 'Adding' : 'Removing'}</dt>
                    <dd className={styles.detailsValue}>{(needsAdd ? toAdd : toRemove).length} item{(needsAdd ? toAdd : toRemove).length === 1 ? '' : 's'}</dd>
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}` : 'Estimate unavailable'}
                    </dd>
                </dl>
                {twoPhase ? (
                    <p className={styles.hint}>
                        This fork both adds and removes items, so it's two
                        transactions: this add first, then a remove once the add
                        is indexed. {hw ? 'You will confirm on your hardware device twice.' : 'You will enter your password twice.'}
                    </p>
                ) : null}
                {isWatcherMode ? (
                    <p className={styles.hint}>Watcher mode: this wallet will build an unsigned transaction. Sign it on your Signer-mode wallet, then broadcast from a Full-mode wallet.</p>
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
                        disabled={submitting}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                {(isWatcherMode || hw) && submitError ? (<StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>) : null}
                <div className={styles.actions}>
                    <Button type="button" variant="ghost" onClick={() => setStage('compose')} disabled={submitting}>Back</Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={isWatcherMode ? false : hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {isWatcherMode ? 'Create unsigned transaction' : hw ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}` : (needsAdd ? 'Publish add' : 'Publish remove')}
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'compose'
    return wrap(
        <form onSubmit={handleReview} noValidate>
            <p className={styles.summary}>
                Forking {isTick ? 'token' : 'address'} list #{oldIndex}
                {' '}({currentItems.length} current member{currentItems.length === 1 ? '' : 's'}).
                This publishes a new list at a new index; #{oldIndex} itself never changes.
            </p>

            {currentItems.length > 0 ? (
                <>
                    <span className={styles.fromLabel}>Current members (uncheck to remove)</span>
                    <ul className={styles.detailsList} style={{ display: 'block', maxHeight: '260px', overflowY: 'auto' }}>
                        {currentItems.map((item) => (
                            <li key={item} style={{ padding: '2px 0' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={keep.has(item)} onChange={() => toggleKeep(item)} />
                                    <code>{item}</code>
                                </label>
                            </li>
                        ))}
                    </ul>
                </>
            ) : (
                <p className={styles.hint}>This list currently has no members.</p>
            )}

            <label className={styles.pickerLabel} htmlFor="fork-add-items">
                Add {isTick ? 'tokens' : 'addresses'} (one per line)
            </label>
            <textarea
                id="fork-add-items"
                className={styles.picker}
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                rows={6}
                spellCheck={false}
                autoCapitalize={isTick ? 'characters' : 'none'}
                autoCorrect="off"
            />
            <p className={styles.hint}>
                {toAdd.length} to add · {toRemove.length} to remove
                {toRemove.length + toAdd.length === 0 ? ' (no changes yet)' : ''}
            </p>
            {!isTick ? (
                <p className={styles.hint}>
                    Added addresses become permanent public on-chain data once
                    the fork is published, the same as creating a new list.
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

            {formError ? (<StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>) : null}
            <div className={styles.actions}>
                <Button type="submit" variant="primary" block disabled={!needsAdd && !needsRemove}>
                    Review
                </Button>
            </div>
        </form>,
    );
}
