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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Network, From and the fee selector come from the standard
// FromSection and FeeSection.
import { AddressText, Button, ChainBadge, FormPage, Icon, IconSelect, Input, ListPage, PageHeader, Screen, StatusMessage, useFormErrors } from '@xchain-wallet/core/ui';
// Publish File sits on the Wallet Form Standard frame.
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
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { nativeFeeForFeelessAction } from '../../flows/feeBearingActions.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { FileField } from '../components/FileField.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { GatedPublishForm } from './GatedPublishForm.jsx';
import {
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToPerByte,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop, satsToCoinDecimal } from '../../flows/feeEstimate.js';
import { multipartPairSizes, publicFileCompiledBytes } from '../../flows/uploadMethod.js';
import { UploadMethodField, useUploadMethod } from '../components/UploadMethodField.jsx';
import styles from './IssueTokenForm.module.css';
import publishStyles from './PublishFileForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { formatBytes } from '../utils/formatBytes.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { actionTextSafetyError } from '../utils/actionTextSafety.js';
import { imagePreviewDataUrl, publishFileType } from '../utils/publishingFile.js';
// Eye and Lock give the Publish as options their icons.
import { EyeIcon, LockIcon, UploadIcon } from '../../ui/icons/index.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/composeMessage.js';
import '../../i18n/locales/en/gatedPublish.js';
import '../../i18n/locales/en/publishFile.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/uploadMethod.js';
import {
    UPLOAD_METHOD_TAPROOT,
    standardUnavailableReason,
    taprootUnavailableReason,
    uploadMethodCeilingOpts,
} from '../../flows/uploadMethod.js';
import { useMultipartUploadMethod } from '../hooks/useMultipartUploadMethod.js';
import { useFormMultipartUpload } from '../hooks/useFormMultipartUpload.js';
import { MultipartUploadSection } from '../components/MultipartUploadSection.jsx';
import { multipartQuoteLanes } from '../../flows/multipartQuoteLanes.js';
import { multipartSupportForMethod } from '../../flows/multipartMethodSupport.js';
import { FALLBACK_FILE_NAME } from '../../flows/fileSizeLimits.js';
import { multipartPublishResult } from '../../flows/multipartPublishResult.js';

const chainRegistry = registryLib.defaultRegistry();

/**
 * The file bytes as the Latin-1 binary string the encoder rebuilds verbatim
 * (Buffer.from(rawData, 'binary')).
 *
 * @param {Uint8Array} bytes
 */
function latin1Of(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
}

async function readPickedFile(file) {
    if (typeof file.arrayBuffer === 'function') {
        return new Uint8Array(await file.arrayBuffer());
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('Could not read that file.'));
        reader.onload = () => reader.result instanceof ArrayBuffer
            ? resolve(new Uint8Array(reader.result))
            : reject(new Error('Could not read that file.'));
        reader.readAsArrayBuffer(file);
    });
}

/** The public FILE payload the upload method fee estimate prices. */
function publicUploadBytes(file, { title, memo }) {
    return publicFileCompiledBytes({ name: file.name, type: file.type, title, memo }, file.size);
}

function safeMultipartLanes(descriptor) {
    if (!descriptor) return {};
    try {
        return multipartQuoteLanes({ descriptor });
    } catch {
        return {};
    }
}

function usePublicMultipartMethod({
    descriptor, fromAddress, isWatcherMode, file, title, memo, feeEstimate,
}) {
    const meta = { name: file?.name || FALLBACK_FILE_NAME, type: file?.type || 'application/octet-stream', title, memo };
    const taprootCap = flowsLib.maxPublicFileBytes(meta, uploadMethodCeilingOpts(UPLOAD_METHOD_TAPROOT));
    const standardCap = flowsLib.maxPublicFileBytes(meta, {});
    const singleReasons = {
        taproot: taprootUnavailableReason({ descriptor, fromAddress, isWatcherMode }),
        standard: standardUnavailableReason({
            fileBytes: file?.size ?? null,
            standardCap,
        }),
    };
    const singleFits = {
        taproot: !file || file.size <= taprootCap,
        standard: !file || file.size <= standardCap,
    };
    const rate = feeEstimate?.unit
        ? displayRateToPerByte(feeEstimate.unit, Number(feeEstimate.rateValue))
        : null;
    // The quote prices every part pair and the manifest slot; without these
    // estimators it throws and the field waits forever.
    const sizes = useMemo(() => multipartPairSizes(descriptor), [descriptor]);
    return useMultipartUploadMethod({
        bytes: file?.bytes || null,
        // A file over one transaction is held by reference, so bytes is null.
        size: file?.size ?? null,
        meta,
        rate: Number.isFinite(rate) && rate > 0 ? rate : null,
        descriptor,
        addressRecord: fromAddress,
        addressType: fromAddress?.addressType || fromAddress?.type,
        isWatcherMode,
        singleReasons,
        singleFits,
        lanes: safeMultipartLanes(descriptor),
        sizes,
    });
}

function selectedMultipartSupport(method, descriptor, fromAddress, isWatcherMode) {
    if (!descriptor || !fromAddress) return { supported: false, reason: 'signer' };
    try {
        return multipartSupportForMethod({
            method,
            descriptor,
            addressRecord: fromAddress,
            addressType: fromAddress.addressType || fromAddress.type,
            isWatcherMode,
        });
    } catch {
        return { supported: false, reason: 'signer' };
    }
}

function multipartFrom(fromAddress) {
    if (!fromAddress) return { address: '', publicKey: '' };
    return {
        address: fromAddress.address,
        publicKey: fromAddress.publicKey,
        derivationPath: fromAddress.derivationPath,
        addressId: fromAddress.id,
        source: fromAddress.source,
        signerId: fromAddress.signerId,
        type: fromAddress.addressType || fromAddress.type,
    };
}

function hasMultipartMessaging(messaging) {
    return 'fileMultipart' in messaging && 'listPendingFileUploads' in messaging;
}

/**
 * PC-28 unified "Publish file" form, reachable from ActionsMenu (no
 * token context needed). One surface, an explicit publish-mode choice:
 *
 *   Public (default): a standalone FILE v0 upload - the general lane
 *     AttachContentForm's artwork flow specializes. No LINK leg; pairing
 *     a file to a token stays on the token's own Attach-artwork surface.
 *
 *   Encrypted & token-gated: the same page continues as the PC-25
 *     composition core (GatedPublishForm, given this page's draft), so
 *     the picked file, title, memo and fee carry across the switch and one
 *     Publish File press reaches the confirm screen. Its gate-tick picker
 *     lists only ticks this wallet currently OWNS, because the indexer
 *     rejects gated FILEs from anyone but the tick's issuer (FILE.md
 *     anti-spam rule).
 *
 * Size limits are encoding-aware (flows/fileSizeLimits.js): the ceiling
 * is the 8192-byte compiled ACTION push (consensus), or the Taproot envelope
 * ceiling where the envelope is available, minus this upload's
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
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const { isWatcherMode } = useWalletMode();

    const [mode, setMode] = useState(/** @type {'public' | 'gated'} */ ('public'));
    // The user's explicit Upload method pick, carried across Publish as like
    // the rest of the draft; null means the default (Taproot when available).
    const [uploadPick, setUploadPick] = useState(/** @type {string | null} */ (null));

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the source default resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any>} */ ({}),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));

    const [fileMeta, setFileMeta] = useState(
        /** @type {{ name: string, type: string, bytes: Uint8Array } | null} */ (null),
    );
    const [title, setTitle] = useState('');
    const [memo, setMemo] = useState('');
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [stage, setStage] = useState(
        /** @type {'compose' | 'review' | 'submitting' | 'done'} */ ('compose'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    // The review stage approves a multi-part upload (Decision Q6: one approval
    // covers every wave) when the file is over one transaction.
    const [pendingMultipart, setPendingMultipart] = useState(false);
    const [password, setPassword] = useState('');
    const reviewErrors = useFormErrors();
    const [hwStatus, setHwStatus] = useState('idle');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const fileReadIdRef = useRef(0);

    const [fromOverrideId, setFromOverrideId] = useState(/** @type {string | null} */ (null));
    const [fromPickerOpen, setFromPickerOpen] = useState(false);
    // The standard sections' open state, held above the early
    // returns so it survives the picker and a trip through Encrypted. From closed,
    // File open, Memo and Network fee closed. A refusal names its section and
    // bumps the counter, so that section reopens even after being closed.
    const formSections = useFormSections({ from: false, file: true, memo: false, fee: false });
    const [errorSection, setErrorSection] = useState(/** @type {'from' | 'file' | 'memo' | 'fee' | null} */ (null));
    const [refusalCount, setRefusalCount] = useState(0);
    const refuse = (section, message) => {
        setErrorSection(section);
        setRefusalCount((n) => n + 1);
        setFormError(message);
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
                const chains = Object.entries(byChain || {})
                    .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                    .map(([cid]) => cid);
                if (chains.length === 0) {
                    setLoadError(t('publishFile.loadNoAddress'));
                } else {
                    setChainId((prev) => prev || chains[0]);
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(userFacingMessage(err, t('composeMessage.loadFailed')));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Signing address on the picked chain: the same default as Send and
    // every other spend-from-balance form (any funded address can publish
    // a public FILE; same heuristic as AttachContentForm's file leg). The
    // chain's active address, else the newest HD external, else the first
    // remaining record (a hardware-only wallet). A dispenser-delegated
    // address is never the default; it vends rather than funds.
    const fromAddress = useMemo(() => {
        if (!addressesByChain || !chainId) return null;
        const all = addressesByChain[chainId] || [];
        const override = fromOverrideId ? all.find((a) => a.id === fromOverrideId) : null;
        if (override) return override;
        const funding = all.filter((a) => a.role !== 'dispenser');
        const picked = preferredSourceId(funding, activeByChain[chainId]) || funding[0]?.id || all[0]?.id;
        return all.find((a) => a.id === picked) || null;
    }, [addressesByChain, activeByChain, chainId, fromOverrideId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;

    // Keep the chain-required flag in every submit path without presenting a
    // protocol-fee choice for this feeless action.
    const nativeFee = nativeFeeForFeelessAction(descriptor);
    // Name the coin so a submit refusal identifies which network rejected it.
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
    const multipartAvailable = hasMultipartMessaging(messaging);
    const multipartMethod = usePublicMultipartMethod({
        descriptor,
        fromAddress,
        isWatcherMode,
        file: mode === 'public' ? fileMeta : null,
        title,
        memo,
        feeEstimate,
    });

    // The Upload method the user picks (flows/uploadMethod.js). The Taproot
    // envelope is offered only where a reveal can be signed and carried: a
    // software signer (never hardware, §6), the confirm lane (the watch-only
    // lane builds one unsigned PSBT and no reveal) and a chain whose descriptor
    // does Taproot (BTC yes, DOGE never, LTC once its descriptor enables p2tr).
    // An unusable option stays on the list, disabled with its reason.
    const legacyCapFor = (name, type) => flowsLib.maxPublicFileBytes({ name, type, title, memo }, {});
    const upload = useUploadMethod({
        descriptor,
        fromAddress,
        isWatcherMode,
        feeEstimate,
        coinTicker,
        file: mode === 'public' ? fileMeta : null,
        metadata: { title, memo },
        compiledBytesFor: publicUploadBytes,
        standardCap: fileMeta ? legacyCapFor(fileMeta.name, fileMeta.type) : null,
        multipart: multipartAvailable ? multipartMethod : null,
        picked: uploadPick,
        onPick: setUploadPick,
    });
    const envelopePicked = upload.method === 'taproot';
    const multipartSupport = multipartAvailable
        ? selectedMultipartSupport(upload.method, descriptor, fromAddress, isWatcherMode)
        : { supported: false, reason: 'signer' };
    const selectedSingleCap = flowsLib.maxPublicFileBytes(
        {
            name: fileMeta?.name || FALLBACK_FILE_NAME,
            type: fileMeta?.type || 'application/octet-stream',
            title,
            memo,
        },
        upload.ceilingOpts,
    );
    const multipartUpload = useFormMultipartUpload({
        messaging,
        walletId,
        chainId: chainId || '',
        from: multipartFrom(fromAddress),
        singleTransactionCap: selectedSingleCap,
        support: multipartSupport,
        rate: feeEstimate?.unit
            ? displayRateToPerByte(feeEstimate.unit, Number(feeEstimate.rateValue))
            : undefined,
    });

    // Size the ceiling from the encoding the compose actually requests (PC-28):
    // the envelope ceiling when the picked method asks for AUTO below, the
    // legacy compiled ceiling for Standard.
    const publicCapFor = (name, type) => (multipartSupport.supported
        ? multipartUpload.maxBytes
        : flowsLib.maxPublicFileBytes({ name, type, title, memo }, upload.ceilingOpts));

    useEffect(() => {
        const reply = multipartUpload.result;
        if (!reply) return;
        try {
            const originalBytes = fileMeta?.size || reply.multipart?.total_bytes;
            setResult(multipartPublishResult(reply, { originalBytes }));
            setStage('done');
        } catch (error) {
            setFormError(submitFailureMessage(error, { fallback: 'Publish failed.' }));
        }
    }, [multipartUpload.result, fileMeta]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    // The File arrives from the file field's dialog or a drop on it.
    function handlePickFile(file) {
        setFormError(null);
        if (!file) return;
        const readId = ++fileReadIdRef.current;
        setFileMeta(null);
        // File refusals belong to the File section (refuse reopens it).
        const fileNameError = actionTextSafetyError(file.name || 'file', 'File name');
        if (fileNameError) { refuse('file', fileNameError); return; }
        const { type, error: typeError } = publishFileType(file);
        if (typeError) { refuse('file', typeError); return; }
        const cap = publicCapFor(file.name, type);
        if (file.size === 0) { refuse('file', t('publishFile.fileEmpty')); return; }
        if (file.size > cap) {
            setFileMeta(null);
            refuse('file',
                t('publishFile.fileTooLarge', { size: formatBytes(file.size), cap: formatBytes(cap, { limit: true }) }),
            );
            return;
        }
        const picked = {
            name: file.name || 'file', type, size: file.size, file, bytes: null,
        };
        if (file.size > selectedSingleCap) {
            setFileMeta(picked);
            return;
        }
        readPickedFile(file).then((bytes) => {
            if (readId === fileReadIdRef.current) setFileMeta({ ...picked, bytes });
        }).catch(() => {
            if (readId === fileReadIdRef.current) refuse('file', t('publishFile.fileUnreadable'));
        });
    }

    function handleClearFile() {
        fileReadIdRef.current += 1;
        setFileMeta(null);
        setFormError(null);
    }

    // §5.6: a publish is permanent and a chunked FILE is among the largest
    // payloads the encoder builds, so the output-set tamper check and the
    // pre-flight panel matter here more than anywhere. Watcher keeps the
    // legacy review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'fileAction',
        hardware: 'fileActionHw',
    });

    // Compose, tamper-check and pre-flight run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen(picked = fileMeta) {
        const rawData = latin1Of(picked.bytes);
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        // The same params flows/fileAction.js builds, so the previewed and
        // the submitted composition cannot drift (PC-28).
        const params = flowsLib.fileActionParams({
                    name: picked.name, type: picked.type, title, memo,
        });
        setSubmitError(null);
        try {
            const r = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'FILE', params },
                encoderOpts: {
                    rawData,
                    payFeeInNativeCoin: nativeFee.flag || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    // The picked method's request: Taproot opts in to AUTO and
                    // ASSERTS the signer's tapscript capability rather than letting
                    // AUTO assume it; Standard sends no encoding at all.
                    ...upload.encoderOpts,
                },
                // prebuiltPsbt carries the envelope's reveal and recovery record
                // when AUTO chose TAPROOT, so Approve signs both composed PSBTs.
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    name: picked.name,
                    type: picked.type,
                    title: title.trim() || undefined,
                    memo: memo.trim() || undefined,
                    rawData,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(r);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: err?.message || t('publishFile.failed'),
            }));
        }
    }

    async function handleReview(event) {
        event.preventDefault();
        // Each refusal names the section holding its field, so that
        // section reopens on every attempt.
        if (!fileMeta) { refuse('file', t('publishFile.pickFile')); return; }
        if (!fromAddress) { refuse('from', t('publishFile.noSigner')); return; }
        // Keep reserved metadata errors on their fields instead of adding a
        // second copy in the form's status slot.
        if (fileNameReservedError || titleReservedError || memoReservedError) {
            const section = memoReservedError && !fileNameReservedError && !titleReservedError ? 'memo' : 'file';
            setErrorSection(section);
            setRefusalCount((n) => n + 1);
            setFormError(null);
            formSections.setOpen(section, true);
            return;
        }
        const unsafeMetadata = actionTextSafetyError(fileMeta.name, 'File name')
            || actionTextSafetyError(title, 'Title');
        if (unsafeMetadata) { refuse('file', unsafeMetadata); return; }
        const memoError = memoLengthError(memo);
        if (memoError) { refuse('memo', memoError); return; }
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { refuse('fee', feeStop.formError); return; }
        // Re-check with the FINAL metadata: a title/memo typed after the
        // pick shrinks the byte budget.
        const cap = publicCapFor(fileMeta.name, fileMeta.type);
        if (fileMeta.size > cap) {
            refuse('file',
                t('publishFile.metadataTooLarge', { cap: formatBytes(cap, { limit: true }), size: formatBytes(fileMeta.size) }),
            );
            return;
        }
        setErrorSection(null);
        setFormError(null);
        setSubmitError(null);
        if (fileMeta.size <= selectedSingleCap) {
            let picked = fileMeta;
            if (!picked.bytes) {
                try {
                    picked = { ...picked, bytes: await readPickedFile(picked.file) };
                    setFileMeta(picked);
                } catch {
                    refuse('file', t('publishFile.fileUnreadable'));
                    return;
                }
            }
            if (singleEncode) { openConfirmScreen(picked); return; }
            setPendingMultipart(false);
            setStage('review');
            return;
        }
        setPendingMultipart(true);
        setStage('review');
    }

    // Starts the approved multi-part upload back on the form, whose panel shows
    // each part as it goes; a refusal stays there with its reason.
    async function startMultipartPublish() {
        setPendingMultipart(false);
        setStage('compose');
        try {
            const started = await multipartUpload.startFile({
                file: fileMeta.file,
                meta: { name: fileMeta.name, type: fileMeta.type, title, memo },
            });
            if (started.path === 'multipart') {
                setResult(multipartPublishResult(started.reply, {
                    originalBytes: fileMeta.size,
                }));
                setStage('done');
                return;
            }
            if (started.path === 'refused') {
                refuse('file', 'This account cannot publish a multi-part file with this upload method.');
            }
        } catch (error) {
            refuse('file', submitFailureMessage(error, { fallback: t('publishFile.failed') }));
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!fileMeta || !fromAddress || stage === 'submitting') return;
        if (!isWatcherMode && !hw && !signerReady && password.length === 0) {
            setSubmitError(null);
            reviewErrors.validate({ 'publish-file-password': 'Enter your wallet password.' });
            return;
        }
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        reviewErrors.reset();
        if (pendingMultipart) {
            await startMultipartPublish();
            return;
        }
        // Sign only from the confirm screen, which signs the reviewed PSBT (a
        // review stage left open across a switch out of watcher mode lands here).
        if (!isWatcherMode) {
            setSubmitError(t('publishFile.signOnConfirm'));
            return;
        }
        setStage('submitting');
        setSubmitError(null);
        try {
            const rawData = latin1Of(fileMeta.bytes);
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
            }
            setResult(r);
            setPassword('');
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? t('composeMessage.incorrectPassword') : submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || t('publishFile.failed'),
            }));
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    const chainIds = Object.entries(addressesByChain || {})
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);

    // The Publish as choice heads the File section in both modes. It is the
    // themed dropdown with an icon per option, never radios (G119); each
    // option's description is its secondary line.
    const modeControl = (
        <IconSelect
            label={t('publishFile.publishAs.legend')}
            help={t('publishFile.publishAs.help')}
            value={mode}
            onChange={(next) => {
                // Picking the current mode again changes nothing, as a radio did.
                if (next === mode) return;
                setFormError(null);
                setErrorSection(null);
                setMode(next);
            }}
            options={[
                {
                    value: 'public',
                    label: t('publishFile.publishAs.public'),
                    icon: <EyeIcon />,
                    sub: t('publishFile.publishAs.publicDescription'),
                },
                {
                    value: 'gated',
                    label: t('publishFile.publishAs.gated'),
                    icon: <LockIcon />,
                    sub: t('publishFile.publishAs.gatedDescription'),
                },
            ]}
        />
    );

    // Encrypted mode is the gated composition core drawn as this same page:
    // it is handed the draft (file, title, memo, fee), so nothing typed or
    // picked is lost across the switch, and its Publish File goes straight
    // to the confirm screen. It signs from the gate token's owner, so the
    // public From choice does not carry over.
    if (mode === 'gated' && addressesByChain && !loadError) {
        return (
            <GatedPublishForm
                walletId={walletId}
                chainId={chainId}
                tick={null}
                issuerAddress={null}
                onBack={onBack}
                shared={{
                    fileMeta,
                    setFileMeta,
                    title,
                    setTitle,
                    memo,
                    setMemo,
                    feePick,
                    setFeePick,
                    uploadPick,
                    setUploadPick,
                    modeControl,
                    chainIds,
                    pageTitle: t('publishFile.title'),
                    formLabel: t('publishFile.formLabel'),
                }}
            />
        );
    }

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel={t('common.back')}
            title={stage === 'review' || stage === 'submitting' ? t('publishFile.titleReview') : t('publishFile.title')}
        />
    );
    const wrap = (children) => (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={!(stage === 'review' || stage === 'submitting')}
        >
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(<ListPage notices={<StatusMessage variant="error">{loadError}</StatusMessage>} />);
    }
    if (!addressesByChain) {
        return wrap(<ListPage><p className={styles.hint}>{t('composeMessage.loadingWallet')}</p></ListPage>);
    }

    // Confirm page, rendered in place of the form; the picked file and the
    // typed metadata stay intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                // The upload method and the permanence fact as one plain
                // confirm-screen line; the cost card above it carries the fee.
                summary={{
                    verb: 'Publish',
                    chainId,
                    direction: 'none',
                    address: fromAddress?.address,
                    notice: `${upload.confirmLine} ${t('publishFile.confirm.notice')}`,
                }}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
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
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        // The encoder REPORTS what compression did; the wallet must not infer it,
        // because with the default ON neither asking nor not asking tells you what
        // actually happened (§5.2 keeps the compressed form only when it is smaller).
        const storedLine = flowsLib.storedSizeLine(
            flowsLib.storedSizeSummary(result?.compression, fileMeta?.size),
        );
        if (result?.psbtHex && !result?.txid) {
            return wrap(
                <ListPage>
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={() => { setResult(null); setStage('compose'); }}
                        onDone={onBack}
                    />
                </ListPage>,
            );
        }
        const txid = result?.txid || result?.broadcast?.txid || null;
        // A queued result is SIGNED and not broadcast: the confirm lane
        // resolves a transient broadcast failure that way, and "File
        // published" would claim a permanent publish that never happened.
        if (result?.queued) {
            return wrap(
                <ListPage>
                    <ResultScreen state="signed-not-broadcast" onDone={onBack} what={t('publishFile.queuedWhat')} unsaved={result.unsaved} />
                </ListPage>,
            );
        }
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>{t('publishFile.done.title')}</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>{t('publishFile.done.transaction')}</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                {result?.actionIndex ? (
                    <>
                        <p className={styles.successLabel}>{t('publishFile.done.actionIndex')}</p>
                        <code className={styles.txid}>{result.actionIndex}</code>
                    </>
                ) : null}
                {storedLine ? (
                    /* The size the user actually paid for. Compression is
                       on by default, so this is routinely a fraction of the file they
                       picked and there is no other way for them to find that out. */
                    <p className={styles.hint}>{storedLine}</p>
                ) : null}
                <p className={styles.hint}>{t('publishFile.done.hint')}</p>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>{t('common.done')}</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const reviewPreviewUrl = imagePreviewDataUrl(fileMeta?.bytes);
        const multipartQuote = pendingMultipart ? multipartMethod?.options?.[upload.method] : null;
        const reviewFeeText = pendingMultipart
            ? (Number.isFinite(multipartQuote?.fee)
                ? `${satsToCoinDecimal(multipartQuote.fee)} ${coinTicker}`.trim()
                : null)
            : upload.feeText;
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label={t('publishFile.reviewLabel')}
                onSubmit={handleSubmit}
                errors={reviewErrors}
                status={(isWatcherMode || hw) && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <>
                        {/* Prevent the reconciled button from submitting the compose form. */}
                        <Button variant="secondary" type="button" onClick={(event) => { event.preventDefault(); setStage('compose'); }} disabled={stage === 'submitting'}>
                            {t('common.back')}
                        </Button>
                        <Button
                            type="submit"
                            variant="success"
                            icon={<UploadIcon />}
                            loading={stage === 'submitting'}
                            aria-disabled={!isWatcherMode && hw && hwStatus !== 'available' ? 'true' : undefined}
                        >
                            {isWatcherMode
                                ? t('publishFile.review.createUnsigned')
                                : t('publishFile.review.signAndPublish')}
                        </Button>
                    </>
                )}
            >
                {reviewPreviewUrl ? (
                    <img
                        src={reviewPreviewUrl}
                        alt={fileMeta?.name ? t('publishFile.previewAlt', { name: fileMeta.name }) : t('publishFile.previewAltFile')}
                        width={160}
                        height={160}
                        loading="lazy"
                        decoding="async"
                        className={publishStyles.reviewPreview}
                    />
                ) : null}
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
                            name: fileMeta?.name.trim(),
                            bytes: formatBytes(fileMeta?.size),
                            type: fileMeta?.type,
                        })}
                    </dd>
                    {title.trim() ? (
                        <>
                            <dt className={styles.detailsLabel}>{t('gatedPublish.titleField')}</dt>
                            <dd className={styles.detailsValue}>{title.trim()}</dd>
                        </>
                    ) : null}
                    {memo ? (
                        <>
                            <dt className={styles.detailsLabel}>{t('send.memo')}</dt>
                            <dd className={styles.detailsValue}>{memo}</dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>{t('publishFile.review.from')}</dt>
                    <dd className={styles.detailsValue}>
                        {fromAddress ? <AddressText address={fromAddress.address} /> : null}
                    </dd>
                    <dt className={styles.detailsLabel}>{t('uploadMethod.label')}</dt>
                    <dd className={styles.detailsValue} data-testid="review-upload-method">
                        {pendingMultipart && multipartQuote?.summary
                            ? `${upload.label}, ${multipartQuote.summary}`
                            : upload.label}
                    </dd>
                    {reviewFeeText ? (
                        <>
                            <dt className={styles.detailsLabel}>{t('uploadMethod.review.fee')}</dt>
                            <dd className={styles.detailsValue} data-testid="review-upload-fee">{reviewFeeText}</dd>
                        </>
                    ) : null}
                </dl>
                <p className={styles.hint} role="note">{t('publishFile.review.permanent')}</p>
                {isWatcherMode ? (
                    <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
                        onStatusChange={({ status }) => setHwStatus(status)}
                        passwordRef={passwordRef}
                        passwordFieldId="publish-file-password"
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
            </FormPage>,
        );
    }

    // stage === 'compose'
    // Before a file is picked, size the hint with a stand-in name of the same length as a typical one;
    // it has no dot, so the key checker does not read it as a translation key.
    const capHint = publicCapFor(fileMeta?.name || 'file_bin', fileMeta?.type || 'application/octet-stream');
    const previewUrl = imagePreviewDataUrl(fileMeta?.bytes);

    if (fromPickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title={t('send.fromAddress')}
                walletId={walletId}
                chainId={chainId}
                onChainChange={(nextChainId) => {
                    setChainId(nextChainId);
                    setFromOverrideId(null);
                }}
                onPick={(address) => {
                    setFromOverrideId(address.id);
                    setFromPickerOpen(false);
                }}
                onBack={() => setFromPickerOpen(false)}
            />
        );
    }

    const sectionErrorKey = (id) => (errorSection === id && formError ? refusalCount : 0);
    const fileSummary = joinSummary(t('publishFile.publishAs.public'), title.trim() || null, fileMeta?.name || null);
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={t('publishFile.formLabel')}
            onSubmit={handleReview}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            action={(
                // The same action as Encrypted mode, a verb in Title Case.
                <FormAction
                    icon={<UploadIcon />}
                    loading={actionConfirm.composing || multipartUpload.running}
                    // A multi-part file waits for its quote, so the review
                    // can name its parts, transactions and whole fee.
                    disabled={actionConfirm.composing || multipartUpload.running
                        || (multipartAvailable && !multipartMethod.ready)}
                >
                    {multipartUpload.running
                        ? t('publishFile.publishing')
                        : actionConfirm.composing ? t('composeMessage.preparingReview') : t('publishFile.title')}
                </FormAction>
            )}
            /* The standard order: From (Network and address), File (Publish as,
               Title, file), optional Memo, then the Network fee row. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={chainIds}
                    chainRegistry={chainRegistry}
                    onNetworkChange={(nextChainId) => {
                        setChainId(nextChainId);
                        setFromOverrideId(null);
                    }}
                    networkHelp={t('publishFile.from.networkHelp')}
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setFromPickerOpen(true)}
                    pickerLabel={t('send.source.choose')}
                    addressHelp={t('publishFile.from.addressHelp')}
                    revealKey={sectionErrorKey('from')}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey('fee')}
                />
            )}
        >
            <FormSection
                id="file"
                title={t('gatedPublish.sectionFile')}
                icon={UploadIcon}
                {...formSections.bind('file')}
                revealKey={sectionErrorKey('file')}
                summary={fileSummary}
            >
            {modeControl}
            {/* How the bytes ride the chain, before the file: the pick sets the
                ceiling the file field names. */}
            <UploadMethodField upload={upload} />
            {/* Title, File, Memo and the fee stay on the page in both modes. */}
            {(
                <>
                    {multipartAvailable ? (
                        <MultipartUploadSection
                            {...multipartUpload.sectionProps}
                            fallbackMessage={t('publishFile.multipartFallback')}
                        />
                    ) : null}
                    {/* Title comes before the file. */}
                    <Input
                        label={t('gatedPublish.titleField')}
                        optional
                        help={t('publishFile.titleField.help')}
                        error={titleReservedError}
                        errorKey={title}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        autoComplete="off"
                        maxLength={100}
                    />
                    {/* The standard file field; the label names the ceiling
                        for this title, memo and encoding. */}
                    <FileField
                        label={t('publishFile.fileField.label', { cap: formatBytes(capHint, { limit: true }) })}
                        inputLabel={t('gatedPublish.fileToPublish')}
                        fileName={fileMeta?.name || ''}
                        error={fileNameReservedError}
                        errorKey={fileMeta?.name}
                        onFile={handlePickFile}
                        onClear={handleClearFile}
                        help={`${t('publishFile.fileField.help', { cap: formatBytes(capHint, { limit: true }) })} ${
                            envelopePicked
                                ? t('publishFile.fileField.helpEnvelope')
                                : t('publishFile.fileField.helpLegacy')}`}
                    />
                    {fileMeta ? (
                        <>
                            {previewUrl ? (
                                <img
                                    src={previewUrl}
                                    alt={t('publishFile.previewAlt', { name: fileMeta.name })}
                                    width={160}
                                    height={160}
                                    loading="lazy"
                                    decoding="async"
                                    className={publishStyles.composePreview}
                                />
                            ) : null}
                            <dl className={styles.detailsList}>
                                <dt className={styles.detailsLabel}>{t('gatedPublish.sectionFile')}</dt>
                                <dd className={styles.detailsValue}>{fileMeta.name}</dd>
                                <dt className={styles.detailsLabel}>{t('publishFile.details.type')}</dt>
                                <dd className={styles.detailsValue}>{fileMeta.type}</dd>
                                <dt className={styles.detailsLabel}>{t('publishFile.details.size')}</dt>
                                <dd className={styles.detailsValue}>{t('publishFile.details.bytes', { bytes: formatBytes(fileMeta.size) })}</dd>
                            </dl>
                        </>
                    ) : null}
                </>
            )}
            </FormSection>
            {/* Memo is its own optional section, closed, holding only the
                memo: the section title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey('memo')}
                maxLength={MAX_MEMO_LENGTH}
                error={memoReservedError}
                errorKey={memo}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />
        </FormFrame>,
    );
}
