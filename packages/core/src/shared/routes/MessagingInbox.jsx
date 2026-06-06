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
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * §41.7.2 Messaging inbox. Two-pane layout:
 *   Conversations (left) + selected-thread (right)
 *
 * Auth model: password-per-unlock. The inbox is metadata-empty until
 * the user picks an owning address and enters their password; the
 * background handler derives the WIF for that address and returns
 * decrypted ECIES messages (method 1). ECDH (2) and AES (3) come
 * back as encrypted — Phase 3 surfaces them but doesn't try to
 * decrypt them (those need a session store, out of scope).
 *
 * Compose is a separate route (§41.7.3 / Step 13). This view is
 * read-only.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(prefill?: { chainId?: string, fromAddressId?: string, toAddress?: string }) => void} [props.onCompose]
 * @param {() => void} props.onBack
 */
export function MessagingInbox({ walletId, onCompose, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [selectedAddrId, setSelectedAddrId] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [unlockError, setUnlockError] = useState(/** @type {string | null} */ (null));
    const [stage, setStage] = useState(
        /** @type {'pick' | 'password' | 'submitting' | 'inbox'} */ ('pick'),
    );
    const [messages, setMessages] = useState(/** @type {any[]} */ ([]));
    const [selectedCounterparty, setSelectedCounterparty] = useState(
        /** @type {string | null} */ (null),
    );
    const [contactsByAddress, setContactsByAddress] = useState(
        /** @type {Record<string, string>} */ ({}),
    );
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                if (!byChain || Object.keys(byChain).length === 0) {
                    setLoadError('No addresses yet — use Receive to generate one before reading messages.');
                    return;
                }
                const firstChainId = Object.keys(byChain)[0];
                const firstAddr = (byChain[firstChainId] || []).find(
                    (a) => a.source === 'hd' || a.source === 'imported-wif',
                );
                if (firstAddr) setSelectedAddrId(firstAddr.id);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (stage === 'password') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    useEffect(() => {
        if (typeof messaging.listContacts !== 'function') return undefined;
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => {
                if (cancelled) return;
                /** @type {Record<string, string>} */
                const map = {};
                for (const c of rows || []) {
                    for (const e of c.entries || []) {
                        if (e.address && !map[e.address]) map[e.address] = c.name;
                    }
                }
                setContactsByAddress(map);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [messaging]);

    const ownerAddress = useMemo(() => {
        if (!addressesByChain || !selectedAddrId) return null;
        for (const addrs of Object.values(addressesByChain)) {
            const match = addrs.find((a) => a.id === selectedAddrId);
            if (match) return match;
        }
        return null;
    }, [addressesByChain, selectedAddrId]);

    const ownerChainId = useMemo(() => {
        if (!addressesByChain || !selectedAddrId) return null;
        for (const [chainId, addrs] of Object.entries(addressesByChain)) {
            if (addrs.some((a) => a.id === selectedAddrId)) return chainId;
        }
        return null;
    }, [addressesByChain, selectedAddrId]);

    async function handleUnlock(event) {
        event.preventDefault();
        if (stage === 'submitting' || password.length === 0 || !selectedAddrId) return;
        setStage('submitting');
        setUnlockError(null);
        try {
            const result = await messaging.getMessagingInbox({
                walletId,
                password,
                addressId: selectedAddrId,
                type: 'all',
            });
            setMessages(Array.isArray(result?.messages) ? result.messages : []);
            setStage('inbox');
            setPassword('');
        } catch (err) {
            const name = err?.name;
            if (name === 'WrongPasswordError' || name === 'InvalidPasswordError') {
                setUnlockError('Incorrect password.');
            } else if (name === 'NoKeyForAddressError') {
                setUnlockError('This address has no decryption key in the wallet.');
            } else {
                setUnlockError(err?.message || 'Failed to load messages.');
            }
            setStage('password');
            passwordRef.current?.focus();
            passwordRef.current?.select();
        }
    }

    const conversations = useMemo(() => buildConversations(messages, ownerAddress?.address), [messages, ownerAddress]);
    const thread = useMemo(() => {
        if (!selectedCounterparty) return [];
        return messages
            .filter((m) => counterpartyOf(m, ownerAddress?.address) === selectedCounterparty)
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }, [messages, selectedCounterparty, ownerAddress]);

    const header = <ScreenHeader onBack={onBack} title="Messaging" titleIcon={<Icon.MessageIcon />} />;

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

    if (stage === 'pick') {
        return wrap(
            <>
                <p style={{ margin: '0 0 0.5rem' }}>
                    Pick the address whose inbox you want to read. Each
                    address has its own on-chain message history.
                </p>
                <label className={styles.fieldLabel}>
                    <span>Inbox for</span>
                    <select
                        className={styles.select}
                        value={selectedAddrId || ''}
                        onChange={(e) => setSelectedAddrId(e.target.value)}
                    >
                        {Object.entries(addressesByChain).flatMap(([chainId, addrs]) => {
                            const d = chainRegistry.get(chainId);
                            return addrs
                                .filter((a) => a.source === 'hd' || a.source === 'imported-wif')
                                .map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {d?.displayName || chainId} — {a.address}
                                    </option>
                                ));
                        })}
                    </select>
                </label>
                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        onClick={() => setStage('password')}
                        disabled={!selectedAddrId}
                    >
                        Continue
                    </Button>
                </div>
            </>,
        );
    }

    if (stage === 'password' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleUnlock} noValidate>
                <p style={{ margin: '0 0 0.5rem' }}>
                    Enter your wallet password to decrypt messages for{' '}
                    {ownerAddress ? <AddressText address={ownerAddress.address} /> : 'this address'}.
                </p>
                <Input
                    ref={passwordRef}
                    type="password"
                    label="Password"
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        if (unlockError) setUnlockError(null);
                    }}
                    autoComplete="current-password"
                    aria-invalid={unlockError ? true : undefined}
                />
                {unlockError ? (
                    <p role="alert" className={styles.error} style={{ marginTop: '0.25rem' }}>
                        {unlockError}
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={stage === 'submitting'}
                        disabled={password.length === 0}
                    >
                        Unlock inbox
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'inbox'
    const descriptor = ownerChainId ? chainRegistry.get(ownerChainId) : null;

    return wrap(
        <>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Chain</dt>
                <dd className={styles.detailsValue}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : ownerChainId}
                </dd>
                <dt className={styles.detailsLabel}>Address</dt>
                <dd className={styles.detailsValue}>
                    {ownerAddress ? <AddressText address={ownerAddress.address} /> : null}
                </dd>
                <dt className={styles.detailsLabel}>Messages</dt>
                <dd className={styles.detailsValue}>{messages.length}</dd>
            </dl>

            <div
                style={isFull ? {
                    display: 'grid',
                    gridTemplateColumns: '1fr 2fr',
                    gap: '1rem',
                    marginTop: '0.75rem',
                } : {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    marginTop: '0.75rem',
                }}
            >
                <section aria-label="Conversations">
                    <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Conversations</p>
                    {conversations.length === 0 ? (
                        <p className={styles.hint}>No messages on this address yet.</p>
                    ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {conversations.map((c) => (
                                <li key={c.counterparty}>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedCounterparty(c.counterparty)}
                                        aria-pressed={selectedCounterparty === c.counterparty}
                                        style={{
                                            display: 'block',
                                            width: '100%',
                                            textAlign: 'left',
                                            padding: '0.5rem',
                                            marginBottom: '0.25rem',
                                            border: selectedCounterparty === c.counterparty
                                                ? '2px solid var(--xc-accent, #1976d2)'
                                                : '1px solid var(--xc-border)',
                                            borderRadius: '4px',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                            color: 'inherit',
                                        }}
                                    >
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                                            {contactsByAddress[c.counterparty] ? (
                                                <>
                                                    {contactsByAddress[c.counterparty]}{' '}
                                                    <span style={{ color: 'var(--xc-fg-muted)', fontWeight: 400, fontSize: '0.75rem' }}>
                                                        (<AddressText address={c.counterparty} />)
                                                    </span>
                                                </>
                                            ) : (
                                                <AddressText address={c.counterparty} />
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--xc-fg-muted)' }}>
                                            {c.count} message{c.count === 1 ? '' : 's'} ·{' '}
                                            {c.lastTimestamp ? formatDate(c.lastTimestamp) : '—'}
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section aria-label="Thread">
                    <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
                        {selectedCounterparty ? (
                            <>Thread with <AddressText address={selectedCounterparty} /></>
                        ) : 'Thread'}
                    </p>
                    {!selectedCounterparty ? (
                        <p className={styles.hint}>Select a conversation to view the thread.</p>
                    ) : thread.length === 0 ? (
                        <p className={styles.hint}>No messages.</p>
                    ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {thread.map((m, idx) => {
                                const isOutgoing = m.from === ownerAddress?.address;
                                return (
                                    <li
                                        key={m.txid || `row-${idx}`}
                                        style={{
                                            padding: '0.5rem',
                                            marginBottom: '0.25rem',
                                            borderRadius: '4px',
                                            background: isOutgoing
                                                ? 'var(--xc-accent-bg, rgba(25, 118, 210, 0.08))'
                                                : 'var(--xc-bg-muted, rgba(0, 0, 0, 0.04))',
                                            textAlign: isOutgoing ? 'right' : 'left',
                                        }}
                                    >
                                        <div style={{ fontSize: '0.75rem', color: 'var(--xc-fg-muted)', marginBottom: '0.25rem' }}>
                                            {isOutgoing ? 'You' : <AddressText address={m.from || ''} />}
                                            {' · '}
                                            {m.timestamp ? formatDate(m.timestamp) : '—'}
                                            {m.method ? ` · ${methodLabel(m.method)}` : null}
                                        </div>
                                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                            {m.text !== null ? m.text : encryptedPlaceholder(m.method)}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            </div>

            <div className={styles.actions}>
                {onCompose ? (
                    <Button
                        variant="primary"
                        onClick={() => onCompose({
                            chainId: ownerChainId || undefined,
                            fromAddressId: selectedAddrId || undefined,
                            toAddress: selectedCounterparty || undefined,
                        })}
                    >
                        {selectedCounterparty ? 'Reply' : 'New conversation'}
                    </Button>
                ) : null}
                <Button
                    variant="ghost"
                    onClick={() => {
                        setMessages([]);
                        setSelectedCounterparty(null);
                        setStage('pick');
                    }}
                >
                    Switch address
                </Button>
            </div>
        </>,
    );
}

function counterpartyOf(msg, ownerAddress) {
    if (!msg || !ownerAddress) return null;
    if (msg.from && msg.from !== ownerAddress) return msg.from;
    if (msg.to && msg.to !== ownerAddress) return msg.to;
    return null;
}

function buildConversations(messages, ownerAddress) {
    if (!ownerAddress) return [];
    /** @type {Map<string, { counterparty: string, count: number, lastTimestamp: number | null }>} */
    const acc = new Map();
    for (const msg of messages) {
        const cp = counterpartyOf(msg, ownerAddress);
        if (!cp) continue;
        const existing = acc.get(cp);
        const ts = Number.isFinite(Number(msg.timestamp)) ? Number(msg.timestamp) : null;
        if (existing) {
            existing.count += 1;
            if (ts !== null && (existing.lastTimestamp === null || ts > existing.lastTimestamp)) {
                existing.lastTimestamp = ts;
            }
        } else {
            acc.set(cp, { counterparty: cp, count: 1, lastTimestamp: ts });
        }
    }
    return [...acc.values()].sort(
        (a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0),
    );
}

function methodLabel(method) {
    if (method === 1) return 'ECIES';
    if (method === 2) return 'ECDH';
    if (method === 3) return 'AES';
    return `method ${method}`;
}

function encryptedPlaceholder(method) {
    if (method === 2 || method === 3) {
        return '🔒 Encrypted (session key required — open a session with the sender before reading).';
    }
    return '🔒 Encrypted (decryption failed).';
}

function formatDate(unixSeconds) {
    try {
        const d = new Date(unixSeconds * 1000);
        return d.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '—';
    }
}
