// OpenOrdersPanel — §41.3.5 per-market user open orders + cancel.
//
// Lists the user's open orders on this market (filtered by any
// address in the wallet on `chainId`), each row with a Cancel button
// that routes through `cancelOrder` / `cancelOrderHw` against the
// order's source address. Cancellation reuses the shared
// SignCredentials gate so HW signers slot in behind the same UX.
//
// Fetch cadence: polled every 5s on-screen, paused on hidden tab.
// Reuses the AirdropForm / OrderbookPanel visibility-gated pattern.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, AddressText } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { SignCredentials, isHwSource } from './SignCredentials.jsx';

const POLL_INTERVAL_MS = 5000;

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 */
export function OpenOrdersPanel({ walletId, chainId, tick1, tick2 }) {
    const { messaging } = useMessaging();
    const [addresses, setAddresses] = useState(/** @type {any[]} */ ([]));
    const [orders, setOrders] = useState(/** @type {any[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [confirmOrder, setConfirmOrder] = useState(/** @type {any | null} */ (null));
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddresses(byChain?.[chainId] || []);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId]);

    useEffect(() => {
        if (addresses.length === 0) return undefined;
        let cancelled = false;
        const tick = async () => {
            if (cancelled) return;
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden') return;
            try {
                const results = await Promise.all(addresses.map((addr) =>
                    messaging.getMarketOrders({
                        chainId, tick1, tick2, address: addr.address,
                    }).then((resp) => ({ addr, rows: extractRows(resp) }))
                      .catch(() => ({ addr, rows: [] }))
                ));
                if (cancelled) return;
                const flat = [];
                for (const { addr, rows } of results) {
                    for (const row of rows) flat.push({ ...row, __owner: addr });
                }
                setOrders(flat);
                setLoadError(null);
            } catch (err) {
                if (!cancelled) setLoadError(err?.message || String(err));
            }
        };
        tick();
        const handle = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [messaging, chainId, tick1, tick2, addresses]);

    const rows = useMemo(() => {
        return orders.map((o) => summarizeOrder(o, tick1, tick2)).filter(Boolean);
    }, [orders, tick1, tick2]);

    const confirmOwner = confirmOrder?.__owner || null;
    const hw = isHwSource(confirmOwner);

    async function handleCancel(event) {
        event.preventDefault();
        if (!confirmOrder || submitting) return;
        if (!hw && password.length === 0) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: confirmOwner.address,
                    publicKey: confirmOwner.publicKey,
                    derivationPath: confirmOwner.derivationPath,
                    addressId: confirmOwner.id,
                    source: confirmOwner.source,
                    signerId: confirmOwner.signerId,
                },
                orderActionIndex: String(confirmOrder.action_index),
            };
            if (hw) {
                await messaging.cancelOrderHw({ ...base, signerId: confirmOwner.signerId });
            } else {
                await messaging.cancelOrder({ ...base, password });
            }
            setConfirmOrder(null);
            setPassword('');
            setOrders((prev) => prev.filter((o) => o.action_index !== confirmOrder.action_index));
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : err?.message || 'Cancel failed.');
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
            }}
        >
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>My open orders</p>
            {loadError ? (
                <p style={{ margin: '0.25rem 0.25rem 0', color: 'var(--xc-fg-muted)', fontSize: '0.75rem' }}>
                    {loadError}
                </p>
            ) : null}
            {!loadError && rows.length === 0 ? (
                <p style={{ margin: '0.25rem 0.25rem 0', color: 'var(--xc-fg-muted)', fontSize: '0.8rem' }}>
                    No open orders on this market.
                </p>
            ) : null}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {rows.map((r) => (
                    <li
                        key={r.actionIndex}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '0.5fr 1fr 1fr 1fr 0.75fr',
                            gap: '0.25rem',
                            padding: '0.25rem',
                            fontSize: '0.8rem',
                            alignItems: 'center',
                        }}
                    >
                        <span style={{ color: r.side === 'buy' ? '#26a69a' : '#ef5350' }}>
                            {r.side === 'buy' ? 'Buy' : 'Sell'}
                        </span>
                        <span>{r.price}</span>
                        <span>{r.size}</span>
                        <span>
                            {r.filled > 0
                                ? `${r.filled}/${r.size} filled`
                                : <span style={{ color: 'var(--xc-fg-muted)' }}>open</span>}
                        </span>
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                                setConfirmOrder(r.raw);
                                setPassword('');
                                setSubmitError(null);
                            }}
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                    </li>
                ))}
            </ul>
            {confirmOrder ? (
                <form
                    onSubmit={handleCancel}
                    noValidate
                    style={{
                        marginTop: '0.5rem',
                        padding: '0.5rem',
                        border: '1px solid var(--xc-border)',
                        borderRadius: '4px',
                    }}
                >
                    <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
                        Cancel order #{String(confirmOrder.action_index)}
                        {confirmOwner ? <> from <AddressText address={confirmOwner.address} /></> : null}
                    </p>
                    <SignCredentials
                        fromAddress={confirmOwner}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => {
                            setPassword(v);
                            if (submitError) setSubmitError(null);
                        }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={submitting}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                    {hw && submitError ? (
                        <p role="alert" style={{ margin: '0.25rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                            {submitError}
                        </p>
                    ) : null}
                    <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem' }}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setConfirmOrder(null); setPassword(''); }}
                            disabled={submitting}
                        >
                            Back
                        </Button>
                        <Button
                            type="submit"
                            variant="danger"
                            size="sm"
                            loading={submitting}
                            disabled={hw ? hwStatus !== 'available' : password.length === 0}
                        >
                            {hw
                                ? `Cancel on ${confirmOwner?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : 'Sign cancel'}
                        </Button>
                    </div>
                </form>
            ) : null}
        </div>
    );
}

function summarizeOrder(o, tick1, tick2) {
    if (!o || typeof o !== 'object') return null;
    const giveTick = o.give_tick || o.giveTick;
    const getTick = o.get_tick || o.getTick;
    const giveAmt = Number(o.give_amount ?? o.giveAmount);
    const getAmt = Number(o.get_amount ?? o.getAmount);
    const giveRemaining = Number(o.give_remaining ?? o.giveRemaining ?? giveAmt);
    if (!Number.isFinite(giveAmt) || giveAmt <= 0) return null;
    if (!Number.isFinite(getAmt) || getAmt <= 0) return null;
    let side; let price; let size; let filled;
    if (giveTick === tick1 && getTick === tick2) {
        side = 'sell';
        price = getAmt / giveAmt;
        size = giveAmt;
        filled = Number.isFinite(giveRemaining) ? giveAmt - giveRemaining : 0;
    } else if (giveTick === tick2 && getTick === tick1) {
        side = 'buy';
        price = giveAmt / getAmt;
        size = getAmt;
        const getRemaining = Number(o.get_remaining ?? o.getRemaining ?? getAmt);
        filled = Number.isFinite(getRemaining) ? getAmt - getRemaining : 0;
    } else {
        return null;
    }
    return {
        actionIndex: String(o.action_index),
        side,
        price: String(price),
        size: String(size),
        filled,
        raw: o,
    };
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.orders)) return resp.orders;
    return [];
}
