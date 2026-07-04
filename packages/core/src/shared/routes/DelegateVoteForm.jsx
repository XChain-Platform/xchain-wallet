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
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { preferredSourceId } from '../addressSelection.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * VOTE delegation form (v3): set or clear a standing delegation of a token's
 * voting weight to another address (liquid democracy, VOTE.md §13). One
 * component, two modes, mirroring DelegationActionForm's rotate/revoke split.
 *
 *   - `mode: 'delegate'`: hand your TICK voting weight to another holder. Only
 *     flows for polls where you did not vote directly and still hold the token
 *     at close (resolved at tally time); this just records the instruction.
 *   - `mode: 'clear'`: revoke any standing delegation for TICK (blank DELEGATE_TO).
 *
 * @param {object} props
 * @param {'delegate' | 'clear'} props.mode
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} [props.presetTick]
 * @param {() => void} props.onBack
 */
export function DelegateVoteForm({ mode: initialMode = 'delegate', walletId, chainId, presetTick, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    // Delegate and clear share this component; the user can flip between them on
    // the form stage (both are VOTE v3, clear = blank DELEGATE_TO).
    const [mode, setMode] = useState(initialMode === 'clear' ? 'clear' : 'delegate');
    const isClear = mode === 'clear';
    const verb = isClear ? 'Clear vote delegation' : 'Delegate votes';

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));

    const [tick, setTick] = useState(presetTick || '');
    const [delegateTo, setDelegateTo] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
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
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) {
                    setLoadError('No address on this chain. Use Receive to generate one first.');
                    return;
                }
                setFromAddressId(sourceId);
            })
            .catch((err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.'); });
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
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) { setFormError('No source address available.'); return; }
        if (!tick.trim()) { setFormError('Governance token is required.'); return; }
        if (!isClear && !delegateTo.trim()) { setFormError('Delegate-to address is required.'); return; }
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
            const params = isClear
                ? { tick: tick.trim(), ...(memo.trim() && { memo: memo.trim() }) }
                : { tick: tick.trim(), delegateTo: delegateTo.trim(), ...(memo.trim() && { memo: memo.trim() }) };
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
                params,
            };
            let res;
            if (isWatcherMode) {
                // Both modes share the VOTE v3 wire action; clear = blank DELEGATE_TO.
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'VOTE', params: { VERSION: '3', TICK: tick.trim(), DELEGATE_TO: isClear ? '' : delegateTo.trim(), ...(memo.trim() && { MEMO: memo.trim() }) } },
                });
            } else {
                const fn = isClear
                    ? (isHwSource ? messaging.clearVoteDelegationActionHw : messaging.clearVoteDelegationAction)
                    : (isHwSource ? messaging.delegateVoteActionHw : messaging.delegateVoteAction);
                const args = isHwSource ? { ...base, signerId: fromAddress.signerId } : { ...base, password };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : err?.message || (verb + ' failed.'));
            setStage('review');
            if (!isWatcherMode && !isHwSource) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        }
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? `Review ${verb.toLowerCase()}` : verb}
        />
    );
    const wrap = (children) => <Screen variant={variant} header={header}>{children}</Screen>;

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}><Button variant="ghost" onClick={onBack}>Back</Button></div>
            </>,
        );
    }
    if (!addressesByChain) return wrap(<p>Loading addresses…</p>);

    if (stage === 'done' && result) {
        const txid = result?.txid || result?.tx_hash;
        if (result?.psbtHex && !txid) {
            return wrap(<WatcherResultPanel result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />);
        }
        return wrap(
            <>
                <p className={styles.summary}>
                    {isClear
                        ? `Delegation cleared. Your ${tick} voting weight stops flowing once the indexer processes the action.`
                        : `Delegation set. Your ${tick} voting weight flows to the delegate for polls you do not vote on directly.`}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'n/a')}</dd>
                </dl>
                <div className={styles.actions}><Button variant="primary" onClick={onBack}>Done</Button></div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    {isClear
                        ? `Clear any standing delegation of your ${tick} voting weight.`
                        : `Delegate your ${tick} voting weight to ${delegateTo.slice(0, 16)}…`}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}</dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress.address} /></dd>
                    <dt className={styles.detailsLabel}>Token</dt>
                    <dd className={styles.detailsValue}>{tick}</dd>
                    {!isClear ? (
                        <>
                            <dt className={styles.detailsLabel}>Delegate to</dt>
                            <dd className={styles.detailsValue}><AddressText address={delegateTo} /></dd>
                        </>
                    ) : null}
                </dl>
                {isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode: this wallet will build an unsigned transaction. Sign it on
                        your Signer-mode wallet, then broadcast from a Full-mode wallet.
                    </p>
                ) : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
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
                        disabled={isWatcherMode ? false : isHwSource ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        {isWatcherMode ? 'Create unsigned transaction' : isHwSource ? `Sign on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}` : verb}
                    </Button>
                </div>
            </form>,
        );
    }

    return wrap(
        <form onSubmit={handleReview} noValidate>
            <div className={styles.chainLine}>{descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}</div>
            <div className={styles.actions} style={{ gap: '0.5rem' }}>
                <Button type="button" variant={isClear ? 'ghost' : 'primary'} onClick={() => { setMode('delegate'); setFormError(null); }}>Delegate</Button>
                <Button type="button" variant={isClear ? 'primary' : 'ghost'} onClick={() => { setMode('clear'); setFormError(null); }}>Clear</Button>
            </div>
            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>{isClear ? 'Clearing for' : 'Delegating from'}</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : null}

            <Input
                label="Governance token"
                hint="The token whose voting weight this delegation applies to."
                value={tick}
                onChange={(e) => setTick(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
            />

            {!isClear ? (
                <Input
                    label="Delegate to address"
                    hint="The holder who will cast your weight on polls you do not vote on directly."
                    value={delegateTo}
                    onChange={(e) => setDelegateTo(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}

            <Input
                label="Memo (optional)"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />

            {formError ? <div role="alert" className={styles.error}>{formError}</div> : null}
            <div className={styles.actions}>
                <Button type="submit" variant="primary" disabled={!fromAddress || !tick.trim() || (!isClear && !delegateTo.trim())}>
                    Preview
                </Button>
            </div>
        </form>,
    );
}
