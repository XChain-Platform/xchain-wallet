// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AddressField, AddressText, Button, Checkbox, FeeSelector, FormNotice, FormPage, Icon, InfoTip, Input, ListPage, NetworkField, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { TokenField } from '../components/TokenField.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import inputStyles from '../../ui/Input.module.css';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { tokenIssuerEligibility } from '../utils/tokenIssuerEligibility.js';
import { nativeFeeForFeelessAction } from '../../flows/feeBearingActions.js';
import { normalizeGenesisRow } from './ManageToken.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
    displayRateToPerByte,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { extractActionIndex } from '../utils/actionIndexFromTx.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { imagePreviewDataUrl, publishFileType } from '../utils/publishingFile.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { UploadMethodField, UploadMethodReviewRows, useUploadMethod } from '../components/UploadMethodField.jsx';
import {
    publicFileCompiledBytes,
    standardUnavailableReason,
    taprootUnavailableReason,
    uploadMethodSizes,
} from '../../flows/uploadMethod.js';
import { MultipartUploadSection } from '../components/MultipartUploadSection.jsx';
import { useMultipartArtworkLink } from '../hooks/useMultipartArtworkLink.js';
import { useMultipartUploadMethod } from '../hooks/useMultipartUploadMethod.js';
import { useMultipartUploadPanel } from '../hooks/useMultipartUploadPanel.js';
import { fileUploadStart } from '../../flows/fileUploadStart.js';
import { fileRefFor } from '../../flows/fileMultipartRequest.js';
import { randomUUID } from '../../util/uuid.js';
import { multipartQuoteLanes } from '../../flows/multipartQuoteLanes.js';
import { multipartResumeRequestBuilder } from '../../flows/multipartResumeRequest.js';
import { multipartSupportForMethod } from '../../flows/multipartMethodSupport.js';
import { MULTIPART_FILE_MAX_BYTES } from '../../flows/fileSizeLimits.js';

const chainRegistry = registryLib.defaultRegistry();
const POLL_INTERVAL_MS = 10_000;

const ARTWORK_ACCEPT = ['image/*', 'audio/*', '.svg', '.json', '.txt'];
// Moderate oversize drops reach the exact metadata-aware error below, while
// unexpectedly large drops stop before FileReader allocates their contents.
const MAX_DROP_BYTES = 32 * 1024;

/** The compiled action-plus-file push of the artwork FILE leg, for the Upload method fees. */
function artworkUploadBytes(file, { title, memo }) {
    return publicFileCompiledBytes({ name: file.name, type: file.type, title, memo }, file.size);
}

function multipartSource(address) {
    return {
        address: address?.address,
        publicKey: address?.publicKey,
        derivationPath: address?.derivationPath,
        addressId: address?.id,
        source: address?.source,
        signerId: address?.signerId,
    };
}

function methodSupport(method, descriptor, address, isWatcherMode) {
    try {
        return multipartSupportForMethod({
            method,
            descriptor,
            addressRecord: address,
            addressType: address?.addressType || descriptor?.defaultAddressType,
            isWatcherMode,
        });
    } catch {
        return { supported: false, reason: 'signer' };
    }
}

function quoteLanes(descriptor) {
    try {
        return multipartQuoteLanes({ descriptor });
    } catch {
        return null;
    }
}

function quoteSizes(descriptor) {
    return {
        envelopePairVbytes: (bytes) => uploadMethodSizes({ compiledBytes: bytes, descriptor }).taproot,
        standardPairBytes: (bytes) => uploadMethodSizes({ compiledBytes: bytes, descriptor }).standard,
    };
}

function artworkDraftError({
    fromAddress, issuerEligibility, tick, fileMeta, fileParams, title, memo,
    setAsTokenInfo, previewUrl, attachmentLimitFor,
}) {
    if (!fromAddress) return 'No signing address available on this network.';
    if (issuerEligibility.pending) return `Wait for the wallet to verify the current owner of ${tick}.`;
    if (issuerEligibility.error) return issuerEligibility.error;
    if (!fileMeta) return 'Pick a file first.';
    if (!fileParams?.NAME) return 'The file name cannot be empty. Rename the file and choose it again.';
    if (!fileParams.TYPE) return 'The file content type cannot be empty. Choose the file again.';
    if ((title && /[|;]/.test(title)) || (memo && /[|;]/.test(memo))
        || /[|;]/.test(fileMeta.name)) {
        return 'File name, title, and memo cannot contain | or ; characters.';
    }
    const unsafeMetadata = actionTextSafetyError(fileMeta.name, 'File name')
        || actionTextSafetyError(title, 'Title');
    if (unsafeMetadata) return unsafeMetadata;
    if (fileParams.TITLE.length > MAX_TITLE_LENGTH) {
        return `Title cannot be longer than ${MAX_TITLE_LENGTH} characters.`;
    }
    const memoTooLong = memoLengthError(fileParams.MEMO);
    if (memoTooLong) return memoTooLong;
    if (setAsTokenInfo && !previewUrl) {
        return 'Choose an image file before making it the token picture.';
    }
    const cap = attachmentLimitFor(fileMeta.name, fileMeta.type);
    if (fileMeta.size > cap) {
        return `With this title and memo the on-chain ceiling is ${cap.toLocaleString()} bytes and the file is ${fileMeta.size.toLocaleString()} bytes. Shorten the title or memo.`;
    }
    return null;
}

function artworkSourceError(fromAddress, descriptor) {
    if (!fromAddress.id || typeof fromAddress.id !== 'string') {
        return 'The selected signing address is missing its wallet ID. Choose another address.';
    }
    if (!descriptor?.coin || !descriptor?.networkKind || !isValidAddressForChain(
        fromAddress.address,
        descriptor.coin,
        descriptor.networkKind,
    )) return 'The selected signing address is not valid for this network.';
    return null;
}
const MAX_TITLE_LENGTH = 100;
const POSITIVE_ACTION_INDEX = /^[1-9]\d*$/;

function normalizedActionIndex(value) {
    const index = String(value ?? '').trim();
    return POSITIVE_ACTION_INDEX.test(index) ? index : null;
}

async function fetchGenesisActionIndex(messaging, chainId, tick) {
    if (typeof messaging?.getGenesisForToken !== 'function') {
        return { index: null, error: 'The token creation record lookup is unavailable. Try again later.' };
    }
    try {
        const info = normalizeGenesisRow(await messaging.getGenesisForToken({ chainId, tick }));
        if (info?.actionIndex == null || String(info.actionIndex).trim() === '') {
            return { index: null, error: `The creation record for ${tick} isn't indexed yet. Try again in a minute.` };
        }
        const index = normalizedActionIndex(info.actionIndex);
        if (!index) {
            return { index: null, error: `The creation record for ${tick} returned an invalid action number. Try again later.` };
        }
        return { index, error: null };
    } catch {
        return { index: null, error: `Couldn't refresh the creation record for ${tick}. Check your connection and try again.` };
    }
}

function artworkFileType(file) {
    const meta = publishFileType(file);
    if (meta.error) return meta;
    const accepted = meta.type.startsWith('image/')
        || meta.type.startsWith('audio/')
        || /\.(svg|json|txt)$/i.test(file.name || '');
    return accepted
        ? meta
        : { ...meta, error: 'That file type is not accepted for artwork. Choose an image, audio file, SVG, JSON, or text file.' };
}

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
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the source default resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // The token's ISSUE action index (the LINK's second leg). Fetched
    // from the same genesis endpoint ManageToken renders.
    const [issueActionIndex, setIssueActionIndex] = useState(/** @type {string | null} */ (null));
    const [genesisRefreshing, setGenesisRefreshing] = useState(false);

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
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    // A leg that was SIGNED but never reached the network. The confirm
    // lane resolves that case rather than throwing, and the next leg is
    // keyed on this one's action index, so the flow stops here.
    const [queuedLeg, setQueuedLeg] = useState(/** @type {any | null} */ (null));
    const [fileTxid, setFileTxid] = useState(/** @type {string | null} */ (null));
    const [fileActionIndex, setFileActionIndex] = useState(/** @type {string | null} */ (null));
    const [multipartRetry, setMultipartRetry] = useState(0);
    const [linkTxid, setLinkTxid] = useState(/** @type {string | null} */ (null));
    const [waitElapsed, setWaitElapsed] = useState(0);
    const [indexLookupError, setIndexLookupError] = useState(/** @type {string | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const fileReadIdRef = useRef(0);

    // The active map is best-effort: a host without `getActiveAddresses`, or
    // one whose call fails, still yields a usable form (newest-HD fallback).
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                setActiveByChain(active || {});
                if (!byChain || !(byChain[chainId] || []).length) {
                    setLoadError('No address on this network yet. Use Receive to generate one first.');
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.'));
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        let cancelled = false;
        setIssueActionIndex(null);
        fetchGenesisActionIndex(messaging, chainId, tick)
            .then(({ index }) => {
                if (cancelled) return;
                setIssueActionIndex(index);
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);

    // Signing address: the token's owner when the wallet holds it
    // (the LINK is only honoured from the owner), else the same default
    // as Send and every other spend-from-balance form so the FILE leg
    // still works: the chain's active address, else the newest HD
    // external, else the first remaining record (a hardware-only wallet).
    // A dispenser-delegated address is never the default.
    useEffect(() => {
        if (!addressesByChain || !activeByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        if (issuerAddress) {
            const match = all.find((a) => a.address === issuerAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const funding = all.filter((a) => a.role !== 'dispenser');
        const picked = preferredSourceId(funding, activeByChain[chainId]) || funding[0]?.id || all[0]?.id;
        if (picked) setFromAddressId(picked);
    }, [addressesByChain, activeByChain, chainId, fromAddressId, issuerAddress]);

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
                const rawIndex = extractActionIndex(resp);
                const index = normalizedActionIndex(rawIndex);
                if (rawIndex && !index) {
                    setIndexLookupError('The network returned an invalid action number for the file. The wallet will keep checking.');
                } else if (index) {
                    setIndexLookupError(null);
                    setFileActionIndex(index);
                    setStage('review-link');
                }
            } catch {
                if (!cancelled) {
                    setIndexLookupError('The wallet could not check the file record. It will keep trying.');
                }
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
                const rawIndex = extractActionIndex(resp);
                const index = normalizedActionIndex(rawIndex);
                if (rawIndex && !index) {
                    setIndexLookupError('The network returned an invalid action number for the token info. The wallet will keep checking.');
                } else if (index) {
                    setIndexLookupError(null);
                    setTisActionIndex(index);
                    setStage('review-desc');
                }
            } catch {
                if (!cancelled) {
                    setIndexLookupError('The wallet could not check the token-info record. It will keep trying.');
                }
            }
        };
        tick_();
        const handle = setInterval(tick_, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, tisTxid, chainId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] || '' : '';

    // Keep the chain-required flag in every submit path without presenting a
    // protocol-fee choice for these feeless actions.
    const nativeFee = nativeFeeForFeelessAction(coinTicker);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);
    const issuerEligibility = tokenIssuerEligibility({
        tokenInfo: { creator: issuerAddress },
        addressesByChain,
        chainId,
        tick,
        sourceAddress: fromAddress?.address,
    });

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
    const ownerMismatch = !!issuerEligibility.error;

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();
    const uploadMeta = useMemo(() => ({
        name: fileMeta?.name || 'file.bin',
        type: fileMeta?.type || 'application/octet-stream',
        title,
        memo,
    }), [fileMeta, title, memo]);
    const singleCaps = useMemo(() => ({
        taproot: flowsLib.maxPublicFileBytes(uploadMeta, { encoding: 'TAPROOT' }),
        standard: flowsLib.maxPublicFileBytes(uploadMeta, {}),
    }), [uploadMeta]);
    const singleReasons = {
        taproot: taprootUnavailableReason({ descriptor, fromAddress, isWatcherMode }),
        standard: standardUnavailableReason({
            fileBytes: fileMeta?.size ?? null,
            standardCap: singleCaps.standard,
        }),
    };
    const singleFits = {
        taproot: !fileMeta || fileMeta.size <= singleCaps.taproot,
        standard: !fileMeta || fileMeta.size <= singleCaps.standard,
    };
    const multipartRate = feeEstimate?.unit
        ? displayRateToPerByte(feeEstimate.unit, Number(feeEstimate.rateValue)) || null
        : null;
    const multipartMethod = useMultipartUploadMethod({
        bytes: fileMeta?.bytes ?? null,
        meta: uploadMeta,
        rate: multipartRate,
        descriptor,
        addressRecord: fromAddress,
        addressType: fromAddress?.addressType || descriptor?.defaultAddressType,
        isWatcherMode,
        singleReasons,
        singleFits,
        lanes: useMemo(() => quoteLanes(descriptor), [descriptor]),
        sizes: useMemo(() => quoteSizes(descriptor), [descriptor]),
    });

    // The Upload method Publish file offers (flows/uploadMethod.js): Taproot
    // envelope by default where a signer can sign the reveal (never hardware)
    // on a chain whose descriptor does Taproot (BTC yes, DOGE never), Standard
    // otherwise. The ceiling below and the FILE compose both follow the pick,
    // so the size offered is the size the encoder can carry. Only the FILE leg
    // uses it; the LINK, token-info and description legs stay on the default lane.
    const upload = useUploadMethod({
        descriptor,
        fromAddress,
        isWatcherMode,
        feeEstimate,
        coinTicker,
        file: fileMeta,
        metadata: { title, memo },
        compiledBytesFor: artworkUploadBytes,
        standardCap: fileMeta ? singleCaps.standard : null,
        multipart: multipartMethod,
    });
    const envelopePicked = upload.method === 'taproot';
    const multipartPicked = upload.multipart?.options?.[upload.method]?.multipart === true;
    const selectedSupport = useMemo(() => methodSupport(
        upload.method, descriptor, fromAddress, isWatcherMode,
    ), [upload.method, descriptor, fromAddress, isWatcherMode]);
    const uploadFrom = useMemo(() => multipartSource(fromAddress), [fromAddress]);
    const selectedSingleCap = singleCaps[upload.method];
    const buildResumeRequest = useMemo(() => multipartResumeRequestBuilder({
        walletId,
        chainId,
        from: uploadFrom,
        singleTransactionCap: selectedSingleCap,
        support: selectedSupport,
        rate: multipartRate || undefined,
    }), [walletId, chainId, uploadFrom, selectedSingleCap, selectedSupport, multipartRate]);
    const multipartPanel = useMultipartUploadPanel({
        messaging,
        walletId,
        chainId,
        sourceAddress: fromAddress?.address || '',
        gated: false,
        buildResumeRequest,
    });
    const multipartExplorer = useMemo(() => ({
        getTransaction: (txid) => messaging.getActionByTxid({ chainId, txid }),
        getAction: (actionIndex) => messaging.getActionByIndex({ chainId, actionIndex }),
    }), [chainId, messaging]);
    const multipartLink = useMultipartArtworkLink({
        explorer: multipartExplorer,
        tick,
        coinTicker,
        maxAttempts: 1,
        waitMs: 0,
    });

    useEffect(() => {
        const result = multipartPanel.result;
        if (!result?.txid) return undefined;
        let active = true;
        multipartLink.check({ txid: result.txid, linkTarget: result.upload?.linkTarget })
            .then((outcome) => {
                if (!active || !outcome?.ok) return;
                setFileTxid(result.txid);
                setFileActionIndex(outcome.fields.coin1ActionIndex);
                setIssueActionIndex(outcome.fields.coin2ActionIndex);
                setIndexLookupError(null);
                setPassword('');
                setStage('review-link');
            });
        return () => { active = false; };
    }, [multipartPanel.result, multipartLink.check, multipartRetry]);

    useEffect(() => {
        if (!multipartPanel.result?.txid || multipartLink.notice?.retryable !== true) return undefined;
        const timer = setTimeout(() => setMultipartRetry((value) => value + 1), POLL_INTERVAL_MS);
        return () => clearTimeout(timer);
    }, [multipartLink.notice, multipartPanel.result]);

    // §5.6: all four legs sign through the shared confirm lane. The ISSUE
    // leg is the sharpest case, token administration signed against a
    // locally rendered summary while every other ISSUE surface in the
    // wallet composes through the tamper-checked confirm page. This form
    // refuses watcher mode outright, so there is no legacy lane to keep.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    // "In flight" is now the pre-open host compose, not a local flag each
    // leg set by hand around its own dispatch.
    const submitting = actionConfirm.composing;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitFile = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'fileAction',
        hardware: 'fileActionHw',
    });
    const submitLink = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'linkAction',
        hardware: 'linkActionHw',
    });
    const submitIssue = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'issueToken',
        hardware: 'issueTokenHw',
    });

    /**
     * Compose one leg host-side, approve it on the shared confirm page and
     * sign those exact bytes. `onBroadcast` carries the leg's own
     * post-broadcast bookkeeping, which the shared screen knows nothing of.
     *
     * @param {object} leg
     * @param {{ action: string, params: object }} leg.actionData
     * @param {object} [leg.encoderOpts]
     * @param {(prebuiltPsbt: object) => Promise<any>} leg.dispatch
     * @param {(res: any) => void} leg.onBroadcast
     * @param {string} leg.fallback   error sentence when nothing better is known
     */
    async function runLegThroughConfirm({ actionData, encoderOpts, dispatch, onBroadcast, fallback }) {
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from: sourceDescriptor(),
                actionData,
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    ...(encoderOpts || {}),
                },
                onApprove: dispatch,
            });
            // Signed but never broadcast: each later leg is keyed on an
            // earlier one's action index, so the chain cannot continue and
            // saying it did would be the worse of the two wrong answers.
            if (res?.queued) { setQueuedLeg(res); return; }
            onBroadcast(res);
        } catch (err) {
            if (isUserRejection(err)) return;
            setSubmitError(submitFailureMessage(err, {
                chainId, coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || fallback,
            }));
        }
    }

    /** The source descriptor every leg's request body carries. */
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

    /** The file bytes as the Latin-1 binary string the encoder rebuilds. */
    function latin1Of(bytes) {
        let out = '';
        for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
        return out;
    }

    const fileFieldLabelId = useId();
    const fileLimitId = useId();

    const previewUrl = useMemo(
        () => imagePreviewDataUrl(fileMeta?.bytes),
        [fileMeta],
    );
    const fileParams = useMemo(
        () => (fileMeta ? flowsLib.fileActionParams({
            name: fileMeta.name, type: fileMeta.type, title, memo,
        }) : null),
        [fileMeta, title, memo],
    );

    // Sized from the encoding the FILE compose requests, the same call
    // Publish file makes: the envelope ceiling when the picked method asks
    // for AUTO, the legacy compiled ceiling for Standard.
    const attachmentCapFor = useCallback(
        (name, type) => flowsLib.maxPublicFileBytes(
            { name, type, title, memo },
            envelopePicked ? { encoding: 'TAPROOT' } : {},
        ),
        [title, memo, envelopePicked],
    );
    const attachmentLimitFor = useCallback(
        (name, type) => selectedSupport.supported
            ? Math.max(attachmentCapFor(name, type), MULTIPART_FILE_MAX_BYTES)
            : attachmentCapFor(name, type),
        [attachmentCapFor, selectedSupport],
    );
    // The legacy ceiling is small enough that a URL is the honest way to
    // carry larger artwork; at the envelope ceiling that advice would mislead.
    const largerArtworkAdvice = selectedSupport.supported
        ? ''
        : ' For larger artwork, put an image URL in the token\'s description instead.';

    const acceptFile = useCallback((file, content = null) => {
        const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : null;
        const byteLength = bytes?.length ?? file.size;
        setFileMeta(null);
        const { type, error: typeError } = artworkFileType(file);
        if (typeError) {
            setFormError(typeError);
            return;
        }
        if (byteLength === 0) {
            setFormError('That file is empty.');
            return;
        }
        const cap = attachmentLimitFor(file.name || 'file', type);
        if (byteLength > cap) {
            setFormError(
                `That file is ${byteLength.toLocaleString()} bytes; with this title and memo the on-chain ceiling is ${cap.toLocaleString()} bytes.${largerArtworkAdvice}`,
            );
            return;
        }
        if (!bytes || !imagePreviewDataUrl(bytes)) setSetAsTokenInfo(false);
        setFormError(null);
        setFileMeta({
            name: file.name || 'file',
            type,
            size: byteLength,
            file,
            bytes,
        });
    }, [attachmentLimitFor, largerArtworkAdvice]);

    const handleFilePick = useCallback((event) => {
        const file = event.target?.files?.[0];
        if (!file) return;
        const readId = ++fileReadIdRef.current;
        setFileMeta(null);
        setFormError(null);
        const fileNameError = actionTextSafetyError(file.name || 'file', 'File name');
        if (fileNameError) {
            setFormError(fileNameError);
            return;
        }
        const { error: typeError } = artworkFileType(file);
        if (typeError) {
            setFormError(typeError);
            return;
        }
        if (file.size > selectedSingleCap) {
            acceptFile(file);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            if (readId !== fileReadIdRef.current) return;
            if (reader.result instanceof ArrayBuffer) acceptFile(file, reader.result);
            else setFormError('Could not read that file.');
        };
        reader.onerror = () => {
            if (readId === fileReadIdRef.current) setFormError('Could not read that file.');
        };
        reader.readAsArrayBuffer(file);
    }, [acceptFile, selectedSingleCap]);

    const drop = useDropZone({
        readAs: 'arrayBuffer',
        accept: ARTWORK_ACCEPT,
        // The envelope ceiling is far above the legacy one, so a drop that
        // fits it still reaches the exact metadata-aware check.
        maxBytes: selectedSupport.supported
            ? MULTIPART_FILE_MAX_BYTES
            : (envelopePicked
                ? attachmentCapFor('file.bin', 'application/octet-stream') + MAX_DROP_BYTES
                : MAX_DROP_BYTES),
        onError: (msg) => { setFileMeta(null); setFormError(msg); },
        onFile: ({ file, content }) => {
            if (content instanceof ArrayBuffer) acceptFile(file, content);
        },
    });
    const dropRootProps = {
        ...drop.rootProps,
        onDrop: (event) => {
            const file = event.dataTransfer?.files?.[0];
            if (!file || !selectedSupport.supported || file.size <= selectedSingleCap) {
                drop.rootProps.onDrop(event);
                return;
            }
            event.preventDefault();
            acceptFile(file);
        },
    };

    async function handleReviewFile(event) {
        event.preventDefault();
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        const draftError = artworkDraftError({
            fromAddress, issuerEligibility, tick, fileMeta, fileParams, title, memo,
            setAsTokenInfo, previewUrl, attachmentLimitFor,
        });
        if (draftError) { setFormError(draftError); return; }
        const sourceError = artworkSourceError(fromAddress, descriptor);
        if (sourceError) { setFormError(sourceError); return; }
        setGenesisRefreshing(true);
        const latestGenesis = await fetchGenesisActionIndex(messaging, chainId, tick);
        setGenesisRefreshing(false);
        setIssueActionIndex(latestGenesis.index);
        if (!latestGenesis.index) {
            setFormError(latestGenesis.error);
            return;
        }
        setFormError(null);
        setStage('review-file');
    }

    async function pickedFileUpload() {
        let planned = fileUploadStart({
            walletId,
            chainId,
            from: uploadFrom,
            file: fileMeta.file,
            fileRef: { kind: 'inline', blob: fileMeta.file },
            meta: {
                name: fileMeta.name,
                type: fileMeta.type,
                title: title.trim(),
                memo: memo.trim(),
            },
            singleTransactionCap: selectedSingleCap,
            support: selectedSupport,
            linkTarget: { tick, issueActionIndex },
            rate: multipartRate || undefined,
        });
        if (planned.path !== 'multipart') return planned;
        const fileRef = await fileRefFor(fileMeta.file, { key: randomUUID() });
        planned = fileUploadStart({
            walletId,
            chainId,
            from: uploadFrom,
            file: fileMeta.file,
            fileRef,
            meta: {
                name: fileMeta.name,
                type: fileMeta.type,
                title: title.trim(),
                memo: memo.trim(),
            },
            singleTransactionCap: selectedSingleCap,
            support: selectedSupport,
            linkTarget: { tick, issueActionIndex },
            rate: multipartRate || undefined,
        });
        return planned;
    }

    async function runMultipartUpload(planned) {
        setIndexLookupError(null);
        setStage('wait-index');
        try {
            await multipartPanel.start(planned.request, planned.match);
        } catch {
            return false;
        }
        return true;
    }

    async function handleSignFile(event) {
        event.preventDefault();
        if (submitting || multipartPanel.running || !fileMeta || !fileParams) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        const planned = await pickedFileUpload();
        if (planned.path === 'multipart') {
            await runMultipartUpload(planned);
            return;
        }
        if (planned.path !== 'single') {
            setSubmitError('This file does not fit the selected upload method. Choose another method or a smaller file.');
            return;
        }
        let bytes = fileMeta.bytes;
        if (!bytes) {
            try {
                bytes = new Uint8Array(await fileMeta.file.arrayBuffer());
                setFileMeta({ ...fileMeta, bytes });
            } catch {
                setSubmitError('Could not read that file.');
                return;
            }
        }
        const rawData = latin1Of(bytes);
        await runLegThroughConfirm({
            // The same params flows/fileAction.js builds, so the previewed
            // and the submitted composition cannot drift (PC-28).
            actionData: {
                action: 'FILE',
                params: fileParams,
            },
            // The picked method's request, as Publish file sends it: AUTO with
            // the signer's asserted tapscript capability for the envelope, no
            // encoding for Standard, so the ceiling offered above is one the
            // encoder can carry.
            encoderOpts: {
                rawData,
                ...upload.encoderOpts,
            },
            dispatch: (prebuiltPsbt) => submitFile({
                walletId,
                chainId,
                from: sourceDescriptor(),
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
                name: fileMeta.name,
                type: fileMeta.type,
                title: title.trim() || undefined,
                memo: memo.trim() || undefined,
                rawData,
                prebuiltPsbt,
            }),
            onBroadcast: (res) => {
                const txid = res?.txid || res?.broadcast?.txid;
                if (!txid) throw new Error('Broadcast did not return a transaction id.');
                setIndexLookupError(null);
                setFileTxid(txid);
                setPassword('');
                setStage('wait-index');
            },
            fallback: 'File upload failed.',
        });
    }

    async function handleSignLink(event) {
        event.preventDefault();
        if (submitting || !fileActionIndex || !issueActionIndex) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        await runLegThroughConfirm({
            // The same params flows/linkAction.js builds from these fields.
            actionData: {
                action: 'LINK',
                params: {
                    VERSION: '0',
                    COIN1: String(coinTicker).toUpperCase(),
                    COIN1_ACTION_INDEX: String(fileActionIndex),
                    COIN2: String(coinTicker).toUpperCase(),
                    COIN2_ACTION_INDEX: String(issueActionIndex),
                    MEMO: '',
                },
            },
            dispatch: (prebuiltPsbt) => submitLink({
                walletId,
                chainId,
                from: sourceDescriptor(),
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
                coin1: coinTicker,
                coin1ActionIndex: fileActionIndex,
                coin2: coinTicker,
                coin2ActionIndex: issueActionIndex,
                prebuiltPsbt,
            }),
            onBroadcast: (res) => {
                const txid = res?.txid || res?.broadcast?.txid;
                if (!txid) throw new Error('Link broadcast did not return a transaction ID.');
                setLinkTxid(txid);
                setPassword('');
                setStage(setAsTokenInfo ? 'review-tis' : 'done');
            },
            fallback: 'Link broadcast failed.',
        });
    }

    // The token's information document: minimal TIS JSON (same shape as
    // sdk.nft.tisDocument; see
    // xchain-documentation/protocol/token-information-standard.md#on-chain-format-action-index):
    // NFT intent + the artwork referenced by its on-chain action index.
    const tisJson = useMemo(() => {
        if (!fileMeta || !fileActionIndex) return null;
        const doc = {
            tick: String(tick),
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
        // JSON.stringify output may contain non-ASCII (title); encode to
        // UTF-8 bytes first, then to the Latin-1 binary string the encoder
        // expects.
        const rawData = latin1Of(new TextEncoder().encode(tisJson));
        const tisName = String(tick) + '.json';
        await runLegThroughConfirm({
            actionData: {
                action: 'FILE',
                params: flowsLib.fileActionParams({
                    name: tisName, type: 'application/json', title: 'Token information',
                }),
            },
            encoderOpts: { rawData },
            dispatch: (prebuiltPsbt) => submitFile({
                walletId,
                chainId,
                from: sourceDescriptor(),
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
                name: tisName,
                type: 'application/json',
                title: 'Token information',
                rawData,
                prebuiltPsbt,
            }),
            onBroadcast: (res) => {
                const txid = res?.txid || res?.broadcast?.txid;
                if (!txid) throw new Error('Token-info upload did not return a txid.');
                setIndexLookupError(null);
                setTisTxid(txid);
                setPassword('');
                setStage('wait-tis');
            },
            fallback: 'Token-info upload failed.',
        });
    }

    async function handleSignDescribe(event) {
        event.preventDefault();
        if (submitting || !tisActionIndex) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        // ISSUE v1: edit description (owner-only at the indexer).
        const issueParams = {
            VERSION: '1',
            TICK: String(tick),
            DESCRIPTION: 'action:' + String(tisActionIndex),
        };
        await runLegThroughConfirm({
            actionData: { action: 'ISSUE', params: issueParams },
            dispatch: (prebuiltPsbt) => submitIssue({
                walletId,
                chainId,
                from: sourceDescriptor(),
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
                params: issueParams,
                prebuiltPsbt,
            }),
            onBroadcast: (res) => {
                const txid = res?.txid || res?.broadcast?.txid;
                if (!txid) throw new Error('Description update did not return a txid.');
                setDescTxid(txid);
                setPassword('');
                setStage('done');
            },
            fallback: 'Description update failed.',
        });
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
            <ListPage>{children}</ListPage>
        </Screen>
    );
    const wrapForm = (form) => <Screen variant={variant} header={header} restoreScroll={!stage.startsWith('review-')}>{form}</Screen>;

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
            </>,
        );
    }

    if (loadError) {
        return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);
    }
    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    // A leg signed but not broadcast stops the chain: the shared panel
    // says so and deliberately offers no retry (re-signing while a signed
    // copy is queued is the double-broadcast trap).
    if (queuedLeg) {
        return wrap(
            <ResultScreen
                state="signed-not-broadcast"
                onDone={onBack}
                what="attachment"
                unsaved={queuedLeg?.unsaved}
            />,
        );
    }

    // Confirm page for whichever leg is in flight, rendered in place of that
    // leg's review stage; the stage machine stays intact behind it.
    if (actionConfirm.open) {
        // The file leg names its upload method, and its fee estimate is the
        // picked method's for this file.
        const fileLeg = stage === 'review-file';
        const legFeeAmount = (fileLeg && upload.fee?.coinAmount) || feeEstimate?.coinAmount;
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                feeText={legFeeAmount
                    ? `Network fee: ${legFeeAmount} ${coinTicker}`.trim()
                    : undefined}
                extraCredentials={fileLeg
                    ? <p className={styles.hint} data-testid="confirm-upload-method">{upload.confirmLine}</p>
                    : null}
                coinTicker={coinTicker}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
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
                        ? `Once everything confirms, ${tick}'s picture and info live entirely on the network. The explorer and wallets read them with no website involved.`
                        : `Once the link confirms, the artwork shows up wherever ${tick} is displayed. The explorer and wallets read it straight from the network.`}
                </p>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'wait-index') {
        const minutes = Math.floor(waitElapsed / 60);
        const slow = minutes >= 5;
        const multipartNotice = multipartLink.notice?.message
            || (multipartLink.error ? 'The file\'s completed manifest could not be verified. Try again in a moment.' : null);
        if (!fileTxid) {
            return wrap(
                <>
                    <h2 className={styles.successTitle}>File is on its way</h2>
                    <MultipartUploadSection
                        panelProps={multipartPanel.panelProps}
                        fileInput={multipartPanel.fileInput}
                        resumeReason={multipartPanel.resumeReason}
                        error={multipartPanel.error}
                        listError={multipartPanel.listError}
                        fallbackMessage="The multi-part upload could not continue."
                    />
                    {multipartLink.checking ? (
                        <p className={styles.hint}>Verifying that every file part is complete before the link review.</p>
                    ) : null}
                    {multipartNotice ? <StatusMessage variant="error">{multipartNotice}</StatusMessage> : null}
                    <div className={styles.actions}>
                        <Button variant="ghost" icon={<Icon.XIcon />} onClick={onBack}>Close (keep waiting)</Button>
                    </div>
                </>,
            );
        }
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
                {indexLookupError ? (
                    <StatusMessage variant="error">{indexLookupError}</StatusMessage>
                ) : null}
                {slow ? (
                    <p className={styles.hint}>
                        This is taking longer than usual. If you close this
                        screen the file stays on-chain; you can finish the
                        pairing later from Actions → Link.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" icon={<Icon.XIcon />} onClick={onBack}>Close (keep waiting)</Button>
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
                {indexLookupError ? (
                    <StatusMessage variant="error">{indexLookupError}</StatusMessage>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" icon={<Icon.XIcon />} onClick={onBack}>Close (keep waiting)</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review-tis' && fileMeta && fromAddress) {
        return wrapForm(
            <FormPage
                demoGuard={demoGuard}
                label="Upload token info"
                onSubmit={handleSignTis}
                status={hw && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <>
                        <Button variant="ghost" type="button" icon={<Icon.XIcon />} onClick={() => setStage('done')} disabled={submitting}>
                            Skip (artwork only)
                        </Button>
                        <Button
                            type="submit"
                            variant="success"
                            icon={<Icon.UploadIcon />}
                            loading={submitting}
                            disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                        >
                            Upload token info
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary}>
                    Store {tick}'s information on the chain: a small document
                    naming the token and pointing at the artwork you just
                    attached.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Document</dt>
                    <dd className={styles.detailsValue}>{String(tick)}.json</dd>
                    <dt className={styles.detailsLabel}>Type</dt>
                    <dd className={styles.detailsValue}>application/json</dd>
                    <dt className={styles.detailsLabel}>Title</dt>
                    <dd className={styles.detailsValue}>Token information</dd>
                    <dt className={styles.detailsLabel}>Contents</dt>
                    <dd className={styles.detailsValue}><code>{tisJson}</code></dd>
                    <dt className={styles.detailsLabel}>Artwork referenced</dt>
                    <dd className={styles.detailsValue}>
                        {fileMeta.name}
                        <span className={styles.detailsRef}>#{fileActionIndex}</span>
                    </dd>
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
            </FormPage>,
        );
    }

    if (stage === 'review-desc' && fromAddress) {
        return wrapForm(
            <FormPage
                demoGuard={demoGuard}
                label="Update token description"
                onSubmit={handleSignDescribe}
                status={hw && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <>
                        <Button variant="ghost" type="button" icon={<Icon.XIcon />} onClick={() => setStage('done')} disabled={submitting}>
                            Skip
                        </Button>
                        <Button
                            type="submit"
                            variant="success"
                            icon={<Icon.PencilIcon />}
                            loading={submitting}
                            disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                        >
                            Update description
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary}>
                    Point {tick}'s description at the on-chain token info.
                    this is what the explorer and wallets will read.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>New description</dt>
                    {/* The raw string stays visible: this is the exact value being
                        signed onto the chain, not a label. The gloss explains it
                        rather than replacing it (XC review #4386). */}
                    <dd className={styles.detailsValue}>
                        action:{tisActionIndex}
                        <span className={styles.detailsNote}>
                            Points the description at this token&apos;s on-chain info record.
                        </span>
                    </dd>
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
            </FormPage>,
        );
    }

    if (stage === 'review-file' && fileMeta && fromAddress) {
        return wrapForm(
            <FormPage
                demoGuard={demoGuard}
                label="Review artwork upload"
                onSubmit={handleSignFile}
                status={hw && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <>
                        <Button
                            variant="ghost"
                            type="button"
                            icon={<Icon.BackIcon />}
                            onClick={(event) => {
                                event.preventDefault();
                                setStage('compose');
                            }}
                            disabled={submitting || multipartPanel.running}
                        >
                            Back
                        </Button>
                        <Button
                            type="submit"
                            variant="success"
                            icon={<Icon.UploadIcon />}
                            loading={submitting || multipartPanel.running}
                            disabled={multipartPanel.running || (hw ? hwStatus !== 'available' : (!signerReady && password.length === 0))}
                        >
                            Upload file
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary}>
                    Upload {fileParams.NAME} to the chain, then link it to {tick}.
                </p>
                {previewUrl ? (
                    <img
                        src={previewUrl}
                        alt={`Preview of ${fileMeta.name}`}
                        width={160}
                        height={160}
                        loading="lazy"
                        decoding="async"
                        style={{ maxWidth: 160, maxHeight: 160, objectFit: 'contain', borderRadius: 8, display: 'block', margin: '0 auto var(--xc-space-3)' }}
                    />
                ) : null}
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>File</dt>
                    <dd className={styles.detailsValue}>{fileParams.NAME}</dd>
                    <dt className={styles.detailsLabel}>Type</dt>
                    <dd className={styles.detailsValue}>{fileParams.TYPE}</dd>
                    <dt className={styles.detailsLabel}>Size</dt>
                    <dd className={styles.detailsValue}>{fileMeta.size.toLocaleString()} bytes</dd>
                    <UploadMethodReviewRows upload={upload} labelClassName={styles.detailsLabel} valueClassName={styles.detailsValue} />
                    {fileParams.TITLE ? (
                        <>
                            <dt className={styles.detailsLabel}>Title</dt>
                            <dd className={styles.detailsValue}>{fileParams.TITLE}</dd>
                        </>
                    ) : null}
                    {fileParams.MEMO ? (
                        <>
                            <dt className={styles.detailsLabel}>Memo</dt>
                            <dd className={styles.detailsValue}><code>{fileParams.MEMO}</code></dd>
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
            </FormPage>,
        );
    }

    if (stage === 'review-link' && fromAddress) {
        return wrapForm(
            <FormPage
                demoGuard={demoGuard}
                label="Review artwork link"
                onSubmit={handleSignLink}
                status={hw && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="success"
                        icon={<Icon.LinkIcon />}
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        Link artwork to {tick}
                    </Button>
                )}
            >
                <p className={styles.summary}>
                    Link the uploaded file to {tick}. This makes it the
                    token's official artwork.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Artwork file record</dt>
                    <dd className={styles.detailsValue}>
                        {coinTicker}
                        <span className={styles.detailsRef}>#{fileActionIndex}</span>
                    </dd>
                    <dt className={styles.detailsLabel}>Token creation record</dt>
                    <dd className={styles.detailsValue}>
                        {coinTicker}
                        <span className={styles.detailsRef}>#{issueActionIndex}</span>
                    </dd>
                </dl>
                {ownerMismatch ? (
                    <FormNotice variant="error" role="alert">
                        {issuerEligibility.error}
                    </FormNotice>
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
            </FormPage>,
        );
    }

    // The token lives on one chain, so the picker stays on it: an address
    // from another chain could never sign this token's LINK.
    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From address"
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                onPick={(address) => {
                    setFromAddressId(address.id);
                    setFormError(null);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    const fileLimitBytes = multipartPicked
        ? attachmentLimitFor(
            fileMeta?.name || 'file.bin',
            fileMeta?.type || 'application/octet-stream',
        )
        : attachmentCapFor(
            fileMeta?.name || 'file.bin',
            fileMeta?.type || 'application/octet-stream',
        );

    // stage === 'compose' (also the fallback if review stages lose
    // their prerequisites, e.g. addresses reloaded)
    return wrapForm(
        <FormPage
            demoGuard={demoGuard}
            label="Attach artwork"
            onSubmit={handleReviewFile}
            status={formError || issuerEligibility.error ? (
                <StatusMessage variant="error">{formError || issuerEligibility.error}</StatusMessage>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    icon={<Icon.UploadIcon />}
                    loading={genesisRefreshing}
                    disabled={genesisRefreshing
                        || (!multipartMethod.ready && fileMeta?.bytes != null)
                        || issuerEligibility.pending || !!issuerEligibility.error}
                >
                    Attach artwork
                </Button>
            )}
        >
            <NetworkField
                label="Network"
                help={`The chain ${tick} lives on. The artwork is stored and linked on this network, and your From address pays both fees here.`}
                value={chainId}
                onChange={() => {}}
                chainIds={chainId ? [chainId] : []}
                chainRegistry={chainRegistry}
            />
            <AddressField
                label="From"
                help={`The address that signs both the upload and the link. Only ${tick}'s current owner can make the artwork official, so pick the owner address.`}
                icon="addresses"
                value={fromAddress?.address || ''}
                readOnly
                onChange={() => {}}
                onIconClick={() => setSourcePickerOpen(true)}
                iconLabel="Choose source address"
            />
            {/* Opened from one token's Manage page, so the token is fixed. */}
            <TokenField
                label="Token"
                help="The token this artwork belongs to. It is fixed because you opened Artwork from this token's page."
                value={chainId && tick ? { chainId, tick } : null}
                onOpenPicker={() => {}}
                disabled
            />
            {/* How the bytes ride the chain, before the file: the pick sets the
                ceiling the file field names. */}
            <UploadMethodField upload={upload} />
            <MultipartUploadSection
                panelProps={multipartPanel.panelProps}
                fileInput={multipartPanel.fileInput}
                resumeReason={multipartPanel.resumeReason}
                error={multipartPanel.error}
                // The page status already names a failed issuer check or form error;
                // a resume-list failure under it would stack a second page message.
                listError={formError || issuerEligibility.error ? null : multipartPanel.listError}
                fallbackMessage="The multi-part upload could not continue."
            />
            <div className={inputStyles.field}>
                <div className={inputStyles.labelRow}>
                    <span id={fileFieldLabelId} className={inputStyles.label}>Artwork file</span>
                    <InfoTip
                        className={inputStyles.labelHelp}
                        label={`Stores the artwork on the chain itself and links it to ${tick}. Two signatures: one to upload the file, one to make it official. A compact image (SVG, small PNG/JPEG/WebP) works best.${largerArtworkAdvice}`}
                        aria="About Artwork file"
                    />
                </div>
                <div
                    {...dropRootProps}
                    role="group"
                    aria-labelledby={fileFieldLabelId}
                    aria-describedby={fileLimitId}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={ARTWORK_ACCEPT.join(',')}
                        onChange={handleFilePick}
                        style={{ display: 'none' }}
                        aria-label="Choose file to attach"
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        icon={<Icon.DocumentIcon />}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {fileMeta ? 'Choose a different file' : 'Choose a file'}
                    </Button>
                </div>
                <div id={fileLimitId} className={inputStyles.hint}>
                    Up to {fileLimitBytes.toLocaleString()} bytes with the current title and memo.
                </div>
            </div>
            {fileMeta ? (
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>File</dt>
                    <dd className={styles.detailsValue}>{fileMeta.name}</dd>
                    <dt className={styles.detailsLabel}>Type</dt>
                    <dd className={styles.detailsValue}>{fileMeta.type}</dd>
                    <dt className={styles.detailsLabel}>Size</dt>
                    <dd className={styles.detailsValue}>{(fileMeta.size / 1024).toFixed(1)} KB</dd>
                </dl>
            ) : null}
            {previewUrl ? (
                <img
                    src={previewUrl}
                    alt={`Preview of ${fileMeta?.name || 'file'}`}
                    width={160}
                    height={160}
                    loading="lazy"
                    decoding="async"
                    style={{ maxWidth: 160, maxHeight: 160, objectFit: 'contain', borderRadius: 8, display: 'block', margin: '0 auto var(--xc-space-3)' }}
                />
            ) : null}
            <Input
                label="Title"
                optional
                help={`A short name for the artwork, stored on the chain with the file. If you also make it ${tick}'s picture, it becomes the token's display name. Every character here takes room from the file. It cannot contain | or ;.`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoComplete="off"
                maxLength={MAX_TITLE_LENGTH}
            />
            <Input
                label="Memo"
                optional
                maxLength={MAX_MEMO_LENGTH}
                help="A public note stored on the chain with the artwork file. Every character here takes room from the file. It cannot contain | or ;."
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />
            <Checkbox
                label={(
                    <>
                        Also make this {tick}'s picture everywhere
                        {fileMeta && !previewUrl ? '. Choose an image file to enable this option.' : ''}
                    </>
                )}
                help="Stores the token's info on the chain and points its description at it, so this becomes the token's picture everywhere. It takes two more signatures."
                checked={setAsTokenInfo}
                onChange={(e) => setSetAsTokenInfo(e.target.checked)}
                disabled={Boolean(fileMeta && !previewUrl)}
            />
            {feeTiers ? (
                <FeeSelector
                    chainId={chainId}
                    label="Network fee"
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}
        </FormPage>,
    );
}
