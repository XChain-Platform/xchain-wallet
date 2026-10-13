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
// Always-open section below OpenOrdersPanel. Fans out
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
import { AddressText, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { historyTimestamp, normalizeMarketHistoryRowExact } from '../../market/history_rows.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import tableStyles from './DataTable.module.css';

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
    const [addressesLoading, setAddressesLoading] = useState(true);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setAddresses([]);
        setRows([]);
        setAddressesLoading(true);
        setLoading(true);
        setLoadError(null);
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddresses(byChain?.[chainId] || []);
                setAddressesLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setLoadError(readFailureMessage(err, 'load your trade history'));
                setAddressesLoading(false);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId]);

    const reload = useCallback(async () => {
        if (addressesLoading) return;
        if (addresses.length === 0) {
            setRows([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setLoadError(null);
        try {
            const results = await Promise.all(addresses.map((addr) =>
                messaging.getMarketHistory({
                    chainId, tick1, tick2, address: addr.address,
                }).then((resp) => ({ addr, rows: extractRows(resp), error: null }))
                  .catch((error) => ({ addr, rows: [], error }))
            ));
            const successes = results.filter(({ error }) => !error);
            if (successes.length === 0) throw results[0].error;
            const flat = [];
            for (const { addr, rows: addrRows } of successes) {
                for (const row of addrRows) flat.push({ ...row, __owner: addr });
            }
            flat.sort((a, b) => rowTime(b) - rowTime(a));
            setRows(flat);
        } catch (err) {
            setLoadError(readFailureMessage(err, 'load your trade history'));
        } finally {
            setLoading(false);
        }
    }, [messaging, chainId, tick1, tick2, addresses, addressesLoading]);

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
        <section
            aria-label="Trade history"
            aria-busy={addressesLoading || loading || undefined}
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
                marginTop: '0.75rem',
            }}
        >
            <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                marginBottom: '0.25rem',
            }}>
                <p style={{ margin: 0, fontWeight: 600 }}>Trade history</p>
                <button
                    type="button"
                    onClick={reload}
                    disabled={addressesLoading || loading}
                    style={{
                        background: 'none',
                        border: '1px solid var(--xc-border)',
                        borderRadius: '3px',
                        padding: '0.1rem 0.4rem',
                        font: 'inherit',
                        fontSize: '0.75rem',
                        cursor: addressesLoading || loading ? 'default' : 'pointer',
                        color: 'inherit',
                    }}
                >
                    {addressesLoading || loading ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            {addressesLoading || loading ? (
                <StatusMessage variant="status">Loading trade history…</StatusMessage>
            ) : null}
            {loadError ? (
                <StatusMessage variant="error">{loadError}</StatusMessage>
            ) : null}
            {!loadError && !addressesLoading && !loading && summaries.length === 0 ? (
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
            {summaries.length > 0 ? (
                <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                    <table className={tableStyles.table}>
                        <caption className={tableStyles.caption}>Trade history</caption>
                        <thead>
                            <tr>
                                <th className={tableStyles.headerCell} scope="col">Time</th>
                                <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">Price</th>
                                <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">Size ({tick1})</th>
                                <th className={tableStyles.headerCell} scope="col">Side</th>
                                <th className={tableStyles.headerCell} scope="col">Address</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaries.map((summary, idx) => {
                                const sideColor = summary.side === 'buy' ? 'var(--xc-success)' : 'var(--xc-danger)';
                                const key = summary.key || `row-${idx}`;
                                return (
                                    <tr key={key}>
                                        <td className={`${tableStyles.cell} ${tableStyles.numeric}`} data-label="Time" style={{ color: 'var(--xc-fg-muted)' }}>
                                            {onOpenTx && summary.txHash ? (
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenTx(summary.txHash)}
                                                    aria-label={`Open transaction ${summary.txHash}`}
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
                                        <td className={tableStyles.cell} data-label="Address">
                                            {summary.ownerAddress ? (
                                                <AddressText address={summary.ownerAddress} />
                                            ) : '--'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </section>
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
