// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, PageHeader, Screen, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, branding as brandingLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { DispenserBadge } from '../components/DispenserBadge.jsx';
import { tickerColor } from '../components/BalanceList.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import styles from './IssueTokenForm.module.css';
import receiveStyles from './Receive.module.css';
import receivePickerStyles from './TokenPicker.module.css';
import marketsStyles from './MarketsList.module.css';
import { percentChangeDisplay } from '../utils/percentFormat.js';

const chainRegistry = registryLib.defaultRegistry();
const MARKETS_PAGE_SIZE = 25;
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const SEARCH_DEBOUNCE_MS = 200;
function nativeTickerFor(descriptor) {
    if (!descriptor?.coin) return null;
    return NATIVE_TICKER_BY_COIN[descriptor.coin] || descriptor.coin.toUpperCase();
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
 * @param {object} props
 * @param {string} props.walletId
 * @param {{ chainId: string, tick: string, displayName?: string, kind?: string } | null} [props.selectedAsset]
 * @param {() => void} props.onChangeAsset
 * @param {(chainId: string, tick1: string, tick2: string) => void} props.onOpenMarket
 * @param {() => void} [props.onBack]
 */
export function MarketsList({
    walletId,
    selectedAsset,
    onChangeAsset,
    onOpenMarket,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [markets, setMarkets] = useState(/** @type {Array<{ tick1: string, tick2: string, lastPrice?: string, change24h?: string, depth?: number }>} */ ([]));
    const [watchlist, setWatchlist] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(Boolean(selectedAsset));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [settledAssetKey, setSettledAssetKey] = useState(/** @type {string | null} */ (null));
    const [marketsReload, setMarketsReload] = useState(0);
    const [tab, setTab] = useState(/** @type {'all' | 'popular' | 'watchlist'} */ ('popular'));
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const searchRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const marketResultsRef = useRef(/** @type {HTMLUListElement | null} */ (null));

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [search]);

    const [visibleMarketCount, setVisibleMarketCount] = useState(MARKETS_PAGE_SIZE);

    const loadWatchlist = useCallback(async () => {
        try {
            const rows = await messaging.listWatchlistForWallet({ walletId });
            setWatchlist(Array.isArray(rows) ? rows : []);
        } catch {
            setWatchlist([]);
        }
    }, [walletId, messaging]);

    useEffect(() => {
        loadWatchlist();
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
        messaging.getMarkets({ chainId: selectedAsset.chainId })
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
    }, [selectedAsset, messaging, walletId, marketsReload]);

    const selectedAssetKey = selectedAsset
        ? `${selectedAsset.chainId}:${selectedAsset.tick}`
        : null;
    const marketsLoading = Boolean(selectedAsset)
        && (loading || settledAssetKey !== selectedAssetKey);
    const hasCachedMarkets = settledAssetKey === selectedAssetKey;

    const watchlistKeySet = useMemo(() => {
        const s = new Set();
        for (const e of watchlist) s.add(`${e.chainId}::${e.tick1}::${e.tick2}`);
        return s;
    }, [watchlist]);

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
        const onChain = watchlist.filter((e) => e.chainId === selectedAsset.chainId
            && (e.tick1.toUpperCase() === selTick || e.tick2.toUpperCase() === selTick));
        // Hydrate from the markets list when the same pair has live data,
        // so prices/changes show up for starred rows too.
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

    const firstMarketResult = () => marketResultsRef.current?.querySelector('[data-market-result="true"]');
    const handleSearchKeyDown = (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;
        const result = firstMarketResult();
        if (!result) return;
        event.preventDefault();
        if (event.key === 'Enter') result.click();
        else result.focus();
    };
    const clearSearch = () => {
        setSearch('');
        setDebouncedSearch('');
        setVisibleMarketCount(MARKETS_PAGE_SIZE);
        searchRef.current?.focus();
    };

    const filtersHideResults = Boolean(search.trim())
        || (tab !== 'all' && markets.length > displayMarkets.length);
    const resetFilters = () => {
        setSearch('');
        setTab('all');
        setVisibleMarketCount(MARKETS_PAGE_SIZE);
    };

    const toggleStar = useCallback(async (chainId, tick1, tick2) => {
        const key = `${chainId}::${tick1}::${tick2}`;
        const existing = watchlist.find(
            (e) => `${e.chainId}::${e.tick1}::${e.tick2}` === key,
        );
        try {
            if (existing) {
                await messaging.clearWatchlistEntry({ id: existing.id });
            } else {
                await messaging.saveWatchlistEntry({ walletId, chainId, tick1, tick2 });
            }
            await loadWatchlist();
        } catch {
            /* ignore; star will revert visually on next reload */
        }
    }, [watchlist, walletId, messaging, loadWatchlist]);

    const header = (
        <PageHeader onBack={onBack} title="Decentralized Exchange" titleIcon={<Icon.MarketIcon />} />
    );

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
    const assetImageUrl = selectedAsset && selectorDescriptor
        ? (isTokenSelection ? null : brandingLib.chainIconLargeUrl(selectorDescriptor.id))
        : null;
    const assetLetter = selectedAsset
        ? (isTokenSelection
            ? selectorTickUpper.slice(0, 1)
            : (selectorNativeTicker || selectorDescriptor?.displayName || '?').slice(0, 1))
        : '?';
    const assetSub = selectedAsset && selectorDescriptor
        ? (isTokenSelection
            ? selectorTickUpper
            : (selectorDescriptor.networkKind !== 'mainnet' ? selectorDescriptor.networkKind : (selectorDescriptor.displayName || '')))
        : '';

    return (
        <Screen variant={variant} header={header}>
            <ListPage
                toolbar={(
                    <div style={{ width: '100%' }}>
                        <button
                            type="button"
                            className={receiveStyles.assetCard}
                            onClick={onChangeAsset}
                            aria-label={selectedAsset
                                ? `Change asset (currently ${assetName})`
                                : 'Select coin or token'}
                        >
                            <span className={receiveStyles.assetIconWrap}>
                                {assetImageUrl ? (
                                    <img
                                        src={assetImageUrl}
                                        alt=""
                                        aria-hidden="true"
                                        className={receiveStyles.assetIcon}
                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                ) : (
                                    <span
                                        className={receiveStyles.assetIconFallback}
                                        style={{ background: tickerColor(selectorTickUpper || 'BTC') }}
                                        aria-hidden="true"
                                    >
                                        {assetLetter}
                                    </span>
                                )}
                                {isTokenSelection && selectorDescriptor ? (() => {
                                    const chainPipUrl = brandingLib.chainIconSmallUrl(selectorDescriptor.id);
                                    return chainPipUrl ? (
                                        <img
                                            src={chainPipUrl}
                                            alt=""
                                            aria-hidden="true"
                                            title={selectorDescriptor.displayName}
                                            className={receiveStyles.assetChainOverlay}
                                        />
                                    ) : null;
                                })() : null}
                            </span>
                            <span className={receiveStyles.assetText}>
                                <span className={receiveStyles.assetName}>{assetName}</span>
                                {assetSub ? (
                                    <span className={receiveStyles.assetSub}>{assetSub}</span>
                                ) : null}
                            </span>
                            <span className={receiveStyles.assetChevron} aria-hidden="true">›</span>
                        </button>

                        {selectedAsset ? (
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: 'var(--xc-space-2)',
                                marginBottom: 'var(--xc-space-3)',
                            }}>
                                <input
                                    ref={searchRef}
                                    type="search"
                                    enterKeyHint="search"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    value={search}
                                    onChange={(e) => {
                                        setSearch(e.target.value);
                                        setVisibleMarketCount(MARKETS_PAGE_SIZE);
                                    }}
                                    onKeyDown={handleSearchKeyDown}
                                    placeholder="Search"
                                    aria-label="Search markets"
                                    style={{
                                        flex: '1 1 140px',
                                        minWidth: 0,
                                        padding: 'var(--xc-space-2) var(--xc-space-3)',
                                        border: '1px solid var(--xc-border)',
                                        borderRadius: 999,
                                        background: 'var(--xc-bg-muted)',
                                        color: 'var(--xc-text)',
                                        font: 'inherit',
                                        fontSize: 'var(--xc-text-sm)',
                                    }}
                                />
                                {search ? (
                                    <Button type="button" size="sm" variant="ghost" icon={null} onClick={clearSearch} aria-label="Clear market search">
                                        <Icon.XIcon />
                                    </Button>
                                ) : null}
                                <div
                                    className={receivePickerStyles.kindSegments}
                                    role="tablist"
                                    aria-label="Markets view"
                                    style={{ flexShrink: 0 }}
                                >
                                    {[
                                        { id: 'all',       label: 'All' },
                                        { id: 'popular',   label: 'Popular' },
                                        { id: 'watchlist', label: 'Watchlist' },
                                    ].map((opt) => {
                                        const active = tab === opt.id;
                                        return (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                role="tab"
                                                aria-selected={active}
                                                className={`${receivePickerStyles.kindSegment} ${active ? receivePickerStyles.kindSegmentActive : ''}`}
                                                onClick={() => {
                                                    setTab(opt.id);
                                                    setVisibleMarketCount(MARKETS_PAGE_SIZE);
                                                }}
                                            >
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
            >

                <div role="region" aria-label="Markets results" aria-busy={marketsLoading || undefined}>
                    {!selectedAsset ? (
                        <EmptyState
                            title="No asset selected"
                            body="Choose a coin or token to view its markets."
                        />
                    ) : marketsLoading && !hasCachedMarkets ? (
                        <div role="status" aria-label="Loading markets">
                            <Skeleton.List rows={5} rowHeight={60} avatarSize={36} />
                        </div>
                    ) : loadError ? (
                        <StatusMessage
                            variant="error"
                            className={styles.hint}
                            recovery={{
                                label: 'Try again',
                                onAction: () => {
                                    setSettledAssetKey(null);
                                    setLoading(true);
                                    setMarketsReload((value) => value + 1);
                                },
                            }}
                        >
                            {loadError}
                        </StatusMessage>
                    ) : displayMarkets.length === 0 ? (
                        <EmptyState
                            title={debouncedSearch.trim()
                                ? 'No matches'
                                : tab === 'watchlist'
                                    ? 'Empty watchlist'
                                    : `No markets for ${selectedAsset.tick}`}
                            body={debouncedSearch.trim()
                                ? `No markets match "${debouncedSearch.trim()}".`
                                : tab === 'watchlist'
                                    ? `Starred markets for ${selectedAsset.tick} appear here.`
                                    : 'No pairs found involving this asset on its chain.'}
                            actionLabel={filtersHideResults ? 'Reset filters' : undefined}
                            onAction={filtersHideResults ? resetFilters : undefined}
                        />
                    ) : (
                    <div className={receiveStyles.assetCard} style={{ display: 'block', padding: 0, marginBottom: 'var(--xc-space-3)' }}>
                        <ul ref={marketResultsRef} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {displayMarkets.slice(0, visibleMarketCount).map((m, idx) => (
                                <MarketRow
                                    key={`${m.tick1}::${m.tick2}`}
                                    chainId={selectedAsset.chainId}
                                    selectedTick={selectedAsset.tick}
                                    tick1={m.tick1}
                                    tick2={m.tick2}
                                    name1={m.name1}
                                    name2={m.name2}
                                    lastPrice={m.lastPrice}
                                    change24h={m.change24h}
                                    depth={m.depth}
                                    starred={watchlistKeySet.has(`${selectedAsset.chainId}::${m.tick1}::${m.tick2}`)}
                                    onOpen={() => onOpenMarket(selectedAsset.chainId, m.tick1, m.tick2)}
                                    onToggleStar={() => toggleStar(selectedAsset.chainId, m.tick1, m.tick2)}
                                    first={idx === 0}
                                />
                            ))}
                        </ul>
                        {displayMarkets.length > visibleMarketCount ? (
                            <div className={marketsStyles.pagination} aria-live="polite">
                                <span className={marketsStyles.paginationCount}>
                                    {visibleMarketCount.toLocaleString('en-US')} of {displayMarkets.length.toLocaleString('en-US')} markets shown
                                </span>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => setVisibleMarketCount((count) => count + MARKETS_PAGE_SIZE)}
                                >
                                    Load more markets
                                </Button>
                            </div>
                        ) : null}
                    </div>
                    )}
                </div>
            </ListPage>
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
 * @param {boolean} [props.starred]
 * @param {() => void} props.onOpen
 * @param {() => void} props.onToggleStar
 */
function MarketRow({ chainId, selectedTick, tick1, tick2, name1, name2, lastPrice, change24h, depth, starred, onOpen, onToggleStar, first }) {
    const descriptor = chainRegistry.get(chainId);
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
    const changeColor = changeDisplay?.direction === 'positive'
        ? 'var(--xc-success)'
        : changeDisplay?.direction === 'negative' ? 'var(--xc-danger)' : 'var(--xc-text-muted)';
    // Depth intensity: same accent hue, more saturated background as
    // depth grows. Five tiers tuned to feel meaningful from 1 → 30+.
    const depthPct = typeof depth === 'number' && Number.isFinite(depth)
        ? (depth <= 1 ? 8
            : depth <= 4 ? 14
            : depth <= 12 ? 22
            : depth <= 25 ? 34
            : 48)
        : 0;
    return (
        <li className={marketsStyles.row}>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
                aria-label={starred ? 'Remove from watchlist' : 'Add to watchlist'}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1.1rem',
                    color: starred ? 'var(--xc-accent-primary)' : 'var(--xc-text-muted)',
                    padding: 0,
                    lineHeight: 1,
                    // slice 2: the star glyph paints ~18px, under the
                    // 24px pointer-target floor. Centre it in a target-sized
                    // box so the row looks the same and the star is hittable.
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 'var(--xc-tap-min)',
                    minHeight: 'var(--xc-tap-min)',
                }}
            >
                {starred ? '★' : '☆'}
            </button>
            <button
                type="button"
                onClick={onOpen}
                aria-label={`Open ${otherName || otherTick} market`}
                data-market-result="true"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--xc-space-2)',
                    flex: 1,
                    minWidth: 0,
                    padding: 0,
                    border: 0,
                    background: 'none',
                    color: 'inherit',
                    font: 'inherit',
                    textAlign: 'start',
                    cursor: 'pointer',
                }}
            >
            <TickerIcon chainId={chainId} tick={otherTick} />
            <div
                style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    minWidth: 0,
                }}
            >
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--xc-space-2)', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 'var(--xc-text-md)' }}>{otherTick}</strong>
                    {otherName && otherName.toUpperCase() !== otherTick.toUpperCase() ? (
                        <span>{otherName}</span>
                    ) : null}
                    <DispenserBadge chainId={chainId} tick={otherTick} />
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)', fontSize: 'var(--xc-text-xs)', color: 'var(--xc-text-muted)' }}>
                    {lastPrice ? <span>last {lastPrice}</span> : null}
                </span>
            </div>
            <div style={{
                flex: '0 0 auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '2px',
            }}>
                {change24h ? (
                    <span
                        aria-label={changeDisplay ? `24-hour change. ${changeDisplay.label}` : undefined}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            fontSize: 'var(--xc-text-sm)',
                            fontWeight: 600,
                            color: changeColor,
                        }}
                    >
                        {changeDisplay?.text ?? change24h}
                        {changeDisplay && changeDisplay.direction !== 'neutral' ? (
                            <span aria-hidden="true" style={{ fontSize: '0.8em', lineHeight: 1 }}>
                                {changeDisplay.direction === 'positive' ? '▲' : '▼'}
                            </span>
                        ) : null}
                    </span>
                ) : null}
                {typeof depth === 'number' && Number.isFinite(depth) ? (
                    <span style={{
                        display: 'inline-block',
                        background: `color-mix(in srgb, var(--xc-accent-primary) ${depthPct}%, transparent)`,
                        color: 'var(--xc-accent-text)',
                        fontWeight: 600,
                        padding: '1px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        lineHeight: 1.5,
                    }}>
                        depth {depth}
                    </span>
                ) : null}
            </div>
            </button>
        </li>
    );
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

/**
 * Normalize a market row. The explorer returns one of several shapes
 * depending on version; pick out the fields we render and fail closed
 * (return null) if the row can't even yield a ticker pair.
 */
export function normalizeMarket(row) {
    if (!row || typeof row !== 'object') return null;
    const tick1 = row.tick1 || row.tickA || row.give_tick || row.base || null;
    const tick2 = row.tick2 || row.tickB || row.get_tick || row.quote || null;
    if (!tick1 || !tick2) return null;
    const lastPrice = row.tick1_price ?? row.last_price ?? row.lastPrice ?? row.last ?? null;
    const change24h = row.tick1_24hr_change ?? row.change_24h ?? row.change24h ?? null;
    const depthRaw = row.depth ?? row.open_orders ?? row.orderCount;
    const depth = typeof depthRaw === 'number' ? depthRaw : Number(depthRaw);
    const name1 = row.name1 ?? row.tick1_name ?? row.tick1Name ?? row.base_name ?? row.baseName;
    const name2 = row.name2 ?? row.tick2_name ?? row.tick2Name ?? row.quote_name ?? row.quoteName;
    return {
        tick1: String(tick1),
        tick2: String(tick2),
        ...(name1 != null && String(name1).length > 0 ? { name1: String(name1) } : {}),
        ...(name2 != null && String(name2).length > 0 ? { name2: String(name2) } : {}),
        lastPrice: lastPrice != null && String(lastPrice).length > 0 ? String(lastPrice) : undefined,
        change24h: change24h != null && String(change24h).length > 0 ? String(change24h) : undefined,
        depth: Number.isFinite(depth) ? depth : undefined,
    };
}
