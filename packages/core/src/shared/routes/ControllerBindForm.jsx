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
import { AddressField, AddressText, Button, ChainBadge, FeeSelector, Icon, Input, NetworkField, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
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
import styles from './IssueTokenForm.module.css';
import { externalIndexOf } from '../addressSelection.js';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

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

/**
 * Controller-bind authoring form: Phase F (Part 3b).
 *
 * Binds (or unbinds) a guard contract over a SUBJECT: either a token
 * the user issued (TICK → ISSUE v6) or the signing address itself
 * (ADDRESS v1). The guard `controller` is the action_index of a
 * deployed contract; `actionClass` ∈ {transfer, trade, burn, mint,
 * stake, ownership, all} names which native actions the guard gates
 * (`all` is the catch-all: every class, present and future, wherever no
 * class-specific controller covers one); `cooldownBlocks`
 * delays an unbind taking effect (bind only).
 *
 * Stage machine mirrors the other contract forms: form → review →
 * submitting → done. Params are built host-side via the SDK's
 * `controller.*` helper (core can't import the SDK), then submitted
 * through the same `advancedAction` (createAction → sign → broadcast)
 * path every other action form uses. The SDK controller helper ships
 * under Phase F Part 2 and may not exist yet. The form degrades
 * gracefully: the action-class dropdown falls back to the locked-fact
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
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    // 'token' → ISSUE v6 (gate a TICK); 'address' → ADDRESS v1 (gate the signer).
    const [target, setTarget] = useState(/** @type {'token' | 'address'} */ (tick ? 'token' : 'address'));
    const [unbind, setUnbind] = useState(false);
    const [controller, setController] = useState('');
    const [actionClass, setActionClass] = useState('transfer');
    const [cooldownBlocks, setCooldownBlocks] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [actionClasses, setActionClasses] = useState(/** @type {string[]} */ (FALLBACK_ACTION_CLASSES));

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                // D-153: opened WITHOUT a token (the address-controller lane),
                // there is no chain to inherit, so default to the first chain
                // the wallet has an address on - the same rule `useActionForm`
                // applies to every other free-entry form. Without it the form
                // renders its "no address on this chain" error over a wallet
                // that has plenty, because `chainId` is simply undefined.
                let cid = chainId;
                if (!cid) {
                    cid = Object.keys(byChain || {})[0];
                    if (!cid) {
                        setLoadError('No addresses on any chain yet. Use Receive to generate one first.');
                        return;
                    }
                    setChainId(cid);
                }
                const addrs = (byChain?.[cid] || []).filter(
                    (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
                );
                if (addrs.length === 0) {
                    setLoadError('No address on this chain to sign from. Use Receive to generate one first.');
                    return;
                }
                const sorted = [...addrs].sort((a, b) => {
                    const ai = (externalIndexOf(a.derivationPath) ?? -1);
                    const bi = (externalIndexOf(b.derivationPath) ?? -1);
                    return bi - ai;
                });
                setFromAddressId(sorted[0].id);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    // Action-class list from the SDK (degrades to the locked-fact list).
    useEffect(() => {
        if (!chainId) return undefined;
        if (typeof messaging?.getControllerActionClasses !== 'function') return undefined;
        let cancelled = false;
        messaging.getControllerActionClasses({ chainId })
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res?.actionClasses) ? res.actionClasses : null;
                if (list && list.length > 0) {
                    setActionClasses(list);
                    if (!list.includes(actionClass)) setActionClass(list[0]);
                }
            })
            .catch(() => { /* keep the fallback list */ });
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

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
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

    const { isWatcherMode } = useWalletMode();

    // (§5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page, hardware
    // included. Watcher mode still branches: it encodes, it
    // never signs. Unlike the other action
    // forms the wire action/params are built HOST-side (the SDK's controller
    // helper lives there), so the built pair is stashed for the confirm
    // page's decoded intent.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
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
    const [builtAction, setBuiltAction] = useState(
        /** @type {{ action: string, params: object } | null} */ (null),
    );

    async function openConfirmScreen() {
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
            const { action, params } = await messaging.buildControllerBindParams({
                chainId,
                target,
                unbind,
                tick: target === 'token' ? String(tick).trim() : undefined,
                controller: String(controller).trim(),
                actionClass,
                ...(!unbind && cooldownBlocks.trim() !== '' && { cooldownBlocks: cooldownBlocks.trim() }),
                ...(memo.trim() !== '' && { memo: memo.trim() }),
            });
            setBuiltAction({ action, params });
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
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No source address available.');
            return;
        }
        if (target === 'token' && (!tick || !String(tick).trim())) {
            setFormError('No token selected to bind. Open this form from a token you issued.');
            return;
        }
        // An UNBIND names no contract: the wire field is empty and the indexer
        // resolves the live binding for ACTION_CLASS itself, ignoring anything
        // sent here (xchain-indexer issue.js format 6). Requiring it made the
        // ONLY surface that releases a token from a guard demand a number the
        // action does not use - and, since the submit button was gated on the
        // same emptiness with no message, it simply sat disabled.
        if (!unbind) {
            if (!String(controller).trim()) {
                setFormError('Guard contract is required (the action number of a deployed contract).');
                return;
            }
            if (Number.isNaN(Number(controller)) || Number(controller) < 0 || !Number.isInteger(Number(controller))) {
                setFormError('Guard contract must be a whole number that is zero or greater (the contract’s action number).');
                return;
            }
        }
        if (!actionClass) {
            setFormError('Pick an action class to gate.');
            return;
        }
        if (!unbind && cooldownBlocks.trim() !== '') {
            const cb = Number(cooldownBlocks.trim());
            if (!Number.isInteger(cb) || cb < 0) {
                setFormError('Cooldown blocks must be a non-negative whole number.');
                return;
            }
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        try {
            const { action, params } = await messaging.buildControllerBindParams({
                chainId,
                target,
                unbind,
                tick: target === 'token' ? String(tick).trim() : undefined,
                controller: String(controller).trim(),
                actionClass,
                ...(!unbind && cooldownBlocks.trim() !== '' && { cooldownBlocks: cooldownBlocks.trim() }),
                ...(memo.trim() !== '' && { memo: memo.trim() }),
            });
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
                action,
                params,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else if (isHwSource) {
                res = await messaging.advancedActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.advancedAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        fallback: err?.message || `${unbind ? 'Unbind' : 'Bind'} failed.`,
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
    const subjectLabel = target === 'token'
        ? `token ${tick || ''}`.trim()
        : 'this address';

        const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting'
                    ? `Review ${verb.toLowerCase()} controller`
                    : `${verb} controller`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>
            </>,
        );
    }
    if (!addressesByChain) {
        return wrap(<p>Loading addresses…</p>);
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) return wrap(<QueuedResultPanel onDone={onBack} />);
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        return wrap(
            <>
                <p className={styles.summary}>
                    {verb} broadcast. The network will apply the controller change shortly.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || '-')}</dd>
                </dl>
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
                    {unbind
                        ? `Stop gating the ${actionClass} actions of ${subjectLabel}. `
                            + 'Whichever contract currently guards that class is released.'
                        : `Bind guard contract #${String(controller).trim()} over the ${actionClass} actions of ${subjectLabel}.`}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
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
                    <dt className={styles.detailsLabel}>Action class</dt>
                    <dd className={styles.detailsValue}>{actionClass}</dd>
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
                {(isWatcherMode || isHwSource) && submitError ? (
                    <StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>
                ) : null}
                <div className={styles.actions}>
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
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `${verb} on ${descriptor.displayName}` : verb)}
                    </Button>
                </div>
            </form>,
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

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <NetworkField value={chainId} onChange={(cid) => { setChainId(cid); setFromAddressId(null); }} chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]} chainRegistry={chainRegistry} />
            {fromAddress ? (
                <AddressField
                    label="From"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
            ) : null}

            <label className={styles.pickerLabel}>
                What to protect
                <select
                    className={styles.picker}
                    value={target}
                    onChange={(e) => setTarget(/** @type {any} */ (e.target.value))}
                >
                    {tick ? <option value="token">Token {tick}</option> : null}
                    <option value="address">This address</option>
                </select>
            </label>

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
                    onChange={(e) => setController(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}

            <label className={styles.pickerLabel}>
                Action class
                <select
                    className={styles.picker}
                    value={actionClass}
                    onChange={(e) => setActionClass(e.target.value)}
                >
                    {actionClasses.map((ac) => (
                        <option key={ac} value={ac}>{ac}</option>
                    ))}
                </select>
            </label>
            {/*
              * Two of the seven classes do not mean what their name suggests,
              * and both are consequential enough that offering them unlabelled
              * would be its own defect: `all` hands the contract every class,
              * including ones the protocol has not added yet, and `ownership`
              * gates the deed rather than the balances - which reads as a
              * synonym for `transfer` and is not one.
              */}
            <p className={styles.hint}>
                {actionClass === 'all'
                    ? 'all: every class, including ones added later. A class-specific binding still wins over this one.'
                    : actionClass === 'ownership'
                        ? 'ownership: transfers of the token itself (including a sweep), not transfers of its balances.'
                        : 'The native actions this guard is asked about. One binding per class.'}
            </p>

            <label className={styles.pickerLabel} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                    type="checkbox"
                    checked={unbind}
                    onChange={(e) => setUnbind(e.target.checked)}
                />
                Unbind (remove the controller) instead of binding
            </label>

            {!unbind ? (
                <Input
                    label="Cooldown blocks (optional)"
                    hint="Blocks a later unbind must wait before it takes effect. Leave blank for none."
                    inputMode="numeric"
                    value={cooldownBlocks}
                    onChange={(e) => setCooldownBlocks(e.target.value)}
                    autoComplete="off"
                />
            ) : null}

            <Input
                label="Memo (optional)"
                hint="Free-text note recorded with the bind/unbind event."
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
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

            {formError ? (
                <StatusMessage variant="error" className={styles.error}>{formError}</StatusMessage>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || (!unbind && !String(controller).trim()) || actionConfirm.composing}
                >
                    {singleEncode ? (unbind ? 'Unbind' : 'Bind') : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}
