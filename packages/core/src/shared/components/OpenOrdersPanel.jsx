// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// OpenOrdersPanel (§41.3.5): per-market user open orders + cancel.
//
// Lists the user's open orders on this market (filtered by any
// address in the wallet on `chainId`), each row with a Cancel button
// that routes through the owner-action confirmation lane against the
// order's source address. The shared confirm screen previews and dry-runs
// the composed transaction before either software or hardware signs it.
//
// Fetch cadence: polled every 5s on-screen, paused on hidden tab.
// Reuses the AirdropForm / OrderbookPanel visibility-gated pattern.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, AddressText } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { ActionConfirmScreen } from './ActionConfirmScreen.jsx';
import { WatcherResultPanel } from './WatcherResultPanel.jsx';
import { useOwnerActionLane } from '../hooks/useOwnerActionLane.js';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { compareAmounts } from '../../market/orderMath.js';
import {
    divideDecimalStrings,
    subtractDecimalStrings,
} from '../utils/amountFormat.js';

const POLL_INTERVAL_MS = 5000;
const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 */
export function OpenOrdersPanel({ walletId, chainId, tick1, tick2 }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [balancesHidden] = useBalancesHidden();
    const [addresses, setAddresses] = useState(/** @type {any[]} */ ([]));
    const [orders, setOrders] = useState(/** @type {any[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [confirmOrder, setConfirmOrder] = useState(/** @type {any | null} */ (null));
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [watcherResult, setWatcherResult] = useState(/** @type {any | null} */ (null));

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

    // PC-16: auto-pay consent records for this wallet+chain, keyed by the
    // order's action index (resolved from the placement txid host-side).
    // The per-market open-order rows are the interim revocation surface
    // until the PC-17 My Orders view ships.
    const [autopayByIndex, setAutopayByIndex] = useState(
        /** @type {Map<string, any>} */ (new Map()),
    );
    const loadAutopay = useCallback(async () => {
        if (typeof messaging.listAutopayOrders !== 'function') return;
        try {
            if (typeof messaging.resolveAutopayIndexes === 'function') {
                await messaging.resolveAutopayIndexes({ walletId }).catch(() => {});
            }
            const records = await messaging.listAutopayOrders({ walletId, chainId });
            const map = new Map();
            for (const r of records || []) {
                if (r?.orderActionIndex != null) map.set(String(r.orderActionIndex), r);
            }
            setAutopayByIndex(map);
        } catch { /* toggle simply not shown */ }
    }, [messaging, walletId, chainId]);
    useEffect(() => { loadAutopay(); }, [loadAutopay]);

    async function handleAutopayToggle(record) {
        try {
            await messaging.setAutopayEnabled({ id: record.id, enabled: record.autopay !== true });
            await loadAutopay();
        } catch (err) {
            setLoadError(err?.message || String(err));
        }
    }

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
    const signerReady = useSignerReady(walletId);
    const nativeFee = useNativeFee(chainId);
    const cancelLane = useOwnerActionLane({
        messaging,
        walletId,
        chainId,
        owner: confirmOwner,
        software: 'cancelOrder',
        hardware: 'cancelOrderHw',
    });

    async function handleCancel(event) {
        event.preventDefault();
        if (!confirmOrder || submitting || cancelLane.composing) return;
        setSubmitting(true);
        setSubmitError(null);
        const orderActionIndex = String(confirmOrder.action_index);
        try {
            const result = await cancelLane.run({
                actionData: {
                    action: 'ORDER',
                    params: { VERSION: '1', ORDER_ACTION_INDEX: orderActionIndex },
                },
                encoderOpts: nativeFee.flag ? { payFeeInNativeCoin: true } : {},
                submitExtra: { orderActionIndex },
            });
            if (cancelLane.isWatcherMode) {
                setWatcherResult(result);
                return;
            }
            setConfirmOrder(null);
            setOrders((prev) => prev.filter((o) => o.action_index !== confirmOrder.action_index));
        } catch (err) {
            if (!isUserRejection(err)) {
                setSubmitError(err?.name === 'InvalidPasswordError'
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Cancel failed.',
                    }));
            }
        } finally {
            setSubmitting(false);
        }
    }

    if (cancelLane.open) {
        const descriptor = chainRegistry.get(chainId);
        return (
            <ActionConfirmScreen
                {...cancelLane.confirmProps}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                signerReady={signerReady}
            />
        );
    }

    if (watcherResult) {
        return (
            <WatcherResultPanel
                result={watcherResult}
                onBuildAnother={() => setWatcherResult(null)}
                onDone={() => {
                    setWatcherResult(null);
                    setConfirmOrder(null);
                }}
            />
        );
    }

    return (
        <div
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
            }}
        >
            {loadError ? (
                <p style={{
                    margin: 'var(--xc-space-3) 0',
                    color: 'var(--xc-text-muted)',
                    fontSize: 'var(--xc-text-sm)',
                    textAlign: 'center',
                }}>
                    {loadError}
                </p>
            ) : null}
            {!loadError && rows.length === 0 ? (
                <p style={{
                    margin: 'var(--xc-space-3) 0',
                    color: 'var(--xc-text-muted)',
                    fontSize: 'var(--xc-text-sm)',
                    textAlign: 'center',
                }}>
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
                        <span>{balancesHidden ? '•••••' : r.price}</span>
                        <span>{balancesHidden ? '•••••' : r.size}</span>
                        <span>
                            {r.filled > 0
                                ? (balancesHidden ? '••••• filled' : `${r.filled}/${r.size} filled`)
                                : <span style={{ color: 'var(--xc-fg-muted)' }}>open</span>}
                        </span>
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                                setConfirmOrder(r.raw);
                                setSubmitError(null);
                            }}
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                        {(() => {
                            const consent = autopayByIndex.get(String(r.actionIndex));
                            if (!consent) return null;
                            const on = consent.autopay === true;
                            return (
                                <label style={{
                                    gridColumn: '1 / -1',
                                    display: 'flex',
                                    gap: '0.35rem',
                                    alignItems: 'center',
                                    fontSize: '0.7rem',
                                    color: 'var(--xc-text-muted)',
                                    cursor: 'pointer',
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={() => handleAutopayToggle(consent)}
                                    />
                                    CoinPay auto-pay {on ? 'on' : 'off (notify-only)'}
                                </label>
                            );
                        })()}
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
                    {submitError ? (
                        <p role="alert" style={{ margin: '0.25rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                            {submitError}
                        </p>
                    ) : null}
                    <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem' }}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmOrder(null)}
                            disabled={submitting}
                        >
                            Back
                        </Button>
                        <Button
                            type="submit"
                            variant="danger"
                            size="sm"
                            loading={submitting || cancelLane.composing}
                            disabled={submitting || cancelLane.composing}
                        >
                            Cancel order
                        </Button>
                    </div>
                </form>
            ) : null}
        </div>
    );
}

function summarizeOrder(o, tick1, tick2) {
    if (!o || typeof o !== 'object') return null;
    const summarySide = String(o.type || '').toLowerCase();
    const summaryPrice = String(o.price ?? '').trim();
    const summarySize = String(o.amount ?? '').trim();
    if (['buy', 'sell'].includes(summarySide)
        && compareAmounts(summaryPrice, '0') === 1
        && compareAmounts(summarySize, '0') === 1) {
        return {
            actionIndex: String(o.action_index),
            side: summarySide,
            price: summaryPrice,
            size: summarySize,
            filled: null,
            raw: o,
        };
    }
    const giveTick = o.give_tick || o.giveTick;
    const getTick = o.get_tick || o.getTick;
    const giveAmt = String(o.give_amount ?? o.giveAmount ?? '');
    const getAmt = String(o.get_amount ?? o.getAmount ?? '');
    const giveRemaining = String(o.give_remaining ?? o.giveRemaining ?? giveAmt);
    if (compareAmounts(giveAmt, '0') !== 1) return null;
    if (compareAmounts(getAmt, '0') !== 1) return null;
    let side; let price; let size; let filled;
    if (giveTick === tick1 && getTick === tick2) {
        side = 'sell';
        price = divideDecimalStrings(getAmt, giveAmt, 18);
        size = giveAmt;
        filled = subtractDecimalStrings(giveAmt, giveRemaining) ?? '0';
    } else if (giveTick === tick2 && getTick === tick1) {
        side = 'buy';
        price = divideDecimalStrings(giveAmt, getAmt, 18);
        size = getAmt;
        const getRemaining = String(o.get_remaining ?? o.getRemaining ?? getAmt);
        filled = subtractDecimalStrings(getAmt, getRemaining) ?? '0';
    } else {
        return null;
    }
    return {
        actionIndex: String(o.action_index),
        side,
        price,
        size,
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
