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
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useContractManifest } from '../hooks/useContractManifest.js';
import { ContractConsentPanel } from '../components/ContractConsentPanel.jsx';
import { preferredSourceId } from '../addressSelection.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * EXECUTE contract method form (§42.4).
 *
 * Manual authoring lane only: method name + pipe-delimited params.
 * The spec's ABI-driven lane ("if a contract publishes an ABI, the
 * wallet populates a method selector and typed parameter inputs") is
 * deferred until the platform defines the ABI publishing convention
 * (FOLLOWUP 2 in claude/reports/specs/2026-04-24_phase4-monaco-editor.md).
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
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.contractActionIndex
 * @param {() => void} props.onBack
 */
export function ExecuteContractForm({ walletId, chainId, contractActionIndex, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [method, setMethod] = useState('');
    const [paramsText, setParamsText] = useState('');
    const [gasLimit, setGasLimit] = useState('');
    const [password, setPassword] = useState('');

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

    const descriptor = chainRegistry.get(chainId);
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
                setFormError(`Parameter "${p}" contains a semicolon, which is not allowed in PARAMS.`);
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
                    actionData: { action: 'EXECUTE', params: actionParams },
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
                    : err?.message || 'Execute failed.',
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
                    ? 'Review execute'
                    : `Execute on contract #${contractActionIndex}`}"
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
                    <ContractConsentPanel
                        manifest={manifest}
                        labelClassName={styles.detailsLabel}
                        valueClassName={styles.detailsValue}
                    />
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

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div className={styles.chainLine}>
                {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                {' '}Contract #{contractActionIndex}
            </div>
            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>Caller</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : null}
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
            <Input
                label="Gas limit"
                hint="Upper bound of VM gas this call may consume. Default 50000."
                inputMode="numeric"
                value={gasLimit}
                onChange={(e) => setGasLimit(e.target.value)}
                autoComplete="off"
            />
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || !method.trim()}
                >
                    Preview
                </Button>
            </div>
        </form>,
    );
}
