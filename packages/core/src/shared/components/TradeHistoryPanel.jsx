// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// TradeHistoryPanel (§41.3.6): per-market user trade history.
//
// Collapsible section below OpenOrdersPanel. Fans out
// `messaging.getMarketHistory({ chainId, tick1, tick2, address })`
// across every wallet address on `chainId` and shows the user's own
// completed fills for this market. "Buy" means the user received
// tick1 (gave tick2); "Sell" means the user gave tick1.
//
// Fetch strategy: load once on mount plus a manual Refresh button.
// Trade history grows slowly and this panel is secondary to the
// active-trading surface above it, so there's no polling. We avoid
// adding another 5s timer alongside the orderbook and open-orders
// pollers.

import { useCallback, useEffect, useState } from 'react';
import { AddressText } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { historyTimestamp, normalizeMarketHistoryRowExact } from '../../market/history_rows.js';

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {(txid: string) => void} [props.onOpenTx]   navigate to the tx detail (future)
 */
export function TradeHistoryPanel({ walletId, chainId, tick1, tick2, onOpenTx }) {
    const { messaging } = useMessaging();
    const [addresses, setAddresses] = useState(/** @type {any[]} */ ([]));
    const [rows, setRows] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

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

    const reload = useCallback(async () => {
        if (addresses.length === 0) {
            setRows([]);
            return;
        }
        setLoading(true);
        setLoadError(null);
        try {
            const results = await Promise.all(addresses.map((addr) =>
                messaging.getMarketHistory({
                    chainId, tick1, tick2, address: addr.address,
                }).then((resp) => ({ addr, rows: extractRows(resp) }))
                  .catch(() => ({ addr, rows: [] }))
            ));
            const flat = [];
            for (const { addr, rows: addrRows } of results) {
                for (const row of addrRows) flat.push({ ...row, __owner: addr });
            }
            flat.sort((a, b) => rowTime(b) - rowTime(a));
            setRows(flat);
        } catch (err) {
            setLoadError(err?.message || String(err));
        } finally {
            setLoading(false);
        }
    }, [messaging, chainId, tick1, tick2, addresses]);

    useEffect(() => {
        reload();
    }, [reload]);

    useEffect(() => {
        setRows([]);
    }, [chainId, tick1, tick2, walletId]);

    const summaries = rows
        .map((row) => summarizeRow(row, tick1, tick2))
        .filter(Boolean);

    return (
        <div
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
                marginTop: '0.75rem',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.25rem' }}>
                <button
                    type="button"
                    onClick={reload}
                    disabled={loading}
                    style={{
                        background: 'none',
                        border: '1px solid var(--xc-border)',
                        borderRadius: '3px',
                        padding: '0.1rem 0.4rem',
                        font: 'inherit',
                        fontSize: '0.75rem',
                        cursor: loading ? 'default' : 'pointer',
                        color: 'inherit',
                    }}
                >
                    {loading ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            <div>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr 1fr 0.75fr 1.5fr',
                            gap: '0.25rem',
                            fontSize: '0.75rem',
                            color: 'var(--xc-fg-muted)',
                            padding: '0 0.25rem 0.25rem',
                        }}
                    >
                        <span>Time</span>
                        <span>Price</span>
                        <span>Size ({tick1})</span>
                        <span>Side</span>
                        <span>Address</span>
                    </div>
                    {loadError ? (
                        <p
                            style={{
                                margin: '0.25rem 0.25rem 0',
                                color: 'var(--xc-fg-muted)',
                                fontSize: '0.75rem',
                            }}
                        >
                            {loadError}
                        </p>
                    ) : null}
                    {!loadError && !loading && summaries.length === 0 ? (
                        <p
                            style={{
                                margin: '0.25rem 0.25rem 0',
                                color: 'var(--xc-fg-muted)',
                                fontSize: '0.75rem',
                            }}
                        >
                            No trades on this market yet.
                        </p>
                    ) : null}
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {summaries.map((summary, idx) => {
                            const content = (
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr 1fr 0.75fr 1.5fr',
                                        gap: '0.25rem',
                                        padding: '0.15rem 0.25rem',
                                        fontSize: '0.8rem',
                                    }}
                                >
                                    <span style={{ color: 'var(--xc-fg-muted)' }}>
                                        {summary.timeLabel}
                                    </span>
                                    <span
                                        style={{
                                            color: summary.side === 'buy' ? '#26a69a' : '#ef5350',
                                        }}
                                    >
                                        {summary.price}
                                    </span>
                                    <span>{summary.size}</span>
                                    <span>{summary.side === 'buy' ? 'Buy' : 'Sell'}</span>
                                    <span>
                                        {summary.ownerAddress ? (
                                            <AddressText address={summary.ownerAddress} />
                                        ) : '--'}
                                    </span>
                                </div>
                            );
                            const key = summary.key || `row-${idx}`;
                            if (!onOpenTx || !summary.txHash) {
                                return <li key={key}>{content}</li>;
                            }
                            return (
                                <li key={key}>
                                    <button
                                        type="button"
                                        onClick={() => onOpenTx(summary.txHash)}
                                        aria-label={`Open transaction ${summary.txHash}`}
                                        style={{
                                            display: 'block',
                                            width: '100%',
                                            background: 'none',
                                            border: 'none',
                                            padding: 0,
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            color: 'inherit',
                                        }}
                                    >
                                        {content}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
        </div>
    );
}

function summarizeRow(row, tick1, tick2) {
    const parsed = normalizeMarketHistoryRowExact(row, tick1, tick2);
    if (!parsed) return null;
    return {
        price: String(parsed.price),
        size: String(parsed.amount),
        side: parsed.side,
        timeLabel: formatTime(parsed.timestamp),
        ownerAddress: row.__owner?.address || null,
        txHash: parsed.txHash ? String(parsed.txHash) : null,
        key: String(parsed.actionIndex ?? parsed.txHash
            ?? `${parsed.timestamp}-${parsed.price}-${parsed.amount}`),
    };
}

function rowTime(row) {
    const ts = historyTimestamp(row);
    return Number.isFinite(ts) ? ts : 0;
}

function formatTime(unixSeconds) {
    try {
        const d = new Date(unixSeconds * 1000);
        return d.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '--';
    }
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.history)) return resp.history;
    return [];
}
