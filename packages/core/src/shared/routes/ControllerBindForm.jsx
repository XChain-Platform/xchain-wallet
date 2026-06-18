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
    ScreenHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

const FALLBACK_ACTION_CLASSES = ['transfer', 'trade', 'burn', 'mint', 'stake'];

/**
 * Controller-bind authoring form: Phase F (Part 3b).
 *
 * Binds (or unbinds) a guard contract over a SUBJECT: either a token
 * the user issued (TICK → ISSUE v6) or the signing address itself
 * (ADDRESS v1). The guard `controller` is the action_index of a
 * deployed contract; `actionClass` ∈ {transfer, trade, burn, mint,
 * stake} names which native actions the guard gates; `cooldownBlocks`
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
export function ControllerBindForm({ walletId, chainId, tick, onBack }) {
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
                const addrs = (byChain?.[chainId] || []).filter(
                    (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
                );
                if (addrs.length === 0) {
                    setLoadError('No address on this chain to sign from. Use Receive to generate one first.');
                    return;
                }
                const sorted = [...addrs].sort((a, b) => {
                    const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                    const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
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

    const { isWatcherMode } = useWalletMode();

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
        if (!String(controller).trim()) {
            setFormError('Guard contract is required (the action_index of a deployed contract).');
            return;
        }
        if (Number.isNaN(Number(controller)) || Number(controller) < 0 || !Number.isInteger(Number(controller))) {
            setFormError('Guard contract must be a non-negative whole number (an action_index).');
            return;
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
            // Build params host-side via the SDK's controller helper.
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
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params },
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
                    : err?.message || `${unbind ? 'Unbind' : 'Bind'} failed.`,
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

    const verb = unbind ? 'Unbind' : 'Bind';
    const subjectLabel = target === 'token'
        ? `token ${tick || ''}`.trim()
        : 'this address';

        const header = (
        <ScreenHeader
            onBack={onBack}
            title="{stage === 'review' || stage === 'submitting'
                    ? `Review ${verb.toLowerCase()} controller`
                    : `${verb} controller`}"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!addressesByChain) {
        return wrap(<p>Loading addresses…</p>);
    }

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
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
                    {verb} broadcast. The indexer will apply the controller change shortly.
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
                    {verb} guard contract #{String(controller).trim()} over the {actionClass} actions of {subjectLabel}.
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
                    <dt className={styles.detailsLabel}>Guard contract</dt>
                    <dd className={styles.detailsValue}>#{String(controller).trim()}</dd>
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
                                : (descriptor ? `${verb} on ${descriptor.displayName}` : verb)}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div className={styles.chainLine}>
                {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
            </div>
            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>Signing from</span>
                    <AddressText address={fromAddress.address} />
                </div>
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

            <Input
                label="Guard contract"
                hint="Action_index of the deployed contract that will gate the selected actions."
                inputMode="numeric"
                value={controller}
                onChange={(e) => setController(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
            />

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

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !String(controller).trim()}
                >
                    Preview
                </Button>
            </div>
        </form>,
    );
}
