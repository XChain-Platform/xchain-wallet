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
import { AddressText, Button, ChainBadge, FeeSelector, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import {
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * PC-25 gated-content publisher (Token_Gated_Content.md). Owner-only
 * surface launched from ManageToken: encrypts a file client-side
 * (AES-256-GCM under a fresh or reused pack key K), then publishes
 * ONE atomic transaction, BATCH(FILE with GATE_TICKER/KEY_HASH,
 * MESSAGE v2 to self carrying ECIES(0x01||K)), so the ciphertext
 * never exists on-chain without its key. K is persisted in this
 * wallet's vault before anything broadcasts (flows/gatedPublishAction).
 *
 * Signer coverage (§5): compose is HW-safe (ECIES needs only the
 * issuer's pubkey) and watcher mode gets the encode-only PSBT path.
 * Only unlock/scan are software-signer-only, and they live in the
 * separate unlock surface, not here.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick               gate ticker (canonical uppercase)
 * @param {string | null} [props.issuerAddress]  the token's current owner; publishing from any other address is indexer-rejected
 * @param {() => void} props.onBack
 */
export function GatedPublishForm({ walletId, chainId, tick, issuerAddress = null, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { isWatcherMode } = useWalletMode();
    const descriptor = chainRegistry.get(chainId);
    const coinTicker = descriptor ? ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' })[descriptor.coin] || '' : '';

    // Metadata-free floor; the real encoding-aware ceiling is computed
    // per pick/review below once the file and signing address are known
    // (PC-28, flows/fileSizeLimits.js).
    const MAX_BYTES_FLOOR = flowsLib.MAX_GATED_PLAINTEXT_BYTES;

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fileMeta, setFileMeta] = useState(
        /** @type {{ name: string, type: string, bytes: Uint8Array } | null} */ (null),
    );
    const [title, setTitle] = useState('');
    const [memo, setMemo] = useState('');
    const [packs, setPacks] = useState(/** @type {any[]} */ ([]));
    const [packChoice, setPackChoice] = useState('new');
    // PC-29 unlock threshold (GATE_MIN_AMOUNT). The field only renders
    // once the extension is ACTIVE on this chain: scheduled height from
    // the flows activation map (null everywhere until the train
    // is assembled, so the pre-train fast path costs nothing), then the
    // live indexer watermark decides. The flow re-checks activation at
    // compose time either way.
    const [gateMinAmount, setGateMinAmount] = useState('');
    const [thresholdActive, setThresholdActive] = useState(false);
    const thresholdScheduledHeight = typeof flowsLib.gateMinAmountScheduledHeight === 'function'
        ? flowsLib.gateMinAmountScheduledHeight(chainId)
        : null;
    useEffect(() => {
        setThresholdActive(false);
        if (thresholdScheduledHeight === null) return undefined;
        if (typeof messaging.getIndexerWatermark !== 'function') return undefined;
        let cancelled = false;
        messaging.getIndexerWatermark({ chainId })
            .then((r) => {
                if (cancelled) return;
                const h = Number(r?.watermark);
                setThresholdActive(Number.isFinite(h) && h >= thresholdScheduledHeight);
            })
            .catch(() => { /* stays inactive; the flow gate is authoritative */ });
        return () => { cancelled = true; };
    }, [chainId, thresholdScheduledHeight, messaging]);
    const [ackForever, setAckForever] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [hwStatus, setHwStatus] = useState('idle');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => { if (!cancelled) setAddressesByChain(byChain); })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.'); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Reusable packs = pack keys this wallet's vault holds for this tick.
    // (Metadata only; the raw key never leaves the background context.)
    useEffect(() => {
        if (typeof messaging.listGatedKeys !== 'function') return undefined;
        let cancelled = false;
        messaging.listGatedKeys({ walletId, chainId, gateTicker: tick })
            .then((rows) => { if (!cancelled) setPacks(Array.isArray(rows) ? rows : []); })
            .catch(() => { /* pack reuse is optional; New pack still works */ });
        return () => { cancelled = true; };
    }, [walletId, chainId, tick, messaging]);

    // Signing address: the token owner's address on this chain. Publishing
    // from anything else is rejected by the indexer's owner rule, so if the
    // owner's key isn't in this wallet we block rather than compose a
    // guaranteed-invalid transaction.
    const fromAddress = useMemo(() => {
        if (!addressesByChain) return null;
        const onChain = addressesByChain[chainId] || [];
        if (issuerAddress) return onChain.find((a) => a.address === issuerAddress) || null;
        return onChain[0] || null;
    }, [addressesByChain, chainId, issuerAddress]);
    const ownerMissing = !!(addressesByChain && issuerAddress && !fromAddress);
    const hw = isHwSource(fromAddress);

    // Network fee: same Low/Normal/Fast/Custom row as AttachContentForm.
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
    const feeEstimate = feePick.mode === 'custom' ? feeCustomEstimate : (feeTiers ? feeTiers[feePick.mode] : null);
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    // Encoding-aware ceiling for the CURRENT metadata: exact once the
    // signing address is known, the conservative floor until then.
    const plainCapFor = (name, type) => (fromAddress
        ? flowsLib.maxGatedPlaintextBytes({
            name,
            type,
            title,
            memo,
            gateTicker: tick,
            coin: coinTicker,
            address: fromAddress.address,
            gateMinAmount: thresholdActive && gateMinAmount.trim() ? gateMinAmount.trim() : null,
        })
        : MAX_BYTES_FLOOR);

    function handlePickFile(event) {
        const file = event.target.files && event.target.files[0];
        setFormError(null);
        if (!file) return;
        const cap = plainCapFor(file.name, file.type || 'application/octet-stream');
        if (file.size > cap) {
            setFileMeta(null);
            setFormError(`That file is ${file.size.toLocaleString()} bytes; this publish lane supports up to ${cap.toLocaleString()}.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const bytes = new Uint8Array(/** @type {ArrayBuffer} */ (reader.result));
            setFileMeta({
                name: file.name,
                type: file.type || 'application/octet-stream',
                bytes,
            });
        };
        reader.onerror = () => setFormError('Could not read that file.');
        reader.readAsArrayBuffer(file);
    }

    function handleReview(event) {
        event.preventDefault();
        if (!fileMeta) { setFormError('Pick a file first.'); return; }
        if (!fromAddress) {
            setFormError(ownerMissing
                ? `This wallet does not hold the owner address for ${tick}; only the token owner can publish gated files.`
                : 'No signing address available on this chain.');
            return;
        }
        if ((title && /[|;]/.test(title)) || (memo && /[|;]/.test(memo)) || /[|;]/.test(fileMeta.name)) {
            setFormError('File name, title, and memo cannot contain | or ; characters.');
            return;
        }
        if (thresholdActive && gateMinAmount.trim()
            && (!/^\d+(\.\d+)?$/.test(gateMinAmount.trim()) || Number(gateMinAmount.trim()) <= 0)) {
            setFormError('The unlock threshold must be a positive amount (or leave it blank for no threshold).');
            return;
        }
        // Re-check the ceiling with the FINAL metadata: title/memo typed
        // after the pick shrink the budget, and the flow enforces the
        // same computed cap at compose time.
        const reviewCap = plainCapFor(fileMeta.name, fileMeta.type);
        if (fileMeta.bytes.length > reviewCap) {
            setFormError(
                `With this title/memo the on-chain ceiling is ${reviewCap.toLocaleString()} bytes `
                + `and the file is ${fileMeta.bytes.length.toLocaleString()}. Shorten the title or memo.`,
            );
            return;
        }
        if (!ackForever) {
            setFormError('Confirm you understand the publish is permanent.');
            return;
        }
        setFormError(null);
        setSubmitError(null);
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!fileMeta || !fromAddress || stage === 'submitting') return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        try {
            // Latin-1 binary string; the flow rebuilds the exact bytes via
            // Buffer.from(plainData, 'binary') before encrypting.
            let plainData = '';
            for (let i = 0; i < fileMeta.bytes.length; i += 1) {
                plainData += String.fromCharCode(fileMeta.bytes[i]);
            }
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
                gateTicker: tick,
                name: fileMeta.name,
                type: fileMeta.type,
                title: title.trim() || undefined,
                memo: memo.trim() || undefined,
                plainData,
                ...(packChoice !== 'new' ? { existingKeyHash: packChoice } : {}),
                ...(thresholdActive && gateMinAmount.trim()
                    ? { gateMinAmount: gateMinAmount.trim() }
                    : {}),
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildGatedPublishPsbtRequest(base);
            } else if (hw) {
                r = await messaging.gatedPublishActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                r = await messaging.gatedPublishAction({ ...base, password });
            }
            setResult(r);
            setPassword('');
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || 'Publish failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review gated publish' : `Gated content · ${tick}`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    }

    if (stage === 'done') {
        if (result?.psbtHex && !result?.txid) {
            return wrap(
                <>
                    <WatcherResultPanel
                        result={result}
                        onBuildAnother={() => { setResult(null); setStage('form'); }}
                        onDone={onBack}
                    />
                    <p className={styles.hint}>
                        The pack key is saved in this wallet. Sign the transaction on
                        your Signer wallet, then broadcast it from a Full-mode wallet.
                    </p>
                </>,
            );
        }
        return wrap(
            <>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Encrypted file published</p>
                {result?.txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>Transaction: <code>{result.txid}</code></p>
                ) : null}
                {result?.keyHash ? (
                    <p style={{ margin: '0 0 0.5rem', overflowWrap: 'anywhere' }}>
                        Pack key hash: <code>{result.keyHash}</code>
                    </p>
                ) : null}
                <p className={styles.hint}>
                    The decryption key is stored in this wallet and recorded
                    on-chain encrypted to your own address. Anyone who receives
                    {' '}{tick} through a normal send gets the key automatically.
                    To add more files that unlock together, publish again and
                    pick this pack.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const packLabel = packChoice === 'new'
            ? 'New pack (fresh key)'
            : `Existing pack ${packChoice.slice(0, 12)}…`;
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Publish <strong>{fileMeta?.name}</strong> encrypted; only holders
                    of {tick} will be able to read it.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>Gate token</dt>
                    <dd className={styles.detailsValue}><code>{tick}</code></dd>
                    <dt className={styles.detailsLabel}>File</dt>
                    <dd className={styles.detailsValue}>
                        {fileMeta?.name} · {fileMeta?.bytes.length.toLocaleString()} bytes · {fileMeta?.type}
                    </dd>
                    <dt className={styles.detailsLabel}>Pack</dt>
                    <dd className={styles.detailsValue}>{packLabel}</dd>
                    {thresholdActive && gateMinAmount.trim() ? (
                        <>
                            <dt className={styles.detailsLabel}>Unlock threshold</dt>
                            <dd className={styles.detailsValue}>
                                hold ≥ {gateMinAmount.trim()} {tick} to receive the key
                            </dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Publishing from</dt>
                    <dd className={styles.detailsValue}>
                        {fromAddress ? <AddressText address={fromAddress.address} /> : null}
                    </dd>
                </dl>
                <p className={styles.hint} role="note">
                    Permanent: the encrypted bytes live on-chain forever and the
                    gate cannot be removed later, only the key re-shared. One
                    transaction publishes the file and records your recovery
                    copy of the key; there is no key-less window.
                </p>

                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this builds an unsigned transaction. The pack
                        key stays in THIS wallet either way.
                    </p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
                        onStatusChange={({ status }) => setHwStatus(status)}
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
                    <Button variant="secondary" type="button" onClick={() => setStage('form')} disabled={stage === 'submitting'}>
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
                                : 'Sign and publish'}
                    </Button>
                </div>
            </form>,
        );
    }

    // Form stage.
    return wrap(
        <form onSubmit={handleReview} noValidate>
            <p className={styles.hint}>
                Publish a file that only holders of <strong>{tick}</strong> can
                read. The file is encrypted before it touches the chain; the key
                travels automatically with every normal send of the token.
            </p>

            {ownerMissing ? (
                <StatusMessage variant="error" className={styles.error}>
                    This wallet does not hold the owner address
                    (<AddressText address={issuerAddress} />) for {tick}. Only the
                    token owner can publish gated files.
                </StatusMessage>
            ) : null}

            <label className={styles.pickerLabel}>
                File (up to about {plainCapFor(fileMeta?.name || 'file.bin', fileMeta?.type || 'application/octet-stream').toLocaleString()} bytes)
                <input type="file" aria-label="File to publish" onChange={handlePickFile} disabled={ownerMissing} />
            </label>
            {fileMeta ? (
                <p className={styles.hint}>
                    {fileMeta.name} · {fileMeta.bytes.length.toLocaleString()} bytes · {fileMeta.type}
                </p>
            ) : null}

            <label className={styles.pickerLabel}>
                Title (optional)
                <input
                    type="text"
                    aria-label="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    disabled={ownerMissing}
                />
            </label>
            <label className={styles.pickerLabel}>
                Memo (optional)
                <input
                    type="text"
                    aria-label="Memo"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    maxLength={120}
                    disabled={ownerMissing}
                />
            </label>

            {thresholdActive ? (
                <label className={styles.pickerLabel}>
                    Unlock threshold (optional)
                    <input
                        type="text"
                        inputMode="decimal"
                        aria-label="Unlock threshold"
                        placeholder="No threshold"
                        value={gateMinAmount}
                        onChange={(e) => setGateMinAmount(e.target.value)}
                        disabled={ownerMissing}
                    />
                    <span className={styles.hint}>
                        Holders need at least this many {tick} after a send to
                        receive the unlock key. This is a first-access lock, not
                        copy protection: anyone who ever got the key keeps it,
                        even if they later hold less.
                    </span>
                </label>
            ) : null}

            <fieldset style={{ border: 0, padding: 0, margin: "0 0 var(--xc-space-3)" }} disabled={ownerMissing}>
                <legend>Pack</legend>
                <label className={styles.checkRow}>
                    <input
                        type="radio"
                        name="pack"
                        checked={packChoice === 'new'}
                        onChange={() => setPackChoice('new')}
                    />
                    {' '}New pack (fresh key)
                </label>
                {packs.map((p) => (
                    <label key={p.keyHash} className={styles.checkRow}>
                        <input
                            type="radio"
                            name="pack"
                            checked={packChoice === p.keyHash}
                            onChange={() => setPackChoice(p.keyHash)}
                        />
                        {' '}Add to pack <code>{String(p.keyHash).slice(0, 12)}…</code>
                        {' '}(files in this pack unlock together)
                    </label>
                ))}
                {packs.length === 0 ? (
                    <p className={styles.hint}>
                        No reusable packs in this wallet yet. Files published under
                        one pack share a single key and unlock together.
                    </p>
                ) : null}
            </fieldset>

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

            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={ackForever}
                    onChange={(e) => setAckForever(e.target.checked)}
                    disabled={ownerMissing}
                />
                {' '}I understand the encrypted file is published on-chain forever
                and the gate cannot be removed later.
            </label>

            {formError ? <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage> : null}

            <div className={styles.actions}>
                <Button type="submit" variant="primary" disabled={ownerMissing || !fileMeta}>
                    Review
                </Button>
            </div>
        </form>,
    );
}
