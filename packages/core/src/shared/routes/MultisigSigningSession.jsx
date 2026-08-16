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
import { Screen, PageHeader, Button, Input, AnimatedQrFrames, MultisigBadge, QrScanner, StatusMessage , Icon} from '@xchain-wallet/core/ui';
import { schemas, uri as uriLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import styles from './IssueTokenForm.module.css';

const { progressSummary, pendingCosignerPubkeys } = schemas.multisigSigningSession;
const {
    encodeXcwChunks,
    createXcwCollector,
    addChunkToCollector,
    buildRequestEnvelope,
    buildFinalizedEnvelope,
    decodeMultisigEnvelope,
    encodeMultisigEnvelope,
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

/**
 * §22.3 + §42.9 multisig sign-screen tracker (Phase 4 Step 19).
 *
 * Dual-mode tracker:
 *   - **P2SH / P2WSH** track one round of classical ECDSA signatures
 *     under the redeem/witness script. The header reads
 *     "Signatures collected: 2 of 3" and finalize is reachable as
 *     soon as threshold is met.
 *   - **Taproot-MuSig2** tracks two rounds. Round 1 collects 66-byte
 *     publicNonces ("Cosigners responded: 2 of 3"); once threshold is
 *     met the wallet aggregates them via `sdk.musig2.aggregateNonces`
 *     and the header switches to "Signatures collected: 2 of 3".
 *     Round 2 collects 32-byte partial sigs which are then aggregated
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
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [sessions, setSessions] = useState(/** @type {any[] | null} */ (null));
    const [activeId, setActiveId] = useState(/** @type {string | null} */ (null));
    const [active, setActive] = useState(/** @type {any | null} */ (null));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [view, setView] = useState(/** @type {'tracker' | 'export-qr' | 'paste-inbox' | 'sign-locally'} */ ('tracker'));
    const [pasteInput, setPasteInput] = useState('');
    const [collectorState, setCollectorState] = useState(() => createXcwCollector());
    const [pasteResult, setPasteResult] = useState(/** @type {string | null} */ (null));
    const [scannerOpen, setScannerOpen] = useState(false);
    const [signPassword, setSignPassword] = useState('');
    const [signResult, setSignResult] = useState(/** @type {string | null} */ (null));

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
        try {
            const list = await messaging.listMultisigSigningSessions({ walletId });
            setSessions(Array.isArray(list) ? list : []);
        } catch (err) {
            console.error('Multisig sessions list failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Failed to load multisig sessions.'), refreshList);
            setSessions([]);
        }
    }, [walletId, messaging, fail]);

    const refreshActive = useCallback(async (id) => {
        try {
            const session = await messaging.getMultisigSigningSession({ sessionId: id });
            setActive(session);
        } catch (err) {
            console.error('Multisig session load failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Failed to load session.'), () => refreshActive(id));
        }
    }, [messaging, fail]);

    useEffect(() => {
        refreshList();
    }, [refreshList]);

    useEffect(() => {
        if (activeId) refreshActive(activeId);
    }, [activeId, refreshActive]);

    async function handleAggregate() {
        if (!active) return;
        setBusy(true);
        setError(null);
        try {
            await messaging.aggregateMultisigSession({ sessionId: active.id });
            await refreshActive(active.id);
            await refreshList();
        } catch (err) {
            console.error('Multisig aggregate failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Aggregate failed.'), handleAggregate);
        } finally {
            setBusy(false);
        }
    }

    async function handleCancel() {
        if (!active) return;
        setBusy(true);
        setError(null);
        try {
            await messaging.cancelMultisigSigningSession({ sessionId: active.id });
            await refreshActive(active.id);
            await refreshList();
        } catch (err) {
            console.error('Multisig cancel failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Cancel failed.'), handleCancel);
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
            const sessionRef = {
                scheme: active.scheme,
                threshold: active.threshold,
                cosignerPubkeys: active.cosignerPubkeys,
                msgHash: active.msgHash,
                psbtHex: active.psbtHex || '',
            };
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
            if (envelope.kind === 'multisig-round-1-reply') {
                await messaging.contributeMultisigNonce({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    publicNonceHex: envelope.contribution.publicNonce,
                });
                setPasteResult(`Round 1 reply from ${shortPk(envelope.contribution.pubkey)} scanned.`);
            } else if (envelope.kind === 'multisig-round-2-reply') {
                await messaging.contributeMultisigSignature({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    signatureHex: envelope.contribution.sig,
                });
                setPasteResult(`Round 2 partial sig from ${shortPk(envelope.contribution.pubkey)} scanned.`);
            } else if (envelope.kind === 'multisig-classical-reply') {
                await messaging.contributeMultisigSignature({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    signatureHex: envelope.contribution.sig,
                });
                setPasteResult(`ECDSA signature from ${shortPk(envelope.contribution.pubkey)} scanned.`);
            } else {
                fail(`Scanned envelope kind "${envelope.kind}" is not a cosigner reply.`, null);
            }
            await refreshActive(active.id);
            await refreshList();
            setCollectorState(createXcwCollector());
            setPasteInput('');
        } catch (err) {
            console.error('Multisig scanned contribution failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Failed to apply scanned contribution.'), null);
        } finally {
            setBusy(false);
        }
    }, [active, busy, collectorState, messaging, refreshActive, refreshList, fail]);

    async function handleSignLocally() {
        if (!active || signPassword.length === 0) return;
        setBusy(true);
        setError(null);
        setSignResult(null);
        try {
            const result = await messaging.signMultisigLocally({
                sessionId: active.id,
                password:  signPassword,
            });
            setSignResult(
                `Contributed ${result?.contributionKind || 'signature'} from ${shortPk(result?.pubkey || '')}.`,
            );
            setSignPassword('');
            await refreshActive(active.id);
            await refreshList();
        } catch (err) {
            console.error('Multisig local signing failed:', err); // eslint-disable-line no-console
            fail(userFacingMessage(err, 'Local-signing failed.'), handleSignLocally);
        } finally {
            setBusy(false);
        }
    }

    async function handlePasteSubmit() {
        if (!active) return;
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
            if (envelope.kind === 'multisig-round-1-reply') {
                await messaging.contributeMultisigNonce({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    publicNonceHex: envelope.contribution.publicNonce,
                });
                setPasteResult(`Round 1 reply from ${shortPk(envelope.contribution.pubkey)} accepted.`);
            } else if (envelope.kind === 'multisig-round-2-reply') {
                await messaging.contributeMultisigSignature({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    signatureHex: envelope.contribution.sig,
                });
                setPasteResult(`Round 2 partial sig from ${shortPk(envelope.contribution.pubkey)} accepted.`);
            } else if (envelope.kind === 'multisig-classical-reply') {
                await messaging.contributeMultisigSignature({
                    sessionId: active.id,
                    pubkey: envelope.contribution.pubkey,
                    signatureHex: envelope.contribution.sig,
                });
                setPasteResult(`ECDSA signature from ${shortPk(envelope.contribution.pubkey)} accepted.`);
            } else {
                fail(`Envelope kind "${envelope.kind}" is not a cosigner reply.`, null);
                setBusy(false);
                return;
            }
            await refreshActive(active.id);
            await refreshList();
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
            {isFull ? <div className={styles.card}>{children}</div> : children}
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
                <>
                    <p className={styles.hint}>
                        No multisig signing sessions for this wallet. A session
                        starts when you compose a multisig spend, and signers add
                        their contributions by scanning the transaction QR code.
                    </p>
                    <div className={styles.actions}>
                    </div>
                </>,
            );
        }
        return wrap(
            <>
                <p className={styles.hint}>Pick a session to inspect its contribution state.</p>
                <ul className={styles.list} aria-label="Multisig sessions">
                    {sessions.map((s) => {
                        const summary = progressSummary(s);
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

    const summary = progressSummary(active);
    const pending = pendingCosignerPubkeys(active);
    const isMusig2 = active.scheme === 'taproot-musig2';
    const roundLabel = isMusig2
        ? (active.status === 'collecting-nonces'
            ? 'Round 1: Collect cosigner replies'
            : (active.status === 'collecting-sigs'
                ? 'Round 2: Collect signatures'
                : null))
        : (active.status === 'collecting-sigs' ? 'Collect signatures' : null);

    if (view === 'export-qr') {
        return wrap(
            <>
                <p className={styles.successTitle}>
                    {roundLabel || (active.status === 'finalized' ? 'Finalized broadcast' : 'Export envelope')}
                </p>
                <p className={styles.hint}>
                    Show this animated QR to a cosigner's wallet. Each frame is
                    part of the signing data; the cosigner's wallet reassembles
                    the envelope on its side.
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
                        alt="Multisig transaction request envelope"
                    />
                ) : (
                    <p className={styles.hint}>
                        Nothing to export from this status. {active.status === 'cancelled'
                            ? 'Session is cancelled.'
                            : active.status === 'ready-to-finalize'
                                ? 'Aggregate the round, then finalize, before exporting the broadcast envelope.'
                                : 'Aggregate the current round to advance.'}
                    </p>
                )}
                {Array.isArray(exportFrames) ? (
                    <details>
                        <summary className={styles.hint}>Plain-text chunks (paste into the cosigner's wallet)</summary>
                        <textarea
                            readOnly
                            aria-label="Multisig envelope chunks"
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
        return wrap(
            <>
                <p className={styles.successTitle}>Sign with my key</p>
                <p className={styles.hint}>
                    {roundLabel || 'Contribute the local cosigner\'s signature for this session.'}
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
                />
                {signResult ? <p className={styles.hint}>{signResult}</p> : null}
                {error ? <StatusMessage variant="error" recovery={errorRecovery}>{error}</StatusMessage> : null}
                <div className={styles.actions}>
                    <Button onClick={handleSignLocally} disabled={busy || signPassword.length === 0}>
                        {busy ? 'Signing…' : 'Sign with my key'}
                    </Button>
                    <Button variant="ghost" onClick={() => { setSignPassword(''); setView('tracker'); }}>
                        Back to tracker
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
                    envelope, validates the fingerprint against this session,
                    and applies the contribution.
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
                    <Button
                        variant={scannerOpen ? 'ghost' : 'primary'}
                        onClick={() => setScannerOpen((v) => !v)}
                        disabled={busy}
                    >
                        {scannerOpen ? 'Stop scanner' : 'Scan with camera'}
                    </Button>
                    <Button onClick={handlePasteSubmit} disabled={busy || pasteInput.trim().length === 0}>
                        {busy ? 'Processing…' : 'Submit chunks'}
                    </Button>
                    <Button variant="ghost" onClick={resetCollector} disabled={busy}>
                        Reset collector
                    </Button>
                    <Button variant="ghost" onClick={() => { setScannerOpen(false); setView('tracker'); }}>
                        Back to tracker
                    </Button>
                </div>
            </>,
        );
    }

    const canAggregate =
        isMusig2 && (
            (active.status === 'collecting-nonces'
                && active.nonces.length >= active.threshold)
            || (active.status === 'collecting-sigs'
                && active.partialSigs.length >= active.threshold
                && !!active.aggNonce));
    const isTerminal = ['cancelled', 'broadcast'].includes(active.status);

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
                    Round 1: Cosigners responded: {active.nonces.length} of {active.threshold}
                    {active.aggNonce ? ' (aggregated)' : ''}
                    <br />
                    Round 2: Signatures collected: {active.partialSigs.length} of {active.threshold}
                    {active.aggregatedSchnorrSig ? ' (aggregated)' : ''}
                </p>
            ) : null}
            {active.actionSummary ? (
                <p className={styles.hint}>{active.actionSummary}</p>
            ) : null}
            {pending.length > 0 ? (
                <>
                    <p className={styles.hint}>Pending cosigners:</p>
                    <ul aria-label="Pending cosigners">
                        {pending.map((pk) => (
                            <li key={pk}><code>{pk}</code></li>
                        ))}
                    </ul>
                </>
            ) : (
                <p className={styles.hint}>All cosigners have contributed.</p>
            )}
            {roundLabel ? (
                <p className={styles.hint} data-testid="multisig-round-label">{roundLabel}</p>
            ) : null}
            {error ? <StatusMessage variant="error" recovery={errorRecovery}>{error}</StatusMessage> : null}
            <div className={styles.actions}>
                {canAggregate && !isTerminal ? (
                    <Button onClick={handleAggregate} disabled={busy}>
                        {busy ? 'Aggregating…' : 'Aggregate'}
                    </Button>
                ) : null}
                {!isTerminal && Array.isArray(exportFrames) ? (
                    <Button variant="ghost" onClick={() => setView('export-qr')}>
                        Export transaction QR
                    </Button>
                ) : null}
                {!isTerminal ? (
                    <Button variant="ghost" onClick={() => { resetCollector(); setView('paste-inbox'); }}>
                        Scan cosigner reply
                    </Button>
                ) : null}
                {!isTerminal ? (
                    <Button variant="ghost" onClick={() => { setSignResult(null); setView('sign-locally'); }}>
                        Sign with my key
                    </Button>
                ) : null}
                {!isTerminal ? (
                    <Button variant="ghost" onClick={handleCancel} disabled={busy}>
                        Cancel session
                    </Button>
                ) : null}
                <Button variant="ghost" onClick={() => setActiveId(null)}>
                    Back to sessions
                </Button>
            </div>
        </>,
    );
}

function shortPk(pk) {
    if (typeof pk !== 'string' || pk.length < 12) return pk;
    return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
}
