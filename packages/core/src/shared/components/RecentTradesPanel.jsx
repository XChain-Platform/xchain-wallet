// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// RecentTradesPanel (§41.3.3): chronological trade feed for a market.
//
// Shares the `getMarketHistory` fetch with the chart, but renders the
// match rows directly instead of bucketing. Each row = one filled
// order match; the explorer projects its pair-relative side as `type`.
// Raw give/get rows retain orientation support for older explorers.

import { useEffect, useState } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { sampleMatchesFor } from '../../market/sampleMarketData.js';
import { normalizeMarketHistoryRowExact } from '../../market/history_rows.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import {
    compareDecimalStrings,
    roundDecimalString,
} from '../utils/amountFormat.js';

const MAX_ROWS = 30;
const TRADE_GRID_COLUMNS = 'minmax(5rem, 1fr) repeat(2, minmax(5rem, 1fr)) minmax(3rem, 0.6fr)';
const NUMERIC_CELL_STYLE = {
    minWidth: 0,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
};

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {boolean} [props.demo]   demo wallet; render sample trades when there's no live history
 * @param {(txid: string) => void} [props.onOpenTx]   navigate to the tx detail (future)
 */
export function RecentTradesPanel({ chainId, tick1, tick2, demo = false, onOpenTx }) {
    const { messaging } = useMessaging();
    const [rows, setRows] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setRows([]);
        setLoadError(null);
        setLoading(true);
        messaging.getMarketHistory({ chainId, tick1, tick2 })
            .then((resp) => {
                if (cancelled) return;
                const real = extractRows(resp);
                // Demo wallets show sample trades when there's no live
                // history; real wallets show real fills or the "No trades
                // yet" empty state. Never fabricated trades.
                const next = real.length > 0 ? real : (demo ? sampleMatchesFor(tick1, tick2) : []);
                setRows(next.slice(0, MAX_ROWS));
                setLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setRows(demo ? sampleMatchesFor(tick1, tick2).slice(0, MAX_ROWS) : []);
                setLoadError(readFailureMessage(err, 'load recent trades'));
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2, demo]);

    const summaries = rows
        .map((row) => ({ row, summary: summarizeRow(row, tick1, tick2) }))
        .filter(({ summary }) => Boolean(summary));

    return (
        <section
            aria-label="Recent trades"
            aria-busy={loading || undefined}
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
            }}
        >
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Recent trades</p>
            {loading ? (
                <StatusMessage variant="status">Loading recent trades…</StatusMessage>
            ) : null}
            {loadError ? (
                <StatusMessage variant="error">{loadError}</StatusMessage>
            ) : null}
            {!loadError && !loading && summaries.length === 0 ? (
                <p style={{ margin: '0.25rem 0.25rem 0', color: 'var(--xc-fg-muted)', fontSize: '0.75rem' }}>
                    No trades yet.
                </p>
            ) : null}
            {summaries.length > 0 ? (
                <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: TRADE_GRID_COLUMNS,
                            gap: '0.25rem',
                            minWidth: '20rem',
                            fontSize: '0.75rem',
                            color: 'var(--xc-fg-muted)',
                            padding: '0 0.25rem 0.25rem',
                        }}
                    >
                        <span style={NUMERIC_CELL_STYLE}>Time</span>
                        <span style={NUMERIC_CELL_STYLE}>Price</span>
                        <span style={NUMERIC_CELL_STYLE}>Size ({tick1})</span>
                        <span>Side</span>
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, minWidth: '20rem' }}>
                        {summaries.map(({ row, summary }) => {
                            const sideColor = summary.side === 'buy' ? 'var(--xc-success)' : 'var(--xc-danger)';
                            const content = (
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: TRADE_GRID_COLUMNS,
                                        gap: '0.25rem',
                                        padding: '0.15rem 0.25rem',
                                        fontSize: '0.7rem',
                                    }}
                                >
                                    <span style={{ ...NUMERIC_CELL_STYLE, color: 'var(--xc-fg-muted)' }}>
                                        {summary.timeLabel}
                                    </span>
                                    <span style={{ ...NUMERIC_CELL_STYLE, color: sideColor }}>
                                        {summary.price}
                                    </span>
                                    <span style={NUMERIC_CELL_STYLE}>{summary.size}</span>
                                    <span style={{ color: sideColor, fontWeight: 600 }}>
                                        {summary.side === 'buy' ? 'Buy' : 'Sell'}
                                    </span>
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
            ) : null}
        </section>
    );
}

function summarizeRow(row, tick1, tick2) {
    const parsed = normalizeMarketHistoryRowExact(row, tick1, tick2);
    if (!parsed) return null;
    return {
        price: formatPrice(parsed.price),
        size: formatSize(parsed.amount),
        side: parsed.side,
        timeLabel: formatTime(parsed.timestamp),
        counterparty: row.destination || row.give_address || row.get_address || null,
    };
}

function formatPrice(n) {
    if (compareDecimalStrings(n, '0') === null) return 'N/A';
    if (compareDecimalStrings(n, '0') === 0) return '0';
    if (compareDecimalStrings(n, '1') >= 0) return roundDecimalString(n, 4);
    if (compareDecimalStrings(n, '0.01') >= 0) return roundDecimalString(n, 6);
    return roundDecimalString(n, 8);
}

function formatSize(n) {
    if (compareDecimalStrings(n, '0') === null) return 'N/A';
    if (!String(n).includes('.')) return String(n);
    if (compareDecimalStrings(n, '1') >= 0) return roundDecimalString(n, 2);
    return roundDecimalString(n, 4);
}

function formatTime(unixSeconds) {
    try {
        const d = new Date(unixSeconds * 1000);
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
        return 'N/A';
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
