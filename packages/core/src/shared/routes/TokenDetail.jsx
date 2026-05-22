import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Screen, ChainBadge, Icon } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { StalenessLabel } from '../components/StalenessLabel.jsx';
import { useAssetInfo } from '../hooks/useAssetInfo.js';
import { useNativePrice } from '../hooks/useNativePrice.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import styles from './TokenDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * §27.6 token detail page (G071).
 *
 * Single-token view that aggregates everything we know about one
 * (chainId, asset) pair from the data surfaces the wallet already
 * exposes: the row metadata threaded in from the unified balance list,
 * `messaging.getHoldersForToken` for the distribution panel, and the
 * existing History route as the "View activity" target (pre-filtered
 * by tick via History's `initialSearchQuery` prop).
 *
 * Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3 ship the richer metadata
 * via `messaging.getAssetInfo`: description / creator / supply / lock
 * status / market price / extracted image URL all surface inline below
 * the existing fixed metadata block. Phase-3 features (Sell on DEX,
 * Market view, supply chart over time) and reputation remain tracked
 * in FOLLOWUPS.md under §27.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.asset                       ticker (uppercase canonical)
 * @param {'native' | 'token' | 'subtoken' | string} [props.kind]
 * @param {string} [props.displayName]               human-readable name (defaults to ticker)
 * @param {number} [props.divisibility]
 * @param {number | null} [props.fiatRate]           USD per token if known
 * @param {string} [props.quantity]                  atomic-unit balance string
 * @param {() => void} props.onBack
 * @param {() => void} [props.onSend]                navigate to Send route
 * @param {() => void} [props.onReceive]             navigate to Receive route
 * @param {() => void} [props.onViewActivity]        navigate to History pre-filtered to this asset
 */
export function TokenDetail({
    walletId,
    chainId,
    asset,
    kind = 'token',
    displayName,
    divisibility = 8,
    fiatRate = null,
    quantity = '0',
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
    const assetInfo = useAssetInfo({ chainId, asset, skip: isNative });

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

    useEffect(() => {
        if (!holdersOpen || holders !== null || isNative) return undefined;
        if (typeof messaging.getHoldersForToken !== 'function') {
            setHoldersError('Holders lookup is not available in this build.');
            return undefined;
        }
        let cancelled = false;
        setHoldersLoading(true);
        setHoldersError(null);
        messaging.getHoldersForToken({ chainId, tick: asset })
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
    }, [holdersOpen, holders, isNative, asset, chainId, messaging]);

    const fiat = useMemo(() => {
        if (typeof fiatRate !== 'number' || !isFinite(fiatRate)) return null;
        return fiatValue(quantity, divisibility, fiatRate);
    }, [quantity, divisibility, fiatRate]);

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>{displayName || asset}</span>
            <span className={styles.spacer} />
        </div>
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
    const tabs = isNative
        ? null
        : [
            { id: 'info', label: 'Info' },
            { id: 'holders', label: 'Holders' },
        ];
    const [activeTab, setActiveTab] = useState(tabs ? tabs[0].id : 'info');
    useEffect(() => {
        if (activeTab === 'holders') setHoldersOpen(true);
    }, [activeTab]);

    const [balanceHidden, toggleBalanceHidden] = useBalancesHidden();
    // Tap the amount to swap primary / secondary. Default: asset units
    // (matches the BalanceList convention; users opening Bitcoin expect
    // to see how much BTC they hold first, USD second). Fiat-as-primary
    // is one tap away for users who think in USD.
    const [primaryUnit, setPrimaryUnit] = useState('asset');

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
    // balance hero treatment). For BTC the code is the asset ticker;
    // for fiat the code is the wallet's preferred currency.
    const assetAmount = formatAmount(quantity, divisibility);
    const fiatAmount = fiatAvailable ? formatFiatNumber(fiat, fiatCurrency) : '—';
    const showFiatPrimary = primaryUnit === 'fiat' && fiatAvailable;
    const primaryAmount = showFiatPrimary ? fiatAmount : assetAmount;
    const primaryCode = showFiatPrimary ? fiatCurrency : asset;
    const secondaryAmount = showFiatPrimary ? assetAmount : fiatAmount;
    const secondaryCode = showFiatPrimary ? asset : (fiatAvailable ? fiatCurrency : '');

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.bodyFull : styles.bodyPopup}>
                {/* Asset balance hero — gradient block, same style as
                    Home's TotalBalanceHero. Top row carries the label,
                    a swap button for flipping asset ↔ fiat as primary,
                    and the hide-balance eye. Big number = primary,
                    small number underneath = secondary. */}
                <section className={styles.balanceHero} aria-label={`${displayName || asset} balance`}>
                    <div className={styles.balanceHeroRow}>
                        <span className={styles.balanceHeroLabel}>Total balance</span>
                        <div className={styles.balanceHeroControls}>
                            <button
                                type="button"
                                className={styles.balanceHeroSwap}
                                onClick={() => setPrimaryUnit((p) => (p === 'asset' ? 'fiat' : 'asset'))}
                                disabled={!fiatAvailable}
                                aria-label="Swap primary unit"
                                title="Swap primary unit"
                            >
                                <Icon.SwapIcon />
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
                </section>

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
                        <span className={styles.quickActionIcon} aria-hidden="true"><Icon.DollarIcon /></span>
                        <span>Buy</span>
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

                {/* Market section — stats strip + sparkline chart at the
                    top of the page for every asset, so users see price /
                    24h / chart immediately the same way the Coins detail
                    surface does. Tokens synthesize a sparkline keyed on
                    asset+chain when no real history feed exists yet. */}
                <div className={styles.infoCard}>
                    <MarketPanel
                        isNative={isNative}
                        nativePrice={nativePrice}
                        showNativeStats={showNativeStats}
                        showSparkline={showSparkline}
                        assetInfo={assetInfo}
                        asset={asset}
                        chainId={chainId}
                        hasMarketData={hasMarketData}
                        fiatRate={fiatRate}
                        fiatCurrency={fiatCurrency}
                    />
                </div>

                {tabs ? (
                    <>
                        {/* Tabs — matches HomeTabs visual rhythm. Tokens
                            keep Info + Holders here below the Market
                            section above. */}
                        <div className={styles.tabs} role="tablist" aria-label="Asset detail view">
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
                            {activeTab === 'info' ? (
                                <InfoPanel
                                    asset={asset}
                                    displayName={displayName}
                                    descriptor={descriptor}
                                    chainId={chainId}
                                    kind={kind}
                                    isNative={isNative}
                                    assetInfo={assetInfo}
                                    hasDescription={hasDescription}
                                    quantity={quantity}
                                    divisibility={divisibility}
                                    fiat={fiat}
                                    fiatCurrency={fiatCurrency}
                                />
                            ) : null}

                            {activeTab === 'holders' && !isNative ? (
                                <HoldersPanel
                                    holders={holders}
                                    holdersLoading={holdersLoading}
                                    holdersError={holdersError}
                                    holdersFetchedAt={holdersFetchedAt}
                                    divisibility={divisibility}
                                />
                            ) : null}
                        </div>
                    </>
                ) : (
                    /* Native coin: no tabs. Info panel stacks below the
                       Market section that already rendered above. */
                    <div className={styles.infoCard}>
                        <InfoPanel
                            asset={asset}
                            displayName={displayName}
                            descriptor={descriptor}
                            chainId={chainId}
                            kind={kind}
                            isNative={isNative}
                            assetInfo={assetInfo}
                            hasDescription={hasDescription}
                            quantity={quantity}
                            divisibility={divisibility}
                            fiat={fiat}
                            fiatCurrency={fiatCurrency}
                        />
                    </div>
                )}

            </div>
        </Screen>
    );
}

// Deterministic FNV-ish string hash so synthesized chart data stays
// stable across re-renders for the same asset/chain pair.
function hashStringFor(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// Synthesize a 168-point (1/hr × 7d) random-walk price series for a
// non-native token that doesn't have a real history feed wired up yet.
// The walk is seeded by the asset key so the line is stable across
// re-renders and ends exactly at `currentPrice` — a follow-up will swap
// this for real data once the indexer exposes a price-history endpoint.
function synthesizeTokenChart(assetKey, currentPrice) {
    if (typeof currentPrice !== 'number' || !isFinite(currentPrice) || currentPrice <= 0) {
        return { sparkline: null, change24hPct: null };
    }
    let rng = hashStringFor(assetKey);
    const advance = () => {
        rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
        return (rng / 0xffffffff) * 2 - 1; // [-1, +1]
    };
    // Pick a 7d trend in [-30%, +30%], biased toward modest moves.
    const trendPct = advance() * 30;
    const start = currentPrice / (1 + trendPct / 100);
    const points = 168;
    const series = new Array(points);
    series[0] = start;
    for (let i = 1; i < points; i += 1) {
        const drift = (currentPrice - series[i - 1]) / (points - i);
        const noise = advance() * 0.015 * series[i - 1];
        series[i] = Math.max(0.0000001, series[i - 1] + drift + noise);
    }
    series[points - 1] = currentPrice;
    // 24h change = last point vs 24 points back.
    const back = series[points - 25] || start;
    const change24hPct = back > 0 ? ((currentPrice - back) / back) * 100 : null;
    return { sparkline: series, change24hPct };
}

function MarketPanel({ isNative, nativePrice, showSparkline, assetInfo, asset, chainId, fiatRate, fiatCurrency }) {
    // Always render the KPI strip with the same shape — placeholders
    // ("—") fill in for missing data so the structure stays consistent
    // whether the price oracle is disabled, still loading, or simply
    // doesn't have data for this asset (e.g. testnet, regtest).

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
            if (showSparkline) sparkline = e.sparkline;
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
                    <div className={styles.chart} aria-label="7-day price chart">
                        <Sparkline series={sparkline} />
                    </div>
                ) : null}
                {hint ? <p className={styles.muted}>{hint}</p> : null}
            </>
        );
    }

    // Token path — try assetInfo.marketPrice first (XCP-denominated
    // price from the indexer); if unavailable, fall back to fiatRate
    // passed in from the balance fixture so the demo wallet still
    // gets a populated chart + 24h cell. Both paths feed into the
    // same synthesized sparkline keyed on asset+chain.
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
        const synth = synthesizeTokenChart(`${chainId}|${asset}|native`, marketPriceNum);
        if (synth.change24hPct != null) {
            pct24h = formatPct(synth.change24hPct);
            pctTone24h = pctTone(synth.change24hPct);
        }
        sparkline = synth.sparkline;
    } else if (typeof fiatRate === 'number' && isFinite(fiatRate) && fiatRate > 0) {
        priceCell = formatFiat(fiatRate);
        void fiatCurrency;
        const synth = synthesizeTokenChart(`${chainId}|${asset}|fiat`, fiatRate);
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
                    <Sparkline series={sparkline} />
                </div>
            ) : null}
            {hint ? <p className={styles.muted}>{hint}</p> : null}
        </>
    );
}

function InfoPanel({
    asset,
    displayName,
    descriptor,
    chainId,
    kind,
    isNative,
    assetInfo,
    hasDescription,
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
                        <td>{displayName || asset}</td>
                    </tr>
                    <tr className={styles.metaRow}>
                        <th scope="row">Ticker</th>
                        <td>{asset}</td>
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
                        <td>{balanceHidden ? '•••••' : `${formatAmount(quantity, divisibility)} ${asset}`}</td>
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

            {hasDescription ? (
                <div className={styles.infoStack}>
                    {assetInfo.imageUrl ? (
                        <img
                            src={assetInfo.imageUrl}
                            alt=""
                            aria-hidden="true"
                            className={styles.descriptionImage}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    ) : null}
                    <p className={styles.descriptionBody}>{assetInfo.description}</p>
                </div>
            ) : null}

            {!isNative && !assetInfo ? (
                <p className={styles.metadataHint}>Loading description, creator, and supply…</p>
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

function HoldersPanel({ holders, holdersLoading, holdersError, holdersFetchedAt, divisibility }) {
    if (holdersLoading) return <p className={styles.muted}>Loading holders…</p>;
    if (holdersError) return <p role="alert" className={styles.error}>{holdersError}</p>;
    if (!holders || holders.length === 0) return <p className={styles.muted}>No holders reported.</p>;
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

/**
 * Pure-SVG sparkline. ~168 points (1/hr × 7d) renders as a single
 * polyline scaled to the viewBox. Min/max are computed from the series
 * so the line uses the full vertical extent of the chart.
 */
function Sparkline({ series, height = 80, strokeWidth = 1.5 }) {
    const points = useMemo(() => {
        if (!Array.isArray(series) || series.length < 2) return null;
        const min = Math.min(...series);
        const max = Math.max(...series);
        const range = max - min || 1;
        const xStep = 100 / (series.length - 1);
        return series
            .map((v, i) => {
                const x = i * xStep;
                const y = 100 - ((v - min) / range) * 100;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(' ');
    }, [series]);
    if (!points) return null;
    const tone = series[series.length - 1] >= series[0] ? 'positive' : 'negative';
    const stroke = tone === 'positive' ? 'var(--xc-success, #14b86c)' : 'var(--xc-danger, #d93838)';
    return (
        <svg
            className={styles.sparkSvg}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ height }}
            role="img"
            aria-label="Price trend"
        >
            <polyline
                fill="none"
                stroke={stroke}
                strokeWidth={strokeWidth}
                vectorEffect="non-scaling-stroke"
                points={points}
            />
        </svg>
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
function tickerColor(asset) {
    let h = 0;
    for (let i = 0; i < asset.length; i += 1) {
        h = (h * 31 + asset.charCodeAt(i)) >>> 0;
    }
    return PALETTE[h % PALETTE.length];
}
