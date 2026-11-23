// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';
import { isExactTypedConfirmation } from '../../flows/typedConfirmation.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Network, From, the fee selector and the section frame come from the Form Standard.
import { AddressField, Button, FieldNote, FormNotice, FormPage, Icon, InfoTip, Input, Notice, NoticeList, OptionSwitch, OptionSwitchList, PageHeader, Screen, StatusMessage, useFormErrors } from '@xchain-wallet/core/ui';
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    MemoSection,
    SummaryAddress,
    joinSummaryParts,
    useFormSections,
} from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/components.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useFocusNoticeOnAttempt } from '../hooks/useFocusNoticeOnAttempt.js';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { prebuiltPsbtFromComposed } from '../../flows/prebuiltPsbtFromComposed.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import {
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { detectAddressCoin, isValidAddressForChain } from '../utils/addressValidation.js';
import { gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { isDemoGatedActionIndex } from '../../flows/demoGatedContent.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import styles from './IssueTokenForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { markMigrationSwept } from '../../flows/migrationSweeps.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};
const COIN_DISPLAY = { bitcoin: 'Bitcoin', litecoin: 'Litecoin', dogecoin: 'Dogecoin' };

// Mirrors Send.jsx's checksum-level destination validation: a SWEEP
// routes EVERYTHING selected to this one address, so a typo costs the
// whole address's holdings, not one send's worth.
function destinationAddressError(address, descriptor) {
    const a = (address || '').trim();
    if (!a || !descriptor?.coin || !descriptor?.networkKind) return null;
    if (isValidAddressForChain(a, descriptor.coin, descriptor.networkKind)) return null;
    const chainName = COIN_DISPLAY[descriptor.coin] || descriptor.coin;
    const detected = detectAddressCoin(a);
    if (detected && detected !== descriptor.coin) {
        return `This looks like a ${COIN_DISPLAY[detected] || detected} address, not a ${chainName} address.`;
    }
    return `This is not a valid ${chainName} address. Check it for typos.`;
}

// Bech32 is case-insensitive and a QR code carries it in capitals, but its
// canonical form is lowercase, which is the form the wallet derives and
// compares. Left as typed, the capitalised copy of the source address slipped
// past the same-as-source guard, was announced as a third party's address, and
// went into the action string in a spelling nothing else uses. An address that
// is only valid as its lowercase form is canonicalised; anything else, base58
// included, is left exactly as entered.
function canonicalDestination(address, descriptor) {
    const a = (address || '').trim();
    const lower = a.toLowerCase();
    if (a === lower || a !== a.toUpperCase()) return a;
    if (!descriptor?.coin || !descriptor?.networkKind) return a;
    return isValidAddressForChain(lower, descriptor.coin, descriptor.networkKind) ? lower : a;
}

const CATEGORY_META = [
    { key: 'balances', label: 'Token balances', icon: 'CoinsIcon', defaultOn: true, hint: 'Every token balance this address holds.' },
    { key: 'ownerships', label: 'Token ownerships', icon: 'KeyIcon', defaultOn: true, hint: 'Issuer control of every token this address owns.' },
    { key: 'orders', label: 'Open orders (force-close)', icon: 'MarketIcon', defaultOn: false, hint: 'Cancels every open order; escrow goes to the destination.' },
    { key: 'swaps', label: 'Open swaps (force-close)', icon: 'SwapIcon', defaultOn: false, hint: 'Cancels every open swap; escrow goes to the destination.' },
    { key: 'dispensers', label: 'Open dispensers (force-close)', icon: 'TokenIcon', defaultOn: false, hint: 'Closes every open dispenser (1-hour close window); remaining escrow goes to the destination.' },
];

/**
 * Dedicated SWEEP form (PC-34).
 *
 * Moves token balances, token ownerships, and (by flag) force-closes
 * open orders / swaps / dispensers from one address, routing everything
 * (escrow included) to a single destination. The API-derived counts are
 * a snapshot: SWEEP moves whatever the chain says at confirmation time,
 * so the typed confirm covers everything in the selected categories.
 *
 * Migrate lane (`migrateTo` set, from MigrateToBip39): destination is
 * locked to the new wallet's matching address and the gated-content
 * gate arms - on-chain key handoffs are ECIES-encrypted to the OLD
 * addresses, so any gated unlock key must sit in the vault (and be
 * re-scoped to the new wallet) BEFORE the sweep; recovery from the new
 * seed alone is impossible afterwards. Software signers can run the
 * PC-26 recovery scan inline; HW / watch-only degrade to a per-tick
 * warning (§5 signer note).
 *
 * @param {object} props
 * @param {string} props.walletId                     signing wallet (the LEGACY wallet in the migrate lane)
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialFromAddress]
 * @param {string} [props.initialDestination]
 * @param {{ walletId: string, name?: string, address: string } | null} [props.migrateTo]
 */
export function SweepForm({
    walletId, onBack, initialChainId, initialFromAddress, initialDestination, migrateTo = null,
}) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);
    const migrateLane = !!migrateTo;

    const {
        addressesByChain,
        loadError,
        chainId,
        setChainId,
        fromAddress,
        setFromAddressId,
        chainsWithAddresses,
        descriptor,
        signerReady,
        isWatcherMode,
        isHwSource,
        hwStatus,
        onHwStatusChange,
        buildFrom,
        submit,
    } = useActionForm({
        walletId,
        action: 'SWEEP',
        submitMethods: { hw: 'sweepTokenHw', software: 'sweepToken' },
        initialChainId,
        initialFromAddress,
        // Migrate lane arrives chain-locked (one sweep per chain row).
        lockedToken: migrateLane,
        noAddressMessage:
            'No addresses on any network yet. Use Receive to generate one before sweeping.',
    });

    const [destination, setDestination] = useState(
        (initialDestination || migrateTo?.address || '').trim(),
    );
    const [flags, setFlags] = useState(() => Object.fromEntries(
        CATEGORY_META.map((c) => [c.key, c.defaultOn]),
    ));
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
    // The Form Standard's open state per section, held here so it
    // survives the address picker pages. Only the main section starts open.
    const formSections = useFormSections({ from: false, sweep: true, keys: false, memo: false, fee: false });
    // A refused review names the section that holds the field, and
    // each attempt reopens it even after the user closed it.
    const [refusedIn, setRefusedIn] = useState({ section: null, attempt: 0 });
    const sectionReveal = (id) => (refusedIn.section === id ? refusedIn.attempt : 0);

    // Typed-confirmation gate: SWEEP moves everything at once, so it
    // rides the same typed-word rail as DESTROY.
    const [typedConfirm, setTypedConfirm] = useState('');
    const typedConfirmOk = isExactTypedConfirmation(typedConfirm, 'SWEEP');

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (SWEEP is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

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

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const formErrors = useFormErrors();
    // The Sweep button sits below every section, so on a short popup a
    // refusal shown in the form status at the top is out of view; each
    // refused attempt moves focus to that status and scrolls it in.
    const markReviewAttempt = useFocusNoticeOnAttempt();
    const destinationRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // D-58: every form-level error names the state of one field,
    // so the moment any of them is edited the message can already be
    // false. Leaving it up meant an emptied destination sat under "This
    // is not a valid Bitcoin regtest address", which is not what was
    // wrong with it. Editing clears; the next submit re-derives.
    const clearFormError = useCallback(() => {
        setFormError((prev) => (prev === null ? prev : null));
    }, []);

    // Load snapshot counts from the sweep preview host route.
    const [preview, setPreview] = useState(/** @type {any | null} */ (null));
    const [previewError, setPreviewError] = useState(/** @type {string | null} */ (null));
    const [previewLoading, setPreviewLoading] = useState(false);
    const previewRequestRef = useRef(0);
    useEffect(() => {
        const requestId = ++previewRequestRef.current;
        setPreview(null);
        setPreviewError(null);
        const address = fromAddress?.address;
        if (!chainId || !address) {
            setPreviewLoading(false);
            return undefined;
        }
        setPreviewLoading(true);
        // The promise boundary handles transports that throw before returning
        // a promise. The request id keeps an older address lookup from
        // replacing the preview for a source selected while it is in flight.
        Promise.resolve()
            .then(() => messaging.sweepPreview({ chainId, address }))
            .then((p) => {
                if (previewRequestRef.current === requestId) {
                    setPreview(p);
                    setPreviewError(null);
                }
            })
            .catch(() => {
                // A count failure never blocks the sweep; the typed confirm
                // already covers all holdings in the selected categories.
                if (previewRequestRef.current === requestId) {
                    setPreviewError('Counts unavailable.');
                }
            })
            .finally(() => {
                if (previewRequestRef.current === requestId) setPreviewLoading(false);
            });
        return () => {
            if (previewRequestRef.current === requestId) previewRequestRef.current += 1;
        };
    }, [messaging, chainId, fromAddress?.address]);

    const gatedTicks = useMemo(() => (
        Array.isArray(preview?.gatedTicks?.rows) ? preview.gatedTicks.rows : []
    ), [preview]);

    // ---- Migrate gate: vault custody of gated unlock keys ----
    // Per gated tick: which of its packs have a key row in THIS wallet's
    // vault. Verified keys are re-scoped (copied) to the new wallet in
    // the same pass; missing ones can be recovered by the PC-26 scan
    // (software signers) or acknowledged (HW / watch-only, degraded gate).
    const [gateRows, setGateRows] = useState(
        /** @type {Array<{ tick: string, packCount: number, missingCount: number, missingKeyHashes: string[], checkError?: string }> | null} */ (null),
    );
    const [gateLoading, setGateLoading] = useState(false);
    const [gateCopied, setGateCopied] = useState(0);
    const [gateCheckSeq, setGateCheckSeq] = useState(0);
    const [scanPassword, setScanPassword] = useState('');
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        if (!migrateLane || !chainId || gatedTicks.length === 0) { setGateRows(null); return undefined; }
        let cancelled = false;
        setGateLoading(true);
        (async () => {
            const rows = [];
            for (const tick of gatedTicks) {
                try {
                    const groups = (await messaging.listGatedContent({ chainId, tick })).filter((g) => {
                        const files = Array.isArray(g?.files) ? g.files : [];
                        return files.length > 0 && !files.every((f) => isDemoGatedActionIndex(f.actionIndex));
                    });
                    const wanted = new Set(groups.map((g) => String(g.keyHash).toLowerCase()));
                    const held = await messaging.listGatedKeys({ walletId, chainId, gateTicker: tick });
                    const have = new Set((Array.isArray(held) ? held : [])
                        .map((r) => String(r.keyHash).toLowerCase()));
                    const missingKeyHashes = [...wanted].filter((hash) => !have.has(hash));
                    rows.push({
                        tick,
                        packCount: wanted.size,
                        missingCount: missingKeyHashes.length,
                        missingKeyHashes,
                    });
                } catch {
                    // Unknown state fails toward "missing" so the gate warns
                    // rather than green-lighting an unverified tick.
                    rows.push({
                        tick,
                        packCount: 1,
                        missingCount: 1,
                        missingKeyHashes: [],
                        checkError: 'Could not determine which unlock key is missing.',
                    });
                }
            }
            if (cancelled) return;
            setGateRows(rows);
            // Custody leg: re-scope every key this vault already holds to
            // the migration-target wallet (idempotent; counts only).
            try {
                const res = await messaging.copyGatedKeysToWallet({
                    fromWalletId: walletId,
                    toWalletId: migrateTo.walletId,
                    chainId,
                });
                if (!cancelled) setGateCopied((res?.copied || 0) + (res?.skipped || 0));
            } catch { /* custody copy is best-effort; the gate rows still gate */ }
        })().finally(() => { if (!cancelled) setGateLoading(false); });
        return () => { cancelled = true; };
    }, [messaging, migrateLane, chainId, walletId, migrateTo?.walletId, gatedTicks, gateCheckSeq]);

    const gateMissingTicks = useMemo(() => (
        (gateRows || []).filter((r) => r.missingCount > 0).map((r) => r.tick)
    ), [gateRows]);
    // The form carries no acknowledgement gate: it waits only for the vault
    // check to finish. Keys still missing then are said on the confirm screen
    // as a notice (missingKeysNotice), not ticked off on the form.
    const gateSatisfied = !migrateLane
        || gatedTicks.length === 0
        || gateRows != null;
    const missingKeysNotice = migrateLane && gateMissingTicks.length > 0
        ? t('send.sweep.missingKeysNotice', { ticks: gateMissingTicks.join(', ') })
        : null;
    const canScan = migrateLane && !isWatcherMode && !isHwSource && gateMissingTicks.length > 0;

    async function handleRecoverKeys() {
        if (!canScan || scanning) return;
        if (!formErrors.validate({
            'sweep-recovery-password': scanPassword.length === 0
                ? 'Enter the wallet password to scan.'
                : null,
        })) return;
        setScanning(true);
        setScanError(null);
        try {
            for (const tick of gateMissingTicks) {
                await messaging.gatedContentScan({
                    walletId, password: scanPassword, chainId, tick,
                });
            }
            setScanPassword('');
            setGateCheckSeq((n) => n + 1); // re-check presence + re-copy
        } catch (err) {
            setScanError(err?.name === 'InvalidPasswordError' || err?.name === 'WrongPasswordError'
                ? 'Incorrect password.'
                : 'Could not recover unlock keys. Check your connection and try again.');
        } finally {
            setScanning(false);
        }
    }

    // ---- Destination rails ----
    const destTrimmed = canonicalDestination(destination, descriptor);
    const destFormatError = destinationAddressError(destTrimmed, descriptor);
    const destinationIsOwn = useMemo(() => {
        if (!destTrimmed || !chainId || !addressesByChain) return false;
        return (addressesByChain[chainId] || []).some((a) => a.address === destTrimmed);
    }, [destTrimmed, chainId, addressesByChain]);
    // Loud third-party path: a valid destination the signing wallet does
    // not own. The migrate lane's destination belongs to the NEW wallet
    // (own by construction), so it shows an info line instead.
    const thirdPartyDestination = !migrateLane && destTrimmed.length > 0
        && !destFormatError && !destinationIsOwn;

    const selectedCount = CATEGORY_META.filter((c) => flags[c.key]).length;
    const selectedPreviewEmpty = preview != null && selectedCount > 0
        && CATEGORY_META.filter((c) => flags[c.key]).every((c) => {
            const category = preview[c.key];
            return category && !category.error && Array.isArray(category.rows)
                && category.rows.length === 0;
        });
    const selectedPreviewUnavailable = CATEGORY_META.some(
        (category) => flags[category.key] && preview?.[category.key]?.error,
    );

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = {
            VERSION: '0',
            DESTINATION: destTrimmed,
            BALANCES: flags.balances ? '1' : '0',
            OWNERSHIPS: flags.ownerships ? '1' : '0',
            ORDERS: flags.orders ? '1' : '0',
            SWAPS: flags.swaps ? '1' : '0',
            DISPENSERS: flags.dispensers ? '1' : '0',
        };
        if (memo.trim().length > 0) p.MEMO = memo.trim();
        return p;
    }, [destTrimmed, flags, memo]);
    const quoteActionData = useMemo(() => {
        const trimmed = memo.trim();
        const memoValid = !/[|;]/.test(trimmed) && !memoLengthError(trimmed);
        if (!chainId || !fromAddress || !destTrimmed || destFormatError
            || destTrimmed === fromAddress.address || selectedCount === 0 || !memoValid) return null;
        return { action: 'SWEEP', params: actionParams };
    }, [actionParams, chainId, destFormatError, destTrimmed, fromAddress, memo, selectedCount]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });

    // Flow-shaped opts for the software / HW submit paths (the watcher
    // path encodes from `actionParams` instead; useActionForm keeps the
    // two payload shapes explicit).
    const flowOpts = useMemo(() => ({
        to: destTrimmed,
        balances: flags.balances,
        ownerships: flags.ownerships,
        orders: flags.orders,
        swaps: flags.swaps,
        dispensers: flags.dispensers,
        ...(memo.trim().length > 0 ? { memo: memo.trim() } : {}),
        ...(feePerKb != null ? { feePerKb } : {}),
        payFeeInNativeCoin: nativeFee.flag,
    }), [destTrimmed, flags, memo, feePerKb, nativeFee.flag]);

    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    const decoded = useMemo(() => {
        // residual (§5.6 slice 5): the confirm page renders the intent
        // the HOST described from the composed action string
        // (`composed.decoded`), so this local describer serves the LEGACY
        // review stage only - the watcher, demo and locked-ECDH path. It used
        // to also recompute while the confirm page was open, which was work
        // nothing read and, worse, read like the confirm surface still
        // depended on form state.
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'SWEEP',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, confirmModalOpen, actionParams, chainId]);
    const sweepReviewDecoded = useMemo(() => {
        if (!decoded) return null;
        const warnings = [...(decoded.warnings || [])];
        if (thirdPartyDestination) {
            warnings.push("This destination is not one of this wallet's addresses. Everything selected will belong to that address's owner. Triple-check it before approving.");
        }
        if (!migrateLane) warnings.push(...gatedTicks.map((tick) => gatedTickWarningCopy(tick, 'sweep recipients')));
        if (missingKeysNotice) warnings.push(missingKeysNotice);
        return { ...decoded, warnings };
    }, [decoded, gatedTicks, migrateLane, missingKeysNotice, thirdPartyDestination]);
    const legacyComposed = useMemo(() => (sweepReviewDecoded ? {
        action: 'SWEEP',
        chainId,
        decoded: sweepReviewDecoded,
        protocolFeeKnownFree: true,
    } : null), [chainId, sweepReviewDecoded]);

    // The migration list marks this legacy address once its sweep is on the
    // network. A queued or unsigned result has not moved anything yet.
    function noteMigrationSweep(res) {
        const sweptTxid = res?.txid || res?.broadcast?.txid;
        if (!migrateLane || !sweptTxid || res?.queued) return;
        try {
            markMigrationSwept(walletId, {
                newWalletId: migrateTo.walletId,
                chainId,
                fromAddress: fromAddress?.address,
                txid: sweptTxid,
            });
        } catch { /* best-effort list metadata */ }
    }

    async function openConfirmModal() {
        const from = buildFrom();
        if (!chainId || !from) return;
        setSubmitError(null);
        setTypedConfirm('');
        try {
            const res = await confirmAction.confirm({
                chainId,
                source: from.address,
                preflightOpts: {
                    mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report',
                },
                compose: () => messaging.composeForConfirm(withAdvancedOptions({
                    walletId,
                    chainId,
                    from,
                    actionData: { action: 'SWEEP', params: actionParams },
                    // PC-51: the opt-in must reach COMPOSE so the FEE_DESTINATION
                    // output sits inside the PSBT the user approves.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                })),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                // §4.6: the input-liveness half of the Approve-time re-check,
                // the same one useActionConfirmFlow.run gives every migrated form.
                checkInputs: (psbtHex) => messaging.checkInputLiveness({ chainId, psbtHex }),
                releaseEncoderInputs: (token) => messaging.releaseEncoderInputs({ token }),
                // §4.7: reserve the debited balance on the host-shared ledger,
                // so two windows cannot both approve against the same balance.
                reservationLedger: {
                    reserve: (e) => messaging.reserve(e),
                    release: (id) => messaging.releaseReservation({ id }),
                },
                // Re-price the native-coin protocol fee at Approve.
                // The output was sized at compose, and the amount consensus
                // requires moves inversely with the coin price, so a move while
                // the confirm screen sits open leaves it short - which the
                // chain rejects while keeping the fee.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
                onApprove: (_creds, composed) => submit({
                    params: actionParams,
                    password: passwordValueRef.current,
                    extraBase: {
                        ...flowOpts,
                        // The shared mapping, envelope and deferred outputs included.
                        prebuiltPsbt: prebuiltPsbtFromComposed(composed),
                    },
                }),
            });
            setResult(res);
            setPassword('');
            noteMigrationSweep(res);
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            console.error('Sweep (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: humanizeError(err, 'sweep').message,
            }));
            markReviewAttempt();
        }
    }

    function handleReview(event) {
        event.preventDefault();
        const m = memo.trim();
        const memoError = memoLengthError(m);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        const problems = {
            'sweep-source': !chainId || !fromAddress ? 'Pick a source address first.' : null,
            'sweep-destination': !destTrimmed
                ? 'Destination address is required.'
                : destFormatError || (fromAddress && destTrimmed === fromAddress.address
                    ? 'Destination is the source address itself; the sweep would move nothing anywhere.'
                    : null),
            'form:categories': selectedCount === 0 ? 'Select at least one category to sweep.' : null,
            'sweep-memo': m.includes('|') || m.includes(';') ? 'Memo cannot contain "|" or ";".' : memoError,
            'form:fee': feeStop?.formError || null,
            'form:keys': !gateSatisfied
                ? 'Still checking the vault for gated-content unlock keys. Try again in a moment.'
                : null,
        };
        if (!formErrors.validate(problems)) {
            const section = problems['sweep-source'] ? 'from'
                : problems['sweep-destination'] || problems['form:categories'] ? 'sweep'
                    : problems['sweep-memo'] ? 'memo'
                        : problems['form:fee'] ? 'fee' : 'keys';
            setRefusedIn((prev) => ({ section, attempt: prev.attempt + 1 }));
            return;
        }
        setFormError(null);
        if (!isWatcherMode) {
            openConfirmModal();
            return;
        }
        setStage('review');
    }

    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await submit({
                params: actionParams,
                password,
                extraBase: flowOpts,
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
            });
            setResult(res);
            setPassword('');
            noteMigrationSweep(res);
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Sweep failed.',
                    }),
            );
            setStage('review');
            if (!isWatcherMode && !isHwSource) {
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

    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review' ? () => setStage('form') : onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting'
                ? 'Review Sweep'
                : (migrateLane ? 'Sweep to New Wallet' : 'Sweep Address')}
        />
    );
    // The review always opens at its top instead of inheriting how far the
    // form was scrolled; the form keeps its own position for Back.
    const wrap = (children, footer = null) => (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={!(stage === 'review' || stage === 'submitting')}
        >
            {children}
            {footer}
        </Screen>
    );

    // The load error, the loading line and every result lay out through
    // FormPage like the form itself, so no state draws straight into Screen.
    const pageLabel = migrateLane ? 'Sweep to new wallet' : 'Sweep address';
    if (loadError) {
        return wrap(
            <FormPage
                label={pageLabel}
                status={<StatusMessage variant="error">{loadError}</StatusMessage>}
            />,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(<FormPage label={pageLabel}><p className={styles.hint}>Loading…</p></FormPage>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <FormPage label="Unsigned sweep transaction">
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={handleBuildAnother}
                        onDone={onBack}
                    />
                </FormPage>,
            );
        }
        // Signed but not broadcast. None of the post-sweep effects
        // below (auto-pay disarmed, dispensers closing) have happened.
        if (result?.queued) {
            return wrap(
                <FormPage label="Queued sweep transaction">
                    <ResultScreen state="signed-not-broadcast" onDone={onBack} what="sweep" unsaved={result.unsaved} />
                </FormPage>,
            );
        }
        const forceClose = result?.forceClose;
        return wrap(
            <FormPage
                label="Sweep result"
                actions={<Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>}
            >
                <h2 className={styles.successTitle}>Sweep broadcast</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                {forceClose && (forceClose.autopayDisabled > 0 || forceClose.holdsReleased > 0) ? (
                    <p className={styles.hint}>
                        Auto pay disarmed on {forceClose.autopayDisabled} order
                        {forceClose.autopayDisabled === 1 ? '' : 's'} from the swept address
                        {forceClose.holdsReleased > 0
                            ? `; ${forceClose.holdsReleased} reservation hold${forceClose.holdsReleased === 1 ? '' : 's'} released`
                            : ''}.
                    </p>
                ) : null}
                {flags.dispensers ? (
                    <p className={styles.hint}>
                        Dispensers close after the standard 1-hour window; their
                        remaining escrow reaches the destination at close time.
                    </p>
                ) : null}
                {migrateLane && gateCopied > 0 ? (
                    <p className={styles.hint}>
                        {gateCopied} gated unlock key{gateCopied === 1 ? '' : 's'} now
                        available to {migrateTo.name || 'the new wallet'}.
                    </p>
                ) : null}
            </FormPage>,
        );
    }

    // Shared warning block (review + confirm page): third-party
    // destination and gated-tick key-handoff facts.
    const sweepWarnings = (
        <>
            {thirdPartyDestination ? (
                <StatusMessage variant="warning" role="alert" title="This destination is not one of this wallet's addresses.">
                    <p>
                        Everything selected - balances, ownerships, and released
                        escrow - will belong to that address's owner. Triple-check
                        it before signing.
                    </p>
                </StatusMessage>
            ) : null}
            {!migrateLane && gatedTicks.length > 0 ? (
                <StatusMessage variant="warning" role="alert">
                    <NoticeList items={gatedTicks.map((tick) => ({ key: tick, content: gatedTickWarningCopy(tick, 'sweep recipients') }))} />
                </StatusMessage>
            ) : null}
        </>
    );
    if (stage === 'review' || stage === 'submitting') {
        return (
            <ConfirmActionModal
                phase={stage === 'submitting' ? 'signing' : 'ready'}
                composed={legacyComposed}
                report={null}
                reportLoading={false}
                acknowledged={NO_ACKNOWLEDGMENTS}
                onAcknowledge={() => {}}
                canApprove={stage === 'review'}
                onApprove={() => handleSubmit({ preventDefault() {} })}
                onReject={() => { setSubmitError(null); setTypedConfirm(''); setStage('form'); }}
                decoded={sweepReviewDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentialsReady={typedConfirmOk}
                credentials={(
                    <>
                        <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                        <Input
                            label='Type "SWEEP" to confirm'
                            help={t('common.typedConfirmationHint', { word: 'SWEEP' })}
                            value={typedConfirm}
                            onChange={(event) => setTypedConfirm(event.target.value)}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                    </>
                )}
                summary={{
                    verb: t('components.confirmSummary.verbSweep'),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    recipient: actionParams.DESTINATION,
                    facts: [{
                        label: 'Sweeps',
                        value: CATEGORY_META.filter((category) => flags[category.key]).map((category) => category.label).join(', '),
                    }],
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                // Everything the address holds goes to the destination; missing
                // unlock keys are a plain line on the confirm screen.
                summary={{
                    verb: t('components.confirmSummary.verbSweep'),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    ...(actionParams.DESTINATION ? { recipient: actionParams.DESTINATION } : {}),
                    ...(missingKeysNotice ? { notice: missingKeysNotice } : {}),
                }}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                credentialsReady={(isHwSource
                    ? hwStatus === 'available'
                    : (signerReady || password.length > 0)) && typedConfirmOk}
                extraCredentials={(
                    <>
                        {sweepWarnings}
                        <Input
                            label='Type "SWEEP" to confirm'
                            help={t('common.typedConfirmationHint', { word: 'SWEEP' })}
                            value={typedConfirm}
                            onChange={(e) => setTypedConfirm(e.target.value)}
                            autoComplete="off"
                        />
                    </>
                )}
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                onChainChange={setChainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    clearFormError();
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (destinationPickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Destination Address"
                walletId={walletId}
                chainId={chainId}
                onChainChange={setChainId}
                onPick={(a) => {
                    setDestination(a.address);
                    clearFormError();
                    setDestinationPickerOpen(false);
                }}
                onBack={() => setDestinationPickerOpen(false)}
            />
        );
    }

    // One-line summaries for the closed sections.
    const sweepSummary = joinSummaryParts([
        `${selectedCount} ${selectedCount === 1 ? 'category' : 'categories'}`,
        destTrimmed ? <>to <SummaryAddress address={destTrimmed} /></> : null,
    ], ' ');
    const keysSummary = gateLoading
        ? 'Checking the vault'
        : (gateMissingTicks.length > 0
            ? `Missing for ${gateMissingTicks.join(', ')}`
            : 'All in the vault');
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={migrateLane ? 'Sweep to new wallet' : 'Sweep address'}
            onSubmit={handleReview}
            errors={formErrors}
            // No standing warning; the confirm screen says exactly what the
            // sweep moves before anything is signed. A form error shows in the
            // standard's status slot just above the action.
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            action={(
                <FormAction
                    icon={<Icon.SweepIcon />}
                    loading={confirmAction.composing}
                >
                    Sweep
                </FormAction>
            )}
            from={(
                // The standard From section (Network + From address), closed,
                // first. The migrate lane arrives chain-locked.
                <FromSection
                    {...formSections.bind('from')}
                    revealKey={sectionReveal('from')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                    onNetworkChange={migrateLane ? undefined : setChainId}
                    lockNetwork={migrateLane}
                    networkHelp="The chain whose holdings are swept. The From and destination addresses and fees are on this network."
                    address={fromAddress?.address}
                    addressId="sweep-source"
                    formErrorKey="sweep-source"
                    onOpenPicker={migrateLane ? undefined : () => setSourcePickerOpen(true)}
                    pickerLabel={migrateLane ? undefined : 'Choose source address'}
                    pickerLockedReason="A migration sweeps the address it started from"
                    addressHelp="The address being emptied. Everything selected below moves out of it, and it pays the network fee."
                    // Only when this network truly has no address; a
                    // render before the source is picked must not open From for good.
                    missing={(addressesByChain?.[chainId] || []).length === 0 ? (
                        <FormNotice variant="error">
                            {t('send.source.noAddress')}
                        </FormNotice>
                    ) : null}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    revealKey={sectionReveal('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    formErrorKey="form:fee"
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        nativeFeeProps: nativeFee.toggleProps,
                    }}
                />
            )}
        >
            {/* The main section, open: where it goes and, under the plain
                What to sweep label, what moves. Its title differs from the
                Sweep action so the two buttons keep distinct names. */}
            <FormSection
                id="sweep"
                title="Sweep Details"
                icon={Icon.SweepIcon}
                {...formSections.bind('sweep')}
                revealKey={sectionReveal('sweep')}
                summary={sweepSummary}
            >
            {/* A note, so it sits in the one warning card (no loose paragraph).
                A migrating user is the one person who must not read this as
                "everything moved": SWEEP never touches the coin, so the card
                says where it stays and what is left to do. */}
            {migrateLane ? (
                <>
                    <WarningCard data-sweep-migration-note="">
                        <WarningLine>
                            Migration sweep: moves this legacy address's tokens to{' '}
                            {migrateTo.name || 'your new BIP39 wallet'}.
                        </WarningLine>
                    </WarningCard>
                    <Notice tone="danger" role="note" data-sweep-migration-caution="">
                        Your {coinTicker || 'coin'} balance stays on the legacy
                        address; send it across separately, and keep the legacy
                        recovery phrase until you have.
                    </Notice>
                </>
            ) : null}

            {/* From lives in the standard From section above. */}

            {migrateLane ? (
                <Input
                    id="sweep-destination"
                    label="Destination address"
                    help={`The matching address in ${migrateTo.name || 'the new wallet'}.`}
                    value={destination}
                    onChange={() => {}}
                    readOnly
                    error={destTrimmed && destFormatError ? destFormatError : undefined}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : (
                <AddressField
                    id="sweep-destination"
                    label="Destination address"
                    help="Where every selected holding (and released escrow) is credited."
                    icon="addresses"
                    ref={destinationRef}
                    iconLabel="Choose destination address"
                    onIconClick={() => setDestinationPickerOpen(true)}
                    value={destination}
                    onChange={(e) => { setDestination(e.target.value); clearFormError(); }}
                    error={destTrimmed && destFormatError ? destFormatError : undefined}
                />
            )}
            {thirdPartyDestination ? (
                <FieldNote variant="warning" role="alert">
                    <strong>Not your address.</strong> This wallet does not own
                    the destination; everything swept will belong to whoever
                    controls it.
                </FieldNote>
            ) : null}
            {!migrateLane && gatedTicks.length > 0 ? (
                // Joins the status slot above the action either way.
                <FormNotice
                    variant="warning"
                    role="alert"
                    lines={gatedTicks.map((tick) => gatedTickWarningCopy(tick, 'sweep recipients'))}
                    bullets
                />
            ) : null}

            {/* What to sweep is a plain field label (field-label size, weight
                and muted colour) with its help tip: no section heading, no
                divider and no padding above it. */}
            <span className={styles.sweepGroupLabel} data-sweep-what-label="">
                What to sweep
                <InfoTip
                    aria="About sweeping"
                    label="A sweep moves everything you tick here from this address to the destination address in one transaction, for example when you retire an address or move to a new wallet. The counts show what the address holds now; the sweep moves whatever it holds when the transaction confirms."
                />
            </span>
            <OptionSwitchList id="sweep-categories" data-sweep-what-list="">
                {CATEGORY_META.map((c) => {
                    const CategoryIcon = Icon[c.icon];
                    return (
                        <OptionSwitch
                            key={c.key}
                            icon={<CategoryIcon />}
                            label={`${c.label}${preview ? ` (${categoryCount(preview, c.key)})` : ''}`}
                            description={c.hint}
                            checked={flags[c.key]}
                            onChange={(e) => {
                                setFlags((f) => ({ ...f, [c.key]: e.target.checked }));
                                formErrors.clear('form:categories');
                                clearFormError();
                            }}
                        />
                    );
                })}
            </OptionSwitchList>
            {selectedPreviewUnavailable ? (
                <p className={styles.hint}>Count unavailable for this category; the sweep still moves it.</p>
            ) : null}
            {previewLoading ? <p className={styles.hint}>Loading counts…</p> : null}
            {/* Live lines only (U57): the "counts are a snapshot" fact lives in
                the What to sweep tip above. */}
            {previewError ? <p className={styles.hint}>{previewError}</p> : null}
            {selectedPreviewEmpty ? (
                <p className={styles.hint}>Nothing is in the selected categories right now.</p>
            ) : null}
            </FormSection>

            {migrateLane && gatedTicks.length > 0 ? (
                // A closed standard section; required, so no Optional tag.
                <FormSection
                    id="keys"
                    title="Gated-Content Keys"
                    icon={Icon.KeyIcon}
                    {...formSections.bind('keys')}
                    revealKey={sectionReveal('keys')}
                    summary={keysSummary}
                >
                    {/* A safety caution: a danger notice, never a box in a card. */}
                    <Notice tone="danger" role="note" flush data-sweep-keys-note="">
                        On-chain key handoffs are encrypted to this legacy address,
                        so unlock keys must be secured in the vault BEFORE the
                        sweep; they cannot be recovered from the new wallet's seed
                        afterwards.
                    </Notice>
                    {gateLoading ? <p className={styles.hint}>Checking vault keys…</p> : null}
                    {(gateRows || []).map((r) => (
                        <div key={r.tick}>
                            {r.missingCount > 0 ? (
                                <FieldNote variant="warning" role={null}>
                                    {r.tick}: {r.packCount - r.missingCount}/{r.packCount} unlock
                                    key{r.packCount === 1 ? '' : 's'} in the vault - missing
                                </FieldNote>
                            ) : (
                                <p className={styles.hint}>
                                    {r.tick}: {r.packCount}/{r.packCount} unlock
                                    key{r.packCount === 1 ? '' : 's'} in the vault
                                </p>
                            )}
                            {r.missingKeyHashes.length > 0 ? (
                                <ul className={styles.keyHashList}>
                                    {r.missingKeyHashes.map((hash) => (
                                        <li key={hash}><code>{hash}</code></li>
                                    ))}
                                </ul>
                            ) : r.checkError ? (
                                <p className={styles.hint}>{r.checkError}</p>
                            ) : null}
                        </div>
                    ))}
                    {gateCopied > 0 ? (
                        <p className={styles.hint}>
                            {gateCopied} key{gateCopied === 1 ? '' : 's'} carried over to{' '}
                            {migrateTo.name || 'the new wallet'}.
                        </p>
                    ) : null}
                    {canScan ? (
                        <>
                            <Input
                                id="sweep-recovery-password"
                                type="password"
                                label="Wallet password (key recovery scan)"
                                help="Scans this wallet's on-chain messages for the missing unlock keys and stores them in the vault."
                                value={scanPassword}
                                onChange={(e) => {
                                    setScanPassword(e.target.value);
                                    if (scanError) setScanError(null);
                                }}
                                error={scanError || undefined}
                                autoComplete="current-password"
                                disabled={scanning}
                            />
                            <div className={styles.actions}>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    icon={<Icon.KeyIcon />}
                                    onClick={handleRecoverKeys}
                                    loading={scanning}
                                >
                                    Recover Keys
                                </Button>
                            </div>
                        </>
                    ) : null}
                    {(isHwSource || isWatcherMode) && gateMissingTicks.length > 0 ? (
                        <FormNotice variant="warning" role={null}>
                            {`This wallet cannot run the key recovery scan (${isWatcherMode ? 'another phone holds its keys' : 'the keys stay on the hardware wallet'}, so no key can be exported). Unlock keys for ${gateMissingTicks.join(', ')} may be lost after migration.`}
                        </FormNotice>
                    ) : null}
                </FormSection>
            ) : null}

            {/* Memo is its own closed, optional section holding only the
                memo: the section title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionReveal('memo')}
                inputId="sweep-memo"
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(e) => { setMemo(e.target.value); clearFormError(); }}
            />
        </FormFrame>,
    );
}


function categoryCount(preview, key) {
    const cat = preview?.[key];
    if (!cat) return '…';
    if (cat.error) return 'count unavailable';
    const n = Array.isArray(cat.rows) ? cat.rows.length : 0;
    return String(n);
}
