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
import { Screen, PageHeader, Button, EmptyState, FieldIconButton, Input, ListPage, ListRow, AnimatedQrFrames, MultisigBadge, QrScanner, StatusMessage, Textarea, Icon } from '@xchain-wallet/core/ui';
import { flows as flowsLib, schemas, uri as uriLib } from '@xchain-wallet/core';
import { formatNativeBaseUnits, tickerForCoin } from '../../registry/coinTicker.js';
import { ADDRESS_PARAMS } from '../utils/addressValidation.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { withAutoLockHold } from '../hooks/autoLockGuard.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { copyText } from '../clipboard.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/multisig.js';
import styles from './IssueTokenForm.module.css';

const { progressSummary } = schemas.multisigSigningSession;
const base58 = base58check(sha256);
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
    const { messaging, shell } = useMessaging();
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
    const [linkInput, setLinkInput] = useState(initialLink || '');
    const [linkStatus, setLinkStatus] = useState(/** @type {string | null} */ (null));
    const listRequestId = useRef(0);
    const activeRequestId = useRef(0);
    const mountedRef = useRef(false);
    const initialLinkRef = useRef(null);

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

    const importSigningLink = useCallback(async (text) => {
        if (busy || typeof text !== 'string' || text.trim().length === 0) return;
        setBusy(true);
        setError(null);
        setLinkStatus(null);
        try {
            const envelope = parseMultisigSessionLink(text);
            const result = await withAutoLockHold(() => messaging.importMultisigSigningRequest({
                walletId,
                envelope,
            }));
            if (!result?.sessionId) throw new Error(t('multisig.signingLink.openFailed'));
            setActiveId(result.sessionId);
            setView('tracker');
            await refreshList();
        } catch (err) {
            if (err?.userFacing !== true) {
                console.error('Multisig signing link import failed:', err); // eslint-disable-line no-console
            }
            fail(userFacingMessage(err, t('multisig.signingLink.openFailed')), null);
        } finally {
            setBusy(false);
        }
    }, [busy, messaging, walletId, refreshList, fail]);

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

    useEffect(() => {
        if (!initialLink || initialLinkRef.current === initialLink) return;
        initialLinkRef.current = initialLink;
        void importSigningLink(initialLink);
    }, [initialLink, importSigningLink]);

    async function handleAggregate() {
        if (!active || busy) return;
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
        if (!active || busy) return;
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
        if (!active || busy || !hasFinalizationThreshold(active)) return;
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
        if (!active || busy) return;
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
    }

    // Camera scanner frame handler: each detected QR string goes
    // through the same collector the paste path uses, so whichever
    // transport completes the envelope first wins. Once the collector
    // completes we dispatch via the existing submit path so UX is
    // identical.
    const handleScannerFrame = useCallback(async (text) => {
        if (!active || busy) return;
        let next = addChunkToCollector(collectorState, text);
        if (next === collectorState) {
            // addChunkToCollector mutates the same object; re-check.
            next = { ...collectorState };
        }
        if (next.error) {
            fail(next.error, null);
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
            const recheck = REFUSED_REPLY_CODES.has(err?.code) ? null : await recheckReply(envelope, active.id);
            fail(recheck || userFacingMessage(err, 'Failed to apply scanned contribution.'), null);
        } finally {
            setBusy(false);
        }
    }, [active, busy, collectorState, messaging, refreshAfterAction, recheckReply, fail]);

    async function handleSignLocally() {
        if (!active || busy || signPassword.length === 0) return;
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
            fail(userFacingMessage(err, 'Local-signing failed.'), handleSignLocally);
        } finally {
            setBusy(false);
        }
    }

    async function handlePasteSubmit() {
        if (!active || busy) return;
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
                fail(state.error, null);
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
            fail(userFacingMessage(e, 'Failed to parse envelope.'), null);
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
                fail(userFacingMessage(err, 'Failed to apply contribution.'), null);
            } else {
                const recheck = await recheckReply(envelope, active.id);
                if (recheck) {
                    fail(recheck, null);
                } else {
                    fail(userFacingMessage(err, 'Failed to apply contribution.'), handlePasteSubmit);
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
        ? { label: 'Try again', onAction: retryRef.current }
        : undefined;

    const header = (
        <PageHeader
            onBack={() => (activeId ? setActiveId(null) : onBack())}
            title={activeId ? 'Multisig signing' : 'Multisig signing sessions'}
        />
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
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

    if (!sessions) {
        return wrap(<p className={styles.hint}>Loading sessions…</p>);
    }

    if (!activeId) {
        return wrap(
            <>
                <section className={styles.signingLinkBlock} aria-labelledby="open-signing-link-title">
                    <p id="open-signing-link-title" className={styles.successTitle}>
                        {t('multisig.signingLink.openTitle')}
                    </p>
                    <Input
                        label={t('multisig.signingLink.openLabel')}
                        help={t('multisig.signingLink.openHint')}
                        value={linkInput}
                        onChange={(event) => setLinkInput(event.target.value)}
                        autoComplete="off"
                    />
                    <div className={styles.actions}>
                        <Button
                            variant="primary"
                            onClick={() => importSigningLink(linkInput)}
                            loading={busy}
                            disabled={linkInput.trim().length === 0}
                        >
                            {t('multisig.signingLink.open')}
                        </Button>
                    </div>
                    {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
                </section>
                {sessions.length === 0 && !error ? (
                <EmptyState
                    title="No signing sessions"
                    body="Multisig spending sessions for this wallet appear here."
                />
                ) : (
                    <ul
                        aria-label="Multisig sessions"
                        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }}
                    >
                        {sessions.map((s) => {
                            const summary = signingProgressSummary(s);
                            return (
                                <li key={s.id}>
                                    <ListRow
                                        onClick={() => setActiveId(s.id)}
                                        chevron
                                        title={(
                                            <MultisigBadge
                                                threshold={s.threshold}
                                                cosignerCount={s.cosignerPubkeys.length}
                                                scheme={s.scheme}
                                                size="sm"
                                            />
                                        )}
                                        subtitle={(
                                            <>
                                                {summary?.label}: {summary?.current} of {summary?.threshold}
                                                {' · '}{statusLabel(s.status)}
                                                {s.actionSummary ? <><br />{s.actionSummary}</> : null}
                                            </>
                                        )}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                )}
            </>,
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
                            value={exportData.link}
                            readOnly
                        />
                        <div className={styles.actions}>
                            <Button variant="secondary" onClick={handleCopyLink}>
                                {t('common.copy')}
                            </Button>
                            {typeof globalThis.navigator?.share === 'function' ? (
                                <Button variant="secondary" onClick={handleShareLink}>
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
                    <Button variant="ghost" onClick={() => setView('tracker')}>Back to tracker</Button>
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
                        <Button variant="ghost" onClick={() => setView('tracker')}>Back to tracker</Button>
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
                        Back to tracker
                    </Button>
                    <Button variant="primary" onClick={handleSignLocally} loading={busy} disabled={signPassword.length === 0}>
                        Sign with my key
                    </Button>
                </div>
            </>,
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
                    label="Cosigner reply chunks"
                    aria-label="Cosigner reply chunks"
                    value={pasteInput}
                    onChange={(e) => setPasteInput(e.target.value)}
                    rows={6}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
                    fieldAction={(
                        <FieldIconButton
                            icon={<Icon.ScanIcon />}
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
                        Back to tracker
                    </Button>
                    <Button variant="danger" onClick={resetCollector} disabled={busy}>
                        Clear received reply
                    </Button>
                    <Button variant="primary" onClick={handlePasteSubmit} loading={busy} disabled={pasteInput.trim().length === 0}>
                        Submit chunks
                    </Button>
                </div>
            </>,
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
            {isMusig2 ? (
                <p className={styles.hint}>
                    Step 1: Cosigners responded: {nonceCount} of {active.threshold}
                    {active.aggNonce ? ' (combined)' : ''}
                    <br />
                    Step 2: Signatures collected: {signatureCount} of {active.threshold}
                    {active.aggregatedSchnorrSig ? ' (combined)' : ''}
                </p>
            ) : null}
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
                                    {' '}{formatNativeBaseUnits(output.value, coin)} {tickerForCoin(coin)}
                                    {isChange ? ' (Change back to this multisig)' : ''}
                                </li>
                            );
                        })}
                    </ul>
                    <p className={styles.hint}>
                        Network fee: {formatNativeBaseUnits(
                            decodedSpend.input.amount
                                - decodedSpend.outputs.reduce((sum, output) => sum + output.value, 0n),
                            String(active.chainId || '').split('-')[0],
                        )}{' '}
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
            {contributed.length > 0 ? (
                <>
                    <p className={styles.hint}>{isResponseStep ? 'Responded cosigners:' : 'Signed cosigners:'}</p>
                    <ul aria-label={isResponseStep ? 'Responded cosigners' : 'Signed cosigners'}>
                        {contributed.map((pk) => (
                            <li key={pk}><code className={styles.cosignerKey}>{pk}</code></li>
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
                            <li key={pk}><code className={styles.cosignerKey}>{pk}</code></li>
                        ))}
                    </ul>
                </>
            ) : (
                <p className={styles.hint}>All cosigners have contributed.</p>
            )}
            {stepLabel ? (
                <p className={styles.hint} data-testid="multisig-step-label">{stepLabel}</p>
            ) : null}
            {error ? <StatusMessage variant="error" recovery={errorRecovery}>{error}</StatusMessage> : null}
            <div className={styles.actions}>
                <Button variant="ghost" onClick={() => setActiveId(null)} disabled={busy}>
                    Back to sessions
                </Button>
                {!isTerminal && Array.isArray(exportFrames) ? (
                    <Button variant="ghost" onClick={() => setView('export-qr')} disabled={busy}>
                        {active.status === 'finalized' ? 'Export signed transaction' : 'Export signing request'}
                    </Button>
                ) : null}
                {canCollect ? (
                    <Button variant="ghost" onClick={() => { resetCollector(); setView('paste-inbox'); }} disabled={busy}>
                        {isMusig2 && active.status === 'collecting-sigs'
                            ? 'Import partial signature'
                            : 'Import cosigner reply'}
                    </Button>
                ) : null}
                {canCollect && !isWatcherMode ? (
                    <Button variant="ghost" onClick={() => { setSignResult(null); setView('sign-locally'); }} disabled={busy}>
                        Sign with my key
                    </Button>
                ) : null}
                {!isTerminal && isWatcherMode ? (
                    <p className={styles.hint}>
                        Watcher mode exports signing data but never asks for a password or adds a local signature.
                    </p>
                ) : null}
                {!isTerminal ? (
                    <Button variant="danger" onClick={handleCancel} loading={canceling} disabled={busy}>
                        Cancel session
                    </Button>
                ) : null}
                {canAggregate && !isTerminal ? (
                    <Button variant="primary" onClick={handleAggregate} loading={busy && !canceling} disabled={busy}>
                        Combine replies
                    </Button>
                ) : null}
                {active.status === 'ready-to-finalize' ? (
                    <Button variant="primary" onClick={handleFinalize} loading={busy && !canceling} disabled={busy || !canFinalize}>
                        Finalize transaction
                    </Button>
                ) : null}
                {active.status === 'finalized' ? (
                    <Button variant="primary" onClick={handleBroadcast} loading={busy && !canceling} disabled={busy}>
                        Broadcast transaction
                    </Button>
                ) : null}
            </div>
        </>,
    );
}

function shortPk(pk) {
    if (typeof pk !== 'string' || pk.length < 12) return pk;
    return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
}
