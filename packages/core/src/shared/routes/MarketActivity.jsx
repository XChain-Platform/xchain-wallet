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
import { Button, EmptyState, Icon, IconSelect, ListPage, ListRow, PageHeader, Screen, Skeleton, Tabs } from '@xchain-wallet/core/ui';
import { InPageScreen } from '@xchain-wallet/core/ui/navHistory.js';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { useSettings } from '../hooks/useSettings.js';
import { getLocale } from '../../i18n/index.js';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { RelativeTime } from '../components/RelativeTime.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { useOracleFeeds } from '../hooks/useOracleFeeds.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';
import {
    dispenserRateLabel,
    formatDecimal,
    isCompleteSwap,
    isDispenserPriceStale,
    isOpenDispenserSelling,
    isOpenOffer,
} from '../utils/dispenserPricing.js';
import styles from './MarketActivity.module.css';
import { compareDecimalStrings, decimalFromBaseUnits, formatWithThousands, sumDecimalStrings, trimAmountTail } from '../utils/amountFormat.js';
import { actionRowIdentity, uniqueRows } from '../utils/pagedRows.js';
// The Market page's blue card pieces, its Buy and Sell glyphs and its Trade
// page, plus this page's own merge-and-sort helpers.
import { BuyGlyph, SellGlyph, tidyQuotePrice } from '../components/marketTradeParts.jsx';
import { DispenserGlyph, mergedOffers, tickText, tradePoints } from '../components/tokenMarketParts.jsx';
import { MarketTrade } from './MarketTrade.jsx';
import { formatCompactChartValue, Sparkline } from '../components/Sparkline.jsx';
import { BEHIND_CHART_FILL, BEHIND_CHART_STROKE, ChartRangeTabs, RANGES as CHART_RANGES, defaultRangeId } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import heroStyles from '../components/TotalBalanceHero.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import { readActiveAccount } from '../utils/activeAccountMemory.js';
import { chainReadFailed } from '../utils/walletBalanceShape.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import {
    LIST_DETAIL_MIN_WIDTH,
    ListDetailSplit,
    listDetailStyles,
    useWideContent,
} from '../components/PanelSplit.jsx';

const chainRegistry = registryLib.defaultRegistry();
const ACTIVITY_PAGE_SIZE = 50;

// Featured market shown on landing (same for everyone, independent of
// holdings): XChain's own token. Tapping the header swaps it for any
// other coin/token via the shared picker.
const FEATURED_MARKET = { tick: 'XCHAIN', displayName: 'XChain', chainId: null, imageUrl: null };

// A feed row that is not an object cannot be read, so it is dropped here
// instead of failing every section below.
function extractRows(resp) {
    const rows = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [];
    return rows.filter((row) => row !== null && typeof row === 'object');
}

const byTimeDesc = (a, b) => {
    const ta = Number(a.row?.timestamp || a.row?.block_time || 0);
    const tb = Number(b.row?.timestamp || b.row?.block_time || 0);
    return tb - ta;
};

// The card's range buttons and the window each one plots. YTD is left out,
// as on the Market page.
const RANGE_WINDOWS = {
    '24h': 86400,
    '1w': 7 * 86400,
    '1m': 30 * 86400,
    '3m': 90 * 86400,
    '6m': 180 * 86400,
    '1y': 365 * 86400,
    all: Infinity,
};
const MARKET_RANGES = CHART_RANGES.filter((r) => RANGE_WINDOWS[r.id]);

/**
 * §41/§42: Marketplace.
 *
 * Top to bottom: the blue card (token, last traded price, the selected
 * range's move, this wallet's holding, the price chart behind it), full-width
 * Buy and Sell, then tabs Offers (open dispensers and DEX orders, cheapest
 * first), Swaps (completed DEX swaps) and Trades (recent dispenses). Tapping
 * the token opens the shared {@link TokenPicker} to switch markets.
 *
 * Buy opens the cheapest offer: a dispenser's detail page, or the Trade page
 * (MarketTrade, shown in place since the shells route no Trade page here) at
 * an order's price. Sell opens the Trade page on the sell side, at the best
 * open buy order's price when there is one.
 *
 * @param {object} props
 * @param {string} [props.walletId]  active wallet; when it's the demo
 *        wallet, feeds come from {@link flowsLib.synthesizeDemoMarketActivity}
 *        instead of the live explorer.
 * @param {string} [props.accountId]
 * @param {() => void} props.onBack
 * @param {(chainId: string, actionIndex: string) => void} [props.onOpenDispenser]
 */
export function MarketActivity({ walletId, accountId, onBack, onOpenDispenser }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const tabsId = useId();
    const chartPanelId = useId();
    const [layoutRef, wideContent] = useWideContent(LIST_DETAIL_MIN_WIDTH, true);
    const twoPanel = wideContent;
    const marketPickedRef = useRef(false);
    const [marketQuery, setMarketQuery] = useState('');
    const [marketNetwork, setMarketNetwork] = useState('all');
    const [marketKind, setMarketKind] = useState(/** @type {'all' | 'coins' | 'tokens'} */ ('all'));

    // Live registry read (re-rendered on every descriptor mutation), so a
    // synced chain reaches the market picker without a restart. Scoped to
    // the active network like the Dispenser explorer: the registry knows
    // every network, and a wallet on Regtest must neither query mainnet
    // feeds nor badge the featured token with the mainnet coin. Empty while
    // settings load, so nothing escapes the filter; a shell that cannot read
    // settings gets the default network.
    const { settings, loading: settingsLoading } = useSettings();
    const numberLocale = settings?.language || getLocale();
    const supportedChains = useSupportedChains(chainRegistry);
    const chains = useMemo(() => {
        if (settingsLoading) return [];
        return flowsLib.filterChainIdsByActiveNetwork(supportedChains.map((d) => d.id), settings, chainRegistry);
    }, [supportedChains, settings, settingsLoading]);
    // A representative chain for the featured-token icon (prefer Bitcoin).
    const defaultChainId = useMemo(
        () => chains.find((id) => coinFromChainId(id) === 'bitcoin') || chains[0] || null,
        [chains],
    );
    // The chain order offers are grouped in, the preferred chain first.
    const chainOrder = useMemo(
        () => (defaultChainId ? [defaultChainId, ...chains.filter((id) => id !== defaultChainId)] : chains),
        [chains, defaultChainId],
    );
    const marketCoinFamilies = useMemo(() => {
        const seen = new Set(chains.map(coinFromChainId).filter(Boolean));
        const ordered = ['bitcoin', 'litecoin', 'dogecoin'].filter((coin) => seen.has(coin));
        for (const coin of seen) if (!ordered.includes(coin)) ordered.push(coin);
        return ordered;
    }, [chains]);

    const { offline, recheck } = useNetworkOffline({ walletId });
    const [selected, setSelected] = useState(FEATURED_MARKET);
    const [picking, setPicking] = useState(false);
    const [loading, setLoading] = useState(true);
    const [offers, setOffers] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [sales, setSales] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexOrders, setDexOrders] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexSwaps, setDexSwaps] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const loadedMarketKeyRef = useRef(/** @type {string | null} */ (null));
    // The Offers list pages dispensers and orders together.
    const [visibleCounts, setVisibleCounts] = useState({
        offers: ACTIVITY_PAGE_SIZE,
        sales: ACTIVITY_PAGE_SIZE,
        swaps: ACTIVITY_PAGE_SIZE,
    });
    // The tab shown under Buy and Sell; Offers first.
    const [tab, setTab] = useState(/** @type {'offers' | 'swaps' | 'trades'} */ ('offers'));
    // The Trade page shown in place (no shell routes one from here).
    const [localTrade, setLocalTrade] = useState(/** @type {any} */ (null));
    const [rangeId, setRangeId] = useState(defaultRangeId());

    const chooseMarket = useCallback((sel) => {
        marketPickedRef.current = true;
        setSelected({
            tick: sel.tick,
            chainId: sel.chainId,
            displayName: sel.displayName,
            imageUrl: sel.imageUrl,
        });
        setTab('offers');
    }, []);
    const chooseFirstMarket = useCallback((sel) => {
        if (marketPickedRef.current) return;
        setSelected((current) => (
            current.tick === sel.tick && current.chainId === sel.chainId
                ? current
                : {
                    tick: sel.tick,
                    chainId: sel.chainId,
                    displayName: sel.displayName,
                    imageUrl: sel.imageUrl,
                }
        ));
        setTab('offers');
    }, []);

    const tick = (selected.tick || '').toUpperCase();

    // Return every feed to its first page when the market changes. This is
    // done while rendering rather than in the load effect: an effect runs
    // after paint, so a Load more click made in that gap queued its update
    // first and the late reset then overwrote it with the first page.
    const marketScope = `${walletId || ''}:${tick}:${chains.join(',')}`;
    const [pageScope, setPageScope] = useState(marketScope);
    if (pageScope !== marketScope) {
        setPageScope(marketScope);
        setVisibleCounts({
            offers: ACTIVITY_PAGE_SIZE,
            sales: ACTIVITY_PAGE_SIZE,
            swaps: ACTIVITY_PAGE_SIZE,
        });
    }

    // Load the selected market on landing and whenever the user picks a
    // different coin/token. Demo wallets are served fabricated feeds; real
    // wallets fan out across every supported chain in parallel.
    useEffect(() => {
        if (!tick || chains.length === 0) return undefined;
        let cancelled = false;
        const marketKey = `${walletId || ''}:${tick}:${chains.join(',')}`;
        const hasCachedRows = loadedMarketKeyRef.current === marketKey;
        setLoading(true);
        if (!hasCachedRows) {
            setOffers(null);
            setSales(null);
            setDexOrders(null);
            setDexSwaps(null);
        }

        if (walletId && flowsLib.isDemoWallet(walletId)) {
            const demo = flowsLib.synthesizeDemoMarketActivity(tick, { chainIds: chains });
            if (!cancelled) {
                setOffers(uniqueRows(demo.offers, marketRowIdentity));
                setSales(uniqueRows(demo.sales, marketRowIdentity));
                setDexOrders(uniqueRows(demo.dexOrders, marketRowIdentity));
                setDexSwaps(uniqueRows(demo.dexSwaps, marketRowIdentity));
                loadedMarketKeyRef.current = marketKey;
                setLoading(false);
            }
            return () => { cancelled = true; };
        }

        // Offline the feeds cannot be read; the screen says so once and
        // loads again when the connection returns.
        if (offline) {
            setLoading(false);
            return () => { cancelled = true; };
        }

        let failed = false;
        const markFailed = () => {
            failed = true;
            return [];
        };
        const offersByChain = chains.map((cid) =>
            messaging.getDispensersForToken({ chainId: cid, token: tick })
                // The explorer's status is a string label ('valid'), which
                // Number() made NaN, so a numeric test here dropped every row.
                .then((resp) => extractRows(resp)
                    .filter((d) => isOpenDispenserSelling(d, tick))
                    .map((row) => ({ chainId: cid, row })))
                .catch(markFailed),
        );
        const salesByChain = chains.map((cid) =>
            typeof messaging.getDispenses === 'function'
                ? messaging.getDispenses({ chainId: cid, query: tick, type: 'token' })
                    // A refused dispense (a barred payer, a dark oracle) moved
                    // nothing, so it is not a sale.
                    .then((resp) => extractRows(resp)
                        .filter((row) => flowsLib.dispenseIsValid(row))
                        .map((row) => ({ chainId: cid, row })))
                    .catch(markFailed)
                : Promise.resolve([]),
        );
        // One list read per kind and chain, never one detail read per
        // row. The list rows already carry the lifecycle `state` the messaging
        // layer attaches, so it is lifted onto each row here with no read.
        const ordersByChain = chains.map((cid) =>
            typeof messaging.getOrdersForToken === 'function'
                ? messaging.getOrdersForToken({ chainId: cid, tick })
                    .then((resp) => extractRows(resp).map(liftOfferState)
                        .filter((row) => isOpenOffer(row))
                        .map((row) => ({ chainId: cid, row })))
                    .catch(markFailed)
                : Promise.resolve([]),
        );
        const swapsByChain = chains.map((cid) =>
            typeof messaging.getSwapsForToken === 'function'
                ? messaging.getSwapsForToken({ chainId: cid, tick })
                    .then((resp) => extractRows(resp).map(liftOfferState)
                        .filter((row) => isCompleteSwap(row))
                        .map((row) => ({ chainId: cid, row })))
                    .catch(markFailed)
                : Promise.resolve([]),
        );

        Promise.all([
            Promise.all(offersByChain),
            Promise.all(salesByChain),
            Promise.all(ordersByChain),
            Promise.all(swapsByChain),
        ]).then(([offersBatches, salesBatches, ordersBatches, swapsBatches]) => {
            if (cancelled) return;
            setOffers(uniqueRows(offersBatches.flat(), marketRowIdentity));
            setSales(uniqueRows(salesBatches.flat().sort(byTimeDesc), marketRowIdentity));
            setDexOrders(uniqueRows(ordersBatches.flat(), marketRowIdentity));
            setDexSwaps(uniqueRows(swapsBatches.flat().sort(byTimeDesc), marketRowIdentity));
            if (!failed) loadedMarketKeyRef.current = marketKey;
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [tick, walletId, messaging, chains, offline]);

    // A Mode B offer carries no price on this lane; it comes from its oracle.
    const oracleFeedsFor = useOracleFeeds(messaging, offers);

    // What this wallet holds of the token, from one balance read
    // for the whole wallet. Unknown (and not shown) without a wallet, while
    // it loads, or when any address on a listed chain failed to read.
    const [holdings, setHoldings] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        setHoldings(null);
        if (!walletId || !tick || chains.length === 0 || typeof messaging.getWalletBalances !== 'function') return undefined;
        let cancelled = false;
        messaging.getWalletBalances(walletId, accountId || readActiveAccount(walletId) || undefined)
            .then((byChain) => {
                if (cancelled) return;
                if (chains.some((cid) => chainReadFailed(byChain, cid))) return;
                setHoldings(sumTickHoldings(byChain, chains, tick));
            })
            .catch(() => { /* the card leaves the line out */ });
        return () => { cancelled = true; };
    }, [messaging, walletId, accountId, tick, chains]);

    // One Offers list, the card's coin and its price points.
    const offerEntries = useMemo(
        () => (offers === null && dexOrders === null ? null : mergedOffers(offers, dexOrders, tick, chainOrder)),
        [offers, dexOrders, tick, chainOrder],
    );
    const points = useMemo(() => tradePoints(sales, dexSwaps, tick), [sales, dexSwaps, tick]);
    // The Trades tab lists dispenser sales only, newest first. Completed
    // swaps have their own tab, so each trade appears once on the page.
    const tradeRows = sales;
    const firstPriced = (offerEntries || []).find((e) => e.unit !== null && e.quote);
    const lastPoint = points.length > 0 ? points[points.length - 1] : null;
    const heroQuote = firstPriced?.quote || lastPoint?.quote
        || (defaultChainId ? tickerForCoin(coinFromChainId(defaultChainId)) : null) || null;
    const heroChainId = firstPriced?.chainId || lastPoint?.chainId || defaultChainId;
    const quotePoints = useMemo(() => points.filter((p) => p.quote === heroQuote), [points, heroQuote]);
    const heroPrice = quotePoints.length > 0
        ? quotePoints[quotePoints.length - 1].unit
        : (firstPriced && firstPriced.quote === heroQuote ? firstPriced.unit : null);
    const range = MARKET_RANGES.find((r) => r.id === rangeId) || MARKET_RANGES[1];
    const series = useMemo(() => rangeSeries(quotePoints, range), [quotePoints, range]);
    const rangeMove = useMemo(() => seriesMove(series), [series]);

    // What Buy and Sell open. A row's own action opens that row.
    const canTrade = Boolean(walletId) && typeof messaging.getOrderbook === 'function';
    const entryAction = (entry) => {
        if (entry.kind === 'dispenser') {
            const actionIndex = entry.row.action_index || entry.row.actionIndex || entry.row.tx_hash || entry.row.id;
            return typeof onOpenDispenser === 'function' && actionIndex
                ? () => onOpenDispenser(entry.chainId, actionIndex)
                : null;
        }
        if (!canTrade || !entry.quote) return null;
        return () => setLocalTrade({
            chainId: entry.chainId,
            tick2: entry.quote,
            side: entry.action,
            mode: entry.unit ? 'market' : 'swap',
            price: entry.unit ? trimAmountTail(entry.unit) : null,
        });
    };
    const openPair = (side) => (canTrade && heroQuote && heroChainId
        ? () => setLocalTrade({ chainId: heroChainId, tick2: heroQuote, side, mode: 'swap', price: null })
        : null);
    const cheapestAsk = (offerEntries || []).find((e) => e.action === 'buy' && entryAction(e));
    const bestBid = (offerEntries || [])
        .filter((e) => e.action === 'sell' && e.unit !== null && e.quote === heroQuote)
        .reduce((best, e) => (!best || compareDecimalStrings(e.unit, best.unit) === 1 ? e : best), null);
    const onBuy = cheapestAsk ? entryAction(cheapestAsk) : openPair('buy');
    const onSell = (bestBid && entryAction(bestBid)) || openPair('sell');

    // Sub-view: tapping the token on the card opens the shared picker to
    // switch markets. 'receive' purpose enables cross-chain token discovery
    // so the user can view a market for a token they don't hold.
    if (picking && !twoPanel) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                accountId={accountId}
                tokenQuery={marketQuery}
                onTokenQueryChange={setMarketQuery}
                networkFilter={marketNetwork}
                onNetworkFilterChange={setMarketNetwork}
                kindFilter={marketKind}
                onKindFilterChange={setMarketKind}
                title="Select a Market"                backLabel="Back to marketplace"
                onBack={() => setPicking(false)}
                onSelect={(sel) => {
                    chooseMarket(sel);
                    setPicking(false);
                }}
            />
        );
    }

    if (localTrade && !twoPanel) {
        // Trade opens over the activity page in place: its Back returns here,
        // so it shows even when this page is a root.
        return (
            <InPageScreen>
                <MarketTrade
                    walletId={walletId}
                    chainId={localTrade.chainId}
                    tick1={tick}
                    tick2={localTrade.tick2}
                    side={localTrade.side}
                    mode={localTrade.mode}
                    price={localTrade.price}
                    onBack={() => setLocalTrade(null)}
                />
            </InPageScreen>
        );
    }

    const handleMarketSearchKeyDown = (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
        const results = Array.from(document.getElementById('xc-token-picker-results')
            ?.querySelectorAll('button[aria-label^="Select "]') || []);
        const result = event.key === 'ArrowUp' ? results.at(-1) : results[0];
        if (!result) return;
        event.preventDefault();
        if (event.key === 'Enter') result.click();
        else result.focus();
    };
    const marketFilter = (
        <ListFilterMenu
            query={marketQuery}
            onQueryChange={setMarketQuery}
            active={marketKind !== 'all'}
            label="Filter markets"
            searchPlaceholder="Search coins or tokens..."
            searchLabel="Search coins or tokens"
            chainRegistry={chainRegistry}
            coinFamilies={marketCoinFamilies}
            networkFilter={marketNetwork}
            onNetworkFilterChange={setMarketNetwork}
            onSearchKeyDown={handleMarketSearchKeyDown}
            resultsId={twoPanel ? 'xc-token-picker-results' : undefined}
        >
            <IconSelect
                size="md"
                aria-label="Asset kind"
                value={marketKind}
                onChange={setMarketKind}
                options={[
                    { value: 'all', label: 'Coins and tokens', icon: <Icon.TokenListIcon /> },
                    { value: 'coins', label: 'Coins', icon: <Icon.CoinsIcon /> },
                    { value: 'tokens', label: 'Tokens', icon: <Icon.TokenIcon /> },
                ]}
            />
        </ListFilterMenu>
    );
    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back"
            title="Marketplace"
            trailing={marketFilter}
        />
    );

    const iconChainId = selected.chainId || defaultChainId;
    const pillClass = rangeMove?.direction === 'positive'
        ? heroStyles.changePositive
        : rangeMove?.direction === 'negative' ? heroStyles.changeNegative : heroStyles.changeNeutral;
    const priceText = heroPrice !== null ? tidyQuotePrice(heroPrice) : '-';
    // The blue card, built like the Market page's.
    const heroCard = (
        <div className={`${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart}`}>
            <section className={`${heroStyles.hero} ${styles.hero}`} aria-label={`${tick} market`}>
                {twoPanel ? (
                    <div className={styles.tokenIdentity}>
                        <TickerIcon chainId={iconChainId} tick={tick} size={44} />
                        <span className={styles.tokenText}>
                            <span className={styles.tokenName}>{tick}</span>
                            <span className={styles.tokenSub}>Buy, sell and swap {tick}</span>
                        </span>
                    </div>
                ) : (
                    <Button
                        type="button"
                        className={styles.tokenButton}
                        onClick={() => setPicking(true)}
                        aria-label={`Change market (currently ${selected.displayName || tick})`}
                        icon={null}
                    >
                        <span className={styles.tokenButtonContent}>
                            <TickerIcon chainId={iconChainId} tick={tick} size={44} />
                            <span className={styles.tokenText}>
                                <span className={styles.tokenName}>
                                    {tick}
                                    <span className={styles.tokenChevron} aria-hidden="true"><Icon.ChevronDownIcon /></span>
                                </span>
                                <span className={styles.tokenSub}>Buy, sell and swap {tick}</span>
                            </span>
                        </span>
                    </Button>
                )}
                {/* The change pill sits above the main figure, as on Home's card (G10). */}
                {rangeMove ? (
                    <div className={styles.move}>
                        <span className={pillClass} aria-label={`${range.label} change: ${rangeMove.label}`}>
                            {rangeMove.text}
                        </span>
                    </div>
                ) : null}
                <div className={`${heroStyles.amount} ${styles.price}`} aria-label={heroPrice !== null ? `${priceText} ${heroQuote || ''} per ${tick}` : 'No price yet'}>
                    <span className={heroStyles.amountValue}>{priceText}</span>
                    {heroPrice !== null && heroQuote ? <span className={heroStyles.amountCode}>{heroQuote}</span> : null}
                </div>
                <div className={styles.heroMeta}>
                    {holdings !== null ? (
                        <span className={styles.holdings}>
                            <Icon.WalletIcon />
                            You own {formatWithThousands(trimAmountTail(holdings))} {tick}
                        </span>
                    ) : null}
                </div>
            </section>
            <section
                className={`${portfolioChartStyles.wrap} ${portfolioChartStyles.behind}`}
                data-chart-behind="true"
                aria-label={`${tick} price chart`}
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
                                    label={`${tick} price in ${heroQuote}`}
                                    formatValue={(value) => `${tidyQuotePrice(String(value))} ${heroQuote}`}
                                    formatScaleValue={(value) => formatCompactChartValue(value, { locale: numberLocale, unit: heroQuote })}
                                    showScale
                                    heroScale
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

    const tabs = [
        { id: 'offers', label: 'Offers', icon: <Icon.TokenListIcon /> },
        { id: 'swaps', label: 'Swaps', icon: <Icon.SwapIcon /> },
        { id: 'trades', label: 'Trades', icon: <Icon.LineChartIcon /> },
    ];

    const marketplacePage = (
        /* A failed read leaves each list on its plain empty state: the
           app's reachability banner reports network trouble once, so the
           page adds no error or Try Again of its own (G91). */
        <ListPage className={styles.page} data-marketplace-detail="">
            <div className={styles.layout}>
                    <div className={styles.column}>
                        {heroCard}
                        {/* Buy opens the cheapest offer, Sell the Trade page on the
                            sell side. A button with nothing to open is left out, never shown disabled. */}
                        {onBuy || onSell ? (
                            <div className={styles.tradeButtons}>
                                {onBuy ? (
                                    <Button
                                        type="button"
                                        variant="success"
                                        block
                                        icon={<BuyGlyph />}
                                        className={styles.tradeButton}
                                        onClick={onBuy}
                                    >
                                        Buy
                                    </Button>
                                ) : null}
                                {onSell ? (
                                    <Button
                                        type="button"
                                        variant="danger"
                                        block
                                        icon={<SellGlyph />}
                                        className={styles.tradeButton}
                                        onClick={onSell}
                                    >
                                        Sell
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    <div className={styles.column}>
                        <Tabs
                            id={tabsId}
                            className={styles.panelTabs}
                            aria-label="Marketplace lists"
                            items={tabs}
                            value={tab}
                            onChange={(id) => setTab(/** @type {any} */ (id))}
                            panelId={`${tabsId}-panel`}
                        />

                        <div
                            id={`${tabsId}-panel`}
                            role="tabpanel"
                            aria-labelledby={`${tabsId}-tab-${tab}`}
                            className={styles.activity}
                        >
                            <div role="region" aria-label="Marketplace activity" aria-busy={loading || undefined}>
                                {offline && offers === null ? (
                                    <OfflineEmptyState body="Marketplace activity loads when the connection returns." onRetry={recheck} />
                                ) : null}

                                {loading && offers === null ? (
                                    <div className={styles.loading} role="status" aria-label="Loading marketplace activity">
                                        <Skeleton height={56} />
                                        <Skeleton height={56} />
                                        <Skeleton height={56} />
                                    </div>
                                ) : null}

                                {tab === 'offers' && offerEntries !== null ? (
                                    <ListCard
                                        label="Offers"
                                    >
                                        {offerEntries.length === 0 ? (
                                            <EmptyState title="No open offers" body={<>Open dispensers and orders for {tick} appear here.</>} titleAs="p" />
                                        ) : (
                                            /* Safari needs an explicit list role because this class removes list styling. */
                                            <ul className={styles.list} role="list">
                                                {offerEntries.slice(0, visibleCounts.offers).map((entry, index) => (
                                                    <li key={marketRowIdentity(entry) || `offer:${index}`}>
                                                        <OfferRow
                                                            entry={entry}
                                                            tick={tick}
                                                            onAction={entryAction(entry)}
                                                            oracleFeedsFor={oracleFeedsFor}
                                                        />
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {offerEntries.length > visibleCounts.offers ? (
                                            <LoadMoreActivity onClick={() => setVisibleCounts((counts) => ({
                                                ...counts,
                                                offers: counts.offers + ACTIVITY_PAGE_SIZE,
                                            }))} label="Load More Offers" />
                                        ) : null}
                                    </ListCard>
                                ) : null}

                                {tab === 'swaps' && dexSwaps !== null ? (
                                    <ListCard
                                        label="Recent DEX swaps"
                                    >
                                        {dexSwaps.length === 0 ? (
                                            <EmptyState title="No recent DEX swaps" body={<>Recent swaps involving {tick} appear here.</>} titleAs="p" />
                                        ) : (
                                            /* Safari needs an explicit list role because this class removes list styling. */
                                            <ul className={styles.list} role="list">
                                                {dexSwaps.slice(0, visibleCounts.swaps).map((entry, i) => (
                                                    <li key={marketRowIdentity(entry) || `swap:${i}`}>
                                                        <SwapRow entry={entry} tick={tick} />
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {dexSwaps.length > visibleCounts.swaps ? (
                                            <LoadMoreActivity onClick={() => setVisibleCounts((counts) => ({
                                                ...counts,
                                                swaps: counts.swaps + ACTIVITY_PAGE_SIZE,
                                            }))} label="Load More Recent DEX Swaps" />
                                        ) : null}
                                    </ListCard>
                                ) : null}

                                {tab === 'trades' && tradeRows !== null ? (
                                    <ListCard
                                        label="Recent trades"
                                    >
                                        {tradeRows.length === 0 ? (
                                            <EmptyState title="No recent trades" body={<>Recent dispenser sales of {tick} appear here.</>} titleAs="p" />
                                        ) : (
                                            /* Safari needs an explicit list role because this class removes list styling. */
                                            <ul className={styles.list} role="list">
                                                {tradeRows.slice(0, visibleCounts.sales).map((entry, i) => (
                                                    <li key={marketRowIdentity(entry) || `sale:${i}`}>
                                                        <SaleRow entry={entry} tick={tick} />
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {tradeRows.length > visibleCounts.sales ? (
                                            <LoadMoreActivity onClick={() => setVisibleCounts((counts) => ({
                                                ...counts,
                                                sales: counts.sales + ACTIVITY_PAGE_SIZE,
                                            }))} label="Load More Recent Trades" />
                                        ) : null}
                                    </ListCard>
                                ) : null}
                            </div>
                        </div>
                    </div>
            </div>
        </ListPage>
    );

    if (!twoPanel) {
        return (
            <Screen variant={variant} header={header}>
                <div ref={layoutRef} className={listDetailStyles.layoutRoot} data-list-detail="list">
                    {marketplacePage}
                </div>
            </Screen>
        );
    }

    const selectedKey = selected.chainId ? `${selected.chainId}:${selected.tick}` : null;
    const picker = (
        <TokenPicker
            embedded
            purpose="receive"
            walletId={walletId}
            accountId={accountId}
            tokenQuery={marketQuery}
            onTokenQueryChange={setMarketQuery}
            networkFilter={marketNetwork}
            onNetworkFilterChange={setMarketNetwork}
            kindFilter={marketKind}
            onKindFilterChange={setMarketKind}
            selectedKey={selectedKey}
            splitRows
            onFirstOption={chooseFirstMarket}
            onSelect={chooseMarket}
        />
    );
    const detail = localTrade ? (
        <InPageScreen>
            <MarketTrade
                walletId={walletId}
                chainId={localTrade.chainId}
                tick1={tick}
                tick2={localTrade.tick2}
                side={localTrade.side}
                mode={localTrade.mode}
                price={localTrade.price}
                onBack={() => setLocalTrade(null)}
            />
        </InPageScreen>
    ) : marketplacePage;

    return (
        <Screen variant={variant} header={header} bodyClassName={listDetailStyles.twoPanelBody}>
            <ListDetailSplit
                measureRef={layoutRef}
                storageKey="marketplace"
                resizeLabel="Resize the marketplace list"
                resizeHint="Drag to resize the marketplace list, or press Enter to reset."
                layoutName="marketplace"
                list={picker}
                listLabel="Marketplace markets"
                detail={detail}
                detailLabel={`${tick} marketplace`}
                detailBusy={loading}
            />
        </Screen>
    );
}

// Rows never name their network in text (the token icon's chain badge shows
// it, and the icon's accessible name says it), so identical rows from two
// chains still read differently to a screen reader.

/**
 * One tab's list as a card: just the rows, with no title or count row above
 * them (operator ruling 2026-11-14); the active tab already names the list.
 * No loose explainer line: a note belongs in a WarningCard.
 */
function ListCard({ label, children }) {
    return (
        <section className={styles.listCard} aria-label={label}>
            {children}
        </section>
    );
}

/**
 * One Offers row, two lines with the price on the right: the Dispenser or
 * Order kind over how much is available, then the unit price in green (Buy)
 * or red (Sell) with its arrow, and a chevron. The row itself is the tap
 * target; it holds no Buy or Sell button. A dispenser with no coin price shows
 * its label (oracle, fiat or stale) in place of the price.
 */
function OfferRow({ entry, tick, onAction, oracleFeedsFor }) {
    const { kind, row, chainId, unit, quote, available, action } = entry;
    let title;
    if (unit !== null && quote) {
        title = `${tidyQuotePrice(unit)} ${quote} per ${tick}`;
    } else if (kind === 'dispenser') {
        title = isDispenserPriceStale(row)
            ? dispenserRateLabel(row)
            : row.give_amount
                ? dispenserRateLabel(row, oracleFeedsFor(chainId, row))
                : 'Open dispenser';
    } else {
        title = action === 'buy' ? `Sell ${tick}` : `Buy ${tick}`;
    }
    const amount = available != null && available !== ''
        ? (kind === 'dispenser'
            ? `${formatDecimal(available)} ${tick} remaining`
            : `${formatWithThousands(available)} ${tick} ${action === 'buy' ? 'for sale' : 'wanted'}`)
        : null;
    // A priced dispenser also shows its lot terms, since it only sells in whole fills.
    const terms = kind === 'dispenser' && unit !== null && quote && row.give_amount
        ? dispenserRateLabel(row, oracleFeedsFor(chainId, row))
        : null;
    const actionLabel = action === 'buy' ? 'Buy' : 'Sell';
    // An order names its own side (the viewer buys from a sell order), so
    // rows of one list never repeat one bare title (U18).
    const kindLabel = kind === 'dispenser' ? 'Dispenser' : action === 'buy' ? 'Sell order' : 'Buy order';
    const priced = unit !== null && Boolean(quote);
    const side = action === 'buy' ? 'buy' : 'sell';
    // The whole row is the control (G111): it opens what the old Buy or Sell
    // button opened. Its name carries the side, the price, the amount and any
    // lot terms, which the compact row leaves out of sight.
    const rowName = `${actionLabel}: ${title}, ${kindLabel}${amount ? `, ${amount}` : ''}${terms ? `, ${terms}` : ''}`;
    return (
        <ListRow
            className={styles.row}
            leading={<TickerIcon chainId={chainId} tick={tick} size={32} />}
            title={(
                <span className={styles.offerKind}>
                    {kind === 'dispenser' ? <DispenserGlyph /> : <Icon.TokenListIcon />}
                    {kindLabel}
                </span>
            )}
            subtitle={amount || undefined}
            trailing={(
                <span className={styles.offerPrice} data-side={side} data-offer-price="">
                    <span className={styles.offerPriceMain}>
                        {side === 'buy' ? <BuyGlyph /> : <SellGlyph />}
                        {priced ? tidyQuotePrice(unit) : title}
                    </span>
                    {priced ? <span className={styles.offerPriceUnit}>{quote} each</span> : null}
                </span>
            )}
            trailingClassName={styles.rowTrailing}
            chevron={Boolean(onAction)}
            onClick={onAction || undefined}
            aria-label={onAction ? rowName : undefined}
        />
    );
}

/** A completed DEX swap (listed on the Swaps tab only, so never tagged). */
function SwapRow({ entry, tick, tagged = false }) {
    const { chainId, row } = entry;
    const giveTick = tickText(row.give_tick, row.give_coin, row.giveTick, row.giveCoin);
    const getTick = tickText(row.get_tick, row.get_coin, row.getTick, row.getCoin);
    const giveQty = row.give_amount ?? row.giveAmount ?? null;
    const getQty = row.get_amount ?? row.getAmount ?? null;
    const timestamp = row.timestamp || row.block_time;
    const isSell = giveTick.toUpperCase() === tick;
    const title = isSell
        ? (giveQty != null && getQty != null
            ? `Sold ${formatWithThousands(giveQty)} ${tick} for ${formatWithThousands(getQty)} ${getTick}`
            : `Sold ${tick}`)
        : (giveQty != null && getQty != null
            ? `Bought ${formatWithThousands(getQty)} ${tick} for ${formatWithThousands(giveQty)} ${giveTick}`
            : `Bought ${tick}`);
    const when = timestamp ? <RelativeTime timestamp={timestamp} /> : null;
    return (
        <ListRow
            className={styles.row}
            leading={<TickerIcon chainId={chainId} tick={tick} size={32} />}
            title={title}
            subtitle={tagged ? (
                <span className={styles.offerMeta}>
                    <span className={`${styles.tag} ${styles.tagOrder}`}><Icon.SwapIcon />Swap</span>
                    {when}
                </span>
            ) : (when || undefined)}
        />
    );
}

/** A dispense: what was sold and what the buyer paid, tagged Dispenser. */
function SaleRow({ entry, tick }) {
    const { chainId, row } = entry;
    // A dispense row's GET_AMOUNT is what the buyer actually
    // paid, so it is right even for a fiat-priced dispenser.
    const give = row.give_amount;
    const soldTick = tickText(row.give_tick) || tick;
    const payAsset = tickText(row.get_tick, row.get_coin);
    const get = row.get_amount;
    const timestamp = row.timestamp || row.block_time;
    return (
        <ListRow
            className={styles.row}
            leading={<TickerIcon chainId={chainId} tick={tick} size={32} />}
            title={(
                <>
                    {give ? `Sold ${formatDecimal(give)} ${soldTick}` : `Sold ${soldTick}`}
                    {give && Number(get) > 0 && payAsset ? ` for ${formatDecimal(get)} ${payAsset}` : ''}
                </>
            )}
            subtitle={(
                <span className={styles.offerMeta}>
                    <span className={`${styles.tag} ${styles.tagDispenser}`}><DispenserGlyph />Dispenser</span>
                    {timestamp ? <RelativeTime timestamp={timestamp} /> : null}
                </span>
            )}
        />
    );
}

function LoadMoreActivity({ onClick, label }) {
    return (
        <Button type="button" variant="secondary" icon={<Icon.ChevronDownIcon />} onClick={onClick} aria-label={label}>
            {label}
        </Button>
    );
}

/**
 * An order or swap list row with the lifecycle fields its `state` carries
 * (status, expiry, what is still open) lifted to the top level, so no
 * per-row detail read is needed. A row with no `state` is returned as listed.
 */
function liftOfferState(row) {
    const state = row?.state;
    if (!state || typeof state !== 'object') return row;
    const lifted = { ...row };
    if (state.status != null) lifted.current_status = state.status;
    if (state.expiration != null) lifted.expiration = state.expiration;
    if (state.give_remaining != null) lifted.give_remaining = state.give_remaining;
    if (state.get_remaining != null) lifted.get_remaining = state.get_remaining;
    return lifted;
}

function marketRowIdentity(entry) {
    const identity = actionRowIdentity(entry?.row);
    return identity == null ? null : `${entry.chainId}:${identity}`;
}

/**
 * The wallet's holdings of `tick` across the listed chains, as an
 * exact decimal. Each balance entry carries its own divisibility.
 */
function sumTickHoldings(byChain, chains, tick) {
    const amounts = [];
    for (const cid of chains) {
        const entries = Array.isArray(byChain?.[cid]) ? byChain[cid] : [];
        const seen = new Set();
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || seen.has(entry.address)) continue;
            seen.add(entry.address);
            const b = entry.balances || {};
            const all = [b.native, ...(Array.isArray(b.tokens) ? b.tokens : [])];
            for (const t of all) {
                if (!t || String(t.tick || '').toUpperCase() !== tick) continue;
                const value = decimalFromBaseUnits(t.quantity ?? '0', Number(t.divisibility ?? 0));
                if (value !== null) amounts.push(value);
            }
        }
    }
    return amounts.length > 0 ? sumDecimalStrings(amounts) : '0';
}

/**
 * The prices inside the range, oldest first. A range with fewer
 * than two trades starts from the trade before it, so a quiet market still
 * draws a line from its last trade. Null with no trades at all.
 */
function rangeSeries(points, range) {
    const windowSec = RANGE_WINDOWS[range.id];
    if (!windowSec || points.length === 0) return null;
    const since = Math.floor(Date.now() / 1000) - windowSec;
    const inside = points.filter((p) => p.timestamp >= since).map((p) => Number(p.unit));
    const before = points.filter((p) => p.timestamp < since);
    const lead = before.length > 0 ? [Number(before[before.length - 1].unit)] : [];
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
    const display = percentChangeDisplay(((last - first) / first) * 100);
    if (!display) return null;
    const arrow = display.direction === 'positive' ? '▲ ' : display.direction === 'negative' ? '▼ ' : '';
    return { direction: display.direction, label: display.label, text: `${arrow}${display.text}` };
}
