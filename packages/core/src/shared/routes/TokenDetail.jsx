// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Screen, ScreenHeader, ChainBadge, Icon, Button, Input } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { isDemoGatedActionIndex } from '../../flows/demoGatedContent.js';
import { StalenessLabel } from '../components/StalenessLabel.jsx';
import { Sparkline, synthesizeTokenChart } from '../components/Sparkline.jsx';
import { RANGES as CHART_RANGES, resampleTo as resampleSeriesTo } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { useNativePrice } from '../hooks/useNativePrice.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { usePortfolioChartVisible } from '../hooks/usePortfolioChartVisible.js';
import styles from './TokenDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * §27.6 token detail page (G071).
 *
 * Single-token view that aggregates everything we know about one
 * (chainId, tick) pair from the data surfaces the wallet already
 * exposes: the row metadata threaded in from the unified balance list,
 * `messaging.getHoldersForToken` for the distribution panel, and the
 * existing History route as the "View activity" target (pre-filtered
 * by tick via History's `initialSearchQuery` prop).
 *
 * Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3 ship the richer metadata
 * via `messaging.getTokenInfo`: description / creator / supply / lock
 * status / market price / extracted image URL all surface inline below
 * the existing fixed metadata block. Phase-3 features (Sell on DEX,
 * Market view, supply chart over time) and reputation remain tracked
 * in FOLLOWUPS.md under §27.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick                       ticker (uppercase canonical)
 * @param {'native' | 'token' | 'subtoken' | string} [props.kind]
 * @param {string} [props.displayName]               human-readable name (defaults to ticker)
 * @param {number} [props.divisibility]
 * @param {number | null} [props.fiatRate]           USD per token if known
 * @param {string} [props.quantity]                  atomic-unit balance string
 * @param {() => void} props.onBack
 * @param {() => void} [props.onSend]                navigate to Send route
 * @param {() => void} [props.onReceive]             navigate to Receive route
 * @param {() => void} [props.onViewActivity]        navigate to History pre-filtered to this tick
 */
export function TokenDetail({
    walletId,
    chainId,
    tick,
    kind = 'token',
    displayName,
    divisibility = 8,
    fiatRate = null,
    quantity = '0',
    imageUrl: rowImageUrl = null,
    onBack,
    onSend,
    onReceive,
    onBuy,
    onViewActivity,
}) {
    const { messaging, shell } = useMessaging();
    const { settings } = useSettings();
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const descriptor = chainRegistry.get(chainId);
    const isNative = kind === 'native';

    // §27.6 / Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3 — pull
    // description / creator / supply / locks / market / extracted
    // imageUrl. Skipped for native coins (BTC / LTC / DOGE) since
    // they're not XChain-issued tokens.
    const assetInfo = useTokenInfo({ chainId, tick, skip: isNative });

    // Native-coin price oracle (BTC / LTC / DOGE mainnet). Gated by
    // settings.privacy.priceDataEnabled; the hook surfaces a `disabled`
    // flag the UI uses to hide the stats strip + chart with no calls
    // having fired. Skipped for non-native (XCP tokens don't have a
    // CoinGecko entry).
    const nativePrice = useNativePrice(isNative ? chainId : null, { includeSparkline: true });

    const [holdersOpen, setHoldersOpen] = useState(false);
    const [holders, setHolders] = useState(/** @type {any[] | null} */ (null));
    const [holdersError, setHoldersError] = useState(/** @type {string | null} */ (null));
    const [holdersLoading, setHoldersLoading] = useState(false);
    // Cluster G FOLLOWUP 5 — Unix ms of the last holders fetch; drives a
    // staleness label inside the holders panel so the user can tell at
    // a glance whether the listing is live.
    const [holdersFetchedAt, setHoldersFetchedAt] = useState(
        /** @type {number | null} */ (null),
    );

    // Token-gated content groups (per KEY_HASH). Populated when the Unlock
    // tab is opened. See xchain-documentation/protocol/TOKEN_GATED_CONTENT.md.
    const [gatedGroups, setGatedGroups] = useState(/** @type {any[] | null} */ (null));
    const [gatedError, setGatedError] = useState(/** @type {string | null} */ (null));
    const [gatedLoading, setGatedLoading] = useState(false);

    useEffect(() => {
        if (!holdersOpen || holders !== null || isNative) return undefined;
        if (typeof messaging.getHoldersForToken !== 'function') {
            setHoldersError('Holders lookup is not available in this build.');
            return undefined;
        }
        let cancelled = false;
        setHoldersLoading(true);
        setHoldersError(null);
        messaging.getHoldersForToken({ chainId, tick: tick })
            .then((resp) => {
                if (cancelled) return;
                const list = Array.isArray(resp) ? resp
                    : Array.isArray(resp?.data) ? resp.data
                    : Array.isArray(resp?.rows) ? resp.rows
                    : [];
                setHolders(list);
                setHoldersFetchedAt(Date.now());
            })
            .catch((err) => {
                if (cancelled) return;
                setHoldersError(err?.message || 'Failed to load holders.');
            })
            .finally(() => { if (!cancelled) setHoldersLoading(false); });
        return () => { cancelled = true; };
    }, [holdersOpen, holders, isNative, tick, chainId, messaging]);

    useEffect(() => {
        if (!holdersOpen || gatedGroups !== null || isNative) return undefined;
        if (typeof messaging.listGatedContent !== 'function') {
            // Older host build without gated-content support — skip silently
            // (no error UI), since pre-feature tokens have no gated entries.
            setGatedGroups([]);
            return undefined;
        }
        let cancelled = false;
        setGatedLoading(true);
        setGatedError(null);
        messaging.listGatedContent({ chainId, tick })
            .then((resp) => {
                if (cancelled) return;
                setGatedGroups(Array.isArray(resp) ? resp : []);
            })
            .catch((err) => {
                if (cancelled) return;
                setGatedError(err?.message || 'Failed to load gated content.');
            })
            .finally(() => { if (!cancelled) setGatedLoading(false); });
        return () => { cancelled = true; };
    }, [holdersOpen, gatedGroups, isNative, tick, chainId, messaging]);

    const fiat = useMemo(() => {
        if (typeof fiatRate !== 'number' || !isFinite(fiatRate)) return null;
        return fiatValue(quantity, divisibility, fiatRate);
    }, [quantity, divisibility, fiatRate]);

    // Header icon picks the smallest representation available: a TIS
    // `icon`-typed image first, then any other TIS image, then the
    // regex-extracted hero, then the balance-row image (demo SVG or
    // pre-known URL). For native coins the TIS lookup is skipped, so
    // we fall back to the branded chain logo so BTC/LTC/DOGE always
    // show the right glyph in the header + balance hero.
    const headerIconUrl = useMemo(() => {
        const tisImages = Array.isArray(assetInfo?.images) ? assetInfo.images : [];
        const iconHit = tisImages.find((i) => String(i?.type || '').toLowerCase() === 'icon');
        const fromTis = iconHit?.url
            || tisImages[0]?.url
            || assetInfo?.imageUrl
            || rowImageUrl
            || null;
        if (fromTis) return fromTis;
        if (isNative) {
            return branding.chainIconLargeUrl(chainId)
                || branding.chainIconSmallUrl(chainId)
                || null;
        }
        return null;
    }, [assetInfo, rowImageUrl, isNative, chainId]);

    const header = (
        <ScreenHeader
            onBack={onBack}
            title={displayName || tick}
            titleIcon={headerIconUrl ? (
                <img
                    src={headerIconUrl}
                    alt=""
                    aria-hidden="true"
                    className={styles.headerIcon}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            ) : null}
        />
    );

    const showNativeStats = isNative && !nativePrice.disabled && nativePrice.entry?.priceFiat != null;
    const showSparkline = showNativeStats && Array.isArray(nativePrice.entry?.sparkline) && nativePrice.entry.sparkline.length > 1;
    const hasDescription = !isNative && Boolean(assetInfo?.description);
    const hasMarketData = (isNative && showNativeStats) || (!isNative && assetInfo?.marketPrice != null);

    // Tabs match the Home layout pattern (Coins / Tokens / NFTs / DeFi /
    // Activity) — same tab strip styling, different content. Info first
    // (description / creator), then Market (price + chart), Metadata, and
    // Holders for tokens.
    // Native coins skip tabs entirely — the chart + info table live
    // stacked in a single scrollable view since there are only two
    // things to show. Tokens have tabs (Info / Market / Holders) since
    // the Holders list can be long and the description can be too.
    // Market section (stats strip + chart) is hoisted above the tabs
    // for both natives and tokens, so the page leads with performance.
    // Tokens keep tabs below for the longer-form Info + Holders content.
    // Three tabs for non-natives:
    //   - Details: stable on-chain metadata (name, ticker, supply, balance, creator, status)
    //   - Info: TIS-sourced content (description, media gallery, links, files)
    //   - Holders: distribution list
    // Default lands on Info because the TIS content is the richest surface;
    // when a token has no TIS payload the panel renders an empty-state hint.
    const tabs = isNative
        ? [
            { id: 'details', label: 'Details' },
        ]
        : [
            { id: 'about', label: 'About' },
            { id: 'media', label: 'Media' },
            { id: 'details', label: 'Details' },
            { id: 'holders', label: 'Unlock' },
        ];
    const [activeTab, setActiveTab] = useState(isNative ? 'details' : 'about');
    useEffect(() => {
        if (activeTab === 'holders') setHoldersOpen(true);
    }, [activeTab]);

    const [balanceHidden, toggleBalanceHidden] = useBalancesHidden();
    const [chartVisible, toggleChartVisible] = usePortfolioChartVisible();
    // Tap the amount to swap primary / secondary. Default: tick units
    // (matches the BalanceList convention; users opening Bitcoin expect
    // to see how much BTC they hold first, USD second). Fiat-as-primary
    // is one tap away for users who think in USD.
    const [primaryUnit, setPrimaryUnit] = useState('tick');

    // 4th quick-action button is now a "More" dropdown (matches the
    // pattern from the ActionDetail page). Buy lives inside the menu so
    // less-frequent actions stay out of the primary row.
    const [moreOpen, setMoreOpen] = useState(false);
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
        if (!moreOpen) return undefined;
        const onClick = (e) => {
            if (moreWrapRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [moreOpen]);
    const moreOptions = [];
    if (typeof onViewActivity === 'function') {
        moreOptions.push({
            id: 'history',
            label: 'History',
            icon: <Icon.HistoryIcon />,
            onClick: () => { setMoreOpen(false); onViewActivity(); },
        });
    }

    const fiatAvailable = fiat != null && isFinite(fiat);
    // Amount + unit code are kept separate so the unit can render as a
    // smaller styled span next to the digits (matches the Home total-
    // balance hero treatment). For BTC the code is the tick ticker;
    // for fiat the code is the wallet's preferred currency.
    const assetAmount = formatAmount(quantity, divisibility);
    const fiatAmount = fiatAvailable ? formatFiatNumber(fiat, fiatCurrency) : '—';
    const showFiatPrimary = primaryUnit === 'fiat' && fiatAvailable;
    const primaryAmount = showFiatPrimary ? fiatAmount : assetAmount;
    const primaryCode = showFiatPrimary ? fiatCurrency : tick;
    const secondaryAmount = showFiatPrimary ? assetAmount : fiatAmount;
    const secondaryCode = showFiatPrimary ? tick : (fiatAvailable ? fiatCurrency : '');

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.bodyFull : styles.bodyPopup}>
                {/* Token balance hero — gradient block, same style as
                    Home's TotalBalanceHero. Top row carries the label,
                    a swap button for flipping tick ↔ fiat as primary,
                    and the hide-balance eye. Big number = primary,
                    small number underneath = secondary. */}
                <section className={styles.balanceHero} aria-label={`${displayName || tick} balance`}>
                    {headerIconUrl ? (
                        <div className={styles.balanceHeroIconWrap}>
                            <img
                                src={headerIconUrl}
                                alt=""
                                aria-hidden="true"
                                className={styles.balanceHeroIcon}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                            {!isNative && chainId ? (
                                <img
                                    src={branding.chainIconSmallUrl(chainId)}
                                    alt=""
                                    aria-hidden="true"
                                    title={descriptor?.displayName || chainId}
                                    className={styles.balanceHeroChainOverlay}
                                />
                            ) : null}
                        </div>
                    ) : null}
                    <div className={styles.balanceHeroMain}>
                        <div className={styles.balanceHeroRow}>
                            <span className={styles.balanceHeroLabel}>Total balance</span>
                            <div className={styles.balanceHeroControls}>
                                <button
                                    type="button"
                                    className={styles.balanceHeroSwap}
                                    onClick={() => setPrimaryUnit((p) => (p === 'tick' ? 'fiat' : 'tick'))}
                                    disabled={!fiatAvailable}
                                    aria-label="Swap primary unit"
                                    title="Swap primary unit"
                                >
                                    <Icon.SwapIcon />
                                </button>
                                <button
                                    type="button"
                                    className={styles.balanceHeroEye}
                                    onClick={toggleChartVisible}
                                    aria-pressed={chartVisible ? 'true' : 'false'}
                                    aria-label={chartVisible ? 'Hide chart' : 'Show chart'}
                                    title={chartVisible ? 'Hide chart' : 'Show chart'}
                                >
                                    <Icon.LineChartIcon />
                                </button>
                                <button
                                    type="button"
                                    className={styles.balanceHeroEye}
                                    onClick={toggleBalanceHidden}
                                    aria-label={balanceHidden ? 'Show balance' : 'Hide balance'}
                                    title={balanceHidden ? 'Show balance' : 'Hide balance'}
                                >
                                    {balanceHidden ? <Icon.EyeOffIcon /> : <Icon.EyeIcon />}
                                </button>
                            </div>
                        </div>
                        <div className={styles.balanceHeroAmount}>
                            {balanceHidden ? (
                                <span className={styles.balanceHeroHidden}>•••••</span>
                            ) : (
                                <AutoShrinkText>
                                    {primaryAmount}
                                    <span className={styles.balanceHeroAmountCode}>{primaryCode}</span>
                                </AutoShrinkText>
                            )}
                        </div>
                        {!balanceHidden && fiatAvailable ? (
                            <div className={styles.balanceHeroNote}>
                                <span className={styles.balanceHeroNoteLeft}>
                                    <AutoShrinkText>
                                        {`≈ ${secondaryAmount}`}
                                        <span className={styles.balanceHeroNoteCode}>{secondaryCode}</span>
                                    </AutoShrinkText>
                                </span>
                            </div>
                        ) : null}
                    </div>
                </section>

                {/* "Official token" banner — the token is on a project
                    registry's current roster (owner-attested on-chain;
                    Project_Registry.md). Display policy is "just show
                    it" — every attesting project is listed. */}
                {Array.isArray(assetInfo?.projects) && assetInfo.projects.length > 0 ? (
                    <p className={styles.officialBanner} role="status">
                        This token is an official token in the{' '}
                        {assetInfo.projects.map((p, i) => (
                            <span key={p} className={styles.officialBannerProject}>
                                {i > 0 ? ', ' : ''}{p}
                            </span>
                        ))}
                        {' '}project{assetInfo.projects.length === 1 ? '' : 's'}.
                    </p>
                ) : null}

                {/* Market section — stats strip + sparkline. Sits above
                    the quick actions and is collapsible via the chart-icon
                    button in the balance hero (same hook the Home portfolio
                    chart uses, so the toggle persists across both surfaces). */}
                {chartVisible ? (
                    <div className={`${styles.infoCard} ${styles.marketCardOffset}`}>
                        <MarketPanel
                            isNative={isNative}
                            nativePrice={nativePrice}
                            showNativeStats={showNativeStats}
                            showSparkline={showSparkline}
                            assetInfo={assetInfo}
                            tick={tick}
                            chainId={chainId}
                            hasMarketData={hasMarketData}
                            fiatRate={fiatRate}
                            fiatCurrency={fiatCurrency}
                        />
                    </div>
                ) : null}

                {/* Quick actions — Send / Receive / Swap / Buy, matching
                    Home's 4-up grid. */}
                <div className={styles.quickActions} role="group" aria-label="Quick actions">
                    <button type="button" className={styles.quickAction} onClick={onSend} disabled={!onSend}>
                        <span className={styles.quickActionIcon} aria-hidden="true"><Icon.SendIcon /></span>
                        <span>Send</span>
                    </button>
                    <button type="button" className={styles.quickAction} onClick={onReceive} disabled={!onReceive}>
                        <span className={styles.quickActionIcon} aria-hidden="true"><Icon.ReceiveIcon /></span>
                        <span>Receive</span>
                    </button>
                    <button type="button" className={styles.quickAction} onClick={onBuy} disabled={!onBuy}>
                        <span className={styles.quickActionIcon} aria-hidden="true"><Icon.MarketIcon /></span>
                        <span>Markets</span>
                    </button>
                    <div className={styles.quickActionMoreWrap} ref={moreWrapRef}>
                        <button
                            type="button"
                            className={styles.quickAction}
                            onClick={() => setMoreOpen((o) => !o)}
                            aria-haspopup="menu"
                            aria-expanded={moreOpen}
                            disabled={moreOptions.length === 0}
                        >
                            <span className={styles.quickActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                            <span>More</span>
                        </button>
                        {moreOpen && moreOptions.length > 0 ? (
                            <div className={styles.quickActionMoreMenu} role="menu">
                                {moreOptions.map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        role="menuitem"
                                        className={styles.quickActionMoreItem}
                                        onClick={opt.onClick}
                                    >
                                        {opt.icon ? (
                                            <span className={styles.quickActionMoreItemIcon} aria-hidden="true">
                                                {opt.icon}
                                            </span>
                                        ) : null}
                                        <span>{opt.label}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* Tabs — matches HomeTabs visual rhythm. Native coins
                    get a single Details tab; tokens add About / Media /
                    Unlock so the per-asset content surfaces in tab form
                    rather than stacking. */}
                <div className={styles.tabs} role="tablist" aria-label="Token detail view">
                            {tabs.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={activeTab === t.id ? 'true' : 'false'}
                                    className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
                                    onClick={() => setActiveTab(t.id)}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>

                        <div className={styles.tabPanel} role="tabpanel">
                            {activeTab === 'details' ? (
                                <div className={styles.infoCard}>
                                    <DetailsPanel
                                        tick={tick}
                                        displayName={displayName}
                                        descriptor={descriptor}
                                        chainId={chainId}
                                        kind={kind}
                                        isNative={isNative}
                                        assetInfo={assetInfo}
                                        quantity={quantity}
                                        divisibility={divisibility}
                                        fiat={fiat}
                                        fiatCurrency={fiatCurrency}
                                    />
                                </div>
                            ) : null}

                            {activeTab === 'about' ? (
                                <InfoPanel
                                    isNative={isNative}
                                    assetInfo={assetInfo}
                                    hasDescription={hasDescription}
                                />
                            ) : null}

                            {activeTab === 'media' ? (
                                <MediaPanel
                                    isNative={isNative}
                                    assetInfo={assetInfo}
                                />
                            ) : null}

                            {activeTab === 'holders' && !isNative ? (
                                <>
                                    <GatedContentPanel
                                        walletId={walletId}
                                        chainId={chainId}
                                        tick={tick}
                                        groups={gatedGroups}
                                        loading={gatedLoading}
                                        error={gatedError}
                                        packsMeta={assetInfo?.packs || {}}
                                        messaging={messaging}
                                        ownsToken={(() => {
                                            try { return BigInt(String(quantity || '0')) > 0n; }
                                            catch { return false; }
                                        })()}
                                        displayName={displayName || tick}
                                    />
                                    <HoldersPanel
                                        holders={holders}
                                        holdersLoading={holdersLoading}
                                        holdersError={holdersError}
                                        holdersFetchedAt={holdersFetchedAt}
                                        divisibility={divisibility}
                                    />
                                </>
                            ) : null}
                        </div>

            </div>
        </Screen>
    );
}

function MarketPanel({ isNative, nativePrice, showSparkline, assetInfo, tick, chainId, fiatRate, fiatCurrency }) {
    // Always render the KPI strip with the same shape — placeholders
    // ("—") fill in for missing data so the structure stays consistent
    // whether the price oracle is disabled, still loading, or simply
    // doesn't have data for this tick (e.g. testnet, regtest).

    // Range picker — mirrors the PortfolioChart buttons on Home. Native
    // coins have a 7d CoinGecko sparkline (168 hourly points), so 24h /
    // 7d are slices of the real series; 30d / 90d / All synthesize the
    // same way single tokens do (the line still ends at current price).
    const [rangeId, setRangeId] = useState('30d');
    const range = CHART_RANGES.find((r) => r.id === rangeId) || CHART_RANGES[2];

    let priceCell = '—';
    let marketCapCell = '—';
    let floorCell = '—';
    let pctTone24h;
    let pct24h = '—';
    let sparkline = null;
    let hint = null;

    if (isNative) {
        if (nativePrice.disabled) {
            hint = 'Price data is disabled. Enable “Native coin price data” in Settings → Privacy to populate this section.';
        } else if (nativePrice.loading && !nativePrice.entry) {
            hint = 'Loading market data…';
        } else if (nativePrice.entry) {
            const e = nativePrice.entry;
            if (e.priceFiat != null) priceCell = formatFiat(e.priceFiat);
            if (e.marketCapFiat != null) marketCapCell = formatCompactFiat(e.marketCapFiat);
            if (e.change24hPct != null) {
                pct24h = formatPct(e.change24hPct);
                pctTone24h = pctTone(e.change24hPct);
            }
            if (showSparkline && range.realCapable && Array.isArray(e.sparkline) && e.sparkline.length >= 2) {
                // Real CoinGecko sparkline = 168 hourly points (7d).
                // 24h uses the tail; 7d uses the full series; longer
                // ranges fall through to synthesis below.
                const src = range.id === '24h'
                    ? e.sparkline.slice(-Math.min(range.points, e.sparkline.length))
                    : e.sparkline;
                sparkline = resampleSeriesTo(src, range.points);
            } else if (e.priceFiat != null) {
                // No real series available for this range (or sparkline
                // fetch failed) — synthesize a walk seeded by chain +
                // change so the chart always renders something. The line
                // still ends at the actual current price.
                const synth = synthesizeTokenChart(
                    `${chainId}|native|${range.id}|${(e.change24hPct ?? 0).toFixed(2)}`,
                    e.priceFiat,
                    range.points,
                );
                sparkline = synth.sparkline;
            }
        } else {
            hint = 'No market data available for this network.';
        }
        return (
            <>
                <section className={styles.stats}>
                    <StatCell label="Price" value={priceCell} />
                    <StatCell label="Market cap" value={marketCapCell} />
                    <StatCell label="24h" value={pct24h} tone={pctTone24h} />
                </section>
                {sparkline ? (
                    <>
                        <div className={styles.chart} aria-label={`${range.label} price chart`}>
                            <Sparkline series={sparkline} height={40} />
                        </div>
                        <div className={portfolioChartStyles.ranges} role="tablist" aria-label="Chart range">
                            {CHART_RANGES.map((r) => (
                                <button
                                    key={r.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={r.id === rangeId ? 'true' : 'false'}
                                    className={`${portfolioChartStyles.range} ${r.id === rangeId ? portfolioChartStyles.rangeActive : ''}`}
                                    onClick={() => setRangeId(r.id)}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>
                    </>
                ) : null}
                {hint ? <p className={styles.muted}>{hint}</p> : null}
            </>
        );
    }

    // Token path — try assetInfo.marketPrice first (XCP-denominated
    // price from the indexer); if unavailable, fall back to fiatRate
    // passed in from the balance fixture so the demo wallet still
    // gets a populated chart + 24h cell. Both paths feed into the
    // same synthesized sparkline keyed on tick+chain.
    void floorCell;
    const nativeTick = nativeTickerOf(chainId);
    const marketPriceNum = assetInfo?.marketPrice != null ? Number(assetInfo.marketPrice) : null;
    if (marketPriceNum != null && Number.isFinite(marketPriceNum)) {
        priceCell = `${assetInfo.marketPrice} ${nativeTick}`;
        if (assetInfo.totalSupply != null) {
            const supply = Number(String(assetInfo.totalSupply).replace(/[,_]/g, ''));
            if (Number.isFinite(supply)) {
                marketCapCell = `${(marketPriceNum * supply).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${nativeTick}`;
            }
        }
        const synth = synthesizeTokenChart(`${chainId}|${tick}|native|${range.id}`, marketPriceNum, range.points);
        if (synth.change24hPct != null) {
            pct24h = formatPct(synth.change24hPct);
            pctTone24h = pctTone(synth.change24hPct);
        }
        sparkline = synth.sparkline;
    } else if (typeof fiatRate === 'number' && isFinite(fiatRate) && fiatRate > 0) {
        priceCell = formatFiat(fiatRate);
        void fiatCurrency;
        const synth = synthesizeTokenChart(`${chainId}|${tick}|fiat|${range.id}`, fiatRate, range.points);
        if (synth.change24hPct != null) {
            pct24h = formatPct(synth.change24hPct);
            pctTone24h = pctTone(synth.change24hPct);
        }
        sparkline = synth.sparkline;
    } else if (!assetInfo) {
        hint = 'Loading market data…';
    }

    return (
        <>
            <section className={styles.stats}>
                <StatCell label="Price" value={priceCell} />
                <StatCell label="Market cap" value={marketCapCell} />
                <StatCell label="24h" value={pct24h} tone={pctTone24h} />
            </section>
            {sparkline ? (
                <div className={styles.chart} aria-label="7-day price chart">
                    <Sparkline series={sparkline} height={40} />
                </div>
            ) : null}
            {hint ? <p className={styles.muted}>{hint}</p> : null}
        </>
    );
}

function DetailsPanel({
    tick,
    displayName,
    descriptor,
    chainId,
    kind,
    isNative,
    assetInfo,
    quantity,
    divisibility,
    fiat,
    fiatCurrency,
}) {
    const [balanceHidden] = useBalancesHidden();
    return (
        <div className={styles.infoStack}>
            <table className={styles.metaTable}>
                <tbody>
                    <tr className={styles.metaRow}>
                        <th scope="row">Name</th>
                        <td>{displayName || tick}</td>
                    </tr>
                    <tr className={styles.metaRow}>
                        <th scope="row">Ticker</th>
                        <td>{tick}</td>
                    </tr>
                    <tr className={styles.metaRow}>
                        <th scope="row">Type</th>
                        <td>{kindLabel(kind)}</td>
                    </tr>
                    <tr className={styles.metaRow}>
                        <th scope="row">Chain</th>
                        <td>{descriptor?.displayName || chainId}</td>
                    </tr>
                    {!isNative ? (
                        <tr className={styles.metaRow}>
                            <th scope="row">Divisibility</th>
                            <td>{divisibility}</td>
                        </tr>
                    ) : null}
                    <tr className={styles.metaRow}>
                        <th scope="row">Total supply</th>
                        <td>{formatTotalSupply(isNative, chainId, assetInfo)}</td>
                    </tr>
                    <tr className={styles.metaRow}>
                        <th scope="row">Current balance</th>
                        <td>{balanceHidden ? '•••••' : `${formatAmount(quantity, divisibility)} ${tick}`}</td>
                    </tr>
                    <tr className={styles.metaRow}>
                        <th scope="row">Estimated value</th>
                        <td>
                            {balanceHidden
                                ? '•••••'
                                : fiat == null
                                    ? '—'
                                    : `${formatFiatNumber(fiat, fiatCurrency)} ${(fiatCurrency || 'USD').toUpperCase()}`}
                        </td>
                    </tr>
                    {!isNative && assetInfo?.creator ? (
                        <tr className={styles.metaRow}>
                            <th scope="row">Creator</th>
                            <td className={styles.creatorCell} title={assetInfo.creator}>
                                {shorten(assetInfo.creator)}
                            </td>
                        </tr>
                    ) : null}
                    {!isNative && assetInfo ? (
                        <tr className={styles.metaRow}>
                            <th scope="row">Status</th>
                            <td>
                                {assetInfo.locked ? (
                                    <span className={styles.lockedFlag}>Locked</span>
                                ) : (
                                    <span className={styles.unlockedFlag}>Mutable</span>
                                )}
                            </td>
                        </tr>
                    ) : null}
                </tbody>
            </table>
        </div>
    );
}

// Info tab — TIS-sourced content for non-native tokens. Mirrors the
// per-section layout the explorer uses (artwork title, media gallery,
// description, owner identity, contact rows, categories, links, files,
// PGP signature) so a token's published metadata renders in one place.
// When the token has no TIS document the panel renders an empty-state
// hint so the tab still has something to land on.
function InfoPanel({ isNative, assetInfo, hasDescription }) {
    if (isNative) {
        return (
            <div className={styles.infoCard}>
                <p className={styles.metadataHint}>
                    Native coin. Token-information documents are an XChain-issued-token concept.
                </p>
            </div>
        );
    }
    if (!assetInfo) {
        return (
            <div className={styles.infoCard}>
                <p className={styles.metadataHint}>Loading token information…</p>
            </div>
        );
    }
    const hasLinks = Boolean(assetInfo.website)
        || (Array.isArray(assetInfo.socials) && assetInfo.socials.length > 0)
        || (Array.isArray(assetInfo.files) && assetInfo.files.length > 0);
    const hasOwner = Boolean(assetInfo.owner
        && (assetInfo.owner.name || assetInfo.owner.title || assetInfo.owner.organization));
    const hasContacts = Array.isArray(assetInfo.contacts) && assetInfo.contacts.length > 0;
    const hasCategories = Array.isArray(assetInfo.categories) && assetInfo.categories.length > 0;
    const hasPgpsig = Boolean(assetInfo.pgpsig);
    const hasDns = Array.isArray(assetInfo.dns) && assetInfo.dns.length > 0;
    const hasAbout = hasDescription
        || hasOwner
        || hasContacts
        || hasCategories
        || hasLinks
        || hasDns
        || hasPgpsig;
    if (!hasAbout) {
        return (
            <div className={styles.infoCard}>
                <p className={styles.metadataHint}>
                    No additional information published for this token yet.
                </p>
            </div>
        );
    }
    return (
        <div className={`${styles.infoCard} ${styles.aboutCard}`}>
            {hasDescription ? (
                <div className={styles.metaBlock}>
                    <h4 className={styles.metaBlockTitle}>About</h4>
                    <p className={styles.descriptionBody}>{assetInfo.description}</p>
                </div>
            ) : null}
            {hasOwner ? <OwnerBlock owner={assetInfo.owner} /> : null}
            {hasCategories ? <CategoriesBlock categories={assetInfo.categories} /> : null}
            {hasContacts ? <ContactsBlock contacts={assetInfo.contacts} /> : null}
            {hasLinks ? (
                <div className={styles.metaBlock}>
                    <h4 className={styles.metaBlockTitle}>Links</h4>
                    <LinksAndFiles assetInfo={assetInfo} />
                </div>
            ) : null}
            {hasDns ? <DnsBlock dns={assetInfo.dns} /> : null}
            {hasPgpsig ? <PgpsigBlock pgpsig={assetInfo.pgpsig} /> : null}
        </div>
    );
}

function DnsBlock({ dns }) {
    return (
        <div className={styles.metaBlock}>
            <h4 className={styles.metaBlockTitle}>DNS</h4>
            <table className={styles.metaTable}>
                <tbody>
                    {dns.map((r, i) => (
                        <tr key={`${r.type}:${r.host}:${i}`} className={styles.metaRow}>
                            <th scope="row">
                                {r.type}
                                {r.priority != null ? ` · ${r.priority}` : ''}
                            </th>
                            <td className={styles.dnsValueCell}>
                                <div className={styles.dnsHost}>{r.host}</div>
                                <div className={styles.dnsValue}>{r.value}</div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// Media tab — images, audio, video published with the token's TIS
// document. Pure visual surface; everything textual lives in the
// About tab so a user can browse the artwork without being asked to
// also read prose.
function MediaPanel({ isNative, assetInfo }) {
    // Only large + hires images count toward the Image surface (icon
    // and standard buckets render in the page header instead). We
    // derive the buckets unconditionally so the React hook below can
    // observe them, then decide what to render below based on
    // isNative / assetInfo state.
    const images = Array.isArray(assetInfo?.images)
        ? assetInfo.images.filter((i) => {
            const t = String(i?.type || '').toLowerCase();
            return t === 'large' || t === 'hires' || t === 'hi-res' || t === 'highres';
        })
        : [];
    const audio = Array.isArray(assetInfo?.audio) ? assetInfo.audio : [];
    const video = Array.isArray(assetInfo?.video) ? assetInfo.video : [];
    const files = Array.isArray(assetInfo?.files) ? assetInfo.files : [];
    const subtabs = [
        images.length > 0 ? { id: 'image', label: images.length === 1 ? 'Image' : 'Images' } : null,
        audio.length > 0 ? { id: 'audio', label: 'Audio' } : null,
        video.length > 0 ? { id: 'video', label: video.length === 1 ? 'Video' : 'Videos' } : null,
        files.length > 0 ? { id: 'files', label: files.length === 1 ? 'File' : 'Files' } : null,
    ].filter(Boolean);
    const [activeSubtab, setActiveSubtab] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        // Sync the default subtab to the first populated bucket whenever
        // the available subtab set changes (e.g. token info finishes
        // loading after the panel mounted).
        if (subtabs.length === 0) {
            if (activeSubtab !== null) setActiveSubtab(null);
            return;
        }
        if (!activeSubtab || !subtabs.some((t) => t.id === activeSubtab)) {
            setActiveSubtab(subtabs[0].id);
        }
    }, [subtabs, activeSubtab]);

    if (isNative) {
        return (
            <div className={styles.infoCard}>
                <p className={styles.metadataHint}>
                    Native coins don't carry attached media.
                </p>
            </div>
        );
    }
    if (!assetInfo) {
        return (
            <div className={styles.infoCard}>
                <p className={styles.metadataHint}>Loading media…</p>
            </div>
        );
    }
    if (subtabs.length === 0) {
        return (
            <div className={styles.infoCard}>
                <p className={styles.metadataHint}>
                    No images, audio, video, or files published for this token yet.
                </p>
            </div>
        );
    }
    // Single media type — no need for a subtab strip; render directly.
    if (subtabs.length === 1) {
        return <MediaSubpanel kind={subtabs[0].id} images={images} audio={audio} video={video} files={files} />;
    }
    return (
        <div className={styles.mediaPanel}>
            <div className={styles.subtabs} role="tablist" aria-label="Token media">
                {subtabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={activeSubtab === t.id ? 'true' : 'false'}
                        className={`${styles.subtab} ${activeSubtab === t.id ? styles.subtabActive : ''}`}
                        onClick={() => setActiveSubtab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div role="tabpanel">
                <MediaSubpanel kind={activeSubtab} images={images} audio={audio} video={video} files={files} />
            </div>
        </div>
    );
}

function MediaSubpanel({ kind, images, audio, video, files }) {
    if (kind === 'image') {
        // Dedup by URL so `large` and `hires` pointing at the same file
        // don't render twice.
        const seen = new Set();
        const dedup = images.filter((img) => {
            if (!img?.url || seen.has(img.url)) return false;
            seen.add(img.url);
            return true;
        });
        return (
            <div className={styles.gallery}>
                {dedup.map((img, i) => (
                    <ImageHero key={`img:${img.url}:${i}`} img={img} />
                ))}
            </div>
        );
    }
    if (kind === 'video') {
        return (
            <div className={styles.gallery}>
                {video.map((v, i) => (
                    <div key={`${v.url}:${i}`} className={styles.galleryMediaCard}>
                        {v.name ? (
                            <div className={styles.galleryMediaCaption}>{v.name}</div>
                        ) : null}
                        <video
                            className={styles.galleryVideo}
                            src={v.url}
                            controls
                            preload="metadata"
                            playsInline
                        />
                    </div>
                ))}
            </div>
        );
    }
    if (kind === 'audio') {
        return (
            <div className={styles.gallery}>
                {audio.map((a, i) => (
                    <div key={`${a.url}:${i}`} className={styles.galleryMediaCard}>
                        {a.name ? (
                            <div className={styles.galleryMediaCaption}>{a.name}</div>
                        ) : null}
                        <audio
                            className={styles.galleryAudio}
                            src={a.url}
                            controls
                            preload="metadata"
                        />
                    </div>
                ))}
            </div>
        );
    }
    if (kind === 'files') {
        return (
            <ul className={styles.filesList}>
                {files.map((f, i) => (
                    <li key={`${f.url}:${i}`}>
                        <a
                            href={f.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className={styles.fileLink}
                        >
                            <span className={styles.fileLinkIcon} aria-hidden="true">
                                <Icon.FileTypeIcon type={f.type} />
                            </span>
                            <span className={styles.fileLinkName}>
                                {f.name || f.url}
                            </span>
                            {f.type ? (
                                <span className={styles.fileLinkType}>{f.type}</span>
                            ) : null}
                        </a>
                    </li>
                ))}
            </ul>
        );
    }
    return null;
}

function OwnerBlock({ owner }) {
    return (
        <div className={styles.metaBlock}>
            <h4 className={styles.metaBlockTitle}>Owner</h4>
            <table className={styles.metaTable}>
                <tbody>
                    {owner.name ? (
                        <tr className={styles.metaRow}>
                            <th scope="row">Name</th>
                            <td>{owner.name}</td>
                        </tr>
                    ) : null}
                    {owner.title ? (
                        <tr className={styles.metaRow}>
                            <th scope="row">Title</th>
                            <td>{owner.title}</td>
                        </tr>
                    ) : null}
                    {owner.organization ? (
                        <tr className={styles.metaRow}>
                            <th scope="row">Organization</th>
                            <td>{owner.organization}</td>
                        </tr>
                    ) : null}
                </tbody>
            </table>
        </div>
    );
}

const CONTACT_LABELS = {
    email: 'Email',
    phone: 'Phone',
    fax: 'Fax',
    url: 'Web',
    address: 'Address',
};

function ContactsBlock({ contacts }) {
    return (
        <div className={styles.metaBlock}>
            <h4 className={styles.metaBlockTitle}>Contact</h4>
            <table className={styles.metaTable}>
                <tbody>
                    {contacts.map((c, i) => {
                        const label = CONTACT_LABELS[c.type] || (c.type.charAt(0).toUpperCase() + c.type.slice(1));
                        const isMail = c.type === 'email';
                        const isPhone = c.type === 'phone';
                        const isUrl = c.type === 'url' || /^https?:\/\//i.test(c.value);
                        let display = c.value;
                        if (isMail) {
                            display = <a href={`mailto:${c.value}`}>{c.value}</a>;
                        } else if (isPhone) {
                            display = <a href={`tel:${c.value.replace(/[^+\d]/g, '')}`}>{c.value}</a>;
                        } else if (isUrl) {
                            display = (
                                <a href={c.value} target="_blank" rel="noreferrer noopener">{c.value}</a>
                            );
                        }
                        return (
                            <tr key={`${c.type}:${i}`} className={styles.metaRow}>
                                <th scope="row">{label}</th>
                                <td>{display}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

const CATEGORY_LABELS = { main: 'Category', sub: 'Subcategory', other: 'Other' };

function CategoriesBlock({ categories }) {
    return (
        <div className={styles.metaBlock}>
            <h4 className={styles.metaBlockTitle}>Categories</h4>
            <table className={styles.metaTable}>
                <tbody>
                    {categories.map((c, i) => (
                        <tr key={`${c.type}:${i}`} className={styles.metaRow}>
                            <th scope="row">{CATEGORY_LABELS[c.type] || c.type}</th>
                            <td>{c.value}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function PgpsigBlock({ pgpsig }) {
    return (
        <div className={styles.metaBlock}>
            <h4 className={styles.metaBlockTitle}>PGP signature</h4>
            <pre className={styles.pgpsigBlock}>{pgpsig}</pre>
        </div>
    );
}

function ImageHero({ img }) {
    const anchor = (
        <a
            href={img.url}
            target="_blank"
            rel="noreferrer noopener"
            className={styles.heroImageLink}
            title={img.name || ''}
        >
            <img
                src={img.url}
                alt={img.name || ''}
                className={styles.heroImage}
                onError={(e) => {
                    const card = e.currentTarget.closest(`.${styles.galleryMediaCard}`);
                    const a = e.currentTarget.closest('a');
                    if (card) card.style.display = 'none';
                    else if (a) a.style.display = 'none';
                }}
            />
        </a>
    );
    if (img.name) {
        return (
            <div className={styles.galleryMediaCard}>
                <div className={styles.galleryMediaCaption}>{img.name}</div>
                {anchor}
            </div>
        );
    }
    return anchor;
}


const SOCIAL_LABELS = {
    twitter: 'Twitter',
    x: 'X',
    github: 'GitHub',
    reddit: 'Reddit',
    facebook: 'Facebook',
    linkedin: 'LinkedIn',
    discord: 'Discord',
    telegram: 'Telegram',
    medium: 'Medium',
    youtube: 'YouTube',
    instagram: 'Instagram',
    url: 'Link',
};

function socialLabel(platform) {
    const key = String(platform || '').toLowerCase();
    return SOCIAL_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Link');
}

// Inline brand glyphs for the social chips. 16×16 viewBox, filled with
// `currentColor` so they pick up the chip's text color. Falls back to
// the generic LinkIcon when the platform key isn't recognized.
const SOCIAL_ICON_PATHS = {
    twitter: 'M14.2 3h2.6l-5.7 6.5L18 17h-5.4l-4.2-5.5L3.6 17H1l6.1-7L1 3h5.5l3.8 5L14.2 3zm-1 12.2h1.5L5.9 4.6H4.3l8.9 10.6z',
    x: 'M14.2 3h2.6l-5.7 6.5L18 17h-5.4l-4.2-5.5L3.6 17H1l6.1-7L1 3h5.5l3.8 5L14.2 3zm-1 12.2h1.5L5.9 4.6H4.3l8.9 10.6z',
    github: 'M10 1.5a8.5 8.5 0 0 0-2.7 16.6c.4.1.6-.2.6-.4v-1.5c-2.4.5-2.9-1-2.9-1-.4-1-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.9-.2-3.9-1-3.9-4.2 0-.9.3-1.7.9-2.3-.1-.2-.4-1.1.1-2.3 0 0 .7-.2 2.4.9a8.3 8.3 0 0 1 4.4 0c1.7-1.1 2.4-.9 2.4-.9.5 1.2.2 2.1.1 2.3.6.6.9 1.4.9 2.3 0 3.3-2 4-3.9 4.2.3.3.6.8.6 1.6V18c0 .2.1.5.6.4A8.5 8.5 0 0 0 10 1.5z',
    reddit: 'M19 10c0-1.1-.9-2-2-2-.6 0-1 .2-1.4.6-1.3-1-3.2-1.6-5.2-1.6l1-3.4 2.7.6c0 .8.6 1.4 1.4 1.4s1.4-.6 1.4-1.4S16.3 3 15.5 3c-.5 0-1 .3-1.2.7L11.2 3 10 7C8 7 6.1 7.6 4.8 8.6 4.4 8.2 4 8 3.5 8c-1.1 0-2 .9-2 2 0 .8.5 1.5 1.2 1.8 0 .1-.1.3-.1.4 0 2.5 2.8 4.5 6.3 4.5s6.3-2 6.3-4.5c0-.1 0-.3-.1-.4.7-.3 1.2-1 1.2-1.8zM5 11c0-.7.5-1.2 1.2-1.2s1.2.5 1.2 1.2-.5 1.2-1.2 1.2S5 11.7 5 11zm6.7 3.5c-.4.4-1.1.6-1.8.6s-1.4-.2-1.8-.6c-.2-.2-.2-.5 0-.7s.5-.2.7 0c.3.3.7.4 1.2.4s.9-.1 1.2-.4c.2-.2.5-.2.7 0s.2.5-.2.7zm.2-2.3c-.7 0-1.2-.5-1.2-1.2s.5-1.2 1.2-1.2 1.2.5 1.2 1.2-.5 1.2-1.2 1.2z',
    facebook: 'M16 1.5H4c-1.4 0-2.5 1.1-2.5 2.5v12c0 1.4 1.1 2.5 2.5 2.5h6.4v-6.4H8.3V9.7h2.1V8c0-2.1 1.3-3.2 3.1-3.2.9 0 1.7.1 1.9.1v2.2H14c-1 0-1.2.5-1.2 1.2v1.5h2.4l-.3 2.4h-2.1V18.5H16c1.4 0 2.5-1.1 2.5-2.5V4c0-1.4-1.1-2.5-2.5-2.5z',
    linkedin: 'M16 1.5H4A2.5 2.5 0 0 0 1.5 4v12A2.5 2.5 0 0 0 4 18.5h12a2.5 2.5 0 0 0 2.5-2.5V4A2.5 2.5 0 0 0 16 1.5zM7 15H5V8h2v7zM6 6.6a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2zM15 15h-2v-3.6c0-.9-.4-1.4-1.1-1.4-.8 0-1.2.5-1.2 1.4V15h-2V8h2v.8c.4-.5 1-.9 1.9-.9 1.5 0 2.4 1 2.4 2.7V15z',
    discord: 'M16.3 4.7a13.3 13.3 0 0 0-3.3-1c-.1.2-.3.6-.4.8a12.2 12.2 0 0 0-3.2 0c-.1-.2-.3-.6-.4-.8a13.5 13.5 0 0 0-3.3 1A14 14 0 0 0 3.3 14a13.5 13.5 0 0 0 4 2c.3-.4.6-.9.9-1.3a8.8 8.8 0 0 1-1.4-.7l.3-.2a9.5 9.5 0 0 0 8.2 0l.3.2a8.8 8.8 0 0 1-1.4.7c.3.5.6.9.9 1.3a13.5 13.5 0 0 0 4-2 13.7 13.7 0 0 0-2.4-9.3zM7.4 12.4c-.8 0-1.5-.7-1.5-1.6s.6-1.6 1.5-1.6 1.5.7 1.5 1.6-.6 1.6-1.5 1.6zm5.2 0c-.8 0-1.5-.7-1.5-1.6s.6-1.6 1.5-1.6 1.5.7 1.5 1.6-.6 1.6-1.5 1.6z',
    telegram: 'M18.4 2.6 1.8 9.2c-1.1.4-1.1 1.1-.2 1.3l4.2 1.3 1.6 5c.2.5.4.7.8.7s.6-.1.9-.4l2.2-2.1 4.5 3.3c.8.5 1.4.2 1.6-.8L19.7 4c.3-1.2-.4-1.8-1.3-1.4zM6 10.8l9.8-6.2c.5-.3.9-.1.5.2L9 11.3l-.3 3.5L7.2 11l-1.2-.2z',
    youtube: 'M18.5 6.2a2.2 2.2 0 0 0-1.5-1.5C15.6 4.3 10 4.3 10 4.3s-5.6 0-7 .4A2.2 2.2 0 0 0 1.5 6.2 23 23 0 0 0 1.1 10a23 23 0 0 0 .4 3.8 2.2 2.2 0 0 0 1.5 1.5c1.4.4 7 .4 7 .4s5.6 0 7-.4a2.2 2.2 0 0 0 1.5-1.5A23 23 0 0 0 18.9 10a23 23 0 0 0-.4-3.8zM8.3 12.5V7.5L13 10l-4.7 2.5z',
    instagram: 'M10 3c2.3 0 2.6 0 3.5.1.8.1 1.3.2 1.6.3.4.1.7.3 1 .6.3.3.5.6.6 1 .1.3.2.8.3 1.6.1.9.1 1.2.1 3.5s0 2.6-.1 3.5c-.1.8-.2 1.3-.3 1.6-.1.4-.3.7-.6 1-.3.3-.6.5-1 .6-.3.1-.8.2-1.6.3-.9.1-1.2.1-3.5.1s-2.6 0-3.5-.1c-.8-.1-1.3-.2-1.6-.3-.4-.1-.7-.3-1-.6-.3-.3-.5-.6-.6-1-.1-.3-.2-.8-.3-1.6C3 12.6 3 12.3 3 10s0-2.6.1-3.5c.1-.8.2-1.3.3-1.6.1-.4.3-.7.6-1 .3-.3.6-.5 1-.6.3-.1.8-.2 1.6-.3C7.4 3 7.7 3 10 3zm0-1.5c-2.3 0-2.6 0-3.5.1-.9.1-1.6.2-2.1.4a4 4 0 0 0-1.5 1 4 4 0 0 0-1 1.5c-.2.5-.3 1.2-.4 2.1C1.5 7.4 1.5 7.7 1.5 10s0 2.6.1 3.5c.1.9.2 1.6.4 2.1a4 4 0 0 0 1 1.5 4 4 0 0 0 1.5 1c.5.2 1.2.3 2.1.4.9.1 1.2.1 3.5.1s2.6 0 3.5-.1c.9-.1 1.6-.2 2.1-.4a4 4 0 0 0 1.5-1 4 4 0 0 0 1-1.5c.2-.5.3-1.2.4-2.1.1-.9.1-1.2.1-3.5s0-2.6-.1-3.5c-.1-.9-.2-1.6-.4-2.1a4 4 0 0 0-1-1.5 4 4 0 0 0-1.5-1c-.5-.2-1.2-.3-2.1-.4-.9-.1-1.2-.1-3.5-.1zm0 4.1a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zm0 7.3a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8zm5.6-7.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
};

function SocialIcon({ platform }) {
    const key = String(platform || '').toLowerCase();
    const path = SOCIAL_ICON_PATHS[key];
    if (path) {
        return (
            <svg
                className={styles.socialChipIcon}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
            >
                <path d={path} />
            </svg>
        );
    }
    return (
        <span className={styles.socialChipIcon} aria-hidden="true">
            <Icon.LinkIcon />
        </span>
    );
}

/**
 * §27.6 — links + files block. Renders the token's website, primary
 * social links, and file attachments below the media gallery. Returns
 * null when the TIS document carries none of these so the section
 * disappears entirely for tokens without rich metadata.
 */
function LinksAndFiles({ assetInfo }) {
    // Prefer the `websites` array (primary + alternates) but fall back to
    // the singular `website` field for older bundles that haven't been
    // re-normalized. Files live in the Media tab's Files subtab now —
    // they're not rendered here.
    const websites = Array.isArray(assetInfo?.websites) && assetInfo.websites.length > 0
        ? assetInfo.websites
        : (assetInfo?.website ? [assetInfo.website] : []);
    const socials = Array.isArray(assetInfo?.socials) ? assetInfo.socials : [];
    const hasAnything = websites.length > 0 || socials.length > 0;
    if (!hasAnything) return null;
    const multipleWebsites = websites.length > 1;
    return (
        <div className={styles.linksBlock}>
            {websites.length > 0 ? (
                <div className={styles.socialsRow}>
                    {websites.map((w, i) => (
                        <a
                            key={`${w}:${i}`}
                            href={w}
                            target="_blank"
                            rel="noreferrer noopener"
                            className={styles.socialChip}
                            title={w}
                        >
                            <span className={styles.socialChipIcon} aria-hidden="true">
                                <Icon.ExternalLinkIcon />
                            </span>
                            <span>{multipleWebsites ? `Website ${i + 1}` : 'Website'}</span>
                        </a>
                    ))}
                </div>
            ) : null}
            {socials.length > 0 ? (
                <div className={styles.socialsRow}>
                    {socials.map((s, i) => (
                        <a
                            key={`${s.url}:${i}`}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className={styles.socialChip}
                            title={s.url}
                        >
                            <SocialIcon platform={s.platform} />
                            {socialLabel(s.platform)}
                        </a>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

// Native-coin total supplies are well-known constants — no oracle call
// needed. Tokens read from assetInfo (XCP indexer).
const NATIVE_SUPPLY_BY_COIN = {
    bitcoin: '21,000,000 BTC',
    litecoin: '84,000,000 LTC',
    dogecoin: 'No cap (inflationary)',
};

function formatTotalSupply(isNative, chainId, assetInfo) {
    if (isNative) {
        const coin = chainId.split('-')[0];
        return NATIVE_SUPPLY_BY_COIN[coin] || '—';
    }
    if (assetInfo?.totalSupply == null) return '—';
    return assetInfo.maxSupply
        ? `${assetInfo.totalSupply} / ${assetInfo.maxSupply}`
        : String(assetInfo.totalSupply);
}

// Token-gated content panel — renders the list of gated FILEs published
// for this token, grouped by KEY_HASH so packs (multi-file shares-one-key
// drops) appear as a single header with member files underneath. Each
// group has an Unlock button that pops an inline form (pick address,
// enter password) and decrypts every file in the group; viewers render
// inline for text / JSON / images and as a download link for everything
// else. See xchain-documentation/protocol/TOKEN_GATED_CONTENT.md.
function GatedContentPanel({ walletId, chainId, tick, groups, loading, error, packsMeta, messaging, ownsToken, displayName }) {
    const [addresses, setAddresses] = useState(/** @type {any[] | null} */ (null));
    const [addressesError, setAddressesError] = useState(/** @type {string | null} */ (null));
    const [addressesLoading, setAddressesLoading] = useState(false);

    // Load the user's addresses for this chain on demand — only fired
    // when the first Unlock button is clicked so panels for tokens with
    // no gated content (or that the user never tries to unlock) skip
    // the round-trip entirely.
    const ensureAddresses = useCallback(() => {
        if (addresses || addressesLoading) return;
        if (typeof messaging.getAddressesByChain !== 'function') {
            setAddressesError('Address lookup is not available in this build.');
            return;
        }
        setAddressesLoading(true);
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                const list = (byChain && byChain[chainId]) ? byChain[chainId] : [];
                const usable = list.filter((a) => a.source === 'hd' || a.source === 'imported-wif');
                setAddresses(usable);
                if (usable.length === 0) {
                    setAddressesError('No unlockable addresses for this chain. Holders need an HD or imported-WIF address that holds the token.');
                }
            })
            .catch((err) => setAddressesError(err?.message || 'Failed to load addresses.'))
            .finally(() => setAddressesLoading(false));
    }, [addresses, addressesLoading, messaging, walletId, chainId]);

    if (loading) return <p className={styles.muted}>Loading gated content…</p>;
    if (error) return <p role="alert" className={styles.error}>{error}</p>;
    if (!groups || groups.length === 0) {
        return (
            <div className={styles.infoCard}>
                <p className={styles.muted}>
                    No token-gated content published for {tick}. Holders unlock
                    creator drops, packs, and sealed bundles here when the issuer
                    publishes encrypted FILE actions gated by this ticker.
                </p>
            </div>
        );
    }
    return (
        <div className={styles.infoCard}>
            {groups.map((g) => {
                const isPack = g.files.length > 1;
                const tisMeta = packsMeta && g.files[0]?.packId ? packsMeta[g.files[0].packId] : null;
                // packMeta lives directly on the group when serving
                // demo fixtures (no TIS document in the loop). TIS
                // packsMeta takes precedence so production payloads
                // override demo defaults if they ever collide.
                const meta = tisMeta || g.packMeta || null;
                const heading = meta?.name || (isPack ? `Pack (${g.files.length} files)` : g.files[0]?.name) || 'Gated file';
                return (
                    <GatedGroupCard
                        key={g.keyHash}
                        group={g}
                        heading={heading}
                        description={meta?.description}
                        walletId={walletId}
                        messaging={messaging}
                        addresses={addresses}
                        addressesError={addressesError}
                        addressesLoading={addressesLoading}
                        onRequestAddresses={ensureAddresses}
                        ownsToken={ownsToken}
                        tokenLabel={displayName || tick}
                    />
                );
            })}
        </div>
    );
}

function GatedGroupCard({
    group,
    heading,
    description,
    walletId,
    messaging,
    addresses,
    addressesError,
    addressesLoading,
    onRequestAddresses,
    ownsToken,
    tokenLabel,
}) {
    const [password, setPassword] = useState('');
    const [unlockError, setUnlockError] = useState(/** @type {string | null} */ (null));
    const [accessError, setAccessError] = useState(/** @type {string | null} */ (null));
    const [submitting, setSubmitting] = useState(false);
    /** @type {[Map<string, { plaintextBase64: string, byteLength: number }>, Function]} */
    const [unlocked, setUnlocked] = useState(() => new Map());
    /** @type {[any | null, Function]} */
    const [pendingFile, setPendingFile] = useState(null);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const passwordOpen = pendingFile !== null;

    useEffect(() => {
        if (passwordOpen && !submitting) {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [passwordOpen, submitting]);

    function openFile(plain, file) {
        if (!plain) return;
        try {
            const bin = typeof atob === 'function'
                ? atob(plain.plaintextBase64)
                : Buffer.from(plain.plaintextBase64, 'base64').toString('binary');
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
            const mime = String(file.type || '').toLowerCase();
            const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const isInlineRenderable = mime.startsWith('image/')
                || mime.startsWith('text/')
                || mime === 'application/json'
                || mime.endsWith('+json')
                || mime === 'application/pdf';
            if (isInlineRenderable) {
                window.open(url, '_blank', 'noopener,noreferrer');
            } else {
                const a = document.createElement('a');
                a.href = url;
                a.download = file.name || 'unlocked-file';
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
            // Give the new tab / download time to grab the blob before
            // revoking. 60s is generous but cheap.
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (_e) {
            // Decoding failures are silent — the file row stays clickable
            // so the user can try again.
        }
    }

    async function handleFileClick(file) {
        setAccessError(null);
        if (!ownsToken) {
            setAccessError(
                `You need to hold at least 1 ${tokenLabel} to view this content. Pick one up on a marketplace, or import a wallet that already holds one.`,
            );
            return;
        }
        const plain = unlocked.get(String(file.actionIndex));
        if (plain) {
            openFile(plain, file);
            return;
        }
        // Demo content — the backend short-circuit (flows/gatedContent.js)
        // returns hardcoded plaintext for `demo:` action indices without
        // touching the vault, so we can unlock the whole group inline
        // without a password prompt or address picker.
        if (isDemoGatedActionIndex(file.actionIndex)) {
            if (submitting) return;
            setSubmitting(true);
            try {
                const results = new Map(unlocked);
                for (const f of group.files) {
                    if (results.has(String(f.actionIndex))) continue;
                    const resp = await messaging.unlockGatedContent({
                        walletId,
                        password: '',
                        addressId: '',
                        actionIndex: f.actionIndex,
                        keyHash: group.keyHash,
                    });
                    results.set(String(f.actionIndex), {
                        plaintextBase64: resp.plaintextBase64,
                        byteLength: resp.byteLength,
                    });
                }
                setUnlocked(results);
                const target = results.get(String(file.actionIndex));
                if (target) openFile(target, file);
            } catch (err) {
                setAccessError(err?.message || 'Failed to unlock demo content.');
            } finally {
                setSubmitting(false);
            }
            return;
        }
        // Real content — open password prompt. The holding address is
        // discovered automatically on submit (handleUnlock iterates the
        // user's addresses to find whichever one received the seller's
        // key handoff for this group's KEY_HASH).
        onRequestAddresses();
        setUnlockError(null);
        setPendingFile(file);
    }

    function closePasswordPrompt() {
        setPendingFile(null);
        setPassword('');
        setUnlockError(null);
    }

    async function handleUnlock(event) {
        event.preventDefault();
        if (submitting || password.length === 0) return;
        if (!Array.isArray(addresses) || addresses.length === 0) {
            setUnlockError('No usable holding address found for this chain.');
            return;
        }
        setSubmitting(true);
        setUnlockError(null);
        try {
            const results = new Map(unlocked);
            const firstFile = group.files.find((f) => !results.has(String(f.actionIndex)));
            // Probe addresses with the first un-decrypted file. The seller's
            // key handoff is per-address; the first address that decrypts it
            // is the one that holds the right CMS envelope, and the same
            // address works for every file in this group (shared KEY_HASH).
            let workingAddrId = null;
            let firstResp = null;
            let probeErr = null;
            if (firstFile) {
                for (const a of addresses) {
                    try {
                        firstResp = await messaging.unlockGatedContent({
                            walletId,
                            password,
                            addressId: a.id,
                            actionIndex: firstFile.actionIndex,
                            keyHash: group.keyHash,
                        });
                        workingAddrId = a.id;
                        break;
                    } catch (err) {
                        // Only "this address doesn't have the handoff" is a
                        // try-next-address signal; password / vault errors
                        // bubble up so we don't quietly retry under bad creds.
                        if (err?.code === 'GATED_FILE_KEY_MISSING') {
                            probeErr = err;
                            continue;
                        }
                        throw err;
                    }
                }
                if (!workingAddrId || !firstResp) {
                    throw probeErr || Object.assign(
                        new Error('No key handoff found on any holding address.'),
                        { code: 'GATED_FILE_KEY_MISSING' },
                    );
                }
                results.set(String(firstFile.actionIndex), {
                    plaintextBase64: firstResp.plaintextBase64,
                    byteLength: firstResp.byteLength,
                });
                for (const file of group.files) {
                    if (results.has(String(file.actionIndex))) continue;
                    const resp = await messaging.unlockGatedContent({
                        walletId,
                        password,
                        addressId: workingAddrId,
                        actionIndex: file.actionIndex,
                        keyHash: group.keyHash,
                    });
                    results.set(String(file.actionIndex), {
                        plaintextBase64: resp.plaintextBase64,
                        byteLength: resp.byteLength,
                    });
                }
            }
            setUnlocked(results);
            setPassword('');
            // Auto-open the file that triggered the prompt.
            if (pendingFile) {
                const target = results.get(String(pendingFile.actionIndex));
                if (target) openFile(target, pendingFile);
            }
            setPendingFile(null);
        } catch (err) {
            const name = err?.name;
            const code = err?.code;
            if (name === 'WrongPasswordError' || name === 'InvalidPasswordError') {
                setUnlockError('Incorrect password.');
            } else if (name === 'NoKeyForAddressError') {
                setUnlockError('No decryption key found in the wallet for any holding address.');
            } else if (code === 'GATED_FILE_KEY_MISSING') {
                setUnlockError('No key handoff found on any of your addresses. Ask the seller to re-send.');
            } else if (code === 'GATED_FILE_NOT_FOUND') {
                setUnlockError('Ciphertext not available from the explorer yet — try again in a moment.');
            } else {
                setUnlockError(err?.message || 'Failed to unlock.');
            }
            passwordRef.current?.focus();
            passwordRef.current?.select();
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className={styles.metaBlock}>
            <h4 className={styles.metaBlockTitle}>{heading}</h4>
            {description ? (
                <p className={styles.descriptionBody}>{description}</p>
            ) : null}
            <ul className={styles.filesList}>
                {group.files.map((f) => {
                    const plain = unlocked.get(String(f.actionIndex));
                    if (plain) {
                        return (
                            <li key={f.actionIndex}>
                                <UnlockedFileLink
                                    name={f.name || `Action #${f.actionIndex}`}
                                    type={f.type}
                                    plaintextBase64={plain.plaintextBase64}
                                />
                            </li>
                        );
                    }
                    return (
                        <li key={f.actionIndex}>
                            <button
                                type="button"
                                onClick={() => handleFileClick(f)}
                                className={styles.fileLink}
                                style={{
                                    cursor: 'pointer',
                                    font: 'inherit',
                                    width: '100%',
                                    textAlign: 'left',
                                    opacity: ownsToken ? 1 : 0.65,
                                }}
                                aria-label={ownsToken
                                    ? `Unlock and open ${f.name || 'gated file'}`
                                    : `Locked — purchase required to access ${f.name || 'gated file'}`}
                            >
                                <span className={styles.fileLinkIcon} aria-hidden="true">
                                    <Icon.FileTypeIcon type={f.type} />
                                </span>
                                <span className={styles.fileLinkName}>{f.name || `Action #${f.actionIndex}`}</span>
                                {f.type ? (
                                    <span className={styles.fileLinkType}>{f.type}</span>
                                ) : null}
                            </button>
                        </li>
                    );
                })}
            </ul>
            {accessError ? (
                <p
                    role="alert"
                    style={{
                        marginTop: 'var(--xc-space-2)',
                        padding: 'var(--xc-space-3)',
                        background: 'var(--xc-bg-muted)',
                        border: '1px dashed var(--xc-border)',
                        borderRadius: 'var(--xc-radius-sm)',
                        fontSize: 'var(--xc-text-sm)',
                        color: 'var(--xc-text)',
                        lineHeight: 1.5,
                    }}
                >
                    {accessError}
                </p>
            ) : null}
            {passwordOpen ? (
                <form onSubmit={handleUnlock} noValidate style={{ marginTop: 'var(--xc-space-3)' }}>
                    {addressesLoading ? (
                        <p className={styles.muted}>Loading addresses…</p>
                    ) : addressesError ? (
                        <p role="alert" className={styles.error}>{addressesError}</p>
                    ) : null}
                    <Input
                        ref={passwordRef}
                        type="password"
                        label="Wallet password"
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (unlockError) setUnlockError(null);
                        }}
                        autoComplete="current-password"
                        aria-invalid={unlockError ? true : undefined}
                    />
                    {unlockError ? (
                        <p role="alert" className={styles.error} style={{ marginTop: 'var(--xc-space-1)' }}>
                            {unlockError}
                        </p>
                    ) : null}
                    <div style={{ display: 'flex', gap: 'var(--xc-space-2)', marginTop: 'var(--xc-space-2)' }}>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={submitting}
                            disabled={
                                submitting
                                || password.length === 0
                                || !Array.isArray(addresses)
                                || addresses.length === 0
                            }
                        >
                            Open file
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={closePasswordPrompt}
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                    </div>
                </form>
            ) : null}
        </div>
    );
}

// Unlocked file rendered as the same colored full-width button used in
// the Media → Files section. Click opens the file: browser-renderable
// MIME types (image/*, text/*, application/json, application/pdf) open
// inline in a new tab; everything else downloads via the `download`
// attribute. The plaintext bytes live entirely in-memory via a Blob
// URL — no network round-trip and no on-disk artifact unless the user
// chooses to save the download.
function UnlockedFileLink({ name, type, plaintextBase64 }) {
    const mime = String(type || '').toLowerCase();
    const isInlineRenderable = mime.startsWith('image/')
        || mime.startsWith('text/')
        || mime === 'application/json'
        || mime.endsWith('+json')
        || mime === 'application/pdf';

    const blobUrl = useMemo(() => {
        try {
            const bin = typeof atob === 'function'
                ? atob(plaintextBase64)
                : Buffer.from(plaintextBase64, 'base64').toString('binary');
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
            return URL.createObjectURL(blob);
        } catch (_e) {
            return null;
        }
    }, [mime, plaintextBase64]);

    useEffect(() => {
        if (!blobUrl) return undefined;
        return () => URL.revokeObjectURL(blobUrl);
    }, [blobUrl]);

    if (!blobUrl) return null;

    return (
        <a
            href={blobUrl}
            className={styles.fileLink}
            target={isInlineRenderable ? '_blank' : undefined}
            rel="noreferrer noopener"
            download={isInlineRenderable ? undefined : (name || 'unlocked-file')}
        >
            <span className={styles.fileLinkIcon} aria-hidden="true">
                <Icon.FileTypeIcon type={type} />
            </span>
            <span className={styles.fileLinkName}>{name}</span>
            {type ? (
                <span className={styles.fileLinkType}>{type}</span>
            ) : null}
        </a>
    );
}

function HoldersPanel({ holders, holdersLoading, holdersError, holdersFetchedAt, divisibility }) {
    if (holdersLoading) return <p className={styles.muted}>Loading holders…</p>;
    if (holdersError) return <p role="alert" className={styles.error}>{holdersError}</p>;
    if (!holders || holders.length === 0) return null;
    return (
        <>
            {holdersFetchedAt ? (
                <div className={styles.holdersStaleness}>
                    <StalenessLabel lastSyncedAt={holdersFetchedAt} warnAfterMs={10 * 60_000} />
                </div>
            ) : null}
            <ol className={styles.holdersList}>
                {holders.slice(0, 25).map((h, i) => (
                    <li key={`${h.address || ''}:${i}`} className={styles.holdersRow}>
                        <span className={styles.holdersAddr}>
                            {shorten(h.address || h.ADDRESS || '—')}
                        </span>
                        <span className={styles.holdersQty}>
                            {formatAmount(String(h.quantity ?? h.QUANTITY ?? '0'), divisibility)}
                        </span>
                    </li>
                ))}
            </ol>
        </>
    );
}

function StatCell({ label, value, tone }) {
    const cls = tone === 'positive' ? styles.statValuePositive
        : tone === 'negative' ? styles.statValueNegative
        : styles.statValue;
    return (
        <div className={styles.statCell}>
            <div className={styles.statLabel}>{label}</div>
            <div className={cls}>{value}</div>
        </div>
    );
}

function formatCompactFiat(usd) {
    if (usd === null || usd === undefined || !isFinite(usd)) return '—';
    const abs = Math.abs(usd);
    if (abs >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(usd / 1e3).toFixed(2)}K`;
    return formatFiat(usd);
}

function formatPct(pct) {
    if (pct === null || pct === undefined || !isFinite(pct)) return '—';
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(2)}%`;
}

function pctTone(pct) {
    if (typeof pct !== 'number' || !isFinite(pct)) return undefined;
    if (pct > 0) return 'positive';
    if (pct < 0) return 'negative';
    return undefined;
}

function kindLabel(kind) {
    if (kind === 'native') return 'Native coin';
    if (kind === 'subtoken') return 'Sub-token';
    return 'Token';
}

function nativeTickerOf(chainId) {
    const desc = chainRegistry.get(chainId);
    return desc?.coin ? desc.coin.toUpperCase() : '';
}

function shorten(addr) {
    if (!addr || addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function safeBigInt(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string') {
        const t = v.trim();
        if (!/^-?\d+$/.test(t)) return 0n;
        return BigInt(t);
    }
    return 0n;
}

function formatAmount(quantityStr, divisibility) {
    const q = String(quantityStr || '0');
    if (!divisibility || divisibility <= 0) return groupThousands(q);
    const negative = q.startsWith('-');
    const abs = negative ? q.slice(1) : q;
    const padded = abs.padStart(divisibility + 1, '0');
    const whole = padded.slice(0, padded.length - divisibility);
    const frac = padded.slice(padded.length - divisibility);
    // Always render to full divisibility; trailing zeros are kept so
    // 0.04210000 BTC reads as 0.04210000 (not 0.0421). Matches the Home
    // BalanceList convention and what users coming from BTC-native
    // accounting expect.
    const out = `${groupThousands(whole)}.${frac}`;
    return negative ? `-${out}` : out;
}

function groupThousands(s) {
    return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fiatValue(quantityStr, divisibility, fiatRate) {
    if (typeof fiatRate !== 'number' || !isFinite(fiatRate)) return null;
    const q = safeBigInt(quantityStr);
    if (q === 0n) return 0;
    if (!divisibility || divisibility <= 0) return Number(q) * fiatRate;
    const div = 10n ** BigInt(divisibility);
    const whole = Number(q / div);
    const frac = Number(q % div) / Number(div);
    return (whole + frac) * fiatRate;
}

function formatFiat(usd) {
    if (usd === null || usd === undefined) return '—';
    if (usd === 0) return '$0.00';
    if (usd > 0 && usd < 0.01) return '<$0.01';
    return '$' + usd.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

// Returns just the symbol-prefixed numeric portion of a fiat value in
// the wallet's preferred currency ("$8,642.00", "¥1,200"). The ISO
// currency code is rendered separately as a styled suffix span by the
// caller so it can be sized down relative to the amount. Uses
// Intl.NumberFormat so currencies with non-USD symbols / decimal
// conventions render correctly; falls back to a plain-number rendering
// if the code is unknown to Intl.
function formatFiatNumber(value, currency) {
    if (value === null || value === undefined) return '—';
    const code = String(currency || 'USD').toUpperCase();
    try {
        const formatter = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'symbol',
        });
        const minorUnit = formatter.resolvedOptions().maximumFractionDigits === 0 ? 1 : 0.01;
        if (value > 0 && value < minorUnit) {
            return `<${formatter.format(minorUnit)}`;
        }
        return formatter.format(value);
    } catch {
        return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
}

// Fits its children on a single line by measuring overflow with a
// ResizeObserver and applying a CSS transform: scale(...) when the
// content is wider than the container. Avoids the wrapping that the
// old `word-break: break-all` rule produced on long fiat balances
// (e.g. JPY which can run 9+ digits). Scales down only — never up —
// so short values render at their natural size.
function AutoShrinkText({ children }) {
    const containerRef = useRef(null);
    const innerRef = useRef(null);
    const [scale, setScale] = useState(1);

    useLayoutEffect(() => {
        const c = containerRef.current;
        const i = innerRef.current;
        if (!c || !i) return undefined;
        let cancelled = false;
        const measure = () => {
            if (cancelled) return;
            // Reset to scale(1) before measuring so scrollWidth reflects
            // the natural intrinsic width, not the previously-scaled width.
            i.style.transform = 'scale(1)';
            const cw = c.clientWidth;
            const iw = i.scrollWidth;
            if (iw <= 0 || cw <= 0) { setScale(1); return; }
            // 2px safety margin absorbs subpixel rounding in transform
            // scaling — without it the trailing glyph can clip by a
            // fraction of a pixel ("USD" → "US", "BTC" → "BT+half C").
            const target = Math.max(0, cw - 2);
            setScale(iw > target ? target / iw : 1);
        };
        measure();
        // First layout often runs before the mono webfont has loaded;
        // the fallback's narrower glyphs underestimate scrollWidth, so
        // we skip the shrink and the wider webfont then overflows the
        // container. Re-measure when fonts settle.
        if (typeof document !== 'undefined' && document.fonts?.ready?.then) {
            document.fonts.ready.then(() => { if (!cancelled) measure(); });
        }
        const ro = new ResizeObserver(measure);
        ro.observe(c);
        return () => { cancelled = true; ro.disconnect(); };
    }, [children]);

    return (
        <span ref={containerRef} className={styles.balanceHeroAmountFitWrap}>
            <span
                ref={innerRef}
                className={styles.balanceHeroAmountFitInner}
                style={{ transform: `scale(${scale})` }}
            >
                {children}
            </span>
        </span>
    );
}

const PALETTE = [
    '#1E90C7', '#7B2C8F', '#0EA5E9', '#10B981', '#F59E0B',
    '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
    '#6366F1', '#84CC16', '#06B6D4', '#A855F7', '#F43F5E',
];
function tickerColor(tick) {
    let h = 0;
    for (let i = 0; i < tick.length; i += 1) {
        h = (h * 31 + tick.charCodeAt(i)) >>> 0;
    }
    return PALETTE[h % PALETTE.length];
}
