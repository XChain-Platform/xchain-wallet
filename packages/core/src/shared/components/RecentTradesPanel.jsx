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
import tableStyles from './DataTable.module.css';

const MAX_ROWS = 30;

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
            <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                <table className={tableStyles.table}>
                    <caption className={tableStyles.caption}>Recent trades</caption>
                    <thead>
                        <tr>
                            <th className={tableStyles.headerCell} scope="col">Time</th>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">Price</th>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">Size ({tick1})</th>
                            <th className={tableStyles.headerCell} scope="col">Side</th>
                        </tr>
                    </thead>
                    <tbody>
                        {summaries.map(({ row, summary }, index) => {
                            const sideColor = summary.side === 'buy' ? 'var(--xc-success)' : 'var(--xc-danger)';
                            const key = `${String(row.action_index ?? row.tx_hash ?? 'trade')}-${index}`;
                            return (
                                <tr key={key}>
                                    <td className={`${tableStyles.cell} ${tableStyles.numeric}`} data-label="Time" style={{ color: 'var(--xc-fg-muted)' }}>
                                        {onOpenTx && row.tx_hash ? (
                                            <button
                                                type="button"
                                                onClick={() => onOpenTx(String(row.tx_hash))}
                                                aria-label={`Open transaction ${row.tx_hash}`}
                                                className={tableStyles.cellButton}
                                            >
                                                {summary.timeLabel}
                                            </button>
                                        ) : summary.timeLabel}
                                    </td>
                                    <td
                                        className={`${tableStyles.cell} ${tableStyles.numeric}`}
                                        data-label="Price"
                                        style={{ color: sideColor }}
                                    >
                                        {summary.price}
                                    </td>
                                    <td className={`${tableStyles.cell} ${tableStyles.numeric}`} data-label={`Size (${tick1})`}>
                                        {summary.size}
                                    </td>
                                    <td className={tableStyles.cell} data-label="Side" style={{ color: sideColor, fontWeight: 600 }}>
                                        {summary.side === 'buy' ? 'Buy' : 'Sell'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
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
