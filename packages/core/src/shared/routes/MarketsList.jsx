// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, Select, ListRow, PageHeader, Screen, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { OfflineEmptyState } from '../components/OfflineEmptyState.jsx';
// The standard title-line list filter (search and Show).
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { DexHeaderSlot } from '../components/dexHeaderSlot.js';
// The list-and-detail split's width rule and numbers, shared with every list
// that splits the same way (Staking).
import {
    LIST_DETAIL_DETAIL_MIN_PX,
    LIST_DETAIL_LIST_MAX_PX,
    LIST_DETAIL_LIST_MIN_PX,
    LIST_DETAIL_MIN_WIDTH,
    PanelSplitDivider,
    clampPanelSplit,
    panelSplitMax,
    usePanelSplit,
    useWideContent,
} from '../components/PanelSplit.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { Sparkline } from '../components/Sparkline.jsx';
import { AssetMark } from '../../ui/AssetMark.jsx';
import { bucketizeMatches } from '../../market/bucketize.js';
import { sampleMatchesFor } from '../../market/sampleMarketData.js';
import marketsStyles from './MarketsList.module.css';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import { formatDecimalAmount } from '../utils/amountFormat.js';
import { withRequestTimeout } from '../utils/requestTimeout.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/market.js';
import '../../i18n/locales/en/routes.js';

const chainRegistry = registryLib.defaultRegistry();
const MARKETS_PAGE_SIZE = 25;
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const SEARCH_DEBOUNCE_MS = 200;
function nativeTickerFor(descriptor) {
    if (!descriptor?.coin) return null;
    return NATIVE_TICKER_BY_COIN[descriptor.coin] || descriptor.coin.toUpperCase();
}

/**
 * Content width (px) at or above which the DEX shows the market list and the
 * market side by side: a slim 240 to 420px list, the line between and the
 * market in the rest. iPad 834 (about 756px beside its icon rail) and wider
 * get two panels (operator 2026-11-13, layout 2); phones keep the list, then
 * the market page. The shared list-and-detail split's number (PanelSplit.jsx).
 */
export const DEX_TWO_PANEL_MIN_WIDTH = LIST_DETAIL_MIN_WIDTH;

/**
 * The market list column's width range when two panels show (operator
 * 2026-11-13): its iPad width at the least, its 1280-window width at the
 * most, and never so wide the market drops under DEX_MARKET_MIN_PX. Dragged
 * by the line between the panels and remembered on this device.
 */
export const DEX_LIST_MIN_PX = LIST_DETAIL_LIST_MIN_PX;
export const DEX_LIST_MAX_PX = LIST_DETAIL_LIST_MAX_PX;
const DEX_MARKET_MIN_PX = LIST_DETAIL_DETAIL_MIN_PX;
export const DEX_LIST_WIDTH_KEY = 'markets';

/** The widest the list may be in a two-panel box this wide. */
export function dexListMaxPx(layoutWidth) {
    return panelSplitMax({
        min: DEX_LIST_MIN_PX,
        max: DEX_LIST_MAX_PX,
        minOther: DEX_MARKET_MIN_PX,
    }, layoutWidth);
}

export function clampDexListWidth(px, layoutWidth) {
    return clampPanelSplit(px, {
        min: DEX_LIST_MIN_PX,
        max: DEX_LIST_MAX_PX,
        minOther: DEX_MARKET_MIN_PX,
    }, layoutWidth);
}

/** The same market on either side of the pair, as the reverse-pair button flips it. */
function samePair(market, tick1, tick2) {
    const a = String(market.tick1).toUpperCase();
    const b = String(market.tick2).toUpperCase();
    const x = String(tick1).toUpperCase();
    const y = String(tick2).toUpperCase();
    return (a === x && b === y) || (a === y && b === x);
}

/**
 * Markets list (§41.2).
 *
 * Flow: the user picks a coin or token via the picker (`onChangeAsset`).
 * Once a `selectedAsset` is set, the page shows every market pair on
 * that asset's chain where the asset is one side of the pair.
 *
 * Empty state: a selector chip + a hint inviting the user to pick.
 *
 * Wide content (DEX_TWO_PANEL_MIN_WIDTH and up, with `renderMarket` given):
 * two panels side by side, this list on the left and the picked market on
 * the right (the first market until one is picked). A row then loads its
 * market in the right panel and stays put; narrower, a row opens the market
 * page through `onOpenMarket` as before.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {{ chainId: string, tick: string, displayName?: string, kind?: string } | null} [props.selectedAsset]
 * @param {() => void} props.onChangeAsset
 * @param {(chainId: string, tick1: string, tick2: string) => void} props.onOpenMarket
 * @param {() => void} [props.onBack]
 * @param {{ chainId: string, tick1: string, tick2: string } | null} [props.selectedMarket]
 *   the market the right panel shows, held by the shell so it survives the Trade page
 * @param {(chainId: string, tick1: string, tick2: string) => void} [props.onSelectMarket]
 *   a row picked on wide content
 * @param {(market: { chainId: string, tick1: string, tick2: string }, panel: { onWatchlistChange: () => void }) => import('react').ReactNode} [props.renderMarket]
 *   the right panel's market (an embedded MarketView); without it the list never splits
 */
export function MarketsList({
    walletId,
    selectedAsset,
    onChangeAsset,
    onOpenMarket,
    onBack,
    selectedMarket = null,
    onSelectMarket,
    renderMarket,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { offline: networkOffline, recheck: recheckNetwork } = useNetworkOffline({ walletId });
    const canSplit = typeof renderMarket === 'function';
    const [layoutRef, wideContent] = useWideContent(DEX_TWO_PANEL_MIN_WIDTH, canSplit);
    const split = usePanelSplit({
        storageKey: 'markets',
        min: DEX_LIST_MIN_PX,
        max: DEX_LIST_MAX_PX,
        minOther: DEX_MARKET_MIN_PX,
        defaultShare: 0.36,
    });
    const splitLayoutRef = split.layoutRef;
    const setLayoutBox = useCallback((el) => {
        layoutRef(el);
        splitLayoutRef.current = el;
    }, [layoutRef, splitLayoutRef]);
    const twoPanel = canSplit && wideContent;
    // A pick made here, for a host that does not hold the selection itself.
    // The header element the right panel's market tools portal into.
    const [headerSlot, setHeaderSlot] = useState(/** @type {HTMLElement | null} */ (null));
    // Inside the one filter menu: where the right panel's order status goes.
    const [filterSlot, setFilterSlot] = useState(/** @type {HTMLElement | null} */ (null));
    const dexSlots = useMemo(() => ({ tools: headerSlot, filter: filterSlot }), [headerSlot, filterSlot]);
    const [localPick, setLocalPick] = useState(/** @type {{ chainId: string, tick1: string, tick2: string } | null} */ (null));

    const [markets, setMarkets] = useState(/** @type {Array<{ tick1: string, tick2: string, lastPrice?: string, change24h?: string, depth?: number }>} */ ([]));
    const [watchlist, setWatchlist] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(Boolean(selectedAsset));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [settledAssetKey, setSettledAssetKey] = useState(/** @type {string | null} */ (null));
    const [tab, setTab] = useState(/** @type {'all' | 'popular' | 'watchlist'} */ ('popular'));
    const [search, setSearch] = useState('');
    const watchlistRequestId = useRef(0);
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const marketResultsRef = useRef(/** @type {HTMLUListElement | null} */ (null));
    const marketResultsId = useId();
    const walletScopeRef = useRef(walletId);
    if (walletScopeRef.current !== walletId) {
        walletScopeRef.current = walletId;
        watchlistRequestId.current += 1;
        // React retries this render with empty wallet-owned state, keeping a
        // previous wallet's watchlist out of the committed tree.
        setWatchlist([]);
    }

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [search]);

    const [visibleMarketCount, setVisibleMarketCount] = useState(MARKETS_PAGE_SIZE);

    const loadWatchlist = useCallback(async () => {
        const requestId = ++watchlistRequestId.current;
        try {
            const rows = await messaging.listWatchlistForWallet({ walletId });
            if (requestId !== watchlistRequestId.current) return;
            setWatchlist(Array.isArray(rows) ? rows : []);
        } catch {
            // Keep the watchlist already read: a failed read says nothing about
            // what is stored, and a wallet switch clears the list on its own.
        }
    }, [walletId, messaging]);

    useEffect(() => {
        loadWatchlist();
        return () => { watchlistRequestId.current += 1; };
    }, [loadWatchlist]);

    useEffect(() => {
        if (!selectedAsset) {
            setMarkets([]);
            setLoadError(null);
            setLoading(false);
            setSettledAssetKey(null);
            return undefined;
        }
        let cancelled = false;
        const assetKey = `${selectedAsset.chainId}:${selectedAsset.tick}`;
        setLoading(true);
        setLoadError(null);
        setVisibleMarketCount(MARKETS_PAGE_SIZE);
        const applyResult = (rows) => {
            if (cancelled) return;
            const tick = selectedAsset.tick.toUpperCase();
            const filtered = rows
                .map(normalizeMarket)
                .filter(Boolean)
                .filter((m) => m.tick1.toUpperCase() === tick || m.tick2.toUpperCase() === tick);
            // Demo wallets fall back to a fixed sample list so the
            // populated UI is visible without live liquidity. Real wallets
            // show the live market set and the "No markets" empty state.
            if (filtered.length === 0 && flowsLib.isDemoWallet(walletId)) {
                setMarkets(SAMPLE_MARKETS[tick] || []);
            } else {
                setMarkets(filtered);
            }
        };
        withRequestTimeout(messaging.getMarkets({ chainId: selectedAsset.chainId }))
            .then((resp) => applyResult(extractRows(resp)))
            .catch(() => {
                if (!cancelled) setLoadError('Could not load markets. Try again.');
            })
            .finally(() => {
                if (!cancelled) {
                    setSettledAssetKey(assetKey);
                    setLoading(false);
                }
            });
        return () => { cancelled = true; };
    // The connection coming back reads the markets again.
    }, [selectedAsset, messaging, walletId, networkOffline]);

    const selectedAssetKey = selectedAsset
        ? `${selectedAsset.chainId}:${selectedAsset.tick}`
        : null;
    const marketsLoading = Boolean(selectedAsset)
        && (loading || settledAssetKey !== selectedAssetKey);
    const hasCachedMarkets = settledAssetKey === selectedAssetKey;


    const displayMarkets = useMemo(() => {
        const selTick = selectedAsset?.tick.toUpperCase() || '';
        const q = debouncedSearch.trim().toLowerCase();
        const applySearch = (rows) => (q ? rows.filter((m) => [
            m.tick1,
            m.tick2,
            m.name1,
            m.name2,
        ].some((value) => String(value || '').toLowerCase().includes(q))) : rows);

        if (tab === 'all') return applySearch(markets);
        if (tab === 'popular') {
            // Sort by depth desc and take the top 5 so 'Popular' visibly
            // differs from 'All' even on the sample data.
            const sorted = [...markets].sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
            return applySearch(sorted.slice(0, 5));
        }
        // 'watchlist'
        if (!selectedAsset) return [];
        // Two windows starring one market together can store it twice; it
        // lists once.
        const seen = new Set();
        const onChain = watchlist.filter((e) => {
            if (e.chainId !== selectedAsset.chainId) return false;
            if (e.tick1.toUpperCase() !== selTick && e.tick2.toUpperCase() !== selTick) return false;
            const key = `${e.tick1}::${e.tick2}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        // Hydrate from the markets list when the same pair has live data,
        // so prices/changes show up for watched rows too.
        const byPair = new Map();
        for (const m of markets) byPair.set(`${m.tick1}::${m.tick2}`, m);
        const rows = onChain.map((e) => {
            const hit = byPair.get(`${e.tick1}::${e.tick2}`);
            return {
                tick1: e.tick1,
                tick2: e.tick2,
                lastPrice: hit?.lastPrice,
                change24h: hit?.change24h,
                depth: hit?.depth,
                name1: hit?.name1,
                name2: hit?.name2,
            };
        });
        return applySearch(rows);
    }, [tab, markets, watchlist, selectedAsset, debouncedSearch]);

    // Every row chart on the visible page comes from one series map, built
    // once per page of markets, never a read per row.
    const visibleMarkets = useMemo(
        () => displayMarkets.slice(0, visibleMarketCount),
        [displayMarkets, visibleMarketCount],
    );
    const demoWallet = flowsLib.isDemoWallet(walletId);
    const seriesByPair = useMemo(
        () => readMarketSeries({ markets: visibleMarkets, demo: demoWallet }),
        [visibleMarkets, demoWallet],
    );

    const hasRowsBeforeSearch = useMemo(() => {
        if (tab !== 'watchlist') return markets.length > 0;
        if (!selectedAsset) return false;
        const selectedTick = selectedAsset.tick.toUpperCase();
        return watchlist.some((entry) => entry.chainId === selectedAsset.chainId
            && (entry.tick1.toUpperCase() === selectedTick || entry.tick2.toUpperCase() === selectedTick));
    }, [tab, markets, watchlist, selectedAsset]);
    const filtersHideAllMarkets = displayMarkets.length === 0 && (
        // A search with matches before it; an empty Watchlist keeps its own text.
        (Boolean(search.trim()) && hasRowsBeforeSearch)
    );
    const resetFilters = () => {
        // The cleared search applies at once, not after the debounce.
        setSearch('');
        setDebouncedSearch('');
        setTab('popular');
        setVisibleMarketCount(MARKETS_PAGE_SIZE);
    };

    // From the search box, Enter opens the top market and the arrows move
    // into the list at either end.
    const handleSearchKeyDown = (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
        const results = Array.from(marketResultsRef.current?.querySelectorAll('[data-market-result="true"]') || []);
        const result = event.key === 'ArrowUp' ? results.at(-1) : results[0];
        if (!result) return;
        event.preventDefault();
        if (event.key === 'Enter') result.click();
        else result.focus();
    };

    // Search and the Show list live in the title-line filter; the
    // icon is lit when there is search text or Show is not Popular.
    const filterMenu = selectedAsset ? (
        <ListFilterMenu
            query={search}
            onQueryChange={(value) => {
                setSearch(value);
                setVisibleMarketCount(MARKETS_PAGE_SIZE);
            }}
            active={tab !== 'popular'}
            label="Filter markets"
            searchPlaceholder="Search"
            searchLabel="Search markets"
            onSearchKeyDown={handleSearchKeyDown}
            resultsId={marketResultsId}
        >
            <Select
                aria-label="Show markets"
                size="md"
                value={tab}
                onChange={(event) => {
                    setTab(event.target.value);
                    setVisibleMarketCount(MARKETS_PAGE_SIZE);
                }}
            >
                <Select.Option value="popular" icon={<Icon.LineChartIcon />}>Show popular</Select.Option>
                <Select.Option value="all" icon={<Icon.ListIcon />}>Show all</Select.Option>
                <Select.Option value="watchlist" icon={<Icon.HeartIcon />}>Show watchlist</Select.Option>
            </Select>
            {/* With two panels, the market's own filter choices join this one menu. */}
            {twoPanel ? <div ref={setFilterSlot} className={marketsStyles.headerSlot} /> : null}
        </ListFilterMenu>
    ) : null;

    const selectorDescriptor = selectedAsset ? chainRegistry.get(selectedAsset.chainId) : null;
    const selectorNativeTicker = nativeTickerFor(selectorDescriptor);
    const selectorTickUpper = selectedAsset ? selectedAsset.tick.toUpperCase() : '';
    const isTokenSelection = !!selectedAsset
        && !!selectorNativeTicker
        && selectorTickUpper !== selectorNativeTicker;
    const assetName = selectedAsset
        ? (isTokenSelection
            ? (selectedAsset.displayName || selectorTickUpper)
            : (selectorDescriptor?.displayName || selectorNativeTicker || selectorTickUpper))
        : 'Select coin or token';
    // A failed read leaves the list on its plain empty state, with no page error
    // or Try Again of its own (G91): the reachability banner reports network
    // trouble once. Offline, the results region's offline state is the page's
    // one message.
    const showOffline = !!selectedAsset && networkOffline
        && ((marketsLoading && !hasCachedMarkets) || !!loadError);
    const showLoading = !!selectedAsset && marketsLoading && !hasCachedMarkets && !showOffline;

    // The right panel's market: the pick while it is still one of this
    // asset's markets (either way round, after the reverse-pair button),
    // otherwise the first market in the list. Checked against every market,
    // not only the searched rows, so typing a search never swaps the panel.
    const shownMarket = useMemo(() => {
        if (!twoPanel || !selectedAsset || !hasCachedMarkets) return null;
        const chainId = selectedAsset.chainId;
        const pick = selectedMarket ?? localPick;
        if (pick && pick.chainId === chainId
            && (markets.some((m) => samePair(m, pick.tick1, pick.tick2))
                || displayMarkets.some((m) => samePair(m, pick.tick1, pick.tick2)))) {
            return { chainId, tick1: pick.tick1, tick2: pick.tick2 };
        }
        const first = displayMarkets[0] || markets[0];
        return first ? { chainId, tick1: first.tick1, tick2: first.tick2 } : null;
    }, [twoPanel, selectedAsset, hasCachedMarkets, selectedMarket, localPick, markets, displayMarkets]);
    const showMarketPanel = twoPanel && (Boolean(shownMarket) || showLoading);
    const header = (
        <PageHeader
            onBack={onBack}
            title="Decentralized Exchange"
            trailing={showMarketPanel ? (
                <div className={marketsStyles.headerTools}>
                    {filterMenu}
                    {/* The right panel's market tools land here. */}
                    <span ref={setHeaderSlot} className={marketsStyles.headerSlot} />
                </div>
            ) : filterMenu}
        />
    );
    const openRow = (tick1, tick2) => {
        if (!twoPanel) {
            onOpenMarket(selectedAsset.chainId, tick1, tick2);
            return;
        }
        setLocalPick({ chainId: selectedAsset.chainId, tick1, tick2 });
        onSelectMarket?.(selectedAsset.chainId, tick1, tick2);
    };

    const listNotice = showLoading ? (
        <StatusMessage variant="status" label={t('routes.marketsList.loading')} busy>{t('routes.marketsList.loading')}</StatusMessage>
    ) : null;
    const listToolbar = (
        <div style={{ width: '100%' }}>
            <Button
                type="button"
                className={`${marketsStyles.assetCard} ${marketsStyles.assetButton}`}
                icon={null}
                onClick={onChangeAsset}
                aria-label={selectedAsset
                    ? `Change asset (currently ${assetName})`
                    : 'Select coin or token'}
            >
                {selectedAsset && selectorDescriptor ? (
                    <AssetMark
                        chainId={selectorDescriptor.id}
                        tick={selectorTickUpper}
                        isNative={!isTokenSelection}
                    />
                ) : null}
                {/* The card names the selection: the chain for a native coin
                    (without its network kind), the token name otherwise. */}
                <span className={marketsStyles.assetText}>
                    <span className={marketsStyles.assetName}>{assetName}</span>
                </span>
                <span className={marketsStyles.assetChevron} aria-hidden="true">›</span>
            </Button>
        </div>
    );
    const listResults = (
                <div>
                    <div id={marketResultsId} role="region" aria-label="Markets results" aria-busy={(marketsLoading && !showOffline) || undefined}>
                        {!selectedAsset ? (
                            <EmptyState
                                title="No asset selected"
                                body="Choose a coin or token to view its markets."
                                actionLabel="Choose an Asset"
                                onAction={onChangeAsset}
                                actionIcon={<Icon.MarketIcon />}
                            />
                        ) : showOffline ? (
                            <OfflineEmptyState body="Markets load when the connection returns." onRetry={recheckNetwork} />
                        ) : showLoading ? (
                            <div aria-hidden="true">
                                <Skeleton.List rows={5} rowHeight={60} avatarSize={36} />
                            </div>
                        ) : displayMarkets.length === 0 ? (
                            <EmptyState
                                title={filtersHideAllMarkets
                                    ? 'No results for these filters'
                                    : debouncedSearch.trim()
                                    ? 'No matches'
                                    : tab === 'watchlist'
                                        ? 'Empty watchlist'
                                        : `No markets for ${selectedAsset.tick}`}
                                body={debouncedSearch.trim()
                                    ? 'Matching markets appear here after you change or clear the search.'
                                    : filtersHideAllMarkets
                                    ? 'Matching markets appear here after you reset or change the filters.'
                                    : tab === 'watchlist'
                                        ? `Markets for ${selectedAsset.tick} that you star on their market page appear here.`
                                        : undefined}
                                actionLabel={filtersHideAllMarkets ? 'Reset Filters' : undefined}
                                actionIcon={<Icon.RefreshIcon />}
                                onAction={filtersHideAllMarkets ? resetFilters : undefined}
                            />
                        ) : (
                        <div className={marketsStyles.marketsCard}>
                            <ul ref={marketResultsRef} aria-label="Markets" className={marketsStyles.marketsGrid}>
                                {visibleMarkets.map((m, idx) => (
                                    <MarketRow
                                        key={`${selectedAsset.chainId}::${m.tick1}::${m.tick2}::${idx}`}
                                        chainId={selectedAsset.chainId}
                                        selectedTick={selectedAsset.tick}
                                        tick1={m.tick1}
                                        tick2={m.tick2}
                                        name1={m.name1}
                                        name2={m.name2}
                                        lastPrice={m.lastPrice}
                                        change24h={m.change24h}
                                        depth={m.depth}
                                        series={seriesByPair.get(`${m.tick1}::${m.tick2}`)}
                                        onOpen={() => openRow(m.tick1, m.tick2)}
                                        openDisabled={networkOffline}
                                        selected={Boolean(shownMarket) && samePair(m, shownMarket.tick1, shownMarket.tick2)}
                                    />
                                ))}
                            </ul>
                            {displayMarkets.length > visibleMarketCount ? (
                                <div className={marketsStyles.pagination} aria-live="polite">
                                    <span
                                        className={marketsStyles.paginationCount}
                                        style={{ fontVariantNumeric: 'tabular-nums' }}
                                    >
                                        {visibleMarketCount.toLocaleString('en-US')} of {displayMarkets.length.toLocaleString('en-US')} markets shown
                                    </span>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        icon={<Icon.ChevronDownIcon />}
                                        onClick={() => setVisibleMarketCount((count) => count + MARKETS_PAGE_SIZE)}
                                    >
                                        Load More Markets
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                        )}
                    </div>
                </div>
    );
    const listPage = (
        <ListPage notices={listNotice} toolbar={listToolbar}>
            {listResults}
        </ListPage>
    );

    const marketPanelKey = shownMarket ? `${shownMarket.chainId}:${shownMarket.tick1}:${shownMarket.tick2}` : 'loading';
    const marketPanelSkeleton = (
        <div aria-hidden="true">
            <Skeleton height={190} />
        </div>
    );
    return (
        <Screen variant={variant} header={header} bodyClassName={showMarketPanel ? marketsStyles.twoPanelBody : undefined}>
            {/* The measured box: Screen's content width decides the layout. */}
            <div
                ref={setLayoutBox}
                className={showMarketPanel ? marketsStyles.twoPanel : marketsStyles.layoutRoot}
                data-dex-layout={showMarketPanel ? 'two-panel' : 'list'}
            >
                {showMarketPanel ? (
                    <>
                        {/* Each panel is its own named scroll region the
                            keyboard can reach (G128). */}
                        <div
                            className={marketsStyles.listPanel}
                            style={{ flexBasis: `${split.width}px` }}
                        >
                            <div className={marketsStyles.listHeader}>
                                <ListPage notices={listNotice} toolbar={listToolbar} />
                            </div>
                            <div
                                id={`${marketResultsId}-scroll`}
                                className={marketsStyles.listBody}
                                role="region"
                                aria-label={t('market.listRegion')}
                                tabIndex={0}
                            >
                                <ListPage>{listResults}</ListPage>
                            </div>
                        </div>
                        {/* The line between the panels says plainly there are two, and
                            drags to resize the list (Left/Right, Shift for bigger steps,
                            Home/End, Enter or a double-click for the default). */}
                        <PanelSplitDivider
                            split={split}
                            className={marketsStyles.panelDivider}
                            label={t('market.resizeList')}
                            controls={`${marketResultsId}-scroll`}
                            hint={t('market.resizeListHint')}
                        />
                        {/* The page header stays "Decentralized Exchange"; the market's
                            own card names it. Keyed on the market alone, so the list
                            re-rendering never reloads it. */}
                        <div
                            className={marketsStyles.marketPanel}
                            role="region"
                            aria-label={shownMarket ? `${shownMarket.tick1}/${shownMarket.tick2} market` : 'Market'}
                            aria-busy={!shownMarket || undefined}
                            tabIndex={0}
                        >
                            {/* Its own Suspense: a shell's lazily loaded market page
                                fills this panel, never blanks the list beside it. */}
                            <DexHeaderSlot.Provider value={dexSlots}>
                                <Suspense fallback={marketPanelSkeleton}>
                                    {shownMarket ? (
                                        <Fragment key={marketPanelKey}>
                                            {renderMarket(shownMarket, { onWatchlistChange: loadWatchlist })}
                                        </Fragment>
                                    ) : marketPanelSkeleton}
                                </Suspense>
                            </DexHeaderSlot.Provider>
                        </div>
                    </>
                ) : listPage}
            </div>
        </Screen>
    );
}

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {string} [props.name1]
 * @param {string} [props.name2]
 * @param {string} [props.lastPrice]
 * @param {string} [props.change24h]
 * @param {number} [props.depth]
 * @param {number[]} [props.series] the market's 24h closing prices, oldest first
 * @param {boolean} [props.openDisabled]
 * @param {boolean} [props.selected] the market the DEX's right panel shows
 * @param {() => void} props.onOpen
 */
function MarketRow({ chainId, selectedTick, tick1, tick2, name1, name2, lastPrice, change24h, depth, series, openDisabled, selected = false, onOpen }) {
    const selUpper = String(selectedTick || '').toUpperCase();
    // Show the icon for the OTHER side of the pair, the side the user
    // didn't pick. Falls back to tick1 if neither side matches.
    const otherTick = tick2.toUpperCase() === selUpper ? tick1
        : tick1.toUpperCase() === selUpper ? tick2
        : tick1;
    const otherName = tick2.toUpperCase() === selUpper ? name1
        : tick1.toUpperCase() === selUpper ? name2
        : name1;
    const changeNum = change24h ? parseFloat(String(change24h).replace(/[^\d.+-]/g, '')) : NaN;
    const changeDisplay = percentChangeDisplay(changeNum);
    // The row chart and the change figure share one tone, taken from the sign
    // of the 24h change (not the series' first and last points, which can
    // disagree with the explorer's figure).
    const tone = changeDisplay?.direction === 'positive' ? 'up'
        : changeDisplay?.direction === 'negative' ? 'down' : 'flat';
    const toneColor = ROW_TONE_COLOR[tone];
    const hasDepth = typeof depth === 'number' && Number.isFinite(depth);
    const hasSeries = Array.isArray(series) && series.length >= 2;
    return (
        <li className={marketsStyles.row} data-change-tone={tone} data-selected={selected ? 'true' : undefined}>
            {/* A faint area chart fills the row behind its text. The fill stays
                at a low alpha so the name and the muted Depth line keep AA
                contrast on it; the figures sit on their own surface. */}
            {hasSeries ? (
                <div className={marketsStyles.rowChart} aria-hidden="true" data-row-chart={tone}>
                    <Sparkline
                        series={series}
                        height="100%"
                        edgeToEdge
                        strokeWidth={1.5}
                        strokeColor={`color-mix(in srgb, ${toneColor} ${ROW_CHART_STROKE_PCT}%, transparent)`}
                        areaFill={`color-mix(in srgb, ${toneColor} ${ROW_CHART_FILL_PCT}%, transparent)`}
                    />
                </div>
            ) : null}
            <ListRow
                type="button"
                className={marketsStyles.marketButton}
                onClick={onOpen}
                disabled={openDisabled}
                aria-current={selected ? 'true' : undefined}
                aria-label={`Open ${otherName || otherTick} market`}
                tooltip={openDisabled ? 'Opening a market needs a network connection' : undefined}
                data-market-result="true"
                chevron
                contentClassName={marketsStyles.marketContent}
                trailingClassName={marketsStyles.marketTrailing}
                // Token icon with its small network badge, on every chain (operator 2026-11-13).
                leading={<TickerIcon chainId={chainId} tick={otherTick} />}
                // The token alone: every row on the page is quoted in the coin
                // the picker above names, so a "/BTC" suffix repeats it.
                title={<span className={marketsStyles.marketName} title={otherTick}>{otherTick}</span>}
                // The market's open-order count, said plainly: "64 orders" (operator 2026-11-13).
                subtitle={hasDepth ? <span className={marketsStyles.marketDepth}>{depth === 1 ? '1 order' : `${depth.toLocaleString('en-US')} orders`}</span> : null}
                trailing={(lastPrice || change24h) ? (
                    <span className={marketsStyles.figures}>
                        {lastPrice ? (
                            <span className={marketsStyles.price}>{formatDecimalAmount(lastPrice)}</span>
                        ) : null}
                        {change24h ? (
                            <span
                                className={marketsStyles.change}
                                aria-label={changeDisplay ? `24-hour change. ${changeDisplay.label}` : undefined}
                                data-change={tone}
                                style={{ color: toneColor }}
                            >
                                {changeDisplay?.text ?? change24h}
                            </span>
                        ) : null}
                    </span>
                ) : null}
            />
        </li>
    );
}

// The row tone's colour, shared by the chart stroke, its fill and the change figure.
const ROW_TONE_COLOR = {
    up: 'var(--xc-success)',
    down: 'var(--xc-danger-fg)',
    flat: 'var(--xc-text-muted)',
};
// The fill's share of the tone colour. At 6% the muted Depth line over it
// keeps AA (4.6:1 on the light theme's red tint, the worst case).
const ROW_CHART_FILL_PCT = 6;
// The line is a matching but softer stroke, so it reads as background.
const ROW_CHART_STROKE_PCT = 45;

// --- Row chart series ------------------------------------------------

const DAY_SECONDS = 86400;
const HOUR_SECONDS = 3600;

/**
 * Hourly closes over the last 24h from match rows, oldest first. A quiet day
 * starts from the close before it; null with fewer than two points to draw.
 */
export function daySeriesFromMatches(rows, tick1, tick2, nowSeconds = Math.floor(Date.now() / 1000)) {
    const candles = bucketizeMatches(rows, { tick1, tick2, periodSeconds: HOUR_SECONDS });
    if (candles.length === 0) return null;
    const since = nowSeconds - DAY_SECONDS;
    const inside = candles.filter((c) => c.time >= since).map((c) => c.close);
    const before = candles.filter((c) => c.time < since);
    const out = inside.length >= 2 || before.length === 0
        ? inside
        : [before[before.length - 1].close, ...inside];
    const finite = out.filter(Number.isFinite);
    return finite.length >= 2 ? finite : null;
}

/**
 * The row charts' series for every market on the visible page, keyed
 * tick1::tick2. Built once per page of markets and never per row. The explorer has no bulk
 * price-history read (its history route is per pair), so a live market draws
 * no chart; a demo wallet draws each pair's local sample trades, which cost
 * no read at all. A bulk explorer read slots in here as the one call.
 *
 * @param {{ markets: Array<{ tick1: string, tick2: string }>, demo: boolean }} args
 * @returns {Map<string, number[]>}
 */
export function readMarketSeries({ markets, demo }) {
    const out = new Map();
    if (!demo) return out;
    for (const m of markets) {
        const key = `${m.tick1}::${m.tick2}`;
        if (out.has(key)) continue;
        const series = daySeriesFromMatches(sampleMatchesFor(m.tick1, m.tick2), m.tick1, m.tick2);
        if (series) out.set(key, series);
    }
    return out;
}

// --- TEMP sample markets (delete when real feeds populate) -------

const SAMPLE_MARKETS = {
    BTC: [
        { tick1: 'PEPECASH',     tick2: 'BTC', lastPrice: '0.00000089', change24h: '+5.2%',  depth: 14 },
        { tick1: 'XCP',          tick2: 'BTC', lastPrice: '0.00012450', change24h: '-2.1%',  depth: 22 },
        { tick1: 'RAREPEPE',     tick2: 'BTC', lastPrice: '0.00078900', change24h: '+12.3%', depth: 18 },
        { tick1: 'BITCRYSTAL',   tick2: 'BTC', lastPrice: '0.00000045', change24h: '+1.8%',  depth: 6 },
        { tick1: 'LTBCOIN',      tick2: 'BTC', lastPrice: '0.00000034', change24h: '0.0%',   depth: 9 },
        { tick1: 'MEMECASH',     tick2: 'BTC', lastPrice: '0.00000890', change24h: '-5.7%',  depth: 11 },
        { tick1: 'WAVEY',        tick2: 'BTC', lastPrice: '0.00002300', change24h: '+3.4%',  depth: 8 },
        { tick1: 'TOKENLY',      tick2: 'BTC', lastPrice: '0.00001500', change24h: '-1.2%',  depth: 7 },
        { tick1: 'PEPECREATURE', tick2: 'BTC', lastPrice: '0.00000067', change24h: '+8.9%',  depth: 13 },
        { tick1: 'COIN',         tick2: 'BTC', lastPrice: '0.00045000', change24h: '+0.5%',  depth: 5 },
    ],
    LTC: [
        { tick1: 'LTBPLUS',  tick2: 'LTC', lastPrice: '0.00012300', change24h: '+2.1%',  depth: 4 },
        { tick1: 'PEPELITE', tick2: 'LTC', lastPrice: '0.00000456', change24h: '-1.4%',  depth: 6 },
        { tick1: 'LITECASH', tick2: 'LTC', lastPrice: '0.00001100', change24h: '+4.7%',  depth: 8 },
    ],
    DOGE: [
        { tick1: 'DOGEFREN',  tick2: 'DOGE', lastPrice: '0.00050000', change24h: '+15.0%', depth: 12 },
        { tick1: 'WOWTOKEN',  tick2: 'DOGE', lastPrice: '0.00120000', change24h: '-3.2%',  depth: 7 },
        { tick1: 'SHIBOGECOIN', tick2: 'DOGE', lastPrice: '0.00002300', change24h: '+8.4%', depth: 5 },
    ],
};

// --- Explorer-response normalisation ------------------------------

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.markets)) return resp.markets;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

// A price or change figure from the explorer, or null when it is not a finite
// number. An object, NaN or an overflowing exponent has no honest rendering,
// so the market shows no figure rather than "NaN" or "[object Object]".
function finiteFigure(value, { percent = false } = {}) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    if (text === '') return null;
    const numeric = percent ? text.replace(/%$/, '') : text;
    return Number.isFinite(Number(numeric)) ? text : null;
}

/**
 * Normalize a market row. The explorer returns one of several shapes
 * depending on version; pick out the fields we render and fail closed
 * (return null) if the row can't even yield a ticker pair.
 */
export function normalizeMarket(row) {
    if (!row || typeof row !== 'object') return null;
    const tick1 = row.tick1 || row.tickA || row.give_tick || row.base || null;
    const tick2 = row.tick2 || row.tickB || row.get_tick || row.quote || null;
    if (typeof tick1 !== 'string' || typeof tick2 !== 'string') return null;
    // A pair of one token with itself is no market; opening it would offer
    // an order that gives and gets the same token.
    if (tick1.trim().toUpperCase() === tick2.trim().toUpperCase()) return null;
    const lastPrice = finiteFigure(row.tick1_price ?? row.last_price ?? row.lastPrice ?? row.last);
    const change24h = finiteFigure(
        row.tick1_24hr_change ?? row.change_24h ?? row.change24h,
        { percent: true },
    );
    const depthRaw = row.depth ?? row.open_orders ?? row.orderCount;
    const depth = typeof depthRaw === 'number' ? depthRaw : Number(depthRaw);
    const name1 = row.name1 ?? row.tick1_name ?? row.tick1Name ?? row.base_name ?? row.baseName;
    const name2 = row.name2 ?? row.tick2_name ?? row.tick2Name ?? row.quote_name ?? row.quoteName;
    return {
        tick1: String(tick1),
        tick2: String(tick2),
        ...(name1 != null && String(name1).length > 0 ? { name1: String(name1) } : {}),
        ...(name2 != null && String(name2).length > 0 ? { name2: String(name2) } : {}),
        lastPrice: lastPrice ?? undefined,
        change24h: change24h ?? undefined,
        depth: Number.isFinite(depth) && depth >= 0 ? depth : undefined,
    };
}
