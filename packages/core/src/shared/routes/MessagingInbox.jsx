// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    AddressText,
 Icon,} from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { readMsgRead, writeMsgRead, writeMsgUnread } from '../utils/msgReadMemory.js';
import styles from './IssueTokenForm.module.css';
import local from './MessagingInbox.module.css';

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
 * @param {(prefill?: { chainId?: string, fromAddressId?: string, toAddress?: string, message?: string, fixedEncryption?: 'ecies' | 'ecdh' | 'plaintext' }) => void} [props.onCompose]
 *   opens the New-message form; thread replies pass the typed body plus the
 *   conversation's encryption method (shown locked on the form)
 * @param {() => void} props.onBack
 * @param {string} [props.initialCounterparty]  open this conversation thread
 *   directly (e.g. returning from a compose form launched from that thread)
 */
export function MessagingInbox({ walletId, activeAccountId, onCompose, onBack, initialCounterparty }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    // Whether the session can sign without a per-action password. Drives the
    // inline "Share my key" reply to an encrypted-session request: ready means
    // send straight away, otherwise the row asks for the wallet password.
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
        /** @type {string | null} */ (initialCounterparty || null),
    );
    const [contactsByAddress, setContactsByAddress] = useState(
        /** @type {Record<string, string>} */ ({}),
    );
    // Per-conversation read state (counterparty -> seen incoming txids), loaded
    // from localStorage. Drives the unread dot in the list. `unreadFrom` captures
    // the seen-set at the moment a thread is opened, so the thread can still show
    // where the unread run began even after we mark its messages seen.
    const [readMap, setReadMap] = useState(/** @type {Record<string, string[]>} */ ({}));
    const [unreadFrom, setUnreadFrom] = useState(/** @type {Set<string> | null} */ (null));
    const firstUnreadRef = useRef(/** @type {HTMLLIElement | null} */ (null));
    // In-page conversation filters: free-text search (address or contact name)
    // + network dropdown, mirroring the addresses page toolbar.
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');
    // Docked-composer draft. Pressing Enter hands the trimmed text to
    // onCompose, which opens the standard New-message form pre-filled with the
    // recipient + body and the encryption locked to the conversation's method;
    // the user reviews (and can adjust delivery network + fee) there.
    const [draftText, setDraftText] = useState('');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Reset the composer when switching conversations so a half-typed draft
    // never leaks into a different thread.
    useEffect(() => {
        setDraftText('');
    }, [selectedCounterparty]);

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

    // Load this account's read marks once the wallet/account scope is known.
    useEffect(() => {
        setReadMap(readMsgRead(walletId, activeAccountId));
    }, [walletId, activeAccountId]);

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
    // Full address record (incl. publicKey / derivationPath / source) keyed by
    // address, with its owning chainId. Used to build the `from` payload when
    // replying to an encrypted-session request; sweepAddrs only carries the id.
    const recordByAddress = useMemo(() => {
        /** @type {Record<string, any>} */
        const m = {};
        if (!addressesByChain) return m;
        for (const [chainId, addrs] of Object.entries(addressesByChain)) {
            for (const a of (addrs || [])) {
                if (a && a.address && !m[a.address]) m[a.address] = { ...a, chainId };
            }
        }
        return m;
    }, [addressesByChain]);

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

    // Skip the standalone intro screen: open the inbox as soon as the
    // account's messageable addresses are known. A ready session signer
    // fetches immediately; a locked wallet drops straight to the password
    // prompt. We probe signer readiness directly (async) and only then decide,
    // so an already-unlocked session never flashes the password screen while
    // the readiness check is still in flight.
    const autoOpenedRef = useRef(false);
    useEffect(() => {
        if (autoOpenedRef.current) return undefined;
        if (stage !== 'pick') return undefined;
        if (!addressesByChain || sweepAddrs.length === 0) return undefined;
        autoOpenedRef.current = true;
        if (flowsLib.isDemoWallet(walletId)) { fetchInbox(null); return undefined; }
        if (typeof messaging.signerReady !== 'function') { setStage('password'); return undefined; }
        let cancelled = false;
        messaging.signerReady({ walletId })
            .then((r) => {
                if (cancelled) return;
                if (r?.ready) fetchInbox(null);
                else setStage('password');
            })
            .catch(() => { if (!cancelled) setStage('password'); });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stage, addressesByChain, sweepAddrs, walletId, messaging]);

    // MESSAGE format-0/1 rows are ECDH key-exchange handshakes (a published
    // pubkey, no body), not conversation messages: keep them out of the chat
    // list and threads, and surface inbound requests separately.
    const conversableMessages = useMemo(
        () => messages.filter((m) => m.format !== 0 && m.format !== 1),
        [messages],
    );
    // Counterparties who published their key to one of our addresses (inbound
    // format-0). They've shared a pubkey, so we can now message them encrypted;
    // `ownerAddress` records which of our addresses they contacted so a reply
    // (format-1, sharing our key back) originates from that same address.
    const handshakeRequesters = useMemo(() => {
        const seen = new Set();
        const out = [];
        for (const m of messages) {
            if (m.format !== 0 || !ownerSet.has(m.to)) continue;
            const who = m.from;
            if (!who || ownerSet.has(who) || seen.has(who)) continue;
            seen.add(who);
            out.push({ from: who, ownerAddress: m.to });
        }
        return out;
    }, [messages, ownerSet]);
    const conversations = useMemo(
        () => buildConversations(conversableMessages, ownerSet),
        [conversableMessages, ownerSet],
    );
    // Per-counterparty set of seen incoming txids, derived from the persisted
    // read map for fast membership checks.
    const seenByCp = useMemo(() => {
        /** @type {Record<string, Set<string>>} */
        const m = {};
        for (const [cp, txids] of Object.entries(readMap)) m[cp] = new Set(txids);
        return m;
    }, [readMap]);
    // A conversation is unread when it holds an incoming message whose txid the
    // user has not opened past. Computed once here so the list dots, the
    // account-wide badge, and the open handler all agree.
    const unreadByCp = useMemo(() => {
        /** @type {Record<string, boolean>} */
        const m = {};
        for (const c of conversations) {
            const seen = seenByCp[c.counterparty];
            m[c.counterparty] = c.incomingTxids.some((txid) => !(seen && seen.has(txid)));
        }
        return m;
    }, [conversations, seenByCp]);
    // Publish the unread-conversation count for the app-level surfaces (nav
    // badge, Home banner). Gated on a completed sweep so we never clear a real
    // badge with a premature 0 before the inbox has loaded. Uses the same unread
    // map as the list rows, so the badge can't disagree with the dots.
    useEffect(() => {
        if (stage !== 'inbox') return;
        const unread = Object.values(unreadByCp).filter(Boolean).length;
        writeMsgUnread(walletId, activeAccountId, unread);
    }, [unreadByCp, stage, walletId, activeAccountId]);
    // Apply the toolbar's search + network filters. Search matches the
    // counterparty address or its contact name; the network filter keeps a
    // conversation when any of its messages live on the selected coin.
    const visibleConversations = useMemo(() => {
        const q = String(query || '').trim().toLowerCase();
        return conversations.filter((c) => {
            if (network !== 'all' && !c.coins.has(network)) return false;
            if (!q) return true;
            const name = contactsByAddress[c.counterparty] || '';
            return c.counterparty.toLowerCase().includes(q)
                || name.toLowerCase().includes(q);
        });
    }, [conversations, query, network, contactsByAddress]);
    const thread = useMemo(() => {
        if (!selectedCounterparty) return [];
        return conversableMessages
            .filter((m) => counterpartyOf(m, ownerSet) === selectedCounterparty)
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }, [conversableMessages, selectedCounterparty, ownerSet]);

    // Reply context: derive the from-address + chain from the owner side of
    // the selected thread's most recent message, so a reply originates from the
    // account address the conversation actually used.
    const replyContext = useMemo(() => {
        const latest = thread[thread.length - 1];
        if (!latest) return null;
        const ownerAddr = ownerSet.has(latest.from)
            ? latest.from
            : (ownerSet.has(latest.to) ? latest.to : null);
        const info = ownerAddr ? addrInfoByAddress[ownerAddr] : null;
        return info ? { chainId: info.chainId, fromAddressId: info.id, fromAddress: ownerAddr } : null;
    }, [thread, ownerSet, addrInfoByAddress]);

    // Encryption a reply should use, locked onto the compose form: match the
    // most recent ECIES (1) / ECDH (2) message in the thread so an ECDH
    // conversation (where the sender can read their own sent messages) keeps
    // that property. A thread with no encrypted message is a plaintext (v3)
    // conversation; AES (3) has no send surface, so it falls back to ECIES.
    const threadEncryption = useMemo(() => {
        for (let i = thread.length - 1; i >= 0; i -= 1) {
            if (thread[i].method === 2) return 'ecdh';
            if (thread[i].method === 1) return 'ecies';
        }
        return thread.some((m) => m.method === 3) ? 'ecies' : 'plaintext';
    }, [thread]);

    // Interleave iMessage-style day separators: a single centered date header
    // before the first message of each calendar day, repeated only when the day
    // changes. A run of messages on the same day shows the header once.
    const threadItems = useMemo(() => buildThreadItems(thread), [thread]);

    // The first incoming message not in the seen-set captured when the thread
    // was opened: the boundary between already-seen messages and the new run.
    // Drives the "Unread" divider and the open-time scroll target.
    const firstUnreadMsg = useMemo(() => {
        if (unreadFrom == null) return null;
        for (const m of thread) {
            const incoming = Boolean(m.from && !ownerSet.has(m.from));
            if (incoming && m.txid && !unreadFrom.has(m.txid)) return m;
        }
        return null;
    }, [thread, ownerSet, unreadFrom]);

    // When a thread with unread messages opens, scroll so the first unread
    // message sits near the top, with a sliver of the prior (read) message above
    // it for context (the divider's scroll-margin reserves that gap). Re-runs
    // only when the conversation or the unread boundary changes, so a new
    // message arriving mid-read doesn't yank the view.
    useEffect(() => {
        if (firstUnreadRef.current) {
            firstUnreadRef.current.scrollIntoView({ block: 'start' });
        }
    }, [selectedCounterparty, firstUnreadMsg]);

    // Open a conversation: capture the prior seen-set (so the thread can show
    // where unread began), record every currently-shown incoming txid as seen so
    // the list dot clears, and persist. The seen-set is replaced rather than
    // merged, which prunes txids no longer in the inbox and keeps storage bounded
    // to the thread's size. The persist runs inside a functional state update so
    // a rapid second open can't overwrite this one with a stale snapshot.
    function openConversation(c) {
        const cp = c.counterparty;
        const prior = new Set(readMap[cp] || []);
        const hasUnread = c.incomingTxids.some((txid) => !prior.has(txid));
        setUnreadFrom(hasUnread ? prior : null);
        if (hasUnread) {
            setReadMap((prev) => {
                const next = { ...prev, [cp]: c.incomingTxids.slice() };
                writeMsgRead(walletId, activeAccountId, next);
                return next;
            });
        }
        setSelectedCounterparty(cp);
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title="Messaging"
            titleIcon={<Icon.MessageIcon />}
            trailing={onCompose ? (
                <button
                    type="button"
                    className={local.addBtn}
                    onClick={() => onCompose()}
                    aria-label="New conversation"
                    title="New conversation"
                >
                    <Icon.PlusIcon />
                </button>
            ) : undefined}
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

    // The 'pick' stage no longer shows a standalone intro: the auto-open
    // effect above advances it to the inbox (or the password prompt) the
    // moment addresses load, so this is just the brief transitional state.
    if (stage === 'pick') {
        return wrap(<p className={styles.hint}>Opening inbox…</p>);
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

    // Thread view: tapping a conversation opens its full back-and-forth on a
    // dedicated screen. The header's back arrow returns to the list; a composer
    // docked in the footer sends a reply to the same counterparty.
    if (selectedCounterparty) {
        const cpName = contactsByAddress[selectedCounterparty];
        const replyRecord = replyContext ? recordByAddress[replyContext.fromAddress] : null;
        const threadBody = (
            thread.length === 0 ? (
                <p className={styles.hint}>No messages in this conversation.</p>
            ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {threadItems.map((item) => {
                        if (item.type === 'sep') {
                            return (
                                <li key={item.key} className={local.daySeparator}>
                                    {item.label}
                                </li>
                            );
                        }
                        const m = item.m;
                        const isOutgoing = ownerSet.has(m.from);
                        const isFirstUnread = m === firstUnreadMsg;
                        return (
                            <Fragment key={item.key}>
                                {isFirstUnread ? (
                                    <li
                                        ref={firstUnreadRef}
                                        className={local.unreadDivider}
                                    >
                                        <span>Unread messages</span>
                                    </li>
                                ) : null}
                                <li
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: isOutgoing ? 'flex-end' : 'flex-start',
                                        marginBottom: '0.25rem',
                                    }}
                                >
                                    <div
                                        style={{
                                            maxWidth: '75%',
                                            padding: '0.4rem 0.7rem',
                                            borderRadius: '1.1rem',
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word',
                                            background: isOutgoing
                                                ? 'var(--xc-accent-primary)'
                                                : 'var(--xc-bg-muted)',
                                            color: isOutgoing ? '#FFFFFF' : 'var(--xc-text)',
                                        }}
                                    >
                                        {m.text !== null ? m.text : encryptedPlaceholder()}
                                    </div>
                                    {m.timestamp ? (
                                        <span style={{ fontSize: '0.65rem', color: 'var(--xc-text-muted)', margin: '2px 0.3rem 0' }}>
                                            {formatTime(m.timestamp)}
                                            {m.method ? ` · ${methodLabel(m.method)}` : ''}
                                        </span>
                                    ) : null}
                                </li>
                            </Fragment>
                        );
                    })}
                </ul>
            )
        );
        // Submitting hands the reply off to the standard New-message form
        // (via onCompose) pre-filled with this conversation's recipient, the
        // typed body, and the encryption locked to the thread's method. The
        // form is where the user reviews and can adjust delivery network + fee.
        const composer = replyRecord && onCompose ? (
            <ThreadComposer
                value={draftText}
                onChange={setDraftText}
                onSubmit={() => {
                    const t = draftText.trim();
                    if (!t) return;
                    setDraftText('');
                    onCompose({
                        toAddress: selectedCounterparty,
                        message: t,
                        fixedEncryption: threadEncryption,
                        // Lets the host return to this thread (not the list)
                        // when the user backs out of the compose form.
                        threadCounterparty: selectedCounterparty,
                    });
                }}
            />
        ) : null;
        return (
            <Screen
                variant={variant}
                header={(
                    <PageHeader
                        onBack={() => setSelectedCounterparty(null)}
                        title={cpName || <AddressText address={selectedCounterparty} />}
                        titleIcon={<Icon.MessageIcon />}
                    />
                )}
                footer={composer}
            >
                {isFull ? <div className={styles.card}>{threadBody}</div> : threadBody}
            </Screen>
        );
    }

    return wrap(
        <>
            <div className={local.toolbar}>
                <input
                    type="text"
                    className={local.search}
                    placeholder="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Search conversations"
                />
                <NetworkFilterDropdown value={network} onChange={setNetwork} />
            </div>

            {handshakeRequesters.length > 0 ? (
                <div className={local.requestCard} role="region" aria-label="Encrypted-session requests">
                    <p className={local.requestIntro}>
                        🔑 {handshakeRequesters.length} encrypted-session request
                        {handshakeRequesters.length === 1 ? '' : 's'}. Share your key so they can send
                        you encrypted (ECDH) messages, or just start a message.
                    </p>
                    <ul className={local.requestList}>
                        {handshakeRequesters.map((r) => {
                            const record = recordByAddress[r.ownerAddress];
                            if (!record) return null;
                            return (
                                <SessionRequestRow
                                    key={r.from}
                                    request={r}
                                    record={record}
                                    signerReady={signerReady}
                                    messaging={messaging}
                                    walletId={walletId}
                                    contactName={contactsByAddress[r.from]}
                                    onMessage={onCompose ? () => onCompose({
                                        chainId: record.chainId,
                                        fromAddressId: record.id,
                                        toAddress: r.from,
                                    }) : null}
                                />
                            );
                        })}
                    </ul>
                </div>
            ) : null}

            {conversations.length === 0 ? (
                <p className={styles.hint}>No messages for this account yet.</p>
            ) : visibleConversations.length === 0 ? (
                <p className={styles.hint}>No conversations match the current filter.</p>
            ) : (
                <div className={local.convCard}>
                    <ul className={local.convList} aria-label="Conversations">
                        {visibleConversations.map((c) => {
                            const isUnread = Boolean(unreadByCp[c.counterparty]);
                            return (
                                <li key={c.counterparty}>
                                    <button
                                        type="button"
                                        className={local.convItem}
                                        onClick={() => openConversation(c)}
                                    >
                                        <div className={local.convTop}>
                                            <span className={local.convNameWrap}>
                                                {isUnread ? (
                                                    <span
                                                        className={local.unreadDot}
                                                        aria-label="Unread messages"
                                                    />
                                                ) : null}
                                                <span
                                                    className={isUnread
                                                        ? `${local.convName} ${local.convNameUnread}`
                                                        : local.convName}
                                                >
                                                    {contactsByAddress[c.counterparty]
                                                        ? contactsByAddress[c.counterparty]
                                                        : <AddressText address={c.counterparty} truncate={false} />}
                                                </span>
                                            </span>
                                            <span className={local.convTime}>
                                                {c.lastTimestamp ? formatRelative(c.lastTimestamp) : ''}
                                            </span>
                                        </div>
                                        <div className={isUnread
                                            ? `${local.convPreview} ${local.convPreviewUnread}`
                                            : local.convPreview}
                                        >
                                            {previewFor(c.lastText)}
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </>,
    );
}

/**
 * Docked thread composer: a message input plus a send button in the Screen
 * footer, rendered as one continuous bar. Submitting (Enter or the send
 * button) hands the trimmed draft up to the parent, which opens the standard
 * New-message form pre-filled.
 * The input is controlled by the parent so drafts reset per conversation.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(next: string) => void} props.onChange
 * @param {() => void} props.onSubmit
 */
function ThreadComposer({ value, onChange, onSubmit }) {
    function handleSubmit(event) {
        event.preventDefault();
        onSubmit();
    }
    return (
        <form className={local.composer} onSubmit={handleSubmit}>
            <input
                type="text"
                className={local.composerInput}
                placeholder="Message"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoComplete="off"
                aria-label="Message"
            />
            <button type="submit" className={local.composerSend} aria-label="Send message">
                <Icon.SendIcon />
            </button>
        </form>
    );
}

/**
 * One inbound encrypted-session request (an inbound MESSAGE format-0 that
 * published the counterparty's pubkey). "Share my key" broadcasts a format-1
 * response from the owner address that received the request, publishing our
 * pubkey so the counterparty can derive the ECDH shared secret and message us
 * even before our address has spent on-chain (which would otherwise be the only
 * way our key reaches the chain). Owner addresses come from the inbox sweep,
 * which only includes software (HD / imported-WIF) signers, so this reply never
 * needs the hardware-approval gate; a password is asked for only when the
 * session signer isn't already unlocked.
 *
 * @param {object} props
 * @param {{ from: string, ownerAddress: string }} props.request
 * @param {any} props.record                 owner address record (incl. chainId)
 * @param {boolean} props.signerReady
 * @param {any} props.messaging
 * @param {string} props.walletId
 * @param {string} [props.contactName]
 * @param {(() => void) | null} [props.onMessage]
 */
function SessionRequestRow({ request, record, signerReady, messaging, walletId, contactName, onMessage }) {
    const [stage, setStage] = useState(/** @type {'idle' | 'auth' | 'sending' | 'sent'} */ ('idle'));
    const [password, setPassword] = useState('');
    const [error, setError] = useState(/** @type {string | null} */ (null));

    async function share(pw) {
        setStage('sending');
        setError(null);
        try {
            await messaging.sendHandshake({
                walletId,
                chainId: record.chainId,
                from: {
                    address: record.address,
                    publicKey: record.publicKey,
                    derivationPath: record.derivationPath,
                    addressId: record.id,
                    source: record.source,
                    signerId: record.signerId,
                },
                destination: request.from,
                version: 1,
                password: pw,
            });
            setStage('sent');
            setPassword('');
        } catch (err) {
            const name = err?.name;
            if (name === 'WrongPasswordError' || name === 'InvalidPasswordError') {
                setError('Incorrect password.');
            } else {
                setError(err?.message || 'Could not share your key.');
            }
            // Drop back to the form the user came from so they can retry.
            setStage(signerReady ? 'idle' : 'auth');
        }
    }

    function handleShare() {
        if (signerReady) { share(''); return; }
        setStage('auth');
    }

    function handleAuthSubmit(event) {
        event.preventDefault();
        if (password.length === 0) return;
        share(password);
    }

    return (
        <li className={local.requestRow}>
            <div className={local.requestWho}>
                {contactName || <AddressText address={request.from} truncate={false} />}
            </div>
            {stage === 'sent' ? (
                <p className={local.requestSent} role="status">
                    ✓ Key shared. They can now send you encrypted messages.
                </p>
            ) : stage === 'auth' ? (
                <form onSubmit={handleAuthSubmit} className={local.requestAuth} noValidate>
                    <Input
                        type="password"
                        label="Wallet password"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                        autoComplete="current-password"
                        aria-invalid={error ? true : undefined}
                    />
                    <div className={local.requestActions}>
                        <Button type="submit" variant="primary" disabled={password.length === 0}>
                            Share my key
                        </Button>
                    </div>
                </form>
            ) : (
                <div className={local.requestActions}>
                    <Button variant="primary" onClick={handleShare} loading={stage === 'sending'}>
                        Share my key
                    </Button>
                    {onMessage ? (
                        <Button variant="ghost" onClick={onMessage}>Message</Button>
                    ) : null}
                </div>
            )}
            {error ? (
                <p role="alert" className={styles.error} style={{ marginTop: '0.25rem' }}>{error}</p>
            ) : null}
        </li>
    );
}

function counterpartyOf(msg, ownerSet) {
    if (!msg || !ownerSet) return null;
    if (msg.from && !ownerSet.has(msg.from)) return msg.from;
    if (msg.to && !ownerSet.has(msg.to)) return msg.to;
    return null;
}

// Coin family (e.g. 'bitcoin') a message belongs to: derived from the
// sweep-stamped chainId, falling back to the SDK-provided coin/chain fields.
function coinOf(msg) {
    if (msg?.chainId) return coinFromChainId(msg.chainId);
    if (msg?.chain) return coinFromChainId(msg.chain);
    return typeof msg?.coin === 'string' ? msg.coin.toLowerCase() : '';
}

function buildConversations(messages, ownerSet) {
    if (!ownerSet || ownerSet.size === 0) return [];
    /** @type {Map<string, { counterparty: string, count: number, lastTimestamp: number | null, lastIncomingTimestamp: number | null, lastText: string | null, lastMethod: number | null, coins: Set<string>, incomingTxids: Set<string> }>} */
    const acc = new Map();
    for (const msg of messages) {
        const cp = counterpartyOf(msg, ownerSet);
        if (!cp) continue;
        const existing = acc.get(cp);
        const ts = Number.isFinite(Number(msg.timestamp)) ? Number(msg.timestamp) : null;
        // Incoming = sent by the counterparty (our address is the `to`). Only
        // incoming messages can leave a thread unread; our own sent messages
        // never do.
        const incoming = Boolean(msg.from && !ownerSet.has(msg.from));
        // The txid is the read-state identity: opening a thread records every
        // incoming txid as seen, so confirmation/reindex churn can't re-flag it.
        const txid = incoming && typeof msg.txid === 'string' && msg.txid ? msg.txid : null;
        const coin = coinOf(msg);
        if (existing) {
            existing.count += 1;
            if (coin) existing.coins.add(coin);
            if (txid) existing.incomingTxids.add(txid);
            // Track the newest message so the list row can preview it. A null
            // timestamp can't be ordered, so it never displaces a dated one.
            if (ts !== null && (existing.lastTimestamp === null || ts > existing.lastTimestamp)) {
                existing.lastTimestamp = ts;
                existing.lastText = msg.text ?? null;
                existing.lastMethod = msg.method ?? null;
            }
            if (incoming && ts !== null
                && (existing.lastIncomingTimestamp === null || ts > existing.lastIncomingTimestamp)) {
                existing.lastIncomingTimestamp = ts;
            }
        } else {
            acc.set(cp, {
                counterparty: cp,
                count: 1,
                lastTimestamp: ts,
                lastIncomingTimestamp: incoming ? ts : null,
                lastText: msg.text ?? null,
                lastMethod: msg.method ?? null,
                coins: new Set(coin ? [coin] : []),
                incomingTxids: new Set(txid ? [txid] : []),
            });
        }
    }
    return [...acc.values()]
        .map((c) => ({ ...c, incomingTxids: [...c.incomingTxids] }))
        .sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
}

function methodLabel(method) {
    if (method === 1) return 'ECIES';
    if (method === 2) return 'ECDH';
    if (method === 3) return 'AES';
    return `method ${method}`;
}

// Shown in the thread when a message body can't be decrypted. ECIES (1) and
// ECDH (2) decrypt automatically from the wallet's keys, so a remaining locked
// body is an AES (3) pre-shared-key message (no key-entry surface) or one not
// addressed to a key we hold.
function encryptedPlaceholder() {
    return '🔒 Encrypted with a shared key this wallet does not have, so it can\'t be read here.';
}

// Time-of-day label shown under each message bubble. The date itself lives in
// the day separator (iMessage-style), so only the time repeats per message.
function formatTime(unixSeconds) {
    try {
        return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '-';
    }
}

// Local calendar-day key (Y-M-D) used to detect when a thread crosses midnight
// and a new day separator is due.
function dayKey(unixSeconds) {
    const d = new Date(unixSeconds * 1000);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Centered date header shown above the first message of each day: "Today" /
// "Yesterday" for the two most recent days, otherwise an abbreviated date
// (with the year only when it differs from the current year).
function formatDaySeparator(unixSeconds) {
    const d = new Date(unixSeconds * 1000);
    const now = new Date();
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    });
}

// Flatten a (chronological) thread into a render list, inserting a day-separator
// item before the first message of each calendar day. Messages without a usable
// timestamp never trigger a separator and just trail the current day's run.
function buildThreadItems(thread) {
    /** @type {Array<{ type: 'sep', key: string, label: string } | { type: 'msg', key: string, m: any }>} */
    const items = [];
    let lastDay = null;
    for (let i = 0; i < thread.length; i += 1) {
        const m = thread[i];
        const ts = Number(m.timestamp);
        if (Number.isFinite(ts) && ts > 0) {
            const day = dayKey(ts);
            if (day !== lastDay) {
                items.push({ type: 'sep', key: `sep-${day}-${i}`, label: formatDaySeparator(ts) });
                lastDay = day;
            }
        }
        items.push({ type: 'msg', key: m.txid || `row-${i}`, m });
    }
    return items;
}

// Relative "X ago" label for a conversation's last activity, e.g. "a few
// seconds ago" / "1 day ago". Accepts unix seconds or ms. Mirrors the wording
// History uses for its timeline rows.
function formatRelative(ts) {
    if (!ts) return '';
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 45) return 'a few seconds ago';
    const min = Math.floor(diffSec / 60);
    if (min < 1) return 'less than a minute ago';
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(diffSec / 3600);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(diffSec / 86400);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
    const year = Math.floor(day / 365);
    return `${year} year${year === 1 ? '' : 's'} ago`;
}

// One-line preview of a conversation's most recent message for the list row.
// Decrypted text shows verbatim (CSS ellipsis trims it). ECIES + ECDH decrypt
// from the wallet's keys, so a missing body is a shared-key (AES) message or
// one not for us; show a short lock label rather than the long thread notice.
function previewFor(text) {
    if (typeof text === 'string' && text.trim()) return text;
    return '🔒 Encrypted message';
}
