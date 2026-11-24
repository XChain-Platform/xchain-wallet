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
// Network, From and the fee selector render inside the standard FromSection
// and FeeSection.
import { AddressText, Button, ChainBadge, FieldNote, FormPage, IconSelect, Input, PageHeader, Screen, StatusMessage, useFormErrors } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
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
import { formatBytes } from '../utils/formatBytes.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { imagePreviewDataUrl, publishFileType } from '../utils/publishingFile.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { tokenIssuerEligibility } from '../utils/tokenIssuerEligibility.js';
import { invalidateTokenInfo } from '../utils/tokenInfoCache.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { FileField } from '../components/FileField.jsx';
import { UploadMethodField, UploadMethodReviewRows, useUploadMethod } from '../components/UploadMethodField.jsx';
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
import { CheckIcon, DocumentIcon, GearIcon, KeyIcon, PlusIcon, UploadIcon } from '../../ui/icons/index.jsx';
// Gated content is laid out on the Wallet Form Standard frame.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    joinSummary,
    MemoSection,
    useFormSections,
} from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
import styles from './IssueTokenForm.module.css';
import { t } from '../../i18n/index.js';
import { titleCase } from '../utils/titleCase.js';
import '../../i18n/locales/en/gatedPublish.js';
import '../../i18n/locales/en/palette.js';
import '../../i18n/locales/en/publishFile.js';
import '../../i18n/locales/en/send.js';

const chainRegistry = registryLib.defaultRegistry();

/** The gated BATCH payload the upload method fee estimate prices. */
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
 * Publish file's Encrypted mode renders this form as its own page body
 * (`shared`), so the file, title, memo and fee the user already set carry
 * across the mode switch and one Publish File press reaches the confirm
 * screen. There the gate token starts unpicked and Publish marks the Token
 * field until one is chosen.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string | null} props.tick         gate ticker (canonical uppercase); null only inside Publish file
 * @param {string | null} [props.issuerAddress]  the token's current owner; publishing from any other address is indexer-rejected
 * @param {() => void} props.onBack
 * @param {GatedPublishShared | null} [props.shared]
 *
 * @typedef {object} GatedPublishShared
 * @property {{ name: string, type: string, bytes: Uint8Array } | null} fileMeta
 * @property {(next: { name: string, type: string, bytes: Uint8Array } | null) => void} setFileMeta
 * @property {string} title
 * @property {(next: string) => void} setTitle
 * @property {string} memo
 * @property {(next: string) => void} setMemo
 * @property {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} feePick
 * @property {(next: any) => void} setFeePick
 * @property {string | null} [uploadPick]            the explicit Upload method pick (null: the default)
 * @property {(next: string | null) => void} [setUploadPick]
 * @property {import('react').ReactNode} modeControl  the Publish as choice, first in the File section
 * @property {string[]} chainIds                     networks offered before a token is picked
 * @property {string} pageTitle
 * @property {string} formLabel
 */
export function GatedPublishForm({ walletId, chainId, tick, issuerAddress = null, onBack, shared = null }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const { isWatcherMode } = useWalletMode();
    const [selectedChainId, setSelectedChainId] = useState(chainId);
    const [gateTick, setGateTick] = useState(tick);
    const [gateOwnerAddress, setGateOwnerAddress] = useState(issuerAddress);
    // The token page hands over the owner it resolved, but a tap on its row
    // can land before that read does, so with no owner handed over the form
    // reads the token record itself (null while the read is in flight).
    const ownerRecord = useTokenInfo({ chainId: selectedChainId, tick: gateTick, skip: !!gateOwnerAddress || !gateTick });
    const ownerAddress = gateOwnerAddress || ownerRecord?.creator || null;
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
    // Inside Publish file the draft belongs to that page, so it survives a
    // switch back to Public; standalone the form holds its own.
    const [ownFileMeta, setOwnFileMeta] = useState(
        /** @type {{ name: string, type: string, bytes: Uint8Array } | null} */ (null),
    );
    const [ownTitle, setOwnTitle] = useState('');
    const [ownMemo, setOwnMemo] = useState('');
    const fileMeta = shared ? shared.fileMeta : ownFileMeta;
    const setFileMeta = shared ? shared.setFileMeta : setOwnFileMeta;
    const title = shared ? shared.title : ownTitle;
    const setTitle = shared ? shared.setTitle : setOwnTitle;
    const memo = shared ? shared.memo : ownMemo;
    const setMemo = shared ? shared.setMemo : setOwnMemo;
    // Set when Publish is pressed before a gate token is picked.
    const [tokenMissing, setTokenMissing] = useState(false);
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
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    // The standard section a refusal belongs to, and a counter bumped
    // on every Publish attempt, so that section reopens on each attempt.
    const [formErrorSection, setFormErrorSection] = useState(/** @type {string | null} */ (null));
    const [reviewAttempt, setReviewAttempt] = useState(0);
    // Open state held above the picker early returns. From starts
    // closed, File open, the rest closed.
    const formSections = useFormSections({ from: false, file: true, memo: false, access: false, fee: false });
    const failIn = (section, message) => {
        setFormError(message);
        setFormErrorSection(section);
    };
    const fileNameReservedError = /[|;]/.test(fileMeta?.name || '')
        ? t('publishFile.fileNameBadCharacters')
        : undefined;
    const titleReservedError = /[|;]/.test(title)
        ? t('publishFile.titleBadCharacters')
        : undefined;
    const memoReservedError = /[|;]/.test(memo)
        ? t('publishFile.memoBadCharacters')
        : undefined;
    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [pendingMultipart, setPendingMultipart] = useState(false);
    const [password, setPassword] = useState('');
    const reviewErrors = useFormErrors();
    const [hwStatus, setHwStatus] = useState('idle');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const credentialRef = useRef(/** @type {HTMLInputElement | null} */ (null));
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
        // The launching token is always offered; Publish file opens with none.
        const launchRows = tick ? [{ chainId, tick, ownerAddress: issuerAddress }] : [];
        if (demoGuard.blocked) {
            setOwnedTokens(launchRows);
            return undefined;
        }
        if (typeof messaging.getOwnedTokens !== 'function') {
            setOwnedTokens(launchRows);
            if (!tick) setOwnedTokensError(t('gatedPublish.tokens.lookupUnavailable'));
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
            const seen = new Set();
            const merged = [];
            for (const row of [...results.flatMap((result) => result.rows), ...launchRows]) {
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
                        ? t(tick ? 'gatedPublish.tokens.lookupFailed' : 'gatedPublish.tokens.lookupFailedNoToken')
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
        setTokenMissing(false);
    }

    // With no gate token yet the network is free to move; once one is
    // picked, the token decides it.
    function handleNetworkChange(nextChainId) {
        const tokenOnChain = (ownedTokens || []).find((token) => token.chainId === nextChainId);
        if (tokenOnChain && gateTick) selectGateToken(tokenOnChain);
        else if (!gateTick) {
            setSelectedChainId(nextChainId);
            setFromOverrideId(null);
        }
    }

    // Reusable packs = pack keys this wallet's vault holds for this tick.
    // (Metadata only; the raw key never leaves the background context.)
    useEffect(() => {
        setPacks(null);
        setPacksError(null);
        if (!gateTick || typeof messaging.listGatedKeys !== 'function') { setPacks([]); return undefined; }
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
        if (ownerAddress) return onChain.find((a) => a.address === ownerAddress) || null;
        return onChain[0] || null;
    }, [addressesByChain, selectedChainId, fromOverrideId, ownerAddress]);
    // Ownership is judged once a gate token is picked; before that the
    // missing token is the refusal, not an unknown owner.
    const issuerEligibility = gateTick
        ? tokenIssuerEligibility({
            tokenInfo: gateOwnerAddress ? { creator: gateOwnerAddress } : ownerRecord,
            addressesByChain,
            chainId: selectedChainId,
            tick: gateTick,
            sourceAddress: fromAddress?.address,
        })
        : { pending: false, error: null, issuerAddress: null };
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
    const [ownFeePick, setOwnFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feePick = shared ? shared.feePick : ownFeePick;
    const setFeePick = shared ? shared.setFeePick : setOwnFeePick;
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
        ...(shared && typeof shared.setUploadPick === 'function'
            ? { picked: shared.uploadPick ?? null, onPick: shared.setUploadPick }
            : {}),
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

    // The File arrives from the file field's dialog or a drop on it.
    function handlePickFile(file) {
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
            setFormError(`That file is ${formatBytes(file.size)}; this publish lane supports up to ${formatBytes(cap, { limit: true })}.`);
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
                setFormError(`That file is ${formatBytes(bytes.length)}; this publish lane supports up to ${formatBytes(cap, { limit: true })}.`);
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

    function handleClearFile() {
        fileReadIdRef.current += 1;
        setFileMeta(null);
        setFormError(null);
    }

    // A file carried over from Public mode was checked against the larger
    // public ceiling, so it is held to the gated one as soon as it arrives
    // here, not only when Publish is pressed.
    const carriedCap = fileMeta && fromAddress ? plainCapFor(fileMeta.name, fileMeta.type) : null;
    const carriedTooLarge = Boolean(shared && fileMeta && carriedCap !== null && fileMeta.bytes.length > carriedCap);
    useEffect(() => {
        if (!carriedTooLarge) return;
        setFormError(t('gatedPublish.carriedTooLarge', {
            bytes: formatBytes(fileMeta.bytes.length),
            max: formatBytes(carriedCap, { limit: true }),
        }));
        setFormErrorSection('file');
        // Keyed on the file and the ceiling, so a new pick or a shorter
        // title re-judges it.
    }, [carriedTooLarge, fileMeta, carriedCap]);

    function formReviewProblem(thresholdValue) {
        if (issuerEligibility.pending) {
            // A tick read before it was issued can sit cached as unknown, so
            // the refused tap asks again.
            if (!gateOwnerAddress) invalidateTokenInfo(selectedChainId, gateTick);
            return ['from', `Wait for the wallet to verify the current owner of ${gateTick}.`];
        }
        if (issuerEligibility.error) {
            // A failed owner read is asked again, so a later tap can pass.
            if (ownerRecord?.loadError) invalidateTokenInfo(selectedChainId, gateTick);
            return ['from', issuerEligibility.error];
        }
        if (!fileMeta) return ['file', 'Pick a file first.'];
        if (!fromAddress) {
            return ['from', ownerMissing
                ? `This wallet does not hold the owner address for ${gateTick}; only the token owner can publish gated files.`
                : 'No signing address available on this network.'];
        }
        const unsafeMetadata = actionTextSafetyError(fileMeta.name, 'File name')
            || actionTextSafetyError(title, 'Title');
        if (unsafeMetadata) return ['file', unsafeMetadata];
        const memoError = memoLengthError(memo.trim());
        if (memoError) return ['memo', memoError];
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) return ['fee', feeStop.formError];
        const thresholdError = thresholdValue
            ? flowsLib.gateMinAmountValidationError(thresholdValue)
            : null;
        if (thresholdError) return ['access', thresholdError];
        const reviewCap = uploadCapFor(fileMeta.name, fileMeta.type);
        if (fileMeta.bytes.length > reviewCap) {
            return ['file',
                `This publish lane supports up to ${formatBytes(reviewCap, { limit: true })} `
                + `and the file is ${formatBytes(fileMeta.bytes.length)}.`,
            ];
        }
        return null;
    }

    async function refreshedGateProblem(thresholdValue) {
        let tokenInfo = null;
        if (typeof messaging.getTokenInfo === 'function') {
            try {
                tokenInfo = await messaging.getTokenInfo({ chainId: selectedChainId, tick: gateTick });
            } catch {
                return ['from', 'Could not refresh token ownership. Check your connection and try again.'];
            }
            if (!tokenInfo?.creator) {
                return ['file', `Could not verify that ${gateTick} still exists. Reopen this screen and try again.`];
            }
            if (tokenInfo.creator !== fromAddress.address) {
                return ['from', `This wallet no longer owns ${gateTick}. Reopen this screen to refresh your tokens.`];
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
            if (divisibilityError) return ['access', divisibilityError];
            if (typeof messaging.getIndexerWatermark !== 'function') {
                return ['access', 'Could not verify that unlock thresholds are active. Try again later.'];
            }
            try {
                const current = await messaging.getIndexerWatermark({ chainId: selectedChainId });
                const height = Number(current?.watermark);
                if (!Number.isFinite(height) || height < thresholdScheduledHeight) {
                    return ['access', 'Unlock thresholds are not active on this network right now. Remove the threshold to continue.'];
                }
            } catch {
                return ['access', 'Could not verify that unlock thresholds are active. Try again later.'];
            }
        }
        return null;
    }

    async function handleReview(event) {
        event.preventDefault();
        setReviewAttempt((n) => n + 1);
        if (!gateTick) {
            setTokenMissing(true);
            setFormErrorSection('file');
            return;
        }
        // Keep reserved metadata errors on their fields instead of adding a
        // second copy in the form's status slot.
        if (fileNameReservedError || titleReservedError || memoReservedError) {
            const section = memoReservedError && !fileNameReservedError && !titleReservedError ? 'memo' : 'file';
            setFormError(null);
            setFormErrorSection(section);
            formSections.setOpen(section, true);
            return;
        }
        const thresholdValue = thresholdActive ? gateMinAmount.trim() : '';
        const problem = formReviewProblem(thresholdValue)
            || await refreshedGateProblem(thresholdValue);
        if (problem) { failIn(...problem); return; }
        const singleCap = plainCapFor(fileMeta.name, fileMeta.type);
        setFormError(null);
        setFormErrorSection(null);
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
            setPendingMultipart(false);
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
        setPendingMultipart(true);
        setStage('review');
    }

    async function startApprovedMultipart() {
        setPendingMultipart(false);
        setStage('form');
        try {
            const singleCap = plainCapFor(fileMeta.name, fileMeta.type);
            const start = multipartStart(singleCap);
            if (start.path !== 'multipart') {
                throw new Error('This file no longer needs a multi-part upload.');
            }
            const reply = await multipartUpload.start(start.request, start.match);
            setResult(completedMultipart(reply));
            setStage('done');
        } catch (error) {
            setStage('form');
            setFormError(userFacingMessage(error, 'Multipart publish failed.'));
        }
    }

    async function handleMultipartSubmit(event) {
        event.preventDefault();
        if (!pendingMultipart || !fileMeta || !fromAddress || multipartUpload.running) return;
        if (!hw && !signerReady && password.length === 0) {
            reviewErrors.validate({ 'gated-publish-password': 'Enter your wallet password.' });
            return;
        }
        if (hw && hwStatus !== 'available') return;
        reviewErrors.reset();
        await startApprovedMultipart();
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
                    compose: () => messaging.composeGatedPublishForConfirm(withAdvancedOptions(base)),
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

    const pageTitle = shared ? shared.pageTitle : t('gatedPublish.title', { tick: gateTick });
    const header = (
        <PageHeader onBack={onBack} title={pageTitle} />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    // The load error and the broadcast result lay out through FormPage like
    // the form stage, so no state draws straight into Screen.
    if (loadError) {
        return wrap(
            <FormPage
                label={pageTitle}
                status={<StatusMessage variant="error">{loadError}</StatusMessage>}
            />,
        );
    }

    // The standard picker, limited to the tokens this wallet owns on any of
    // its networks; the picked token decides the network.
    if (gateTokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                kindFilter="tokens"
                kindLocked
                rows={ownedTokens === null ? null : ownedTokens.map((token) => ({ chainId: token.chainId, tick: token.tick }))}
                emptyTitle={t('gatedPublish.tokens.noneTitle')}
                emptyBody={t('gatedPublish.tokens.noneBody')}
                onSelect={(sel) => {
                    const token = ownedTokens?.find((row) => row.chainId === sel.chainId && row.tick === sel.tick);
                    if (token) selectGateToken(token);
                    setGateTokenPickerOpen(false);
                }}
                onBack={() => setGateTokenPickerOpen(false)}
            />
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
                // The upload method and the permanence fact, as one plain line
                // on the confirm screen under the cost card's fee.
                summary={{
                    verb: 'Publish',
                    chainId: selectedChainId,
                    direction: 'none',
                    address: fromAddress?.address,
                    notice: `${upload.confirmLine} ${t('gatedPublish.confirmNotice', { tick: gateTick })}`,
                }}
                screenVariant={variant}
                chainLabel={descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                // The picked method's estimate for this file, shown only until
                // the composed transactions state their exact fee.
                feeEstimate={upload.fee?.coinAmount ? upload.fee : feeEstimate}
                feeText={(upload.fee?.coinAmount || feeEstimate?.coinAmount)
                    ? t('send.networkFeeValue', {
                        amount: upload.fee?.coinAmount || feeEstimate.coinAmount,
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
                chainId={selectedChainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'review' && pendingMultipart) {
        const minimum = gateMinAmount.trim() || '1';
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label={t('publishFile.reviewLabel')}
                onSubmit={handleMultipartSubmit}
                errors={reviewErrors}
                actions={(
                    <>
                        <Button
                            variant="secondary"
                            type="button"
                            onClick={() => {
                                reviewErrors.reset();
                                setPendingMultipart(false);
                                setStage('form');
                            }}
                        >
                            {t('common.back')}
                        </Button>
                        <Button
                            type="submit"
                            variant="success"
                            icon={<UploadIcon />}
                            aria-disabled={hw && hwStatus !== 'available' ? 'true' : undefined}
                        >
                            {t('publishFile.review.signAndPublish')}
                        </Button>
                    </>
                )}
            >
                <dl className={styles.detailsList}>
                    {descriptor ? (
                        <>
                            <dt className={styles.detailsLabel}>{t('send.fields.chain')}</dt>
                            <dd className={styles.detailsValue}><ChainBadge descriptor={descriptor} size="sm" showName={false} /></dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>{t('gatedPublish.sectionFile')}</dt>
                    <dd className={styles.detailsValue}>
                        {t('gatedPublish.fileMetadata', {
                            name: fileMeta.name,
                            bytes: formatBytes(fileMeta.bytes.length),
                            type: fileMeta.type,
                        })}
                    </dd>
                    <dt className={styles.detailsLabel}>{t('publishFile.review.from')}</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <dt className={styles.detailsLabel}>{t('send.fields.token')}</dt>
                    <dd className={styles.detailsValue}>{gateTick}</dd>
                    <dt className={styles.detailsLabel}>{t('gatedPublish.unlockThreshold')}</dt>
                    <dd className={styles.detailsValue}>{minimum} {gateTick}</dd>
                    <UploadMethodReviewRows
                        upload={upload}
                        labelClassName={styles.detailsLabel}
                        valueClassName={styles.detailsValue}
                    />
                </dl>
                <p className={styles.hint} role="note">{t('gatedPublish.permanentHint')}</p>
                <SignCredentials
                    unlocked={signerReady}
                    fromAddress={fromAddress}
                    chainId={selectedChainId}
                    password={password}
                    onPasswordChange={setPassword}
                    onStatusChange={({ status }) => setHwStatus(status)}
                    passwordRef={credentialRef}
                    passwordFieldId="gated-publish-password"
                    getSignerStatus={messaging.getSignerStatus}
                />
            </FormPage>,
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
    // Closed-section summaries and reveal keys of the standard frame.
    const sectionErrorKey = (section) => (formError && formErrorSection === section && reviewAttempt > 0 ? reviewAttempt : 0);
    const tokenMissingError = tokenMissing && !gateTick ? t('gatedPublish.tokens.pickToken') : undefined;
    const fileSummary = joinSummary(gateTick || t('gatedPublish.tokens.noneSummary'), fileMeta ? fileMeta.name : 'no file yet');
    const packSummary = packChoice === 'new' ? 'New pack' : `Pack ${String(packChoice).slice(0, 8)}...`;
    const accessSummary = joinSummary(
        thresholdActive ? (gateMinAmount.trim() ? `At least ${gateMinAmount.trim()} ${gateTick}` : t('gatedPublish.noThreshold')) : null,
        (packs || []).length > 0 ? packSummary : null,
    );
    // The Access section shows only when it has something to hold.
    const showAccess = thresholdActive || (packs || []).length > 0 || packs === null || Boolean(packsError);
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={shared ? shared.formLabel : t('gatedPublish.gatedContent')}
            onSubmit={handleReview}
            noValidate
            status={[
                formError ? <StatusMessage key="form" variant="error">{formError}</StatusMessage> : null,
                ownerMissing ? (
                    <StatusMessage key="owner" variant="error">
                        {issuerEligibility.error}
                    </StatusMessage>
                ) : null,
            ]}
            action={(
                <FormAction
                    icon={isWatcherMode ? <PlusIcon /> : <UploadIcon />}
                    loading={stage === 'submitting' || multipartUpload.running}
                    // G130: an owner still being checked or not confirmed is
                    // refused at the top of the review handler.
                    disabled={multipartUpload.running}
                >
                    {/* Title Case action label; the palette keeps its own
                        sentence-case string, so the button recases it. */}
                    {titleCase(isWatcherMode ? t('send.review.createUnsigned') : t('palette.createPublishFile.title'))}
                </FormAction>
            )}
            from={(
                /* A picked gate token decides the network, so the Network
                   field locks once there is one; picking a token (or an own
                   address on another network in the From picker) moves it. */
                <FromSection
                    {...formSections.bind('from')}
                    chainId={selectedChainId}
                    chainIds={gateTick ? tokenChainIds : (shared?.chainIds || tokenChainIds)}
                    chainRegistry={chainRegistry}
                    lockNetwork={Boolean(gateTick)}
                    onNetworkChange={handleNetworkChange}
                    networkHelp={t('gatedPublish.networkHelp')}
                    address={fromAddress?.address || null}
                    addressLabel={t('send.fields.from')}
                    addressHelp={t('gatedPublish.fromHelp')}
                    onOpenPicker={() => setFromPickerOpen(true)}
                    pickerLabel={t('send.fromAddress')}
                    revealKey={sectionErrorKey('from')}
                    missing={addressesByChain ? (
                        <FieldNote variant="error">{t('gatedPublish.noAddress', { tick: gateTick })}</FieldNote>
                    ) : null}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    // The fee follows the network the gate token is on.
                    chainId={selectedChainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey('fee')}
                />
            )}
        >
            {/* The main section holds the gate token, title and file. */}
            <FormSection
                id="file"
                title={t('gatedPublish.sectionFile')}
                icon={DocumentIcon}
                {...formSections.bind('file')}
                revealKey={sectionErrorKey('file') || (tokenMissingError ? `gate-token-${reviewAttempt}` : 0)}
                summary={fileSummary}
            >
            {shared ? shared.modeControl : null}
            <TokenField
                label={t('send.fields.token')}
                help={t('gatedPublish.tokenHelp')}
                error={tokenMissingError}
                value={gateTick ? { chainId: selectedChainId, tick: gateTick } : null}
                onOpenPicker={() => setGateTokenPickerOpen(true)}
                disabled={ownedTokens === null}
            />
            {ownedTokens === null && !gateTick ? (
                <p className={styles.hint}>{t('gatedPublish.tokens.lookingUp')}</p>
            ) : null}
            {ownedTokensError ? (
                <FieldNote variant="error">{ownedTokensError}</FieldNote>
            ) : ownedTokens !== null && ownedTokens.length === 0 && !gateTick ? (
                // Only an owner can gate a file, so a wallet with no tokens
                // learns why the list is empty instead of meeting a blank picker.
                <FieldNote variant="info">{t('gatedPublish.tokens.noneToGate')}</FieldNote>
            ) : null}

            {/* How the ciphertext rides the chain; the pick sets the ceiling
                the file field names. */}
            <UploadMethodField upload={upload} disabled={ownerMissing} />
            <MultipartUploadSection
                {...multipartUpload}
                // The page status already names a failed issuer check or form error;
                // a resume-list failure under it would stack a second page message.
                listError={formError || ownerMissing ? null : multipartUpload.listError}
                fallbackMessage={t('gatedPublish.multipartFallback')}
            />

            {/* Title comes before the file, as on Attach artwork. */}
            <Input
                type="text"
                label={t('gatedPublish.titleField')}
                help={t('gatedPublish.titleHelp')}
                optional
                enterKeyHint="next"
                aria-label={t('gatedPublish.titleField')}
                error={titleReservedError}
                errorKey={title}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                disabled={ownerMissing}
            />

            {/* The standard file field; the label names the gated ceiling. */}
            <FileField
                label={t('gatedPublish.fileLimit', {
                    bytes: formatBytes(
                        fileFieldCapFor(
                            fileMeta?.name || `file${'.bin'}`,
                            fileMeta?.type || 'application/octet-stream',
                        ),
                        { limit: true },
                    ),
                })}
                help={(
                    <>
                        {gateTick ? (
                            <>
                                {t('gatedPublish.formHint.beforeToken')} <strong>{gateTick}</strong>{' '}
                                {t('gatedPublish.formHint.afterToken')}{' '}
                            </>
                        ) : `${t('gatedPublish.formHint.noToken')} `}
                        {t('gatedPublish.permanentHint')}
                    </>
                )}
                inputLabel={t('gatedPublish.fileToPublish')}
                fileName={fileMeta?.name || ''}
                error={fileNameReservedError}
                errorKey={fileMeta?.name}
                onFile={handlePickFile}
                onClear={handleClearFile}
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
                            bytes: formatBytes(fileMeta.bytes.length),
                            type: fileMeta.type,
                        })}
                    </p>
                </>
            ) : null}
            {isWatcherMode ? (
                <p className={styles.hint}>
                    {t('gatedPublish.watcherHint')}
                </p>
            ) : null}
            </FormSection>

            {/* Memo is its own optional closed section holding only the memo:
                the section title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey('memo')}
                type="text"
                enterKeyHint={thresholdActive ? 'next' : 'go'}
                value={memo}
                error={memoReservedError}
                errorKey={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={MAX_MEMO_LENGTH}
                disabled={ownerMissing}
            />

            {/* The unlock threshold and the pack choice share one
                optional closed Access section; it shows only when either applies. */}
            {showAccess ? (
            <FormSection
                id="access"
                title={t('gatedPublish.sectionAccess')}
                icon={GearIcon}
                optional
                {...formSections.bind('access')}
                // A pack lookup failure opens Access so its note shows.
                revealKey={sectionErrorKey('access') || (packsError ? 'packs' : 0)}
                summary={packs === null ? t('gatedPublish.pack.loading') : (accessSummary || null)}
            >
            {thresholdActive ? (
                <>
                    <Input
                        type="text"
                        label={t('gatedPublish.unlockThreshold')}
                        help={t('gatedPublish.thresholdHint', { tick: gateTick })}
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

            {/* With no existing pack the only choice is a new one, so
                the Pack question shows only when there is a pack to add to. */}
            {(packs || []).length > 0 ? (
            // The themed dropdown with an icon per option, never radios (G119).
            // Labels stay plain text, since the trigger's name reads the label.
            <IconSelect
                label={t('gatedPublish.pack')}
                help={t('gatedPublish.pack.empty')}
                value={packChoice}
                onChange={(nextValue) => setPackChoice(nextValue)}
                disabled={ownerMissing}
                options={[
                    { value: 'new', label: t('gatedPublish.pack.new'), icon: <PlusIcon /> },
                    ...(packs || []).map((p) => ({
                        value: p.keyHash,
                        label: `${t('gatedPublish.pack.add')} ${String(p.keyHash).slice(0, 12)}…`,
                        sub: t('gatedPublish.pack.unlockTogether'),
                        icon: <KeyIcon />,
                    })),
                ]}
            />
            ) : null}
            {packs === null ? (
                <p className={styles.hint}>{t('gatedPublish.pack.loading')}</p>
            ) : packsError ? (
                <FieldNote variant="error">{packsError}</FieldNote>
            ) : null}
            </FormSection>
            ) : null}
        </FormFrame>,
    );
}
