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
import { base58check, bech32 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { Screen, PageHeader, AddressText, Button, ChainBadge, EmptyState, FieldIconButton, FormErrorSummary, FormErrorsContext, FormPage, Input, ListPage, ListRow, AnimatedQrFrames, MultisigBadge, NetworkField, QrScanner, StatusMessage, Tabs, Textarea, Icon, useFormErrors } from '@xchain-wallet/core/ui';
import { flows as flowsLib, registry as registryLib, schemas, uri as uriLib } from '@xchain-wallet/core';
import { formatActivityTime } from '../utils/dateTime.js';
import { MultisigSendForm } from './MultisigSendForm.jsx';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import listStyles from './MultisigSigningSession.module.css';
import { formatNativeBaseUnits, tickerForCoin } from '../../registry/coinTicker.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { ADDRESS_PARAMS } from '../utils/addressValidation.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useDemoGuard, useWalletSource } from '../hooks/useDemoGuard.jsx';
import { withAutoLockHold } from '../hooks/autoLockGuard.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { copyText } from '../clipboard.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/multisig.js';
import styles from './IssueTokenForm.module.css';

const { progressSummary } = schemas.multisigSigningSession;
const base58 = base58check(sha256);
const chainRegistry = registryLib.defaultRegistry();

// Multisig spends are Bitcoin-only today, as in Create multisig.
const MULTISIG_COIN = 'bitcoin';

// The list groups sessions by what the user has to do next.
const READY_STATUSES = new Set(['ready-to-finalize', 'finalized']);
const WAITING_STATUSES = new Set(['collecting-nonces', 'collecting-sigs']);

// The plain multisig type word, as MultisigBadge shows it.
const SCHEME_WORDS = {
    'p2sh-multisig': 'Classic',
    'p2wsh-multisig': 'SegWit',
    'taproot-musig2': 'Taproot',
};

// A row leads with the action ("Send 0.25 BTC"); the destination the
// summary also names is on the session page, not in the list.
function sessionTitle(session) {
    const summary = String(session?.actionSummary || '').trim();
    if (!summary) return t('multisig.sessions.untitled');
    const cut = summary.indexOf(' to ');
    return cut > 0 ? summary.slice(0, cut) : summary;
}

function sessionSubtitle(session) {
    const parts = [t('multisig.sessions.type', {
        threshold: session.threshold,
        count: [...new Set(session.cosignerPubkeys || [])].length,
        scheme: SCHEME_WORDS[session.scheme] || '',
    }).trim()];
    if (session.scheme === 'taproot-musig2' && WAITING_STATUSES.has(session.status)) {
        parts.push(t('multisig.sessions.step', { step: session.status === 'collecting-nonces' ? 1 : 2 }));
    }
    // Open sessions count their age from the start, finished ones from the end.
    const age = formatActivityTime(WAITING_STATUSES.has(session.status) || READY_STATUSES.has(session.status)
        ? session.createdAt
        : (session.updatedAt || session.createdAt));
    if (age) parts.push(age);
    return parts.join(' · ');
}

// The one coloured status on the right of each row.
function sessionPill(session) {
    if (session.status === 'finalized') return { text: t('multisig.sessions.pillSendNow'), tone: listStyles.pillReady };
    if (session.status === 'ready-to-finalize') return { text: t('multisig.sessions.pillReady'), tone: listStyles.pillReady };
    if (session.status === 'broadcast') return { text: t('multisig.sessions.pillSent'), tone: listStyles.pillSent };
    if (session.status === 'cancelled') return { text: t('multisig.sessions.pillCancelled'), tone: listStyles.pillCancelled };
    return {
        text: t('multisig.sessions.pillSigned', {
            current: contributionProgress(session).contributed.length,
            threshold: session.threshold,
        }),
        tone: listStyles.pillWaiting,
    };
}

// An open session waits on your signature when one of this wallet's keys
// (the record's optional `localPubkeys`) has not yet contributed to the
// current step. A record that does not name this wallet's keys counts as
// waiting on the other cosigners.
function needsYourSignature(session) {
    if (!WAITING_STATUSES.has(session.status)) return false;
    const local = new Set(Array.isArray(session.localPubkeys) ? session.localPubkeys : []);
    if (local.size === 0) return false;
    return contributionProgress(session).unsigned.some((pk) => local.has(pk));
}

// The page's three tabs, in toggle order.
const SESSION_TABS = /** @type {const} */ (['ready', 'waiting', 'done']);
const SESSION_TABS_ID = 'multisig-sessions-tabs';
const SESSION_PANEL_ID = 'multisig-sessions-panel';

/**
 * Split sessions into the three tabs, newest first in each: Ready (your
 * signature, or ready to finalize or send), Waiting (on other cosigners)
 * and Done (sent or cancelled).
 * @param {any[]} sessions
 */
export function groupSigningSessions(sessions) {
    const newestFirst = [...(sessions || [])].sort((a, b) => String(b.updatedAt || b.createdAt || '')
        .localeCompare(String(a.updatedAt || a.createdAt || '')));
    return {
        ready: newestFirst.filter((s) => READY_STATUSES.has(s.status) || needsYourSignature(s)),
        waiting: newestFirst.filter((s) => WAITING_STATUSES.has(s.status) && !needsYourSignature(s)),
        done: newestFirst.filter((s) => !READY_STATUSES.has(s.status) && !WAITING_STATUSES.has(s.status)),
    };
}
const {
    encodeXcwChunks,
    createXcwCollector,
    addChunkToCollector,
    buildRequestEnvelope,
    buildFinalizedEnvelope,
    decodeMultisigEnvelope,
    encodeMultisigEnvelope,
    fingerprintSessionRef,
    buildMultisigSessionLink,
    parseMultisigSessionLink,
} = uriLib;

// Humanize the session status enum for display (#3881): the raw tokens are
// backend vocabulary and one of them leaks "nonce" onto a signing screen.
// Covers every value of schemas.multisigSigningSession.MULTISIG_SESSION_STATUSES.
const STATUS_LABELS = {
    'collecting-nonces': 'Waiting for cosigner replies',
    'collecting-sigs': 'Collecting signatures',
    'ready-to-finalize': 'Ready to finalize',
    'finalized': 'Finalized, ready to broadcast',
    'broadcast': 'Broadcast',
    'cancelled': 'Cancelled',
};
const statusLabel = (s) => STATUS_LABELS[s] || s;

// Humanize the local-sign contribution kind; the flow's enum stays wire vocabulary.
// Covers every contributionKind flows/multisigSignLocally.js returns.
const CONTRIBUTION_LABELS = {
    'round-1-nonce': 'Step 1 reply',
    'round-2-partial': 'Step 2 signature',
    'classical-signature': 'Signature',
};
const contributionLabel = (k) => CONTRIBUTION_LABELS[k] || 'Signature';

export const COLLECTOR_ERROR_MESSAGE =
    "Could not read that cosigner reply. Select Clear Received Reply, then scan again or paste the whole code your cosigner's wallet shows.";

function outputAddress(script, chainId) {
    const coin = String(chainId || '').split('-')[0];
    const network = String(chainId || '').includes('mainnet')
        ? 'mainnet'
        : String(chainId || '').includes('regtest') ? 'regtest' : 'testnet';
    const params = ADDRESS_PARAMS[coin]?.[network];
    if (!params) return null;
    let match = /^76a914([0-9a-f]{40})88ac$/.exec(script);
    if (match) return base58.encode(Uint8Array.from([params.p2pkh, ...match[1].match(/../g).map((b) => Number.parseInt(b, 16))]));
    match = /^a914([0-9a-f]{40})87$/.exec(script);
    if (match) return base58.encode(Uint8Array.from([params.p2sh, ...match[1].match(/../g).map((b) => Number.parseInt(b, 16))]));
    match = /^00(14[0-9a-f]{40}|20[0-9a-f]{64})$/.exec(script);
    if (!match || !params.hrp) return null;
    const program = match[1].slice(2).match(/../g).map((b) => Number.parseInt(b, 16));
    return bech32.encode(params.hrp, [0, ...bech32.toWords(Uint8Array.from(program))], 90);
}

// Host refusals of a reply's content; the same reply can never pass, so no retry.
const REFUSED_REPLY_CODES = new Set(['MULTISIG_SIGNATURE_INVALID', 'MULTISIG_NONCE_INVALID']);

// Count each configured identity once so duplicated records cannot satisfy a threshold.
function contributionProgress(session) {
    const cosignerPubkeys = [...new Set(session?.cosignerPubkeys || [])];
    const isMusig2 = session?.scheme === 'taproot-musig2';
    const isResponseStep = isMusig2 && session?.status === 'collecting-nonces';
    const contributions = isResponseStep
        ? session?.nonces
        : isMusig2
            ? session?.partialSigs
            : session?.signatures;
    const contributedPubkeys = new Set((contributions || []).map((item) => item.pubkey));
    const contributed = cosignerPubkeys.filter((pk) => contributedPubkeys.has(pk));
    const unsigned = cosignerPubkeys.filter((pk) => !contributedPubkeys.has(pk));
    return { contributed, unsigned, isResponseStep };
}

function distinctContributionCount(session, contributions) {
    const cosignerPubkeys = new Set(session?.cosignerPubkeys || []);
    return new Set(
        (contributions || [])
            .map((item) => item.pubkey)
            .filter((pubkey) => cosignerPubkeys.has(pubkey)),
    ).size;
}

function signingProgressSummary(session) {
    const summary = progressSummary(session);
    // Preserve terminal summaries while live stages report distinct contributions.
    if (!summary || !['collecting-nonces', 'collecting-sigs', 'ready-to-finalize'].includes(session.status)) {
        return summary;
    }
    return { ...summary, current: contributionProgress(session).contributed.length };
}

function hasFinalizationThreshold(session) {
    if (!session) return false;
    const contributions = session.scheme === 'taproot-musig2'
        ? session.partialSigs
        : session.signatures;
    return distinctContributionCount(session, contributions) >= session.threshold;
}

function sessionRefFor(session) {
    return {
        chainId: session.chainId,
        scheme: session.scheme,
        threshold: session.threshold,
        cosignerPubkeys: session.cosignerPubkeys,
        msgHash: session.msgHash,
        psbtHex: session.psbtHex || '',
    };
}

export function buildSessionEnvelope(session) {
    if (!session || !session.psbtHex) return null;
    const sessionRef = sessionRefFor(session);
    if (session.scheme === 'taproot-musig2') {
        if (session.status === 'collecting-nonces') {
            return buildRequestEnvelope({ kind: 'multisig-request-nonce', sessionRef });
        }
        if (session.status === 'collecting-sigs' && session.aggNonce) {
            return buildRequestEnvelope({
                kind: 'multisig-request-partial',
                sessionRef,
                aggNonceHex: session.aggNonce,
            });
        }
    } else if (session.status === 'collecting-sigs') {
        return buildRequestEnvelope({ kind: 'multisig-request-signature', sessionRef });
    }
    if (session.status === 'finalized' && session.finalizedTxHex) {
        return buildFinalizedEnvelope({
            sessionRef,
            txHex: session.finalizedTxHex,
            ...(session.txid ? { txid: session.txid } : {}),
        });
    }
    return null;
}

function replyMismatchMessage(envelope, session) {
    if (envelope.fingerprint !== fingerprintSessionRef(sessionRefFor(session))) {
        return 'This cosigner reply belongs to a different signing session. Open the matching session and import it there.';
    }
    const expectedKind = session.scheme === 'taproot-musig2'
        ? (session.status === 'collecting-nonces'
            ? 'multisig-round-1-reply'
            : session.status === 'collecting-sigs'
                ? 'multisig-round-2-reply'
                : null)
        : session.status === 'collecting-sigs'
            ? 'multisig-classical-reply'
            : null;
    if (!expectedKind) {
        return 'This session is not accepting more cosigner replies.';
    }
    if (envelope.kind !== expectedKind) {
        return 'This cosigner reply is for a different signing step. Import the reply requested by the step shown on this session.';
    }
    // The host refuses both of these too, but with a developer message the
    // screen reduces to a generic failure and a retry that cannot succeed.
    const pubkey = String(envelope.contribution?.pubkey || '').toLowerCase();
    if (!(session.cosignerPubkeys || []).includes(pubkey)) {
        return 'This reply is signed by a key that is not one of this multisig\'s cosigners. Ask a listed cosigner for their reply.';
    }
    const { contributed } = contributionProgress(session);
    if (contributed.includes(pubkey)) {
        return 'This cosigner\'s reply is already applied to this step. Import a reply from a pending cosigner.';
    }
    return null;
}

/**
 * §22.3 + §42.9 multisig sign-screen tracker (Phase 4 Step 19).
 *
 * Dual-mode tracker:
 *   - **P2SH / P2WSH** track one round of classical ECDSA signatures
 *     under the redeem/witness script. The header reads
 *     "Signatures collected: 2 of 3" and finalize is reachable as
 *     soon as threshold is met.
 *   - **Taproot-MuSig2** tracks two steps. Step 1 collects 66-byte
 *     publicNonces ("Cosigners responded (step 1 of 2)"); once threshold
 *     is met the wallet aggregates them via `sdk.musig2.aggregateNonces`
 *     and the header switches to "Signatures collected (step 2 of 2)".
 *     Step 2 collects 32-byte partial sigs which are then aggregated
 *     into a single 64-byte Schnorr signature (BIP327); on chain
 *     this is indistinguishable from a single-sig taproot spend
 *     (§22.4).
 *
 * Step 19 owns persistence + state machine + tracker UI. Step 20
 * wires the QR-PSBT transport that drives contributions; Step 21
 * wires hardware MuSig2 paths. Until those land, the tracker exposes
 * Aggregate / Cancel actions plus a Pending-cosigners list so the
 * dual-round protocol can be exercised end-to-end via smoke tests.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialSessionId]
 * @param {string} [props.initialLink]
 */
export function MultisigSigningSession({ walletId, onBack, initialSessionId, initialLink }) {
    const { shell } = useMessaging();
    // A demo wallet reads sample sessions through its source, and every
    // action that would change a session is refused by the demo guard.
    const { messaging } = useWalletSource(walletId);
    const demoGuard = useDemoGuard(walletId, { onBack });
    const { isWatcherMode } = useWalletMode();
    const variant = screenVariantFor(shell);

    const [sessions, setSessions] = useState(/** @type {any[] | null} */ (null));
    const [activeId, setActiveId] = useState(/** @type {string | null} */ (initialSessionId || null));
    const [active, setActive] = useState(/** @type {any | null} */ (null));
    const [busy, setBusy] = useState(false);
    const [canceling, setCanceling] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [view, setView] = useState(/** @type {'tracker' | 'export-qr' | 'paste-inbox' | 'sign-locally'} */ ('tracker'));
    const [pasteInput, setPasteInput] = useState('');
    const [collectorState, setCollectorState] = useState(() => createXcwCollector());
    const [pasteResult, setPasteResult] = useState(/** @type {string | null} */ (null));
    const [scannerOpen, setScannerOpen] = useState(false);
    const [signPassword, setSignPassword] = useState('');
    const [signResult, setSignResult] = useState(/** @type {string | null} */ (null));
    const signErrors = useFormErrors();
    const pasteErrors = useFormErrors();
    const trackerErrors = useFormErrors();
    const [linkStatus, setLinkStatus] = useState(/** @type {string | null} */ (null));
    // The list tab the user picked; null shows Ready, or the first tab with
    // sessions when Ready has none.
    const [listTab, setListTab] = useState(/** @type {'ready' | 'waiting' | 'done' | null} */ (null));
    // The Open Signing Link page, opened from the header's link button, or at
    // once (prefilled and opening) when the page was handed a link. `key`
    // remounts the page for each newly handed link.
    const [linkPage, setLinkPage] = useState(/** @type {{ value: string, auto: boolean, key: number } | null} */ (
        initialLink ? { value: initialLink, auto: true, key: 1 } : null));
    // Start a signing session from this page: pick the multisig, then the
    // action, then the action's own form.
    const [starting, setStarting] = useState(false);
    const listRequestId = useRef(0);
    const activeRequestId = useRef(0);
    const mountedRef = useRef(false);
    // The link the page mounted with is already on the Open Signing Link page.
    const initialLinkRef = useRef(initialLink || null);

    // (error-recovery sweep remainder): each error surface offers a
    // one-click "Try again" against whatever action last failed. The
    // failing handler records its own re-run here so the recovery button
    // retries the right operation without the user re-navigating. Left
    // null for errors that aren't retryable by re-running (malformed
    // scan / wrong-envelope-kind), so no misleading button renders.
    const retryRef = useRef(/** @type {null | (() => void | Promise<void>)} */ (null));
    const fail = useCallback((message, retryFn) => {
        retryRef.current = typeof retryFn === 'function' ? retryFn : null;
        setError(message);
    }, []);

    const refreshList = useCallback(async () => {
        const requestId = ++listRequestId.current;
        try {
            const list = await messaging.listMultisigSigningSessions({ walletId });
            if (requestId !== listRequestId.current) return;
            setSessions(Array.isArray(list) ? list : []);
        } catch (err) {
            if (requestId !== listRequestId.current) return;
            console.error('Multisig sessions list failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Failed to load multisig sessions.'), refreshList);
            setSessions([]);
        }
    }, [walletId, messaging, fail]);

    const refreshActive = useCallback(async (id) => {
        const requestId = ++activeRequestId.current;
        try {
            const session = await messaging.getMultisigSigningSession({ sessionId: id });
            if (requestId !== activeRequestId.current) return;
            setActive(session);
        } catch (err) {
            if (requestId !== activeRequestId.current) return;
            console.error('Multisig session load failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Failed to load session.'), () => refreshActive(id));
        }
    }, [messaging, fail]);

    // Stop action continuations from polling after their screen has unmounted.
    const refreshAfterAction = useCallback(async (id) => {
        if (!mountedRef.current) return;
        await refreshActive(id);
        if (!mountedRef.current) return;
        await refreshList();
    }, [refreshActive, refreshList]);

    // Open a signing link from the Open Signing Link page. On success the
    // page closes onto the imported session and this returns null. A link
    // that does not parse, or that the wallet refuses for what it carries,
    // comes back as the link field's error; any other failure comes back as
    // the form's error. A demo wallet refuses before reading the link.
    const openSigningLink = useCallback(async (text) => {
        if (busy) return null;
        if (demoGuard.blocked) {
            demoGuard.refuse();
            return null;
        }
        let envelope;
        try {
            envelope = parseMultisigSessionLink(text);
        } catch (err) {
            return { field: true, message: userFacingMessage(err, t('multisig.signingLink.invalid')) };
        }
        setBusy(true);
        setError(null);
        setLinkStatus(null);
        try {
            const result = await withAutoLockHold(() => messaging.importMultisigSigningRequest({
                walletId,
                envelope,
            }));
            if (!result?.sessionId) throw new Error(t('multisig.signingLink.openFailed'));
            setLinkPage(null);
            setActiveId(result.sessionId);
            setView('tracker');
            await refreshList();
            return null;
        } catch (err) {
            if (err?.userFacing !== true) {
                console.error('Multisig signing link import failed:', err); // eslint-disable-line no-console
            }
            return {
                field: err?.userFacing === true,
                message: userFacingMessage(err, t('multisig.signingLink.openFailed')),
            };
        } finally {
            setBusy(false);
        }
    }, [busy, demoGuard, messaging, walletId, refreshList]);

    // Two surfaces can apply the same reply at once, and the one that loses
    // holds a stale session: its refusal is developer text and a retry of the
    // same reply can never pass. Reload the session and re-run the reply check
    // so the screen says where the session stands. Returns the check's message,
    // or null when the reply still fits (the failure was something else).
    const recheckReply = useCallback(async (envelope, sessionId) => {
        if (!envelope || !mountedRef.current) return null;
        const requestId = ++activeRequestId.current;
        let fresh;
        try {
            fresh = await messaging.getMultisigSigningSession({ sessionId });
        } catch (err) {
            console.error('Multisig session reload failed:', err); // eslint-disable-line no-console
            return null;
        }
        if (!fresh || requestId !== activeRequestId.current || !mountedRef.current) return null;
        setActive(fresh);
        refreshList();
        return replyMismatchMessage(envelope, fresh);
    }, [messaging, refreshList]);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        refreshList();
        return () => { listRequestId.current += 1; };
    }, [refreshList]);

    useEffect(() => {
        if (activeId) refreshActive(activeId);
        return () => { activeRequestId.current += 1; };
    }, [activeId, refreshActive]);

    // A link handed in after the page mounted (a deep link while it is open)
    // opens the Open Signing Link page again, prefilled and opening.
    useEffect(() => {
        if (!initialLink || initialLinkRef.current === initialLink) return;
        initialLinkRef.current = initialLink;
        setActiveId(null);
        setStarting(false);
        setLinkPage((page) => ({ value: initialLink, auto: true, key: (page?.key || 1) + 1 }));
    }, [initialLink]);

    // A demo wallet's sample sessions cannot change: each action that would
    // change one answers with the demo guard's refusal instead.
    function refusedInDemo() {
        if (!demoGuard.blocked) return false;
        demoGuard.refuse();
        return true;
    }

    async function handleAggregate() {
        if (!active || busy || refusedInDemo()) return;
        setBusy(true);
        setError(null);
        try {
            await messaging.aggregateMultisigSession({ sessionId: active.id });
            await refreshAfterAction(active.id);
        } catch (err) {
            console.error('Multisig aggregate failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Could not combine the cosigner replies.'), handleAggregate);
        } finally {
            setBusy(false);
        }
    }

    async function handleCancel() {
        if (!active || busy || refusedInDemo()) return;
        setCanceling(true);
        setBusy(true);
        setError(null);
        try {
            await messaging.cancelMultisigSigningSession({ sessionId: active.id });
            await refreshAfterAction(active.id);
        } catch (err) {
            console.error('Multisig cancel failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Cancel failed.'), handleCancel);
        } finally {
            setBusy(false);
            setCanceling(false);
        }
    }

    async function handleFinalize() {
        // Require distinct configured cosigners even if persisted status is stale.
        if (!active || busy) return;
        if (!hasFinalizationThreshold(active)) {
            trackerErrors.fail('Collect enough distinct cosigner signatures before finalizing.', 'form:signatures');
            return;
        }
        if (refusedInDemo()) return;
        trackerErrors.reset();
        setBusy(true);
        setError(null);
        try {
            await withAutoLockHold(() => messaging.finalizeMultisigSigningSession({ sessionId: active.id }));
            await refreshAfterAction(active.id);
        } catch (err) {
            console.error('Multisig finalization failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Could not finalize the signed transaction.'), handleFinalize);
        } finally {
            setBusy(false);
        }
    }

    async function handleBroadcast() {
        if (!active || busy || refusedInDemo()) return;
        setBusy(true);
        setError(null);
        try {
            await withAutoLockHold(() => messaging.finalizeMultisigSigningSession({
                sessionId: active.id,
                broadcast: true,
            }));
            await refreshAfterAction(active.id);
        } catch (err) {
            console.error('Multisig broadcast failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Could not broadcast the signed transaction.'), handleBroadcast);
        } finally {
            setBusy(false);
        }
    }

    // §20.3 chunked QR frames for the current outbound envelope.
    // Coordinator's request kind switches with the session's status:
    // round 1 (MuSig2 nonces) vs round 2 (MuSig2 partials, carries
    // aggNonce) vs P2SH/P2WSH single round vs finalized broadcast.
    const exportData = useMemo(() => {
        if (!active || !active.psbtHex) return null;
        try {
            const envelope = buildSessionEnvelope(active);
            if (!envelope) return null;
            const frames = encodeXcwChunks(encodeMultisigEnvelope(envelope));
            const link = envelope.kind.startsWith('multisig-request-')
                ? buildMultisigSessionLink(envelope)
                : null;
            return { envelope, frames, link };
        } catch (e) {
            // Surface in the UI rather than crashing; sessions with
            // malformed state still let the user cancel them.
            console.error('Multisig QR envelope build failed:', e); // eslint-disable-line no-console
            return { error: userFacingMessage(e, 'Could not build the transaction QR for this session.') };
        }
    }, [active]);

    const exportFrames = exportData?.frames || (exportData?.error ? exportData : null);

    async function handleCopyLink() {
        if (!exportData?.link) return;
        const { ok } = await copyText(exportData.link);
        setLinkStatus(ok
            ? t('multisig.signingLink.copied')
            : t('multisig.signingLink.copyFailed'));
    }

    async function handleShareLink() {
        const share = globalThis.navigator?.share;
        if (!exportData?.link || typeof share !== 'function') return;
        try {
            await share.call(globalThis.navigator, {
                title: t('multisig.signingLink.shareTitle'),
                text: t('multisig.signingLink.shareText'),
                url: exportData.link,
            });
        } catch (err) {
            if (err?.name !== 'AbortError') {
                fail(userFacingMessage(err, t('multisig.signingLink.shareFailed')), null);
            }
        }
    }

    const decodedSpend = useMemo(() => {
        if (!active?.psbtHex || !['p2sh-multisig', 'p2wsh-multisig'].includes(active.scheme)) return null;
        try {
            return flowsLib.decodeMultisigSpend(active.psbtHex);
        } catch {
            return null;
        }
    }, [active]);

    function resetCollector() {
        setCollectorState(createXcwCollector());
        setPasteInput('');
        setPasteResult(null);
        setError(null);
        retryRef.current = null;
        pasteErrors.reset();
    }

    // Camera scanner frame handler: each detected QR string goes
    // through the same collector the paste path uses, so whichever
    // transport completes the envelope first wins. Once the collector
    // completes we dispatch via the existing submit path so UX is
    // identical.
    const handleScannerFrame = useCallback(async (text) => {
        if (!active || busy) return;
        const alreadyErrored = Boolean(collectorState.error);
        let next = addChunkToCollector(collectorState, text);
        if (next === collectorState) {
            // addChunkToCollector mutates the same object; re-check.
            next = { ...collectorState };
        }
        if (next.error) {
            if (!alreadyErrored) {
                console.error('Multisig scan: reply frame rejected:', next.error); // eslint-disable-line no-console
            }
            fail(COLLECTOR_ERROR_MESSAGE, null);
            setCollectorState(next);
            return;
        }
        setCollectorState(next);
        setPasteInput((cur) => (cur.length > 0 ? `${cur}\n${text}` : text));
        if (!next.complete || !next.psbt) return;
        // Close scanner + let the normal submit path handle the
        // decoded envelope (reuses verification + contributeMultisig*
        // dispatch + busy / refresh choreography).
        setScannerOpen(false);
        if (demoGuard.blocked) {
            demoGuard.refuse();
            return;
        }
        setBusy(true);
        let envelope = null;
        try {
            envelope = decodeMultisigEnvelope(next.psbt);
            const mismatch = replyMismatchMessage(envelope, active);
            if (mismatch) {
                fail(mismatch, null);
                return;
            }
            if (envelope.kind === 'multisig-round-1-reply') {
                await messaging.contributeMultisigNonce({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    publicNonceHex: envelope.contribution.publicNonce,
                });
                setPasteResult(`Step 1 reply from ${shortPk(envelope.contribution.pubkey)} scanned.`);
            } else if (envelope.kind === 'multisig-round-2-reply') {
                await messaging.contributeMultisigSignature({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    signatureHex: envelope.contribution.sig,
                });
                setPasteResult(`Step 2 signature from ${shortPk(envelope.contribution.pubkey)} scanned.`);
            } else if (envelope.kind === 'multisig-classical-reply') {
                await messaging.contributeMultisigSignature({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    signatureHex: envelope.contribution.sig,
                });
                setPasteResult(`Signature from ${shortPk(envelope.contribution.pubkey)} scanned.`);
            } else {
                // The wire tag names a code object, so it goes to the console
                // and the user gets the next step instead.
                console.error('Multisig scan: unsupported reply kind:', envelope.kind); // eslint-disable-line no-console
                fail('That QR code is not a cosigner reply for this session. Ask your cosigner to scan the request code from this session, then scan the code their wallet shows.', null);
            }
            await refreshAfterAction(active.id);
            setCollectorState(createXcwCollector());
            setPasteInput('');
        } catch (err) {
            console.error('Multisig scanned contribution failed:', err); // eslint-disable-line no-console
            const refused = REFUSED_REPLY_CODES.has(err?.code);
            const recheck = refused ? null : await recheckReply(envelope, active.id);
            const fallback = refused
                ? 'That cosigner reply did not pass the signature check. Ask your cosigner to make a new reply, then scan it.'
                : 'Could not add that cosigner reply. Ask your cosigner to show their code again, then scan it.';
            fail(recheck || userFacingMessage(err, fallback), null);
        } finally {
            setBusy(false);
        }
    }, [active, busy, collectorState, demoGuard, messaging, refreshAfterAction, recheckReply, fail]);

    async function handleSignLocally() {
        if (!active || busy || refusedInDemo()) return;
        if (!signErrors.validate({
            'multisig-sign-password': signPassword.length === 0
                ? 'Enter your wallet password to sign.'
                : null,
        })) return;
        setBusy(true);
        setError(null);
        setSignResult(null);
        try {
            const result = await withAutoLockHold(() => messaging.signMultisigLocally({
                sessionId: active.id,
                password:  signPassword,
            }));
            setSignResult(
                `${contributionLabel(result?.contributionKind)} from ${shortPk(result?.pubkey || '')} added.`,
            );
            setSignPassword('');
            await refreshAfterAction(active.id);
        } catch (err) {
            console.error('Multisig local signing failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Could not sign on this device. Check your password and try again.'), handleSignLocally);
        } finally {
            setBusy(false);
        }
    }

    async function handlePasteSubmit() {
        if (!active || busy || refusedInDemo()) return;
        if (!pasteErrors.validate({
            'multisig-reply-chunks': pasteInput.trim().length === 0
                ? 'Paste or scan the cosigner reply chunks.'
                : null,
        })) return;
        setBusy(true);
        setError(null);
        setPasteResult(null);
        // Accept both single chunks and newline-separated batches:
        // some users will paste the whole capture log at once rather
        // than frame-by-frame.
        const lines = pasteInput
            .split(/[\r\n]+/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        let state = collectorState;
        for (const line of lines) {
            state = addChunkToCollector(state, line);
            if (state.error) {
                console.error('Multisig paste: reply frame rejected:', state.error); // eslint-disable-line no-console
                fail(COLLECTOR_ERROR_MESSAGE, null);
                setCollectorState(state);
                setBusy(false);
                return;
            }
            if (state.complete) break;
        }
        setCollectorState(state);
        if (!state.complete || !state.psbt) {
            setBusy(false);
            return;
        }
        let envelope;
        try {
            envelope = decodeMultisigEnvelope(state.psbt);
        } catch (e) {
            console.error('Multisig envelope decode failed:', e); // eslint-disable-line no-console
            fail(userFacingMessage(
                e,
                'Could not read that cosigner reply. Ask your cosigner to show their code again, then paste it.',
            ), null);
            setBusy(false);
            return;
        }
        try {
            const mismatch = replyMismatchMessage(envelope, active);
            if (mismatch) {
                fail(mismatch, null);
                return;
            }
            if (envelope.kind === 'multisig-round-1-reply') {
                await messaging.contributeMultisigNonce({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    publicNonceHex: envelope.contribution.publicNonce,
                });
                setPasteResult(`Step 1 reply from ${shortPk(envelope.contribution.pubkey)} accepted.`);
            } else if (envelope.kind === 'multisig-round-2-reply') {
                await messaging.contributeMultisigSignature({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    signatureHex: envelope.contribution.sig,
                });
                setPasteResult(`Step 2 signature from ${shortPk(envelope.contribution.pubkey)} accepted.`);
            } else if (envelope.kind === 'multisig-classical-reply') {
                await messaging.contributeMultisigSignature({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    signatureHex: envelope.contribution.sig,
                });
                setPasteResult(`Signature from ${shortPk(envelope.contribution.pubkey)} accepted.`);
            } else {
                // Paste-path twin of the scanner branch: wire tag to the
                // console, next step to the user.
                console.error('Multisig paste: unsupported reply kind:', envelope.kind); // eslint-disable-line no-console
                fail('That code is not a cosigner reply for this session. Ask your cosigner to load the request code from this session, then paste the code their wallet shows.', null);
                setBusy(false);
                return;
            }
            await refreshAfterAction(active.id);
            setCollectorState(createXcwCollector());
            setPasteInput('');
        } catch (err) {
            console.error('Multisig contribution apply failed:', err); // eslint-disable-line no-console
            if (REFUSED_REPLY_CODES.has(err?.code)) {
                // Submitting the same reply again cannot pass the reply check.
                fail(userFacingMessage(
                    err,
                    'That cosigner reply did not pass the signature check. Ask your cosigner to make a new reply, then paste it.',
                ), null);
            } else {
                const recheck = await recheckReply(envelope, active.id);
                if (recheck) {
                    fail(recheck, null);
                } else {
                    fail(userFacingMessage(err, 'Could not add that cosigner reply. Try again.'), handlePasteSubmit);
                }
            }
        } finally {
            setBusy(false);
        }
    }

    // Recovery slot for the shared `error` surface. Present only
    // when the last failure recorded a re-runnable action (retryRef);
    // undefined otherwise so StatusMessage renders the diagnostic alone.
    const errorRecovery = retryRef.current
        ? { label: 'Try Again', onAction: retryRef.current }
        : undefined;

    // The list's title line carries the plus that starts a new session.
    const header = (
        <PageHeader
            // An open session's Back returns to the session list in place.
            nested={Boolean(activeId)}
            onBack={() => (activeId ? setActiveId(null) : onBack())}
            title={activeId ? 'Multisig Signing' : 'Multisig Sessions'}
            trailing={activeId ? null : (
                <>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<Icon.ExternalLinkIcon />}
                        onClick={() => setLinkPage((page) => ({ value: '', auto: false, key: (page?.key || 1) + 1 }))}
                        aria-label={t('multisig.signingLink.openTitle')}
                        title={t('multisig.signingLink.openTitle')}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<Icon.PlusIcon />}
                        onClick={() => setStarting(true)}
                        aria-label={t('multisig.start.button')}
                        title={t('multisig.start.button')}
                    />
                </>
            )}
        />
    );

    // A refused demo action leads the page (null until refused), above the
    // list's tabs when it has them.
    const wrap = (children, toolbar, errors = null) => (
        <Screen variant={variant} header={header}>
            <FormErrorsContext.Provider value={errors}>
                <ListPage
                    notices={(demoGuard.note || errors?.hasErrors) ? (
                        <>
                            {demoGuard.note}
                            {errors ? <FormErrorSummary form={errors} /> : null}
                        </>
                    ) : null}
                    toolbar={toolbar}
                >
                    {children}
                </ListPage>
            </FormErrorsContext.Provider>
            {demoGuard.dialog}
        </Screen>
    );

    if (error && activeId && !active) {
        return wrap(
            <>
                <StatusMessage variant="error" recovery={errorRecovery}>{error}</StatusMessage>
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (linkPage && !activeId) {
        return (
            <OpenSigningLinkPage
                key={linkPage.key}
                variant={variant}
                initialValue={linkPage.value}
                autoOpen={linkPage.auto}
                busy={busy}
                demoGuard={demoGuard}
                onBack={() => setLinkPage(null)}
                onOpen={openSigningLink}
            />
        );
    }

    if (starting && !activeId) {
        return (
            <SessionStartFlow
                walletId={walletId}
                variant={variant}
                onCancel={() => setStarting(false)}
                onSessionStarted={(sessionId) => {
                    setStarting(false);
                    if (sessionId) setActiveId(sessionId);
                    void refreshList();
                }}
            />
        );
    }

    if (!sessions) {
        return wrap(<p className={styles.hint}>Loading sessions…</p>);
    }

    if (!activeId) {
        const groups = groupSigningSessions(sessions);
        const sessionRow = (s) => {
            const pill = sessionPill(s);
            const descriptor = chainRegistry.get(s.chainId);
            return (
                <li key={s.id}>
                    <ListRow
                        onClick={() => setActiveId(s.id)}
                        chevron
                        leading={descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : null}
                        title={sessionTitle(s)}
                        subtitle={sessionSubtitle(s)}
                        trailing={<span className={`${listStyles.pill} ${pill.tone}`}>{pill.text}</span>}
                    />
                </li>
            );
        };
        const errorNotice = error
            ? <StatusMessage variant="error" recovery={errorRecovery}>{error}</StatusMessage>
            : null;
        // No sessions at all: the one page-wide empty state that names both
        // header buttons, with no tabs above it.
        if (sessions.length === 0) {
            return wrap(
                <>
                    {!error ? (
                        <EmptyState
                            title={t('multisig.sessions.emptyTitle')}
                            body={t('multisig.sessions.emptyBody')}
                        />
                    ) : null}
                    {errorNotice}
                </>,
            );
        }
        // The Ready | Waiting | Done toggle (at most four tabs, G42): the
        // user's pick, else Ready, else the first tab that has sessions.
        const shownTab = listTab
            || SESSION_TABS.find((id) => groups[id].length > 0)
            || 'ready';
        const rows = groups[shownTab];
        const tabsToolbar = (
            <div className={listStyles.tabsRow}>
                <Tabs
                    id={SESSION_TABS_ID}
                    aria-label={t('multisig.sessions.tabsLabel')}
                    panelId={SESSION_PANEL_ID}
                    items={[
                        { id: 'ready', label: t('multisig.sessions.tabReady'), icon: <Icon.SignIcon /> },
                        { id: 'waiting', label: t('multisig.sessions.tabWaiting'), icon: <Icon.ClockIcon /> },
                        { id: 'done', label: t('multisig.sessions.tabDone'), icon: <Icon.CheckIcon /> },
                    ]}
                    value={shownTab}
                    onChange={setListTab}
                />
            </div>
        );
        // Each tab's own empty line.
        const emptyTab = {
            ready: { title: t('multisig.sessions.emptyReadyTitle'), body: t('multisig.sessions.emptyReadyBody') },
            waiting: { title: t('multisig.sessions.emptyWaitingTitle'), body: t('multisig.sessions.emptyWaitingBody') },
            done: { title: t('multisig.sessions.emptyDoneTitle'), body: t('multisig.sessions.emptyDoneBody') },
        }[shownTab];
        return wrap(
            <>
                <div
                    role="tabpanel"
                    id={SESSION_PANEL_ID}
                    aria-labelledby={`${SESSION_TABS_ID}-tab-${shownTab}`}
                >
                    {rows.length === 0 ? (
                        <EmptyState title={emptyTab.title} body={emptyTab.body} />
                    ) : (
                        // One rounded list card with divider lines, each row
                        // ending in the standard chevron (G07, U41).
                        /* Safari needs an explicit list role because this class removes list styling. */
                        <ul aria-label={t('multisig.sessions.listLabel')} className={listStyles.list} role="list">
                            {rows.map(sessionRow)}
                        </ul>
                    )}
                </div>
                {errorNotice}
            </>,
            tabsToolbar,
        );
    }

    if (!active) {
        return wrap(<p className={styles.hint}>Loading session…</p>);
    }

    const summary = signingProgressSummary(active);
    const isMusig2 = active.scheme === 'taproot-musig2';
    const { contributed, unsigned, isResponseStep } = contributionProgress(active);
    const remaining = Math.max(active.threshold - contributed.length, 0);
    const canCollect = ['collecting-nonces', 'collecting-sigs'].includes(active.status);
    const stepLabel = isMusig2
        ? (active.status === 'collecting-nonces'
            ? 'Step 1: Collect cosigner replies'
            : (active.status === 'collecting-sigs'
                ? 'Step 2: Collect signatures'
                : null))
        : (active.status === 'collecting-sigs' ? 'Collect signatures' : null);

    if (view === 'export-qr') {
        return wrap(
            <>
                <p className={styles.successTitle}>
                    {active.status === 'finalized'
                        ? 'Signed transaction ready to broadcast'
                        : stepLabel || 'Export signing data'}
                </p>
                <p className={styles.hint}>
                    {active.status === 'finalized'
                        ? 'Scan this animated QR in a wallet that can broadcast the signed transaction.'
                        : 'Show this animated QR to a cosigner. Each frame is part of the signing request, and the cosigner\'s wallet reassembles it.'}
                </p>
                {exportData?.link ? (
                    <section className={styles.signingLinkBlock}>
                        <Input
                            label={t('multisig.signingLink.label')}
                            help={t('multisig.signingLink.labelHelp')}
                            value={exportData.link}
                            readOnly
                        />
                        <div className={styles.actions}>
                            <Button variant="secondary" onClick={handleCopyLink}>
                                {t('common.copy')}
                            </Button>
                            {typeof globalThis.navigator?.share === 'function' ? (
                                <Button variant="secondary" onClick={handleShareLink} icon={<Icon.ExternalLinkIcon />}>
                                    {t('multisig.signingLink.share')}
                                </Button>
                            ) : null}
                        </div>
                        {linkStatus ? <StatusMessage variant="status">{linkStatus}</StatusMessage> : null}
                    </section>
                ) : null}
                {exportFrames && exportFrames.error ? (
                    // Encode failure is derived from the current session's
                    // state (a memo, not a user action): no re-run fixes it,
                    // so the alert carries no recovery button. The user's
                    // path forward is Back to tracker + Cancel session.
                    <StatusMessage variant="error">{exportFrames.error}</StatusMessage>
                ) : exportFrames && Array.isArray(exportFrames) ? (
                    <AnimatedQrFrames
                        frames={exportFrames}
                        alt={active.status === 'finalized'
                            ? 'Signed transaction QR'
                            : 'Multisig signing request QR'}
                    />
                ) : (
                    <p className={styles.hint}>
                        Nothing to export from this status. {active.status === 'cancelled'
                            ? 'Session is cancelled.'
                            : active.status === 'ready-to-finalize'
                                ? 'Combine the cosigner replies you have collected, then finalize, before sharing the signed transaction.'
                                : 'Combine the cosigner replies collected so far to continue.'}
                    </p>
                )}
                {Array.isArray(exportFrames) ? (
                    <details>
                        <summary className={styles.hint}>Plain-text chunks (paste into the cosigner's wallet)</summary>
                        <Textarea
                            readOnly
                            aria-label="Signing data to copy"
                            value={exportFrames.join('\n')}
                            rows={6}
                            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
                        />
                    </details>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={() => setView('tracker')}>Back to Tracker</Button>
                </div>
            </>,
        );
    }

    if (view === 'sign-locally') {
        if (isWatcherMode) {
            return wrap(
                <>
                    <StatusMessage variant="status">
                        This watch-only wallet can coordinate the multisig session but cannot
                        add a local signature. Scan the request with a signer wallet instead.
                    </StatusMessage>
                    <div className={styles.actions}>
                        <Button variant="ghost" onClick={() => setView('tracker')}>Back to Tracker</Button>
                    </div>
                </>,
            );
        }
        return wrap(
            <>
                <p className={styles.successTitle}>Sign with my key</p>
                <p className={styles.hint}>
                    {stepLabel || 'Contribute the local cosigner\'s signature for this session.'}
                </p>
                {/* Same wording the hardware signers throw (#5082): the screen
                    and the device error must not describe the limit two ways. */}
                <p className={styles.hint}>
                    Your wallet password unlocks the key this app holds so it can
                    add your signature. A key kept on a hardware device cannot
                    co-sign shared wallets yet. Update the device, or sign with
                    this wallet's built-in signer.
                </p>
                <Input
                    id="multisig-sign-password"
                    type="password"
                    aria-label="Wallet password"
                    value={signPassword}
                    onChange={(e) => setSignPassword(e.target.value)}
                    placeholder="Wallet password"
                    autoComplete="current-password"
                />
                {signResult ? <p className={styles.hint}>{signResult}</p> : null}
                {error ? <StatusMessage variant="error" recovery={errorRecovery}>{error}</StatusMessage> : null}
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={() => { setSignPassword(''); setView('tracker'); }}>
                        Back to Tracker
                    </Button>
                    <Button variant="primary" onClick={handleSignLocally} loading={busy}>
                        Sign with My Key
                    </Button>
                </div>
            </>,
            null,
            signErrors,
        );
    }

    if (view === 'paste-inbox') {
        return wrap(
            <>
                <p className={styles.successTitle}>Scan cosigner reply</p>
                <p className={styles.hint}>
                    Scan the cosigner's animated QR with your camera, or paste
                    each XCW chunk on its own line. The wallet reassembles the
                    {isMusig2 && active.status === 'collecting-sigs'
                        ? ' partial signature, checks that it belongs to this session and step, and applies it.'
                        : ' reply, checks that it belongs to this session and step, and applies it.'}
                </p>
                {scannerOpen ? (
                    <QrScanner onFrame={handleScannerFrame} alt="Cosigner reply QR scanner" />
                ) : null}
                <Textarea
                    id="multisig-reply-chunks"
                    label="Cosigner reply chunks"
                    help="The cosigner's reply as XCW text, one chunk per line. The camera button fills this in from their QR."
                    aria-label="Cosigner reply chunks"
                    value={pasteInput}
                    onChange={(e) => setPasteInput(e.target.value)}
                    rows={6}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
                    fieldAction={(
                        <FieldIconButton
                            icon={<Icon.QrCodeIcon />}
                            label={scannerOpen ? 'Stop scanner' : 'Scan with camera'}
                            aria-pressed={scannerOpen}
                            onClick={() => setScannerOpen((v) => !v)}
                            disabled={busy}
                        />
                    )}
                />
                <p className={styles.hint}>
                    Frames received: {collectorState.receivedCount} of{' '}
                    {collectorState.total ?? '?'}
                </p>
                {pasteResult ? <p className={styles.hint}>{pasteResult}</p> : null}
                {error ? <StatusMessage variant="error" recovery={errorRecovery}>{error}</StatusMessage> : null}
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={() => { setScannerOpen(false); setView('tracker'); }} disabled={busy}>
                        Back to Tracker
                    </Button>
                    <Button variant="danger" onClick={resetCollector} disabled={busy}>
                        Clear Received Reply
                    </Button>
                    <Button variant="primary" onClick={handlePasteSubmit} loading={busy}>
                        Submit Chunks
                    </Button>
                </div>
            </>,
            null,
            pasteErrors,
        );
    }

    const nonceCount = distinctContributionCount(active, active.nonces);
    const signatureCount = distinctContributionCount(
        active,
        isMusig2 ? active.partialSigs : active.signatures,
    );
    const canAggregate =
        isMusig2 && (
            (active.status === 'collecting-nonces'
                && nonceCount >= active.threshold)
            || (active.status === 'collecting-sigs'
                && signatureCount >= active.threshold
                && !!active.aggNonce));
    const canFinalize = active.status === 'ready-to-finalize'
        && signatureCount >= active.threshold;
    const isTerminal = ['cancelled', 'broadcast'].includes(active.status);
    const readiness = active.status === 'finalized'
        ? 'This signed transaction is ready to broadcast.'
        : active.status === 'broadcast'
            ? `Broadcast complete${active.txid ? `: ${active.txid}` : '.'}`
            : canFinalize
                ? 'Required signatures are collected. The transaction must be finalized before it can be broadcast.'
                : null;

    // The session's actions as one list (G101). Export, Import and Sign open
    // their step views; Cancel runs at once and is the red row.
    const importsPartial = isMusig2 && active.status === 'collecting-sigs';
    const actionRows = [
        !isTerminal && Array.isArray(exportFrames) ? (
            <ActionListItem
                key="export"
                icon={<Icon.ShareIcon />}
                title={active.status === 'finalized' ? 'Export signed transaction' : 'Export signing request'}
                description={active.status === 'finalized'
                    ? 'Show the QR a wallet scans to broadcast it'
                    : 'Show the QR and link a cosigner scans to sign'}
                onClick={() => setView('export-qr')}
                disabled={busy}
            />
        ) : null,
        canCollect ? (
            <ActionListItem
                key="import"
                icon={<Icon.ScanIcon />}
                title={importsPartial ? 'Import partial signature' : 'Import cosigner reply'}
                description={importsPartial
                    ? "Scan or paste a cosigner's step 2 signature"
                    : "Scan or paste a cosigner's reply"}
                onClick={() => { resetCollector(); setView('paste-inbox'); }}
                disabled={busy}
            />
        ) : null,
        canCollect && !isWatcherMode ? (
            <ActionListItem
                key="sign"
                icon={<Icon.SignIcon />}
                title="Sign with my key"
                description="Add this wallet's signature with your password"
                onClick={() => { setSignResult(null); setView('sign-locally'); }}
                disabled={busy}
            />
        ) : null,
        !isTerminal ? (
            <ActionListItem
                key="cancel"
                icon={<Icon.XIcon />}
                tone="danger"
                title="Cancel session"
                description={canceling ? 'Cancelling the session…' : 'Close this session and stop collecting signatures'}
                onClick={handleCancel}
                disabled={busy}
            />
        ) : null,
    ].filter(Boolean);

    // The flow's next step (Combine, Finalize or Broadcast) stays the one
    // green main button above the list, as a form's submit does (G20, G50):
    // each status shows at most one of them.
    let mainButton = null;
    if (canAggregate && !isTerminal) {
        mainButton = (
            <Button variant="primary" block onClick={handleAggregate} loading={busy && !canceling} disabled={busy} icon={<Icon.MultisigIcon />}>
                Combine Replies
            </Button>
        );
    } else if (active.status === 'ready-to-finalize') {
        mainButton = (
            <Button variant="primary" block onClick={handleFinalize} loading={busy && !canceling} icon={<Icon.CheckIcon />}>
                Finalize Transaction
            </Button>
        );
    } else if (active.status === 'finalized') {
        mainButton = (
            <Button variant="primary" block onClick={handleBroadcast} loading={busy && !canceling} disabled={busy}>
                Broadcast Transaction
            </Button>
        );
    }
    const actionCount = actionRows.length + (mainButton ? 1 : 0);

    const actionsPanel = (
        <>
            {mainButton}
            {actionRows.length > 0 ? <ActionList>{actionRows}</ActionList> : null}
            {!isTerminal && isWatcherMode ? (
                <p className={styles.hint}>
                    Watcher mode exports signing data but never asks for a password or adds a local signature.
                </p>
            ) : null}
        </>
    );

    // Details: who has replied or signed, who is pending, and each MuSig2 step's count.
    const detailsPanel = (
        <>
            {isMusig2 ? (
                <p className={styles.hint}>
                    Step 1: Cosigners responded: {nonceCount} of {active.threshold}
                    {active.aggNonce ? ' (combined)' : ''}
                    <br />
                    Step 2: Signatures collected: {signatureCount} of {active.threshold}
                    {active.aggregatedSchnorrSig ? ' (combined)' : ''}
                </p>
            ) : null}
            {contributed.length > 0 ? (
                <>
                    <p className={styles.hint}>{isResponseStep ? 'Responded cosigners:' : 'Signed cosigners:'}</p>
                    <ul aria-label={isResponseStep ? 'Responded cosigners' : 'Signed cosigners'}>
                        {contributed.map((pk) => (
                            <li key={pk}>{cosignerNameLine(active, pk)}<code className={styles.cosignerKey}>{pk}</code></li>
                        ))}
                    </ul>
                </>
            ) : (
                <p className={styles.hint}>{isResponseStep ? 'No cosigners have replied yet.' : 'No cosigners have signed yet.'}</p>
            )}
            {unsigned.length > 0 ? (
                <>
                    <p className={styles.hint}>{remaining > 0 ? 'Pending cosigners:' : 'Cosigners who have not signed:'}</p>
                    <ul aria-label={remaining > 0 ? 'Pending cosigners' : 'Cosigners who have not signed'}>
                        {unsigned.map((pk) => (
                            <li key={pk}>{cosignerNameLine(active, pk)}<code className={styles.cosignerKey}>{pk}</code></li>
                        ))}
                    </ul>
                </>
            ) : (
                <p className={styles.hint}>All cosigners have contributed.</p>
            )}
            {stepLabel ? (
                <p className={styles.hint} data-testid="multisig-step-label">{stepLabel}</p>
            ) : null}
        </>
    );

    return wrap(
        <>
            <p
                className={styles.successTitle}
                aria-label="Multisig signing progress"
            >
                {summary?.label}: {summary?.current} of {summary?.threshold}
            </p>
            <p className={styles.hint}>
                <MultisigBadge
                    threshold={active.threshold}
                    cosignerCount={active.cosignerPubkeys.length}
                    scheme={active.scheme}
                />
                {' · '}{statusLabel(active.status)}
            </p>
            {active.actionSummary ? (
                <p className={styles.hint}>{active.actionSummary}</p>
            ) : null}
            {decodedSpend ? (
                <section aria-label="Transaction outputs" data-testid="multisig-spend-summary">
                    <p className={styles.hint}>Transaction outputs</p>
                    <ul>
                        {decodedSpend.outputs.map((output, index) => {
                            const isChange = output.scriptPubKeyHex === decodedSpend.input.scriptPubKeyHex;
                            const coin = String(active.chainId || '').split('-')[0];
                            return (
                                <li key={`${output.scriptPubKeyHex}:${index}`}>
                                    <code>{output.address || outputAddress(output.scriptPubKeyHex, active.chainId) || output.scriptPubKeyHex}</code>
                                    {' '}{formatWithThousands(formatNativeBaseUnits(output.value, coin))} {tickerForCoin(coin)}
                                    {isChange ? ' (Change back to this multisig)' : ''}
                                </li>
                            );
                        })}
                    </ul>
                    <p className={styles.hint}>
                        Network fee: {formatWithThousands(formatNativeBaseUnits(
                            decodedSpend.input.amount
                                - decodedSpend.outputs.reduce((sum, output) => sum + output.value, 0n),
                            String(active.chainId || '').split('-')[0],
                        ))}{' '}
                        {tickerForCoin(String(active.chainId || '').split('-')[0])}
                    </p>
                </section>
            ) : null}
            {readiness ? <p className={styles.hint}>{readiness}</p> : null}
            {!isTerminal ? (
                <p className={styles.hint} aria-label="Signatures remaining">
                    {remaining === 0
                        ? (isResponseStep ? 'Required step 1 replies collected.' : 'Required signatures collected.')
                        : `${remaining} more ${isResponseStep
                            ? `cosigner ${remaining === 1 ? 'reply' : 'replies'}`
                            : remaining === 1 ? 'signature' : 'signatures'} required.`}
                </p>
            ) : null}
            {error ? <StatusMessage variant="error" recovery={errorRecovery}>{error}</StatusMessage> : null}
            {/* More than one action: the Actions | Details toggle, Actions
                first (G102). One action or none (a cancelled or broadcast
                session): the plain layout, actions then facts. */}
            {actionCount > 1 ? (
                <ActionsDetailsToggle actions={actionsPanel} details={detailsPanel} />
            ) : (
                <>
                    {actionsPanel}
                    {detailsPanel}
                </>
            )}
            {/* Back to the list is the page's step-back, not an action row. */}
            <div className={styles.actions}>
                <Button variant="ghost" onClick={() => setActiveId(null)} disabled={busy}>
                    Back to Sessions
                </Button>
            </div>
        </>,
        null,
        trackerErrors,
    );
}

function shortPk(pk) {
    if (typeof pk !== 'string' || pk.length < 12) return pk;
    return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
}

// A cosigner's display name above its key, when the session record names
// its cosigners (the demo wallet's sample sessions do).
function cosignerNameLine(session, pk) {
    const name = session?.cosignerNames?.[pk];
    return typeof name === 'string' && name ? <span className={listStyles.cosignerName}>{name}</span> : null;
}

const SIGNING_LINK_FIELD_ID = 'multisig-signing-link';

/**
 * The Open Signing Link page: its own page under the sessions list, with
 * the link field (paste, or scan with the field's QR button) and the action
 * that opens the session the link carries. Pressing it with an empty field
 * or a link that is not a signing request marks the field (form error
 * standard); Back returns to the list.
 *
 * @param {object} props
 * @param {string} props.variant
 * @param {string} props.initialValue
 * @param {boolean} props.autoOpen  open `initialValue` at once (a link handed to the page)
 * @param {boolean} props.busy
 * @param {ReturnType<typeof useDemoGuard>} props.demoGuard
 * @param {() => void} props.onBack
 * @param {(text: string) => Promise<{ field: boolean, message: string } | null>} props.onOpen
 */
function OpenSigningLinkPage({ variant, initialValue, autoOpen, busy, demoGuard, onBack, onOpen }) {
    const formErrors = useFormErrors();
    const [value, setValue] = useState(initialValue || '');
    const [scannerOpen, setScannerOpen] = useState(false);
    const autoOpenedRef = useRef(false);

    const submit = useCallback(async (text) => {
        const link = String(text || '').trim();
        if (!formErrors.validate({ [SIGNING_LINK_FIELD_ID]: link ? null : t('multisig.signingLink.required') })) return;
        const outcome = await onOpen(link);
        if (!outcome) return;
        if (outcome.field) formErrors.validate({ [SIGNING_LINK_FIELD_ID]: outcome.message });
        else formErrors.fail(outcome.message);
    }, [formErrors, onOpen]);

    useEffect(() => {
        if (!autoOpen || autoOpenedRef.current || !initialValue) return;
        autoOpenedRef.current = true;
        void submit(initialValue);
    }, [autoOpen, initialValue, submit]);

    return (
        <Screen
            variant={variant}
            header={<PageHeader nested onBack={onBack} title={t('multisig.signingLink.open')} />}
        >
            <FormPage
                errors={formErrors}
                demoGuard={demoGuard}
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit(value);
                }}
                actions={(
                    <Button type="submit" variant="primary" icon={<Icon.LinkIcon />} loading={busy}>
                        {t('multisig.signingLink.open')}
                    </Button>
                )}
            >
                {scannerOpen ? (
                    <QrScanner
                        onFrame={(text) => {
                            setScannerOpen(false);
                            setValue(text);
                            void submit(text);
                        }}
                        alt={t('multisig.signingLink.scan')}
                    />
                ) : null}
                <Input
                    id={SIGNING_LINK_FIELD_ID}
                    label={t('multisig.signingLink.openLabel')}
                    help={t('multisig.signingLink.openHint')}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    autoComplete="off"
                    fieldAction={(
                        <FieldIconButton
                            icon={<Icon.QrCodeIcon />}
                            label={scannerOpen ? t('multisig.signingLink.stopScan') : t('multisig.signingLink.scan')}
                            aria-pressed={scannerOpen}
                            onClick={() => setScannerOpen((open) => !open)}
                            disabled={busy}
                        />
                    )}
                />
            </FormPage>
        </Screen>
    );
}

/**
 * Start a signing session from the sessions page: pick the multisig (on a
 * Bitcoin network), then the action, which opens that action's normal form
 * with the multisig as From. The form creates the session on confirm, the
 * same path Send takes when its source is a multisig. Send is the only
 * multisig action today.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.variant
 * @param {() => void} props.onCancel
 * @param {(sessionId?: string) => void} props.onSessionStarted
 */
function SessionStartFlow({ walletId, variant, onCancel, onSessionStarted }) {
    const { messaging } = useMessaging();
    const btcChainIds = useMemo(() => chainRegistry.byCoin(MULTISIG_COIN).map((d) => d.id), []);
    const [chainIds, setChainIds] = useState(/** @type {string[] | null} */ (null));
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [multisigs, setMultisigs] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [picked, setPicked] = useState(/** @type {any | null} */ (null));
    const [step, setStep] = useState(/** @type {'multisig' | 'action' | 'send'} */ ('multisig'));

    // Offer the Bitcoin networks the wallet holds addresses on, as Create
    // multisig does; every Bitcoin network when the address read fails.
    useEffect(() => {
        let cancelled = false;
        Promise.resolve(typeof messaging.getAddressesByChain === 'function'
            ? messaging.getAddressesByChain(walletId)
            : null)
            .catch(() => null)
            .then((byChain) => {
                if (cancelled) return;
                const held = byChain
                    ? btcChainIds.filter((cid) => Array.isArray(byChain[cid]) && byChain[cid].length > 0)
                    : [];
                const offered = held.length > 0 ? held : btcChainIds;
                setChainIds(offered);
                setChainId((current) => current || offered[0] || null);
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, btcChainIds]);

    useEffect(() => {
        if (!chainId) return undefined;
        let cancelled = false;
        setMultisigs(null);
        setLoadError(null);
        Promise.resolve(messaging.listMultisigReceiveAddresses({ walletId, chainId }))
            .then((rows) => { if (!cancelled) setMultisigs(Array.isArray(rows) ? rows : []); })
            .catch((err) => {
                if (cancelled) return;
                setMultisigs([]);
                setLoadError(userFacingMessage(err, t('multisig.start.loadFailed')));
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging]);

    // Every step of starting a session sits inside the sessions page, so
    // each Back steps in place.
    const screenFor = (title, onBack, children) => (
        <Screen variant={variant} header={<PageHeader nested onBack={onBack} title={title} />}>
            <ListPage>{children}</ListPage>
        </Screen>
    );

    if (step === 'send' && picked) {
        return (
            <MultisigSendForm
                walletId={walletId}
                chainId={chainId}
                multisigConfigId={picked.multisigConfigId}
                multisig={picked}
                onSessionStarted={onSessionStarted}
                onChangeSource={() => setStep('multisig')}
                wrapPage={(page) => (
                    <Screen variant={variant} header={<PageHeader nested onBack={() => setStep('action')} title={t('multisig.start.sendTitle')} />}>
                        {page}
                    </Screen>
                )}
            />
        );
    }

    if (step === 'action' && picked) {
        return screenFor(t('multisig.start.pickActionTitle'), () => setStep('multisig'), (
            <ul className={listStyles.rows} aria-label={t('multisig.start.actionsLabel')}>
                <li>
                    <ListRow
                        onClick={() => setStep('send')}
                        chevron
                        leading={<Icon.SendIcon />}
                        title={t('multisig.start.actionSend')}
                        subtitle={t('multisig.start.actionSendHint')}
                    />
                </li>
            </ul>
        ));
    }

    return screenFor(t('multisig.start.pickMultisigTitle'), onCancel, (
        <>
            {chainIds && chainIds.length > 1 ? (
                <NetworkField
                    value={chainId}
                    onChange={(value) => { setPicked(null); setChainId(value); }}
                    chainIds={chainIds}
                    chainRegistry={chainRegistry}
                    help={t('multisig.start.networkHelp')}
                />
            ) : null}
            {loadError ? <StatusMessage variant="error">{loadError}</StatusMessage> : null}
            {!multisigs ? (
                <p className={styles.hint}>{t('multisig.start.loading')}</p>
            ) : multisigs.length === 0 && !loadError ? (
                <EmptyState
                    title={t('multisig.start.emptyTitle')}
                    body={t('multisig.start.emptyBody')}
                />
            ) : (
                <ul className={listStyles.rows} aria-label={t('multisig.start.listLabel')}>
                    {multisigs.map((entry) => {
                        const spendable = Boolean(entry.address) && !entry.overCeiling;
                        return (
                            <li key={entry.multisigConfigId}>
                                <ListRow
                                    onClick={spendable ? () => { setPicked(entry); setStep('action'); } : undefined}
                                    chevron={spendable}
                                    title={t('multisig.sessions.type', {
                                        threshold: entry.threshold,
                                        count: entry.cosignerCount,
                                        scheme: SCHEME_WORDS[entry.scheme] || '',
                                    }).trim()}
                                    subtitle={spendable
                                        ? <AddressText address={entry.address} />
                                        : t('multisig.start.noAddress')}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    ));
}
