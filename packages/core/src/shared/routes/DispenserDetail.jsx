import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Dispenser detail page — §40.7.1 management surface for a single
 * dispenser. Step 22a surfaces:
 *
 *   - Static metadata (rate, give/get coins + ticks, creator, memo,
 *     block + status) pulled via `dispensers.byActionIndex`.
 *   - Recent dispense events (fills) via `dispenses.query` with
 *     type='source' scoped to the dispenser's source address — the
 *     explorer doesn't yet have a by-dispenser-action-index dispense
 *     query.
 *   - For owners (source address is one of the wallet's addresses),
 *     a "Cancel dispenser" button that runs Step 21's v1 lane via
 *     `messaging.dispenserAction` with a password re-prompt.
 *
 * Live escrow balance + remaining-fills counts are deferred — the
 * indexer surface doesn't expose them yet (see xchain-explorer/src/
 * db.js getDispensers TODO).
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {() => void} [props.onCanceled]           called after a successful cancel broadcast
 */
export function DispenserDetail({ walletId, chainId, actionIndex, onBack, onCanceled }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [dispenser, setDispenser] = useState(/** @type {any | null} */ (null));
    const [action, setAction] = useState(/** @type {any | null} */ (null));
    const [dispenses, setDispenses] = useState(/** @type {any[]} */ ([]));
    const [ownerAddress, setOwnerAddress] = useState(
        /** @type {any | null} */ (null),
    );

    const [cancelStage, setCancelStage] = useState(
        /** @type {'idle' | 'confirm' | 'submitting' | 'done'} */ ('idle'),
    );
    const [password, setPassword] = useState('');
    const [cancelError, setCancelError] = useState(/** @type {string | null} */ (null));
    const [cancelResult, setCancelResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const descriptor = chainRegistry.get(chainId);

    // Load the dispenser action + wallet addresses (to detect ownership)
    // in parallel. Recent dispenses come on a best-effort basis —
    // failure there still lets the user see the dispenser metadata.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        Promise.all([
            messaging.getDispenserByActionIndex({ chainId, actionIndex })
                .then((resp) => (cancelled ? null : resp))
                .catch((err) => { if (!cancelled) throw err; }),
            messaging.getAddressesByChain(walletId)
                .then((byChain) => (cancelled ? null : byChain))
                .catch(() => null),
        ]).then(([resp, addrsByChain]) => {
            if (cancelled) return;
            const act = pickAction(resp);
            const disp = pickDispenser(resp);
            if (!act) {
                setLoadError('Action not found.');
                setLoading(false);
                return;
            }
            setAction(act);
            setDispenser(disp);

            const source = disp?.source || act?.source;
            if (source && addrsByChain) {
                const matches = (addrsByChain[chainId] || []).find((a) => a.address === source);
                if (matches) setOwnerAddress(matches);
            }
            setLoading(false);

            if (source) {
                messaging.getDispenses({ chainId, query: source, type: 'source' })
                    .then((d) => { if (!cancelled) setDispenses(extractRows(d)); })
                    .catch(() => { /* best-effort; detail still usable without dispenses */ });
            }
        }).catch((err) => {
            if (!cancelled) {
                setLoadError(err?.message || 'Failed to load dispenser.');
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [walletId, chainId, actionIndex, messaging]);

    useEffect(() => {
        if (cancelStage === 'confirm') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [cancelStage]);

    const cancelParams = useMemo(() => ({
        VERSION: '1',
        DISPENSER_ACTION_INDEX: String(actionIndex),
    }), [actionIndex]);

    const decodedCancel = useMemo(() => {
        if (cancelStage !== 'confirm' && cancelStage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'DISPENSER',
            params: cancelParams,
            chainId,
            chainRegistry,
        });
    }, [cancelStage, cancelParams, chainId]);

    async function handleCancel(event) {
        event.preventDefault();
        if (cancelStage === 'submitting' || password.length === 0 || !ownerAddress) return;
        setCancelStage('submitting');
        setCancelError(null);
        try {
            const res = await messaging.dispenserAction({
                walletId,
                password,
                chainId,
                from: {
                    address: ownerAddress.address,
                    publicKey: ownerAddress.publicKey,
                    derivationPath: ownerAddress.derivationPath,
                    addressId: ownerAddress.id,
                },
                params: cancelParams,
            });
            setCancelResult(res);
            setPassword('');
            setCancelStage('done');
            onCanceled?.();
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setCancelError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Cancel failed.',
            );
            setCancelStage('confirm');
            passwordRef.current?.focus();
            passwordRef.current?.select();
        }
    }

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                ← Back
            </button>
            <span className={styles.title}>
                {cancelStage === 'confirm' || cancelStage === 'submitting'
                    ? 'Confirm cancel'
                    : 'Dispenser detail'}
            </span>
            <span className={styles.spacer} />
        </div>
    );

    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loading) return wrap(<p className={styles.hint}>Loading…</p>);
    if (loadError) return wrap(<div role="alert" className={styles.error}>{loadError}</div>);

    if (cancelStage === 'done') {
        const txid = cancelResult?.txid || cancelResult?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Cancel submitted</h2>
                <p className={styles.hint}>
                    The dispenser enters a 1-hour close window before remaining escrow is released.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (cancelStage === 'confirm' || cancelStage === 'submitting') {
        return wrap(
            <form onSubmit={handleCancel} noValidate>
                <p className={styles.summary}>{decodedCancel?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={ownerAddress?.address || ''} />
                    </dd>
                    {(decodedCancel?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                </dl>
                {decodedCancel && decodedCancel.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {decodedCancel.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                <Input
                    ref={passwordRef}
                    type="password"
                    label="Password"
                    hint="Required to sign the cancel."
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        if (cancelError) setCancelError(null);
                    }}
                    autoComplete="current-password"
                    disabled={cancelStage === 'submitting'}
                    error={cancelError || undefined}
                />
                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setCancelStage('idle')}
                        disabled={cancelStage === 'submitting'}
                    >
                        Back
                    </Button>
                    <Button
                        type="submit"
                        variant="danger"
                        loading={cancelStage === 'submitting'}
                        disabled={password.length === 0}
                    >
                        Sign cancel
                    </Button>
                </div>
            </form>,
        );
    }

    const rate = rateLabel(dispenser);
    const source = dispenser?.source || action?.source;
    const dispAddress = dispenser?.address;
    const matchingDispenses = dispenses.filter(
        (d) => String(d.get_tick || dispenser?.get_tick) === String(dispenser?.get_tick)
            && String(d.give_tick || dispenser?.give_tick) === String(dispenser?.give_tick),
    );

    return wrap(
        <>
            <p className={styles.summary}>
                {dispenser?.give_tick ? `${dispenser.give_tick} Dispenser` : 'Dispenser'}
                {descriptor ? ` on ${descriptor.displayName}` : ''}
            </p>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Rate</dt>
                <dd className={styles.detailsValue}>{rate}</dd>
                {source ? (
                    <>
                        <dt className={styles.detailsLabel}>Creator</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={source} />
                            {ownerAddress ? ' (you)' : ''}
                        </dd>
                    </>
                ) : null}
                {dispAddress && dispAddress !== source ? (
                    <>
                        <dt className={styles.detailsLabel}>Dispenser address</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={dispAddress} />
                        </dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Status</dt>
                <dd className={styles.detailsValue}>{String(dispenser?.status || '—')}</dd>
                {dispenser?.block_index ? (
                    <>
                        <dt className={styles.detailsLabel}>Opened at block</dt>
                        <dd className={styles.detailsValue}>{dispenser.block_index}</dd>
                    </>
                ) : null}
                {dispenser?.memo ? (
                    <>
                        <dt className={styles.detailsLabel}>Memo</dt>
                        <dd className={styles.detailsValue}>{dispenser.memo}</dd>
                    </>
                ) : null}
                <dt className={styles.detailsLabel}>Action index</dt>
                <dd className={styles.detailsValue}>#{actionIndex}</dd>
            </dl>

            <p className={styles.hint}>
                Remaining escrow and dispense count aren't published by the indexer yet.
                Watch this surface for updates as the indexer fills in dispenser state.
            </p>

            {matchingDispenses.length > 0 ? (
                <section style={{ marginTop: '1rem' }}>
                    <p className={styles.successLabel}>Recent dispenses</p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {matchingDispenses.slice(0, 10).map((d) => (
                            <li key={String(d.action_index)} style={{ padding: '0.25rem 0' }}>
                                <code>#{d.action_index}</code>
                                {' '}
                                {d.give_amount ?? '?'} {d.give_tick || ''}
                                {' → '}
                                <AddressText address={d.destination || d.address || '?'} />
                                {d.status ? ` (${d.status})` : ''}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <div className={styles.actions}>
                <Button variant="ghost" onClick={onBack}>Back</Button>
                {ownerAddress ? (
                    <Button
                        variant="danger"
                        onClick={() => setCancelStage('confirm')}
                    >
                        Cancel dispenser
                    </Button>
                ) : null}
            </div>
        </>,
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}

function rateLabel(row) {
    if (!row) return '—';
    const give = `${row.give_amount ?? '?'} ${row.give_tick || '?'}`;
    const coin = row.get_coin || '';
    const tick = row.get_tick || '';
    const amt = row.get_amount ?? '?';
    const payAsset = tick || coin || '?';
    return `${give} per ${amt} ${payAsset}`;
}

function pickAction(resp) {
    if (!resp) return null;
    if (resp.action) return resp.action;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    return resp;
}

function pickDispenser(resp) {
    if (!resp) return null;
    if (resp.dispenser) return resp.dispenser;
    if (resp.data && resp.data.dispenser) return resp.data.dispenser;
    // Many explorer endpoints flatten DISPENSER fields onto the action.
    if (resp.give_tick || resp.get_amount) return resp;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    return null;
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}
