// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Trade page (route `market-trade`), opened by the Market page's Buy and Sell buttons
// or a tapped book price. Swap and Market are one PlaceOrderPanel, so a typed order survives
// a tab switch and both submit through the panel's own guard, confirm and sign path.

import { useEffect, useId, useMemo, useState } from 'react';
import { Button, Icon, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/market.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { PlaceOrderPanel } from '../components/PlaceOrderPanel.jsx';
import { tidyQuotePrice } from '../components/marketTradeParts.jsx';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.jsx';
import { normalizeOrderbook } from '../../market/orderbook.js';
import { sampleMatchesFor, sampleOrderbookFor } from '../../market/sampleMarketData.js';
import { normalizeMarketHistoryRowExact } from '../../market/history_rows.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import { startVisibleInterval } from '../utils/visibleInterval.js';
import {
    compareDecimalStrings,
    divideDecimalStrings,
    formatWithThousands,
    multiplyDecimalStrings,
    subtractDecimalStrings,
    trimAmountTail,
} from '../utils/amountFormat.js';
import receivePickerStyles from './TokenPicker.module.css';
import styles from './MarketTrade.module.css';

const QUOTE_POLL_MS = 5000;

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {'buy' | 'sell'} [props.side]
 * @param {'swap' | 'market'} [props.mode]
 * @param {string | null} [props.price]      a picked order-book price (opens Market mode at Limit)
 * @param {number} [props.pick]              counts book picks, so the same price picked again refills
 * @param {() => void} props.onBack
 */
export function MarketTrade({ walletId, chainId, tick1, tick2, side: initialSide = 'buy', mode: initialMode = 'swap', price: pickedPrice = null, pick, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const tabsId = useId();
    const demo = flowsLib.isDemoWallet(walletId);
    const [side, setSide] = useState(/** @type {'buy' | 'sell'} */ (initialSide === 'sell' ? 'sell' : 'buy'));
    const [mode, setMode] = useState(/** @type {'swap' | 'market'} */ (pickedPrice ? 'market' : (initialMode === 'market' ? 'market' : 'swap')));
    const [quoteKey, setQuoteKey] = useState(0);

    // The best bid and ask, polled like the order book itself so Market
    // orders and Fill now take a current quote.
    const [book, setBook] = useState(/** @type {{ bid: string | null, ask: string | null }} */ ({ bid: null, ask: null }));
    const [bookError, setBookError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        let requestId = 0;
        const read = async () => {
            const current = ++requestId;
            try {
                const resp = await messaging.getOrderbook({ chainId, tick1, tick2 });
                if (cancelled || current !== requestId) return;
                let normalized = normalizeOrderbook(resp);
                if (demo && normalized.bids.length === 0 && normalized.asks.length === 0) {
                    normalized = normalizeOrderbook(sampleOrderbookFor(tick1, tick2));
                }
                setBook({ bid: normalized.bids[0]?.displayPrice ?? null, ask: normalized.asks[0]?.displayPrice ?? null });
                setBookError(null);
            } catch (err) {
                if (cancelled || current !== requestId) return;
                if (demo) {
                    const sample = normalizeOrderbook(sampleOrderbookFor(tick1, tick2));
                    setBook({ bid: sample.bids[0]?.displayPrice ?? null, ask: sample.asks[0]?.displayPrice ?? null });
                }
                setBookError(readFailureMessage(err, 'load the order book'));
            }
        };
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') read();
        const stop = startVisibleInterval(read, QUOTE_POLL_MS);
        return () => {
            cancelled = true;
            stop();
        };
    }, [messaging, chainId, tick1, tick2, demo, quoteKey]);

    // The last trade and its 24h move, from the same history feed the Market
    // page reads.
    const [historyRows, setHistoryRows] = useState(/** @type {any[]} */ ([]));
    const [historyError, setHistoryError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        setHistoryError(null);
        messaging.getMarketHistory({ chainId, tick1, tick2 })
            .then((resp) => {
                if (cancelled) return;
                const rows = historyRowsOf(resp);
                setHistoryRows(rows.length > 0 ? rows : (demo ? sampleMatchesFor(tick1, tick2) : []));
            })
            .catch((err) => {
                if (cancelled) return;
                setHistoryRows(demo ? sampleMatchesFor(tick1, tick2) : []);
                setHistoryError(readFailureMessage(err, 'refresh market prices'));
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2, demo, quoteKey]);
    const last = useMemo(() => lastAndChange(historyRows, tick1, tick2), [historyRows, tick1, tick2]);
    const change = percentChangeDisplay(last.changePct);

    const failed = [bookError ? 'order book' : null, historyError ? 'prices' : null].filter(Boolean);

    return (
        <Screen
            variant={variant}
            header={<PageHeader onBack={onBack} title={t('market.trade.title', { pair: `${tick1}/${tick2}` })} />}
        >
            <ListPage className={styles.page}>
                {failed.length > 0 ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: t('common.tryAgain'), onAction: () => setQuoteKey((key) => key + 1) }}
                    >
                        {t('market.trade.loadFailed', { list: failed.join(t('market.trade.orThe')) })}
                    </StatusMessage>
                ) : null}

                <section className={styles.tiles} aria-label={t('market.trade.prices')}>
                    <div className={styles.tile}>
                        <span className={styles.tileLabel}>
                            {t('market.trade.last')}
                            {change ? (
                                <span className={change.direction === 'positive' ? styles.up : change.direction === 'negative' ? styles.down : styles.flat}>
                                    {change.direction === 'positive' ? ' ▲ ' : change.direction === 'negative' ? ' ▼ ' : ' '}
                                    {change.text.replace(/^[+-]/, '')}
                                </span>
                            ) : null}
                        </span>
                        <span className={styles.tileValue}>{formatQuote(last.price)}</span>
                    </div>
                    <div className={styles.tile}>
                        <span className={styles.tileLabel}>{t('market.trade.bestBid')}</span>
                        <span className={`${styles.tileValue} ${styles.up}`}>{formatQuote(book.bid)}</span>
                    </div>
                    <div className={styles.tile}>
                        <span className={styles.tileLabel}>{t('market.trade.bestAsk')}</span>
                        <span className={`${styles.tileValue} ${styles.down}`}>{formatQuote(book.ask)}</span>
                    </div>
                </section>

                {/* The mode tabs sit right above the form they switch. */}
                <div className={styles.modeBlock}>
                    <div
                        className={receivePickerStyles.kindSegments}
                        role="tablist"
                        aria-label={t('market.trade.mode')}
                        style={{ width: '100%' }}
                    >
                        {[
                            { id: 'swap', label: 'Swap', icon: <Icon.SwapIcon /> },
                            { id: 'market', label: 'Market', icon: <Icon.LineChartIcon /> },
                        ].map((opt) => {
                            const active = mode === opt.id;
                            return (
                                <Button
                                    key={opt.id}
                                    id={`${tabsId}-tab-${opt.id}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    aria-controls={`${tabsId}-panel`}
                                    tabIndex={active ? 0 : -1}
                                    className={`${receivePickerStyles.kindSegment} ${active ? receivePickerStyles.kindSegmentActive : ''}`}
                                    style={{ flex: 1 }}
                                    onClick={() => setMode(/** @type {'swap' | 'market'} */ (opt.id))}
                                    icon={opt.icon}
                                >
                                    {opt.label}
                                </Button>
                            );
                        })}
                    </div>
                    <div
                        id={`${tabsId}-panel`}
                        role="tabpanel"
                        aria-labelledby={`${tabsId}-tab-${mode}`}
                        className={styles.formCard}
                    >
                        <RouteErrorBoundary variant="compact" resetKey={`${chainId}:${tick1}:${tick2}:trade`}>
                            <PlaceOrderPanel
                                key={`${chainId}:${tick1}:${tick2}`}
                                walletId={walletId}
                                chainId={chainId}
                                tick1={tick1}
                                tick2={tick2}
                                layout="trade"
                                view={mode}
                                side={side}
                                onSideChange={setSide}
                                bestBid={book.bid}
                                bestAsk={book.ask}
                                lastPrice={last.price}
                                prefillPrice={pickedPrice}
                                prefillPick={pick}
                                initialOrderType="limit"
                            />
                        </RouteErrorBoundary>
                    </div>
                </div>
            </ListPage>
        </Screen>
    );
}

function historyRowsOf(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    for (const key of ['data', 'rows', 'history']) if (Array.isArray(resp[key])) return resp[key];
    return [];
}

/** The newest trade price and its change since the first trade of the last 24h. */
function lastAndChange(rows, tick1, tick2) {
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    let price = null;
    let lastTs = -Infinity;
    let first = null;
    let firstTs = Infinity;
    for (const row of rows || []) {
        const parsed = normalizeMarketHistoryRowExact(row, tick1, tick2);
        if (!parsed) continue;
        if (parsed.timestamp > lastTs) { lastTs = parsed.timestamp; price = parsed.price; }
        if (parsed.timestamp >= dayAgo && parsed.timestamp < firstTs) { firstTs = parsed.timestamp; first = parsed.price; }
    }
    const diff = price !== null && first !== null && compareDecimalStrings(first, '0') === 1
        ? subtractDecimalStrings(price, first)
        : null;
    const pct = diff === null ? null : divideDecimalStrings(multiplyDecimalStrings(diff, '100'), first, 8);
    // The starting limit price and the Last tile read the tidied price.
    return { price: tidyQuotePrice(price), changePct: pct === null ? NaN : Number(pct) };
}

function formatQuote(value) {
    if (value === null || value === undefined || compareDecimalStrings(value, '0') === null) return '-';
    return formatWithThousands(trimAmountTail(value));
}
