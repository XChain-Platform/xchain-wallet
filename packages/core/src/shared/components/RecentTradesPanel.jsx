// RecentTradesPanel — §41.3.3 chronological trade feed for a market.
//
// Shares the `getMarketHistory` fetch with the chart, but renders the
// match rows directly instead of bucketing. Each row = one filled
// order match; side is inferred from the match orientation vs the
// (tick1, tick2) the view is looking at.

import { useEffect, useState } from 'react';
import { AddressText } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';

const MAX_ROWS = 30;

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {(txid: string) => void} [props.onOpenTx]   navigate to the tx detail (future)
 */
export function RecentTradesPanel({ chainId, tick1, tick2, onOpenTx }) {
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
                setRows(extractRows(resp).slice(0, MAX_ROWS));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || String(err));
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2]);

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
                <span>Counterparty</span>
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
                                gridTemplateColumns: '1fr 1fr 1fr 0.75fr 1.5fr',
                                gap: '0.25rem',
                                padding: '0.15rem 0.25rem',
                                fontSize: '0.8rem',
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
                            <span>
                                {summary.counterparty ? (
                                    <AddressText address={summary.counterparty} />
                                ) : '—'}
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
        price: String(price),
        size: String(size),
        side,
        timeLabel: ts ? formatTime(ts) : '—',
        counterparty: row.destination || row.give_address || row.get_address || null,
    };
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
