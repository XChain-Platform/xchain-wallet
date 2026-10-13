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
import { Screen, PageHeader, Button, EmptyState, Input, ListPage, AnimatedQrFrames, MultisigBadge, QrScanner, StatusMessage } from '@xchain-wallet/core/ui';
import { schemas, uri as uriLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import styles from './IssueTokenForm.module.css';

const { progressSummary } = schemas.multisigSigningSession;
const {
    encodeXcwChunks,
    createXcwCollector,
    addChunkToCollector,
    buildRequestEnvelope,
    buildFinalizedEnvelope,
    decodeMultisigEnvelope,
    encodeMultisigEnvelope,
    fingerprintSessionRef,
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
        scheme: session.scheme,
        threshold: session.threshold,
        cosignerPubkeys: session.cosignerPubkeys,
        msgHash: session.msgHash,
        psbtHex: session.psbtHex || '',
    };
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
 */
export function MultisigSigningSession({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const { isWatcherMode } = useWalletMode();
    const variant = screenVariantFor(shell);

    const [sessions, setSessions] = useState(/** @type {any[] | null} */ (null));
    const [activeId, setActiveId] = useState(/** @type {string | null} */ (null));
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
    const listRequestId = useRef(0);
    const activeRequestId = useRef(0);
    const mountedRef = useRef(false);

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
            await messaging.finalizeMultisigSigningSession({ sessionId: active.id });
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
            await messaging.finalizeMultisigSigningSession({
                sessionId: active.id,
                broadcast: true,
            });
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
    const exportFrames = useMemo(() => {
        if (!active) return null;
        try {
            const sessionRef = sessionRefFor(active);
            let envelope;
            if (active.scheme === 'taproot-musig2') {
                if (active.status === 'collecting-nonces') {
                    envelope = buildRequestEnvelope({
                        kind: 'multisig-request-nonce',
                        sessionRef,
                    });
                } else if (active.status === 'collecting-sigs' && active.aggNonce) {
                    envelope = buildRequestEnvelope({
                        kind: 'multisig-request-partial',
                        sessionRef,
                        aggNonceHex: active.aggNonce,
                    });
                } else if (active.status === 'finalized' && active.finalizedTxHex) {
                    envelope = buildFinalizedEnvelope({
                        sessionRef,
                        txHex: active.finalizedTxHex,
                        ...(active.txid ? { txid: active.txid } : {}),
                    });
                } else {
                    return null;
                }
            } else if (active.status === 'collecting-sigs') {
                envelope = buildRequestEnvelope({
                    kind: 'multisig-request-signature',
                    sessionRef,
                });
            } else if (active.status === 'finalized' && active.finalizedTxHex) {
                envelope = buildFinalizedEnvelope({
                    sessionRef,
                    txHex: active.finalizedTxHex,
                    ...(active.txid ? { txid: active.txid } : {}),
                });
            } else {
                return null;
            }
            return encodeXcwChunks(encodeMultisigEnvelope(envelope));
        } catch (e) {
            // Surface in the UI rather than crashing; sessions with
            // malformed state still let the user cancel them.
            console.error('Multisig QR envelope build failed:', e); // eslint-disable-line no-console
            return { error: userFacingMessage(e, 'Could not build the transaction QR for this session.') };
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
        try {
            const envelope = decodeMultisigEnvelope(next.psbt);
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
            fail(userFacingMessage(err, 'Failed to apply scanned contribution.'), null);
        } finally {
            setBusy(false);
        }
    }, [active, busy, collectorState, messaging, refreshAfterAction, fail]);

    async function handleSignLocally() {
        if (!active || busy || signPassword.length === 0) return;
        setBusy(true);
        setError(null);
        setSignResult(null);
        try {
            const result = await messaging.signMultisigLocally({
                sessionId: active.id,
                password:  signPassword,
            });
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
            fail(userFacingMessage(err, 'Failed to apply contribution.'), handlePasteSubmit);
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

    if (error && !active) {
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
        if (sessions.length === 0) {
            return wrap(
                <EmptyState
                    title="No signing sessions"
                    body="Multisig spending sessions for this wallet appear here."
                />,
            );
        }
        return wrap(
            <>
                <p className={styles.hint}>Pick a session to inspect its contribution state.</p>
                <ul className={styles.list} aria-label="Multisig sessions">
                    {sessions.map((s) => {
                        const summary = signingProgressSummary(s);
                        return (
                            <li key={s.id}>
                                <button
                                    type="button"
                                    className={styles.row}
                                    onClick={() => setActiveId(s.id)}
                                >
                                    <span className={styles.rowTitle}>
                                        <MultisigBadge
                                            threshold={s.threshold}
                                            cosignerCount={s.cosignerPubkeys.length}
                                            scheme={s.scheme}
                                            size="sm"
                                        />
                                    </span>
                                    <span className={styles.rowMeta}>
                                        {summary?.label}: {summary?.current} of {summary?.threshold}
                                        {' · '}{statusLabel(s.status)}
                                    </span>
                                    {s.actionSummary
                                        ? <span className={styles.rowSubtle}>{s.actionSummary}</span>
                                        : null}
                                </button>
                            </li>
                        );
                    })}
                </ul>
                <div className={styles.actions}>
                </div>
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
                        <textarea
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
                <textarea
                    aria-label="Cosigner reply chunks"
                    value={pasteInput}
                    onChange={(e) => setPasteInput(e.target.value)}
                    rows={6}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
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
                    <Button
                        variant="secondary"
                        onClick={() => setScannerOpen((v) => !v)}
                        disabled={busy}
                    >
                        {scannerOpen ? 'Stop scanner' : 'Scan with camera'}
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
                            <li key={pk}><code>{pk}</code></li>
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
                            <li key={pk}><code>{pk}</code></li>
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
