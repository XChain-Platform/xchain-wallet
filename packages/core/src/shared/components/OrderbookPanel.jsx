// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// OrderbookPanel: §41.3.2 depth-visualized orderbook.
//
// Two columns (bids / asks). Each row renders price, size, cumulative
// total, and a depth bar proportional to cumulative / maxCumulative.
// Clicking a row fires `onPickPrice(price)` so the Place Order form
// can prefill it (standard trader shortcut).
//
// Polling cadence:
//   - 5s on active market view (matches the AirdropForm polling
//     pattern elsewhere in the wallet).
//   - Pauses when `document.visibilityState === 'hidden'` to avoid
//     burning explorer bandwidth for off-screen tabs. WS push is
//     Phase 4+ work once the explorer exposes a stream.

import { useEffect, useState } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { normalizeOrderbook } from '../../market/orderbook.js';
import { sampleOrderbookFor } from '../../market/sampleMarketData.js';
import {
    divideDecimalStrings,
    formatWithThousands,
    trimAmountTail,
} from '../utils/amountFormat.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import tableStyles from './DataTable.module.css';
import { startVisibleInterval } from '../utils/visibleInterval.js';
import styles from './MarketTrading.module.css';

const POLL_INTERVAL_MS = 5000;

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {boolean} [props.demo]   demo wallet: render a sample book when the live book is empty
 * @param {(price: string) => void} [props.onPickPrice]
 */
export function OrderbookPanel({ chainId, tick1, tick2, demo = false, onPickPrice }) {
    const { messaging } = useMessaging();
    const [book, setBook] = useState(/** @type {any} */ ({ bids: [], asks: [], maxCumulative: '0' }));
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setBook({ bids: [], asks: [], maxCumulative: '0' });
        setLoadError(null);
        setLoading(true);
        const tick = async () => {
            if (cancelled) return;
            try {
                const resp = await messaging.getOrderbook({ chainId, tick1, tick2 });
                if (cancelled) return;
                let normalized = normalizeOrderbook(resp);
                // Demo wallets render a sample book when the explorer has
                // no live orders yet; real wallets keep the empty book and
                // fall through to the "No open orders" empty state below.
                if (demo && normalized.bids.length === 0 && normalized.asks.length === 0) {
                    normalized = normalizeOrderbook(sampleOrderbookFor(tick1, tick2));
                }
                setBook(normalized);
                setLoadError(null);
                setLoading(false);
            } catch (err) {
                if (cancelled) return;
                // Demo wallets keep the UI populated through dev/CORS
                // outages; real wallets surface the error instead of
                // showing fabricated prices.
                if (demo) setBook(normalizeOrderbook(sampleOrderbookFor(tick1, tick2)));
                setLoadError(readFailureMessage(err, 'load the order book'));
                setLoading(false);
            }
        };
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') tick();
        const stopPollInterval = startVisibleInterval(tick, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            stopPollInterval();
        };
    }, [messaging, chainId, tick1, tick2, demo]);

    return (
        <section
            aria-label="Order book"
            aria-busy={loading || undefined}
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
            }}
        >
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Order book</p>
            <div className={styles.orderBookGrid}>
                <LevelsColumn
                    title="Buy bids"
                    side="bid"
                    levels={book.bids}
                    maxCumulative={book.maxCumulative}
                    onPickPrice={onPickPrice}
                    tick2={tick2}
                    tick1={tick1}
                />
                <LevelsColumn
                    title="Sell asks"
                    side="ask"
                    levels={book.asks}
                    maxCumulative={book.maxCumulative}
                    onPickPrice={onPickPrice}
                    tick2={tick2}
                    tick1={tick1}
                />
            </div>
            {loading ? (
                <StatusMessage variant="status">Loading order book…</StatusMessage>
            ) : null}
            {loadError ? (
                <StatusMessage variant="error">{loadError}</StatusMessage>
            ) : null}
            {!loading && !loadError && book.bids.length === 0 && book.asks.length === 0 ? (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--xc-text-muted)', fontSize: '0.75rem' }}>
                    No open orders on this market.
                </p>
            ) : null}
        </section>
    );
}

function LevelsColumn({ title, side, levels, maxCumulative, onPickPrice, tick1, tick2 }) {
    return (
        <div
            className={styles.levelsScroller}
            role="region"
            aria-label={`${title} order book levels`}
            tabIndex={0}
        >
            <div className={styles.levelsTable}>
                <table className={tableStyles.table}>
                    <caption className={`${tableStyles.caption} ${tableStyles.compactCaption}`}>{title}</caption>
                    <thead>
                        <tr>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">Price ({tick2})</th>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">Size ({tick1})</th>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">Total ({tick1})</th>
                        </tr>
                    </thead>
                    <tbody>
                    {levels.map((level) => (
                        <LevelRow
                            key={`${side}-${level.displayPrice}`}
                            level={level}
                            maxCumulative={maxCumulative}
                            side={side}
                            onPick={onPickPrice ? () => onPickPrice(level.displayPrice) : null}
                        />
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function LevelRow({ level, maxCumulative, side, onPick }) {
    const depthRatio = divideDecimalStrings(level.cumulative, maxCumulative, 8);
    const depthPct = depthRatio === null
        ? 0
        : Math.min(100, Math.max(0, Number(depthRatio) * 100));
    const depthColor = side === 'bid'
        ? 'rgba(38, 166, 154, 0.18)'
        : 'rgba(239, 83, 80, 0.18)';
    return (
        <tr
            style={{
                background: `linear-gradient(to ${side === 'bid' ? 'left' : 'right'}, ${depthColor} ${depthPct}%, transparent ${depthPct}%)`,
            }}
        >
            <td
                className={`${tableStyles.cell} ${tableStyles.numeric}`}
                data-label="Price"
                title={level.displayPrice}
                style={{ color: side === 'bid' ? 'var(--xc-success)' : 'var(--xc-danger)' }}
            >
                {onPick ? (
                    <button
                        type="button"
                        onClick={onPick}
                        aria-label={`Pick ${side === 'bid' ? 'buy bid' : 'sell ask'} price ${level.displayPrice}`}
                        className={tableStyles.cellButton}
                    >
                        {formatBookNumber(level.displayPrice)}
                    </button>
                ) : formatBookNumber(level.displayPrice)}
            </td>
            <td className={`${tableStyles.cell} ${tableStyles.numeric}`} data-label="Size" title={level.displaySize}>
                {formatBookNumber(level.displaySize)}
            </td>
            <td
                className={`${tableStyles.cell} ${tableStyles.numeric}`}
                data-label="Total"
                title={level.cumulative}
                style={{ color: 'var(--xc-text-muted)' }}
            >
                {formatBookNumber(level.cumulative)}
            </td>
        </tr>
    );
}

function formatBookNumber(value) {
    return formatWithThousands(trimAmountTail(value));
}
