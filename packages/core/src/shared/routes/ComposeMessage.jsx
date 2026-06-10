// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
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
import { useSignerReady } from '../hooks/useSignerReady.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * §41.7.3 Compose encrypted message.
 *
 * Flow:
 *   1. User picks a source (chain + address — defaults to the first
 *      HD address on the first available chain, or pre-selected when
 *      opened from the Inbox / a Contact).
 *   2. Recipient address input. On blur / debounce, the wallet looks
 *      up the recipient's on-chain pubkey via
 *      `messaging.getRecipientPubkey`. Three states:
 *        - Found → ECIES encryption available, default path.
 *        - Not found → banner explains why + offers the unencrypted
 *          (v3 plaintext) fallback per the spec's wording.
 *        - Still checking → show a lightweight spinner.
 *   3. Message body.
 *   4. SignCredentials gate. HW signers route through the same gate.
 *   5. On submit, the background flow re-does the pubkey lookup (so
 *      a stale UI state can't bypass a just-indexed pubkey) and
 *      encrypts in-process.
 *
 * Decoder output on broadcast: "Send encrypted message to
 * <recipient> on <chain>."
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.chainId]           pre-selected source chain (from Inbox)
 * @param {string} [props.fromAddressId]     pre-selected source address
 * @param {string} [props.toAddress]         pre-filled recipient (from Inbox / Contact)
 * @param {() => void} props.onBack
 */
export function ComposeMessage({
    walletId,
    chainId: initialChainId,
    fromAddressId: initialFromAddressId,
    toAddress: initialToAddress,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    // Unlocked software session signs without a password.
    const signerReady = useSignerReady(walletId);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (initialFromAddressId || null),
    );
    const [toAddress, setToAddress] = useState(initialToAddress || '');
    const [message, setMessage] = useState('');
    const [password, setPassword] = useState('');
    const [pubkeyState, setPubkeyState] = useState(
        /** @type {'idle' | 'checking' | 'found' | 'missing'} */ ('idle'),
    );
    const [sendUnencrypted, setSendUnencrypted] = useState(false);
    const [stage, setStage] = useState(
        /** @type {'form' | 'submitting' | 'done'} */ ('form'),
    );
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                if (!byChain || Object.keys(byChain).length === 0) {
                    setLoadError('No addresses yet — use Receive to generate one before sending.');
                    return;
                }
                const preferredChain = initialChainId && byChain[initialChainId]
                    ? initialChainId
                    : Object.keys(byChain)[0];
                setChainId((cur) => cur || preferredChain);
                if (!fromAddressId) {
                    const hdAddr = (byChain[preferredChain] || []).find(
                        (a) => a.source === 'hd' || a.source === 'imported-wif',
                    );
                    if (hdAddr) setFromAddressId(hdAddr.id);
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, initialChainId, fromAddressId]);

    useEffect(() => {
        if (!chainId || !toAddress.trim()) {
            setPubkeyState('idle');
            setSendUnencrypted(false);
            return undefined;
        }
        let cancelled = false;
        setPubkeyState('checking');
        const addr = toAddress.trim();
        const handle = setTimeout(() => {
            messaging.getRecipientPubkey({ chainId, address: addr })
                .then((pubkey) => {
                    if (cancelled) return;
                    setPubkeyState(pubkey ? 'found' : 'missing');
                    if (pubkey) setSendUnencrypted(false);
                })
                .catch(() => {
                    if (!cancelled) setPubkeyState('missing');
                });
        }, 400);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [chainId, toAddress, messaging]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !chainId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, fromAddressId, chainId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const hw = isHwSource(fromAddress);
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: hw ? fromAddress?.signerId : null,
    });

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !chainId || !toAddress.trim() || !message.trim()) return;
        if (pubkeyState === 'missing' && !sendUnencrypted) return;
        if (!hw && !signerReady && password.length === 0) return;
        if (hw && hwStatus !== 'available') return;

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
                destination: toAddress.trim(),
                message: message,
                method: pubkeyState === 'missing' && sendUnencrypted ? null : 1,
            };
            const r = hw
                ? await messaging.messageActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.messageAction({ ...base, password });
            setResult(r);
            setStage('done');
        } catch (err) {
            const name = err?.name;
            if (name === 'InvalidPasswordError') {
                setSubmitError('Incorrect password.');
            } else if (name === 'PubkeyNotFoundError') {
                setSubmitError('Recipient pubkey disappeared between lookup and send. Refresh and try again.');
                setPubkeyState('missing');
            } else {
                setSubmitError(err?.message || 'Send failed.');
            }
            setStage('form');
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

        const header = (
        <ScreenHeader
            onBack={onBack}
            title="New message"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{loadError}</div>
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        return wrap(
            <>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Message sent</p>
                {result?.txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>
                        Transaction: <code>{result.txid}</code>
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    const chainIds = Object.keys(addressesByChain || {});

    return wrap(
        <form onSubmit={handleSubmit} noValidate>
            <ChainPicker
                label="From chain"
                value={chainId}
                onChange={(next) => { setChainId(next); setFromAddressId(null); }}
                chainIds={chainIds}
                chainRegistry={chainRegistry}
            />

            <label className={styles.fieldLabel}>
                <span>From address</span>
                <select
                    className={styles.select}
                    value={fromAddressId || ''}
                    onChange={(e) => setFromAddressId(e.target.value)}
                >
                    {(addressesByChain[chainId] || [])
                        .filter((a) => a.source === 'hd' || a.source === 'imported-wif' || a.source === 'trezor' || a.source === 'ledger')
                        .map((a) => (
                            <option key={a.id} value={a.id}>{a.address}</option>
                        ))}
                </select>
            </label>

            <Input
                label="To address"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                placeholder="Recipient address"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
            />

            {pubkeyState === 'checking' ? (
                <p className={styles.hint}>Looking up recipient's public key…</p>
            ) : null}
            {pubkeyState === 'found' ? (
                <p className={styles.hint}>
                    ✓ Recipient pubkey found. Message will be encrypted with ECIES — only they can read it.
                </p>
            ) : null}
            {pubkeyState === 'missing' ? (
                <div
                    role="alert"
                    style={{
                        border: '1px solid #f59e0b',
                        borderRadius: '4px',
                        padding: '0.5rem',
                        marginTop: '0.25rem',
                        fontSize: '0.85rem',
                    }}
                >
                    <p style={{ margin: '0 0 0.5rem' }}>
                        We don't know the recipient's public key yet. They need to have sent a
                        transaction before we can encrypt.
                    </p>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input
                            type="checkbox"
                            checked={sendUnencrypted}
                            onChange={(e) => setSendUnencrypted(e.target.checked)}
                        />
                        Continue anyway with an unencrypted message.
                    </label>
                </div>
            ) : null}

            <label className={styles.fieldLabel} style={{ marginTop: '0.5rem' }}>
                <span>Message</span>
                <textarea
                    className={styles.select}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={isFull ? 6 : 4}
                    placeholder="Write your message…"
                    style={{ minHeight: isFull ? '6rem' : '4rem', resize: 'vertical', fontFamily: 'inherit' }}
                />
            </label>

            {fromAddress && chainId ? (
                <>
                    <dl className={styles.detailsList}>
                        <dt className={styles.detailsLabel}>Chain</dt>
                        <dd className={styles.detailsValue}>
                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                        </dd>
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={fromAddress.address} />
                        </dd>
                    </dl>

                    <SignCredentials
                        fromAddress={fromAddress}
                        chainId={chainId}
                        unlocked={signerReady}
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
                    {hw && submitError ? (
                        <p role="alert" style={{ margin: '0.25rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                            {submitError}
                        </p>
                    ) : null}
                </>
            ) : null}

            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    loading={stage === 'submitting'}
                    disabled={!fromAddress
                        || !toAddress.trim()
                        || !message.trim()
                        || (pubkeyState === 'missing' && !sendUnencrypted)
                        || pubkeyState === 'checking'
                        || (hw ? hwStatus !== 'available' : (!signerReady && password.length === 0))}
                >
                    {hw
                        ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                        : 'Send message'}
                </Button>
            </div>
        </form>,
    );
}
