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
 Icon,} from '@xchain-wallet/core/ui';
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
 * DELEGATE combined form (rotate v0 + revoke v2): §42.7.2 delegation-lane.
 *
 * One component, two modes via the `mode` prop. Both actions share a
 * chassis (address load / SignCredentials / HW branch / review / done)
 * and a 64-hex Ed25519 pubkey input; they diverge only in field name
 * (`NEW_SIGNING_PUBKEY` vs `SIGNING_PUBKEY`), which messaging helper
 * is called, and the verb rendered on the submit button.
 *
 *   - `mode: 'delegate'`: VERSION|NEW_SIGNING_PUBKEY. Points
 *     hub-signing authority at a fresh key without touching the
 *     stake amount. The form asks for a pubkey and explains it
 *     replaces any currently-active delegation.
 *   - `mode: 'revoke'`: VERSION|SIGNING_PUBKEY. Removes a
 *     previously-delegated key. The form pre-loads current
 *     delegations for the source address (via
 *     `messaging.getDelegationsForAddress`) and pre-fills the most
 *     recent pubkey; the user can override to revoke a specific key.
 *
 * @param {object} props
 * @param {'delegate' | 'revoke'} props.mode
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {() => void} props.onBack
 */
export function DelegationActionForm({ mode, walletId, chainId, onBack }) {
    const { messaging, shell } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    const isDelegate = mode === 'delegate';
    const verb = isDelegate ? 'Delegate signing key' : 'Revoke delegation';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [pubkey, setPubkey] = useState('');
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
                // Act from the chain's active address (else newest HD
                // external), matching Send.
                const sourceId = preferredSourceId(byChain?.[chainId] || [], active?.[chainId]);
                if (!sourceId) {
                    setLoadError('No address on this chain. Use Receive to generate one first.');
                    return;
                }
                setFromAddressId(sourceId);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    // Revoke mode: pre-populate the pubkey input with the most recent
    // active delegation for the source address. The user can still
    // override to revoke an older key.
    useEffect(() => {
        if (isDelegate) return;
        if (!fromAddressId || !addressesByChain) return;
        const addr = (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId);
        if (!addr) return;
        let cancelled = false;
        messaging.getDelegationsForAddress({ chainId, address: addr.address })
            .then((resp) => {
                if (cancelled) return;
                const rows = extractRows(resp);
                rows.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
                const latest = rows[0];
                const pk = latest?.signing_pubkey || latest?.SIGNING_PUBKEY;
                if (pk && typeof pk === 'string' && /^[0-9a-fA-F]{64}$/.test(pk)) {
                    setPubkey(pk.toLowerCase());
                }
            })
            .catch(() => { /* user will paste manually */ });
        return () => { cancelled = true; };
    }, [isDelegate, fromAddressId, addressesByChain, chainId, messaging]);

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

    const actionParams = useMemo(() => {
        const pk = pubkey.trim().toLowerCase();
        if (isDelegate) return { VERSION: '0', NEW_SIGNING_PUBKEY: pk };
        return { VERSION: '0', SIGNING_PUBKEY: pk };
    }, [isDelegate, pubkey]);

    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No source address available.');
            return;
        }
        const pk = pubkey.trim();
        if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
            setFormError('Signing pubkey must be exactly 64 hex characters (Ed25519 public key).');
            return;
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
                // Both rotate and revoke share the DELEGATE wire action; revoke is v2
                const wireParams = isDelegate ? actionParams : { VERSION: '2', ...actionParams };
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'DELEGATE', params: wireParams },
                });
            } else {
                const fn = isDelegate
                    ? (isHwSource ? messaging.delegateActionHw : messaging.delegateAction)
                    : (isHwSource ? messaging.revokeDelegationActionHw : messaging.revokeDelegationAction);
                const args = isHwSource
                    ? { ...base, signerId: fromAddress.signerId }
                    : { ...base, password };
                res = await fn(args);
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword ? 'Incorrect password.' : err?.message || (verb + ' failed.'),
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
            title="{stage === 'review' || stage === 'submitting'
                    ? `Review ${verb.toLowerCase()}`
                    : verb}"
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
                    {isDelegate
                        ? 'Delegation broadcast. The new signing key becomes active after the indexer processes the action.'
                        : 'Revocation broadcast. The signing key will stop authorizing hub PBFT votes once the indexer processes the action.'}
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Txid</dt>
                    <dd className={styles.detailsValue}>{String(txid || 'n/a')}</dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const shownPubkey = actionParams.NEW_SIGNING_PUBKEY || actionParams.SIGNING_PUBKEY;
        return wrap(
            <form onSubmit={handleSubmit} noValidate>
                <p className={styles.summary}>
                    {isDelegate
                        ? `Delegate hub-signing authority to ${shownPubkey.slice(0, 12)}…`
                        : `Revoke the delegated signing key ${shownPubkey.slice(0, 12)}…`}
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
                    <dt className={styles.detailsLabel}>
                        {isDelegate ? 'New signing pubkey' : 'Signing pubkey'}
                    </dt>
                    <dd className={styles.detailsValue} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {shownPubkey}
                    </dd>
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
                                : verb}
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
                    <span className={styles.fromLabel}>
                        {isDelegate ? 'Delegating from' : 'Revoking for'}
                    </span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : null}

            <Input
                label={isDelegate ? 'New signing pubkey' : 'Signing pubkey to revoke'}
                hint={isDelegate
                    ? '64-character hex-encoded Ed25519 public key. Replaces any currently-active delegation for this address.'
                    : '64-character hex-encoded Ed25519 public key. Pre-filled with your most recent active delegation; change it to revoke a specific older key.'}
                value={pubkey}
                onChange={(e) => setPubkey(e.target.value)}
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
                    disabled={!fromAddress || !pubkey.trim()}
                >
                    Preview
                </Button>
            </div>
        </form>,
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}
