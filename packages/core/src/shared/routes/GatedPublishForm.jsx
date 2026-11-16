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
import { useEffect, useMemo, useRef, useState } from 'react';
import { AddressField, Button, ChainBadge, Checkbox, EmptyState, FeeSelector, FieldNote, FormPage, Input, ListPage, ListRow, NetworkField, PageHeader, RadioGroup, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import {
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
    displayRateToPerByte,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { imagePreviewDataUrl, publishFileType } from '../utils/publishingFile.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { tokenIssuerEligibility } from '../utils/tokenIssuerEligibility.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { CheckIcon, PlusIcon, UploadIcon } from '../../ui/icons/index.jsx';
import styles from './IssueTokenForm.module.css';
import publishStyles from './GatedPublishForm.module.css';
import { UploadMethodField, useUploadMethod } from '../components/UploadMethodField.jsx';
import {
    gatedFileCompiledBytes,
    standardUnavailableReason,
    taprootUnavailableReason,
    uploadMethodSizes,
} from '../../flows/uploadMethod.js';
import { useMultipartUploadMethod } from '../hooks/useMultipartUploadMethod.js';
import { useMultipartUploadPanel } from '../hooks/useMultipartUploadPanel.js';
import { MultipartUploadSection } from '../components/MultipartUploadSection.jsx';
import { multipartQuoteLanes } from '../../flows/multipartQuoteLanes.js';
import { multipartSupportForMethod } from '../../flows/multipartMethodSupport.js';
import { maxUploadBytesFor } from '../../flows/multipartSupport.js';
import { multipartResumeRequestBuilder } from '../../flows/multipartResumeRequest.js';
import { gatedMultipartStartFields } from '../../flows/gatedMultipartStartFields.js';
import { gatedPublishMultipartStart } from '../../flows/gatedPublishAction.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/gatedPublish.js';
import '../../i18n/locales/en/palette.js';
import '../../i18n/locales/en/send.js';

const chainRegistry = registryLib.defaultRegistry();

/** The compiled BATCH-plus-ciphertext push of a gated publish, for the Upload method fees. */
function gatedUploadBytes(file, meta) {
    return gatedFileCompiledBytes({ ...meta, name: file.name, type: file.type }, file.bytes.length);
}

function multipartSource(address) {
    if (!address) return null;
    return {
        address: address.address,
        publicKey: address.publicKey,
        derivationPath: address.derivationPath,
        addressId: address.id,
        source: address.source,
        signerId: address.signerId,
    };
}

function multipartSizes(descriptor) {
    const size = (compiledBytes, method) => uploadMethodSizes({
        compiledBytes: Math.max(1, compiledBytes), descriptor,
    })[method];
    return {
        envelopePairVbytes: (bytes) => size(bytes, 'taproot'),
        standardPairBytes: (bytes) => size(bytes, 'standard'),
    };
}

function completedMultipart(reply) {
    return {
        ...reply,
        keyHash: reply?.upload?.keyHash ?? null,
    };
}

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
 * @param {string | null} [props.uploadPick]  the explicit Upload method pick, controlled by Publish file (null: the default)
 * @param {(method: string | null) => void} [props.onUploadPick]  with uploadPick, shares the pick with Publish file
 */
export function GatedPublishForm({
    walletId, chainId, tick, issuerAddress = null, onBack, uploadPick = null, onUploadPick,
}) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const { isWatcherMode } = useWalletMode();
    const [selectedChainId, setSelectedChainId] = useState(chainId);
    const [gateTick, setGateTick] = useState(tick);
    const [gateOwnerAddress, setGateOwnerAddress] = useState(issuerAddress);
    const [fromOverrideId, setFromOverrideId] = useState(/** @type {string | null} */ (null));
    const [fromPickerOpen, setFromPickerOpen] = useState(false);
    const [gateTokenPickerOpen, setGateTokenPickerOpen] = useState(false);
    const [ownedTokens, setOwnedTokens] = useState(/** @type {any[] | null} */ (null));
    const [ownedTokensError, setOwnedTokensError] = useState(/** @type {string | null} */ (null));
    const descriptor = chainRegistry.get(selectedChainId);
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
        ? flowsLib.gateMinAmountScheduledHeight(selectedChainId)
        : null;
    useEffect(() => {
        setThresholdActive(false);
        if (thresholdScheduledHeight === null) return undefined;
        if (typeof messaging.getIndexerWatermark !== 'function') return undefined;
        let cancelled = false;
        messaging.getIndexerWatermark({ chainId: selectedChainId })
            .then((r) => {
                if (cancelled) return;
                const h = Number(r?.watermark);
                setThresholdActive(Number.isFinite(h) && h >= thresholdScheduledHeight);
            })
            .catch(() => { /* stays inactive; the flow gate is authoritative */ });
        return () => { cancelled = true; };
    }, [selectedChainId, thresholdScheduledHeight, messaging]);
    const [ackForever, setAckForever] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [stage, setStage] = useState(
        /** @type {'form' | 'submitting' | 'done'} */ ('form'),
    );
    const [password, setPassword] = useState('');
    const [hwStatus, setHwStatus] = useState('idle');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const fileReadIdRef = useRef(0);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => { if (!cancelled) setAddressesByChain(byChain); })
            .catch((err) => { if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load addresses.')); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!addressesByChain) return undefined;
        if (demoGuard.blocked) {
            setOwnedTokens([{ chainId, tick, ownerAddress: issuerAddress }]);
            return undefined;
        }
        if (typeof messaging.getOwnedTokens !== 'function') {
            setOwnedTokens([{ chainId, tick, ownerAddress: issuerAddress }]);
            return undefined;
        }
        let cancelled = false;
        const calls = [];
        for (const [ownedChainId, addresses] of Object.entries(addressesByChain)) {
            if (!Array.isArray(addresses)) continue;
            for (const addressRecord of addresses) {
                const ownerAddress = typeof addressRecord?.address === 'string'
                    ? addressRecord.address
                    : null;
                if (!ownerAddress) continue;
                calls.push(
                    messaging.getOwnedTokens({ chainId: ownedChainId, address: ownerAddress })
                        .then((rows) => (Array.isArray(rows) ? rows : []).map((row) => ({
                            ...row,
                            chainId: ownedChainId,
                            ownerAddress,
                        })).filter((row) => typeof row.tick === 'string' && row.tick.length > 0))
                        .then((rows) => ({ rows, failed: false }))
                        .catch(() => ({ rows: [], failed: true })),
                );
            }
        }
        Promise.all(calls).then((results) => {
            if (cancelled) return;
            const initial = { chainId, tick, ownerAddress: issuerAddress };
            const seen = new Set();
            const merged = [];
            for (const row of [...results.flatMap((result) => result.rows), initial]) {
                const key = `${row.chainId}:${row.tick}`;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(row);
            }
            merged.sort((a, b) => a.tick.localeCompare(b.tick));
            setOwnedTokens(merged);
            if (results.some((result) => result.failed)) {
                setOwnedTokensError(
                    results.every((result) => result.failed)
                        ? t('gatedPublish.tokens.lookupFailed')
                        : t('gatedPublish.tokens.lookupPartial'),
                );
            }
        });
        return () => { cancelled = true; };
    }, [addressesByChain, chainId, demoGuard.blocked, issuerAddress, messaging, tick]);

    const tokenChainIds = useMemo(() => {
        const ids = [...new Set((ownedTokens || []).map((token) => token.chainId).filter(Boolean))];
        return ids.length > 0 ? ids : [chainId];
    }, [ownedTokens, chainId]);

    function selectGateToken(token) {
        setSelectedChainId(token.chainId);
        setGateTick(token.tick);
        setGateOwnerAddress(token.ownerAddress || null);
        setFromOverrideId(null);
        setPackChoice('new');
        setGateMinAmount('');
        setFormError(null);
    }

    function handleNetworkChange(nextChainId) {
        const tokenOnChain = (ownedTokens || []).find((token) => token.chainId === nextChainId);
        if (tokenOnChain) selectGateToken(tokenOnChain);
    }

    // Reusable packs = pack keys this wallet's vault holds for this tick.
    // (Metadata only; the raw key never leaves the background context.)
    useEffect(() => {
        setPacks(null);
        setPacksError(null);
        if (typeof messaging.listGatedKeys !== 'function') { setPacks([]); return undefined; }
        let cancelled = false;
        messaging.listGatedKeys({ walletId, chainId: selectedChainId, gateTicker: gateTick })
            .then((rows) => { if (!cancelled) setPacks(Array.isArray(rows) ? rows : []); })
            .catch(() => {
                if (cancelled) return;
                setPacks([]);
                setPacksError('Could not load reusable packs. You can still publish with a new pack.');
            });
        return () => { cancelled = true; };
    }, [walletId, selectedChainId, gateTick, messaging]);

    // Signing address: the token owner's address on this chain. Publishing
    // from anything else is rejected by the indexer's owner rule, so if the
    // owner's key isn't in this wallet we block rather than compose a
    // guaranteed-invalid transaction.
    const fromAddress = useMemo(() => {
        if (!addressesByChain) return null;
        const onChain = addressesByChain[selectedChainId] || [];
        const override = fromOverrideId ? onChain.find((a) => a.id === fromOverrideId) : null;
        if (override) return override;
        if (gateOwnerAddress) return onChain.find((a) => a.address === gateOwnerAddress) || null;
        return onChain[0] || null;
    }, [addressesByChain, selectedChainId, fromOverrideId, gateOwnerAddress]);
    const issuerEligibility = tokenIssuerEligibility({
        tokenInfo: { creator: gateOwnerAddress },
        addressesByChain,
        chainId: selectedChainId,
        tick: gateTick,
        sourceAddress: fromAddress?.address,
    });
    const ownerMissing = !!issuerEligibility.error;
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
        () => estimateNativeSendFeeTiers({ chainId: selectedChainId, chainRegistry }),
        [selectedChainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId: selectedChainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [selectedChainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom' ? feeCustomEstimate : (feeTiers ? feeTiers[feePick.mode] : null);
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;
    const multipartRate = (feeEstimate?.unit && Number.isFinite(feeEstimate?.rateValue))
        ? displayRateToPerByte(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // The metadata the BATCH string carries besides the file's own name and type.
    const batchMeta = {
        title,
        memo: memo.trim(),
        gateTicker: gateTick || '',
        coin: coinTicker,
        address: fromAddress?.address || '',
        gateMinAmount: thresholdActive && gateMinAmount.trim() ? gateMinAmount.trim() : null,
    };
    const capWith = (name, type, ceilingOpts) => flowsLib.maxGatedPlaintextBytes(
        { ...batchMeta, name, type },
        ceilingOpts,
    );
    const standardCap = fileMeta && fromAddress
        ? capWith(fileMeta.name, fileMeta.type, {})
        : null;
    const envelopeCap = fileMeta && fromAddress
        ? capWith(fileMeta.name, fileMeta.type, { encoding: 'TAPROOT' })
        : null;
    const singleReasons = {
        taproot: taprootUnavailableReason({ descriptor, fromAddress, isWatcherMode }),
        standard: standardUnavailableReason({
            fileBytes: fileMeta?.bytes?.length ?? null, standardCap,
        }),
    };
    const singleFits = {
        taproot: !fileMeta || !Number.isFinite(envelopeCap)
            || fileMeta.bytes.length <= envelopeCap,
        standard: !fileMeta || !Number.isFinite(standardCap)
            || fileMeta.bytes.length <= standardCap,
    };
    const quoteLanes = useMemo(() => multipartQuoteLanes({ descriptor }), [descriptor]);
    const quoteSizes = useMemo(() => multipartSizes(descriptor), [descriptor]);
    const multipart = useMultipartUploadMethod({
        bytes: fileMeta?.bytes ?? null,
        meta: fileMeta ? {
            name: fileMeta.name, type: fileMeta.type, title: title.trim(), memo: memo.trim(),
        } : null,
        gated: true,
        gate: { ticker: gateTick, minAmount: batchMeta.gateMinAmount ?? '' },
        rate: multipartRate,
        descriptor,
        addressRecord: fromAddress,
        addressType: fromAddress?.addressType ?? descriptor?.defaultAddressType,
        isWatcherMode,
        singleReasons,
        singleFits,
        lanes: quoteLanes,
        sizes: quoteSizes,
    });

    // The Upload method (flows/uploadMethod.js): Taproot envelope by default
    // where a software signer on the confirm lane and a Taproot chain can carry
    // it, Standard otherwise. Inside Publish file the pick is shared with the
    // Public mode, like the rest of the draft.
    const upload = useUploadMethod({
        descriptor,
        fromAddress,
        isWatcherMode,
        feeEstimate,
        coinTicker,
        file: fileMeta,
        // Typed fields settle before they re-estimate; the token, coin and
        // address are picked, so they re-estimate at once.
        metadata: { title: batchMeta.title, memo: batchMeta.memo, gateMinAmount: batchMeta.gateMinAmount },
        context: { gateTicker: batchMeta.gateTicker, coin: batchMeta.coin, address: batchMeta.address },
        compiledBytesFor: gatedUploadBytes,
        standardCap,
        multipart,
        ...(typeof onUploadPick === 'function' ? { picked: uploadPick, onPick: onUploadPick } : {}),
    });

    // Encoding-aware ceiling for the CURRENT metadata and the picked upload
    // method: exact once the signing address is known, the conservative
    // floor until then.
    const plainCapFor = (name, type) => (fromAddress
        ? capWith(name, type, upload.ceilingOpts)
        : MAX_BYTES_FLOOR);
    const selectedSupport = multipartSupportForMethod({
        method: upload.method,
        descriptor,
        addressRecord: fromAddress,
        addressType: fromAddress?.addressType ?? descriptor?.defaultAddressType,
        isWatcherMode,
    });
    const uploadCapFor = (name, type) => maxUploadBytesFor(
        selectedSupport,
        plainCapFor(name, type),
    );
    const fileFieldCapFor = (name, type) => {
        const singleCap = plainCapFor(name, type);
        return fileMeta && fileMeta.bytes.length > singleCap
            ? uploadCapFor(name, type)
            : singleCap;
    };
    const resumeRequest = useMemo(() => multipartResumeRequestBuilder({
        walletId,
        chainId: selectedChainId,
        from: multipartSource(fromAddress),
        singleTransactionCap: MAX_BYTES_FLOOR,
        support: selectedSupport,
        gate: { ticker: gateTick, minAmount: batchMeta.gateMinAmount ?? '' },
        rate: multipartRate,
    }), [
        walletId, selectedChainId, fromAddress, selectedSupport.lane,
        selectedSupport.buildMode, selectedSupport.reason, gateTick,
        batchMeta.gateMinAmount, multipartRate,
    ]);
    const multipartUpload = useMultipartUploadPanel({
        messaging,
        walletId,
        chainId: selectedChainId,
        sourceAddress: fromAddress?.address ?? '',
        gated: true,
        buildResumeRequest: resumeRequest,
    });
    useEffect(() => {
        if (!multipartUpload.result) return;
        setResult(completedMultipart(multipartUpload.result));
        setStage('done');
    }, [multipartUpload.result]);

    function handlePickFile(event) {
        const file = event.target.files && event.target.files[0];
        setFormError(null);
        if (!file) return;
        const readId = ++fileReadIdRef.current;
        setFileMeta(null);
        const fileNameError = actionTextSafetyError(file.name || 'file', 'File name');
        if (fileNameError) { setFormError(fileNameError); return; }
        const { type, error: typeError } = publishFileType(file);
        if (typeError) { setFormError(typeError); return; }
        const cap = uploadCapFor(file.name, type);
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

    async function handleReview(event) {
        event.preventDefault();
        if (issuerEligibility.pending) {
            setFormError(`Wait for the wallet to verify the current owner of ${gateTick}.`);
            return;
        }
        if (issuerEligibility.error) {
            setFormError(issuerEligibility.error);
            return;
        }
        if (!fileMeta) { setFormError('Pick a file first.'); return; }
        if (!fromAddress) {
            setFormError(ownerMissing
                ? `This wallet does not hold the owner address for ${gateTick}; only the token owner can publish gated files.`
                : 'No signing address available on this network.');
            return;
        }
        if ((title && /[|;]/.test(title)) || (memo && /[|;]/.test(memo)) || /[|;]/.test(fileMeta.name)) {
            setFormError('File name, title, and memo cannot contain | or ; characters.');
            return;
        }
        const unsafeMetadata = actionTextSafetyError(fileMeta.name, 'File name')
            || actionTextSafetyError(title, 'Title');
        if (unsafeMetadata) { setFormError(unsafeMetadata); return; }
        const memoError = memoLengthError(memo.trim());
        if (memoError) { setFormError(memoError); return; }
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        const thresholdValue = thresholdActive ? gateMinAmount.trim() : '';
        const thresholdError = thresholdValue
            ? flowsLib.gateMinAmountValidationError(thresholdValue)
            : null;
        if (thresholdError) {
            setFormError(thresholdError);
            return;
        }
        const singleCap = plainCapFor(fileMeta.name, fileMeta.type);
        const reviewCap = uploadCapFor(fileMeta.name, fileMeta.type);
        if (fileMeta.bytes.length > reviewCap) {
            setFormError(
                `This publish lane supports up to ${reviewCap.toLocaleString()} bytes `
                + `and the file is ${fileMeta.bytes.length.toLocaleString()} bytes.`,
            );
            return;
        }
        if (!ackForever) {
            setFormError('Confirm you understand the publish is permanent.');
            return;
        }
        let tokenInfo = null;
        if (typeof messaging.getTokenInfo === 'function') {
            try {
                tokenInfo = await messaging.getTokenInfo({ chainId: selectedChainId, tick: gateTick });
            } catch {
                setFormError('Could not refresh token ownership. Check your connection and try again.');
                return;
            }
            if (!tokenInfo?.creator) {
                setFormError(`Could not verify that ${gateTick} still exists. Reopen this screen and try again.`);
                return;
            }
            if (tokenInfo.creator !== fromAddress.address) {
                setFormError(`This wallet no longer owns ${gateTick}. Reopen this screen to refresh your tokens.`);
                return;
            }
        }
        if (thresholdValue) {
            const divisibility = Number(tokenInfo?.divisibility);
            const maxDecimals = Number.isInteger(divisibility)
                ? Math.max(0, Math.min(18, divisibility))
                : 18;
            const divisibilityError = flowsLib.gateMinAmountValidationError(
                thresholdValue,
                maxDecimals,
            );
            if (divisibilityError) { setFormError(divisibilityError); return; }
            if (typeof messaging.getIndexerWatermark !== 'function') {
                setFormError('Could not verify that unlock thresholds are active. Try again later.');
                return;
            }
            try {
                const current = await messaging.getIndexerWatermark({ chainId: selectedChainId });
                const height = Number(current?.watermark);
                if (!Number.isFinite(height) || height < thresholdScheduledHeight) {
                    setFormError('Unlock thresholds are not active on this network right now. Remove the threshold to continue.');
                    return;
                }
            } catch {
                setFormError('Could not verify that unlock thresholds are active. Try again later.');
                return;
            }
        }
        setFormError(null);
        await publishSelected(singleCap);
    }

    function multipartStart(singleTransactionCap) {
        const fields = gatedMultipartStartFields({
            gateTicker: gateTick,
            thresholdActive,
            gateMinAmount,
            packChoice,
        });
        return gatedPublishMultipartStart({
            walletId,
            chainId: selectedChainId,
            from: multipartSource(fromAddress),
            bytes: fileMeta.bytes,
            meta: {
                name: fileMeta.name,
                type: fileMeta.type,
                title: title.trim(),
                memo: memo.trim(),
            },
            singleTransactionCap,
            support: selectedSupport,
            rate: multipartRate,
            ...fields,
        });
    }

    async function publishSelected(singleTransactionCap) {
        let start;
        try {
            start = multipartStart(singleTransactionCap);
        } catch (error) {
            setFormError(userFacingMessage(error, 'Could not prepare this upload.'));
            return;
        }
        if (start.path === 'single') {
            await publish();
            return;
        }
        if (start.path !== 'multipart') {
            setFormError(`This file cannot use the selected upload method (${start.reason}).`);
            return;
        }
        if (!multipart.ready) {
            setFormError('Wait for the multipart fee estimate, then try again.');
            return;
        }
        setStage('submitting');
        try {
            const reply = await multipartUpload.start(start.request, start.match);
            setResult(completedMultipart(reply));
            setStage('done');
        } catch (error) {
            setStage('form');
            setFormError(userFacingMessage(error, 'Multipart publish failed.'));
        }
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
            chainId: selectedChainId,
            from: {
                address: fromAddress.address,
                publicKey: fromAddress.publicKey,
                derivationPath: fromAddress.derivationPath,
                addressId: fromAddress.id,
                source: fromAddress.source,
                signerId: fromAddress.signerId,
            },
            gateTicker: gateTick,
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
            // The picked upload method: the envelope's AUTO request, or no
            // encoding at all for Standard (the flow sizes its ceiling to match).
            ...(upload.encoderOpts.encoding ? { encoding: upload.encoderOpts.encoding } : {}),
        };
    }

    // Review hands the publish straight to the shared confirm screen, whose
    // Reject and Approve are the only sign step: the password or the device
    // check lives there, so the form keeps no review stage or sign button of
    // its own. A watcher wallet signs nothing and builds the unsigned
    // transaction at once.
    async function publish() {
        if (!fileMeta || !fromAddress || stage === 'submitting') return;
        setStage('submitting');
        try {
            const base = publishRequest();
            let r;
            if (isWatcherMode) {
                r = await messaging.buildGatedPublishPsbtRequest(base);
            } else {
                r = await actionConfirm.run({
                    chainId: selectedChainId,
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
            setStage('form');
            if (isUserRejection(err)) return;
            const bad = err?.name === 'InvalidPasswordError';
            setFormError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId: selectedChainId, coinTicker, fallback: err?.message || 'Publish failed.',
            }));
        } finally {
            setPassword('');
        }
    }

    const header = (
        <PageHeader onBack={onBack} title={t('gatedPublish.title', { tick: gateTick })} />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    // The load error and the broadcast result lay out through FormPage like
    // the form stage, so no state draws straight into Screen.
    if (loadError) {
        return wrap(
            <FormPage
                label={t('gatedPublish.title', { tick: gateTick })}
                status={<StatusMessage variant="error">{loadError}</StatusMessage>}
            />,
        );
    }

    if (gateTokenPickerOpen) {
        const rows = ownedTokens || [];
        return (
            <Screen
                variant={variant}
                header={(
                    <PageHeader
                        onBack={() => setGateTokenPickerOpen(false)}
                        title={t('gatedPublish.tokens.choose')}
                    />
                )}
            >
                <ListPage>
                    {rows.length === 0 ? (
                        <EmptyState
                            title={t('gatedPublish.tokens.noneTitle')}
                            titleAs="h3"
                            body={t('gatedPublish.tokens.noneBody')}
                        />
                    ) : (
                        <div className={publishStyles.tokenPickerCard} role="list">
                            {rows.map((token) => {
                                const tokenDescriptor = chainRegistry.get(token.chainId);
                                return (
                                    <ListRow
                                        role="listitem"
                                        key={`${token.chainId}:${token.tick}`}
                                        leading={(
                                            <TickerIcon
                                                tick={token.tick}
                                                chainId={token.chainId}
                                                size={28}
                                            />
                                        )}
                                        title={token.tick}
                                        subtitle={tokenDescriptor?.displayName || token.chainId}
                                        chevron
                                        onClick={() => {
                                            selectGateToken(token);
                                            setGateTokenPickerOpen(false);
                                        }}
                                    />
                                );
                            })}
                        </div>
                    )}
                </ListPage>
            </Screen>
        );
    }

    if (fromPickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title={t('send.fromAddress')}
                walletId={walletId}
                chainId={selectedChainId}
                onChainChange={handleNetworkChange}
                onPick={(address) => {
                    setFromOverrideId(address.id);
                    setFromPickerOpen(false);
                }}
                onBack={() => setFromPickerOpen(false)}
            />
        );
    }

    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                // The picked method's estimate for this file, shown only until
                // the composed transactions state their exact fee.
                feeText={(upload.fee?.coinAmount || feeEstimate?.coinAmount)
                    ? t('send.networkFeeValue', {
                        amount: upload.fee?.coinAmount || feeEstimate.coinAmount,
                        ticker: coinTicker,
                    }).trim()
                    : undefined}
                extraCredentials={<p className={styles.hint} data-testid="confirm-upload-method">{upload.confirmLine}</p>}
                coinTicker={coinTicker}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={({ status }) => setHwStatus(status)}
                chainId={selectedChainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        if (result?.psbtHex && !result?.txid) {
            return wrap(
                <>
                    <ResultScreen
                        state="unsigned"
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
                <ResultScreen state="signed-not-broadcast" onDone={onBack} what={t('gatedPublish.queuedWhat')} unsaved={result.unsaved} />,
            );
        }
        return wrap(
            <FormPage
                label={t('gatedPublish.success')}
                actions={(
                    <Button variant="success" icon={<CheckIcon />} onClick={onBack}>
                        {t('common.done')}
                    </Button>
                )}
            >
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
                    {t('gatedPublish.successHint.beforeToken')} {gateTick}{' '}
                    {t('gatedPublish.successHint.afterToken')}
                </p>
            </FormPage>,
        );
    }

    // Form stage.
    const previewUrl = imagePreviewDataUrl(fileMeta?.bytes);
    return wrap(
        <FormPage
            demoGuard={demoGuard}
            label={t('gatedPublish.gatedContent')}
            onSubmit={handleReview}
            noValidate
            status={[
                formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null,
                ownerMissing ? (
                    <StatusMessage variant="error">
                        {issuerEligibility.error}
                    </StatusMessage>
                ) : null,
            ]}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    icon={isWatcherMode ? <PlusIcon /> : <UploadIcon />}
                    loading={stage === 'submitting' || multipartUpload.running}
                    disabled={issuerEligibility.pending || !!issuerEligibility.error
                        || multipartUpload.running}
                >
                    {isWatcherMode ? t('send.review.createUnsigned') : t('palette.createPublishFile.title')}
                </Button>
            )}
        >
            <NetworkField
                label={t('send.fields.chain')}
                value={selectedChainId}
                onChange={handleNetworkChange}
                chainIds={tokenChainIds}
                chainRegistry={chainRegistry}
            />

            <AddressField
                label={t('send.fields.from')}
                icon="addresses"
                help={t('gatedPublish.fromHelp')}
                value={fromAddress?.address || ''}
                readOnly
                onChange={() => {}}
                onIconClick={() => setFromPickerOpen(true)}
                iconLabel={t('send.fromAddress')}
            />

            <TokenField
                label={t('send.fields.token')}
                value={{ chainId: selectedChainId, tick: gateTick }}
                onOpenPicker={() => setGateTokenPickerOpen(true)}
                disabled={ownedTokens === null}
            />
            {ownedTokensError ? (
                <FieldNote variant="error">{ownedTokensError}</FieldNote>
            ) : null}

            {/* How the bytes ride the chain, before the file: the pick sets the
                ceiling the file field names. */}
            <UploadMethodField upload={upload} disabled={ownerMissing} />
            <MultipartUploadSection
                {...multipartUpload}
                fallbackMessage="Could not continue the multipart upload."
            />
            <Input
                type="file"
                label={t('gatedPublish.fileLimit', {
                    bytes: fileFieldCapFor(
                        fileMeta?.name || `file${'.bin'}`,
                        fileMeta?.type || 'application/octet-stream',
                    ).toLocaleString(),
                })}
                help={(
                    <>
                        {t('gatedPublish.formHint.beforeToken')} <strong>{gateTick}</strong>{' '}
                        {t('gatedPublish.formHint.afterToken')}{' '}
                        {t('gatedPublish.permanentHint')}
                    </>
                )}
                aria-label={t('gatedPublish.fileToPublish')}
                onChange={handlePickFile}
                disabled={ownerMissing || multipartUpload.running}
            />
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

            <Input
                type="text"
                label={t('gatedPublish.titleField')}
                help={t('gatedPublish.titleHelp')}
                optional
                enterKeyHint="next"
                aria-label={t('gatedPublish.titleField')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                disabled={ownerMissing}
            />
            <Input
                type="text"
                label={t('send.memo')}
                help={t('gatedPublish.memoHelp')}
                optional
                enterKeyHint={thresholdActive ? 'next' : 'go'}
                aria-label={t('send.memo')}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={MAX_MEMO_LENGTH}
                disabled={ownerMissing}
            />

            {thresholdActive ? (
                <>
                    <Input
                        type="text"
                        label={t('gatedPublish.unlockThreshold')}
                        help={t('gatedPublish.thresholdHint', { tick: gateTick })}
                        optional
                        inputMode="decimal"
                        enterKeyHint="go"
                        aria-label={t('gatedPublish.unlockThreshold')}
                        placeholder={t('gatedPublish.noThreshold')}
                        value={gateMinAmount}
                        onChange={(e) => setGateMinAmount(e.target.value)}
                        disabled={ownerMissing}
                    />
                </>
            ) : null}

            <RadioGroup
                legend={t('gatedPublish.pack')}
                help={t('gatedPublish.pack.empty')}
                name="pack"
                value={packChoice}
                onChange={(nextValue) => setPackChoice(nextValue)}
                disabled={ownerMissing}
                options={[
                    { value: 'new', label: t('gatedPublish.pack.new') },
                    ...(packs || []).map((p) => ({
                        value: p.keyHash,
                        label: (
                            <>
                                {t('gatedPublish.pack.add')} <code>{String(p.keyHash).slice(0, 12)}…</code>
                                {' '}{t('gatedPublish.pack.unlockTogether')}
                            </>
                        ),
                    })),
                ]}
            />
            {packs === null ? (
                <p className={styles.hint}>{t('gatedPublish.pack.loading')}</p>
            ) : packsError ? (
                <FieldNote variant="error">{packsError}</FieldNote>
            ) : null}

            {feeTiers ? (
                <FeeSelector
                    chainId={chainId}
                    label={t('send.networkFee')}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}

            {isWatcherMode ? (
                <p className={styles.hint}>
                    {t('gatedPublish.watcherHint')}
                </p>
            ) : null}
            <Checkbox
                label={t('gatedPublish.ackForever')}
                checked={ackForever}
                onChange={(e) => setAckForever(e.target.checked)}
                disabled={ownerMissing}
            />

        </FormPage>,
    );
}
