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
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { normalizeGenesisRow } from './ManageToken.jsx';
import { FeeSelector } from '@xchain-wallet/core/ui';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { externalIndexOf } from '../addressSelection.js';
import { extractActionIndex } from '../utils/actionIndexFromTx.js';

const chainRegistry = registryLib.defaultRegistry();
const POLL_INTERVAL_MS = 10_000;

// The decoder drops any transaction whose compiled ACTION push exceeds
// 8192 bytes (MAX_ACTION_DATA_LENGTH), and the action string + script
// overhead eat into that budget. Cap the raw file below the ceiling so
// the encoder doesn't reject it after the user has already signed
// nothing; fail early, in the picker.
const MAX_FILE_BYTES = 7000;

// Protocol coin tickers for the LINK serialization (same map as
// LinkForm; the descriptor's `coin` is long-form).
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Attach artwork to a token (the NFT content-attachment pattern,
 * NFT_Standard.md): upload the artwork as an on-chain FILE, then
 * LINK it to the token's original ISSUE. The indexer only honours a
 * LINK signed by the token's current owner, which is what makes the
 * attachment official.
 *
 * Two sequential signs with an indexing wait between them (the LINK
 * needs the FILE's ACTION_INDEX), so this is a bespoke stage machine
 * mirroring AirdropForm's LIST → wait-index → AIRDROP shape:
 *
 *   compose:      pick the file, optional title
 *   review-file:  confirm + sign the FILE upload
 *   wait-index:   poll the explorer for the FILE's ACTION_INDEX
 *   review-link:  confirm + sign the LINK (owner-validated)
 *   done:         both txids shown
 *
 * Unlike AirdropForm there is no crash-safe resume record: if the
 * wallet closes mid-flow the FILE is already on-chain and the user
 * can finish the pairing manually via the LINK form (Actions → Link).
 * The wait-index screen says exactly that.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId          chain the token lives on
 * @param {string} props.tick             canonical ticker (uppercase)
 * @param {string | null} [props.issuerAddress]   the token's current owner (preferred signing address)
 * @param {() => void} props.onBack
 */
export function AttachContentForm({ walletId, chainId, tick, issuerAddress = null, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    // The token's ISSUE action index (the LINK's second leg). Fetched
    // from the same genesis endpoint ManageToken renders.
    const [issueActionIndex, setIssueActionIndex] = useState(/** @type {string | null} */ (null));
    const [genesisChecked, setGenesisChecked] = useState(false);

    // Picked file. `bytes` is a Uint8Array; the flow converts it to a
    // Latin-1 binary string at submit time.
    const [fileMeta, setFileMeta] = useState(
        /** @type {{ name: string, type: string, bytes: Uint8Array } | null} */ (null),
    );
    const [title, setTitle] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review-file' | 'wait-index' | 'review-link' | 'review-tis' | 'wait-tis' | 'review-desc' | 'done'} */
        ('compose'),
    );
    // Optional continuation: also author the token's information document
    // on-chain (TIS On-Chain Format) and point DESCRIPTION at it. Two
    // more signatures (FILE for the JSON doc, then an ISSUE v1 update).
    const [setAsTokenInfo, setSetAsTokenInfo] = useState(false);
    const [tisTxid, setTisTxid] = useState(/** @type {string | null} */ (null));
    const [tisActionIndex, setTisActionIndex] = useState(/** @type {string | null} */ (null));
    const [descTxid, setDescTxid] = useState(/** @type {string | null} */ (null));
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [fileTxid, setFileTxid] = useState(/** @type {string | null} */ (null));
    const [fileActionIndex, setFileActionIndex] = useState(/** @type {string | null} */ (null));
    const [linkTxid, setLinkTxid] = useState(/** @type {string | null} */ (null));
    const [waitElapsed, setWaitElapsed] = useState(0);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                if (!byChain || !(byChain[chainId] || []).length) {
                    setLoadError('No address on this chain yet. Use Receive to generate one first.');
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        if (typeof messaging?.getGenesisForToken !== 'function') { setGenesisChecked(true); return undefined; }
        let cancelled = false;
        messaging.getGenesisForToken({ chainId, tick })
            .then((row) => {
                if (cancelled) return;
                const info = normalizeGenesisRow(row);
                if (info?.actionIndex) setIssueActionIndex(String(info.actionIndex));
                setGenesisChecked(true);
            })
            .catch(() => { if (!cancelled) setGenesisChecked(true); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);

    // Signing address: the token's owner when the wallet holds it
    // (the LINK is only honoured from the owner), else the newest
    // external HD address so the FILE leg still works.
    useEffect(() => {
        if (!addressesByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        if (issuerAddress) {
            const match = all.find((a) => a.address === issuerAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const hd = all.filter(
            (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
        );
        const pool = hd.length > 0 ? hd : all;
        if (pool.length > 0) {
            const sorted = [...pool].sort((a, b) => {
                const ai = (externalIndexOf(a.derivationPath) ?? -1);
                const bi = (externalIndexOf(b.derivationPath) ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        }
    }, [addressesByChain, chainId, fromAddressId, issuerAddress]);

    useEffect(() => {
        if (stage === 'review-file' || stage === 'review-link'
            || stage === 'review-tis' || stage === 'review-desc') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    useEffect(() => {
        if (stage !== 'wait-index' || !fileTxid) return undefined;
        let cancelled = false;
        const started = Date.now();
        const tick_ = async () => {
            if (cancelled) return;
            setWaitElapsed(Math.floor((Date.now() - started) / 1000));
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getActionByTxid({ chainId, txid: fileTxid });
                if (cancelled) return;
                const idx = extractActionIndex(resp);
                if (idx) {
                    setFileActionIndex(idx);
                    setStage('review-link');
                }
            } catch (err) {
                // Keep polling through transient network errors.
            }
        };
        tick_();
        const handle = setInterval(tick_, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, fileTxid, chainId, messaging]);

    // Second wait: the TIS document FILE's action index, needed by the
    // ISSUE v1 description update.
    useEffect(() => {
        if (stage !== 'wait-tis' || !tisTxid) return undefined;
        let cancelled = false;
        const started = Date.now();
        const tick_ = async () => {
            if (cancelled) return;
            setWaitElapsed(Math.floor((Date.now() - started) / 1000));
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getActionByTxid({ chainId, txid: tisTxid });
                if (cancelled) return;
                const idx = extractActionIndex(resp);
                if (idx) {
                    setTisActionIndex(idx);
                    setStage('review-desc');
                }
            } catch (err) {
                // Keep polling through transient network errors.
            }
        };
        tick_();
        const handle = setInterval(tick_, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, tisTxid, chainId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] || '' : '';

    // PC-51: native-coin protocol fee; every leg this form signs
    // (FILE artwork, LINK, FILE token-info, ISSUE v1 describe) is quotable,
    // so the one opt-in rides all of them. Authoritative price check runs
    // at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices every broadcast in this multi-step flow (file / link / TIS / edit).
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

    // Owner mismatch: the LINK leg will be recorded but not honoured
    // unless it's signed by the token's current owner.
    const ownerMismatch = !!(issuerAddress && fromAddress && fromAddress.address !== issuerAddress);

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();

    // Thumbnail for image files; small enough (≤7 KB) that a data
    // URL is fine.
    const previewUrl = useMemo(() => {
        if (!fileMeta || !/^image\//.test(fileMeta.type)) return null;
        let binary = '';
        for (let i = 0; i < fileMeta.bytes.length; i += 1) {
            binary += String.fromCharCode(fileMeta.bytes[i]);
        }
        try {
            return `data:${fileMeta.type};base64,${btoa(binary)}`;
        } catch {
            return null;
        }
    }, [fileMeta]);

    const acceptFile = useCallback((file, content) => {
        const bytes = new Uint8Array(content);
        if (bytes.length === 0) {
            setFormError('That file is empty.');
            return;
        }
        if (bytes.length > MAX_FILE_BYTES) {
            setFormError(
                `That file is ${(bytes.length / 1024).toFixed(1)} KB. Files stored on-chain must stay under about ${Math.floor(MAX_FILE_BYTES / 1024)} KB. For larger artwork, put an image URL in the token's description instead.`,
            );
            return;
        }
        setFormError(null);
        setFileMeta({
            name: file.name || 'file',
            type: file.type || 'application/octet-stream',
            bytes,
        });
    }, []);

    const handleFilePick = useCallback((event) => {
        const file = event.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) acceptFile(file, reader.result);
        };
        reader.readAsArrayBuffer(file);
    }, [acceptFile]);

    const drop = useDropZone({
        readAs: 'arrayBuffer',
        maxBytes: MAX_FILE_BYTES * 4,
        onError: (msg) => setFormError(msg),
        onFile: ({ file, content }) => {
            if (content instanceof ArrayBuffer) acceptFile(file, content);
        },
    });

    function handleReviewFile(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No signing address available on this chain.');
            return;
        }
        if (!fileMeta) {
            setFormError('Pick a file first.');
            return;
        }
        if (!issueActionIndex) {
            setFormError(
                genesisChecked
                    ? `The creation record for ${tick} isn't indexed yet. Try again in a minute.`
                    : 'Still looking up the token\'s creation record. One moment.',
            );
            return;
        }
        if ((title && /[|;]/.test(title)) || (memo && /[|;]/.test(memo))) {
            setFormError('Title and memo cannot contain | or ; characters.');
            return;
        }
        setFormError(null);
        setStage('review-file');
    }

    async function handleSignFile(event) {
        event.preventDefault();
        if (submitting || !fileMeta) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            // Latin-1 binary string; the encoder rebuilds the exact
            // bytes via Buffer.from(rawData, 'binary').
            let rawData = '';
            for (let i = 0; i < fileMeta.bytes.length; i += 1) {
                rawData += String.fromCharCode(fileMeta.bytes[i]);
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
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
                name: fileMeta.name,
                type: fileMeta.type,
                title: title.trim() || undefined,
                memo: memo.trim() || undefined,
                rawData,
            };
            const res = hw
                ? await messaging.fileActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.fileAction({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('Broadcast did not return a transaction id.');
            setFileTxid(txid);
            setPassword('');
            setStage('wait-index');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'File upload failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleSignLink(event) {
        event.preventDefault();
        if (submitting || !fileActionIndex || !issueActionIndex) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
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
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
                coin1: coinTicker,
                coin1ActionIndex: fileActionIndex,
                coin2: coinTicker,
                coin2ActionIndex: issueActionIndex,
            };
            const res = hw
                ? await messaging.linkActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.linkAction({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('LINK broadcast did not return a txid.');
            setLinkTxid(txid);
            setPassword('');
            setStage(setAsTokenInfo ? 'review-tis' : 'done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'LINK broadcast failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    // The token's information document: minimal TIS JSON (same shape as
    // sdk.nft.tisDocument; Token_Information_Standard.md On-Chain Format):
    // NFT intent + the artwork referenced by its on-chain action index.
    const tisJson = useMemo(() => {
        if (!fileMeta || !fileActionIndex) return null;
        const doc = {
            tick: String(tick).toUpperCase(),
            categories: [{ type: 'main', data: 'NFT' }],
            images: [{
                data_ref: 'action:' + String(fileActionIndex),
                type: fileMeta.type,
                name: fileMeta.name,
            }],
        };
        if (title.trim()) doc.name = title.trim();
        return JSON.stringify(doc);
    }, [fileMeta, fileActionIndex, tick, title]);

    async function handleSignTis(event) {
        event.preventDefault();
        if (submitting || !tisJson) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            // JSON.stringify output may contain non-ASCII (title); encode
            // to UTF-8 bytes first, then to the Latin-1 binary string the
            // encoder expects.
            const utf8 = new TextEncoder().encode(tisJson);
            let rawData = '';
            for (let i = 0; i < utf8.length; i += 1) {
                rawData += String.fromCharCode(utf8[i]);
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
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
                name: String(tick).toUpperCase() + '.json',
                type: 'application/json',
                title: 'Token information',
                rawData,
            };
            const res = hw
                ? await messaging.fileActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.fileAction({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('Token-info upload did not return a txid.');
            setTisTxid(txid);
            setPassword('');
            setStage('wait-tis');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Token-info upload failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleSignDescribe(event) {
        event.preventDefault();
        if (submitting || !tisActionIndex) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
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
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
                // ISSUE v1: edit description (owner-only at the indexer).
                params: {
                    VERSION: '1',
                    TICK: String(tick).toUpperCase(),
                    DESCRIPTION: 'action:' + String(tisActionIndex),
                },
            };
            const res = hw
                ? await messaging.issueTokenHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.issueToken({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('Description update did not return a txid.');
            setDescTxid(txid);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Description update failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back"
            title={`Attach artwork to ${tick}`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (isWatcherMode) {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Not available in watcher mode</h2>
                <p className={styles.hint}>
                    Attaching artwork is a two-phase action. The wallet
                    broadcasts the file, waits for it to be indexed, then
                    broadcasts the link that makes it official. A
                    watcher-mode wallet can't observe the file landing
                    on-chain, so this flow can't be split across an
                    air-gapped boundary today.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Back</Button>
                </div>
            </>,
        );
    }

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Artwork attached</h2>
                <p className={styles.successLabel}>File transaction</p>
                <code className={styles.txid}>{fileTxid}</code>
                <p className={styles.successLabel}>Link transaction</p>
                <code className={styles.txid}>{linkTxid}</code>
                {tisTxid ? (
                    <>
                        <p className={styles.successLabel}>Token-info transaction</p>
                        <code className={styles.txid}>{tisTxid}</code>
                    </>
                ) : null}
                {descTxid ? (
                    <>
                        <p className={styles.successLabel}>Description update</p>
                        <code className={styles.txid}>{descTxid}</code>
                    </>
                ) : null}
                <p className={styles.hint}>
                    {descTxid
                        ? `Once everything confirms, ${tick}'s picture and info live entirely on the chain. The explorer and wallets read them with no website involved.`
                        : `Once the link confirms, the artwork shows up wherever ${tick} is displayed. The explorer and wallets read it straight from the chain.`}
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'wait-index') {
        const minutes = Math.floor(waitElapsed / 60);
        const slow = minutes >= 5;
        return wrap(
            <>
                <h2 className={styles.successTitle}>File is on its way</h2>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>File transaction</dt>
                    <dd className={styles.detailsValue}>
                        <code className={styles.txid}>{fileTxid}</code>
                    </dd>
                    <dt className={styles.detailsLabel}>Elapsed</dt>
                    <dd className={styles.detailsValue}>
                        {minutes > 0 ? `${minutes} min ${waitElapsed % 60}s` : `${waitElapsed}s`}
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Waiting for the file to be confirmed and indexed.
                    usually one or two blocks. Then one more signature links
                    it to {tick} and makes it official.
                </p>
                {slow ? (
                    <p className={styles.hint}>
                        This is taking longer than usual. If you close this
                        screen the file stays on-chain; you can finish the
                        pairing later from Actions → Link.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack}>Close (keep waiting)</Button>
                </div>
            </>,
        );
    }

    if (stage === 'wait-tis') {
        const minutes = Math.floor(waitElapsed / 60);
        return wrap(
            <>
                <h2 className={styles.successTitle}>Token info is on its way</h2>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Token-info transaction</dt>
                    <dd className={styles.detailsValue}>
                        <code className={styles.txid}>{tisTxid}</code>
                    </dd>
                    <dt className={styles.detailsLabel}>Elapsed</dt>
                    <dd className={styles.detailsValue}>
                        {minutes > 0 ? `${minutes} min ${waitElapsed % 60}s` : `${waitElapsed}s`}
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Waiting for the token-info document to be confirmed and
                    indexed. Then one final signature points {tick}'s
                    description at it.
                </p>
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack}>Close (keep waiting)</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review-tis' && fileMeta && fromAddress) {
        return wrap(
            <form onSubmit={handleSignTis} noValidate>
                <p className={styles.summary}>
                    Store {tick}'s information on the chain: a small document
                    naming the token and pointing at the artwork you just
                    attached.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Document</dt>
                    <dd className={styles.detailsValue}>{String(tick).toUpperCase()}.json</dd>
                    <dt className={styles.detailsLabel}>Artwork referenced</dt>
                    <dd className={styles.detailsValue}>#{fileActionIndex} ({fileMeta.name})</dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Step 3 of 4. After this uploads, one final signature points
                    {' '}{tick}'s description at it.
                </p>
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
                    disabled={submitting}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" type="button" onClick={() => setStage('done')} disabled={submitting}>
                        Skip (artwork only)
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        Upload token info
                    </Button>
                </div>
            </form>,
        );
    }

    if (stage === 'review-desc' && fromAddress) {
        return wrap(
            <form onSubmit={handleSignDescribe} noValidate>
                <p className={styles.summary}>
                    Point {tick}'s description at the on-chain token info.
                    this is what the explorer and wallets will read.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>New description</dt>
                    <dd className={styles.detailsValue}>action:{tisActionIndex}</dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Final step. This replaces the token's current description.
                    Only the token's owner can do this.
                </p>
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
                    disabled={submitting}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" type="button" onClick={() => setStage('done')} disabled={submitting}>
                        Skip
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        Update description
                    </Button>
                </div>
            </form>,
        );
    }

    if (stage === 'review-file' && fileMeta && fromAddress) {
        return wrap(
            <form onSubmit={handleSignFile} noValidate>
                <p className={styles.summary}>
                    Upload {fileMeta.name} to the chain, then link it to {tick}.
                </p>
                {previewUrl ? (
                    <img
                        src={previewUrl}
                        alt={`Preview of ${fileMeta.name}`}
                        style={{ maxWidth: 160, maxHeight: 160, borderRadius: 8, display: 'block', margin: '0 auto var(--xc-space-3)' }}
                    />
                ) : null}
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>File</dt>
                    <dd className={styles.detailsValue}>{fileMeta.name}</dd>
                    <dt className={styles.detailsLabel}>Type</dt>
                    <dd className={styles.detailsValue}>{fileMeta.type}</dd>
                    <dt className={styles.detailsLabel}>Size</dt>
                    <dd className={styles.detailsValue}>{(fileMeta.bytes.length / 1024).toFixed(1)} KB</dd>
                    {title.trim() ? (
                        <>
                            <dt className={styles.detailsLabel}>Title</dt>
                            <dd className={styles.detailsValue}>{title.trim()}</dd>
                        </>
                    ) : null}
                </dl>
                <p className={styles.hint}>
                    This is step 1 of {setAsTokenInfo ? 4 : 2}. The file goes
                    on-chain first; once it's indexed you'll sign
                    {setAsTokenInfo
                        ? ` three more transactions: the link to ${tick}, the token-info document, and the description update.`
                        : ` one more transaction linking it to ${tick}.`}
                    {' '}{hw
                        ? 'Each step confirms on your hardware device.'
                        : 'Each step asks for your password.'}
                </p>
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
                    disabled={submitting}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" type="button" onClick={() => setStage('compose')} disabled={submitting}>
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        Upload file
                    </Button>
                </div>
            </form>,
        );
    }

    if (stage === 'review-link' && fromAddress) {
        return wrap(
            <form onSubmit={handleSignLink} noValidate>
                <p className={styles.summary}>
                    Link the uploaded file to {tick}. This makes it the
                    token's official artwork.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>File action</dt>
                    <dd className={styles.detailsValue}>#{fileActionIndex}</dd>
                    <dt className={styles.detailsLabel}>Token created in action</dt>
                    <dd className={styles.detailsValue}>#{issueActionIndex}</dd>
                </dl>
                {ownerMismatch ? (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>
                            This wallet isn't signing from the token's owner
                            address ({issuerAddress}). The link will only be
                            honoured if it's signed by the current owner.
                        </p>
                    </div>
                ) : null}
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
                    disabled={submitting}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        Link artwork to {tick}
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'compose' (also the fallback if review stages lose
    // their prerequisites, e.g. addresses reloaded)
    return wrap(
        <form onSubmit={handleReviewFile} noValidate>
            <p className={styles.summary}>
                Store the artwork on the chain itself and link it to {tick}.
                Two signatures: one to upload the file, one to make it
                official.
            </p>
            <div
                {...drop.rootProps}
                style={{ marginBottom: 'var(--xc-space-3)' }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,audio/*,.svg,.json,.txt"
                    onChange={handleFilePick}
                    style={{ display: 'none' }}
                    aria-label="Choose file to attach"
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
                    <dd className={styles.detailsValue}>{(fileMeta.bytes.length / 1024).toFixed(1)} KB</dd>
                </dl>
            ) : (
                <p className={styles.hint}>
                    Keep it small. On-chain files must stay under about
                    {' '}{Math.floor(MAX_FILE_BYTES / 1024)} KB. A compact
                    image (SVG, small PNG/JPEG/WebP) works best. For larger
                    artwork, put an image URL in the token's description
                    instead.
                </p>
            )}
            {previewUrl ? (
                <img
                    src={previewUrl}
                    alt={`Preview of ${fileMeta?.name || 'file'}`}
                    style={{ maxWidth: 160, maxHeight: 160, borderRadius: 8, display: 'block', margin: '0 auto var(--xc-space-3)' }}
                />
            ) : null}
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
                    checked={setAsTokenInfo}
                    onChange={(e) => setSetAsTokenInfo(e.target.checked)}
                />
                <span>
                    Also make this {tick}'s picture everywhere. This stores the
                    token's info on the chain and points its description at
                    it (two more signatures)
                </span>
            </label>
            {ownerMismatch ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>
                        This wallet doesn't hold the token's owner address.
                        the final link step will only be honoured if signed
                        by the current owner.
                    </p>
                </div>
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
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fileMeta || !fromAddress}
                >
                    Review upload
                </Button>
            </div>
        </form>,
    );
}
