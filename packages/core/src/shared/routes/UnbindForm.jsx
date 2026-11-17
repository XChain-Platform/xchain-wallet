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
import { FormNotice, Icon, ListPage, PageHeader, Screen, Select, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { CONTROLLER_TARGET_ICONS, controllerClassIcon } from '../components/controllerIcons.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
    customFeeReviewStop,
} from '../../flows/feeEstimate.js';
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
import { MAX_MEMO_LENGTH } from '../utils/memoLimit.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/unbindForm.js';
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

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Used until the SDK answers; mirrors the indexer's bindable classes.
const FALLBACK_ACTION_CLASSES = ['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all'];

// The same signing sources Bind Controller accepts: an HD external address,
// a hardware address, and a watch-only address (which only watcher mode can use).
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

// Which input a validation message is about; null for the form as a whole.
function unbindErrorField(message) {
    if (/^Memo|memo/.test(message)) return 'memo';
    if (/action class/i.test(message)) return 'actionClass';
    return null;
}

/**
 * Unbind Controller: removes the guard contract bound over one action class
 * of a token this wallet owns (ISSUE v6, UNBIND=1) or of the signing address
 * itself (ADDRESS v1, UNBIND=1).
 *
 * An unbind carries no controller number: the chain resolves the live binding
 * for the chosen class itself, so the form never asks for one. A known
 * controller (opened from a bound controller) is shown for reference only.
 * One unbind removes one class, so the form composes one transaction and goes
 * straight to the shared confirm screen; watcher mode builds it unsigned.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.chainId]
 * @param {string} [props.tick]         defaults the subject to this token
 * @param {'token' | 'address'} [props.target]
 * @param {string} [props.actionClass]  defaults the class to unbind
 * @param {string} [props.controller]   the bound guard contract, shown only
 * @param {() => void} props.onBack
 * @param {() => void} [props.onDone]
 */
export function UnbindForm({
    walletId,
    chainId: initialChainId,
    tick,
    target: initialTarget,
    actionClass: initialActionClass,
    controller: boundController,
    onBack,
    onDone,
}) {
    const [chainId, setChainId] = useState(initialChainId);
    const { messaging, shell } = useMessaging();
    const { isWatcherMode } = useWalletMode();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [walletChainIds, setWalletChainIds] = useState(/** @type {string[] | null} */ (null));
    const [sourceError, setSourceError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [target, setTarget] = useState(
        /** @type {'token' | 'address'} */ (initialTarget || (tick ? 'token' : 'address')),
    );
    const [selectedTick, setSelectedTick] = useState('');
    const [ownedTokens, setOwnedTokens] = useState(
        /** @type {Array<{ tick: string, ownerAddress: string, ownerAddressId: string }> | null} */ (null),
    );
    const [actionClasses, setActionClasses] = useState(/** @type {string[]} */ (FALLBACK_ACTION_CLASSES));
    const [actionClassesChainId, setActionClassesChainId] = useState(/** @type {string | null} */ (null));
    const [actionClass, setActionClass] = useState(String(initialActionClass || 'transfer').trim().toLowerCase());
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(/** @type {'form' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [formErrorSection, setFormErrorSection] = useState(/** @type {string | null} */ (null));
    const [fieldError, setFieldError] = useState(/** @type {{ field: string, message: string } | null} */ (null));
    const [attempt, setAttempt] = useState(0);
    // Set by an Unbind press (G22): an empty Token then shows red.
    const [attempted, setAttempted] = useState(false);
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [watcherBuilding, setWatcherBuilding] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    // Held above every early return so open state survives a picker page.
    const formSections = useFormSections({ from: false, controller: true, memo: false, fee: false });
    // Set from the press until the confirm page settles, so a second press
    // in that gap does not start a second compose.
    const composingRef = useRef(false);
    const errorFor = (field) => (fieldError && fieldError.field === field ? fieldError.message : undefined);

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
                const allByChain = byChain || {};
                setAddressesByChain(allByChain);
                setLoadError(null);
                setWalletChainIds(Object.keys(allByChain));
                const sourceByChain = Object.fromEntries(
                    Object.entries(allByChain)
                        .map(([id, list]) => [id, (Array.isArray(list) ? list : []).filter(isFormSource)])
                        .filter(([, list]) => list.length > 0),
                );
                if (!hasAnyAddress(allByChain)) {
                    setLoadError(t('unbindForm.noAddresses'));
                    return;
                }
                // Opened with no token (the palette), there is no chain to
                // inherit: default the way every free-entry form does.
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
                    setSourceError(t('unbindForm.noSource'));
                    return;
                }
                setSourceError(null);
                setFromAddressId(preferredSourceId(addrs, active?.[cid]) || addrs[0].id);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(userFacingMessage(err, t('unbindForm.loadFailed')));
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging, isWatcherMode]);

    // Tokens each signing address owns: a token choice also decides which
    // wallet address must sign the unbind.
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
                        merged.push({ tick: ownedTick, ownerAddress: source.address, ownerAddressId: source.id });
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
                    return (requestedRow || currentRow || merged[0]).tick;
                });
            });
        return () => { cancelled = true; };
    }, [addressesByChain, chainId, messaging, tick]);

    // A token unbind signs from the token's recorded owner, even when
    // ownership lands after the token target was chosen.
    useEffect(() => {
        if (target !== 'token' || !selectedTick || !ownedTokens) return;
        const token = ownedTokens.find((row) => row.tick === selectedTick);
        if (token && token.ownerAddressId !== fromAddressId) setFromAddressId(token.ownerAddressId);
    }, [fromAddressId, ownedTokens, selectedTick, target]);

    useEffect(() => {
        if (!chainId) return undefined;
        let cancelled = false;
        setActionClasses(FALLBACK_ACTION_CLASSES);
        setActionClassesChainId(null);
        if (typeof messaging?.getControllerActionClasses !== 'function') {
            setActionClassesChainId(chainId);
            return undefined;
        }
        Promise.resolve(messaging.getControllerActionClasses({ chainId }))
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res?.actionClasses)
                    ? [...new Set(res.actionClasses.map((value) => String(value).trim().toLowerCase()).filter(Boolean))]
                    : null;
                if (list && list.length > 0) {
                    setActionClasses(list);
                    setActionClass((current) => (list.includes(current) ? current : list[0]));
                }
                setActionClassesChainId(chainId);
            })
            .catch(() => {
                if (!cancelled) setActionClassesChainId(chainId);
            });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    const descriptor = chainRegistry.get(chainId);
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
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

    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
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

    // The wire action is built host-side (the SDK's controller helper lives
    // there) and confirmed on the shared confirm screen; hardware signs the
    // same prebuilt PSBT with the device standing in for the password.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'advancedAction',
        hardware: 'advancedActionHw',
    });

    // Always an empty controller: the chain resolves the live binding for
    // the class, and a number sent here would be discarded.
    const unbindRequest = () => ({
        chainId,
        target,
        unbind: true,
        tick: target === 'token' ? selectedTick : undefined,
        controller: '',
        actionClass: String(actionClass || '').trim().toLowerCase(),
        ...(memo.trim() !== '' && { memo: memo.trim() }),
    });
    // The pending record's label: on the wire an unbind is an ISSUE or ADDRESS.
    const actionSummary = target === 'token'
        ? t('unbindForm.summaryToken', { tick: selectedTick, actionClass })
        : t('unbindForm.summaryAddress', { actionClass });

    const sourceFrom = () => ({
        address: fromAddress.address,
        publicKey: fromAddress.publicKey,
        derivationPath: fromAddress.derivationPath,
        addressId: fromAddress.id,
        source: fromAddress.source,
        signerId: fromAddress.signerId,
    });
    const failureText = (err) => submitFailureMessage(err, {
        chainId, coinTicker, fallback: err?.message || t('unbindForm.failed'),
    });

    async function openConfirmScreen() {
        if (composingRef.current) return;
        composingRef.current = true;
        const from = sourceFrom();
        try {
            const { action, params } = await messaging.buildControllerBindParams(unbindRequest());
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
                    actionSummary,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(failureText(err));
            setFormErrorSection(null);
        } finally {
            composingRef.current = false;
        }
    }

    // Watcher mode encodes the unbind and never signs it.
    async function buildUnsigned() {
        if (composingRef.current) return;
        composingRef.current = true;
        setWatcherBuilding(true);
        try {
            const { action, params } = await messaging.buildControllerBindParams(unbindRequest());
            const res = await messaging.buildActionPsbtRequest({
                chainId,
                from: sourceFrom(),
                actionData: { action, params },
                ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
            });
            setResult(res);
            setStage('done');
        } catch (err) {
            setFormError(failureText(err));
            setFormErrorSection(null);
        } finally {
            composingRef.current = false;
            setWatcherBuilding(false);
        }
    }

    function refuse(message, section) {
        setFieldError(null);
        setFormError(message);
        setFormErrorSection(section);
    }

    function handleUnbind(event) {
        event.preventDefault();
        if (isBlockedWatchOnlySource || (isHwSource && hwStatus !== 'available')) return;
        setAttempt((n) => n + 1);
        setAttempted(true);
        // G22: an empty Token is marked on the field and takes the cursor
        // (while owned tokens still load the field is busy, not empty).
        if (target === 'token' && ownedTokens !== null && !selectedTick) {
            setFieldError(null);
            setFormError(null);
            setFormErrorSection(null);
            setTimeout(() => document.getElementById('unbind-token')?.focus(), 0);
            return;
        }
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { refuse(feeStop.formError, 'fee'); return; }
        if (!fromAddress) { refuse(t('unbindForm.noSourceSelected'), 'from'); return; }
        if (target === 'token' && issuerEligibility.pending) {
            refuse(t('unbindForm.ownerPending', { tick: selectedTick }), 'controller');
            return;
        }
        if (target === 'token' && issuerEligibility.error) {
            refuse(issuerEligibility.error, 'controller');
            return;
        }
        if (!descriptor?.coin || !descriptor?.networkKind
            || !isValidAddressForChain(fromAddress.address, descriptor.coin, descriptor.networkKind)) {
            refuse(t('unbindForm.sourceInvalid'), 'from');
            return;
        }
        if (actionClassesChainId !== chainId) {
            refuse(t('unbindForm.classesRefreshing'), 'controller');
            return;
        }
        const validationError = controllerBindValidationError(unbindRequest());
        if (validationError) {
            // A message about one field shows on that field; the rest use the status slot.
            const field = unbindErrorField(validationError);
            setFieldError(field ? { field, message: validationError } : null);
            setFormError(field ? null : validationError);
            setFormErrorSection(field ? null : 'controller');
            return;
        }
        setFieldError(null);
        setFormError(null);
        setFormErrorSection(null);
        if (isWatcherMode) buildUnsigned();
        else openConfirmScreen();
    }

    const title = t('unbindForm.title');
    const header = <PageHeader onBack={onBack} title={title} />;
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;
    const finish = onDone || onBack;

    if (loadError) {
        return wrap(<ListPage notices={<StatusMessage variant="error">{loadError}</StatusMessage>} />);
    }
    if (!addressesByChain) {
        return wrap(<ListPage><p className={styles.hint}>{t('unbindForm.loadingAddresses')}</p></ListPage>);
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is signed and not broadcast; the confirm pipeline
        // resolves that case instead of throwing.
        if (result?.queued) {
            return wrap(<ListPage><ResultScreen state="signed-not-broadcast" onDone={finish} unsaved={result?.unsaved} /></ListPage>);
        }
        if (result?.psbtHex && !txid) {
            return wrap(
                <ListPage>
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={() => { setResult(null); setAttempted(false); setStage('form'); }}
                        onDone={finish}
                    />
                </ListPage>,
            );
        }
        return wrap(
            <ListPage>
                <ResultScreen state="success" title={t('unbindForm.doneTitle')} message={t('unbindForm.doneMessage')} onDone={finish}>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>{t('unbindForm.transactionId')}</dt>
                        <dd className={styles.detailsValue}>{String(txid || '-')}</dd>
                    </dl>
                </ResultScreen>
            </ListPage>,
        );
    }

    // The shared confirm screen, in place of the form; form state stays behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={{
                    verb: t('unbindForm.title'),
                    ...(target === 'token' && selectedTick ? { ticker: String(selectedTick).toUpperCase() } : {}),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                }}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? t('unbindForm.networkFee', { amount: feeEstimate.coinAmount, coin: coinTicker }).trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
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
                title={t('unbindForm.fromPickerTitle')}
                walletId={walletId}
                chainId={chainId}
                onChainChange={(cid) => {
                    if (cid === chainId) return;
                    setChainId(cid);
                    setFromAddressId(null);
                    setSourceError(null);
                }}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // The standard picker, limited to the tokens this wallet owns on the
    // network; picking one also moves From to its owner address.
    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                kindFilter="tokens"
                kindLocked
                rows={ownedTokens === null ? null : ownedTokens.map((token) => ({ chainId, tick: token.tick }))}
                emptyTitle={t('unbindForm.noTokensTitle')}
                emptyBody={t('unbindForm.noTokensBody')}
                networkFilter={coinFromChainId(chainId)}
                chainIdFilter={chainId}
                onSelect={(sel) => {
                    const token = ownedTokens?.find((row) => row.tick === sel.tick);
                    if (token) {
                        setSelectedTick(token.tick);
                        setFromAddressId(token.ownerAddressId);
                    }
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // A section holding the last refusal reopens on every attempt.
    const revealFor = (section) => (formError && formErrorSection === section ? attempt : 0);
    const hwBlocked = isHwSource && hwStatus !== 'available';
    const networkChainIds = walletChainIds
        ? (chainId && !walletChainIds.includes(chainId) ? [...walletChainIds, chainId] : walletChainIds)
        : [chainId];
    const onNetworkChange = (cid) => {
        if (cid === chainId) return;
        setChainId(cid);
        setFromAddressId(null);
        setSourceError(null);
    };
    const fromSection = (
        <FromSection
            {...formSections.bind('from')}
            chainId={chainId}
            chainIds={networkChainIds}
            chainRegistry={chainRegistry}
            onNetworkChange={onNetworkChange}
            networkHelp={t('unbindForm.networkHelp')}
            address={sourceError ? null : (fromAddress?.address || null)}
            addressLabel={t('unbindForm.from')}
            addressHelp={t('unbindForm.fromHelp')}
            onOpenPicker={target === 'address' ? () => setSourcePickerOpen(true) : undefined}
            pickerLabel={t('unbindForm.choosePicker')}
            pickerLockedReason={t('unbindForm.pickerLocked')}
            missing={sourceError ? <FormNotice variant="error">{sourceError}</FormNotice> : null}
            revealKey={revealFor('from') || (hwBlocked ? 'hw' : 0)}
        >
            {isHwSource && !sourceError ? (
                <SignCredentials
                    fromAddress={fromAddress}
                    chainId={chainId}
                    onStatusChange={onHwStatusChange}
                    getSignerStatus={messaging.getSignerStatus}
                />
            ) : null}
        </FromSection>
    );
    const action = (disabled) => (
        <FormAction
            icon={<Icon.UnlinkIcon />}
            loading={actionConfirm.composing || watcherBuilding}
            disabled={disabled}
        >
            {t('unbindForm.action')}
        </FormAction>
    );

    // A network with nothing to sign from offers only the switch away.
    if (sourceError) {
        return wrap(
            <FormFrame
                demoGuard={demoGuard}
                label={t('unbindForm.label')}
                onSubmit={(event) => event.preventDefault()}
                action={action(true)}
                from={fromSection}
            >
                {null}
            </FormFrame>,
        );
    }

    const trimmedController = String(boundController ?? '').trim();
    const controllerSummary = joinSummary(
        target === 'token' ? (selectedTick || t('unbindForm.token')) : t('unbindForm.thisAddress'),
        trimmedController ? `#${trimmedController}` : null,
        actionClass,
    );
    // G22 mark: shown once Unbind was pressed, cleared once a token is picked.
    const tokenMark = attempted && target === 'token' && ownedTokens !== null && !selectedTick
        ? t('unbindForm.tokenRequired') : undefined;
    const controllerHasError = Boolean(revealFor('controller') || errorFor('actionClass') || tokenMark);

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label={t('unbindForm.label')}
            onSubmit={handleUnbind}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : isBlockedWatchOnlySource ? (
                <StatusMessage variant="error">{WATCH_ONLY_SIGNING_MESSAGE}</StatusMessage>
            ) : null}
            // G22: never disabled for an empty field (a press marks the Token
            // and refuses a missing source); a watch-only or unready hardware
            // source and busy reads still hold it.
            action={action(isBlockedWatchOnlySource
                || hwBlocked
                || (target === 'token' && ownedTokens === null)
                || actionConfirm.composing
                || watcherBuilding)}
            from={fromSection}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={revealFor('fee')}
                />
            )}
        >
            {/* The main section: what is being unbound, its controller and the class. */}
            <FormSection
                id="controller"
                title={t('unbindForm.section')}
                icon={Icon.UnlinkIcon}
                {...formSections.bind('controller')}
                revealKey={controllerHasError ? attempt : 0}
                summary={controllerSummary}
            >
                <Select
                    label={t('unbindForm.target')}
                    help={t('unbindForm.targetHelp')}
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
                        if (formError) setFormError(null);
                    }}
                >
                    {ownedTokens === null || ownedTokens.length > 0
                        ? <Select.Option value="token" icon={CONTROLLER_TARGET_ICONS.token}>{t('unbindForm.token')}</Select.Option>
                        : null}
                    <Select.Option value="address" icon={CONTROLLER_TARGET_ICONS.address}>{t('unbindForm.targetAddress')}</Select.Option>
                </Select>

                {target === 'token' ? (
                    <TokenField
                        id="unbind-token"
                        error={tokenMark}
                        label={t('unbindForm.token')}
                        help={t('unbindForm.tokenHelp')}
                        value={ownedTokens !== null && selectedTick ? { chainId, tick: selectedTick } : null}
                        placeholder={ownedTokens === null ? t('unbindForm.loadingTokens') : t('unbindForm.selectToken')}
                        disabled={ownedTokens === null}
                        onOpenPicker={() => setTokenPickerOpen(true)}
                    />
                ) : null}

                {/* No explainer lines under the fields (operator 2026-11-13): the From row
                    names the address and the ? tips say what an unbind does. */}

                <Select
                    label={t('unbindForm.actionClass')}
                    help={t('unbindForm.actionClassHelp')}
                    value={actionClass}
                    error={errorFor('actionClass')}
                    onChange={(e) => {
                        setActionClass(e.target.value);
                        if (errorFor('actionClass')) setFieldError(null);
                    }}
                >
                    {/* Listed A to Z (operator 2026-11-13); the default choice is unchanged. */}
                    {(actionClasses.includes(actionClass) ? [...actionClasses] : [...actionClasses, actionClass])
                        .sort((a, b) => a.localeCompare(b))
                        .map((value) => (
                            <Select.Option key={value} value={value} icon={controllerClassIcon(value)}>{value}</Select.Option>
                        ))}
                </Select>
                {actionClass === 'all' || actionClass === 'ownership' ? (
                    <p className={styles.hintLeft}>
                        {actionClass === 'all' ? t('unbindForm.allNote') : t('unbindForm.ownershipNote')}
                    </p>
                ) : null}

                {isWatcherMode ? <p className={styles.hintLeft}>{t('unbindForm.watcherNote')}</p> : null}
            </FormSection>

            {/* Memo holds only the memo: the section title names the field
                and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                title={t('unbindForm.memo')}
                revealKey={errorFor('memo') ? attempt : 0}
                summary={memo.trim() || t('unbindForm.none')}
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                error={errorFor('memo')}
                onChange={(e) => {
                    setMemo(e.target.value);
                    if (errorFor('memo')) setFieldError(null);
                }}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
            />
        </FormFrame>,
    );
}
