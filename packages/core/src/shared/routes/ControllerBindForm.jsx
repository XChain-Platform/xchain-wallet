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
import { AddressField, AddressText, Button, ChainBadge, Checkbox, FeeSelector, FormPage, Icon, Input, ListPage, NetworkField, PageHeader, Screen, Select, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { useContractManifest } from '../hooks/useContractManifest.js';
import { ContractConsentPanel } from '../components/ContractConsentPanel.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import {
    externalIndexOf,
    hasAnyAddress,
    preferredSourceId,
    WATCH_ONLY_SIGNING_MESSAGE,
} from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';
import { controllerBindValidationError } from '../../flows/controllerBind.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { tokenIssuerEligibility } from '../utils/tokenIssuerEligibility.js';
import { toggleActionClass, waitForTxOutputsVisible } from '../utils/controllerBindClasses.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// The locked-fact list, used only until the SDK answers. Mirrors the indexer's
// CONTROLLER_BINDABLE_CLASSES: 'all' is the catch-all (every class, present and
// future, wherever no class-specific controller covers one) and 'ownership'
// gates a token's ownership deed-over rather than its balances.
const FALLBACK_ACTION_CLASSES = ['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all'];

// Sources the form can author a bind from: an HD external address signs with
// the password, a Trezor or Ledger address signs on its device, and a
// watch-only address reaches the form so a full-mode wallet can explain why it
// cannot sign, while watcher mode can build the unsigned transaction.
function isFormSource(address) {
    switch (address?.source) {
        case 'hd': return externalIndexOf(address.derivationPath) !== null;
        case 'trezor':
        case 'ledger':
        case 'watch-only':
            return true;
        default: return false;
    }
}

const NO_SOURCE_MESSAGE = 'No address on this network to sign from. Use Receive to generate one first.';

// Which input a controllerBindValidationError message is about, by the field name
// the message leads with; null when it concerns the form as a whole.
function controllerBindErrorField(message) {
    if (/^Guard contract/.test(message)) return 'controller';
    if (/^Cooldown blocks/.test(message)) return 'cooldown';
    if (/^Memo|memo/.test(message)) return 'memo';
    if (/action class/i.test(message)) return 'actionClass';
    return null;
}

/**
 * Controller-bind authoring form: Phase F (Part 3b).
 *
 * Binds (or unbinds) a guard contract over a SUBJECT: either a token
 * the user issued (TICK → ISSUE v6) or the signing address itself
 * (ADDRESS v1). The guard `controller` is the action_index of a
 * deployed contract; `actionClass` ∈ {transfer, trade, burn, mint,
 * stake, ownership, all} names which native actions the guard gates
 * (`all` is the catch-all: every class, present and future, wherever no
 * class-specific controller covers one); several checked classes become
 * separate transactions under one review. `cooldownBlocks`
 * delays an unbind taking effect (bind only).
 *
 * Stage machine mirrors the other contract forms: form → review →
 * submitting → done. Params are built host-side via the SDK's
 * `controller.*` helper (core can't import the SDK), then submitted
 * through the same `advancedAction` (createAction → sign → broadcast)
 * path every other action form uses. The SDK controller helper ships
 * under Phase F Part 2 and may not exist yet. The form degrades
 * gracefully: the action-class checkboxes fall back to the locked-fact
 * list, and a build/submit against a too-old SDK surfaces a clear error
 * and keeps the user on the review screen.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} [props.tick]    when present, defaults the target to this token
 * @param {() => void} props.onBack
 */
export function ControllerBindForm({ walletId, chainId: initialChainId, tick, onBack }) {
    // Seeded from the launching context; the Network field lets the user retarget.
    const [chainId, setChainId] = useState(initialChainId);
    const { messaging, shell } = useMessaging();
    const { isWatcherMode } = useWalletMode();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    // The Network field keeps every chain returned by the wallet, including a
    // chain whose only records are not eligible sources.
    const [walletChainIds, setWalletChainIds] = useState(/** @type {string[] | null} */ (null));
    // A chosen chain with no address to sign from is an inline, recoverable
    // error: the Network field stays on the page so the user can switch away.
    const [sourceError, setSourceError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    // 'token' → ISSUE v6 (gate a TICK); 'address' → ADDRESS v1 (gate the signer).
    const [target, setTarget] = useState(/** @type {'token' | 'address'} */ (tick ? 'token' : 'address'));
    const [selectedTick, setSelectedTick] = useState('');
    const [ownedTokens, setOwnedTokens] = useState(
        /** @type {Array<{ tick: string, ownerAddress: string, ownerAddressId: string }> | null} */ (null),
    );
    const [unbind, setUnbind] = useState(false);
    const [controller, setController] = useState('');
    const [selectedActionClasses, setSelectedActionClasses] = useState(/** @type {string[]} */ (['transfer']));
    const [cooldownBlocks, setCooldownBlocks] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [actionClasses, setActionClasses] = useState(/** @type {string[]} */ (FALLBACK_ACTION_CLASSES));
    const [actionClassesChainId, setActionClassesChainId] = useState(/** @type {string | null} */ (null));

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [fieldError, setFieldError] = useState(/** @type {{ field: string, message: string } | null} */ (null));
    const errorFor = (field) => (fieldError && fieldError.field === field ? fieldError.message : undefined);
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [sequenceResults, setSequenceResults] = useState(
        /** @type {Array<{ actionClass: string, status: 'pending' | 'submitting' | 'success' | 'failed', txid?: string, error?: string, result?: any }>} */ ([]),
    );
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    // Set from the press until the confirm page settles, so a second press in
    // that gap does not start a second compose.
    const composingRef = useRef(false);
    // Keep a double press from starting the same multi-class sequence twice
    // before the submitting stage has rendered and disabled its button.
    const submittingSequenceRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const allByChain = byChain || {};
                setLoadError(null);
                setWalletChainIds(Object.keys(allByChain));
                // Keep admitted but currently unable sources in the form. The
                // submit gate below gives hardware and watch-only records their
                // specific reason instead of misreporting that no address exists.
                const sourceByChain = Object.fromEntries(
                    Object.entries(allByChain)
                        .map(([id, list]) => [id, (Array.isArray(list) ? list : []).filter(isFormSource)])
                        .filter(([, list]) => list.length > 0),
                );
                if (!hasAnyAddress(allByChain)) {
                    setLoadError('No addresses on any network yet. Use Receive to generate one first.');
                    return;
                }
                // D-153: opened WITHOUT a token (the address-controller lane),
                // there is no chain to inherit, so default to the last-used
                // chain, else the first chain the wallet has an address on -
                // the same rule `useActionForm` applies to every other
                // free-entry form. `byChain` is in address-creation order, so
                // the first-key fallback alone opened the address-controller
                // lane on the wallet's OLDEST chain forever. Without a chain
                // at all here the form renders its "no address on this
                // chain" error over a wallet that has plenty, because
                // `chainId` is simply undefined. The default comes from the
                // chains this form can author from, so an ineligible first
                // chain never becomes the opening chain.
                let cid = chainId;
                if (!cid) {
                    cid = pickDefaultChainId(
                        Object.keys(sourceByChain).length > 0 ? sourceByChain : allByChain,
                        { settings },
                    );
                    setChainId(cid);
                }
                const addrs = sourceByChain[cid] || [];
                if (addrs.length === 0) {
                    setFromAddressId(null);
                    setSourceError(NO_SOURCE_MESSAGE);
                    return;
                }
                setSourceError(null);
                // preferredSourceId falls back to the newest HD address, which a
                // hardware-only or watch-only wallet does not hold.
                setFromAddressId(preferredSourceId(addrs, active?.[cid]) || addrs[0].id);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging, isWatcherMode]);

    // Load ownership separately for every eligible signing address because a
    // token choice also determines which wallet address must author the bind.
    useEffect(() => {
        if (!chainId || !addressesByChain) return undefined;
        let cancelled = false;
        setOwnedTokens(null);
        const sources = (addressesByChain[chainId] || []).filter(isFormSource);
        if (typeof messaging?.getOwnedTokens !== 'function' || sources.length === 0) {
            setOwnedTokens([]);
            setTarget('address');
            setSelectedTick('');
            return undefined;
        }
        Promise.all(sources.map((source) => Promise.resolve(
            messaging.getOwnedTokens({ chainId, address: source.address }),
        ).then((rows) => ({ source, rows: Array.isArray(rows) ? rows : [] }))
            .catch(() => ({ source, rows: [] }))))
            .then((batches) => {
                if (cancelled) return;
                const seen = new Set();
                const merged = [];
                for (const { source, rows } of batches) {
                    for (const row of rows) {
                        const ownedTick = String(row?.tick || '').trim();
                        const key = ownedTick.toLowerCase();
                        if (!ownedTick || seen.has(key)) continue;
                        seen.add(key);
                        merged.push({
                            tick: ownedTick,
                            ownerAddress: source.address,
                            ownerAddressId: source.id,
                        });
                    }
                }
                merged.sort((a, b) => a.tick.localeCompare(b.tick));
                setOwnedTokens(merged);
                if (merged.length === 0) {
                    setTarget('address');
                    setSelectedTick('');
                    return;
                }
                const requested = String(tick || '').trim().toLowerCase();
                setSelectedTick((current) => {
                    const requestedRow = merged.find((row) => row.tick.toLowerCase() === requested);
                    const currentRow = merged.find((row) => row.tick === current);
                    const next = requestedRow || currentRow || merged[0];
                    return next.tick;
                });
            });
        return () => { cancelled = true; };
    }, [addressesByChain, chainId, messaging, tick]);

    // Keep a token bind anchored to its recorded owner even when ownership
    // finishes loading after the user has already selected the token target.
    useEffect(() => {
        if (target !== 'token' || !selectedTick || !ownedTokens) return;
        const token = ownedTokens.find((row) => row.tick === selectedTick);
        if (token && token.ownerAddressId !== fromAddressId) setFromAddressId(token.ownerAddressId);
    }, [fromAddressId, ownedTokens, selectedTick, target]);

    // Action-class list from the SDK (degrades to the locked-fact list).
    useEffect(() => {
        if (!chainId) return undefined;
        let cancelled = false;
        setActionClasses(FALLBACK_ACTION_CLASSES);
        setActionClassesChainId(null);
        if (typeof messaging?.getControllerActionClasses !== 'function') {
            setActionClassesChainId(chainId);
            return undefined;
        }
        messaging.getControllerActionClasses({ chainId })
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res?.actionClasses)
                    ? [...new Set(res.actionClasses.map((value) => String(value).trim().toLowerCase()).filter(Boolean))]
                    : null;
                if (list && list.length > 0) {
                    setActionClasses(list);
                    setSelectedActionClasses((current) => {
                        const available = current.filter((value) => list.includes(value));
                        return available.length > 0 ? available : [list[0]];
                    });
                }
                setActionClassesChainId(chainId);
            })
            .catch(() => {
                if (!cancelled) setActionClassesChainId(chainId);
            });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainRegistry.get(chainId);
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);
    const tokenInfo = useTokenInfo({ chainId, tick: selectedTick, skip: target !== 'token' || !selectedTick });
    const issuerEligibility = tokenIssuerEligibility({
        tokenInfo: target === 'token' ? tokenInfo : { creator: fromAddress?.address },
        addressesByChain,
        chainId,
        tick: selectedTick,
        sourceAddress: fromAddress?.address,
    });

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const isBlockedWatchOnlySource = fromAddress?.source === 'watch-only' && !isWatcherMode;
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices the broadcast (mirrors DispenserForm / SwapForm).
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

    // (§5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page, hardware
    // included. Watcher mode still branches: it encodes, it
    // never signs. Unlike the other action
    // forms the wire action/params are built HOST-side (the SDK's controller
    // helper lives there) and passed directly to the confirm page.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'advancedAction',
        hardware: 'advancedActionHw',
    });
    // Label the pending record: on the wire a bind is an ADDRESS or ISSUE, not a bind.
    const bindSummary = (actionClass) => {
        const verb = unbind ? 'Unbind' : 'Bind';
        return target === 'token'
            ? `${verb} controller on ${selectedTick} (${actionClass})`
            : `${verb} address controller (${actionClass})`;
    };

    const bindRequest = (actionClass) => ({
        chainId,
        target,
        unbind,
        tick: target === 'token' ? selectedTick : undefined,
        controller: String(controller).trim(),
        actionClass: String(actionClass || '').trim().toLowerCase(),
        ...(!unbind && cooldownBlocks.trim() !== '' && { cooldownBlocks: cooldownBlocks.trim() }),
        ...(memo.trim() !== '' && { memo: memo.trim() }),
    });

    async function openConfirmScreen(actionClass) {
        if (composingRef.current) return;
        composingRef.current = true;
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        setSubmitError(null);
        try {
            const { action, params } = await messaging.buildControllerBindParams(bindRequest(actionClass));
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action, params },
                ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    action,
                    params,
                    actionSummary: bindSummary(actionClass),
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId, coinTicker, fallback: err?.message || `${unbind ? 'Unbind' : 'Bind'} failed.`,
            }));
        } finally {
            composingRef.current = false;
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (isBlockedWatchOnlySource || (isHwSource && hwStatus !== 'available')) return;
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (!fromAddress) {
            setFormError('No source address available.');
            return;
        }
        if (target === 'token' && issuerEligibility.pending) {
            setFormError(`Wait for the wallet to verify the current owner of ${selectedTick}.`);
            return;
        }
        if (target === 'token' && issuerEligibility.error) {
            setFormError(issuerEligibility.error);
            return;
        }
        if (!descriptor?.coin || !descriptor?.networkKind || !isValidAddressForChain(
            fromAddress.address,
            descriptor.coin,
            descriptor.networkKind,
        )) {
            setFormError('The selected source address is not valid for this network.');
            return;
        }
        if (actionClassesChainId !== chainId) {
            setFormError('Action classes are still refreshing for this network. Try again in a moment.');
            return;
        }
        if (selectedActionClasses.length === 0) {
            setFieldError({ field: 'actionClass', message: 'Choose at least one action class.' });
            setFormError(null);
            return;
        }
        const validationError = selectedActionClasses
            .map((actionClass) => controllerBindValidationError(bindRequest(actionClass)))
            .find(Boolean);
        if (validationError) {
            // An error that belongs to one field shows on that field, tied to it for
            // assistive tech; the rest stay in the status line.
            const field = controllerBindErrorField(validationError);
            setFieldError(field ? { field, message: validationError } : null);
            setFormError(field ? null : validationError);
            return;
        }
        setFieldError(null);
        setFormError(null);
        setSequenceResults(selectedActionClasses.map((actionClass) => ({ actionClass, status: 'pending' })));
        if (!isWatcherMode && selectedActionClasses.length === 1) {
            openConfirmScreen(selectedActionClasses[0]);
            return;
        }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || submittingSequenceRef.current) return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        submittingSequenceRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        let nextResults = sequenceResults.map((entry) => (
            entry.status === 'success' ? entry : { actionClass: entry.actionClass, status: 'pending' }
        ));
        for (let index = 0; index < nextResults.length; index += 1) {
            if (nextResults[index].status === 'success') continue;
            const actionClass = nextResults[index].actionClass;
            nextResults = nextResults.map((entry, rowIndex) => (
                rowIndex === index ? { ...entry, status: 'submitting', error: undefined } : entry
            ));
            setSequenceResults(nextResults);
            try {
                // A bind sent earlier in this sequence may not be in the tracker's
                // view yet; compose only once its change is listed (bounded wait).
                const previousTxid = [...nextResults.slice(0, index)].reverse()
                    .find((entry) => entry.status === 'success' && entry.txid)?.txid;
                if (previousTxid && !isWatcherMode && typeof messaging.getAddressUtxos === 'function') {
                    await waitForTxOutputsVisible({
                        getUtxos: () => messaging.getAddressUtxos(chainId, from.address),
                        txid: previousTxid,
                    });
                }
                // Build immediately before each send so a failed transaction
                // cannot consume or invalidate the inputs of a later one.
                const { action, params } = await messaging.buildControllerBindParams(bindRequest(actionClass));
                const base = {
                    walletId,
                    chainId,
                    from,
                    action,
                    params,
                    actionSummary: bindSummary(actionClass),
                    ...(feePerKb != null ? { feePerKb } : {}),
                };
                let response;
                if (isWatcherMode) {
                    response = await messaging.buildActionPsbtRequest({
                        chainId,
                        from,
                        actionData: { action, params },
                        ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                    });
                } else if (isHwSource) {
                    response = await messaging.advancedActionHw({ ...base, signerId: fromAddress.signerId });
                } else {
                    response = await messaging.advancedAction({ ...base, password });
                }
                nextResults = nextResults.map((entry, rowIndex) => (rowIndex === index ? {
                    ...entry,
                    status: 'success',
                    txid: response?.txid || response?.tx_hash,
                    result: response,
                } : entry));
                setSequenceResults(nextResults);
            } catch (err) {
                const isBadPassword = err?.name === 'InvalidPasswordError';
                const message = isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        fallback: err?.message || `${unbind ? 'Unbind' : 'Bind'} failed.`,
                    });
                nextResults = nextResults.map((entry, rowIndex) => (
                    rowIndex === index ? { ...entry, status: 'failed', error: message } : entry
                ));
                setSequenceResults(nextResults);
                setSubmitError(message);
                setStage('review');
                submittingSequenceRef.current = false;
                if (!isWatcherMode && !isHwSource) {
                    passwordRef.current?.focus();
                    passwordRef.current?.select();
                }
                return;
            }
        }
        const responses = nextResults.map((entry) => entry.result);
        setResult(responses.length === 1 ? responses[0] : { sequence: nextResults });
        setPassword('');
        setStage('done');
        submittingSequenceRef.current = false;
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setSequenceResults([]);
        setStage('form');
    }

    // PC-39: consent disclosure for the guard contract being bound.
    // Binding hands a contract standing authority over a whole action
    // class, so the manifest matters more here than on a one-shot
    // EXECUTE. Skipped on unbind (revoking authority needs no consent)
    // and deferred until the review stage so a half-typed contract
    // index doesn't fire a lookup per keystroke.
    const manifest = useContractManifest({
        chainId,
        contractActionIndex: String(controller).trim(),
        skip: unbind || (stage !== 'review' && stage !== 'submitting'),
    });

    const verb = unbind ? 'Unbind' : 'Bind';
    const actionButtonLabel = `${verb} ${target}`;
    // Keep the current chain listed so the field always shows its value.
    const networkChainIds = walletChainIds
        ? (chainId && !walletChainIds.includes(chainId) ? [...walletChainIds, chainId] : walletChainIds)
        : [chainId];
    const subjectLabel = target === 'token'
        ? `token ${selectedTick}`.trim()
        : 'this address';

        const header = (
        <PageHeader
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting'
                    ? `Review ${verb.toLowerCase()} controller`
                    : `${verb} controller`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>{children}</Screen>
    );

    // The load error, the loading line and the broadcast panel lay out
    // through ListPage, so no state draws straight into the Screen box.
    if (loadError) {
        return wrap(<ListPage notices={<StatusMessage variant="error">{loadError}</StatusMessage>} />);
    }
    if (!addressesByChain) {
        return wrap(<ListPage><p className={styles.hint}>Loading addresses…</p></ListPage>);
    }

    if (stage === 'done' && result?.sequence) {
        return wrap(
            <ListPage actions={<Button variant="primary" onClick={onBack}>Done</Button>}>
                <p className={styles.summary}>
                    {verb} sequence completed. The network will apply each controller change shortly.
                </p>
                <dl className={styles.detailsList}>
                    {result.sequence.map((entry) => (
                        <div key={entry.actionClass}>
                            <dt className={styles.detailsLabel}>{entry.actionClass}</dt>
                            <dd className={styles.detailsValue}>{entry.txid || 'Broadcast queued'}</dd>
                        </div>
                    ))}
                </dl>
            </ListPage>,
        );
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) {
            return wrap(<ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result?.unsaved} />);
        }
        if (result?.psbtHex && !txid) {
            return wrap(
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        return wrap(
            <ListPage actions={<Button variant="primary" onClick={onBack}>Done</Button>}>
                <p className={styles.summary}>
                    {verb} broadcast. The network will apply the controller change shortly.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Transaction ID</dt>
                    <dd className={styles.detailsValue}>{String(txid || '-')}</dd>
                </dl>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label={`Review ${verb.toLowerCase()} controller`}
                onSubmit={handleSubmit}
                status={submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={
                            isWatcherMode
                                ? false
                                : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? `Create unsigned transaction: ${verb.toLowerCase()} controller`
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}: ${verb.toLowerCase()} controller`
                                : `Sign: ${verb.toLowerCase()} controller`}
                    </Button>
                )}
            >
                {sequenceResults.map((entry, index) => (
                    <p className={styles.summary} key={entry.actionClass}>
                        {unbind
                            ? `Unbind #${index + 1}: stop gating the ${entry.actionClass} actions of ${subjectLabel}.`
                            : `Bind guard contract #${String(controller).trim()} over the ${entry.actionClass} actions of ${subjectLabel}.`}
                        {entry.status === 'success' ? ` Sent: ${entry.txid || 'broadcast queued'}.` : null}
                        {entry.status === 'failed' ? ` Failed: ${entry.error}` : null}
                        {entry.status === 'pending' && sequenceResults.some((row) => row.status === 'failed')
                            ? ' Not sent.'
                            : null}
                    </p>
                ))}
                <dl className={styles.detailsList}>
                    {descriptor ? (
                        <>
                            <dt className={styles.detailsLabel}>Network</dt>
                            <dd className={styles.detailsValue}>
                                <ChainBadge descriptor={descriptor} size="sm" />
                            </dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Signing from</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Subject</dt>
                    <dd className={styles.detailsValue}>{subjectLabel}</dd>
                    {!unbind ? (
                        <>
                            <dt className={styles.detailsLabel}>Guard contract</dt>
                            <dd className={styles.detailsValue}>#{String(controller).trim()}</dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Action classes</dt>
                    <dd className={styles.detailsValue}>{sequenceResults.map((entry) => entry.actionClass).join(', ')}</dd>
                    <dt className={styles.detailsLabel}>Operation</dt>
                    <dd className={styles.detailsValue}>{unbind ? 'Unbind' : 'Bind'}</dd>
                    {!unbind && cooldownBlocks.trim() !== '' ? (
                        <>
                            <dt className={styles.detailsLabel}>Cooldown</dt>
                            <dd className={styles.detailsValue}>{cooldownBlocks.trim()} blocks</dd>
                        </>
                    ) : null}
                    {memo.trim() !== '' ? (
                        <>
                            <dt className={styles.detailsLabel}>Memo</dt>
                            <dd className={styles.detailsValue}>{memo.trim()}</dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    </dd>
                    {!unbind ? (
                        <ContractConsentPanel
                            manifest={manifest}
                            labelClassName={styles.detailsLabel}
                            valueClassName={styles.detailsValue}
                        />
                    ) : null}
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction.
                        Sign it on your Signer-mode wallet, then bring the
                        signed transaction to a Full-mode wallet to broadcast.
                    </p>
                ) : (
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
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
            </FormPage>,
        );
    }

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    const networkField = (
        <NetworkField
            value={chainId}
            onChange={(cid) => {
                // Re-picking the network already shown keeps the chosen From
                // source; only a real switch clears it and reloads sources.
                if (cid === chainId) return;
                setChainId(cid);
                setFromAddressId(null);
                setSourceError(null);
            }}
            chainIds={networkChainIds}
            chainRegistry={chainRegistry}
        />
    );

    // A network with nothing to sign from offers only the switch away and the
    // one error, so issuer and fee notices for a bind that cannot happen do
    // not stack beside it.
    if (sourceError) {
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label={`${verb} controller`}
                onSubmit={(event) => event.preventDefault()}
                actions={(
                    <Button type="submit" variant="success" icon={<Icon.LockIcon />} disabled>
                        {actionButtonLabel}
                    </Button>
                )}
            >
                {networkField}
                <StatusMessage variant="error">{sourceError}</StatusMessage>
            </FormPage>,
        );
    }

    return wrap(
        <FormPage
            demoGuard={demoGuard}
            label={`${verb} controller`}
            onSubmit={handleReview}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : isBlockedWatchOnlySource ? (
                <StatusMessage variant="error">{WATCH_ONLY_SIGNING_MESSAGE}</StatusMessage>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    icon={<Icon.LockIcon />}
                    loading={actionConfirm.composing}
                    disabled={!fromAddress
                        || isBlockedWatchOnlySource
                        || (isHwSource && hwStatus !== 'available')
                        || (target === 'token' && (ownedTokens === null || !selectedTick))
                        || actionConfirm.composing}
                >
                    {actionButtonLabel}
                </Button>
            )}
        >
            <details>
                <summary>How controller bindings work</summary>
                <p className={styles.hintLeft}>
                    A guard contract approves or blocks the selected actions for this token or address. Unbind
                    removes the guard after any cooldown finishes.
                    {isWatcherMode ? ' Watch-only mode creates an unsigned transaction and cannot sign it.' : ''}
                </p>
            </details>
            {networkField}
            {fromAddress ? (
                <AddressField
                    label="From"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={target === 'address' ? () => setSourcePickerOpen(true) : undefined}
                    iconLabel="Choose source address"
                />
            ) : null}
            {isHwSource ? (
                <SignCredentials
                    fromAddress={fromAddress}
                    chainId={chainId}
                    onStatusChange={onHwStatusChange}
                    getSignerStatus={messaging.getSignerStatus}
                />
            ) : null}

            <Select
                label="What to protect"
                value={target}
                onChange={(e) => {
                    const nextTarget = /** @type {'token' | 'address'} */ (e.target.value);
                    setTarget(nextTarget);
                    if (nextTarget === 'token') {
                        const token = ownedTokens?.find((row) => row.tick === selectedTick) || ownedTokens?.[0];
                        if (token) {
                            setSelectedTick(token.tick);
                            setFromAddressId(token.ownerAddressId);
                        }
                    }
                }}
            >
                {ownedTokens === null || ownedTokens.length > 0 ? <option value="token">Token</option> : null}
                <option value="address">Address</option>
            </Select>

            {target === 'token' ? (
                <Select
                    label="Token"
                    value={selectedTick}
                    disabled={ownedTokens === null}
                    onChange={(event) => {
                        const nextTick = event.target.value;
                        const token = ownedTokens?.find((row) => row.tick === nextTick);
                        setSelectedTick(nextTick);
                        if (token) setFromAddressId(token.ownerAddressId);
                    }}
                >
                    {ownedTokens === null ? <option value="">Loading tokens</option> : null}
                    {(ownedTokens || []).map((token) => (
                        <option value={token.tick} key={`${token.ownerAddressId}:${token.tick}`}>{token.tick}</option>
                    ))}
                </Select>
            ) : null}

            {/*
              * Bind only, like the cooldown field below. An unbind sends an
              * EMPTY controller and the chain resolves the live binding for the
              * chosen class itself, so a value typed here would be discarded -
              * and offering the field on a drop invites an owner to believe
              * they are choosing WHICH controller comes off, when the class is
              * what decides that.
              */}
            {!unbind ? (
                <Input
                    label="Guard contract"
                    hint="The action number of the deployed contract that will gate the selected actions."
                    inputMode="numeric"
                    value={controller}
                    error={errorFor('controller')}
                    onChange={(e) => setController(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}

            <fieldset aria-describedby={errorFor('actionClass') ? 'controller-bind-action-class-error' : undefined}>
                <legend>Action class</legend>
                {actionClasses.map((actionClass) => (
                    <Checkbox
                        className={styles.checkRow}
                        key={actionClass}
                        label={actionClass}
                        checked={selectedActionClasses.includes(actionClass)}
                        onChange={() => {
                            setSelectedActionClasses((current) => {
                                if (isWatcherMode) {
                                    return current.includes(actionClass) ? [] : [actionClass];
                                }
                                return toggleActionClass(current, actionClass);
                            });
                            if (errorFor('actionClass')) setFieldError(null);
                        }}
                    />
                ))}
            </fieldset>
            {errorFor('actionClass') ? (
                <StatusMessage variant="error" id="controller-bind-action-class-error">
                    {errorFor('actionClass')}
                </StatusMessage>
            ) : null}
            {/*
              * Two of the seven classes do not mean what their name suggests,
              * and both are consequential enough that offering them unlabelled
              * would be its own defect: `all` hands the contract every class,
              * including ones the protocol has not added yet, and `ownership`
              * gates the deed rather than the balances - which reads as a
              * synonym for `transfer` and is not one.
              */}
            <p className={styles.hintLeft}>
                {isWatcherMode
                    ? 'Watch-only mode builds one bind at a time.'
                    : selectedActionClasses.includes('all')
                        ? 'Covers every current and future class. A class-specific binding still wins over this one.'
                        : selectedActionClasses.includes('ownership')
                        ? 'ownership: transfers of the token itself (including a sweep), not transfers of its balances.'
                            : 'One binding is sent per ticked class.'}
            </p>

            <Checkbox
                className={styles.checkRow}
                label="Unbind (remove the controller) instead of binding"
                checked={unbind}
                onChange={(e) => setUnbind(e.target.checked)}
            />

            {!unbind ? (
                <Input
                    label="Cooldown blocks (optional)"
                    hint="Blocks a later unbind must wait before it takes effect. Leave blank for none."
                    inputMode="numeric"
                    value={cooldownBlocks}
                    error={errorFor('cooldown')}
                    onChange={(e) => setCooldownBlocks(e.target.value)}
                    autoComplete="off"
                />
            ) : null}

            <Input
                label="Memo (optional)"
                hint="Free-text note recorded with the bind/unbind event."
                value={memo}
                error={errorFor('memo')}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
            />

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

        </FormPage>,
    );
}
