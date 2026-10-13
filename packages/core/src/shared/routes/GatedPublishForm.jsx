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
import { AddressText, Button, ChainBadge, FeeSelector, FormPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
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
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { imagePreviewDataUrl, publishFileType } from '../utils/publishingFile.js';
import styles from './IssueTokenForm.module.css';
import { t } from '../../i18n/index.js';

const chainRegistry = registryLib.defaultRegistry();

/**
 * PC-25 gated-content publisher (Token_Gated_Content.md). Owner-only
 * surface launched from ManageToken: encrypts a file client-side
 * (AES-256-GCM under a fresh or reused pack key K), then publishes
 * ONE atomic transaction, BATCH(FILE with GATE_TICKER/KEY_HASH,
 * MESSAGE v2 to self carrying ECIES(0x01||K)), so the ciphertext
 * never exists on-chain without its key. K is persisted in this
 * wallet's vault after the transaction broadcasts (flows/gatedPublishAction).
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
    const [packs, setPacks] = useState(/** @type {any[] | null} */ (null));
    const [packsError, setPacksError] = useState(/** @type {string | null} */ (null));
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
    const fileReadIdRef = useRef(0);

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
        setPacks(null);
        setPacksError(null);
        if (typeof messaging.listGatedKeys !== 'function') { setPacks([]); return undefined; }
        let cancelled = false;
        messaging.listGatedKeys({ walletId, chainId, gateTicker: tick })
            .then((rows) => { if (!cancelled) setPacks(Array.isArray(rows) ? rows : []); })
            .catch(() => {
                if (cancelled) return;
                setPacks([]);
                setPacksError('Could not load reusable packs. You can still publish with a new pack.');
            });
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
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'gatedPublishAction',
        hardware: 'gatedPublishActionHw',
    });

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
        const readId = ++fileReadIdRef.current;
        setFileMeta(null);
        const { type, error: typeError } = publishFileType(file);
        if (typeError) { setFormError(typeError); return; }
        const cap = plainCapFor(file.name, type);
        if (file.size === 0) {
            setFormError('That file is empty.');
            return;
        }
        if (file.size > cap) {
            setFileMeta(null);
            setFormError(`That file is ${file.size.toLocaleString()} bytes; this publish lane supports up to ${cap.toLocaleString()}.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            if (readId !== fileReadIdRef.current) return;
            if (!(reader.result instanceof ArrayBuffer)) {
                setFormError('Could not read that file.');
                return;
            }
            const bytes = new Uint8Array(reader.result);
            if (bytes.length === 0) { setFormError('That file is empty.'); return; }
            if (bytes.length > cap) {
                setFormError(`That file is ${bytes.length.toLocaleString()} bytes; this publish lane supports up to ${cap.toLocaleString()}.`);
                return;
            }
            setFileMeta({
                name: file.name || 'file',
                type,
                bytes,
            });
        };
        reader.onerror = () => {
            if (readId === fileReadIdRef.current) setFormError('Could not read that file.');
        };
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

    function publishRequest() {
        // Latin-1 binary string; the flow rebuilds the exact bytes via
        // Buffer.from(plainData, 'binary') before encrypting.
        let plainData = '';
        for (let i = 0; i < fileMeta.bytes.length; i += 1) {
            plainData += String.fromCharCode(fileMeta.bytes[i]);
        }
        return {
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
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!fileMeta || !fromAddress || stage === 'submitting') return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const base = publishRequest();
            let r;
            if (isWatcherMode) {
                r = await messaging.buildGatedPublishPsbtRequest(base);
            } else {
                r = await actionConfirm.run({
                    chainId,
                    from: base.from,
                    compose: () => messaging.composeGatedPublishForConfirm(base),
                    onApprove: (prebuiltPsbt, composed) => submitConfirmed({
                        ...base,
                        prebuiltPsbt,
                        prebuiltActionData: composed.gatedPublish.actionData,
                        prebuiltKeyHash: composed.gatedPublish.keyHash,
                        prebuiltCiphertextLength: composed.gatedPublish.ciphertextLength,
                    }),
                });
            }
            setResult(r);
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) { setStage('review'); return; }
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || 'Publish failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setPassword('');
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting'
                ? t('gatedPublish.review.title')
                : t('gatedPublish.title', { tick })}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    }

    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? t('send.networkFeeValue', {
                        amount: feeEstimate.coinAmount,
                        ticker: coinTicker,
                    }).trim()
                    : undefined}
                coinTicker={coinTicker}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={({ status }) => setHwStatus(status)}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
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
                        {t('gatedPublish.watcherSavedKey')}
                    </p>
                </>,
            );
        }
        if (result?.queued) {
            return wrap(
                <QueuedResultPanel onDone={onBack} what={t('gatedPublish.queuedWhat')} unsaved={result.unsaved} />,
            );
        }
        return wrap(
            <>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{t('gatedPublish.success')}</p>
                {result?.txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>{t('gatedPublish.transaction')} <code>{result.txid}</code></p>
                ) : null}
                {result?.keyHash ? (
                    <p style={{ margin: '0 0 0.5rem', overflowWrap: 'anywhere' }}>
                        {t('gatedPublish.packKeyHash')} <code>{result.keyHash}</code>
                    </p>
                ) : null}
                <p className={styles.hint}>
                    {t('gatedPublish.successHint.beforeToken')} {tick}{' '}
                    {t('gatedPublish.successHint.afterToken')}
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>{t('common.done')}</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const packLabel = packChoice === 'new'
            ? t('gatedPublish.pack.new')
            : t('gatedPublish.pack.existing', { hash: packChoice.slice(0, 12) });
        const reviewPreviewUrl = imagePreviewDataUrl(fileMeta?.bytes);
        return wrap(
            <FormPage
                label={t('gatedPublish.review.title')}
                onSubmit={handleSubmit}
                noValidate
                status={(isWatcherMode || hw) && submitError ? (
                    <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <>
                        <Button variant="secondary" type="button" onClick={() => setStage('form')} disabled={stage === 'submitting'}>
                            {t('common.back')}
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
                                ? t('send.review.createUnsigned')
                                : hw
                                    ? t('send.review.signOn', { device: fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger' })
                                    : t('gatedPublish.signAndPublish')}
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary}>
                    {t('gatedPublish.review.summary.beforeFile')} <strong>{fileMeta?.name}</strong>{' '}
                    {t('gatedPublish.review.summary.afterFile', { tick })}
                </p>
                {reviewPreviewUrl ? (
                    <img
                        src={reviewPreviewUrl}
                        alt={t('gatedPublish.previewAlt', { file: fileMeta?.name || t('gatedPublish.file') })}
                        width={160}
                        height={160}
                        loading="lazy"
                        decoding="async"
                        style={{ maxWidth: 160, maxHeight: 160, objectFit: 'contain', borderRadius: 8, display: 'block', margin: '0 auto var(--xc-space-3)' }}
                    />
                ) : null}
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>{t('send.fields.chain')}</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>{t('gatedPublish.gateToken')}</dt>
                    <dd className={styles.detailsValue}><code>{tick}</code></dd>
                    <dt className={styles.detailsLabel}>{t('gatedPublish.file')}</dt>
                    <dd className={styles.detailsValue}>
                        {t('gatedPublish.fileMetadata', {
                            name: fileMeta?.name,
                            bytes: fileMeta?.bytes.length.toLocaleString(),
                            type: fileMeta?.type,
                        })}
                    </dd>
                    <dt className={styles.detailsLabel}>{t('gatedPublish.pack')}</dt>
                    <dd className={styles.detailsValue}>{packLabel}</dd>
                    {thresholdActive && gateMinAmount.trim() ? (
                        <>
                            <dt className={styles.detailsLabel}>{t('gatedPublish.unlockThreshold')}</dt>
                            <dd className={styles.detailsValue}>
                                {t('gatedPublish.thresholdReview', {
                                    amount: gateMinAmount.trim(),
                                    tick,
                                })}
                            </dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>{t('gatedPublish.publishingFrom')}</dt>
                    <dd className={styles.detailsValue}>
                        {fromAddress ? <AddressText address={fromAddress.address} /> : null}
                    </dd>
                </dl>
                <p className={styles.hint} role="note">
                    {t('gatedPublish.permanentHint')}
                </p>

                {isWatcherMode ? (
                    <p className={styles.hint}>
                        {t('gatedPublish.watcherHint')}
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
            </FormPage>,
        );
    }

    // Form stage.
    const previewUrl = imagePreviewDataUrl(fileMeta?.bytes);
    return wrap(
        <FormPage
            label={t('gatedPublish.gatedContent')}
            onSubmit={handleReview}
            noValidate
            status={formError ? <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage> : null}
            actions={(
                <Button type="submit" variant="primary">
                    {t('common.review')}
                </Button>
            )}
        >
            <p className={styles.hint}>
                {t('gatedPublish.formHint.beforeToken')} <strong>{tick}</strong>{' '}
                {t('gatedPublish.formHint.afterToken')}
            </p>

            {ownerMissing ? (
                <StatusMessage variant="error" className={styles.error}>
                    {t('gatedPublish.ownerMissing.beforeAddress')}
                    {' '}(<AddressText address={issuerAddress} />){' '}
                    {t('gatedPublish.ownerMissing.afterAddress', { tick })}
                </StatusMessage>
            ) : null}

            <label className={styles.pickerLabel}>
                {t('gatedPublish.fileLimit', {
                    bytes: plainCapFor(fileMeta?.name || `file${'.bin'}`, fileMeta?.type || 'application/octet-stream').toLocaleString(),
                })}
                <input type="file" aria-label={t('gatedPublish.fileToPublish')} onChange={handlePickFile} disabled={ownerMissing} />
            </label>
            {fileMeta ? (
                <>
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            alt={t('gatedPublish.previewAlt', { file: fileMeta.name })}
                            width={160}
                            height={160}
                            loading="lazy"
                            decoding="async"
                            style={{ maxWidth: 160, maxHeight: 160, objectFit: 'contain', borderRadius: 8, display: 'block', margin: 'var(--xc-space-3) auto' }}
                        />
                    ) : null}
                    <p className={styles.hint}>
                        {t('gatedPublish.fileMetadata', {
                            name: fileMeta.name,
                            bytes: fileMeta.bytes.length.toLocaleString(),
                            type: fileMeta.type,
                        })}
                    </p>
                </>
            ) : null}

            <label className={styles.pickerLabel}>
                {t('gatedPublish.titleOptional')}
                <input
                    type="text"
                    enterKeyHint="next"
                    aria-label={t('gatedPublish.titleField')}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    disabled={ownerMissing}
                />
            </label>
            <label className={styles.pickerLabel}>
                {t('gatedPublish.memoOptional')}
                <input
                    type="text"
                    enterKeyHint={thresholdActive ? 'next' : 'go'}
                    aria-label={t('send.memo')}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    maxLength={120}
                    disabled={ownerMissing}
                />
            </label>

            {thresholdActive ? (
                <label className={styles.pickerLabel}>
                    {t('gatedPublish.unlockThresholdOptional')}
                    <input
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="go"
                        aria-label={t('gatedPublish.unlockThreshold')}
                        placeholder={t('gatedPublish.noThreshold')}
                        value={gateMinAmount}
                        onChange={(e) => setGateMinAmount(e.target.value)}
                        disabled={ownerMissing}
                        aria-describedby="gated-publish-threshold-hint"
                    />
                    <span id="gated-publish-threshold-hint" className={styles.hint}>
                        {t('gatedPublish.thresholdHint', { tick })}
                    </span>
                </label>
            ) : null}

            <fieldset style={{ border: 0, padding: 0, margin: "0 0 var(--xc-space-3)" }} disabled={ownerMissing}>
                <legend>{t('gatedPublish.pack')}</legend>
                <label className={styles.checkRow}>
                    <input
                        type="radio"
                        name="pack"
                        checked={packChoice === 'new'}
                        onChange={() => setPackChoice('new')}
                    />
                    {' '}{t('gatedPublish.pack.new')}
                </label>
                {(packs || []).map((p) => (
                    <label key={p.keyHash} className={styles.checkRow}>
                        <input
                            type="radio"
                            name="pack"
                            checked={packChoice === p.keyHash}
                            onChange={() => setPackChoice(p.keyHash)}
                        />
                        {' '}{t('gatedPublish.pack.add')} <code>{String(p.keyHash).slice(0, 12)}…</code>
                        {' '}{t('gatedPublish.pack.unlockTogether')}
                    </label>
                ))}
                {packs === null ? (
                    <p className={styles.hint}>{t('gatedPublish.pack.loading')}</p>
                ) : packsError ? (
                    <StatusMessage variant="error" className={styles.error}>{packsError}</StatusMessage>
                ) : packs.length === 0 ? (
                    <p className={styles.hint}>
                        {t('gatedPublish.pack.empty')}
                    </p>
                ) : null}
            </fieldset>

            {feeTiers ? (
                <FeeSelector
                    label={t('send.networkFee')}
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
                {' '}{t('gatedPublish.ackForever')}
            </label>

        </FormPage>,
    );
}
