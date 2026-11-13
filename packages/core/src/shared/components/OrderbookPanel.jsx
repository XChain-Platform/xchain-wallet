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
    compareDecimalStrings,
    divideDecimalStrings,
    formatWithThousands,
    multiplyDecimalStrings,
    subtractDecimalStrings,
    trimAmountTail,
} from '../utils/amountFormat.js';
// The split book's last-trade line reads the tidied price.
import { tidyQuotePrice } from './marketTradeParts.jsx';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { useReportLoadFailure } from './pageLoadFailures.jsx';
import tableStyles from './DataTable.module.css';
import { startVisibleInterval } from '../utils/visibleInterval.js';
import styles from './MarketTrading.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

const POLL_INTERVAL_MS = 5000;

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {boolean} [props.demo]   demo wallet: render a sample book when the live book is empty
 * @param {(price: string, side: 'bid' | 'ask') => void} [props.onPickPrice]
 * @param {'columns' | 'split'} [props.layout]   'split' puts bids and asks side by side in one table
 * @param {string | null} [props.lastPrice]      The split book's last-trade line under the levels
 * @param {'positive' | 'negative' | 'neutral'} [props.lastDirection]
 */
export function OrderbookPanel({ chainId, tick1, tick2, demo = false, onPickPrice, layout = 'columns', lastPrice = null, lastDirection = 'neutral' }) {
    const { messaging } = useMessaging();
    const [book, setBook] = useState(/** @type {any} */ ({ bids: [], asks: [], maxCumulative: '0' }));
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [retryKey, setRetryKey] = useState(0);
    // On a page that shows one load error, the page names this failure.
    const pageShowsError = useReportLoadFailure('order book', Boolean(loadError));

    useEffect(() => {
        let cancelled = false;
        let requestId = 0;
        setBook({ bids: [], asks: [], maxCumulative: '0' });
        setLoadError(null);
        setLoading(true);
        const tick = async () => {
            if (cancelled) return;
            const currentRequest = ++requestId;
            try {
                const resp = await messaging.getOrderbook({ chainId, tick1, tick2 });
                if (cancelled || currentRequest !== requestId) return;
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
                if (cancelled || currentRequest !== requestId) return;
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
    }, [messaging, chainId, tick1, tick2, demo, retryKey]);

    const hasLevels = book.bids.length > 0 || book.asks.length > 0;

    return (
        <section
            aria-label={t('components.orderbookPanel.orderBook')}
            aria-busy={loading || undefined}
            style={{
                border: 'var(--xc-card-border)',
                background: 'var(--xc-card-bg)',
                borderRadius: 'var(--xc-card-radius)',
                padding: 'var(--xc-card-pad)',
            }}
        >
            {layout === 'split' ? (
                /* The title line carries the spread on its right. */
                <div className={styles.splitHead}>
                    <p className={styles.splitTitle}>{t('components.orderbookPanel.orderBook')}</p>
                    {spreadText(book) ? <span className={styles.splitSpread}>{spreadText(book)}</span> : null}
                </div>
            ) : (
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{t('components.orderbookPanel.orderBook')}</p>
            )}
            {hasLevels && layout === 'split' ? (
                <SplitBook
                    book={book}
                    onPickPrice={onPickPrice}
                    tick2={tick2}
                    lastPrice={lastPrice}
                    lastDirection={lastDirection}
                />
            ) : null}
            {hasLevels && layout !== 'split' ? (
                <div className={styles.orderBookGrid}>
                    <LevelsColumn
                        title={t('components.orderbookPanel.buyBids')}
                        side="bid"
                        levels={book.bids}
                        maxCumulative={book.maxCumulative}
                        onPickPrice={onPickPrice}
                        tick2={tick2}
                        tick1={tick1}
                    />
                    <LevelsColumn
                        title={t('components.orderbookPanel.sellAsks')}
                        side="ask"
                        levels={book.asks}
                        maxCumulative={book.maxCumulative}
                        onPickPrice={onPickPrice}
                        tick2={tick2}
                        tick1={tick1}
                    />
                </div>
            ) : null}
            {loading ? (
                <StatusMessage variant="status">{t('components.orderbookPanel.loadingOrderBook')}</StatusMessage>
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
            {!loading && !loadError && book.bids.length === 0 && book.asks.length === 0 ? (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--xc-text-muted)', fontSize: '0.75rem' }}>
                    {t('components.openOrdersPanel.noOpenOrdersOnThis')}
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
            aria-label={t('components.orderbookPanel.orderBookLevels', { title })}
            tabIndex={0}
        >
            <div className={styles.levelsTable}>
                <table className={`${tableStyles.table} ${tableStyles.keepColumns}`}>
                    <caption className={`${tableStyles.caption} ${tableStyles.compactCaption}`}>{title}</caption>
                    <thead>
                        <tr>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">{t('components.orderbookPanel.price')}{tick2})</th>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">{t('components.openOrdersPanel.size')}{tick1})</th>
                            <th className={`${tableStyles.headerCell} ${tableStyles.numeric}`} scope="col">{t('components.orderbookPanel.total')}{tick1})</th>
                        </tr>
                    </thead>
                    <tbody>
                    {levels.map((level, index) => (
                        <LevelRow
                            key={`${side}-${level.displayPrice}-${index}`}
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
                style={{ color: side === 'bid' ? 'var(--xc-success)' : 'var(--xc-danger-fg)' }}
            >
                {onPick ? (
                    <button
                        type="button"
                        onClick={onPick}
                        aria-label={t('components.orderbookPanel.pickPrice', { value: side === 'bid' ? 'buy bid' : 'sell ask', displayPrice: level.displayPrice })}
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

// The spread between the best ask and the best bid, with its share
// of the ask, for the split book's title line. Null when either side is empty.
function spreadText(book) {
    const bid = book.bids[0]?.displayPrice;
    const ask = book.asks[0]?.displayPrice;
    if (!bid || !ask) return null;
    const spread = subtractDecimalStrings(ask, bid);
    if (spread === null || compareDecimalStrings(spread, '0') === -1) return null;
    const pct = divideDecimalStrings(multiplyDecimalStrings(spread, '100'), ask, 2);
    return `Spread ${formatBookNumber(spread)}${pct !== null ? ` (${trimAmountTail(pct)}%)` : ''}`;
}

/**
 * Bids and asks side by side in one table (bids left, best first;
 * asks right, best first), so a phone sees both sides at once. The size and
 * price cells on each side share one depth bar, drawn outwards from the
 * middle. A price is a button that opens a trade at that price.
 */
function SplitBook({ book, onPickPrice, tick2, lastPrice, lastDirection }) {
    const rows = Math.max(book.bids.length, book.asks.length);
    // The price cell is 60% of its half and the size cell 40%, so a bar that
    // covers `f` of the half fills the price cell first, then the size cell.
    const depth = (level) => {
        const ratio = level ? divideDecimalStrings(level.cumulative, book.maxCumulative, 8) : null;
        const f = ratio === null ? 0 : Math.min(1, Math.max(0, Number(ratio)));
        return {
            price: Math.min(100, (f / 0.6) * 100),
            size: Math.max(0, ((f - 0.6) / 0.4) * 100),
        };
    };
    const bar = (pct, side) => {
        const color = side === 'bid' ? 'var(--xc-book-bid-depth, rgba(38, 166, 154, 0.18))' : 'var(--xc-book-ask-depth, rgba(239, 83, 80, 0.18))';
        return pct > 0
            ? { background: `linear-gradient(to ${side === 'bid' ? 'left' : 'right'}, ${color} ${pct}%, transparent ${pct}%)` }
            : undefined;
    };
    const priceCell = (level, side) => {
        if (!level) return null;
        const text = formatBookNumber(level.displayPrice);
        return onPickPrice ? (
            <button
                type="button"
                onClick={() => onPickPrice(level.displayPrice, side)}
                aria-label={t('components.orderbookPanel.pickPrice', { value: side === 'bid' ? 'buy bid' : 'sell ask', displayPrice: level.displayPrice })}
                className={`${tableStyles.cellButton} ${styles.splitPick}`}
            >
                {text}
            </button>
        ) : text;
    };
    return (
        <>
            <table className={styles.splitTable}>
                <caption className={styles.splitCaption}>{t('components.orderbookPanel.buyBids')} / {t('components.orderbookPanel.sellAsks')}</caption>
                <colgroup>
                    <col className={styles.splitSizeCol} />
                    <col className={styles.splitPriceCol} />
                    <col className={styles.splitPriceCol} />
                    <col className={styles.splitSizeCol} />
                </colgroup>
                <thead>
                    <tr>
                        <th scope="col" className={styles.splitSizeBid}>{t('components.orderbookPanel.size')}</th>
                        <th scope="col" className={styles.splitPriceBid}>{t('components.orderbookPanel.bidHeader', { tick2 })}</th>
                        <th scope="col" className={styles.splitPriceAsk}>{t('components.orderbookPanel.askHeader', { tick2 })}</th>
                        <th scope="col" className={styles.splitSizeAsk}>{t('components.orderbookPanel.size')}</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }, (_, i) => {
                        const bid = book.bids[i];
                        const ask = book.asks[i];
                        const bidDepth = depth(bid);
                        const askDepth = depth(ask);
                        return (
                            <tr key={`${bid?.displayPrice ?? '-'}:${ask?.displayPrice ?? '-'}:${i}`}>
                                <td className={styles.splitSizeBid} style={bar(bidDepth.size, 'bid')} title={bid?.displaySize}>
                                    {bid ? formatBookNumber(bid.displaySize) : ''}
                                </td>
                                <td className={styles.splitPriceBid} style={bar(bidDepth.price, 'bid')} title={bid?.displayPrice}>
                                    {priceCell(bid, 'bid')}
                                </td>
                                <td className={styles.splitPriceAsk} style={bar(askDepth.price, 'ask')} title={ask?.displayPrice}>
                                    {priceCell(ask, 'ask')}
                                </td>
                                <td className={styles.splitSizeAsk} style={bar(askDepth.size, 'ask')} title={ask?.displaySize}>
                                    {ask ? formatBookNumber(ask.displaySize) : ''}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {lastPrice ? (
                <p className={styles.splitLast}>
                    <span className={lastDirection === 'positive' ? styles.splitLastUp : lastDirection === 'negative' ? styles.splitLastDown : styles.splitLastFlat}>
                        {formatBookNumber(tidyQuotePrice(lastPrice))}
                        {lastDirection !== 'neutral' ? <span aria-hidden="true">{lastDirection === 'positive' ? ' ▲' : ' ▼'}</span> : null}
                    </span>
                    <span className={styles.splitLastLabel}>{t('components.orderbookPanel.lastTrade')}</span>
                </p>
            ) : null}
        </>
    );
}

function formatBookNumber(value) {
    return formatWithThousands(trimAmountTail(value));
}
