// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BatchComposerForm (PC-36): the ATOMIC batch composer, the counterpart to
// ParallelComposer (which submits independent actions sequentially, with no
// rollback). A BATCH executes every queued sub-action in ONE transaction:
// all-or-nothing, on ONE chain from ONE source address. The user queues
// sub-actions as (action, JSON params) steps; the composer pre-checks the
// BATCH constraints live (at most one ISSUE / MINT / FILE; no nested BATCH
// or DEPLOY), builds the canonical COMMAND host-side via the SDK, previews
// it, and signs the BATCH through the generic advancedAction path
// (action='BATCH', params={ COMMAND }) - so software, hardware, and
// watcher signers all work exactly as they do for any other action.
//
// FILE is excluded from the picker: a FILE sub-action needs the tx's single
// rawData payload, which the dedicated file / gated publishers own (the two
// BATCH shapes users actually need). This generic composer targets power
// users assembling several metadata actions atomically.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    ChainBadge,
    AddressText,
    FeeSelector,
} from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Actions the generic atomic composer cannot queue: the two the protocol
// forbids in a BATCH (nested BATCH, DEPLOY) plus FILE (needs the tx's one
// rawData payload; the file/gated publishers own that shape).
const EXCLUDED_ACTIONS = new Set(['BATCH', 'DEPLOY', 'FILE']);

const FALLBACK_ACTIONS = [
    'SEND', 'ISSUE', 'MINT', 'DESTROY', 'BROADCAST',
    'DISPENSER', 'DIVIDEND', 'AIRDROP', 'LIST',
    'ORDER', 'SWAP', 'COINPAY', 'MESSAGE', 'LINK', 'SLEEP',
];

let nextRowId = 0;
const newRowId = () => `brow-${++nextRowId}`;

function pickDefaultAddressId(addrs) {
    if (!Array.isArray(addrs) || addrs.length === 0) return null;
    const hd = addrs.filter(
        (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
    );
    const pool = hd.length > 0 ? hd : addrs;
    const sorted = [...pool].sort((a, b) => {
        const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
        const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
        return bi - ai;
    });
    return sorted[0].id;
}

function blankRow() {
    return { id: newRowId(), action: '', paramsJson: '{\n  "VERSION": "0"\n}' };
}

/** Parse one row's params; returns { params } or { error }. */
function parseRowParams(json) {
    if (typeof json !== 'string' || json.trim().length === 0) {
        return { error: 'params JSON cannot be empty' };
    }
    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { error: 'params must be a JSON object' };
        }
        return { params: parsed };
    } catch (err) {
        return { error: `params JSON parse error: ${err?.message || String(err)}` };
    }
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function BatchComposerForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const { isWatcherMode } = useWalletMode();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [actionsList, setActionsList] = useState(/** @type {string[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [rows, setRows] = useState(/** @type {Array<{id:string,action:string,paramsJson:string}>} */ ([blankRow()]));

    const [stage, setStage] = useState(/** @type {'compose'|'review'|'submitting'|'done'} */ ('compose'));
    const [composed, setComposed] = useState(/** @type {{command:string,subStrings:string[]}|null} */ (null));
    const [buildError, setBuildError] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [hwStatus, setHwStatus] = useState('idle');
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            messaging.listActions
                ? messaging.listActions({ chainId: chainRegistry.supportedChains()[0]?.id }).catch(() => null)
                : Promise.resolve(null),
        ]).then(([byChain, actions]) => {
            if (cancelled) return;
            setAddressesByChain(byChain || {});
            const raw = (Array.isArray(actions) && actions.length > 0) ? actions : FALLBACK_ACTIONS;
            setActionsList(raw.filter((a) => !EXCLUDED_ACTIONS.has(String(a).toUpperCase())));
            const chains = Object.entries(byChain || {})
                .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                .map(([cid]) => cid);
            if (chains.length === 0) {
                setLoadError('No addresses on any chain yet. Use Receive to generate one before composing a batch.');
                return;
            }
            setChainId(chains[0]);
            setFromAddressId(pickDefaultAddressId(byChain[chains[0]] || []));
        }).catch((err) => {
            if (!cancelled) setLoadError(err?.message || 'Failed to load wallet.');
        });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const chainsWithAddresses = useMemo(() => (
        addressesByChain
            ? Object.entries(addressesByChain).filter(([, a]) => Array.isArray(a) && a.length > 0).map(([cid]) => cid)
            : []
    ), [addressesByChain]);

    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor
        ? ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[descriptor.coin] || '')
        : '';

    // Network fee: Low / Normal / Fast / Custom (mirrors BroadcastForm).
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low'|'normal'|'fast'|'custom', customRate?: number }} */ ({ mode: 'normal' }),
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

    // Resolve each row's params; the first parse error blocks compose.
    const parsedRows = useMemo(() => rows.map((r) => ({ row: r, ...parseRowParams(r.paramsJson) })), [rows]);

    const composeError = useMemo(() => {
        for (let i = 0; i < parsedRows.length; i += 1) {
            const pr = parsedRows[i];
            if (!pr.row.action) return `Step ${i + 1}: pick an action.`;
            if (pr.error) return `Step ${i + 1}: ${pr.error}`;
        }
        const subActions = parsedRows.map((pr) => ({ action: pr.row.action }));
        const constraintErrors = flowsLib.validateBatchConstraints(subActions);
        return constraintErrors.length > 0 ? constraintErrors[0] : null;
    }, [parsedRows]);

    const updateRow = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    const addRow = () => setRows((rs) => [...rs, blankRow()]);
    const removeRow = (i) => setRows((rs) => rs.filter((_, idx) => idx !== i));

    async function goReview() {
        if (composeError) return;
        setBuildError(null);
        setStage('review');
        setComposed(null);
        try {
            const subActions = parsedRows.map((pr) => ({ action: pr.row.action, params: pr.params }));
            const res = await messaging.buildBatchCommand({ chainId, subActions });
            setComposed({ command: res.command, subStrings: res.subStrings || String(res.command).split(';') });
        } catch (err) {
            setBuildError(err?.message || 'Failed to compose the batch.');
        }
    }

    async function handleSign(event) {
        event.preventDefault();
        if (stage === 'submitting' || !composed) return;
        const hw = isHwSource(fromAddress);
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
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
        const params = { VERSION: '0', COMMAND: composed.command };
        try {
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from,
                    actionData: { action: 'BATCH', params },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else if (hw) {
                res = await messaging.advancedActionHw({
                    walletId, chainId, from, action: 'BATCH', params,
                    signerId: fromAddress.signerId,
                    ...(feePerKb != null ? { feePerKb } : {}),
                });
            } else {
                res = await messaging.advancedAction({
                    walletId, chainId, from, action: 'BATCH', params, password,
                    ...(feePerKb != null ? { feePerKb } : {}),
                });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : (err?.message || 'Batch failed.'));
            setStage('review');
            if (!isWatcherMode && !isHwSource(fromAddress)) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    const header = (
        <PageHeader onBack={onBack} title={stage === 'compose' ? 'Atomic batch' : 'Review batch'} />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    if (!addressesByChain || !chainId) return wrap(<p className={styles.hint}>Loading wallet…</p>);

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={() => { setResult(null); setComposed(null); setStage('compose'); }}
                    onDone={onBack}
                />,
            );
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Batch broadcast</h2>
                <p className={styles.hint}>All {rows.length} action{rows.length === 1 ? '' : 's'} settle together, or not at all.</p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}><Button variant="primary" onClick={onBack}>Done</Button></div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const hw = isHwSource(fromAddress);
        return wrap(
            <form onSubmit={handleSign} noValidate>
                <p className={styles.summary} style={{ textAlign: 'left' }}>
                    <strong>Atomic:</strong> all {rows.length} action{rows.length === 1 ? '' : 's'} confirm in one
                    transaction, or none do. This is the opposite of the parallel composer, where each action
                    settles on its own.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress?.address} /></dd>
                </dl>

                {buildError ? <p role="alert" className={styles.error}>{buildError}</p> : null}
                {!composed && !buildError ? <p className={styles.hint}>Composing…</p> : null}
                {composed ? (
                    <>
                        <p className={styles.successLabel}>Batch steps ({composed.subStrings.length})</p>
                        <ol style={{ paddingLeft: '1rem', margin: 'var(--xc-space-2) 0' }}>
                            {composed.subStrings.map((s, i) => (
                                <li key={i} style={{ margin: 'var(--xc-space-1) 0' }}>
                                    <code style={{ fontSize: 'var(--xc-text-xs)', wordBreak: 'break-all' }}>{s}</code>
                                </li>
                            ))}
                        </ol>
                    </>
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

                {!isWatcherMode ? (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
                        onStatusChange={setHwStatus}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                ) : null}
                {submitError && (hw || isWatcherMode) ? <div role="alert" className={styles.error}>{submitError}</div> : null}

                <div className={styles.actions}>
                    <Button type="button" variant="ghost" onClick={() => setStage('compose')} disabled={stage === 'submitting'}>
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={!composed || (!isWatcherMode && (hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)))}
                    >
                        {isWatcherMode ? 'Build unsigned PSBT' : hw ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}` : 'Sign batch'}
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'compose'
    return wrap(
        <>
            <p className={styles.hint} style={{ textAlign: 'left' }}>
                Queue several actions to settle atomically in one transaction from one address. At most one ISSUE,
                one MINT, and one FILE per batch; no nested batches or contract deploys. FILE-gated content uses the
                dedicated publisher.
            </p>

            <label className={styles.pickerLabel}>
                <span>Chain</span>
                <select
                    className={styles.picker}
                    value={chainId || ''}
                    onChange={(e) => {
                        const cid = e.target.value;
                        setChainId(cid);
                        setFromAddressId(pickDefaultAddressId(addressesByChain[cid] || []));
                    }}
                >
                    {chainsWithAddresses.map((cid) => {
                        const d = chainRegistry.get(cid);
                        return <option key={cid} value={cid}>{d ? d.displayName : cid}</option>;
                    })}
                </select>
            </label>
            <label className={styles.pickerLabel}>
                <span>From address</span>
                <select
                    className={styles.picker}
                    value={fromAddressId || ''}
                    onChange={(e) => setFromAddressId(e.target.value)}
                >
                    {(addressesByChain[chainId] || []).map((a) => (
                        <option key={a.id} value={a.id}>{a.address}</option>
                    ))}
                </select>
            </label>

            <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--xc-space-3) 0 0' }}>
                {rows.map((row, i) => (
                    <li key={row.id} style={{ marginBottom: 'var(--xc-space-3)' }}>
                        <fieldset style={{
                            border: '1px solid var(--xc-border)',
                            borderRadius: 'var(--xc-radius-md)',
                            padding: 'var(--xc-space-3)',
                            margin: 0,
                            background: 'var(--xc-bg-muted)',
                        }}>
                            <legend style={{ fontWeight: 600, padding: '0 var(--xc-space-2)' }}>Step {i + 1}</legend>
                            <label className={styles.pickerLabel}>
                                <span>Action</span>
                                <select
                                    className={styles.picker}
                                    value={row.action || ''}
                                    onChange={(e) => updateRow(i, { action: e.target.value })}
                                >
                                    <option value="">Select action</option>
                                    {actionsList.map((a) => (
                                        <option key={a} value={a}>{actionDisplayLabel(a)} ({a})</option>
                                    ))}
                                </select>
                            </label>
                            <label className={styles.pickerLabel} style={{ alignItems: 'stretch' }}>
                                <span>Params (JSON object)</span>
                                <textarea
                                    className={styles.picker}
                                    rows={4}
                                    value={row.paramsJson}
                                    onChange={(e) => updateRow(i, { paramsJson: e.target.value })}
                                    placeholder='{"VERSION":"0", ...}'
                                    spellCheck={false}
                                />
                            </label>
                            <div className={styles.actions} style={{ justifyContent: 'flex-end' }}>
                                <Button type="button" variant="ghost" onClick={() => removeRow(i)} disabled={rows.length <= 1}>
                                    Remove
                                </Button>
                            </div>
                        </fieldset>
                    </li>
                ))}
            </ul>
            <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
                <Button type="button" variant="secondary" onClick={addRow}>+ Add action</Button>
            </div>
            {composeError ? <p role="alert" className={styles.error}>{composeError}</p> : null}
            <div className={styles.actions}>
                <Button type="button" variant="primary" onClick={goReview} disabled={Boolean(composeError)}>Review</Button>
            </div>
        </>,
    );
}
