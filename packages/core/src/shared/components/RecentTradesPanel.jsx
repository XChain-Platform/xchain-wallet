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
import { useReportLoadFailure } from './pageLoadFailures.jsx';
import {
    compareDecimalStrings,
    roundDecimalString,
} from '../utils/amountFormat.js';
import tableStyles from './DataTable.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

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
    const [retryKey, setRetryKey] = useState(0);
    // On a page that shows one load error, the page names this failure.
    const pageShowsError = useReportLoadFailure('recent trades', Boolean(loadError));

    useEffect(() => {
        setRows([]);
    }, [chainId, tick1, tick2, demo]);

    useEffect(() => {
        let cancelled = false;
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
                if (demo) {
                    setRows((current) => current.length > 0
                        ? current
                        : sampleMatchesFor(tick1, tick2).slice(0, MAX_ROWS));
                }
                setLoadError(readFailureMessage(err, 'load recent trades'));
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2, demo, retryKey]);

    const summaries = rows
        .map((row) => ({ row, summary: summarizeRow(row, tick1, tick2) }))
        .filter(({ summary }) => Boolean(summary));

    return (
        <section
            aria-label={t('components.recentTradesPanel.recentTrades')}
            aria-busy={loading || undefined}
            style={{
                border: 'var(--xc-card-border)',
                background: 'var(--xc-card-bg)',
                borderRadius: 'var(--xc-card-radius)',
                padding: 'var(--xc-card-pad)',
            }}
        >
            <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                <table className={`${tableStyles.table} ${tableStyles.keepColumns}`}>
                    <caption className={tableStyles.caption}>{t('components.recentTradesPanel.recentTrades')}</caption>
                    <thead>
                        <tr>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">{t('components.tradeHistoryPanel.time')}</th>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">{t('components.placeOrderPanel.price')}</th>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">{t('components.openOrdersPanel.size')}{tick1})</th>
                            <th className={tableStyles.headerCell} scope="col">{t('components.placeOrderPanel.side')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {summaries.map(({ row, summary }, index) => {
                            const sideColor = summary.side === 'buy' ? 'var(--xc-success)' : 'var(--xc-danger-fg)';
                            const key = `${String(row.action_index ?? row.tx_hash ?? 'trade')}-${index}`;
                            return (
                                <tr key={key}>
                                    <td className={`${tableStyles.cell} ${tableStyles.numeric}`} data-label="Time" style={{ color: 'var(--xc-fg-muted)' }}>
                                        {onOpenTx && row.tx_hash ? (
                                            <button
                                                type="button"
                                                onClick={() => onOpenTx(String(row.tx_hash))}
                                                aria-label={t('components.recentTradesPanel.openTransaction', { tx_hash: row.tx_hash })}
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
                                        {summary.side === 'buy' ? t('components.placeOrderPanel.buy') : t('components.placeOrderPanel.sell')}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {loading ? (
                <StatusMessage variant="status">{t('components.recentTradesPanel.loadingRecentTrades')}</StatusMessage>
            ) : null}
            {loadError && !pageShowsError ? (
                <StatusMessage
                    variant="error"
                    recovery={{
                        label: t('common.tryAgain'),
                        onAction: () => setRetryKey((key) => key + 1),
                    }}
                >
                    {loadError}
                </StatusMessage>
            ) : null}
            {!loadError && !loading && summaries.length === 0 ? (
                <p style={{ margin: '0.25rem 0.25rem 0', color: 'var(--xc-fg-muted)', fontSize: '0.75rem' }}>
                    {t('components.recentTradesPanel.noTradesYet')}
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
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.history)) return resp.history;
    throw new Error('getMarketHistory: malformed response');
}
