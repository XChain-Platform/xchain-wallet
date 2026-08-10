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
import { AddressText, Button, ChainBadge, ChainPicker, FeeSelector, Input, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { GatedPublishForm } from './GatedPublishForm.jsx';
import {
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { externalIndexOf } from '../addressSelection.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';

const chainRegistry = registryLib.defaultRegistry();

/**
 * PC-28 unified "Publish file" form, reachable from ActionsMenu (no
 * token context needed). One surface, an explicit publish-mode choice:
 *
 *   Public (default): a standalone FILE v0 upload - the general lane
 *     AttachContentForm's artwork flow specializes. No LINK leg; pairing
 *     a file to a token stays on the token's own Attach-artwork surface.
 *
 *   Encrypted & token-gated: routes into the PC-25 composition core
 *     (GatedPublishForm). The gate-tick picker lists only ticks this
 *     wallet currently OWNS, because the indexer rejects gated FILEs
 *     from anyone but the tick's issuer (FILE.md anti-spam rule).
 *
 * Size limits are encoding-aware (flows/fileSizeLimits.js): the ceiling
 * is the 8192-byte compiled ACTION push (consensus) minus this upload's
 * actual metadata overhead, computed live - not the old flat 7000-byte
 * guess. The PC-29 unlock-threshold field intentionally does NOT appear
 * here yet; it ships with PC-29 behind its flag-day activation height.
 *
 * Signers: software, HW (compose is HW-safe in both modes, §5), and
 * watcher (encode-only PSBT via the generic action.psbt route for the
 * public lane; GatedPublishForm has its own dedicated PSBT path).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function PublishFileForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const { isWatcherMode } = useWalletMode();

    const [mode, setMode] = useState(/** @type {'public' | 'gated'} */ ('public'));

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));

    const [fileMeta, setFileMeta] = useState(
        /** @type {{ name: string, type: string, bytes: Uint8Array } | null} */ (null),
    );
    const [title, setTitle] = useState('');
    const [memo, setMemo] = useState('');
    const [ackForever, setAckForever] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [stage, setStage] = useState(
        /** @type {'compose' | 'review' | 'submitting' | 'done'} */ ('compose'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [hwStatus, setHwStatus] = useState('idle');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Gated mode: ticks this wallet owns (issuer-only protocol rule).
    const [ownedTokens, setOwnedTokens] = useState(/** @type {any[] | null} */ (null));
    const [gatePick, setGatePick] = useState(
        /** @type {{ chainId: string, tick: string, ownerAddress: string } | null} */ (null),
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
                    setLoadError('No address on any chain yet. Use Receive to generate one first.');
                } else {
                    setChainId((prev) => prev || chains[0]);
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Owned-tick sweep for the gated picker, fetched lazily on first
    // switch to Encrypted mode (same aggregation MyTokens uses).
    useEffect(() => {
        if (mode !== 'gated' || ownedTokens !== null || !addressesByChain) return undefined;
        if (typeof messaging.getOwnedTokens !== 'function') { setOwnedTokens([]); return undefined; }
        let cancelled = false;
        const calls = [];
        for (const [cid, addrs] of Object.entries(addressesByChain)) {
            if (!Array.isArray(addrs)) continue;
            for (const a of addrs) {
                const address = typeof a?.address === 'string' ? a.address : null;
                if (!address) continue;
                calls.push(
                    messaging.getOwnedTokens({ chainId: cid, address })
                        .then((rows) => (Array.isArray(rows) ? rows : []).map((r) => ({
                            ...r, chainId: cid, ownerAddress: address,
                        })))
                        .catch(() => []),
                );
            }
        }
        if (calls.length === 0) { setOwnedTokens([]); return undefined; }
        Promise.all(calls).then((batches) => {
            if (cancelled) return;
            const seen = new Set();
            const merged = [];
            for (const batch of batches) {
                for (const row of batch) {
                    const key = `${row.chainId}:${row.tick}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    merged.push(row);
                }
            }
            merged.sort((a, b) => a.tick.localeCompare(b.tick));
            setOwnedTokens(merged);
        });
        return () => { cancelled = true; };
    }, [mode, ownedTokens, addressesByChain, messaging]);

    // Signing address on the picked chain: newest external HD address
    // (any funded address can publish a public FILE; same heuristic as
    // AttachContentForm's file leg).
    const fromAddress = useMemo(() => {
        if (!addressesByChain || !chainId) return null;
        const all = addressesByChain[chainId] || [];
        const hd = all.filter(
            (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
        );
        const pool = hd.length > 0 ? hd : all;
        if (pool.length === 0) return null;
        return [...pool].sort((a, b) => {
            const ai = (externalIndexOf(a.derivationPath) ?? -1);
            const bi = (externalIndexOf(b.derivationPath) ?? -1);
            return bi - ai;
        })[0];
    }, [addressesByChain, chainId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    // PC-51: native-coin protocol fee for the PUBLIC lane only (standalone
    // FILE is quotable; the gated lane composes a BATCH, which is fee-quote
    // DENIED, so GatedPublishForm has no toggle by design). : declared
    // after `descriptor` because the hook needs the chain to know whether the
    // native fee is an opt-in (BTC) or the only way to pay (LTC/DOGE).
    const nativeFee = useNativeFee(descriptor);
    // Same expression the NativeFeeToggle rows below render with; named here
    // so the submit catch can tell the user WHICH coin the refused fee was in.
    const coinTicker = descriptor
        ? ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' })[descriptor.coin] || ''
        : '';

    const hw = isHwSource(fromAddress);

    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => (chainId ? estimateNativeSendFeeTiers({ chainId, chainRegistry }) : null),
        [chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (chainId && feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom' ? feeCustomEstimate : (feeTiers ? feeTiers[feePick.mode] : null);
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // : can this publish actually ride a Taproot envelope? BOTH halves must
    // hold, and each rules out a different disaster.
    //
    // The SIGNER half (§6): a reveal that cannot be signed strands the commit, so
    // hardware and watch-only never qualify (flows/signerCapability.js).
    //
    // The CHAIN half: offering a 390 KB ceiling on a chain with no Taproot would
    // let the user pick a file the encoder cannot carry, and they would find out
    // at submit. `p2tr` in addressTypes is the descriptor's own statement that the
    // chain does Taproot: BTC yes, DOGE never (no segwit at all). LTC is
    // protocol-capable and armed at 3160000, but its descriptor still reserves
    // p2tr, so the wallet stays conservative there until that lands rather than
    // guessing ahead of the registry.
    const envelopeAvailable = Boolean(
        flowsLib.signerSupportsTapscript(fromAddress)
        && descriptor?.addressTypes?.includes('p2tr'),
    );

    // Encoding-aware ceiling for the CURRENT metadata (PC-28): exact,
    // not the old flat 7000-byte artwork guess. With the envelope available this
    // is the §4 per-encoding ceiling rather than the legacy compiled one.
    const publicCapFor = (name, type) => flowsLib.maxPublicFileBytes(
        { name, type, title, memo },
        envelopeAvailable ? { encoding: 'TAPROOT' } : {},
    );

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    function handlePickFile(event) {
        const file = event.target.files && event.target.files[0];
        setFormError(null);
        if (!file) return;
        const type = file.type || 'application/octet-stream';
        const cap = publicCapFor(file.name, type);
        if (file.size === 0) { setFormError('That file is empty.'); return; }
        if (file.size > cap) {
            setFileMeta(null);
            setFormError(
                `That file is ${file.size.toLocaleString()} bytes; with this metadata the `
                + `on-chain ceiling is ${cap.toLocaleString()} bytes.`,
            );
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const bytes = new Uint8Array(/** @type {ArrayBuffer} */ (reader.result));
            setFileMeta({ name: file.name || 'file', type, bytes });
        };
        reader.onerror = () => setFormError('Could not read that file.');
        reader.readAsArrayBuffer(file);
    }

    function handleReview(event) {
        event.preventDefault();
        if (!fileMeta) { setFormError('Pick a file first.'); return; }
        if (!fromAddress) { setFormError('No signing address available on this chain.'); return; }
        if ((title && /[|;]/.test(title)) || (memo && /[|;]/.test(memo)) || /[|;]/.test(fileMeta.name)) {
            setFormError('File name, title, and memo cannot contain | or ; characters.');
            return;
        }
        // Re-check with the FINAL metadata: a title/memo typed after the
        // pick shrinks the byte budget.
        const cap = publicCapFor(fileMeta.name, fileMeta.type);
        if (fileMeta.bytes.length > cap) {
            setFormError(
                `With this title/memo the on-chain ceiling is ${cap.toLocaleString()} bytes `
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
            // Latin-1 binary string; the encoder rebuilds the exact bytes
            // via Buffer.from(rawData, 'binary').
            let rawData = '';
            for (let i = 0; i < fileMeta.bytes.length; i += 1) {
                rawData += String.fromCharCode(fileMeta.bytes[i]);
            }
            const from = {
                address: fromAddress.address,
                publicKey: fromAddress.publicKey,
                derivationPath: fromAddress.derivationPath,
                addressId: fromAddress.id,
                source: fromAddress.source,
                signerId: fromAddress.signerId,
            };
            let r;
            if (isWatcherMode) {
                // Same params the signing path submits (flows/fileAction.js
                // fileActionParams), so the two compositions cannot drift.
                r = await messaging.buildActionPsbtRequest({
                    chainId,
                    from,
                    actionData: {
                        action: 'FILE',
                        params: flowsLib.fileActionParams({
                            name: fileMeta.name,
                            type: fileMeta.type,
                            title,
                            memo,
                        }),
                    },
                    encoderOpts: {
                        rawData,
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else {
                const base = {
                    walletId,
                    chainId,
                    from,
                    name: fileMeta.name,
                    type: fileMeta.type,
                    title: title.trim() || undefined,
                    memo: memo.trim() || undefined,
                    rawData,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    //  §6: opt in to size-aware selection, and ASSERT the signer's
                    // tapscript capability rather than letting AUTO assume it. AUTO only
                    // reaches for the envelope when that flag is true, so an unaffirmed
                    // signer stays on P2WSH instead of committing to a reveal it cannot
                    // produce. Only sent when the envelope is actually available, so
                    // nothing changes for chains or accounts that cannot use it.
                    ...(envelopeAvailable
                        ? { encoding: 'AUTO', options: flowsLib.encoderSignerOptions(fromAddress) }
                        : {}),
                };
                r = hw
                    ? await messaging.fileActionHw({ ...base, signerId: fromAddress.signerId })
                    : await messaging.fileAction({ ...base, password });
            }
            setResult(r);
            setPassword('');
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Publish failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    // Encrypted mode with a gate tick picked: hand the whole screen to
    // the PC-25 composition core (its own header, review, PSBT path).
    if (mode === 'gated' && gatePick) {
        return (
            <GatedPublishForm
                walletId={walletId}
                chainId={gatePick.chainId}
                tick={gatePick.tick}
                issuerAddress={gatePick.ownerAddress}
                onBack={() => setGatePick(null)}
            />
        );
    }

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back"
            title={stage === 'review' || stage === 'submitting' ? 'Review publish' : 'Publish file'}
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
    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        // The encoder REPORTS what compression did; the wallet must not infer it,
        // because with the default ON neither asking nor not asking tells you what
        // actually happened (§5.2 keeps the compressed form only when it is smaller).
        const storedLine = flowsLib.storedSizeLine(
            flowsLib.storedSizeSummary(result?.compression, fileMeta?.bytes?.length),
        );
        if (result?.psbtHex && !result?.txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={() => { setResult(null); setStage('compose'); }}
                    onDone={onBack}
                />,
            );
        }
        const txid = result?.txid || result?.broadcast?.txid || null;
        return wrap(
            <>
                <h2 className={styles.successTitle}>File published</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                {storedLine ? (
                    /*  §8: the size the user actually paid for. Compression is
                       on by default, so this is routinely a fraction of the file they
                       picked and there is no other way for them to find that out. */
                    <p className={styles.hint}>{storedLine}</p>
                ) : null}
                <p className={styles.hint}>
                    Once it confirms, the file lives on the chain permanently and
                    is readable by anyone. To make it a token's official artwork,
                    use Attach artwork on that token's manage page.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    Publish <strong>{fileMeta?.name}</strong> on-chain, readable by anyone.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>File</dt>
                    <dd className={styles.detailsValue}>
                        {fileMeta?.name} · {fileMeta?.bytes.length.toLocaleString()} bytes · {fileMeta?.type}
                    </dd>
                    {title.trim() ? (
                        <>
                            <dt className={styles.detailsLabel}>Title</dt>
                            <dd className={styles.detailsValue}>{title.trim()}</dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Publishing from</dt>
                    <dd className={styles.detailsValue}>
                        {fromAddress ? <AddressText address={fromAddress.address} /> : null}
                    </dd>
                </dl>
                <p className={styles.hint} role="note">
                    Permanent: the published bytes live on-chain forever and
                    cannot be deleted or edited later.
                </p>
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this builds an unsigned transaction to sign
                        on your Signer wallet.
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
                    <Button variant="secondary" type="button" onClick={() => setStage('compose')} disabled={stage === 'submitting'}>
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

    // stage === 'compose'
    const chainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);
    const capHint = publicCapFor(fileMeta?.name || 'file.bin', fileMeta?.type || 'application/octet-stream');

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <p className={styles.summary}>
                Store a file on the chain itself: publicly readable, or
                encrypted so only holders of your token can open it.
            </p>

            <div role="radiogroup" aria-label="Publish mode">
                <label className={styles.checkRow}>
                    <input
                        type="radio"
                        name="publish-mode"
                        value="public"
                        checked={mode === 'public'}
                        onChange={() => setMode('public')}
                    />
                    <span>
                        <strong>Public</strong>: anyone can read the file straight
                        from the chain.
                    </span>
                </label>
                <label className={styles.checkRow}>
                    <input
                        type="radio"
                        name="publish-mode"
                        value="gated"
                        checked={mode === 'gated'}
                        onChange={() => setMode('gated')}
                    />
                    <span>
                        <strong>Encrypted &amp; token-gated</strong>: the file is
                        encrypted; only holders of a token you own can unlock it.
                    </span>
                </label>
            </div>

            {mode === 'gated' ? (
                <div style={{ marginTop: 'var(--xc-space-3)' }}>
                    {ownedTokens === null ? (
                        <p className={styles.hint}>Looking up tokens you own…</p>
                    ) : ownedTokens.length === 0 ? (
                        <p className={styles.hint}>
                            This wallet doesn't own any tokens. Only a token's
                            owner can publish gated files against it (that's a
                            protocol rule, it stops strangers gating spam to your
                            token). Create a token first, then publish gated
                            content for its holders.
                        </p>
                    ) : (
                        <>
                            <p className={styles.hint}>
                                Pick the token whose holders can unlock the file:
                            </p>
                            <div role="list">
                                {ownedTokens.map((t) => {
                                    const d = chainRegistry.get(t.chainId);
                                    return (
                                        <button
                                            key={`${t.chainId}:${t.tick}`}
                                            type="button"
                                            role="listitem"
                                            className={styles.checkRow}
                                            style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 'var(--xc-space-2)', cursor: 'pointer' }}
                                            onClick={() => setGatePick({
                                                chainId: t.chainId,
                                                tick: t.tick,
                                                ownerAddress: t.ownerAddress,
                                            })}
                                        >
                                            <TickerIcon tick={t.tick} chainId={t.chainId} size={20} />
                                            <code>{t.tick}</code>
                                            {d ? <ChainBadge descriptor={d} size="sm" /> : t.chainId}
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            ) : (
                <>
                    <ChainPicker
                        label="Chain"
                        value={chainId}
                        onChange={setChainId}
                        chainIds={chainIds}
                        chainRegistry={chainRegistry}
                    />

                    <div style={{ margin: 'var(--xc-space-3) 0' }}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            onChange={handlePickFile}
                            style={{ display: 'none' }}
                            aria-label="Choose file to publish"
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            {fileMeta ? 'Choose a different file' : 'Choose a file'}
                        </Button>
                    </div>
                    {fileMeta ? (
                        <dl className={styles.detailsList}>
                            <dt className={styles.detailsLabel}>File</dt>
                            <dd className={styles.detailsValue}>{fileMeta.name}</dd>
                            <dt className={styles.detailsLabel}>Type</dt>
                            <dd className={styles.detailsValue}>{fileMeta.type}</dd>
                            <dt className={styles.detailsLabel}>Size</dt>
                            <dd className={styles.detailsValue}>{fileMeta.bytes.length.toLocaleString()} bytes</dd>
                        </dl>
                    ) : (
                        <p className={styles.hint}>
                            Up to about {capHint.toLocaleString()} bytes with the
                            current title and memo. The ceiling is exact per
                            upload: shorter names and titles leave a little more
                            room for the file itself.
                            {envelopeAvailable
                                ? ' This chain and account support the compact Taproot'
                                  + ' encoding, which is what makes the larger ceiling'
                                  + ' possible. Files are compressed automatically when'
                                  + ' that makes them smaller, so what lands on-chain is'
                                  + ' often well under the size shown here.'
                                : ' Files are compressed automatically when that makes'
                                  + ' them smaller, so what lands on-chain is often less'
                                  + ' than the file size.'}
                        </p>
                    )}

                    <Input
                        label="Title (optional)"
                        hint="A short label stored with the file."
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        autoComplete="off"
                        maxLength={100}
                    />
                    <Input
                        label="Memo (optional)"
                        hint="Protocol rejects | or ;."
                        value={memo}
                        onChange={(e) => setMemo(e.target.value)}
                        autoComplete="off"
                    />

                    <label className={styles.checkRow}>
                        <input
                            type="checkbox"
                            checked={ackForever}
                            onChange={(e) => setAckForever(e.target.checked)}
                        />
                        <span>
                            I understand the published bytes are on-chain forever
                            and cannot be deleted.
                        </span>
                    </label>

                    {feeTiers ? (
                        <FeeSelector
                            label="Network fee"
                            coinTicker={descriptor ? ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' })[descriptor.coin] || '' : ''}
                            tiers={feeTiers}
                            value={feePick}
                            onChange={setFeePick}
                            customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                        />
                    ) : null}
                    <NativeFeeToggle
                        {...nativeFee.toggleProps}
                        coinTicker={descriptor ? ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' })[descriptor.coin] || '' : ''}
                    />

                    {formError ? (
                        <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
                    ) : null}
                    <div className={styles.actions}>
                        <Button type="submit" variant="primary" disabled={!fileMeta || !fromAddress}>
                            Review publish
                        </Button>
                    </div>
                </>
            )}
        </form>,
    );
}
