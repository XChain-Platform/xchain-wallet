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
    Select,
    ChainBadge,
    NetworkField,
    AddressText,
 Icon, FeeSelector, AddressField,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import {
    nativeFeeErrorMessage,
    NATIVE_FEE_WARNING,
    NATIVE_FEE_UNVERIFIED_NOTICE,
} from '../../sdk/nativeFeePreflight.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { useContractManifest } from '../hooks/useContractManifest.js';
import { extractSingle, sanitizeAbi } from './contractResponseShape.js';
import { ContractConsentPanel } from '../components/ContractConsentPanel.jsx';
import { preferredSourceId } from '../addressSelection.js';
import styles from './IssueTokenForm.module.css';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';

const chainRegistry = registryLib.defaultRegistry();

/**
 * EXECUTE contract method form (§42.4).
 *
 * Two authoring lanes. When the contract publishes an `abi` block
 * (xchain-documentation/protocol/Contract_ABI.md, surfaced by the explorer
 * on /api/contract/{idx}), the form renders a method selector plus one
 * typed input per declared param; a manual lane (free-text method name +
 * pipe-delimited params) remains the fallback and an explicit toggle,
 * because the abi is self-declared metadata that may be absent or wrong.
 *
 * Inputs split the pipe-delimited parameter string into an array on
 * submit. The SDK validator expects PARAMS as an array, not a single
 * string, and enforces no-pipe-or-semicolon inside each element.
 *
 * Gas limit defaults to 50000 if the user leaves the field blank.
 * contracts.suggestGasLimit is a source-code heuristic, not available
 * from the contract row alone, so an execute-time estimate isn't
 * automatic. Users override freely.
 *
 * The initial* props prefill the form from an xchain:{COIN}/execute deep
 * link (explorer Write-tab handoff); all optional.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.contractActionIndex
 * @param {string} [props.initialMethod]
 * @param {string} [props.initialParamsText]
 * @param {string} [props.initialGasLimit]
 * @param {() => void} props.onBack
 */
export function ExecuteContractForm({ walletId, chainId, contractActionIndex, initialMethod, initialParamsText, initialGasLimit, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [method, setMethod] = useState(initialMethod || '');
    const [paramsText, setParamsText] = useState(initialParamsText || '');
    const [gasLimit, setGasLimit] = useState(initialGasLimit || '');
    const [password, setPassword] = useState('');

    // ABI lane state: the contract's self-declared method metadata (null =
    // none published / not loaded), an explicit manual-mode escape hatch,
    // and per-param values for the selected method (joined into paramsText,
    // which stays the single source of truth for submit).
    const [contractAbi, setContractAbi] = useState(/** @type {{version: number, methods: Record<string, any>} | null} */ (null));
    const [manualMode, setManualMode] = useState(false);
    const [abiParamValues, setAbiParamValues] = useState(/** @type {string[]} */ ([]));

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId)
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                // Execute from the chain's active address (else newest HD
                // external), matching Send so the action's SOURCE is the
                // operating address.
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) {
                    setLoadError('No address on this chain to execute from. Use Receive to generate one first.');
                    return;
                }
                setFromAddressId(sourceId);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    // Fetch the contract's declared abi once (same explorer row ContractDetail
    // reads). Absence or fetch failure just leaves the manual lane in place;
    // the abi is optional display metadata. Reconciles with any deep-link
    // prefill: a prefilled method the abi knows seeds its typed inputs, a
    // method the abi does NOT know keeps manual mode so the link's intent
    // is preserved verbatim.
    useEffect(() => {
        if (typeof messaging.getContractByActionIndex !== 'function') return undefined;
        let cancelled = false;
        messaging.getContractByActionIndex({ chainId, contractActionIndex })
            .then((resp) => {
                if (cancelled) return;
                const row = extractSingle(resp);
                // sanitizeAbi guarantees every kept method has an array `params`,
                // so the .map sites below (and at render) can never throw on a
                // malformed/hostile abi. Null => fall back to the manual lane.
                const abi = sanitizeAbi(row && row.abi);
                if (!abi) return;
                setContractAbi(abi);
                const names = Object.keys(abi.methods);
                if (initialMethod && names.includes(initialMethod)) {
                    const declared = abi.methods[initialMethod].params || [];
                    const given = (initialParamsText || '').split('|');
                    setAbiParamValues(declared.map((p, i) => (given[i] !== undefined ? given[i] : '')));
                } else if (initialMethod) {
                    setManualMode(true);
                } else {
                    const first = names[0];
                    setMethod(first);
                    setAbiParamValues(new Array((abi.methods[first].params || []).length).fill(''));
                    // Clear any manual-lane text typed before the abi resolved, so
                    // the auto-selected method can't silently submit stale params
                    // (mirrors selectAbiMethod's reset).
                    setParamsText('');
                }
            })
            .catch(() => { /* optional metadata; manual lane covers absence */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- initial* are mount-time prefill constants
    }, [chainId, contractActionIndex, messaging]);

    const descriptor = chainRegistry.get(chainId);
    const coinTicker = protocolCoinTickerFor(descriptor || chainId);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // : EXECUTE is fee-bearing, and this form had no fee lane at all
    // because BTC could always settle the protocol fee from an XCHAIN balance.
    // On every other protocol coin there is no XCHAIN lane, so the hook forces
    // the native output on rather than offering a choice that does not exist.
    // The quote behind it is 's schedule price, which carries no verdict
    // (`valid:null`), hence `unverified` on the row: the amount is exact, the
    // acceptance is not pre-judged, and the fee is spent either way.
    const nativeFee = useNativeFee(chainId);

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
    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: isHwSource ? fromAddress?.signerId : null,
    });
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    const { isWatcherMode } = useWalletMode();

    //  ( §5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page, hardware
    // included . Watcher mode still branches: it encodes, it
    // never signs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // : hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: isHwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'executeAction',
        hardware: 'executeActionHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
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
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'EXECUTE', params: actionParams },
                // The fee mode must reach COMPOSE, not just submit: the
                // FEE_DESTINATION output has to be inside the PSBT the user
                // approves and the tamper check verifies.
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.name === 'NativeFeeForfeitError'
                ? nativeFeeErrorMessage(err, { coinTicker, mandatory: nativeFee.mandatory })
                : err?.message || 'Execute failed.');
        }
    }

    // Phase F: permissions-manifest consent disclosure, shown inline in
    // the review `<dl>`. Deferred via `skip` until the user reaches the
    // review stage so we don't fetch a manifest the user may never see.
    const manifest = useContractManifest({
        chainId,
        contractActionIndex,
        skip: stage !== 'review' && stage !== 'submitting',
    });

    const paramsArray = useMemo(
        () => paramsText.split('|').map((s) => s.trim()).filter((s) => s !== ''),
        [paramsText],
    );

    // ABI lane derivations. Params are positional on the wire, so a blank
    // middle value would silently shift later args after the empty-filter in
    // paramsArray; the lane therefore requires every declared param filled
    // before Preview enables.
    const abiActive = Boolean(contractAbi) && !manualMode;
    const abiSpec = abiActive && method && contractAbi.methods[method] ? contractAbi.methods[method] : null;
    const abiParams = Array.isArray(abiSpec?.params) ? abiSpec.params : [];
    const abiIncomplete = abiParams.length > 0 && abiParamValues.some((v) => !String(v).trim());

    function selectAbiMethod(name) {
        setMethod(name);
        const count = ((contractAbi.methods[name] || {}).params || []).length;
        setAbiParamValues(new Array(count).fill(''));
        setParamsText('');
    }

    function setAbiParam(i, value) {
        const next = abiParamValues.slice();
        next[i] = value;
        setAbiParamValues(next);
        setParamsText(next.join('|'));
    }

    // Placeholder text per declared param type; purely an input hint, the
    // wire value is always a string.
    function abiPlaceholder(type) {
        switch (type) {
            case 'number': return 'e.g. 42';
            case 'amount': return 'e.g. 1.50000000';
            case 'address': return 'address';
            case 'tick': return 'e.g. XCHAIN';
            case 'bool': return 'true or false';
            case 'json': return '{"key":"value"}';
            default: return '';
        }
    }

    const actionParams = useMemo(() => {
        /** @type {Record<string, any>} */
        const p = {
            VERSION: '0',
            CONTRACT_ACTION_INDEX: String(contractActionIndex),
            METHOD: method.trim(),
            GAS_LIMIT: String(gasLimit || '50000'),
        };
        if (paramsArray.length > 0) p.PARAMS = paramsArray;
        return p;
    }, [contractActionIndex, method, gasLimit, paramsArray]);

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No source address available.');
            return;
        }
        if (!method.trim()) {
            setFormError('Method name is required.');
            return;
        }
        const gas = String(gasLimit).trim() || '50000';
        if (Number.isNaN(Number(gas)) || Number(gas) <= 0) {
            setFormError('Gas limit must be a positive number.');
            return;
        }
        // Validator forbids pipes/semicolons inside each PARAM, which
        // our split eliminates; it also forbids them at the field
        // boundaries. Nothing we can do about those except surface
        // clearly below.
        for (const p of paramsArray) {
            if (p.includes(';')) {
                setFormError(`Parameter "${p}" contains a semicolon, which is not allowed in parameters.`);
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
                params: actionParams,
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'EXECUTE', params: actionParams },
                    // The watcher lane builds the PSBT the signer wallet will
                    // sign blind, so the fee output has to be in it here.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.executeActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.executeAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.name === 'NativeFeeForfeitError'
                        ? nativeFeeErrorMessage(err, { coinTicker, mandatory: nativeFee.mandatory })
                        : err?.message || 'Contract call failed.',
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
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting'
                    ? 'Review contract call'
                    : `Call contract #${contractActionIndex}`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
            </>,
        );
    }
    if (!addressesByChain) {
        return wrap(<p>Loading addresses…</p>);
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        // : a queued result is SIGNED and not broadcast. The confirm
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
                <p className={styles.summary}>Method call broadcast.</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || '(none)')}</dd>
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
                    Call {actionParams.METHOD}
                    {paramsArray.length > 0 ? ` with ${paramsArray.length} arg${paramsArray.length === 1 ? '' : 's'}` : ''}
                    {' '}on contract #{actionParams.CONTRACT_ACTION_INDEX}.
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
                    <dt className={styles.detailsLabel}>Contract</dt>
                    <dd className={styles.detailsValue}>#{actionParams.CONTRACT_ACTION_INDEX}</dd>
                    <dt className={styles.detailsLabel}>Method</dt>
                    <dd className={styles.detailsValue}>{actionParams.METHOD}</dd>
                    {paramsArray.length > 0 ? (
                        <>
                            <dt className={styles.detailsLabel}>Params</dt>
                            <dd className={styles.detailsValue}>
                                <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
                                    {paramsArray.map((p, i) => (
                                        <li key={i} style={{ fontFamily: 'monospace' }}>{p}</li>
                                    ))}
                                </ol>
                            </dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>Gas limit</dt>
                    <dd className={styles.detailsValue}>{actionParams.GAS_LIMIT}</dd>
                    <dt className={styles.detailsLabel}>Network fee</dt>
                    <dd className={styles.detailsValue}>
                        {feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    </dd>
                    <dt className={styles.detailsLabel}>Protocol fee</dt>
                    <dd className={styles.detailsValue}>
                        {nativeFee.payFeeInNativeCoin
                            ? `Paid in ${coinTicker || 'the native coin'}`
                            : 'Paid from your XCHAIN balance'}
                    </dd>
                    <ContractConsentPanel
                        manifest={manifest}
                        labelClassName={styles.detailsLabel}
                        valueClassName={styles.detailsValue}
                    />
                </dl>
                {/* The review stage is the watcher lane's last stop before the
                    PSBT leaves for a signer wallet, so the forfeiture terms are
                    stated here rather than only on the confirm page. */}
                {nativeFee.payFeeInNativeCoin ? (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>{NATIVE_FEE_WARNING}</p>
                        <p className={styles.warning}>{NATIVE_FEE_UNVERIFIED_NOTICE}</p>
                    </div>
                ) : null}
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
                        signerInfo={hwSignerInfo}
                    />
                )}
                {(isWatcherMode || isHwSource) && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
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
                                : (descriptor ? `Execute on ${descriptor.displayName}` : 'Execute')}
                    </Button>
                </div>
            </form>,
        );
    }

    //  confirm page, rendered in place of the form (the overlay modal
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
                // : hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
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
            {/* The target contract pins the network, so the field is single-option. */}
            <NetworkField value={chainId} onChange={() => {}} chainIds={[chainId]} chainRegistry={chainRegistry} />
            {fromAddress ? (
                <AddressField
                    label="Caller"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
            ) : null}
            {abiActive ? (
                <>
                    <Select
                        label="Method"
                        hint={abiSpec ? [abiSpec.summary, abiSpec.view ? '(declared read-only)' : null].filter(Boolean).join(' ') || undefined : undefined}
                        value={method}
                        onChange={(e) => selectAbiMethod(e.target.value)}
                    >
                        {Object.keys(contractAbi.methods).map((name) => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </Select>
                    {abiParams.map((p, i) => (
                        <Input
                            key={`${method}:${p.name}`}
                            label={`${p.name} (${p.type})`}
                            placeholder={abiPlaceholder(p.type)}
                            inputMode={p.type === 'number' || p.type === 'amount' ? 'decimal' : undefined}
                            value={abiParamValues[i] || ''}
                            onChange={(e) => setAbiParam(i, e.target.value)}
                            autoComplete="off"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                    ))}
                    <Button type="button" variant="ghost" onClick={() => setManualMode(true)}>
                        Enter method manually
                    </Button>
                </>
            ) : (
                <>
                    <Input
                        label="Method"
                        hint="Name of the contract method to call."
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <Input
                        label="Params (optional)"
                        hint="Pipe-delimited arguments, e.g. foo|42|bc1q… Leave blank for no-arg methods."
                        value={paramsText}
                        onChange={(e) => setParamsText(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    {contractAbi ? (
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                                // Back to the declared-methods lane; reselect the
                                // current method when the abi knows it, else the first.
                                const names = Object.keys(contractAbi.methods);
                                setManualMode(false);
                                selectAbiMethod(names.includes(method) ? method : names[0]);
                            }}
                        >
                            Use declared methods
                        </Button>
                    ) : null}
                </>
            )}
            <Input
                label="Gas limit"
                hint="The most this call is allowed to spend on computation. Leave blank for the default (50000)."
                inputMode="numeric"
                value={gasLimit}
                onChange={(e) => setGasLimit(e.target.value)}
                autoComplete="off"
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

            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} unverified />

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !method.trim() || (abiActive && abiIncomplete) || actionConfirm.composing}
                >
                    {singleEncode ? 'Execute' : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}
