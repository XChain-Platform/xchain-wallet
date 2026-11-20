// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { copyText } from '../clipboard.js';
import { AddressText, Button, EmptyState, FormPage, Icon, Input, ListPage, PageHeader, Screen, SectionHeader, Skeleton, StatusMessage, useFormErrors } from '@xchain-wallet/core/ui';
import { flows as flowsLib, registry as registryLib } from '@xchain-wallet/core';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { submitFailureMessage, SIGNED_NOT_BROADCAST_MESSAGE } from '../utils/submitFailureMessage.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { NetworkFilterDropdown } from '../components/NetworkFilterDropdown.jsx';
import { LIST_DETAIL_MIN_WIDTH, ListDetailSplit, listDetailStyles, useWideContent } from '../components/PanelSplit.jsx';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';
import { OverlaySurface } from '../components/OverlaySurface.jsx';
import { useBackHandler } from '../../ui/backStack.js';
import { useFocusTrap } from '../utils/focusTrap.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { RelativeTime } from '../components/RelativeTime.jsx';
// The contact's tile, as View Contact shows it (its saved look included).
import { ContactAvatar } from '../components/WalletIdentity.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import {
    readMsgRead,
    readMsgRequestDeclined,
    writeMsgRead,
    writeMsgRequestDeclined,
    writeMsgUnread,
} from '../utils/msgReadMemory.js';
import { parseMessageContent } from '../utils/messageContent.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { messageTextForDisplay } from '../utils/messageTextSafety.js';
import styles from './IssueTokenForm.module.css';
import dispenserStyles from './DispenserExplorer.module.css';
import local from './MessagingInbox.module.css';
import notificationStyles from './AlertsRoute.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

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
 * @param {(prefill?: { chainId?: string, fromAddressId?: string, toAddress?: string, message?: string, fixedEncryption?: 'ecies' | 'ecdh' | 'plaintext' }) => void} [props.onCompose]
 *   opens the New-message form; thread replies pass the typed body plus the
 *   conversation's encryption method (shown locked on the form)
 * @param {() => void} props.onBack
 * @param {string} [props.initialCounterparty]  open this conversation thread
 *   directly (e.g. returning from a compose form launched from that thread)
 * @param {(target: { address: string, chainId?: string, edit: boolean }) => void} [props.onContact]
 *   the thread menu's "Add to contacts" / "Edit contact": the shell opens
 *   the Contacts route on that address and returns to this thread on Back
 */
export function MessagingInbox({ walletId, activeAccountId, onCompose, onBack, initialCounterparty, onContact }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { offline, recheck } = useNetworkOffline({ walletId });
    const scope = `${walletId}:${activeAccountId || 'default'}`;
    // Track signer readiness so confirmation asks for a password only when needed.
    const signerReady = useSignerReady(walletId);
    const [layoutRef, wideContent] = useWideContent(LIST_DETAIL_MIN_WIDTH, true);
    const twoPanel = wideContent;

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [addressesReload, setAddressesReload] = useState(0);
    const [password, setPassword] = useState('');
    const [unlockError, setUnlockError] = useState(/** @type {string | null} */ (null));
    const passwordErrors = useFormErrors();
    const passwordFieldId = 'messaging-inbox-password';
    const [inboxWarning, setInboxWarning] = useState(/** @type {string | null} */ (null));
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
    // The same lookup with the whole contact, for its avatar (name, seed and
    // the look Edit Contact saved).
    const [contactRecordsByAddress, setContactRecordsByAddress] = useState(
        /** @type {Record<string, any>} */ ({}),
    );
    // Per-conversation read state (counterparty -> seen incoming txids), loaded
    // from localStorage. Drives the unread dot in the list. `unreadFrom` captures
    // the seen-set at the moment a thread is opened, so the thread can still show
    // where the unread run began even after we mark its messages seen.
    const [readMap, setReadMap] = useState(
        /** @type {Record<string, string[]>} */ (() => readMsgRead(walletId, activeAccountId)),
    );
    const readMapRef = useRef(readMap);
    const [declinedRequestIds, setDeclinedRequestIds] = useState(
        /** @type {string[]} */ (() => readMsgRequestDeclined(walletId, activeAccountId)),
    );
    const [unreadFrom, setUnreadFrom] = useState(/** @type {Set<string> | null} */ (null));
    const firstUnreadRef = useRef(/** @type {HTMLLIElement | null} */ (null));
    // In-page conversation filters: free-text search (address or contact name)
    // + network dropdown, mirroring the addresses page toolbar.
    const [query, setQuery] = useState('');
    const [network, setNetwork] = useState('all');
    // Narrow thread pages keep their own keyword filter. Wide two-panel pages
    // use the inbox query for both columns instead.
    const [threadQuery, setThreadQuery] = useState('');
    // Docked-composer draft. Pressing Enter hands the trimmed text to
    // onCompose, which opens the standard New-message form pre-filled with the
    // recipient + body and the encryption locked to the conversation's method;
    // the user reviews (and can adjust delivery network + fee) there.
    const [draftsByCounterparty, setDraftsByCounterparty] = useState(
        /** @type {Record<string, string>} */ ({}),
    );
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const [stateScope, setStateScope] = useState(scope);
    const scopeRef = useRef(scope);
    const inboxRequestRef = useRef(0);
    const autoOpenedRef = useRef(false);

    // A mounted route can move to another account without remounting. Reset all
    // account-owned state and invalidate any sweep still resolving for the old
    // scope before the new address load can open its inbox.
    useEffect(() => {
        if (scopeRef.current === scope) return;
        scopeRef.current = scope;
        inboxRequestRef.current += 1;
        autoOpenedRef.current = false;
        setAddressesByChain(null);
        setLoadError(null);
        setPassword('');
        passwordErrors.reset();
        setUnlockError(null);
        setInboxWarning(null);
        setStage('pick');
        setMessages([]);
        setSelectedCounterparty(initialCounterparty || null);
        setUnreadFrom(null);
        setDraftsByCounterparty({});
        const nextReadMap = readMsgRead(walletId, activeAccountId);
        readMapRef.current = nextReadMap;
        setReadMap(nextReadMap);
        setDeclinedRequestIds(readMsgRequestDeclined(walletId, activeAccountId));
        setStateScope(scope);
    }, [scope, walletId, activeAccountId, initialCounterparty, passwordErrors.reset]);

    // Hosts may retarget the open inbox to another thread while preserving the
    // route instance. Draft selection remains keyed by the recipient below.
    useEffect(() => {
        setSelectedCounterparty(initialCounterparty || null);
        setUnreadFrom(null);
    }, [initialCounterparty]);

    useEffect(() => () => { inboxRequestRef.current += 1; }, []);
    useEffect(() => { setThreadQuery(''); }, [selectedCounterparty]);

    useEffect(() => {
        let cancelled = false;
        setLoadError(null);
        messaging.getAddressesByChain(walletId, activeAccountId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
            })
            .catch((err) => {
                if (!cancelled) {
                    setLoadError(userFacingMessage(
                        err,
                        'Failed to load messaging addresses. Try again.',
                    ));
                }
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, activeAccountId, addressesReload]);

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
                /** @type {Record<string, any>} */
                const records = {};
                for (const c of rows || []) {
                    for (const e of c.entries || []) {
                        if (e.address && !map[e.address]) {
                            map[e.address] = c.name;
                            records[e.address] = c;
                        }
                    }
                }
                setContactsByAddress(map);
                setContactRecordsByAddress(records);
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
        const requestId = ++inboxRequestRef.current;
        setStage('submitting');
        setUnlockError(null);
        setInboxWarning(null);

        try {
            // Demo wallet: no on-chain history, fabricate a couple of threads.
            if (flowsLib.isDemoWallet(walletId)) {
                const demoMessages = flowsLib.synthesizeDemoMessages(sweepAddrs[0]?.address);
                if (requestId !== inboxRequestRef.current) return;
                setMessages(demoMessages);
                setStage('inbox');
                setPassword('');
                return;
            }
            const result = await messaging.getMessagingInboxSweep({
                walletId,
                addressIds: sweepAddrs.map((a) => a.id),
                type: 'all',
                ...(pw ? { password: pw } : {}),
            });
            if (requestId !== inboxRequestRef.current) return;
            setMessages(Array.isArray(result?.messages)
                ? result.messages.filter(isRenderableMessage)
                : []);
            const failedAddresses = Array.isArray(result?.errors) ? result.errors.length : 0;
            setInboxWarning(failedAddresses > 0
                ? `Messages could not be loaded from ${failedAddresses} ${failedAddresses === 1 ? 'address' : 'addresses'} because the network service did not answer. Try again.`
                : null);
            setStage('inbox');
            setPassword('');
        } catch (err) {
            if (requestId !== inboxRequestRef.current) return;
            const name = err?.name;
            if (name === 'WrongPasswordError' || name === 'InvalidPasswordError') {
                setUnlockError('Incorrect password.');
            } else if (name === 'NoKeyForAddressError') {
                setUnlockError('This account has no decryption key in the wallet.');
            } else {
                setUnlockError(submitFailureMessage(err, {
                    verb: 'load messages',
                    fallback: 'Failed to load messages. Check your connection and try again.',
                }));
            }
            setStage('password');
            setTimeout(() => { passwordRef.current?.focus(); passwordRef.current?.select(); }, 0);
        }
    }

    function handleUnlock(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!passwordErrors.validate({
            [passwordFieldId]: password.length > 0 ? null : 'Enter your password.',
        })) return;
        void fetchInbox(password);
    }

    // Skip the standalone intro screen: open the inbox as soon as the
    // account's messageable addresses are known. A ready session signer
    // fetches immediately; a locked wallet drops straight to the password
    // prompt. We probe signer readiness directly (async) and only then decide,
    // so an already-unlocked session never flashes the password screen while
    // the readiness check is still in flight.
    useEffect(() => {
        if (autoOpenedRef.current) return undefined;
        if (stage !== 'pick') return undefined;
        if (!addressesByChain || sweepAddrs.length === 0) return undefined;
        // Offline the inbox read cannot finish; it opens when the connection
        // returns.
        if (offline) return undefined;
        autoOpenedRef.current = true;
        if (flowsLib.isDemoWallet(walletId)) { void fetchInbox(null); return undefined; }
        if (typeof messaging.signerReady !== 'function') { setStage('password'); return undefined; }
        let cancelled = false;
        messaging.signerReady({ walletId })
            .then((r) => {
                if (cancelled) return;
                if (r?.ready) void fetchInbox(null);
                else setStage('password');
            })
            .catch(() => { if (!cancelled) setStage('password'); });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stage, addressesByChain, sweepAddrs, walletId, messaging, offline]);

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
        const declined = new Set(declinedRequestIds);
        const accepted = new Set(messages
            .filter((m) => m.format === 1 && ownerSet.has(m.from) && m.to && !ownerSet.has(m.to))
            .map((m) => m.to));
        const out = [];
        for (const m of messages) {
            if (m.format !== 0 || !ownerSet.has(m.to)) continue;
            const who = m.from;
            if (!who || ownerSet.has(who) || seen.has(who) || accepted.has(who)) continue;
            const id = requestId(m);
            if (declined.has(id)) continue;
            seen.add(who);
            out.push({ id, from: who, ownerAddress: m.to });
        }
        return out;
    }, [messages, ownerSet, declinedRequestIds]);

    function handleRequestDeclined(id) {
        if (stateScope !== scope) return;
        setDeclinedRequestIds((prev) => {
            const next = (prev.includes(id) ? prev : [...prev, id]).slice(-500);
            writeMsgRequestDeclined(walletId, activeAccountId, next);
            return next;
        });
    }

    // "Share my key" runs here rather than in the request row, so its
    // confirmation replaces the whole inbox screen (as every other action's
    // does) instead of rendering a second screen, header and Back included,
    // inside one row of the list. One share runs at a time; each request
    // keeps its own outcome (sending, sent, error, unsigned PSBT).
    const [shareTarget, setShareTarget] = useState(
        /** @type {{ request: { id: string, from: string, ownerAddress: string }, record: any } | null} */ (null),
    );
    const [shareStates, setShareStates] = useState(
        /** @type {Record<string, { stage?: 'idle' | 'sending' | 'sent' | 'queued' | 'queued-seen', error?: string | null, watcherResult?: any, unsaved?: boolean }>} */ ({}),
    );
    const shareLane = useOwnerActionLane({
        messaging,
        walletId,
        chainId: shareTarget?.record?.chainId,
        owner: shareTarget?.record || null,
        software: 'sendHandshake',
        hardware: 'sendHandshakeHw',
    });
    const shareLaneRef = useRef(shareLane);
    shareLaneRef.current = shareLane;
    useEffect(() => {
        if (!shareTarget) return;
        const { request, record } = shareTarget;
        const update = (patch) => setShareStates((prev) => ({
            ...prev,
            [request.id]: { ...(prev[request.id] || {}), ...patch },
        }));
        update({ stage: 'sending', error: null });
        (async () => {
            try {
                const { actionData } = flowsLib.buildHandshakeActionData({
                    chainRegistry,
                    chainId: record.chainId,
                    from: record,
                    destination: request.from,
                    version: 1,
                });
                const result = await shareLaneRef.current.run({
                    actionData,
                    submitExtra: { destination: request.from, version: 1 },
                });
                if (shareLaneRef.current.isWatcherMode) update({ stage: 'idle', watcherResult: result });
                else if (result?.queued) update({ stage: 'queued', unsaved: result.unsaved === true });
                else update({ stage: 'sent' });
            } catch (err) {
                if (isUserRejection(err)) {
                    update({ stage: 'idle' });
                    return;
                }
                const name = err?.name;
                let message;
                if (name === 'WrongPasswordError' || name === 'InvalidPasswordError') {
                    message = 'Incorrect password.';
                } else {
                    const descriptor = chainRegistry.get(record.chainId);
                    message = submitFailureMessage(err, {
                        chainId: record.chainId,
                        coinTicker: tickerForDescriptor(descriptor),
                        verb: 'share your key',
                        fallback: 'Could not share your key. Check your connection and try again.',
                    });
                }
                update({ stage: 'idle', error: message });
            } finally {
                setShareTarget(null);
            }
        })();
    }, [shareTarget]);

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
        if (stage !== 'inbox' || stateScope !== scope) return;
        const unread = Object.values(unreadByCp).filter(Boolean).length;
        writeMsgUnread(walletId, activeAccountId, unread);
    }, [unreadByCp, stage, walletId, activeAccountId, stateScope, scope]);
    // Apply the toolbar's search + network filters. At wide two-panel widths,
    // the one shared query also matches readable message text in every thread.
    // Narrow widths retain the existing contact/address search and network
    // picker exactly as before.
    const visibleConversations = useMemo(() => {
        const q = String(query || '').trim().toLowerCase();
        return conversations.filter((c) => {
            if (!twoPanel && network !== 'all' && !c.coins.has(network)) return false;
            if (!q) return true;
            const name = contactsByAddress[c.counterparty] || '';
            return c.counterparty.toLowerCase().includes(q)
                || name.toLowerCase().includes(q)
                || (twoPanel && conversableMessages.some((message) => (
                    counterpartyOf(message, ownerSet) === c.counterparty
                    && messageMatches(message, q)
                )));
        });
    }, [conversations, query, network, contactsByAddress, twoPanel, conversableMessages, ownerSet]);
    // Wide pages always show a detail. A deep-linked or clicked conversation
    // wins while it still exists; otherwise the first inbox row is selected.
    // Search never swaps the detail under the user, so the fallback comes from
    // the complete conversation list rather than its filtered subset.
    const activeCounterparty = useMemo(() => {
        if (selectedCounterparty
            && conversations.some((c) => c.counterparty === selectedCounterparty)) {
            return selectedCounterparty;
        }
        return twoPanel ? conversations[0]?.counterparty || null : selectedCounterparty;
    }, [selectedCounterparty, conversations, twoPanel]);
    const thread = useMemo(() => {
        if (!activeCounterparty) return [];
        return conversableMessages
            .filter((m) => counterpartyOf(m, ownerSet) === activeCounterparty)
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }, [conversableMessages, activeCounterparty, ownerSet]);

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
    // conversation; AES (3) has no send surface, so it falls back to ECIES, as
    // does an encrypted message whose method the inbox does not recognise.
    const threadEncryption = useMemo(() => {
        for (let i = thread.length - 1; i >= 0; i -= 1) {
            if (thread[i].method === 2) return 'ecdh';
            if (thread[i].method === 1) return 'ecies';
        }
        return thread.some((m) => m.method === 3 || m.encrypted === true) ? 'ecies' : 'plaintext';
    }, [thread]);

    // Interleave iMessage-style day separators: a single centered date header
    // before the first message of each calendar day, repeated only when the day
    // changes. A run of messages on the same day shows the header once.
    // A set keyword narrows the thread to the messages whose readable text
    // holds it; a locked or undecryptable body has no text and never matches.
    const threadNeedle = (twoPanel ? query : threadQuery).trim().toLowerCase();
    const threadIdentityMatches = threadNeedle
        ? activeCounterparty?.toLowerCase().includes(threadNeedle)
            || String(contactsByAddress[activeCounterparty] || '').toLowerCase().includes(threadNeedle)
        : false;
    const shownThread = useMemo(() => {
        if (!threadNeedle || threadIdentityMatches) return thread;
        return thread.filter((m) => messageMatches(m, threadNeedle));
    }, [thread, threadNeedle, threadIdentityMatches]);
    const threadItems = useMemo(() => buildThreadItems(shownThread), [shownThread]);
    // Chain the conversation ran on, for the explorer link and key lookup.
    const threadChainId = useMemo(
        () => thread.find((m) => m.chainId)?.chainId || replyContext?.chainId || null,
        [thread, replyContext],
    );
    const latestThreadMessage = thread[thread.length - 1] || null;
    const lastCopyableMessage = latestThreadMessage?.text === null
        || latestThreadMessage?.text === undefined
        ? null
        : messageTextForDisplay(parseMessageContent(latestThreadMessage.text).text);

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
        if (typeof firstUnreadRef.current?.scrollIntoView === 'function') {
            firstUnreadRef.current.scrollIntoView({ block: 'start' });
        }
    }, [activeCounterparty, firstUnreadMsg]);

    // Open a conversation: capture the prior seen-set (so the thread can show
    // where unread began), record every currently-shown incoming txid as seen so
    // the list dot clears, and persist. The seen-set is replaced rather than
    // merged, which prunes txids no longer in the inbox and keeps storage bounded
    // to the thread's size. The ref advances before React schedules the render,
    // so another open merges from the latest snapshot while storage writes stay
    // outside React's replayable state updater.
    function openConversation(c) {
        if (stateScope !== scope) return;
        const cp = c.counterparty;
        const current = readMapRef.current;
        const prior = new Set(current[cp] || []);
        const hasUnread = c.incomingTxids.some((txid) => !prior.has(txid));
        setUnreadFrom(hasUnread ? prior : null);
        if (hasUnread) {
            const next = { ...current, [cp]: c.incomingTxids.slice() };
            readMapRef.current = next;
            setReadMap(next);
            writeMsgRead(walletId, activeAccountId, next);
        }
        setSelectedCounterparty(cp);
    }

    // The title bar holds, once the inbox list is open, the network filter as
    // a filter icon, then New message as a plus at the far right, as on Bet
    // Markets and every other list page. New message is reachable from every
    // stage, the unlock form included, so the empty states carry text only
    // and the action is never offered twice.
    const headerFor = (withFilter, wideThreadOpen = false) => (
        <PageHeader
            onBack={onBack}
            title="Messaging"
            trailing={onCompose || withFilter ? (
                <span className={local.headerActions}>
                    {wideThreadOpen ? (
                        <ListFilterMenu
                            query={query}
                            onQueryChange={setQuery}
                            label="Filter messaging"
                            searchPlaceholder="Search"
                            searchLabel="Search conversations and messages"
                        >
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                icon={<Icon.XIcon />}
                                aria-label="Clear Search"
                                disabled={!query}
                                onClick={() => setQuery('')}
                            >
                                Clear Search
                            </Button>
                        </ListFilterMenu>
                    ) : withFilter ? (
                        <ListFilterMenu
                            query={query}
                            onQueryChange={setQuery}
                            active={network !== 'all'}
                            label="Filter conversations"
                            searchPlaceholder="Search"
                            searchLabel="Search conversations"
                        >
                            <NetworkFilterDropdown size="md" value={network} onChange={setNetwork} iconOnly={false} />
                        </ListFilterMenu>
                    ) : null}
                    {wideThreadOpen ? (
                        <WideMessagingMenu
                            address={activeCounterparty}
                            chainId={latestThreadMessage?.chainId || replyContext?.chainId || null}
                            txid={latestThreadMessage?.txid || null}
                            copyValue={lastCopyableMessage}
                            hasContact={Object.prototype.hasOwnProperty.call(contactsByAddress, activeCounterparty)}
                            onCompose={onCompose}
                            onContact={onContact}
                        />
                    ) : onCompose ? (
                        <Button
                            type="button"
                            variant="secondary"
                            size="md"
                            icon={<Icon.PlusIcon />}
                            aria-label="New message"
                            title="New message"
                            onClick={() => onCompose()}
                        />
                    ) : null}
                </span>
            ) : null}
        />
    );

    const wrap = (children, { withFilter = false } = {}) => (
        <Screen variant={variant} header={headerFor(withFilter)}>
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(
            <ListPage
                notices={(
                    <StatusMessage
                        variant="error"
                        recovery={{
                            label: 'Try Again',
                            onAction: () => {
                                setLoadError(null);
                                setAddressesByChain(null);
                                setAddressesReload((value) => value + 1);
                            },
                        }}
                    >
                        {loadError}
                    </StatusMessage>
                )}
            />,
        );
    }

    if (!addressesByChain) {
        return wrap(
            <ListPage>
                <div role="status" aria-label="Loading messages">
                    <Skeleton.List rows={5} />
                </div>
            </ListPage>,
        );
    }

    if (sweepAddrs.length === 0) {
        return wrap(
            <ListPage>
                <EmptyState title="No messaging addresses" body="Messaging requires an address that can receive messages." />
            </ListPage>,
        );
    }

    // Offline before the inbox has loaded, the page says so once instead of
    // loading a sweep, or asking for a password to unlock one, that cannot run.
    if (offline && (stage === 'pick' || stage === 'submitting' || stage === 'password')) {
        return wrap(
            <ListPage>
                <OfflineEmptyState body="Your messages load when the connection returns." onRetry={recheck} />
            </ListPage>,
        );
    }

    // The 'pick' stage no longer shows a standalone intro: the auto-open
    // effect above advances it to the inbox (or the password prompt) the
    // moment addresses load, so this is just the brief transitional state.
    if (stage === 'pick') {
        return wrap(
            <ListPage>
                <div role="status" aria-label="Loading messages">
                    <Skeleton.List rows={5} />
                </div>
            </ListPage>,
        );
    }

    if (stage === 'submitting') {
        return wrap(
            <ListPage>
                <div role="status" aria-label="Loading messages">
                    <Skeleton.List rows={5} />
                </div>
            </ListPage>,
        );
    }

    if (stage === 'password') {
        // A message can be composed without unlocking the inbox (a wallet
        // with no ready signer is told why on the compose form), so the
        // title bar's New message plus stays reachable above the unlock form.
        return wrap(
            <ListPage>
                <FormPage
                    label="Unlock messaging inbox"
                    onSubmit={handleUnlock}
                    errors={passwordErrors}
                    status={unlockError ? (
                        <StatusMessage id="messaging-unlock-error" variant="error">
                            {unlockError}
                        </StatusMessage>
                    ) : null}
                    actions={(
                        <Button
                            type="submit"
                            variant="primary"
                            loading={stage === 'submitting'}
                        >
                            Unlock Inbox
                        </Button>
                    )}
                >
                    <Input
                        id={passwordFieldId}
                        ref={passwordRef}
                        type="password"
                        label="Password"
                        help="Decrypts this account's messages."
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (unlockError) setUnlockError(null);
                        }}
                        autoComplete="current-password"
                        aria-invalid={unlockError ? true : undefined}
                        aria-describedby={unlockError ? 'messaging-unlock-error' : undefined}
                    />
                </FormPage>
            </ListPage>,
        );
    }

    // A key share under review takes the whole screen.
    if (shareTarget && shareLane.open) {
        const descriptor = chainRegistry.get(shareTarget.record.chainId);
        return (
            <ActionConfirmScreen
                {...shareLane.confirmProps}
                summary={{
                    verb: t('components.confirmSummary.verbShareKey'),
                    direction: 'none',
                    chainId: shareTarget.record.chainId,
                    address: shareTarget.record.address,
                    ...(shareTarget.request?.from ? { recipient: shareTarget.request.from } : {}),
                }}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || shareTarget.record.chainId}
                signerReady={signerReady}
                hintClassName={styles.hint}
            />
        );
    }

    const inboxList = (
        <ListPage
            notices={inboxWarning ? (
                <StatusMessage variant="warning">{inboxWarning}</StatusMessage>
            ) : null}
        >
            {handshakeRequesters.length > 0 ? (
                <section aria-label="Encrypted-session requests" className={local.requestSection}>
                    <SectionHeader
                        title="Encrypted-session requests"
                        description={`🔑 ${handshakeRequesters.length} encrypted-session request${handshakeRequesters.length === 1 ? '' : 's'}. Share your key so they can send you encrypted (ECDH) messages, or just start a message.`}
                    />
                    <ul className={local.requestList}>
                        {handshakeRequesters.map((r) => {
                            const record = recordByAddress[r.ownerAddress];
                            if (!record) return null;
                            return (
                                <SessionRequestRow
                                    key={r.from}
                                    request={r}
                                    walletId={walletId}
                                    contactName={neutralizeControlText(contactsByAddress[r.from], { maxLength: 255 })}
                                    shareState={shareStates[r.id] || null}
                                    shareBusy={Boolean(shareTarget)}
                                    onShare={() => setShareTarget({ request: r, record })}
                                    onClearWatcherResult={() => setShareStates((prev) => ({
                                        ...prev,
                                        [r.id]: { ...(prev[r.id] || {}), watcherResult: null },
                                    }))}
                                    onQueuedSeen={() => setShareStates((prev) => ({
                                        ...prev,
                                        [r.id]: { ...(prev[r.id] || {}), stage: 'queued-seen' },
                                    }))}
                                    onDecline={() => handleRequestDeclined(r.id)}
                                    onMessage={onCompose ? () => onCompose({
                                        chainId: record.chainId,
                                        fromAddressId: record.id,
                                        toAddress: r.from,
                                    }) : null}
                                />
                            );
                        })}
                    </ul>
                </section>
            ) : null}

            {conversations.length === 0 ? (
                <EmptyState
                    title="No messages yet"
                    body="Messages sent to or from this account's addresses show up here."
                />
            ) : visibleConversations.length === 0 ? (
                <EmptyState title="No matching conversations" body="Try a different search or network filter." />
            ) : (
                <ul
                    className={local.convList}
                    aria-label="Conversations"
                    data-wide={twoPanel ? 'true' : undefined}
                >
                    {visibleConversations.map((c) => {
                        const isUnread = Boolean(unreadByCp[c.counterparty]);
                        const selected = twoPanel && activeCounterparty === c.counterparty;
                        return (
                            <li key={c.counterparty} data-selected={selected ? 'true' : undefined}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    block
                                    icon={null}
                                    className={selected
                                        ? `${local.convItem} ${listDetailStyles.selectedRow}`
                                        : local.convItem}
                                    aria-current={selected ? 'true' : undefined}
                                    onClick={() => openConversation(c)}
                                >
                                    <span className={local.convRow}>
                                      <ConversationAvatar
                                          contact={ownerSet.has(c.counterparty) ? null : contactRecordsByAddress[c.counterparty] || null}
                                          context="list"
                                      />
                                      <span className={local.convBody}>
                                        <span className={local.convTop}>
                                            <span className={local.convNameWrap}>
                                                <span
                                                    className={isUnread
                                                        ? `${local.convName} ${local.convNameUnread}`
                                                        : local.convName}
                                                >
                                                    {ownerSet.has(c.counterparty) ? (
                                                        <Fragment>
                                                            You&nbsp;·&nbsp;
                                                            <AddressText address={displayAddress(c.counterparty)} />
                                                        </Fragment>
                                                    ) : contactsByAddress[c.counterparty]
                                                        ? neutralizeControlText(contactsByAddress[c.counterparty], { maxLength: 255 })
                                                        : <AddressText address={displayAddress(c.counterparty)} />}
                                                </span>
                                            </span>
                                            <span className={local.convTime}>
                                                {c.lastTimestamp ? <RelativeTime timestamp={c.lastTimestamp} /> : ''}
                                                {isUnread ? (
                                                    <span
                                                        className={notificationStyles.unreadDot}
                                                        aria-label="Unread"
                                                    />
                                                ) : null}
                                            </span>
                                        </span>
                                        <span className={local.convPreview}>
                                            {previewFor(c.lastText)}
                                        </span>
                                      </span>
                                      <span className={local.rowChevron} data-row-chevron aria-hidden="true"><Icon.ForwardIcon /></span>
                                    </span>
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </ListPage>
    );

    // Narrow content keeps the dedicated conversation screen. Wide content
    // uses this same thread in the right panel while the inbox stays mounted.
    if (activeCounterparty) {
        // Both endpoints ours: name the thread rather than showing the user
        // their own address as if it were someone else's.
        const cpName = ownerSet.has(activeCounterparty)
            ? 'You'
            : neutralizeControlText(contactsByAddress[activeCounterparty], { maxLength: 255 });
        const cpContact = ownerSet.has(activeCounterparty) ? null : contactRecordsByAddress[activeCounterparty] || null;
        const replyRecord = replyContext ? recordByAddress[replyContext.fromAddress] : null;
        const threadBody = (
            thread.length === 0 ? (
                <EmptyState title="No messages yet" body="Messages in this conversation appear here." />
            ) : shownThread.length === 0 ? (
                <EmptyState title="No messages match" body="Matching messages appear here after you change the search." />
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
                        const content = m.text !== null ? parseMessageContent(m.text) : null;
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
                                    <MessageBubble
                                        copyValue={content ? content.text : null}
                                        style={{
                                            maxWidth: '75%',
                                            borderRadius: '1.1rem',
                                            whiteSpace: 'pre-wrap',
                                            overflowWrap: 'anywhere',
                                            wordBreak: 'break-word',
                                            background: isOutgoing
                                                ? 'var(--xc-accent-primary)'
                                                : 'var(--xc-bg-muted)',
                                            color: isOutgoing ? 'var(--xc-on-accent)' : 'var(--xc-text)',
                                        }}
                                    >
                                        {content ? <MessageContent content={content} highlight={threadNeedle} /> : encryptedPlaceholder(m.method)}
                                    </MessageBubble>
                                    <div className={local.messageMeta}>
                                        {m.timestamp ? (
                                            <span>
                                                <RelativeTime timestamp={m.timestamp} />
                                                {m.method ? ` · ${methodLabel(m.method)}` : ''}
                                            </span>
                                        ) : null}
                                    </div>
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
                value={draftsByCounterparty[activeCounterparty] || ''}
                onChange={(value) => setDraftsByCounterparty((prev) => ({
                    ...prev,
                    [activeCounterparty]: value,
                }))}
                onSubmit={() => {
                    const t = (draftsByCounterparty[activeCounterparty] || '').trim();
                    if (!t) return;
                    setDraftsByCounterparty((prev) => ({
                        ...prev,
                        [activeCounterparty]: '',
                    }));
                    onCompose({
                        toAddress: activeCounterparty,
                        message: t,
                        fixedEncryption: threadEncryption,
                        // Lets the host return to this thread (not the list)
                        // when the user backs out of the compose form.
                        threadCounterparty: activeCounterparty,
                    });
                }}
            />
        ) : null;
        const threadTools = (
            <span className={local.headerActions}>
                <ListFilterMenu
                    query={threadQuery}
                    onQueryChange={setThreadQuery}
                    searchPlaceholder="Search"
                    searchLabel="Search messages"
                    label="Filter messages"
                />
                <ThreadMenu
                    address={activeCounterparty}
                    chainId={threadChainId}
                    hasContact={Object.prototype.hasOwnProperty.call(contactsByAddress, activeCounterparty)}
                    onContact={onContact}
                />
            </span>
        );
        const threadTitle = (
            <span className={local.threadTitle}>
                <ConversationAvatar contact={cpContact} context="header" />
                <span className={local.threadTitleText}>
                    {cpName || <AddressText address={displayAddress(activeCounterparty)} />}
                </span>
            </span>
        );
        if (!twoPanel) return (
            <Screen
                variant={variant}
                header={(
                    <PageHeader
                        nested
                        onBack={() => setSelectedCounterparty(null)}
                        // The counterparty's tile beside the name, as a coin
                        // page puts its icon beside its title (G11).
                        title={threadTitle}
                        trailing={threadTools}
                    />
                )}
                footer={composer}
            >
                <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                    <ListPage>{threadBody}</ListPage>
                </div>
            </Screen>
        );
        return (
            <Screen variant={variant} header={headerFor(true, true)} bodyClassName={listDetailStyles.twoPanelBody}>
                <ListDetailSplit
                    measureRef={layoutRef}
                    storageKey="messaging"
                    resizeLabel="Resize the conversation list"
                    resizeHint="Drag to resize the conversation list, or press Enter to reset."
                    layoutName="two-panel"
                    list={inboxList}
                    listLabel="Conversations"
                    detailLabel={cpName || 'Conversation'}
                    detail={(
                        <div className={local.wideThread}>
                            <ListPage>{threadBody}</ListPage>
                            {composer ? <div className={local.wideComposer}>{composer}</div> : null}
                        </div>
                    )}
                />
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={headerFor(true)}>
            <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                {inboxList}
            </div>
        </Screen>
    );
}

/**
 * The counterparty's tile at the start of a conversation row and in the
 * thread header: a saved contact draws its ContactAvatar (initials, colour,
 * shape or image, as View Contact shows it); an address with no contact
 * draws the wallet's unknown-person mark, the person icon on a muted circle
 * that Dispenser explorer gives a seller with no name.
 *
 * @param {{ contact: any, context: 'list' | 'header' }} props
 */
function ConversationAvatar({ contact, context }) {
    if (contact) return <ContactAvatar contact={contact} context={context} />;
    return (
        <span
            className={context === 'header'
                ? `${local.unknownAvatar} ${dispenserStyles.sellerAvatar} ${local.unknownAvatarHeader}`
                : `${local.unknownAvatar} ${dispenserStyles.sellerAvatar}`}
            data-unknown-avatar=""
            aria-hidden="true"
        >
            <Icon.UserIcon />
        </span>
    );
}

/**
 * Message text keeps line breaks and turns only HTTP(S) URLs into links.
 * Messages have no attachments; a legacy envelope is already stripped.
 *
 * @param {{ content: { text: string } }} props
 */
function MessageContent({ content, highlight = '' }) {
    const displayText = messageTextForDisplay(content.text);
    const parts = displayText.split(/(https?:\/\/[^\s<>"']+)/gi);
    return (
        <>
            {displayText ? (
                <span>
                    {parts.map((part, index) => /^https?:\/\//i.test(part) ? (
                        <a
                            key={`${index}-${part}`}
                            href={part}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={local.messageLink}
                        >
                            {highlightMatches(part, highlight)} <span aria-hidden="true">↗</span>
                        </a>
                    ) : <Fragment key={`${index}-${part}`}>{highlightMatches(part, highlight)}</Fragment>)}
                </span>
            ) : null}
        </>
    );
}

/**
 * A small popup menu of copy actions. Closes on outside press, Escape, or
 * after an item is chosen; the item reads "Copied" for a moment first.
 *
 * @param {object} props
 * @param {string} props.label                     accessible name of the menu
 * @param {Array<{ key: string, label: string, icon?: import('react').ReactNode, value?: string, href?: string, onSelect?: () => void, disabled?: boolean }>} props.items
 *   a copy item (`value`), an external link (`href`) or an action (`onSelect`);
 *   labels are Title Case and every button row carries its icon (G50)
 * @param {() => void} props.onClose
 * @param {string} [props.className]
 */
function CopyMenu({ label, items, onClose, className }) {
    const ref = useRef(null);
    const [copiedKey, setCopiedKey] = useState(null);
    useEffect(() => {
        const onDown = (event) => {
            if (!ref.current?.contains(event.target)) onClose();
        };
        const onKey = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('touchstart', onDown);
        window.addEventListener('keydown', onKey);
        ref.current?.querySelector('[role="menuitem"]')?.focus();
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('touchstart', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [onClose]);
    async function choose(item) {
        const { ok } = await copyText(item.value);
        setCopiedKey(ok ? item.key : null);
        setTimeout(onClose, ok ? 700 : 0);
    }
    return (
        <div ref={ref} className={`${local.copyMenu} ${className || ''}`.trim()} role="menu" aria-label={label}>
            {items.map((item) => (item.href ? (
                <a
                    key={item.key}
                    role="menuitem"
                    className={local.copyMenuItem}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onClose}
                >
                    {/* The external-link cue: this row opens a new tab. */}
                    <span className={local.copyMenuLinkIcon} aria-hidden="true"><Icon.ExternalLinkIcon /></span>
                    <span>{item.label}</span>
                </a>
            ) : (
                <Button
                    key={item.key}
                    type="button"
                    variant="rowAction"
                    size="sm"
                    icon={item.icon}
                    role="menuitem"
                    className={local.copyMenuItem}
                    disabled={item.disabled}
                    onClick={item.onSelect
                        ? () => { onClose(); item.onSelect(); }
                        : () => choose(item)}
                >
                    {copiedKey === item.key ? 'Copied' : item.label}
                </Button>
            )))}
        </div>
    );
}

/**
 * @param {object} props
 * @param {string} props.address
 * @param {string | null} props.chainId
 * @param {string | null} props.txid
 * @param {string | null} props.copyValue
 * @param {boolean} props.hasContact
 * @param {(() => void)} [props.onCompose]
 * @param {(target: { address: string, chainId?: string, edit: boolean }) => void} [props.onContact]
 */
function WideMessagingMenu({ address, chainId, txid, copyValue, hasContact, onCompose, onContact }) {
    const { messaging } = useMessaging();
    const [open, setOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [settings, setSettings] = useState(/** @type {any} */ (null));
    useEffect(() => {
        if (typeof messaging.getSettings !== 'function') return undefined;
        let cancelled = false;
        Promise.resolve(messaging.getSettings())
            .then((value) => { if (!cancelled) setSettings(value || null); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [messaging]);
    const explorerHref = chainId && txid
        ? explorerPageUrl({ chainId, kind: 'transaction', value: txid, settings })
        : null;
    const closeMenu = useCallback(() => setOpen(false), []);
    return (
        <span className={local.threadMenuWrap}>
            <Button
                type="button"
                variant="secondary"
                size="md"
                icon={<Icon.MoreIcon />}
                aria-label="More"
                aria-haspopup="menu"
                aria-expanded={open ? 'true' : 'false'}
                title="More"
                data-header-control
                onClick={() => setOpen((value) => !value)}
            >
                {null}
            </Button>
            {open ? (
                <CopyMenu
                    label="Messaging actions"
                    className={local.threadMenuPanel}
                    items={[
                        {
                            key: 'new-message',
                            label: 'New Message',
                            icon: <Icon.MessageIcon />,
                            disabled: !onCompose,
                            onSelect: () => onCompose?.(),
                        },
                        {
                            key: 'new-contact',
                            label: 'New Contact',
                            icon: <Icon.UserIcon />,
                            disabled: !onContact,
                            onSelect: () => onContact?.({ address: '', edit: false }),
                        },
                        {
                            key: 'edit-contact',
                            label: 'Edit Contact',
                            icon: <Icon.PencilIcon />,
                            disabled: !hasContact || !onContact,
                            onSelect: () => onContact?.({ address, chainId: chainId || undefined, edit: true }),
                        },
                        {
                            key: 'copy-message',
                            label: 'Copy Message',
                            icon: <Icon.CopyIcon />,
                            value: copyValue || undefined,
                            disabled: copyValue == null,
                        },
                        explorerHref
                            ? { key: 'explorer', label: 'View in Explorer', href: explorerHref }
                            : { key: 'explorer', label: 'View in Explorer', icon: <Icon.ExternalLinkIcon />, disabled: true, onSelect: () => {} },
                        {
                            key: 'encryption',
                            label: 'Encryption Details',
                            icon: <Icon.LockIcon />,
                            onSelect: () => setSheetOpen(true),
                        },
                    ]}
                    onClose={closeMenu}
                />
            ) : null}
            {sheetOpen ? (
                <EncryptionSheet
                    address={address}
                    chainId={chainId}
                    onClose={() => setSheetOpen(false)}
                />
            ) : null}
        </span>
    );
}

/**
 * Header overflow menu of the open thread: page-level actions live here
 * rather than as loose buttons in the page. Exactly four items, in order:
 * add or edit the contact, copy the address, view it in the explorer, and
 * the encryption details sheet.
 *
 * @param {object} props
 * @param {string} props.address     the counterparty address
 * @param {string | null} [props.chainId]
 * @param {boolean} props.hasContact  the address is already a contact
 * @param {(target: { address: string, chainId?: string, edit: boolean }) => void} [props.onContact]
 */
function ThreadMenu({ address, chainId, hasContact, onContact }) {
    const { messaging } = useMessaging();
    const [open, setOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [settings, setSettings] = useState(/** @type {any} */ (null));
    // The explorer base can be overridden in Settings; read it once, and a
    // shell without settings falls back to the chain's default explorer.
    useEffect(() => {
        if (typeof messaging.getSettings !== 'function') return undefined;
        let cancelled = false;
        Promise.resolve(messaging.getSettings())
            .then((s) => { if (!cancelled) setSettings(s || null); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [messaging]);
    const explorerHref = chainId
        ? explorerPageUrl({ chainId, kind: 'address', value: address, settings })
        : null;
    const closeMenu = useCallback(() => setOpen(false), []);
    return (
        <span className={local.threadMenuWrap}>
            <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Icon.MoreIcon />}
                aria-label="Conversation menu"
                aria-haspopup="menu"
                aria-expanded={open ? 'true' : 'false'}
                title="More"
                data-header-control
                onClick={() => setOpen((v) => !v)}
            >
                {null}
            </Button>
            {open ? (
                <CopyMenu
                    label="Conversation actions"
                    className={local.threadMenuPanel}
                    items={[
                        {
                            key: 'contact',
                            label: hasContact ? 'Edit Contact' : 'Add to Contacts',
                            icon: hasContact ? <Icon.PencilIcon /> : <Icon.UserIcon />,
                            disabled: !onContact,
                            onSelect: () => onContact?.({ address, chainId: chainId || undefined, edit: hasContact }),
                        },
                        { key: 'address', label: 'Copy Address', icon: <Icon.CopyIcon />, value: address },
                        explorerHref
                            ? { key: 'explorer', label: 'View in Explorer', href: explorerHref }
                            : { key: 'explorer', label: 'View in Explorer', icon: <Icon.ExternalLinkIcon />, disabled: true, onSelect: () => {} },
                        { key: 'encryption', label: 'Encryption Details', icon: <Icon.LockIcon />, onSelect: () => setSheetOpen(true) },
                    ]}
                    onClose={closeMenu}
                />
            ) : null}
            {sheetOpen ? (
                <EncryptionSheet
                    address={address}
                    chainId={chainId}
                    onClose={() => setSheetOpen(false)}
                />
            ) : null}
        </span>
    );
}

/**
 * Encryption details of one conversation: end-to-end encrypted (ECIES) with
 * the counterparty's public key cut in the middle and a Copy button, or
 * "Not encrypted" when no key is known for the address.
 *
 * @param {{ address: string, chainId?: string | null, onClose: () => void }} props
 */
function EncryptionSheet({ address, chainId, onClose }) {
    const { messaging } = useMessaging();
    const rootRef = useRef(null);
    const panelRef = useRef(null);
    const titleId = useId();
    const [pubkey, setPubkey] = useState(/** @type {string | null} */ (null));
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    useFocusTrap(panelRef, { active: true });
    useBackHandler(onClose);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    useEffect(() => {
        if (!chainId || typeof messaging.getRecipientPubkey !== 'function') {
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        Promise.resolve(messaging.getRecipientPubkey({ chainId, address }))
            .then((key) => {
                if (cancelled) return;
                const value = typeof key === 'string' ? key : (key?.publicKey || key?.pubkey || null);
                setPubkey(value || null);
            })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [messaging, chainId, address]);
    async function handleCopy() {
        const { ok } = await copyText(pubkey);
        setCopied(Boolean(ok));
    }
    return (
        <OverlaySurface
            variant="sheet"
            rootRef={rootRef}
            surfaceRef={panelRef}
            title="Encryption details"
            titleId={titleId}
            titleAs="p"
            aria-labelledby={titleId}
            onBackdrop={onClose}
            tabIndex={-1}
            footer={(
                <Button variant="primary" block onClick={onClose}>Close</Button>
            )}
        >
            {loading ? (
                <p role="status">Checking encryption</p>
            ) : pubkey ? (
                <div className={local.encryptionBody}>
                    <p>End-to-end encrypted (ECIES)</p>
                    <p className={local.encryptionLabel}>Counterparty public key</p>
                    <p className={local.encryptionKey} title={pubkey}>{cutMiddle(pubkey)}</p>
                    <Button variant="secondary" size="sm" icon={<Icon.CopyIcon />} onClick={handleCopy}>
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                </div>
            ) : (
                <div className={local.encryptionBody}>
                    <p>Not encrypted</p>
                    <p className={local.encryptionLabel}>No public key is known for this address yet.</p>
                </div>
            )}
        </OverlaySurface>
    );
}

// A long key as its first and last characters with an ellipsis between.
function cutMiddle(value, head = 12, tail = 10) {
    const s = String(value);
    return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

// Whether a message's readable text holds the (lowercased) keyword. A body that
// could not be decrypted has no text and never matches.
function messageMatches(message, needle) {
    if (message.text === null || message.text === undefined) return false;
    const content = parseMessageContent(message.text);
    return messageTextForDisplay(content.text).toLowerCase().includes(needle);
}

// Wrap each case-insensitive occurrence of the keyword in a <mark>.
function highlightMatches(text, needle) {
    if (!needle) return text;
    const lower = text.toLowerCase();
    const out = [];
    let from = 0;
    let at = lower.indexOf(needle, from);
    while (at !== -1) {
        if (at > from) out.push(text.slice(from, at));
        out.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
        from = at + needle.length;
        at = lower.indexOf(needle, from);
    }
    if (from < text.length) out.push(text.slice(from));
    return out;
}

/**
 * One message bubble. Copy is a right-click, long-press or keyboard (Shift+F10
 * or the Menu key) action that opens a "Copy message" menu; no button is
 * drawn on the bubble.
 *
 * @param {object} props
 * @param {string | null} props.copyValue  text to copy, or null when the body is not readable
 * @param {object} props.style
 * @param {import('react').ReactNode} props.children
 */
function MessageBubble({ copyValue, style, children }) {
    const [open, setOpen] = useState(false);
    const pressRef = useRef(null);
    const canCopy = copyValue != null;
    const cancelPress = () => {
        if (pressRef.current) clearTimeout(pressRef.current);
        pressRef.current = null;
    };
    useEffect(() => cancelPress, []);
    return (
        <div className={local.bubbleWrap}>
            <div
                className={local.messageBubble}
                style={{ ...style, maxWidth: '100%' }}
                onContextMenu={canCopy ? (event) => {
                    event.preventDefault();
                    setOpen(true);
                } : undefined}
                onKeyDown={canCopy ? (event) => {
                    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                        event.preventDefault();
                        setOpen(true);
                    }
                } : undefined}
                onPointerDown={canCopy ? (event) => {
                    if (event.pointerType === 'mouse') return;
                    cancelPress();
                    pressRef.current = setTimeout(() => setOpen(true), 500);
                } : undefined}
                onPointerUp={cancelPress}
                onPointerCancel={cancelPress}
                onPointerMove={cancelPress}
            >
                {children}
            </div>
            {open && canCopy ? (
                <CopyMenu
                    label="Message actions"
                    items={[{ key: 'message', label: 'Copy Message', icon: <Icon.CopyIcon />, value: copyValue }]}
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </div>
    );
}

/**
 * Docked thread composer: a full-width message input in the Screen footer
 * with no send button (operator ruling 2026-11-13). Submitting the form with
 * Enter (phone keyboards show a Send key via enterKeyHint) hands the trimmed
 * draft up to the parent, which opens the standard New-message form
 * pre-filled.
 * The input is controlled by the parent so drafts reset per conversation.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(next: string) => void} props.onChange
 * @param {() => void} props.onSubmit
 */
function ThreadComposer({ value, onChange, onSubmit }) {
    const [attempted, setAttempted] = useState(false);
    const emptyError = attempted && !value.trim() ? 'Write a message before continuing.' : undefined;

    function handleSubmit(event) {
        event.preventDefault();
        if (!value.trim()) {
            setAttempted(true);
            return;
        }
        setAttempted(false);
        onSubmit();
    }
    return (
        <form className={local.composer} onSubmit={handleSubmit}>
            <Input
                type="text"
                enterKeyHint="send"
                className={local.composerInput}
                placeholder="Message"
                value={value}
                onChange={(e) => {
                    setAttempted(false);
                    onChange(e.target.value);
                }}
                autoComplete="off"
                aria-label="Reply, press Enter to send"
                error={emptyError}
            />
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
 * The share itself runs in MessagingInbox (its confirmation takes the whole
 * screen); this row shows the request and that share's outcome.
 *
 * @param {object} props
 * @param {{ id: string, from: string, ownerAddress: string }} props.request
 * @param {string} props.walletId
 * @param {string} [props.contactName]
 * @param {{ stage?: 'idle' | 'sending' | 'sent' | 'queued' | 'queued-seen', error?: string | null, watcherResult?: any, unsaved?: boolean } | null} props.shareState
 * @param {boolean} props.shareBusy            a share (this one or another) is running
 * @param {() => void} props.onShare
 * @param {() => void} props.onClearWatcherResult
 * @param {() => void} props.onDecline
 * @param {(() => void) | null} [props.onMessage]
 */
function SessionRequestRow({
    request,
    walletId,
    contactName,
    shareState,
    shareBusy,
    onShare,
    onClearWatcherResult,
    onQueuedSeen,
    onDecline,
    onMessage,
}) {
    const demoGuard = useDemoGuard(walletId);
    const stage = shareState?.stage || 'idle';
    const error = shareState?.error || null;
    const watcherResult = shareState?.watcherResult || null;

    if (watcherResult) {
        return (
            <li className={local.requestRow}>
                <ResultScreen
                    state="unsigned"
                    result={watcherResult}
                    onBuildAnother={onClearWatcherResult}
                    onDone={onClearWatcherResult}
                />
            </li>
        );
    }

    // Signed but held in the broadcast queue: the key has not gone out, and the
    // share button stays gone so a second press cannot sign a duplicate.
    if (stage === 'queued') {
        return (
            <li className={local.requestRow}>
                <ResultScreen state="signed-not-broadcast" onDone={onQueuedSeen} what="key share" unsaved={shareState?.unsaved} />
            </li>
        );
    }

    return (
        <li className={local.requestRow}>
            <div className={local.requestWho}>
                {contactName || <AddressText address={displayAddress(request.from)} truncate={false} />}
            </div>
            {stage === 'queued-seen' ? (
                <StatusMessage variant="warning">{SIGNED_NOT_BROADCAST_MESSAGE}</StatusMessage>
            ) : stage === 'sent' ? (
                <StatusMessage variant="success">
                    Key shared. They can now send you encrypted messages.
                </StatusMessage>
            ) : (
                <div className={local.requestActions}>
                    <Button variant="secondary" icon={<Icon.XIcon />} onClick={onDecline} disabled={stage === 'sending'}>
                        Decline
                    </Button>
                    {onMessage ? (
                        <Button variant="secondary" onClick={onMessage} disabled={stage === 'sending'}>
                            Message
                        </Button>
                    ) : null}
                    {/* A demo wallet never signs; the press answers with the refusal. */}
                    <Button variant="success" icon={<Icon.KeyIcon />} onClick={demoGuard.blocked ? demoGuard.refuse : onShare} loading={stage === 'sending'} disabled={shareBusy}>
                        Share My Key
                    </Button>
                </div>
            )}
            {demoGuard.note}
            {demoGuard.dialog}
            <StatusMessage variant="error">{error}</StatusMessage>
        </li>
    );
}

function requestId(message) {
    if (typeof message?.txid === 'string' && message.txid) return message.txid;
    return [message?.chainId || message?.chain || '', message?.from || '', message?.to || '', message?.timestamp || ''].join(':');
}

function displayAddress(value) {
    return neutralizeControlText(value, { maxLength: 255 });
}

function isRenderableMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    if (typeof message.from !== 'string' || !message.from) return false;
    if (typeof message.to !== 'string' || !message.to) return false;
    if (message.text !== null && message.text !== undefined && typeof message.text !== 'string') return false;
    if (message.txid !== null && message.txid !== undefined && typeof message.txid !== 'string') return false;
    try {
        if (message.timestamp !== null && message.timestamp !== undefined
            && !Number.isFinite(Number(message.timestamp))) return false;
    } catch {
        return false;
    }
    return true;
}

// The conversation key for a message: whichever endpoint is not ours.
// A message between two of the account's OWN addresses has no such endpoint;
// it is keyed on the receiving address so it still reaches a thread. Returning
// null there (the old behaviour) dropped it from every bucket, so a message
// that confirmed on-chain and came back from the sweep still rendered the
// empty inbox, with no error and nothing in the console to explain it.
function counterpartyOf(msg, ownerSet) {
    if (!msg || !ownerSet) return null;
    if (msg.from && !ownerSet.has(msg.from)) return msg.from;
    if (msg.to && !ownerSet.has(msg.to)) return msg.to;
    if (msg.from && msg.to) return msg.to;
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
function encryptedPlaceholder(method) {
    if (method === 3) {
        return '🔒 Encrypted with a shared key this wallet does not have, so it can\'t be read here.';
    }
    if (method === 1 || method === 2) {
        return '🔒 This encrypted message could not be decrypted. It may be damaged or addressed to another key.';
    }
    return '🔒 This encrypted message cannot be read here.';
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

// One-line preview of a conversation's most recent message for the list row.
// Decrypted text shows verbatim (CSS ellipsis trims it). ECIES + ECDH decrypt
// from the wallet's keys, so a missing body is a shared-key (AES) message or
// one not for us; show a short lock label rather than the long thread notice.
function previewFor(text) {
    if (typeof text === 'string' && text.trim()) {
        const content = parseMessageContent(text);
        if (content.text.trim()) return messageTextForDisplay(content.text);
    }
    return '🔒 Encrypted message';
}
