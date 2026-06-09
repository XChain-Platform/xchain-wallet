// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// RecentTradesPanel — §41.3.3 chronological trade feed for a market.
//
// Shares the `getMarketHistory` fetch with the chart, but renders the
// match rows directly instead of bucketing. Each row = one filled
// order match; side is inferred from the match orientation vs the
// (tick1, tick2) the view is looking at.

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { sampleMatchesFor } from '../../market/sampleMarketData.js';

const MAX_ROWS = 30;

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {boolean} [props.demo]   demo wallet — render sample trades when there's no live history
 * @param {(txid: string) => void} [props.onOpenTx]   navigate to the tx detail (future)
 */
export function RecentTradesPanel({ chainId, tick1, tick2, demo = false, onOpenTx }) {
    const { messaging } = useMessaging();
    const [rows, setRows] = useState(/** @type {any[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setRows([]);
        setLoadError(null);
        messaging.getMarketHistory({ chainId, tick1, tick2 })
            .then((resp) => {
                if (cancelled) return;
                const real = extractRows(resp);
                // Demo wallets show sample trades when there's no live
                // history; real wallets show real fills or the "No trades
                // yet" empty state — never fabricated trades.
                const next = real.length > 0 ? real : (demo ? sampleMatchesFor(tick1, tick2) : []);
                setRows(next.slice(0, MAX_ROWS));
            })
            .catch((err) => {
                if (cancelled) return;
                setRows(demo ? sampleMatchesFor(tick1, tick2).slice(0, MAX_ROWS) : []);
                setLoadError(err?.message || String(err));
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2, demo]);

    return (
        <div
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
            }}
        >
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Recent trades</p>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr 0.75fr',
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
            </div>
            {loadError ? (
                <p style={{ margin: '0.25rem 0.25rem 0', color: 'var(--xc-fg-muted)', fontSize: '0.75rem' }}>
                    {loadError}
                </p>
            ) : null}
            {!loadError && rows.length === 0 ? (
                <p style={{ margin: '0.25rem 0.25rem 0', color: 'var(--xc-fg-muted)', fontSize: '0.75rem' }}>
                    No trades yet.
                </p>
            ) : null}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {rows.map((row) => {
                    const summary = summarizeRow(row, tick1, tick2);
                    if (!summary) return null;
                    const content = (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr 1fr 0.75fr',
                                gap: '0.25rem',
                                padding: '0.15rem 0.25rem',
                                fontSize: '0.7rem',
                                fontVariantNumeric: 'tabular-nums',
                            }}
                        >
                            <span style={{ color: 'var(--xc-fg-muted)' }}>
                                {summary.timeLabel}
                            </span>
                            <span style={{ color: summary.side === 'buy' ? '#26a69a' : '#ef5350' }}>
                                {summary.price}
                            </span>
                            <span>{summary.size}</span>
                            <span>{summary.side === 'buy' ? 'Buy' : 'Sell'}</span>
                        </div>
                    );
                    const key = String(row.action_index ?? `${summary.timeLabel}-${summary.price}-${summary.size}`);
                    if (!onOpenTx || !row.tx_hash) {
                        return <li key={key}>{content}</li>;
                    }
                    return (
                        <li key={key}>
                            <button
                                type="button"
                                onClick={() => onOpenTx(String(row.tx_hash))}
                                aria-label={`Open transaction ${row.tx_hash}`}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}
                            >
                                {content}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function summarizeRow(row, tick1, tick2) {
    if (!row || typeof row !== 'object') return null;
    const giveTick = row.give_tick || row.giveTick;
    const getTick = row.get_tick || row.getTick;
    if (!giveTick || !getTick) return null;
    const giveAmt = Number(row.give_amount ?? row.giveAmount);
    const getAmt = Number(row.get_amount ?? row.getAmount);
    if (!Number.isFinite(giveAmt) || giveAmt <= 0) return null;
    if (!Number.isFinite(getAmt) || getAmt <= 0) return null;
    let price; let size; let side;
    if (giveTick === tick1 && getTick === tick2) {
        price = getAmt / giveAmt;
        size = giveAmt;
        side = 'sell';
    } else if (giveTick === tick2 && getTick === tick1) {
        price = giveAmt / getAmt;
        size = getAmt;
        side = 'buy';
    } else {
        return null;
    }
    const ts = parseTimestamp(row);
    return {
        price: formatPrice(price),
        size: formatSize(size),
        side,
        timeLabel: ts ? formatTime(ts) : '—',
        counterparty: row.destination || row.give_address || row.get_address || null,
    };
}

function formatPrice(n) {
    if (!Number.isFinite(n)) return '—';
    if (n === 0) return '0';
    if (n >= 1) return n.toFixed(4);
    if (n >= 0.01) return n.toFixed(6);
    return n.toFixed(8);
}

function formatSize(n) {
    if (!Number.isFinite(n)) return '—';
    if (Number.isInteger(n)) return String(n);
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(4);
}

function parseTimestamp(row) {
    if (Number.isFinite(Number(row.timestamp))) return Number(row.timestamp);
    if (Number.isFinite(Number(row.block_time))) return Number(row.block_time);
    if (row.created_at) {
        const ms = Date.parse(row.created_at);
        if (Number.isFinite(ms)) return Math.floor(ms / 1000);
    }
    return null;
}

function formatTime(unixSeconds) {
    try {
        const d = new Date(unixSeconds * 1000);
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '—';
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
