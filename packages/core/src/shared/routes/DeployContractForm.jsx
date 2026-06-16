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
    ChainPicker,
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

// VM is BTC-only at launch; BITCOIN_ACTIONS carries DEPLOY.
const VM_COIN = 'bitcoin';

/**
 * DEPLOY authoring form — §42.6.
 *
 * Surface:
 *
 *   Name:               [ … ]
 *   Code source:        [ textarea — multi-line JS ]
 *   Gas limit:          [ input, auto-suggested ]
 *   Constructor params: [ pipe-delimited ]
 *
 *   [Validate code]   sdk.contracts.validate
 *   [Estimate size]   sdk.contracts.checkCodeSize
 *   [Suggest gas]     sdk.contracts.suggestGasLimit
 *
 *   [Preview] [Sign]
 *
 * The spec calls for Monaco for JavaScript authoring; Phase 4 Step 4
 * ships a plain textarea as the minimal authoring surface, routes the
 * validate / size / suggest-gas helpers through the SDK, and defers
 * the Monaco editor integration (its bundle weight + CDN trust
 * posture need their own discussion) to a follow-up captured in
 * `claude/reports/specs/2026-04-24_phase4-monaco-editor.md`.
 *
 * Hex-encoding of the source happens inside the SDK validator chain —
 * callers pass raw UTF-8 as `params.CODE`. GAS_LIMIT is a decimal
 * string per the protocol. NAME + CONSTRUCTOR_PARAMS are optional.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function DeployContractForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const btcChainIds = useMemo(
        () => chainRegistry.byCoin(VM_COIN).map((d) => d.id),
        [],
    );

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [gasLimit, setGasLimit] = useState('');
    const [constructorParams, setConstructorParams] = useState('');
    // DEPLOY v1 — optional staking config. Leaving cooldownBlocks blank deploys a
    // non-stakeable contract (DEPLOY v0 behavior). Setting it opts into contract-staking;
    // slashDestination defaults to 'BURN' when cooldown is set but destination is blank.
    const [cooldownBlocks, setCooldownBlocks] = useState('');
    const [slashDestination, setSlashDestination] = useState('');
    const [password, setPassword] = useState('');

    const [validation, setValidation] = useState(
        /** @type {{ ok: boolean, msg: string, warnings?: string[] } | null} */ (null),
    );
    const [sizeInfo, setSizeInfo] = useState(
        /** @type {{ bytes: number, withinLimit: boolean } | null} */ (null),
    );
    const [suggestedGas, setSuggestedGas] = useState(/** @type {number | null} */ (null));

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
                const firstBtc = btcChainIds.find(
                    (cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0,
                );
                if (!firstBtc) {
                    setLoadError(
                        'Contracts are BTC-only at launch. Use Receive on a Bitcoin network to generate an address before deploying.',
                    );
                    return;
                }
                setChainId(firstBtc);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, btcChainIds]);

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
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const btcChainsWithAddresses = useMemo(() => {
        if (!addressesByChain) return [];
        return btcChainIds.filter((cid) => Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0);
    }, [btcChainIds, addressesByChain]);

    const isHwSource = fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const hasCooldown = cooldownBlocks.trim() !== '';
        const p = {
            // Bump to v1 when the user opts into contract-staking metadata; otherwise stay on v0.
            VERSION: hasCooldown ? '1' : '0',
            CODE: code,
            GAS_LIMIT: String(gasLimit || suggestedGas || ''),
        };
        if (name.trim()) p.NAME = name.trim();
        if (constructorParams.trim()) p.CONSTRUCTOR_PARAMS = constructorParams.trim();
        if (hasCooldown) {
            p.COOLDOWN_BLOCKS = cooldownBlocks.trim();
            // Default to BURN if cooldown is set but destination is blank — the indexer
            // applies the same default, but surfacing it here makes review honest.
            p.SLASH_DESTINATION = slashDestination.trim() || 'BURN';
        }
        return p;
    }, [code, gasLimit, suggestedGas, name, constructorParams, cooldownBlocks, slashDestination]);

    async function handleValidate() {
        if (!chainId) return;
        setFormError(null);
        try {
            const res = await messaging.validateContractCode({ chainId, code });
            if (res?.valid) {
                setValidation({ ok: true, msg: 'Syntax OK.', warnings: res.warnings });
            } else {
                setValidation({ ok: false, msg: res?.error || 'Validation failed.' });
            }
        } catch (e) {
            setValidation({ ok: false, msg: e?.message || 'Validation failed.' });
        }
    }

    async function handleCheckSize() {
        if (!chainId) return;
        try {
            const res = await messaging.checkContractCodeSize({ chainId, code });
            setSizeInfo(res);
        } catch (e) {
            setFormError(e?.message || 'Size check failed.');
        }
    }

    async function handleSuggestGas() {
        if (!chainId) return;
        try {
            const suggested = await messaging.suggestContractGasLimit({ chainId, code });
            setSuggestedGas(suggested);
            if (!gasLimit) setGasLimit(String(suggested));
        } catch (e) {
            setFormError(e?.message || 'Gas suggestion failed.');
        }
    }

    function handleReview(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('No Bitcoin address available to deploy from.');
            return;
        }
        if (!code.trim()) {
            setFormError('Contract source is required.');
            return;
        }
        const gas = String(gasLimit).trim() || (suggestedGas ? String(suggestedGas) : '');
        if (!gas || Number.isNaN(Number(gas)) || Number(gas) <= 0) {
            setFormError('Gas limit must be a positive number. Tap "Suggest gas" for a heuristic estimate.');
            return;
        }
        if (validation?.ok === false) {
            setFormError('Fix the syntax error before previewing (see Validate code).');
            return;
        }
        // Staking config validation — only enforced when the user opted in
        if (cooldownBlocks.trim() !== '') {
            const cb = Number(cooldownBlocks.trim());
            if (!Number.isInteger(cb) || cb < 1 || cb > 100000) {
                setFormError('Cooldown blocks must be an integer between 1 and 100000.');
                return;
            }
        } else if (slashDestination.trim() !== '') {
            setFormError('Slash destination requires a cooldown duration (otherwise the contract is not stakeable).');
            return;
        }
        setFormError(null);
        setStage('review');
    }

    // §20 / Cluster W FOLLOWUP 5 — watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

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
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'DEPLOY', params: actionParams },
                });
            } else if (isHwSource) {
                res = await messaging.deployActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.deployAction({ ...base, password });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Deploy failed.',
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
        <ScreenHeader
            onBack={onBack}
            title="{stage === 'review' || stage === 'submitting'
                    ? 'Review deploy'
                    : `Deploy contract${descriptor ? ` on ${descriptor.displayName}` : ''}`}"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
        </Screen>
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
                    Contract deployed. The transaction was broadcast; the indexer will record it shortly.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || '—')}</dd>
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
                    Deploy contract {actionParams.NAME ? `"${actionParams.NAME}"` : ''} to{' '}
                    {descriptor?.displayName || chainId} — gas limit {actionParams.GAS_LIMIT}.
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
                    <dt className={styles.detailsLabel}>Name</dt>
                    <dd className={styles.detailsValue}>{actionParams.NAME || '(unnamed)'}</dd>
                    <dt className={styles.detailsLabel}>Code</dt>
                    <dd className={styles.detailsValue}>
                        {sizeInfo ? `${sizeInfo.bytes} bytes` : `${new Blob([code]).size} bytes`}
                    </dd>
                    <dt className={styles.detailsLabel}>Gas limit</dt>
                    <dd className={styles.detailsValue}>{actionParams.GAS_LIMIT}</dd>
                    {actionParams.CONSTRUCTOR_PARAMS ? (
                        <>
                            <dt className={styles.detailsLabel}>Constructor</dt>
                            <dd className={styles.detailsValue}>{actionParams.CONSTRUCTOR_PARAMS}</dd>
                        </>
                    ) : null}
                    {actionParams.COOLDOWN_BLOCKS ? (
                        <>
                            <dt className={styles.detailsLabel}>Cooldown</dt>
                            <dd className={styles.detailsValue}>{actionParams.COOLDOWN_BLOCKS} blocks</dd>
                            <dt className={styles.detailsLabel}>Slash to</dt>
                            <dd className={styles.detailsValue}>{actionParams.SLASH_DESTINATION}</dd>
                        </>
                    ) : null}
                </dl>
                {validation?.warnings && validation.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {validation.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode — this wallet will build an unsigned transaction.
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
                                : (descriptor ? `Deploy on ${descriptor.displayName}` : 'Deploy')}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            {btcChainsWithAddresses.length > 1 ? (
                <ChainPicker
                    label="Chain"
                    value={chainId}
                    onChange={setChainId}
                    chainIds={btcChainsWithAddresses}
                    chainRegistry={chainRegistry}
                />
            ) : descriptor ? (
                <div className={styles.chainLine}>
                    <ChainBadge descriptor={descriptor} size="sm" />
                </div>
            ) : null}

            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>Fee paid by</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this Bitcoin chain yet. Use Receive to generate one first.
                </div>
            )}

            <Input
                label="Name (optional)"
                hint="Display name for this contract. Appears in My contracts and the detail page."
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
            />

            <label className={styles.pickerLabel}>
                Code source
                <textarea
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value);
                        setValidation(null);
                        setSizeInfo(null);
                    }}
                    rows={isFull ? 20 : 10}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="off"
                    placeholder="// JavaScript contract source…"
                    style={{
                        width: '100%',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                        padding: '0.5rem',
                    }}
                />
            </label>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <Button type="button" variant="ghost" onClick={handleValidate} disabled={!code.trim()}>
                    Validate code
                </Button>
                <Button type="button" variant="ghost" onClick={handleCheckSize} disabled={!code.trim()}>
                    Estimate size
                </Button>
                <Button type="button" variant="ghost" onClick={handleSuggestGas} disabled={!code.trim()}>
                    Suggest gas
                </Button>
            </div>

            {validation ? (
                <p
                    role={validation.ok ? undefined : 'alert'}
                    className={validation.ok ? styles.summary : styles.error}
                >
                    {validation.msg}
                    {validation.warnings && validation.warnings.length > 0 ? (
                        <> — {validation.warnings.length} warning(s)</>
                    ) : null}
                </p>
            ) : null}
            {sizeInfo ? (
                <p
                    role={sizeInfo.withinLimit ? undefined : 'alert'}
                    className={sizeInfo.withinLimit ? styles.summary : styles.error}
                >
                    {sizeInfo.bytes} bytes{sizeInfo.withinLimit ? ' (within 64KB limit)' : ' — exceeds 64KB limit'}
                </p>
            ) : null}
            {suggestedGas !== null ? (
                <p className={styles.summary}>
                    Suggested gas limit: {suggestedGas}
                    {gasLimit !== String(suggestedGas) ? ' — applied' : ''}
                </p>
            ) : null}

            <Input
                label="Gas limit"
                hint="Upper bound of VM gas the deployer and subsequent calls may consume."
                inputMode="numeric"
                value={gasLimit}
                onChange={(e) => setGasLimit(e.target.value)}
                autoComplete="off"
            />

            <Input
                label="Constructor params (optional)"
                hint="Pipe-delimited values passed to the contract's constructor."
                value={constructorParams}
                onChange={(e) => setConstructorParams(e.target.value)}
                autoComplete="off"
            />

            <Input
                label="Cooldown blocks (optional)"
                hint="Set to enable contract-staking. Blocks between an unstake and token release (1–100000). Leave blank for a non-stakeable contract."
                inputMode="numeric"
                value={cooldownBlocks}
                onChange={(e) => setCooldownBlocks(e.target.value)}
                autoComplete="off"
            />

            <Input
                label="Slash destination (optional)"
                hint='Where slashed tokens go. Enter an address or "BURN" to route to the chain burn address. Defaults to BURN when cooldown is set. Locked at deploy — cannot change later.'
                value={slashDestination}
                onChange={(e) => setSlashDestination(e.target.value)}
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
                    disabled={!fromAddress || !code.trim()}
                >
                    Preview
                </Button>
            </div>
        </form>,
    );
}
