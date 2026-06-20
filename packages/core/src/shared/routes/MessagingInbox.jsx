// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    ScreenHeader,
    Button,
    Input,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * §41.7.2 Messaging inbox, scoped to the active account.
 *
 * The inbox sweeps the account's full address union (receive /0/ +
 * dispenser /2/ addresses, all seed-enumerable under one BIP44 account)
 * and merges every address's MESSAGE history into one conversation list.
 * A dispenser owner who received a MESSAGE at a dispenser sub-address
 * sees it here alongside their receive-address mail, without hunting per
 * address. (Change /1/ addresses are internal and never messaged, so they
 * are skipped.)
 *
 * Auth model: password-per-unlock. The inbox is empty until the user
 * confirms and (if locked) enters their password; the background derives
 * the WIF per address and returns decrypted ECIES (method 1) messages.
 * ECDH (2) and AES (3) come back encrypted (session store out of scope).
 *
 * Compose is a separate route (§41.7.3). This view is read-only.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.activeAccountId]   scope the sweep to this account
 * @param {(prefill?: { chainId?: string, fromAddressId?: string, toAddress?: string }) => void} [props.onCompose]
 * @param {() => void} props.onBack
 */
export function MessagingInbox({ walletId, activeAccountId, onCompose, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    // Unlocked session → read without a password (background derives the
    // WIF per address from the pooled signer). Locked → password prompt.
    const signerReady = useSignerReady(walletId);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
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
        messaging.getAddressesByChain(walletId, activeAccountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                if (!byChain || Object.keys(byChain).length === 0) {
                    setLoadError('No addresses yet. Use Receive to generate one before reading messages.');
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId]);

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

    // The account's decryptable, messageable addresses: receive (/0/) +
    // dispenser (/2/) on every chain. Change (/1/) is internal and skipped.
    const sweepAddrs = useMemo(() => {
        if (!addressesByChain) return [];
        /** @type {Array<{ id: string, address: string, chainId: string, role: string }>} */
        const out = [];
        for (const [chainId, addrs] of Object.entries(addressesByChain)) {
            for (const a of (addrs || [])) {
                const decryptable = a.source === 'hd' || a.source === 'imported-wif';
                const role = a.role || 'receive';
                if (decryptable && role !== 'change') {
                    out.push({ id: a.id, address: a.address, chainId, role });
                }
            }
        }
        return out;
    }, [addressesByChain]);

    const ownerSet = useMemo(() => new Set(sweepAddrs.map((a) => a.address)), [sweepAddrs]);
    const addrInfoByAddress = useMemo(() => {
        /** @type {Record<string, { id: string, chainId: string }>} */
        const m = {};
        for (const a of sweepAddrs) m[a.address] = { id: a.id, chainId: a.chainId };
        return m;
    }, [sweepAddrs]);

    // Load the merged inbox. `pw` is null on the unlocked-session path; a
    // string on the password path.
    async function fetchInbox(pw) {
        if (sweepAddrs.length === 0) return;
        setStage('submitting');
        setUnlockError(null);

        // Demo wallet: no on-chain history, fabricate a couple of threads.
        if (flowsLib.isDemoWallet(walletId)) {
            setMessages(flowsLib.synthesizeDemoMessages(sweepAddrs[0]?.address));
            setStage('inbox');
            setPassword('');
            return;
        }

        try {
            const result = await messaging.getMessagingInboxSweep({
                walletId,
                addressIds: sweepAddrs.map((a) => a.id),
                type: 'all',
                ...(pw ? { password: pw } : {}),
            });
            setMessages(Array.isArray(result?.messages) ? result.messages : []);
            setStage('inbox');
            setPassword('');
        } catch (err) {
            const name = err?.name;
            if (name === 'WrongPasswordError' || name === 'InvalidPasswordError') {
                setUnlockError('Incorrect password.');
            } else if (name === 'NoKeyForAddressError') {
                setUnlockError('This account has no decryption key in the wallet.');
            } else {
                setUnlockError(err?.message || 'Failed to load messages.');
            }
            setStage('password');
            setTimeout(() => { passwordRef.current?.focus(); passwordRef.current?.select(); }, 0);
        }
    }

    function handleUnlock(event) {
        event.preventDefault();
        if (stage === 'submitting' || password.length === 0) return;
        fetchInbox(password);
    }

    function handleContinue() {
        if (sweepAddrs.length === 0) return;
        if (signerReady) fetchInbox(null);
        else setStage('password');
    }

    const conversations = useMemo(
        () => buildConversations(messages, ownerSet),
        [messages, ownerSet],
    );
    const thread = useMemo(() => {
        if (!selectedCounterparty) return [];
        return messages
            .filter((m) => counterpartyOf(m, ownerSet) === selectedCounterparty)
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }, [messages, selectedCounterparty, ownerSet]);

    // Reply context: derive the from-address + chain from the owner side of
    // the selected thread's most recent message, so a Reply originates from
    // the account address the conversation actually used.
    const replyContext = useMemo(() => {
        const latest = thread[thread.length - 1];
        if (!latest) return null;
        const ownerAddr = ownerSet.has(latest.from)
            ? latest.from
            : (ownerSet.has(latest.to) ? latest.to : null);
        const info = ownerAddr ? addrInfoByAddress[ownerAddr] : null;
        return info ? { chainId: info.chainId, fromAddressId: info.id } : null;
    }, [thread, ownerSet, addrInfoByAddress]);

    const header = <ScreenHeader onBack={onBack} title="Messaging" titleIcon={<Icon.MessageIcon />} />;

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }

    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (sweepAddrs.length === 0) {
        return wrap(
            <p className={styles.hint}>
                This account has no addresses that can receive messages yet. Use
                Receive to generate one first.
            </p>,
        );
    }

    if (stage === 'pick') {
        return wrap(
            <>
                <p style={{ margin: '0 0 0.5rem' }}>
                    Read messages across this account. The inbox covers all{' '}
                    {sweepAddrs.length} of the account's addresses (receive and
                    dispenser), merged into one conversation list.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={handleContinue}>
                        {signerReady ? 'Open inbox' : 'Continue'}
                    </Button>
                </div>
            </>,
        );
    }

    if (stage === 'password' || stage === 'submitting') {
        return wrap(
            <form onSubmit={handleUnlock} noValidate>
                <p style={{ margin: '0 0 0.5rem' }}>
                    Enter your wallet password to decrypt this account's messages.
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

    return wrap(
        <>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Account inbox</dt>
                <dd className={styles.detailsValue}>
                    {sweepAddrs.length} address{sweepAddrs.length === 1 ? '' : 'es'} swept
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
                        <p className={styles.hint}>No messages for this account yet.</p>
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
                                            {c.lastTimestamp ? formatDate(c.lastTimestamp) : '-'}
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
                                const isOutgoing = ownerSet.has(m.from);
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
                                            {m.timestamp ? formatDate(m.timestamp) : '-'}
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
                            chainId: replyContext?.chainId || undefined,
                            fromAddressId: replyContext?.fromAddressId || undefined,
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
                    Reload
                </Button>
            </div>
        </>,
    );
}

function counterpartyOf(msg, ownerSet) {
    if (!msg || !ownerSet) return null;
    if (msg.from && !ownerSet.has(msg.from)) return msg.from;
    if (msg.to && !ownerSet.has(msg.to)) return msg.to;
    return null;
}

function buildConversations(messages, ownerSet) {
    if (!ownerSet || ownerSet.size === 0) return [];
    /** @type {Map<string, { counterparty: string, count: number, lastTimestamp: number | null }>} */
    const acc = new Map();
    for (const msg of messages) {
        const cp = counterpartyOf(msg, ownerSet);
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
        return '🔒 Encrypted (session key required). Open a session with the sender to read it.';
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
        return '-';
    }
}
