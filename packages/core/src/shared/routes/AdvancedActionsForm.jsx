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
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
 NetworkField,  Icon, FeeSelector, AddressField,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

/**
 * Turn an SDK validator error into text a human (and a screen reader) can
 * read. The SDK's error shape is not contractual, so a message-less object
 * must never reach the alert as a raw JSON dump.
 *
 * @param {unknown} err
 * @returns {string}
 */
// Exported for its own unit suite (test/unit/routes/advancedActionsValidationMessage.test.jsx):
// a pure string-formatting helper is far cheaper to pin directly than through the
// rendered form.
export function formatValidationError(err) {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
        const message = /** @type {{ message?: unknown }} */ (err).message;
        if (typeof message === 'string' && message) return message;
        const field = /** @type {{ field?: unknown }} */ (err).field;
        if (typeof field === 'string' && field) return `${field}: invalid value`;
    }
    return 'Invalid value';
}

// Rest-fields carry a '...' prefix in the SDK's field list (see
// xchain-sdk/src/formatSelector.js). The form splits array input on
// newlines/commas, same convention as AirdropForm's paste box.
const REST_PREFIX = '...';

// VERSION is auto-selected by the SDK's FormatSelector, never
// user-provided in the form.
const AUTO_FIELDS = new Set(['VERSION']);

// Actions that have their own dedicated forms. The Advanced form
// still exposes them (power users may want the raw field surface),
// but the dropdown decorates them with "(dedicated form available)"
// so the user doesn't reach for Advanced when a curated UX exists.
const ACTIONS_WITH_DEDICATED_FORMS = new Set([
    'SEND', 'SWEEP', 'ISSUE', 'MINT', 'DESTROY',
    'BROADCAST', 'DISPENSER', 'DIVIDEND', 'AIRDROP', 'LIST',
    'LINK',
]);

/**
 * Advanced Actions form (§40.10).
 *
 * Generic "submit any XChain action" surface for power users and for
 * action kinds without a dedicated form (FILE beyond collectibles,
 * ADDRESS, CALLBACK, SLEEP, raw MESSAGE). Fields are
 * driven entirely by the SDK's schema introspection; the form has no
 * per-action knowledge beyond generic rendering rules for rest-fields
 * + auto-fields.
 *
 * Stage machine: compose → review → submitting → done. Live
 * validation runs on every keystroke via `messaging.validateAction`.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function AdvancedActionsForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [actions, setActions] = useState(/** @type {string[] | null} */ (null));
    const [action, setAction] = useState('');
    const [formats, setFormats] = useState(
        /** @type {Record<string, string> | null} */ (null),
    );
    const [version, setVersion] = useState('');
    const [fields, setFields] = useState(/** @type {string[]} */ ([]));
    const [values, setValues] = useState(/** @type {Record<string, string>} */ ({}));
    const [validation, setValidation] = useState(
        /** @type {{ valid: boolean, errors: any[] } | null} */ (null),
    );

    const [payFeeInNativeCoin, setPayFeeInNativeCoin] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review' | 'submitting' | 'done'} */ ('compose'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before authoring an action.',
                    );
                    return;
                }
                setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const addrs = (addressesByChain[chainId] || []).filter(
            (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
        );
        if (addrs.length > 0) {
            const sorted = [...addrs].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        } else {
            setFromAddressId(null);
        }
    }, [chainId, addressesByChain]);

    useEffect(() => {
        if (!chainId) return;
        let cancelled = false;
        messaging.listActions({ chainId })
            .then((list) => {
                if (!cancelled) {
                    const sorted = [...(list || [])].sort();
                    setActions(sorted);
                }
            })
            .catch((err) => {
                if (!cancelled) setFormError(err?.message || 'Failed to load actions.');
            });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    useEffect(() => {
        if (!chainId || !action) {
            setFormats(null);
            setFields([]);
            setValues({});
            setValidation(null);
            return;
        }
        let cancelled = false;
        Promise.all([
            messaging.getActionFormats({ chainId, action }),
            messaging.getActionFields({ chainId, action }),
        ])
            .then(([fmts, fls]) => {
                if (cancelled) return;
                setFormats(fmts || {});
                const filtered = (fls || []).filter((f) => !AUTO_FIELDS.has(baseFieldName(f)));
                // Deduplicate: multi-version formats repeat rest-field
                // slots across versions; we only want one input per
                // canonical name.
                const seen = new Set();
                const unique = [];
                for (const f of filtered) {
                    const key = f; // preserve '...' prefix so rest-fields render as arrays
                    if (!seen.has(key)) { seen.add(key); unique.push(f); }
                }
                setFields(unique);
                setValues({});
                setValidation(null);
            })
            .catch((err) => {
                if (!cancelled) setFormError(err?.message || 'Failed to load action fields.');
            });
        return () => { cancelled = true; };
    }, [chainId, action, messaging]);

    // Live validation: runs on every keystroke. The SDK validator is
    // in-memory only (no network), so the cost is negligible.
    useEffect(() => {
        if (!chainId || !action || fields.length === 0) {
            setValidation(null);
            return;
        }
        const populated = buildParams(fields, values, version);
        // Only validate if at least one field is filled. Empty forms
        // shouldn't splash red on first load.
        const anyFilled = Object.values(populated).some(
            (v) => v !== '' && (!Array.isArray(v) || v.length > 0),
        );
        if (!anyFilled) { setValidation(null); return; }
        let cancelled = false;
        messaging.validateAction({ chainId, action, params: populated })
            .then((res) => { if (!cancelled) setValidation(res); })
            .catch(() => { /* validation is advisory; swallow network hiccups */ });
        return () => { cancelled = true; };
    }, [chainId, action, fields, values, version, messaging]);

    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? (PROTOCOL_COIN_TICKER[descriptor.coin] || '') : '';
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

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

    const actionParams = useMemo(
        () => buildParams(fields, values, version),
        [fields, values, version],
    );

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action,
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, action, actionParams, chainId]);

    const handleFieldChange = useCallback((field, rawValue) => {
        setValues((prev) => ({ ...prev, [field]: rawValue }));
    }, []);

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!action) {
            setFormError('Pick an action.');
            return;
        }
        if (validation && !validation.valid) {
            setFormError('Fix the validation errors below before previewing.');
            return;
        }
        setFormError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    // The user-chosen `action` is passed straight into actionData.
    const { isWatcherMode } = useWalletMode();

    //  ( §5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page; hardware +
    // watcher keep the legacy Preview/review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = actionConfirm.enabled && !isWatcherMode && !isHwSource;
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

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
                actionData: { action, params: actionParams },
                encoderOpts: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => messaging.advancedAction({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    action,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    password: passwordValueRef.current,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.message || 'Action failed.');
        }
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
                action,
                params: actionParams,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params: actionParams },
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (isHwSource) {
                res = await messaging.advancedActionHw({
                    ...base,
                    signerId: fromAddress.signerId,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                });
            } else {
                res = await messaging.advancedAction({
                    ...base,
                    password,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            const isNativeFeeErr = err?.name === 'NativeFeeForfeitError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : isNativeFeeErr && err?.reason === 'unsupported'
                        ? `Paying the protocol fee in ${coinTicker || 'the native coin'} is not available for this action. Turn it off to pay in XCHAIN.`
                    : isNativeFeeErr
                        ? 'The native-coin fee price is temporarily unavailable. Try again in a moment, or turn off native-coin fee payment.'
                    : err?.message || 'Action failed.',
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
                    ? `Review ${action || 'action'}`
                    : 'Advanced action'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
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
                <h2 className={styles.successTitle}>{actionDisplayLabel(action)} sent</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>{decoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(decoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
                </dl>
                {payFeeInNativeCoin ? (
                    <div role="alert" className={styles.warnings}>
                        <p className={styles.warning}>{NATIVE_FEE_WARNING}</p>
                    </div>
                ) : null}
                {decoded && decoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
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
                                : isHwSource
                                    ? hwStatus !== 'available'
                                    : (!signerReady && password.length === 0)
                        }
                    >
                        {isWatcherMode
                            ? 'Create unsigned transaction'
                            : isHwSource
                                ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : (descriptor ? `Sign on ${descriptor.displayName}` : 'Sign')}
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
                decoded={decoderLib.decodeAction({
                    action,
                    params: actionParams,
                    chainId: chainId || undefined,
                    chainRegistry,
                })}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
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
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // stage === 'compose'
    return wrap(
        <form onSubmit={handleReview} noValidate>
            <NetworkField value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />

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
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            <label className={styles.pickerLabel}>
                Action
                <select
                    className={styles.picker}
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                >
                    <option value="">Pick an action</option>
                    {(actions || []).map((a) => (
                        <option key={a} value={a}>
                            {actionDisplayLabel(a)} ({a})
                            {ACTIONS_WITH_DEDICATED_FORMS.has(a)
                                ? ' (dedicated form available)'
                                : ''}
                        </option>
                    ))}
                </select>
            </label>

            {action && formats && Object.keys(formats).length > 1 ? (
                <label className={styles.pickerLabel}>
                    Format version
                    <select
                        className={styles.picker}
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                    >
                        <option value="">Auto-select (recommended)</option>
                        {Object.keys(formats).map((v) => (
                            <option key={v} value={v}>
                                v{v}: {formats[v]}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}

            {action && fields.length === 0 ? (
                <p className={styles.hint}>
                    This action takes no user-provided fields.
                </p>
            ) : null}

            {fields.map((fieldName) => {
                const base = baseFieldName(fieldName);
                const isRest = fieldName.startsWith(REST_PREFIX);
                const raw = values[base] ?? '';
                if (isRest) {
                    return (
                        <label key={fieldName} className={styles.pickerLabel}>
                            {base} (one per line or comma-separated)
                            <textarea
                                className={styles.picker}
                                value={raw}
                                onChange={(e) => handleFieldChange(base, e.target.value)}
                                rows={4}
                                spellCheck={false}
                                autoCapitalize="none"
                                autoCorrect="off"
                                aria-label={`${base}: list values, one per line or comma-separated`}
                            />
                        </label>
                    );
                }
                return (
                    <Input
                        key={fieldName}
                        label={base}
                        value={raw}
                        onChange={(e) => handleFieldChange(base, e.target.value)}
                        autoCapitalize="off"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                );
            })}

            {validation && !validation.valid && validation.errors.length > 0 ? (
                <div role="alert" className={styles.warnings}>
                    {validation.errors.map((err, i) => (
                        <p key={i} className={styles.warning}>
                            {formatValidationError(err)}
                        </p>
                    ))}
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

            <NativeFeeToggle
                checked={payFeeInNativeCoin}
                onChange={setPayFeeInNativeCoin}
                coinTicker={coinTicker}
            />

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !action || actionConfirm.composing}
                >
                    {singleEncode ? 'Sign action' : 'Preview'}
                </Button>
            </div>
        </form>,
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}

function baseFieldName(fieldName) {
    return fieldName.startsWith(REST_PREFIX)
        ? fieldName.substring(REST_PREFIX.length)
        : fieldName;
}

// Compose the final params object submitted to the SDK. Rest-fields
// split their textarea value on newlines/commas; scalars trim; empty
// strings drop out (the SDK treats missing fields as default).
function buildParams(fields, values, version) {
    /** @type {Record<string, unknown>} */
    const out = {};
    if (version !== '' && version !== null && version !== undefined) {
        out.VERSION = String(version);
    }
    for (const fieldName of fields) {
        const base = baseFieldName(fieldName);
        const raw = values[base];
        if (raw === undefined || raw === null) continue;
        if (fieldName.startsWith(REST_PREFIX)) {
            const parts = String(raw)
                .split(/[\r\n,]+/g)
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            if (parts.length > 0) out[base] = parts;
        } else {
            const trimmed = String(raw).trim();
            if (trimmed.length > 0) out[base] = trimmed;
        }
    }
    return out;
}
