import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

let nextRowId = 0;
const newRowId = () => `row-${++nextRowId}`;

/**
 * §42.8.2 Parallel cross-chain composer.
 *
 * Build a draft list of independent actions targeting any combination
 * of chains and submit them sequentially. Each row carries its own
 * `(chainId, fromAddressId, action, paramsJson)` and submits via the
 * existing §40.10 `advancedAction` core flow — Step 14 is mostly UX,
 * not a new submit primitive.
 *
 * The spec's key warning surfaces in Review: parallel actions are NOT
 * atomic. Each action signs and broadcasts independently; a failure
 * on row 2 does not roll back row 1. The composer requires the user
 * to acknowledge this before signing the first row.
 *
 * Sign loop. Software-signed rows reuse a single password entered
 * once at the top of the sign sequence; the password lives in
 * component state for the duration of the run and is cleared on
 * unmount or "Done." HW-signed rows prompt independently per row
 * (one signer-status block per row).
 *
 * Row status: `pending` → `submitting` → `success | failed`. Failed
 * rows can be retried in place; pending rows after a failure can be
 * skipped or re-attempted from the Review screen.
 *
 * Prefill (§42.8.4 templates). When `initialRows` is supplied the
 * composer seeds with those rows instead of one blank row. Each
 * prefill row carries a resolved `chainId` and a stringified
 * `paramsJson`; the composer treats them as ordinary rows from then
 * on (full edit / remove / re-order). Callers (CrossChainTemplates)
 * are responsible for resolving each template's `chainHint` to a
 * concrete chainId from the wallet's available chains.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {Array<{ chainId: string, action: string, params: Record<string, string>, note?: string }>} [props.initialRows]
 */
export function ParallelComposer({ walletId, onBack, initialRows }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [actionsList, setActionsList] = useState(/** @type {string[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [rows, setRows] = useState(/** @type {Row[]} */ ([]));
    const [acknowledgedNoRollback, setAcknowledgedNoRollback] = useState(false);
    const [stage, setStage] = useState(
        /** @type {'compose' | 'review' | 'signing' | 'done'} */ ('compose'),
    );
    const [activeRowIndex, setActiveRowIndex] = useState(0);
    const [password, setPassword] = useState('');
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            messaging.listActions({ chainId: getAnyChainId() }).catch(() => null),
        ])
            .then(([byChain, actions]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                if (Array.isArray(actions) && actions.length > 0) {
                    setActionsList(actions);
                } else {
                    // Conservative fallback list — covers the majority of
                    // §40.x and §42.x writes when SDK introspection fails.
                    setActionsList([
                        'SEND', 'ISSUE', 'MINT', 'DESTROY', 'BROADCAST',
                        'DISPENSER', 'DIVIDEND', 'AIRDROP', 'LIST',
                        'ORDER', 'SWAP', 'COINPAY', 'MESSAGE',
                        'LINK', 'STAKE', 'UNSTAKE', 'CLAIM_REWARDS',
                        'DELEGATE', 'REVOKE_DELEGATION',
                        'DEPLOY', 'EXECUTE', 'DEPOSIT', 'WITHDRAW',
                    ]);
                }
                const chains = Object.entries(byChain || {})
                    .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                    .map(([cid]) => cid);
                if (chains.length === 0) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before composing parallel actions.',
                    );
                    return;
                }
                // Seed rows: prefer the caller-supplied prefill (template
                // launch), otherwise drop a single blank row anchored to
                // the wallet's first chain.
                if (Array.isArray(initialRows) && initialRows.length > 0) {
                    setRows(initialRows.map((r) => ({
                        id: newRowId(),
                        chainId: r.chainId,
                        fromAddressId: pickDefaultAddressId(byChain[r.chainId] || []),
                        action: r.action,
                        paramsJson: JSON.stringify(r.params || {}, null, 2),
                        status: 'pending',
                        txid: null,
                        error: null,
                    })));
                } else {
                    setRows([blankRow(chains[0], byChain)]);
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load wallet.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const chainsWithAddresses = useMemo(() => {
        if (!addressesByChain) return [];
        return Object.entries(addressesByChain)
            .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
            .map(([cid]) => cid);
    }, [addressesByChain]);

    const updateRow = (index, patch) => {
        setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    };

    const addRow = () => {
        if (chainsWithAddresses.length === 0) return;
        setRows((rs) => [...rs, blankRow(chainsWithAddresses[0], addressesByChain)]);
    };

    const removeRow = (index) => {
        setRows((rs) => rs.filter((_, i) => i !== index));
    };

    const composeError = useMemo(() => {
        if (rows.length === 0) return 'Add at least one action.';
        for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            if (!r.chainId) return `Row ${i + 1}: pick a chain.`;
            if (!r.fromAddressId) return `Row ${i + 1}: pick a from-address.`;
            if (!r.action) return `Row ${i + 1}: pick an action.`;
            const parseErr = parseParamsJson(r.paramsJson);
            if (parseErr) return `Row ${i + 1}: ${parseErr}`;
        }
        return null;
    }, [rows]);

    const goReview = () => {
        if (composeError) return;
        setStage('review');
    };

    const startSigning = () => {
        if (!acknowledgedNoRollback) return;
        setStage('signing');
        setActiveRowIndex(rows.findIndex((r) => r.status !== 'success'));
    };

    const fromAddressFor = (row) => {
        if (!addressesByChain || !row?.fromAddressId || !row?.chainId) return null;
        return (addressesByChain[row.chainId] || []).find((a) => a.id === row.fromAddressId) || null;
    };

    const activeRow = rows[activeRowIndex] || null;
    const activeFromAddress = fromAddressFor(activeRow);
    const activeHw = isHwSource(activeFromAddress);

    async function signActiveRow() {
        if (!activeRow || !activeFromAddress) return;
        if (!activeHw && password.length === 0) return;
        if (activeHw && hwStatus !== 'available') return;

        updateRow(activeRowIndex, { status: 'submitting', error: null });
        try {
            const params = JSON.parse(activeRow.paramsJson || '{}');
            const base = {
                walletId,
                chainId: activeRow.chainId,
                from: {
                    address: activeFromAddress.address,
                    publicKey: activeFromAddress.publicKey,
                    derivationPath: activeFromAddress.derivationPath,
                    addressId: activeFromAddress.id,
                    source: activeFromAddress.source,
                    signerId: activeFromAddress.signerId,
                },
                action: activeRow.action,
                params,
            };
            const result = activeHw
                ? await messaging.advancedActionHw({ ...base, signerId: activeFromAddress.signerId })
                : await messaging.advancedAction({ ...base, password });
            updateRow(activeRowIndex, {
                status: 'success',
                txid: result?.txid || null,
                error: null,
            });
            // Advance to the next pending row, or wrap up.
            const nextIdx = rows.findIndex((r, i) => i > activeRowIndex && r.status !== 'success');
            if (nextIdx === -1) {
                setStage('done');
            } else {
                setActiveRowIndex(nextIdx);
            }
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            updateRow(activeRowIndex, {
                status: 'failed',
                error: bad ? 'Incorrect password.' : err?.message || 'Sign failed.',
            });
            if (!activeHw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    const allDoneOrSkipped = rows.every((r) => r.status === 'success' || r.status === 'skipped');

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
            <span className={styles.title}>Parallel cross-chain actions</span>
            <span className={styles.spacer} />
        </div>
    );

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
                    <Button variant="ghost" onClick={onBack}>Back</Button>
                </div>
            </>,
        );
    }

    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        return wrap(
            <>
                <p className={styles.successTitle}>Parallel run complete</p>
                <SummaryList rows={rows} />
                <p className={styles.hint}>
                    {allDoneOrSkipped
                        ? 'All rows broadcast. They will thread together in History via §23.5 if you LINK them in a follow-up action.'
                        : 'Some rows did not finish — return to the composer to retry the rest.'}
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'signing') {
        if (!activeRow) {
            // Defensive — should not happen because successful runs flip
            // to 'done', but render a finished state if we get here.
            return wrap(
                <>
                    <SummaryList rows={rows} />
                    <div className={styles.actions}>
                        <Button variant="primary" onClick={() => setStage('done')}>Continue</Button>
                    </div>
                </>,
            );
        }
        const remaining = rows.filter((r) => r.status !== 'success').length;
        const totalSucceeded = rows.length - remaining;
        return wrap(
            <>
                <p className={styles.summary}>
                    Signing action {activeRowIndex + 1} of {rows.length}
                    {' '}({totalSucceeded} signed, {remaining} remaining)
                </p>
                <RowDetail
                    row={activeRow}
                    addressesByChain={addressesByChain}
                />
                {activeFromAddress ? (
                    <SignCredentials
                        fromAddress={activeFromAddress}
                        chainId={activeRow.chainId}
                        password={password}
                        onPasswordChange={(v) => setPassword(v)}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={activeRow.error || null}
                        disabled={activeRow.status === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                ) : null}

                {activeRow.status === 'failed' && activeRow.error ? (
                    <p role="alert" className={styles.error}>{activeRow.error}</p>
                ) : null}

                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                            updateRow(activeRowIndex, { status: 'skipped', error: null });
                            const nextIdx = rows.findIndex(
                                (r, i) => i > activeRowIndex && r.status !== 'success',
                            );
                            if (nextIdx === -1) setStage('done');
                            else setActiveRowIndex(nextIdx);
                        }}
                        disabled={activeRow.status === 'submitting'}
                    >
                        Skip
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        loading={activeRow.status === 'submitting'}
                        disabled={!activeFromAddress
                            || (activeHw ? hwStatus !== 'available' : password.length === 0)}
                        onClick={signActiveRow}
                    >
                        {activeHw
                            ? `Sign on ${activeFromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : 'Sign'}
                    </Button>
                </div>
            </>,
        );
    }

    if (stage === 'review') {
        return wrap(
            <>
                <p className={styles.summary}>
                    {rows.length} action{rows.length === 1 ? '' : 's'} across{' '}
                    {new Set(rows.map((r) => r.chainId)).size} chain{new Set(rows.map((r) => r.chainId)).size === 1 ? '' : 's'}
                </p>
                <SummaryList rows={rows} />
                <div className={styles.warnings}>
                    <p className={styles.warning}>
                        Each action signs and broadcasts independently.
                        If row 2 fails after row 1 succeeds, row 1 is NOT
                        rolled back. Cross-chain atomicity is not a
                        protocol primitive — only individual SWAPs are
                        atomic.
                    </p>
                </div>
                <label className={styles.checkRow}>
                    <input
                        type="checkbox"
                        checked={acknowledgedNoRollback}
                        onChange={(e) => setAcknowledgedNoRollback(e.target.checked)}
                    />
                    <span>I understand parallel actions are not atomic.</span>
                </label>

                <div className={styles.actions}>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStage('compose')}
                    >
                        Back to composer
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        disabled={!acknowledgedNoRollback}
                        onClick={startSigning}
                    >
                        Sign all
                    </Button>
                </div>
            </>,
        );
    }

    // stage === 'compose'
    return wrap(
        <>
            <p className={styles.hint} style={{ textAlign: 'left' }}>
                Compose any number of independent actions on any combination of
                chains. Submitted via the existing Advanced action handler —
                each row is treated as its own ACTION; review the no-rollback
                warning before signing.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {rows.map((row, i) => (
                    <li key={row.id} style={{ marginBottom: 'var(--xc-space-3)' }}>
                        <RowEditor
                            index={i}
                            row={row}
                            chainIds={chainsWithAddresses}
                            addressesByChain={addressesByChain}
                            actionsList={actionsList}
                            onChange={(patch) => updateRow(i, patch)}
                            onRemove={() => removeRow(i)}
                            canRemove={rows.length > 1}
                        />
                    </li>
                ))}
            </ul>
            <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
                <Button type="button" variant="secondary" onClick={addRow}>
                    + Add action
                </Button>
            </div>
            {composeError ? (
                <p role="alert" className={styles.error}>{composeError}</p>
            ) : null}
            <div className={styles.actions}>
                <Button type="button" variant="ghost" onClick={onBack}>Back</Button>
                <Button
                    type="button"
                    variant="primary"
                    onClick={goReview}
                    disabled={Boolean(composeError)}
                >
                    Review
                </Button>
            </div>
        </>,
    );
}

function RowEditor({ index, row, chainIds, addressesByChain, actionsList, onChange, onRemove, canRemove }) {
    const descriptor = row.chainId ? chainRegistry.get(row.chainId) : null;
    const addrs = (addressesByChain && row.chainId) ? (addressesByChain[row.chainId] || []) : [];

    return (
        <fieldset style={{
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
            padding: 'var(--xc-space-3)',
            margin: 0,
            background: 'var(--xc-bg-muted)',
        }}>
            <legend style={{ fontWeight: 600, padding: '0 var(--xc-space-2)' }}>
                Row {index + 1}
            </legend>

            <label className={styles.pickerLabel}>
                <span>Chain</span>
                <select
                    className={styles.picker}
                    value={row.chainId || ''}
                    onChange={(e) => {
                        const cid = e.target.value;
                        const newAddrs = (addressesByChain[cid] || []);
                        onChange({
                            chainId: cid,
                            fromAddressId: pickDefaultAddressId(newAddrs),
                        });
                    }}
                >
                    {chainIds.map((cid) => {
                        const d = chainRegistry.get(cid);
                        return (
                            <option key={cid} value={cid}>
                                {d ? d.displayName : cid}
                            </option>
                        );
                    })}
                </select>
            </label>

            <label className={styles.pickerLabel}>
                <span>From address</span>
                <select
                    className={styles.picker}
                    value={row.fromAddressId || ''}
                    onChange={(e) => onChange({ fromAddressId: e.target.value })}
                >
                    {addrs.map((a) => (
                        <option key={a.id} value={a.id}>{a.address}</option>
                    ))}
                </select>
            </label>

            <label className={styles.pickerLabel}>
                <span>Action</span>
                <select
                    className={styles.picker}
                    value={row.action || ''}
                    onChange={(e) => onChange({ action: e.target.value })}
                >
                    <option value="">— Select —</option>
                    {actionsList.map((a) => (
                        <option key={a} value={a}>{a}</option>
                    ))}
                </select>
            </label>

            <label className={styles.pickerLabel} style={{ alignItems: 'stretch' }}>
                <span>Params (JSON object)</span>
                <textarea
                    className={styles.picker}
                    rows={4}
                    value={row.paramsJson}
                    onChange={(e) => onChange({ paramsJson: e.target.value })}
                    placeholder='{"VERSION":"0", ...}'
                    spellCheck={false}
                />
            </label>

            <div className={styles.actions} style={{ justifyContent: 'flex-end' }}>
                <Button
                    type="button"
                    variant="ghost"
                    onClick={onRemove}
                    disabled={!canRemove}
                >
                    Remove
                </Button>
            </div>

            {descriptor ? (
                <p className={styles.hint} style={{ textAlign: 'left', marginTop: 'var(--xc-space-2)' }}>
                    <ChainBadge descriptor={descriptor} size="sm" />
                </p>
            ) : null}
        </fieldset>
    );
}

function RowDetail({ row, addressesByChain }) {
    const descriptor = row.chainId ? chainRegistry.get(row.chainId) : null;
    const fromAddress = (addressesByChain[row.chainId] || []).find((a) => a.id === row.fromAddressId);
    return (
        <dl className={styles.detailsList}>
            <dt className={styles.detailsLabel}>Chain</dt>
            <dd className={styles.detailsValue}>
                {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : row.chainId}
            </dd>
            <dt className={styles.detailsLabel}>From</dt>
            <dd className={styles.detailsValue}>
                {fromAddress ? <AddressText address={fromAddress.address} /> : '—'}
            </dd>
            <dt className={styles.detailsLabel}>Action</dt>
            <dd className={styles.detailsValue}>{row.action}</dd>
            <dt className={styles.detailsLabel}>Params</dt>
            <dd className={styles.detailsValue} style={{ fontFamily: 'var(--xc-font-mono, monospace)', fontSize: 'var(--xc-text-xs)' }}>
                {row.paramsJson}
            </dd>
        </dl>
    );
}

function SummaryList({ rows }) {
    return (
        <ol style={{ paddingLeft: '1rem', margin: 'var(--xc-space-2) 0' }}>
            {rows.map((r, i) => {
                const d = r.chainId ? chainRegistry.get(r.chainId) : null;
                return (
                    <li key={r.id} style={{ margin: 'var(--xc-space-1) 0' }}>
                        <span style={{ fontWeight: 600 }}>{r.action || '—'}</span>
                        {' on '}
                        {d ? d.displayName : r.chainId}
                        {' — '}
                        <StatusPill status={r.status} />
                        {r.txid ? <> · <code style={{ fontSize: '0.75rem' }}>{shortenTxid(r.txid)}</code></> : null}
                        {r.error ? <> · <span style={{ color: '#b00' }}>{r.error}</span></> : null}
                    </li>
                );
            })}
        </ol>
    );
}

function StatusPill({ status }) {
    const label = {
        pending: 'pending',
        submitting: 'signing…',
        success: '✅ broadcast',
        failed: '⚠ failed',
        skipped: '↷ skipped',
    }[status] || status;
    return <span style={{ fontSize: '0.85em', color: 'var(--xc-text-muted)' }}>{label}</span>;
}

/** @typedef {{
 *   id: string,
 *   chainId: string,
 *   fromAddressId: string | null,
 *   action: string,
 *   paramsJson: string,
 *   status: 'pending' | 'submitting' | 'success' | 'failed' | 'skipped',
 *   txid: string | null,
 *   error: string | null,
 * }} Row
 */

function blankRow(chainId, addressesByChain) {
    const addrs = (addressesByChain && addressesByChain[chainId]) || [];
    return {
        id: newRowId(),
        chainId,
        fromAddressId: pickDefaultAddressId(addrs),
        action: '',
        paramsJson: '{\n  "VERSION": "0"\n}',
        status: 'pending',
        txid: null,
        error: null,
    };
}

function pickDefaultAddressId(addrs) {
    if (!Array.isArray(addrs) || addrs.length === 0) return null;
    const hd = addrs.filter(
        (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
    );
    const pool = hd.length > 0 ? hd : addrs;
    const sorted = [...pool].sort((a, b) => {
        const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
        const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
        return bi - ai;
    });
    return sorted[0].id;
}

function parseParamsJson(json) {
    if (typeof json !== 'string' || json.trim().length === 0) {
        return 'params JSON cannot be empty';
    }
    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return 'params must be a JSON object';
        }
        return null;
    } catch (err) {
        return `params JSON parse error: ${err?.message || String(err)}`;
    }
}

function getAnyChainId() {
    // The SDK introspection helper just needs a chain to dispatch
    // through — the action list is global. Use the first bundled
    // chain id as a stable anchor.
    const all = chainRegistry.supportedChains();
    return all[0]?.id || 'bitcoin-mainnet';
}

function shortenTxid(t) {
    if (!t || t.length <= 16) return t || '';
    return `${t.slice(0, 8)}…${t.slice(-4)}`;
}
