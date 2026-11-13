// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, PageHeader, Screen, SegmentedControl, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/market.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/settings.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { OrderbookPanel } from '../components/OrderbookPanel.jsx';
import { RecentTradesPanel } from '../components/RecentTradesPanel.jsx';
import { OpenOrdersPanel } from '../components/OpenOrdersPanel.jsx';
import { TradeHistoryPanel } from '../components/TradeHistoryPanel.jsx';
import { BuyGlyph, SellGlyph } from '../components/marketTradeParts.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.jsx';
import { PageLoadFailureScope, andList, usePageLoadFailures } from '../components/pageLoadFailures.jsx';
// The Token detail page's blue card with the price chart behind it,
// built from the same pieces (hero, chart-behind styles, Sparkline, range tabs).
import { Sparkline } from '../components/Sparkline.jsx';
import { BEHIND_CHART_FILL, BEHIND_CHART_STROKE, ChartRangeTabs, RANGES as CHART_RANGES, defaultRangeId } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import heroStyles from '../components/TotalBalanceHero.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { bucketizeMatches } from '../../market/bucketize.js';
import { MarketTrade } from './MarketTrade.jsx';
import { sampleMatchesFor } from '../../market/sampleMarketData.js';
import { normalizeMarketHistoryRowExact } from '../../market/history_rows.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import {
    compareDecimalStrings,
    divideDecimalStrings,
    multiplyDecimalStrings,
    roundDecimalString,
    subtractDecimalStrings,
    sumDecimalStrings,
} from '../utils/amountFormat.js';
import receivePickerStyles from './TokenPicker.module.css';
import styles from './MarketView.module.css';

/**
 * Market view (§41.3). Trading surface for a single market.
 *
 * Top to bottom: the blue card (pair, last price, range move, 24h figures, chart behind it
 * with range, star and reverse-pair buttons), full-width Buy and Sell buttons, then the
 * Book, Trades and My orders tabs. Buy, Sell and a tapped book price open the Trade page
 * (route `market-trade`, MarketTrade.jsx), where the order form lives.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {() => void} props.onBack
 * @param {() => void} [props.onSwap] renders the reverse-pair control; reopens the market with tick1/tick2 flipped
 * @param {(trade: { side: 'buy' | 'sell', mode: 'swap' | 'market', price?: string, pick?: number }) => void} [props.onTrade]
 *   Opens the Trade page route (web, desktop and the extension popup route it).
 *   A host that leaves it out (an embedded Market view) opens the page in place here.
 */
export function MarketView({ walletId, chainId, tick1, tick2, onBack, onSwap, onTrade }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const tabsId = useId();
    const captionId = useId();
    const chartPanelId = useId();
    // Demo wallets get sample feeds so the trading surface is fully
    // populated without live liquidity. Real wallets show live data and
    // the panels' own empty states, never fabricated prices/trades.
    const demo = flowsLib.isDemoWallet(walletId);

    const [summaryLoading, setSummaryLoading] = useState(true);
    const [summaryError, setSummaryError] = useState(/** @type {string | null} */ (null));
    const [marketMissing, setMarketMissing] = useState(false);
    // A book pick carries a count, so picking the same price again
    // after editing it fills the field again on the Trade page.
    const pickRef = useRef(0);
    const [tab, setTab] = useState(/** @type {'book' | 'trades' | 'orders'} */ ('book'));
    const [ordersView, setOrdersView] = useState(/** @type {'open' | 'filled'} */ ('open'));
    // The Trade page shown in place, for a shell with no route for it.
    const [localTrade, setLocalTrade] = useState(/** @type {any} */ (null));
    // The market, price and order-book loads share one page error and one reload.
    const loadFailures = usePageLoadFailures();
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setSummaryLoading(true);
        setSummaryError(null);
        setMarketMissing(false);
        messaging.getMarket({ chainId, tick1, tick2 })
            .then((summary) => {
                if (!cancelled) {
                    setSummaryLoading(false);
                    setMarketMissing(summary == null);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setSummaryLoading(false);
                    setSummaryError(readFailureMessage(err, 'load this market'));
                }
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2, reloadKey]);

    useEffect(() => {
        setLocalTrade(null);
    }, [chainId, tick1, tick2]);

    const openTrade = (trade) => {
        if (typeof onTrade === 'function') onTrade(trade);
        else setLocalTrade(trade);
    };

    // Header 24h stats (last / change / high / low / volume) derive from
    // the live getMarketHistory feed, the same data the chart + trades
    // panel render. Demo wallets fall back to sample matches; real wallets
    // show real stats, or blanks (empty) when the market has no fills yet.
    const [historyRows, setHistoryRows] = useState(/** @type {any[]} */ ([]));
    const [historyError, setHistoryError] = useState(/** @type {string | null} */ (null));
    const [historyRetryKey, setHistoryRetryKey] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setHistoryRows([]);
        setHistoryError(null);
        messaging.getMarketHistory({ chainId, tick1, tick2 })
            .then((resp) => {
                if (cancelled) return;
                const real = extractHistoryRows(resp);
                setHistoryRows(real.length > 0 ? real : (demo ? sampleMatchesFor(tick1, tick2) : []));
            })
            .catch((err) => {
                if (!cancelled) {
                    setHistoryRows(demo ? sampleMatchesFor(tick1, tick2) : []);
                    setHistoryError(readFailureMessage(err, 'refresh market prices'));
                }
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2, demo, historyRetryKey, reloadKey]);
    const stats = useMemo(() => derive24hStats(historyRows, tick1, tick2), [historyRows, tick1, tick2]);
    const lastPrice = stats.lastPrice;
    const priceIsStale = stats.lastTimestamp !== null
        && stats.lastTimestamp < Math.floor(Date.now() / 1000) - 86400;
    const changeDisplay = percentChangeDisplay(stats.changePct);
    const marketKey = `${chainId}:${tick1}:${tick2}`;
    const panelKey = `${marketKey}:${reloadKey}`;
    const { report: reportFailure } = loadFailures;
    useEffect(() => {
        reportFailure('market details', Boolean(summaryError));
        reportFailure('prices', Boolean(historyError));
    }, [reportFailure, summaryError, historyError]);
    const failedLoads = LOAD_ORDER.filter((label) => loadFailures.failed.includes(label));

    // The chart behind the card plots the trade history's closing
    // prices over the selected range, and the card's pill shows that range's move.
    const [rangeId, setRangeId] = useState(defaultRangeId());
    const range = MARKET_RANGES.find((r) => r.id === rangeId) || MARKET_RANGES[1];
    const series = useMemo(() => rangeSeries(historyRows, tick1, tick2, range), [historyRows, tick1, tick2, range]);
    const rangeMove = useMemo(() => seriesMove(series), [series]);

    // The card's star is the Markets list's watchlist star.
    const canStar = typeof messaging.listWatchlistForWallet === 'function'
        && typeof messaging.saveWatchlistEntry === 'function'
        && typeof messaging.clearWatchlistEntry === 'function';
    const [starEntries, setStarEntries] = useState(/** @type {any[]} */ ([]));
    const [starBusy, setStarBusy] = useState(false);
    const loadStars = useCallback(async () => {
        if (!canStar) return;
        try {
            const rows = await messaging.listWatchlistForWallet({ walletId });
            setStarEntries((Array.isArray(rows) ? rows : []).filter(
                (e) => e.chainId === chainId && e.tick1 === tick1 && e.tick2 === tick2,
            ));
        } catch { /* keep the star as it was; a failed read says nothing about it */ }
    }, [canStar, messaging, walletId, chainId, tick1, tick2]);
    useEffect(() => { loadStars(); }, [loadStars]);
    const starred = starEntries.length > 0;
    const toggleStar = async () => {
        if (starBusy) return;
        setStarBusy(true);
        try {
            if (starred) {
                for (const e of starEntries) await messaging.clearWatchlistEntry({ id: e.id });
            } else {
                await messaging.saveWatchlistEntry({ walletId, chainId, tick1, tick2 });
            }
            await loadStars();
        } catch { /* the star shows the stored state on the next read */ }
        finally { setStarBusy(false); }
    };

    if (localTrade) {
        return (
            <MarketTrade
                walletId={walletId}
                chainId={chainId}
                tick1={tick1}
                tick2={tick2}
                side={localTrade.side}
                mode={localTrade.mode}
                price={localTrade.price ?? null}
                pick={localTrade.pick}
                onBack={() => setLocalTrade(null)}
            />
        );
    }

    const header = (
        <PageHeader
            onBack={onBack}
            title={`${tick1}/${tick2}`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage className={styles.page}>
                {failedLoads.length > 0 ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: t('common.tryAgain'), onAction: () => setReloadKey((key) => key + 1) }}
                    >
                        {t('market.loadFailed', { list: andList(failedLoads) })}
                    </StatusMessage>
                ) : null}
                <PageLoadFailureScope report={reportFailure}>{children}</PageLoadFailureScope>
            </ListPage>
        </Screen>
    );

    const pillClass = rangeMove?.direction === 'positive'
        ? heroStyles.changePositive
        : rangeMove?.direction === 'negative' ? heroStyles.changeNegative : heroStyles.changeNeutral;
    const headerCard = (
        <div className={`${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart}`}>
            <section className={heroStyles.hero} aria-labelledby={captionId}>
                <div className={`${heroStyles.row} ${heroStyles.rowWithActions}`}>
                    <span id={captionId} className={`${heroStyles.label} ${heroStyles.walletLabel} ${styles.caption}`}>
                        <span className={styles.pairIcons} aria-hidden="true">
                            <TickerIcon chainId={chainId} tick={tick1} size={28} />
                            <TickerIcon chainId={chainId} tick={tick2} size={28} />
                        </span>
                        <span className={styles.captionText}>{tick1} / {tick2}</span>
                    </span>
                    <div className={heroStyles.amount} aria-label={`${formatPrice(lastPrice)} ${tick2}`}>
                        <span className={heroStyles.amountValue}>{formatPrice(lastPrice)}</span>
                        <span className={heroStyles.amountCode}>{tick2}</span>
                    </div>
                    <div className={`${heroStyles.actions} ${heroStyles.inlineActions}`}>
                        {canStar ? (
                            <Button
                                type="button"
                                className={heroStyles.eye}
                                onClick={toggleStar}
                                disabled={starBusy}
                                aria-pressed={starred ? 'true' : 'false'}
                                aria-label={starred ? t('market.removeFromWatchlist') : t('market.addToWatchlist')}
                                title={starred ? t('market.removeFromWatchlist') : t('market.addToWatchlist')}
                                icon={<StarGlyph filled={starred} />}
                            >
                                {null}
                            </Button>
                        ) : null}
                        {typeof onSwap === 'function' ? (
                            <Button
                                type="button"
                                className={heroStyles.eye}
                                icon={<Icon.SwapIcon />}
                                onClick={onSwap}
                                aria-label={t('market.reversePair', { pair: `${tick2}/${tick1}` })}
                                title={t('market.reverseTitle', { pair: `${tick2}/${tick1}` })}
                            >
                                {null}
                            </Button>
                        ) : null}
                    </div>
                </div>
                <div className={heroStyles.meta}>
                    <span className={heroStyles.metaLeft}>
                        {rangeMove ? (
                            <span className={pillClass} aria-label={t('market.rangeChangeLabel', { range: range.label, change: rangeMove.label })}>
                                {rangeMove.text}
                            </span>
                        ) : (
                            <span className={`${heroStyles.hiddenChange} ${styles.pillIdle}`} aria-hidden="true">••••</span>
                        )}
                    </span>
                </div>
                {/* The 24h figures the old summary card listed, on one line. */}
                <p className={styles.heroStats}>
                    <span>{t('market.stats.high24h')} {formatPrice(stats.high)}</span>
                    <span>{t('market.stats.low24h')} {formatPrice(stats.low)}</span>
                    <span>{t('market.stats.volume24h')} {formatVolume(stats.volume)} {tick1}</span>
                    {changeDisplay ? (
                        <span aria-label={t('market.change24hLabel', { change: changeDisplay.label })}>{t('market.change24hShort', { change: changeDisplay.text })}</span>
                    ) : null}
                </p>
            </section>
            <section
                className={`${portfolioChartStyles.wrap} ${portfolioChartStyles.behind}`}
                data-chart-behind="true"
                aria-label={t('market.priceChartLabel', { pair: `${tick1}/${tick2}` })}
            >
                <div id={chartPanelId} role="tabpanel" aria-labelledby={`${chartPanelId}-tab-${range.id}`}>
                    <div className={portfolioChartStyles.slot}>
                        {series ? (
                            <div className={portfolioChartStyles.chart}>
                                <Sparkline
                                    series={series}
                                    height="100%"
                                    strokeColor={BEHIND_CHART_STROKE}
                                    areaFill={BEHIND_CHART_FILL}
                                    edgeToEdge
                                    rangeLabel={range.label}
                                    label={t('market.priceLabel', { pair: `${tick1}/${tick2}` })}
                                    formatValue={(value) => `${formatPrice(String(value))} ${tick2}`}
                                />
                            </div>
                        ) : null}
                    </div>
                </div>
                <ChartRangeTabs
                    panelId={chartPanelId}
                    ranges={MARKET_RANGES}
                    rangeId={range.id}
                    onSelect={setRangeId}
                />
            </section>
        </div>
    );

    if (marketMissing) {
        return wrap(
            <EmptyState
                title={t('market.notFound.title')}
                body={t('market.notFound.body')}
            />,
        );
    }

    return wrap(
        <div className={styles.layout}>
            {/* Two columns on a wide screen (card and Buy / Sell on the left, the tabs and
                their panel on the right), one column otherwise. A stale or failed-price
                notice under the card takes the column's gap. */}
            <div className={styles.column}>
            <div
                role="region"
                aria-label={t('market.summary')}
                aria-busy={summaryLoading || undefined}
                className={styles.summary}
            >
                {summaryLoading ? (
                    <div role="status" aria-label={t('market.loading')}>
                        <Skeleton height={190} />
                    </div>
                ) : (
                    <>
                        <RouteErrorBoundary variant="compact" resetKey={`${marketKey}:ticker`}>
                            {headerCard}
                        </RouteErrorBoundary>
                        {failedLoads.length === 0 && priceIsStale ? (
                            <StatusMessage
                                recovery={{
                                    label: t('market.refreshPrices'),
                                    onAction: () => setHistoryRetryKey((key) => key + 1),
                                }}
                            >
                                {t('market.stalePrice')}
                            </StatusMessage>
                        ) : null}
                    </>
                )}
            </div>

            {/* Buy and Sell open the Trade page on that side. */}
            <div className={styles.tradeButtons}>
                <Button
                    type="button"
                    variant="success"
                    block
                    icon={<BuyGlyph />}
                    className={styles.tradeButton}
                    onClick={() => openTrade({ side: 'buy', mode: 'swap' })}
                >
                    {t('components.placeOrderPanel.buy')}
                </Button>
                <Button
                    type="button"
                    variant="danger"
                    block
                    icon={<SellGlyph />}
                    className={styles.tradeButton}
                    onClick={() => openTrade({ side: 'sell', mode: 'swap' })}
                >
                    {t('components.placeOrderPanel.sell')}
                </Button>
            </div>
            </div>

            <div className={styles.column}>
            <div
                className={`${receivePickerStyles.kindSegments} ${styles.panelTabs}`}
                role="tablist"
                aria-label={t('market.panels')}
                style={{ width: '100%' }}
            >
                {[
                    { id: 'book',   label: 'Book',      icon: <Icon.BookIcon /> },
                    { id: 'trades', label: 'Trades',    icon: <Icon.SwapIcon /> },
                    { id: 'orders', label: 'My Orders', icon: <Icon.TokenListIcon /> },
                ].map((opt) => {
                    const active = tab === opt.id;
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
                            onClick={() => setTab(/** @type {any} */ (opt.id))}
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
                aria-labelledby={`${tabsId}-tab-${tab}`}
                className={styles.panel}
            >
                <RouteErrorBoundary variant="compact" resetKey={`${marketKey}:${tab}`}>
                    {tab === 'book' ? (
                        <OrderbookPanel
                            key={panelKey}
                            chainId={chainId}
                            tick1={tick1}
                            tick2={tick2}
                            demo={demo}
                            layout="split"
                            lastPrice={lastPrice}
                            lastDirection={changeDisplay?.direction ?? 'neutral'}
                            onPickPrice={(price, side) => {
                                // A tapped ask buys at it and a tapped bid
                                // sells into it, as a Limit order at that price.
                                pickRef.current += 1;
                                openTrade({ side: side === 'bid' ? 'sell' : 'buy', mode: 'market', price, pick: pickRef.current });
                            }}
                        />
                    ) : null}
                    {tab === 'trades' ? (
                        <RecentTradesPanel key={panelKey} chainId={chainId} tick1={tick1} tick2={tick2} demo={demo} />
                    ) : null}
                    {tab === 'orders' ? (
                        <>
                            {/* Open | Filled sits right above the list it switches. */}
                            <SegmentedControl
                                className={styles.ordersSwitch}
                                aria-label={t('market.myOrders')}
                                value={ordersView}
                                onChange={setOrdersView}
                                items={[
                                    { id: 'open', label: <span className={styles.segLabel}><Icon.ClockIcon />{t('settings.developer.open')}</span> },
                                    { id: 'filled', label: <span className={styles.segLabel}><Icon.CheckIcon />{t('components.openOrdersPanel.filled')}</span> },
                                ]}
                            />
                            {ordersView === 'open' ? (
                                <OpenOrdersPanel
                                    key={marketKey}
                                    walletId={walletId}
                                    chainId={chainId}
                                    tick1={tick1}
                                    tick2={tick2}
                                />
                            ) : (
                                <TradeHistoryPanel
                                    key={marketKey}
                                    walletId={walletId}
                                    chainId={chainId}
                                    tick1={tick1}
                                    tick2={tick2}
                                />
                            )}
                        </>
                    ) : null}
                </RouteErrorBoundary>
            </div>
            </div>
        </div>,
    );
}

// The order the page error names what could not load.
const LOAD_ORDER = ['market details', 'prices', 'order book', 'recent trades'];

// The card's range buttons, each with the window it plots and the
// bucket its closes are taken at. YTD is left out.
const RANGE_WINDOWS = {
    '24h': { window: 86400, bucket: 3600 },
    '1w': { window: 7 * 86400, bucket: 4 * 3600 },
    '1m': { window: 30 * 86400, bucket: 86400 },
    '3m': { window: 90 * 86400, bucket: 86400 },
    '6m': { window: 180 * 86400, bucket: 2 * 86400 },
    '1y': { window: 365 * 86400, bucket: 7 * 86400 },
    all: { window: Infinity, bucket: 7 * 86400 },
};
const MARKET_RANGES = CHART_RANGES.filter((r) => RANGE_WINDOWS[r.id]);

/**
 * Closing prices over the range. A range with fewer than two
 * buckets starts from the close before it, so a quiet market still draws a
 * line from its last trade. Null with no trades at all.
 */
function rangeSeries(rows, tick1, tick2, range) {
    const spec = RANGE_WINDOWS[range.id];
    if (!spec) return null;
    const candles = bucketizeMatches(rows, { tick1, tick2, periodSeconds: spec.bucket });
    if (candles.length === 0) return null;
    const since = Math.floor(Date.now() / 1000) - spec.window;
    const inside = candles.filter((c) => c.time >= since).map((c) => c.close);
    const before = candles.filter((c) => c.time < since);
    const lead = before.length > 0 ? [before[before.length - 1].close] : [];
    const out = inside.length >= 2 ? inside : [...lead, ...inside];
    if (out.length === 0) return null;
    return out.length === 1 ? [out[0], out[0]] : out;
}

/** First-to-last move of the plotted series, as the card's pill text. */
function seriesMove(series) {
    if (!Array.isArray(series) || series.length < 2) return null;
    const first = series[0];
    const last = series[series.length - 1];
    if (!(first > 0) || !Number.isFinite(last)) return null;
    const pct = ((last - first) / first) * 100;
    const display = percentChangeDisplay(pct);
    if (!display) return null;
    const diff = Math.abs(last - first);
    const arrow = display.direction === 'positive' ? '▲ ' : display.direction === 'negative' ? '▼ ' : '';
    return {
        direction: display.direction,
        label: display.label,
        text: `${arrow}${formatPrice(diff.toFixed(12))} (${display.text})`,
    };
}

// The watchlist star (outline, or filled when starred).
function StarGlyph({ filled }) {
    return (
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z" />
        </svg>
    );
}

/** Normalize the explorer's getMarketHistory response into a row array. */
function extractHistoryRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.history)) return resp.history;
    return [];
}

/**
 * Walk a list of match rows and compute last price, 24h change, 24h
 * high/low, and 24h volume (in tick1).
 *
 * Each projected match row carries `price`, `amount`, `type`, and a timestamp.
 * Raw give/get rows remain accepted for older explorers.
 */
function derive24hStats(rows, tick1, tick2) {
    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 86400;
    let lastPrice = null;
    let lastTs = -Infinity;
    let firstPriceIn24h = null;
    let firstTsIn24h = Infinity;
    let high = null;
    let low = null;
    let volume = '0';
    for (const row of rows || []) {
        const parsed = normalizeMarketHistoryRowExact(row, tick1, tick2);
        if (!parsed) continue;
        const { price, amount: sizeT1, timestamp: ts } = parsed;
        if (ts > lastTs) { lastTs = ts; lastPrice = price; }
        if (ts >= dayAgo) {
            if (ts < firstTsIn24h) { firstTsIn24h = ts; firstPriceIn24h = price; }
            if (high === null || compareDecimalStrings(price, high) === 1) high = price;
            if (low === null || compareDecimalStrings(price, low) === -1) low = price;
            volume = sumDecimalStrings([volume, sizeT1]);
        }
    }
    const change = lastPrice !== null && compareDecimalStrings(firstPriceIn24h, '0') === 1
        ? subtractDecimalStrings(lastPrice, firstPriceIn24h)
        : null;
    const changePctText = change === null
        ? null
        : divideDecimalStrings(multiplyDecimalStrings(change, '100'), firstPriceIn24h, 8);
    return {
        lastPrice,
        lastTimestamp: Number.isFinite(lastTs) ? lastTs : null,
        changePct: changePctText === null ? NaN : Number(changePctText),
        high,
        low,
        volume,
    };
}

function formatPrice(n) {
    if (compareDecimalStrings(n, '0') === null) return '-';
    if (compareDecimalStrings(n, '0') === 0) return '0';
    if (compareDecimalStrings(n, '1') >= 0) return roundDecimalString(n, 4);
    if (compareDecimalStrings(n, '0.01') >= 0) return roundDecimalString(n, 6);
    return roundDecimalString(n, 8);
}

function formatVolume(n) {
    if (compareDecimalStrings(n, '0') !== 1) return '0';
    if (compareDecimalStrings(n, '1000000') >= 0) {
        return `${divideDecimalStrings(n, '1000000', 2)}M`;
    }
    if (compareDecimalStrings(n, '1000') >= 0) {
        return `${divideDecimalStrings(n, '1000', 2)}K`;
    }
    return roundDecimalString(n, 0);
}
