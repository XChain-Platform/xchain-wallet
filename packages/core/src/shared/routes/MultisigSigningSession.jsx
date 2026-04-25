import { useCallback, useEffect, useState } from 'react';
import { Screen, Button } from '@xchain-wallet/core/ui';
import { schemas } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const { progressSummary, pendingCosignerPubkeys } = schemas.multisigSigningSession;

/**
 * §22.3 + §42.9 multisig sign-screen tracker (Phase 4 Step 19).
 *
 * Dual-mode tracker:
 *   - **P2SH / P2WSH** track one round of classical ECDSA signatures
 *     under the redeem/witness script. The header reads
 *     "Signatures collected: 2 of 3" and finalize is reachable as
 *     soon as threshold is met.
 *   - **Taproot-MuSig2** tracks two rounds. Round 1 collects 66-byte
 *     publicNonces ("Nonces collected: 2 of 3"); once threshold is
 *     met the wallet aggregates them via `sdk.musig2.aggregateNonces`
 *     and the header switches to "Partial sigs collected: 2 of 3".
 *     Round 2 collects 32-byte partial sigs which are then aggregated
 *     into a single 64-byte Schnorr signature (BIP327) — on chain
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

    const refreshList = useCallback(async () => {
        try {
            const list = await messaging.listMultisigSigningSessions({ walletId });
            setSessions(Array.isArray(list) ? list : []);
        } catch (err) {
            setError(err?.message || 'Failed to load multisig sessions.');
            setSessions([]);
        }
    }, [walletId, messaging]);

    const refreshActive = useCallback(async (id) => {
        try {
            const session = await messaging.getMultisigSigningSession({ sessionId: id });
            setActive(session);
        } catch (err) {
            setError(err?.message || 'Failed to load session.');
        }
    }, [messaging]);

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
            setError(err?.message || 'Aggregate failed.');
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
            setError(err?.message || 'Cancel failed.');
        } finally {
            setBusy(false);
        }
    }

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={() => (activeId ? setActiveId(null) : onBack())}
                className={styles.back}
                aria-label="Back"
            >
                ← Back
            </button>
            <span className={styles.title}>
                {activeId ? 'Multisig signing' : 'Multisig signing sessions'}
            </span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (error && !active) {
        return wrap(
            <>
                <div role="alert" className={styles.error}>{error}</div>
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack}>Back</Button>
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
                        No multisig signing sessions for this wallet. A session is
                        created when a multisig spend is composed (§22.3); Step 20
                        wires the PSBT-QR transport that drives contributions.
                    </p>
                    <div className={styles.actions}>
                        <Button variant="ghost" onClick={onBack}>Back</Button>
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
                                    <span className={styles.rowTitle}>{schemeLabel(s)}</span>
                                    <span className={styles.rowMeta}>
                                        {summary?.label}: {summary?.current} of {summary?.threshold}
                                        {' · '}{s.status}
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
                    <Button variant="ghost" onClick={onBack}>Back</Button>
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
                {schemeLabel(active)} · status: {active.status}
            </p>
            {isMusig2 ? (
                <p className={styles.hint}>
                    Round 1 — Nonces collected: {active.nonces.length} of {active.threshold}
                    {active.aggNonce ? ' (aggregated)' : ''}
                    <br />
                    Round 2 — Partial sigs collected: {active.partialSigs.length} of {active.threshold}
                    {active.aggregatedSchnorrSig ? ' (aggregated Schnorr signature ready)' : ''}
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
            {error ? <div role="alert" className={styles.error}>{error}</div> : null}
            <div className={styles.actions}>
                {canAggregate && !isTerminal ? (
                    <Button onClick={handleAggregate} disabled={busy}>
                        {busy ? 'Aggregating…' : 'Aggregate'}
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

function schemeLabel(s) {
    if (!s) return '';
    if (s.scheme === 'p2sh-multisig') return `${s.threshold}-of-${s.cosignerPubkeys.length} P2SH multisig`;
    if (s.scheme === 'p2wsh-multisig') return `${s.threshold}-of-${s.cosignerPubkeys.length} P2WSH multisig`;
    return `${s.threshold}-of-${s.cosignerPubkeys.length} Taproot-MuSig2`;
}
