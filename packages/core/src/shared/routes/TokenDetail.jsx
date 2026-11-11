// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AddressText, Button, ChainBadge, CopyButton, EmptyState, Icon, Input, ListPage, ListRow, PageHeader, Screen, SectionHeader, Skeleton, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { getDemoGatedGroupsForTick, isDemoGatedActionIndex } from '../../flows/demoGatedContent.js';
import { StalenessLabel } from '../components/StalenessLabel.jsx';
import { BalanceHeroMenu } from '../components/BalanceHeroMenu.jsx';
import { GatedFileViewer } from '../components/GatedFileViewer.jsx';
import { Sparkline, synthesizeTokenChart } from '../components/Sparkline.jsx';
import { isDemoWallet } from '../../flows/demoMode.js';
import { synthesizeDemoNativePrices } from '../../flows/demoFixtures.js';
import { RANGES as CHART_RANGES, defaultRangeId, priceHistoryForRange } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { useIsTokenIssuer } from '../hooks/useIsTokenIssuer.js';
import { useNativePrice } from '../hooks/useNativePrice.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { usePriceAlerts } from '../hooks/usePriceAlerts.js';
import { PriceAlertForm } from '../components/PriceAlertForm.jsx';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { usePortfolioChartVisible } from '../hooks/usePortfolioChartVisible.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { coinFromChainId, formatFiat } from '../components/BalanceList.jsx';
import { BridgeOriginTick } from './BridgeOriginBadge.jsx';
import { parseBridgedTick, bridgeDisplayTick, coinDisplay } from './BridgeTick.js';
import {
    decimalFromBaseUnits,
    expandDecimalNotation,
    formatAtomicAmount,
    formatDecimalAmount,
    formatTokenQuantity,
    formatWithThousands,
    multiplyDecimalStrings,
} from '../utils/amountFormat.js';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { extractHolderRows } from '../utils/holderRows.js';
import { explorerPage, uniqueRows } from '../utils/pagedRows.js';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import { safeHttpUrl } from '../utils/externalUrl.js';
import { readActiveAccount } from '../utils/activeAccountMemory.js';
import { chainReadFailed, sumTickOnChain } from '../utils/walletBalanceShape.js';
import { useBackHandler } from '../../ui/backStack.js';
import styles from './TokenDetail.module.css';
import { QuickActionTile } from '../../ui/QuickActionTile.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

const chainRegistry = registryLib.defaultRegistry();
const HOLDERS_PAGE_SIZE = 25;
const HOLDER_WINDOW_SIZE = 100;

function callAsync(callback) {
    return Promise.resolve().then(callback);
}

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
 * the existing fixed metadata block.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick                       ticker (uppercase canonical)
 * @param {'native' | 'token' | 'subtoken' | string} [props.kind]
 * @param {string} [props.displayName]               human-readable name (defaults to ticker)
 * @param {number} [props.divisibility]
 * @param {number | null} [props.fiatRate]           selected fiat currency per token if known
 * @param {string | null} [props.fiatRateSource]     rate source, including `market` for DEX-derived prices
 * @param {boolean} [props.fiatRateStale]           true when the rate is a kept observation after a failed refresh
 * @param {string | null} [props.fiatRateFetchedAt]  ISO time the rate was observed
 * @param {string} [props.quantity]                  atomic-unit balance string
 * @param {() => void} props.onBack
 * @param {() => void} [props.onSend]                navigate to Send route
 * @param {() => void} [props.onReceive]             navigate to Receive route
 * @param {() => void} [props.onBuy]                 navigate to the selected asset's exchange flow
 * @param {() => void} [props.onViewActivity]        navigate to History pre-filtered to this tick
 * @param {() => void} [props.onManageToken]         navigate to the issuer's Manage Token view for this tick; only offered when the wallet holds the issuing address (see useIsTokenIssuer.js)
 */
export function TokenDetail(props) {
    const assetScope = JSON.stringify([
        props.walletId,
        props.chainId,
        props.tick,
        props.kind || 'token',
    ]);
    return <TokenDetailContent key={assetScope} {...props} />;
}

function TokenDetailContent({
    walletId,
    chainId,
    tick,
    kind = 'token',
    displayName,
    divisibility = null,
    fiatRate = null,
    fiatRateSource = null,
    fiatRateStale = false,
    fiatRateFetchedAt = null,
    quantity: suppliedQuantity,
    imageUrl: rowImageUrl = null,
    onBack,
    onSend,
    onReceive,
    onBuy,
    onViewActivity,
    onManageToken,
}) {
    const { messaging, shell } = useMessaging();
    const { settings, loading: settingsLoading, error: settingsError } = useSettings();
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    // A failed settings read still opens the screen in full mode.
    const walletModeReady = settings !== null || !settingsLoading;
    const isDemo = isDemoWallet(walletId);
    const { offline: networkOffline } = useNetworkOffline({ walletId });
    const networkActionsAvailable = !networkOffline;
    const variant = screenVariantFor(shell);
    const tabsId = useId();
    const [revealedExtra, setRevealedExtra] = useState(null);
    const [resolvedQuantity, setResolvedQuantity] = useState(
        typeof suppliedQuantity === 'string' ? suppliedQuantity : null,
    );
    // A failed balance read leaves the amount unknown; it never reads as zero.
    const [balanceFailed, setBalanceFailed] = useState(false);
    useEffect(() => {
        setBalanceFailed(false);
        if (typeof suppliedQuantity === 'string') {
            setResolvedQuantity(suppliedQuantity);
            return undefined;
        }
        setResolvedQuantity(null);
        if (typeof messaging.getWalletBalances !== 'function') {
            setBalanceFailed(true);
            return undefined;
        }
        let cancelled = false;
        messaging.getWalletBalances(walletId, readActiveAccount(walletId) || undefined)
            .then((byChain) => {
                if (cancelled) return;
                // A failed address leaves the total short, so the amount is unknown.
                if (chainReadFailed(byChain, chainId)) setBalanceFailed(true);
                else setResolvedQuantity(sumTickOnChain(byChain, chainId, tick));
            })
            .catch(() => {
                if (!cancelled) setBalanceFailed(true);
            });
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId, tick, suppliedQuantity]);
    const quantity = resolvedQuantity;

    const descriptor = chainRegistry.get(chainId);
    const isNative = kind === 'native';
    // The price section shows outside test networks, including before
    // settings load; the demo wallet prices its synthetic test holdings.
    const fiatSupported = isDemo || (settings
        ? settings.activeNetwork !== 'testnet' && settings.activeNetwork !== 'regtest'
        : Boolean(settingsError) || descriptor?.networkKind === 'mainnet');
    // A fiat value itself needs a mainnet holding, whatever the settings say.
    const fiatAllowed = isDemo || descriptor?.networkKind === 'mainnet';
    const displayFiatRate = fiatSupported && fiatAllowed ? fiatRate : null;
    const tokenAlertRate = useTickFiatRate({
        chainCoin: descriptor?.coin,
        tick,
        nativeTicker: tickerForCoin(descriptor?.coin),
        fiatCurrency,
        allowCoingeckoFallback: Boolean(settings) && settings?.privacy?.priceDataEnabled !== false,
        enabled: !isNative && fiatSupported && fiatAllowed,
    });
    // A kept rate from before a failed refresh says how old it is, so it
    // never reads as a current price.
    const staleFiatRateAsOf = fiatRateStale === true && displayFiatRate != null
        ? Date.parse(fiatRateFetchedAt || '')
        : NaN;

    // §27.6 / Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3: pull
    // description / creator / supply / locks / market / extracted
    // imageUrl. Skipped for native coins (BTC / LTC / DOGE) since
    // they're not XChain-issued tokens.
    const assetInfo = useTokenInfo({ chainId, tick, skip: isNative, demo: isDemo });
    const resolvedDivisibility = isNative
        ? normalizedDivisibility(divisibility)
        : normalizedDivisibility(assetInfo?.divisibility) ?? normalizedDivisibility(divisibility);
    const [tokenMissing, setTokenMissing] = useState(false);
    const [readFailed, setReadFailed] = useState(false);
    useEffect(() => {
        setTokenMissing(false);
        setReadFailed(false);
        if (isNative || isDemo || typeof messaging.getTokenInfo !== 'function') return undefined;
        let cancelled = false;
        callAsync(() => messaging.getTokenInfo({ chainId, tick }))
            .then((info) => {
                if (cancelled) return;
                setTokenMissing(info == null);
                setReadFailed(info?.loadError === true);
            })
            // A read failure is not proof that the token is gone; it is a notice.
            .catch(() => { if (!cancelled) setReadFailed(true); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick, isNative, isDemo]);
    const loadFailed = !isNative && (readFailed || assetInfo?.loadError === true);
    const metadataLoading = !isNative && !assetInfo && !tokenMissing && !readFailed;

    // A holder who is also the issuer gets a way back to the admin
    // surface: without this, ManageToken was reachable only via Menu ->
    // My Tokens, several taps away from the token they just opened.
    // Native coins have no issuer, so the check is skipped there.
    const isTokenOwner = useIsTokenIssuer({
        messaging,
        walletId,
        chainId,
        issuerAddress: isNative ? null : (assetInfo?.creator || null),
    });

    const [moreOpen, setMoreOpen] = useState(false);
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const moreTriggerRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
    const moreMenuRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const moreMenuId = useId();
    const sendReasonId = useId();
    const receiveReasonId = useId();
    const tradeReasonId = useId();
    const closeMore = useCallback((restoreFocus = false) => {
        setMoreOpen(false);
        if (restoreFocus) moreTriggerRef.current?.focus();
    }, []);
    // The system Back gesture closes the menu before it leaves the screen.
    useBackHandler(moreOpen ? () => closeMore(true) : undefined);
    useEffect(() => {
        if (!moreOpen) return undefined;
        moreMenuRef.current?.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
        const onPointerDown = (event) => {
            if (moreWrapRef.current?.contains(event.target)) return;
            closeMore();
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeMore(true);
        };
        window.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [closeMore, moreOpen]);
    // Arrow keys, Home and End move between menu entries; Tab leaves and closes.
    const handleMoreMenuKey = (event) => {
        if (event.key === 'Tab') {
            closeMore();
            return;
        }
        const entries = Array.from(moreMenuRef.current?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') || []);
        if (entries.length === 0) return;
        const index = entries.indexOf(document.activeElement);
        let next = null;
        if (event.key === 'ArrowDown') next = (index + 1) % entries.length;
        if (event.key === 'ArrowUp') next = (index - 1 + entries.length) % entries.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = entries.length - 1;
        if (next === null) return;
        event.preventDefault();
        entries[next].focus();
    };
    // An entry hands focus back to the tile before it acts, so an entry that
    // opens nothing new leaves keyboard users where they started.
    const runMoreItem = (onSelect) => {
        closeMore(true);
        onSelect();
    };

    // Native-coin price oracle (BTC / LTC / DOGE mainnet). Gated by
    // settings.privacy.priceDataEnabled; the hook surfaces a `disabled`
    // flag the UI uses to hide the stats strip + chart with no calls
    // having fired. Skipped for non-native (XCP tokens don't have a
    // CoinGecko entry).
    const queriedNativePrice = useNativePrice(isNative && fiatSupported && fiatAllowed && !isDemo ? chainId : null, {
        includeSparkline: true,
        fiatCurrency,
    });
    const nativePrice = isNative && isDemo
        ? {
            entry: synthesizeDemoNativePrices([chainId])[chainId] ?? null,
            loading: false,
            disabled: false,
            error: null,
        }
        : queriedNativePrice;

    const supplyHistory = useSupplyHistory({ messaging, chainId, tick, skip: isNative || isDemo });

    const handleBack = useCallback(() => {
        onBack();
        restoreBalanceRowFocus(chainId, tick);
    }, [chainId, onBack, tick]);

    const [holdersOpen, setHoldersOpen] = useState(false);
    const [gatedOpen, setGatedOpen] = useState(false);
    const [holders, setHolders] = useState(/** @type {any[] | null} */ (null));
    const [holdersError, setHoldersError] = useState(/** @type {string | null} */ (null));
    const [holdersMoreError, setHoldersMoreError] = useState(/** @type {string | null} */ (null));
    const [holdersLoading, setHoldersLoading] = useState(false);
    const [holdersLoadingMore, setHoldersLoadingMore] = useState(false);
    const [holdersPage, setHoldersPage] = useState(0);
    const [holdersTotal, setHoldersTotal] = useState(/** @type {number | null} */ (null));
    const [holdersHasMore, setHoldersHasMore] = useState(false);
    const holdersRequestId = useRef(0);
    // Cluster G FOLLOWUP 5: Unix ms of the last holders fetch; drives a
    // staleness label inside the holders panel so the user can tell at
    // a glance whether the listing is live.
    const [holdersFetchedAt, setHoldersFetchedAt] = useState(
        /** @type {number | null} */ (null),
    );

    // Token-gated content groups (per KEY_HASH). Populated when its More info
    // entry is chosen. See xchain-documentation/protocol/token-gated-content.md.
    const [gatedGroups, setGatedGroups] = useState(/** @type {any[] | null} */ (null));
    const [gatedError, setGatedError] = useState(/** @type {string | null} */ (null));
    const [gatedLoading, setGatedLoading] = useState(false);

    useEffect(() => {
        if (!holdersOpen || isNative) return undefined;
        if (isDemo) {
            setHolders([]);
            setHoldersLoading(false);
            setHoldersError(null);
            return undefined;
        }
        if (typeof messaging.getHoldersForToken !== 'function') {
            setHoldersError('Holders lookup is not available in this build.');
            return undefined;
        }
        let cancelled = false;
        holdersRequestId.current += 1;
        setHolders(null);
        setHoldersLoading(true);
        setHoldersLoadingMore(false);
        setHoldersError(null);
        setHoldersMoreError(null);
        setHoldersPage(0);
        setHoldersTotal(null);
        setHoldersHasMore(false);
        callAsync(() => messaging.getHoldersForToken({
            chainId,
            tick,
            opts: { page: 1, limit: HOLDERS_PAGE_SIZE },
        }))
            .then((resp) => {
                if (cancelled) return;
                const list = uniqueRows(extractHolderRows(resp), holderIdentity);
                const page = explorerPage(resp, extractHolderRows(resp), 1, HOLDERS_PAGE_SIZE);
                setHolders(list);
                setHoldersFetchedAt(Date.now());
                setHoldersPage(1);
                setHoldersTotal(page.total);
                setHoldersHasMore(page.hasMore);
            })
            .catch((err) => {
                if (cancelled) return;
                setHoldersError(readFailureMessage(err, 'load the holders'));
            })
            .finally(() => { if (!cancelled) setHoldersLoading(false); });
        return () => { cancelled = true; };
    }, [holdersOpen, isNative, tick, chainId, messaging, isDemo]);

    const loadMoreHolders = useCallback(() => {
        if (holdersLoading || holdersLoadingMore || !holdersHasMore) return;
        const nextPage = holdersPage + 1;
        const requestId = holdersRequestId.current;
        const before = holders || [];
        setHoldersLoadingMore(true);
        setHoldersMoreError(null);
        callAsync(() => messaging.getHoldersForToken({
            chainId,
            tick,
            opts: { page: nextPage, limit: HOLDERS_PAGE_SIZE },
        })).then((resp) => {
            if (requestId !== holdersRequestId.current) return;
            const pageRows = extractHolderRows(resp);
            const page = explorerPage(resp, pageRows, nextPage, HOLDERS_PAGE_SIZE);
            const merged = uniqueRows([...before, ...pageRows], holderIdentity);
            setHolders(merged);
            setHoldersHasMore(page.hasMore && merged.length > before.length);
            setHoldersPage(nextPage);
            setHoldersTotal(page.total);
            setHoldersFetchedAt(Date.now());
        }).catch((err) => {
            if (requestId !== holdersRequestId.current) return;
            setHoldersMoreError(readFailureMessage(err, 'load more holders'));
        }).finally(() => {
            if (requestId === holdersRequestId.current) setHoldersLoadingMore(false);
        });
    }, [chainId, holders, holdersHasMore, holdersLoading, holdersLoadingMore, holdersPage, messaging, tick]);

    useEffect(() => {
        if (!gatedOpen || isNative) return undefined;
        if (isDemo) {
            setGatedGroups(getDemoGatedGroupsForTick(tick));
            setGatedLoading(false);
            setGatedError(null);
            return undefined;
        }
        if (typeof messaging.listGatedContent !== 'function') {
            // Older host build without gated-content support; skip silently
            // (no error UI), since pre-feature tokens have no gated entries.
            setGatedGroups([]);
            return undefined;
        }
        let cancelled = false;
        setGatedGroups(null);
        setGatedLoading(true);
        setGatedError(null);
        callAsync(() => messaging.listGatedContent({ chainId, tick }))
            .then((resp) => {
                if (cancelled) return;
                setGatedGroups(Array.isArray(resp) ? resp : []);
            })
            .catch((err) => {
                if (cancelled) return;
                setGatedError(readFailureMessage(err, 'load the gated content'));
            })
            .finally(() => { if (!cancelled) setGatedLoading(false); });
        return () => { cancelled = true; };
    }, [gatedOpen, isNative, tick, chainId, messaging, isDemo]);

    // A native coin's holding is valued at the live price the stats strip
    // shows. The rate carried in from the balance row, or restored with the
    // route after a reload, only stands in until that price answers, so the
    // hero never prices the holding at an older rate than the screen quotes.
    const liveNativeRate = isNative ? positiveFiniteNumber(nativePrice.entry?.priceFiat) : null;
    const holdingFiatRate = liveNativeRate ?? displayFiatRate;
    const showStaleFiatRate = liveNativeRate === null && Number.isFinite(staleFiatRateAsOf);
    const fiat = useMemo(() => {
        if (typeof holdingFiatRate !== 'number' || !isFinite(holdingFiatRate)) return null;
        return fiatValue(quantity, resolvedDivisibility, holdingFiatRate);
    }, [quantity, resolvedDivisibility, holdingFiatRate]);

    // Header icon picks the smallest representation available: a TIS
    // `icon`-typed image first, then any other TIS image, then the
    // regex-extracted hero, then the balance-row image (demo SVG or
    // pre-known URL). For native coins the TIS lookup is skipped, so
    // we fall back to the branded chain logo so BTC/LTC/DOGE always
    // show the right glyph in the header + balance hero.
    const headerIconUrl = useMemo(() => {
        const tisImages = Array.isArray(assetInfo?.images) ? assetInfo.images : [];
        const webImages = tisImages.filter((i) => safeHttpUrl(i?.url));
        const iconHit = webImages.find((i) => String(i?.type || '').toLowerCase() === 'icon');
        const fromTis = iconHit?.url
            || webImages[0]?.url
            || safeHttpUrl(assetInfo?.imageUrl)
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

    const pageTitle = displayName || bridgeDisplayTick(tick, coinFromChainId(chainId)).label;
    const header = (
        <PageHeader
            onBack={handleBack}
            // A bridged copy is titled by its bare name; the rooted wire form
            // and the origin chain are both on the Details panel below, so the
            // page never hides which asset this really is.
            title={(
                <span className={styles.headerTitle} title={pageTitle}>
                    {pageTitle}
                </span>
            )}
        />
    );

    const nativePriceValue = positiveFiniteNumber(nativePrice.entry?.priceFiat);
    const showNativeStats = isNative && !nativePrice.disabled && nativePriceValue !== null;
    const hasAbout = !isNative && hasSupplementalTokenInfo(assetInfo);
    const hasMedia = !isNative && hasPublishedMedia(assetInfo);
    const hasMarketData = (isNative && showNativeStats) || (!isNative && assetInfo?.marketPrice != null);

    // Coins and tokens keep the same single Details tab. Secondary token
    // surfaces are selected from More info and revealed above this tab.
    const tabs = [{ id: 'details', label: 'Details' }];

    const [balanceHidden, toggleBalanceHidden] = useBalancesHidden();
    const [chartVisible, toggleChartVisible] = usePortfolioChartVisible();
    // Tap the amount to swap primary / secondary. Default: tick units
    // (matches the BalanceList convention; users opening Bitcoin expect
    // to see how much BTC they hold first, USD second). Fiat-as-primary
    // is one tap away for users who think in USD.
    const [primaryUnit, setPrimaryUnit] = useState('tick');

    const fiatAvailable = fiat != null && isFinite(fiat);
    const hasDexPrice = !isNative && (
        fiatRateSource === 'market'
        || (assetInfo?.marketPrice != null
            && Number.isFinite(Number(assetInfo.marketPrice))
            && Number(assetInfo.marketPrice) > 0)
    );
    // Amount + unit code are kept separate so the unit can render as a
    // smaller styled span next to the digits (matches the Home total-
    // balance hero treatment). For BTC the code is the tick ticker;
    // for fiat the code is the wallet's preferred currency.
    const assetAmount = formatAmount(quantity, resolvedDivisibility);
    const fiatAmount = fiatAvailable ? formatFiatNumber(fiat, fiatCurrency) : '-';
    const showFiatPrimary = primaryUnit === 'fiat' && fiatAvailable;
    const primaryAmount = showFiatPrimary ? fiatAmount : assetAmount;
    const primaryCode = showFiatPrimary ? fiatCurrency : tick;
    const secondaryAmount = showFiatPrimary ? assetAmount : fiatAmount;
    const secondaryCode = showFiatPrimary ? tick : (fiatAvailable ? fiatCurrency : '');
    const atomicQuantity = parseAtomicQuantity(quantity);
    const sendDisabledReason = typeof onSend !== 'function'
        ? 'Send is unavailable.'
        : !walletModeReady ? 'Loading wallet…'
        : atomicQuantity == null
            ? (balanceFailed ? 'Balance is unavailable.' : 'Loading balance…')
        : atomicQuantity <= 0n ? 'No balance to send.'
        : !networkActionsAvailable ? 'Send needs a network connection.' : null;
    const receiveDisabledReason = typeof onReceive !== 'function' ? 'Receive is unavailable.' : null;
    const tradeDisabledReason = typeof onBuy !== 'function'
        ? 'Exchange is unavailable.'
        : !networkActionsAvailable ? 'Exchange needs a network connection.' : null;
    const nativePriceLoading = nativePrice.loading
        || (!nativePrice.entry && !nativePrice.disabled && !nativePrice.error);
    const tokenPriceValue = !isNative ? positiveFiniteNumber(tokenAlertRate?.rate) : null;
    const priceAlertsSupported = typeof messaging.listPriceAlertsForWallet === 'function'
        && typeof messaging.savePriceAlert === 'function'
        && typeof messaging.clearPriceAlert === 'function';
    const showPriceAlertItem = fiatSupported
        && fiatAllowed
        && priceAlertsSupported
        && Boolean(walletId)
        && (isNative
            ? !nativePrice.disabled && (nativePriceLoading || nativePriceValue !== null)
            : tokenPriceValue !== null);
    // More info holds the secondary per-asset entries; the tile stays in the
    // row even when the list is empty.
    const moreItems = [
        typeof onViewActivity === 'function' ? {
            id: 'history',
            label: 'History',
            Icon: Icon.HistoryIcon,
            onSelect: onViewActivity,
        } : null,
        showPriceAlertItem ? {
            id: 'price-alert',
            label: 'Set price alert',
            Icon: Icon.InfoIcon,
            disabled: isNative && (nativePriceLoading || nativePriceValue === null),
            onSelect: () => setRevealedExtra('price-alert'),
        } : null,
        !isNative && supplyHistory.available ? {
            id: 'supply-history',
            label: 'Supply over time',
            Icon: Icon.LineChartIcon,
            onSelect: () => setRevealedExtra('supply-history'),
        } : null,
        !isNative && (metadataLoading || hasAbout) ? {
            id: 'about',
            label: 'About',
            Icon: Icon.InfoIcon,
            onSelect: () => setRevealedExtra('about'),
        } : null,
        !isNative && (metadataLoading || hasMedia) ? {
            id: 'media',
            label: 'Media',
            Icon: Icon.CameraIcon,
            onSelect: () => setRevealedExtra('media'),
        } : null,
        !isNative && (gatedGroups === null || gatedLoading || gatedError || gatedGroups.length > 0) ? {
            id: 'gated-content',
            label: 'Gated content',
            Icon: Icon.UnlockIcon,
            onSelect: () => {
                setGatedOpen(true);
                setRevealedExtra('gated-content');
            },
        } : null,
        !isNative ? {
            id: 'holders',
            label: 'Holders',
            Icon: Icon.UsersIcon,
            onSelect: () => {
                setHoldersOpen(true);
                setRevealedExtra('holders');
            },
        } : null,
        !isNative && typeof onManageToken === 'function' && isTokenOwner ? {
            id: 'manage',
            label: 'Manage',
            Icon: Icon.GearIcon,
            onSelect: onManageToken,
        } : null,
    ].filter(Boolean);

    if (tokenMissing) {
        return (
            <Screen variant={variant} header={header}>
                <ListPage><EmptyState title="Token not found" body="It may not be indexed yet, or the name may be mistyped." /></ListPage>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                {loadFailed ? (
                    <StatusMessage variant="error">
                        Token details could not be loaded from the explorer. Try again in a moment.
                    </StatusMessage>
                ) : null}
                {/* Token balance hero: gradient block, same style as
                    Home's TotalBalanceHero. Top row carries the label and
                    the shared Balance actions menu (swap tick and fiat as
                    primary, hide the chart, hide the balance). Big number
                    = primary, small number underneath = secondary. */}
                <section className={styles.balanceHero} aria-label={`${displayName || tick} balance`}>
                    {headerIconUrl || metadataLoading ? (
                        <div className={styles.balanceHeroIconWrap}>
                            {headerIconUrl ? (
                                <AssetArtwork
                                    src={headerIconUrl}
                                    className={styles.balanceHeroIcon}
                                    fallbackClassName={styles.balanceHeroIconFallback}
                                    fallbackText={tick}
                                />
                            ) : (
                                <Skeleton
                                    shape="card"
                                    width="100%"
                                    height="100%"
                                    ariaLabel="Loading token artwork"
                                />
                            )}
                            {!isNative && chainId ? (
                                <img
                                    src={branding.chainIconSmallUrl(chainId)}
                                    alt=""
                                    aria-hidden="true"
                                    className={styles.balanceHeroChainOverlay}
                                />
                            ) : null}
                        </div>
                    ) : null}
                    <div className={styles.balanceHeroMain}>
                        <div className={styles.balanceHeroRow}>
                            <span className={styles.balanceHeroLabel}>Total balance</span>
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
                            <BalanceHeroMenu
                                className={styles.balanceHeroMenu}
                                items={[
                                    {
                                        id: 'swap',
                                        label: 'Swap primary unit',
                                        Icon: Icon.SwapIcon,
                                        onSelect: () => setPrimaryUnit((p) => (p === 'tick' ? 'fiat' : 'tick')),
                                        disabled: !fiatAvailable,
                                    },
                                    fiatSupported ? {
                                        id: 'chart',
                                        label: chartVisible ? t('components.totalBalanceHero.hideChart') : t('components.totalBalanceHero.showChart'),
                                        Icon: Icon.LineChartIcon,
                                        onSelect: toggleChartVisible,
                                        checked: chartVisible,
                                    } : null,
                                    {
                                        id: 'privacy',
                                        label: balanceHidden ? t('components.totalBalanceHero.showBalance') : t('components.totalBalanceHero.hideBalance'),
                                        Icon: balanceHidden ? Icon.EyeOffIcon : Icon.EyeIcon,
                                        onSelect: toggleBalanceHidden,
                                        checked: !balanceHidden,
                                    },
                                ]}
                            />
                        </div>
                        {!balanceHidden && fiatAvailable ? (
                            <div className={styles.balanceHeroNote}>
                                <span className={styles.balanceHeroNoteLeft}>
                                    <AutoShrinkText>
                                        {`≈ ${secondaryAmount}`}
                                        <span className={styles.balanceHeroNoteCode}>{secondaryCode}</span>
                                        {hasDexPrice ? ' · DEX price' : ''}
                                    </AutoShrinkText>
                                </span>
                                {showStaleFiatRate ? (
                                    <StalenessLabel
                                        lastSyncedAt={staleFiatRateAsOf}
                                        className={styles.balanceHeroStaleness}
                                    />
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </section>

                {/* Market section: stats strip + sparkline. Sits above
                    the quick actions and is collapsible via the chart-icon
                    button in the balance hero (same hook the Home portfolio
                    chart uses, so the toggle persists across both surfaces).
                    MarketPanel draws its own card, so an empty price history
                    can stand outside it at full width. */}
                {fiatSupported && chartVisible ? (
                    <RouteErrorBoundary
                        variant="compact"
                        resetKey={`${chainId}:${tick}:market`}
                    >
                        <MarketPanel
                            isNative={isNative}
                            nativePrice={nativePrice}
                            showNativeStats={showNativeStats}
                            isDemo={isDemo}
                            assetInfo={assetInfo}
                            tick={tick}
                            chainId={chainId}
                            hasMarketData={hasMarketData}
                            fiatRate={displayFiatRate}
                            fiatRateSource={fiatRateSource}
                            fiatCurrency={fiatCurrency}
                            loading={metadataLoading}
                            loadFailed={loadFailed}
                        />
                    </RouteErrorBoundary>
                ) : null}

                {!fiatSupported ? (
                    <p className={styles.muted}>Test coins have no value.</p>
                ) : null}

                {/* Every shell keeps these four square tiles in the same order,
                    as on Home: Send, Receive, Exchange and More info. An
                    unavailable action stays in the row with its reason under
                    the row, so the row keeps its shape between assets. */}
                <div className={styles.quickActionsGroup} role="group" aria-label="Quick actions">
                    <div className={styles.quickActions}>
                        <QuickActionTile
                            onClick={onSend}
                            disabled={Boolean(sendDisabledReason)}
                            title={sendDisabledReason || undefined}
                            aria-describedby={sendDisabledReason ? sendReasonId : undefined}
                            aria-busy="false"
                            icon={<Icon.SendIcon />}
                        >
                            Send
                        </QuickActionTile>
                        <QuickActionTile
                            onClick={onReceive}
                            disabled={Boolean(receiveDisabledReason)}
                            title={receiveDisabledReason || undefined}
                            aria-describedby={receiveDisabledReason ? receiveReasonId : undefined}
                            aria-busy="false"
                            icon={<Icon.ReceiveIcon />}
                        >
                            Receive
                        </QuickActionTile>
                        <QuickActionTile
                            onClick={onBuy}
                            disabled={Boolean(tradeDisabledReason)}
                            title={tradeDisabledReason || undefined}
                            aria-describedby={tradeDisabledReason ? tradeReasonId : undefined}
                            aria-busy="false"
                            icon={<Icon.MarketIcon />}
                        >
                            Exchange
                        </QuickActionTile>
                        <div className={styles.quickActionMoreWrap} ref={moreWrapRef}>
                            <QuickActionTile
                                ref={moreTriggerRef}
                                aria-haspopup="menu"
                                aria-expanded={moreOpen ? 'true' : 'false'}
                                aria-controls={moreOpen ? moreMenuId : undefined}
                                aria-busy="false"
                                onClick={() => setMoreOpen((open) => !open)}
                                onKeyDown={(event) => {
                                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                                    event.preventDefault();
                                    setMoreOpen(true);
                                }}
                                icon={<Icon.MoreIcon />}
                            >
                                More info
                            </QuickActionTile>
                            {moreOpen ? (
                                <div
                                    id={moreMenuId}
                                    ref={moreMenuRef}
                                    className={styles.quickActionMoreMenu}
                                    role="menu"
                                    aria-label="More info"
                                    onKeyDown={handleMoreMenuKey}
                                >
                                    {moreItems.length > 0 ? moreItems.map(({ id, label, Icon: RowIcon, onSelect, disabled }) => (
                                        <Button
                                            key={id}
                                            variant="rowAction"
                                            role="menuitem"
                                            className={styles.quickActionMoreEntry}
                                            disabled={disabled}
                                            aria-disabled={disabled ? 'true' : undefined}
                                            onClick={() => runMoreItem(onSelect)}
                                            icon={<span className={styles.quickActionMoreEntryIcon}><RowIcon /></span>}
                                        >
                                            {label}
                                        </Button>
                                    )) : (
                                        <p className={styles.moreInfoEmpty}>No more information is available.</p>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    </div>
                    {sendDisabledReason ? (
                        <p id={sendReasonId} className={styles.quickActionReason}>{sendDisabledReason}</p>
                    ) : null}
                    {receiveDisabledReason ? (
                        <p id={receiveReasonId} className={styles.quickActionReason}>{receiveDisabledReason}</p>
                    ) : null}
                    {tradeDisabledReason ? (
                        <p id={tradeReasonId} className={styles.quickActionReason}>{tradeDisabledReason}</p>
                    ) : null}
                </div>

                {revealedExtra === 'price-alert' ? (
                    <NativePriceAlertEntry
                        walletId={walletId}
                        chainId={chainId}
                        tick={isNative ? undefined : tick}
                        currentPrice={isNative ? nativePriceValue : tokenPriceValue}
                        fiatCurrency={fiatCurrency}
                        loading={isNative && nativePriceLoading}
                        disabled={!fiatAllowed || (isNative && nativePrice.disabled)}
                    />
                ) : null}

                {revealedExtra === 'supply-history' && !isNative && supplyHistory.available ? (
                    supplyHistory.loading || supplyHistory.points.length >= 2 ? (
                        <div className={`${styles.infoCard} ${styles.supplyCard}`}>
                            <RouteErrorBoundary
                                variant="compact"
                                resetKey={`${chainId}:${tick}:supply`}
                            >
                                {supplyHistory.loading ? (
                                    <Skeleton height={94} ariaLabel="Loading supply history" />
                                ) : (
                                    <SupplyChart points={supplyHistory.points} divisibility={resolvedDivisibility} tick={tick} />
                                )}
                            </RouteErrorBoundary>
                        </div>
                    ) : (
                        <EmptyState
                            title="No supply history yet"
                            body="Indexed issuance and destruction activity builds this history."
                            titleAs="p"
                        />
                    )
                ) : null}

                {revealedExtra === 'about' && !isNative ? (
                    <InfoPanel
                        isNative={false}
                        assetInfo={assetInfo}
                        loading={metadataLoading}
                        loadFailed={loadFailed}
                    />
                ) : null}

                {revealedExtra === 'media' && !isNative ? (
                    <MediaPanel
                        isNative={false}
                        assetInfo={assetInfo}
                        loading={metadataLoading}
                    />
                ) : null}

                {revealedExtra === 'gated-content' && !isNative ? (
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
                ) : null}

                {revealedExtra === 'holders' && !isNative ? (
                    <HoldersPanel
                        holderListScope={`${chainId}:${tick}`}
                        holders={holders}
                        holdersLoading={holdersLoading}
                        holdersError={holdersError}
                        holdersFetchedAt={holdersFetchedAt}
                        holdersHasMore={holdersHasMore}
                        holdersLoadingMore={holdersLoadingMore}
                        holdersMoreError={holdersMoreError}
                        holdersTotal={holdersTotal}
                        onLoadMore={loadMoreHolders}
                        divisibility={resolvedDivisibility}
                    />
                ) : null}

                {/* Coins and tokens use the same single Details tab. */}
                <Tabs
                    id={tabsId}
                    items={tabs}
                    value="details"
                    onChange={() => {}}
                    panelId={`${tabsId}-panel`}
                    aria-label="Token detail view"
                />

                        <div
                            id={`${tabsId}-panel`}
                            className={styles.tabPanel}
                            role="tabpanel"
                            aria-labelledby={`${tabsId}-tab-details`}
                        >
                            <div className={styles.infoCard}>
                                <DetailsPanel
                                    tick={tick}
                                    displayName={displayName}
                                    descriptor={descriptor}
                                    chainId={chainId}
                                    kind={kind}
                                    isNative={isNative}
                                    assetInfo={assetInfo}
                                    loading={metadataLoading}
                                    quantity={quantity}
                                    divisibility={resolvedDivisibility}
                                    fiat={fiat}
                                    fiatCurrency={fiatCurrency}
                                />
                            </div>
                        </div>

            </ListPage>
        </Screen>
    );
}

/**
 * Supply-over-time points for an issued token. The lookup is optional on the
 * messaging surface; a missing method hides the section, while a failure or
 * empty answer resolves the reserved chart space to an empty state.
 */
function useSupplyHistory({ messaging, chainId, tick, skip }) {
    const available = !skip && typeof messaging?.getSupplyHistory === 'function';
    const [points, setPoints] = useState([]);
    const [loading, setLoading] = useState(available);
    useEffect(() => {
        if (!available) {
            setPoints([]);
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        callAsync(() => messaging.getSupplyHistory({ chainId, tick }))
            .then((resp) => {
                if (cancelled) return;
                const list = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [];
                setPoints(cleanSupplyHistory(list));
            })
            .catch(() => { if (!cancelled) setPoints([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick, available]);
    return { points, loading, available };
}

const SUPPLY_CHART_MAX_POINTS = 500;

/** A history time as a sortable number, or null when the value is not a time or height. */
function historyTime(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Keeps the points with a non-negative decimal supply, orders them by time
 * when every point carries one, and thins a long history to a drawable size.
 * The exact supply text rides along for the label because a double cannot
 * hold a 20-digit supply.
 */
function cleanSupplyHistory(list) {
    let points = [];
    for (const p of list) {
        const rawSupply = p?.supply;
        let text = null;
        if (typeof rawSupply === 'string') {
            const trimmed = rawSupply.trim();
            if (/^\d+(?:\.\d+)?$/.test(trimmed)) text = trimmed;
        } else if (typeof rawSupply === 'number' && Number.isFinite(rawSupply) && rawSupply >= 0) {
            text = String(rawSupply);
        }
        if (text === null) continue;
        points.push({ at: historyTime(p?.timestamp ?? p?.height), supply: Number(text), text });
    }
    if (points.length > 1 && points.every((p) => p.at !== null)) {
        points = points
            .map((p, i) => ({ p, i }))
            .sort((a, b) => a.p.at - b.p.at || a.i - b.i)
            .map(({ p }) => p);
    }
    if (points.length > SUPPLY_CHART_MAX_POINTS) {
        const last = points.length - 1;
        points = Array.from(
            { length: SUPPLY_CHART_MAX_POINTS },
            (_, i) => points[Math.round((i * last) / (SUPPLY_CHART_MAX_POINTS - 1))],
        );
    }
    return points;
}

function SupplyChart({ points, divisibility, tick }) {
    const W = 300;
    const H = 80;
    const values = points.map((p) => p.supply);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const path = points
        .map((p, i) => {
            const x = (i / (points.length - 1)) * W;
            const y = H - ((p.supply - min) / span) * H;
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' ');
    const latest = formatTokenQuantity(points[points.length - 1].text, divisibility);
    return (
        <section aria-label="Supply over time">
            <SectionHeader title="Supply over time" />
            <svg
                className={styles.supplyChart}
                viewBox={`0 0 ${W} ${H}`}
                role="img"
                aria-label={`Supply of ${tick} over time, latest ${latest}`}
                preserveAspectRatio="none"
            >
                <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
        </section>
    );
}

/**
 * Context-first price alert panel for a coin or token. More info reveals the
 * shared PriceAlertForm pinned to this asset and prefilled with the live price.
 * Renders nothing when the shell doesn't expose the price-alert routes.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} [props.tick]
 * @param {number | null} props.currentPrice
 * @param {string} props.fiatCurrency
 * @param {boolean} props.loading
 * @param {boolean} props.disabled
 */
function NativePriceAlertEntry({ walletId, chainId, tick, currentPrice, fiatCurrency, loading, disabled }) {
    const { supported, addAlert } = usePriceAlerts(walletId);
    const [open, setOpen] = useState(true);
    const [done, setDone] = useState(false);

    if (!supported || !walletId) return null;

    if (loading) {
        return (
            <div className={`${styles.infoCard} ${styles.priceAlertCard}`}>
                <Skeleton height={28} ariaLabel="Loading price alert action" />
            </div>
        );
    }

    // Without a live price the market panel already states why; a second
    // boxed note about the same missing data adds nothing, so the entry
    // stays out until a price exists to prefill the alert.
    if (disabled || currentPrice == null) return null;

    const onCreate = async (input) => {
        await addAlert(input);
        setDone(true);
        setOpen(false);
    };

    return (
        <div className={`${styles.infoCard} ${styles.priceAlertCard}`}>
            {open ? (
                <PriceAlertForm
                    onCreate={onCreate}
                    walletId={walletId}
                    fiatCurrency={fiatCurrency}
                    lockedChainId={chainId}
                    lockedTick={tick}
                    allowCoingeckoFallback={false}
                    currentPrice={currentPrice}
                    onCancel={() => setOpen(false)}
                />
            ) : (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setOpen(true); setDone(false); }}
                >
                    {done ? 'Price alert set ✓ · Add another' : 'Set price alert'}
                </Button>
            )}
        </div>
    );
}

// Chart placeholder for real wallets: a price line is drawn only from real
// history (wallet rule: never fabricate a number), so an absent series gets
// this message instead of a synthesized walk.
const NO_PRICE_HISTORY = 'No price history yet';

function MarketPanel({ isNative, nativePrice, isDemo, assetInfo, tick, chainId, fiatRate, fiatRateSource, fiatCurrency, loading, loadFailed = false }) {
    const tabsId = useId();
    // Always render the KPI strip with the same shape. Placeholders
    // fill in for missing data so the structure stays consistent
    // whether the price oracle is disabled, still loading, or simply
    // doesn't have data for this tick (e.g. testnet, regtest).

    // Range picker: mirrors the PortfolioChart buttons on Home. Every wallet
    // opens on 1W; native coins use hourly history for 24h and 1W, then lazily
    // request daily history for longer ranges. Demo wallets synthesize every
    // range without requesting history.
    const availableRanges = CHART_RANGES;
    const [rangeId, setRangeId] = useState(defaultRangeId());
    const range = availableRanges.find((item) => item.id === rangeId) || availableRanges[0];
    // Once a daily range has been picked the daily request stays armed, so
    // moving back to 1W and out again does not reload the line.
    const [dailyArmed, setDailyArmed] = useState(false);
    useEffect(() => {
        if (range.source === 'daily') setDailyArmed(true);
    }, [range.source]);
    const wantsDailyHistory = isNative && !isDemo && Boolean(nativePrice.entry) && !nativePrice.disabled
        && (dailyArmed || range.source === 'daily');
    const dailyNativePrice = useNativePrice(wantsDailyHistory ? chainId : null, {
        includeHistory: true,
        fiatCurrency,
    });

    let priceCell = '-';
    let priceLabel = 'Price';
    let marketCapCell = '-';
    let floorCell = '-';
    let pctLabel24h;
    let pctTone24h;
    let pct24h = '-';
    let sparkline = null;
    let hint = null;
    const nativeLoading = nativePrice.loading
        || (!nativePrice.entry && !nativePrice.disabled && !nativePrice.error);
    const dailyHistoryLoading = wantsDailyHistory && range.source === 'daily' && (dailyNativePrice.loading
        || (!dailyNativePrice.entry && !dailyNativePrice.disabled && !dailyNativePrice.error));

    if (isNative) {
        // True when any range has a recorded series, so the tabs stay up even
        // while the selected range has no history of its own.
        let anyRecordedRange = false;
        if (nativePrice.disabled) {
            hint = 'Price data is disabled. Enable “Native coin price data” in Settings → Privacy to populate this section.';
        } else if (nativeLoading) {
            hint = 'Loading market data…';
        } else if (nativePrice.entry) {
            const e = dailyNativePrice.entry
                ? { ...nativePrice.entry, historyDaily: dailyNativePrice.entry.historyDaily ?? null }
                : nativePrice.entry;
            const priceFiat = positiveFiniteNumber(e.priceFiat);
            if (priceFiat !== null) priceCell = formatFiat(priceFiat, fiatCurrency);
            if (e.marketCapFiat != null) marketCapCell = formatCompactFiat(e.marketCapFiat, fiatCurrency);
            if (e.change24hPct != null && e.change24hPct !== '' && Number.isFinite(Number(e.change24hPct))) {
                const display = percentChangeDisplay(Number(e.change24hPct));
                pct24h = display?.text ?? '-';
                pctLabel24h = display?.label;
                pctTone24h = display?.direction;
            }
            const recordedHistory = priceHistoryForRange(e, range);
            anyRecordedRange = CHART_RANGES.some((item) => priceHistoryForRange(e, item) !== null);
            if (recordedHistory) {
                sparkline = recordedHistory;
            } else if (priceFiat !== null && isDemo) {
                // Demo wallets only: no real series for this range, so
                // synthesize a walk seeded by chain + change so the demo
                // chart always renders. The line still ends at the current
                // price. Real wallets fall through to the empty-state message.
                const synth = synthesizeTokenChart(
                    `${chainId}|native|${range.id}|${(e.change24hPct ?? 0).toFixed(2)}`,
                    priceFiat,
                    range.points,
                );
                sparkline = synth.sparkline;
            }
        } else {
            hint = 'No market data available for this network.';
        }
        const nativeEmpty = !nativeLoading && !dailyHistoryLoading && !sparkline && !hint && !anyRecordedRange;
        const showRanges = Boolean(sparkline) || anyRecordedRange;
        return (
            <div className={`${styles.infoCard} ${styles.marketCardOffset}`}>
                <section className={styles.stats}>
                    <StatCell label="Price" value={priceCell} />
                    <StatCell label="Market cap" value={marketCapCell} />
                    <StatCell label="24h" value={pct24h} valueLabel={pctLabel24h} tone={pctTone24h} />
                </section>
                <div className={styles.marketHistorySlot}>
                    {nativeLoading ? (
                        <Skeleton height={64} ariaLabel="Loading price history" />
                    ) : showRanges ? (
                        <>
                            <div
                                id={`${tabsId}-panel`}
                                role="tabpanel"
                                aria-labelledby={`${tabsId}-tab-${rangeId}`}
                                aria-busy={dailyHistoryLoading || undefined}
                            >
                                {/* A daily range loading its history keeps the tabs in place
                                    (and the focused tab with them); only the line waits. */}
                                {dailyHistoryLoading ? (
                                    <Skeleton height={40} ariaLabel="Loading price history" />
                                ) : sparkline ? (
                                    <div className={styles.chart} aria-label={`${range.label} price chart`}>
                                        <Sparkline series={sparkline} height={40} rangeLabel={range.label} />
                                    </div>
                                ) : (
                                    <p className={styles.marketHistoryMessage}>{NO_PRICE_HISTORY}</p>
                                )}
                            </div>
                            <div className={portfolioChartStyles.ranges} role="tablist" aria-label="Chart range">
                                {availableRanges.map((r) => (
                                    // A native button preserves tab semantics and roving tab focus, which Button does not provide.
                                    <button
                                        key={r.id}
                                        id={`${tabsId}-tab-${r.id}`}
                                        type="button"
                                        role="tab"
                                        aria-selected={r.id === rangeId ? 'true' : 'false'}
                                        aria-controls={`${tabsId}-panel`}
                                        tabIndex={r.id === rangeId ? 0 : -1}
                                        className={`${portfolioChartStyles.range} ${r.id === rangeId ? portfolioChartStyles.rangeActive : ''}`}
                                        onClick={() => setRangeId(r.id)}
                                    >
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className={styles.marketHistoryMessage}>
                            {nativeEmpty ? 'No market data available for this network.' : hint}
                        </p>
                    )}
                </div>
            </div>
        );
    }

    // Token path: try assetInfo.marketPrice first (XCP-denominated
    // price from the indexer); if unavailable, fall back to fiatRate
    // passed in from the balance fixture so the demo wallet still
    // gets a populated chart + 24h cell. Both paths feed into the
    // same synthesized sparkline keyed on tick+chain.
    void floorCell;
    const nativeTick = nativeTickerOf(chainId);
    const marketPriceNum = assetInfo?.marketPrice != null ? Number(assetInfo.marketPrice) : null;
    if (marketPriceNum != null && Number.isFinite(marketPriceNum) && marketPriceNum > 0) {
        priceLabel = 'Price (DEX)';
        // The record carries the price as a number, which prints a small one in
        // exponent form (1.5e-9) and leaves the decimal product below without
        // a market cap, so both read the expanded decimal.
        const marketPriceText = expandDecimalNotation(String(assetInfo.marketPrice));
        priceCell = `${formatDecimalAmount(marketPriceText, undefined, priceDigits(marketPriceText))} ${nativeTick}`;
        if (assetInfo.totalSupply != null) {
            const supply = String(assetInfo.totalSupply).replace(/[,_]/g, '');
            const marketCap = multiplyDecimalStrings(marketPriceText, supply);
            if (marketCap !== null) {
                const formatted = formatDecimalAmount(marketCap, undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 4,
                });
                marketCapCell = `${formatted} ${nativeTick}`;
            }
        }
        if (isDemo) {
            const synth = synthesizeTokenChart(`${chainId}|${tick}|native|${range.id}`, marketPriceNum, range.points);
            if (synth.change24hPct != null) {
                const display = percentChangeDisplay(synth.change24hPct);
                pct24h = display?.text ?? '-';
                pctLabel24h = display?.label;
                pctTone24h = display?.direction;
            }
            sparkline = synth.sparkline;
        }
    } else if (typeof fiatRate === 'number' && isFinite(fiatRate) && fiatRate > 0) {
        if (fiatRateSource === 'market') priceLabel = 'Price (DEX)';
        priceCell = formatFiat(fiatRate, fiatCurrency);
        if (isDemo) {
            const synth = synthesizeTokenChart(`${chainId}|${tick}|fiat|${range.id}`, fiatRate, range.points);
            if (synth.change24hPct != null) {
                const display = percentChangeDisplay(synth.change24hPct);
                pct24h = display?.text ?? '-';
                pctLabel24h = display?.label;
                pctTone24h = display?.direction;
            }
            sparkline = synth.sparkline;
        }
    } else if (!assetInfo) {
        hint = 'Market data is unavailable.';
    }

    const tokenEmpty = !loading && !sparkline;
    return (
        <div className={`${styles.infoCard} ${styles.marketCardOffset}`}>
            <section className={styles.stats}>
                <StatCell label={priceLabel} value={priceCell} />
                <StatCell label="Market cap" value={marketCapCell} />
                <StatCell label="24h" value={pct24h} valueLabel={pctLabel24h} tone={pctTone24h} />
            </section>
            <div className={styles.marketHistorySlot}>
                {loading ? (
                    <Skeleton height={64} ariaLabel="Loading price history" />
                ) : tokenEmpty ? (
                    <p className={styles.marketHistoryMessage}>
                        {loadFailed ? (hint || 'Market data is unavailable.') : NO_PRICE_HISTORY}
                    </p>
                ) : (
                    <div
                        id={`${tabsId}-panel`}
                        role="tabpanel"
                        aria-labelledby={`${tabsId}-tab-${rangeId}`}
                    >
                        <div className={styles.chart} aria-label={`${range.label} price chart`}>
                            <Sparkline series={sparkline} height={40} rangeLabel={range.label} />
                        </div>
                    </div>
                )}
                {sparkline && isDemo ? (
                    <div className={portfolioChartStyles.ranges} role="tablist" aria-label="Chart range">
                        {CHART_RANGES.map((r) => (
                            // A native button preserves tab semantics and roving tab focus, which Button does not provide.
                            <button
                                key={r.id}
                                id={`${tabsId}-tab-${r.id}`}
                                type="button"
                                role="tab"
                                aria-selected={r.id === rangeId ? 'true' : 'false'}
                                aria-controls={`${tabsId}-panel`}
                                tabIndex={r.id === rangeId ? 0 : -1}
                                className={`${portfolioChartStyles.range} ${r.id === rangeId ? portfolioChartStyles.rangeActive : ''}`}
                                onClick={() => setRangeId(r.id)}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
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
    loading,
    quantity,
    divisibility,
    fiat,
    fiatCurrency,
}) {
    const [balanceHidden] = useBalancesHidden();
    return (
        <div
            className={styles.infoStack}
            role="region"
            aria-label="Token details"
            aria-busy={loading || undefined}
        >
            <ul className={styles.detailList} aria-label="Token detail fields">
                {!isNative && detailText(assetInfo?.description) !== '-' ? (
                    <DetailRow label="Description">
                        <span className={styles.descriptionValue}>{detailText(assetInfo.description)}</span>
                    </DetailRow>
                ) : null}
                <DetailRow label="Name">{displayName || tick}</DetailRow>
                <DetailRow label="Ticker">
                    <BridgeOriginTick tick={tick} localCoin={coinFromChainId(chainId)} />
                </DetailRow>
                {/* A bridged copy is a claim on an asset held in escrow on
                    another chain, and its holder should be able to read that
                    off the page rather than infer it from a dot in the
                    ticker. Native rows have no origin to name and get no
                    row at all. */}
                {parseBridgedTick(tick, coinFromChainId(chainId)) ? (
                    <DetailRow label="Origin">
                        {`Native to ${coinDisplay(parseBridgedTick(tick, coinFromChainId(chainId)).origin)}`
                            + `, bridged here as ${tick}`}
                    </DetailRow>
                ) : null}
                <DetailRow label="Type">{kindLabel(kind)}</DetailRow>
                {descriptor ? (
                    <DetailRow label="Network"><ChainBadge descriptor={descriptor} size="sm" /></DetailRow>
                ) : null}
                {!isNative ? (
                    <DetailRow label="Divisibility">{detailText(divisibility)}</DetailRow>
                ) : null}
                <DetailRow label={<span>Total supply</span>}>
                    <span>
                        {formatTotalSupply(isNative, chainId, assetInfo, divisibility)}
                        {!isNative && typeof assetInfo?.locked === 'boolean' ? (
                            <span className={styles.supplyState}>
                                {assetInfo.locked ? 'Locked supply' : 'Unlocked supply'}
                            </span>
                        ) : null}
                    </span>
                </DetailRow>
                <DetailRow label="Current balance">
                    {balanceHidden ? '•••••' : amountWithUnit(quantity, divisibility, tick)}
                </DetailRow>
                <DetailRow label="Estimated value">
                    {balanceHidden
                        ? '•••••'
                        : fiat == null
                            ? '-'
                            : `${formatFiatNumber(fiat, fiatCurrency)} ${(fiatCurrency || 'USD').toUpperCase()}`}
                </DetailRow>
                {!isNative ? (
                    <DetailRow label={<span>Creator</span>}>
                        {loading ? (
                            <Skeleton shape="text" width="70%" height={20} />
                        ) : detailText(assetInfo?.creator) !== '-' ? (
                            <span className={styles.copyableValue}>
                                <AddressText address={assetInfo.creator} className={styles.creatorCell} />
                                <CopyButton value={assetInfo.creator} ariaLabel="Copy creator address" />
                            </span>
                        ) : '-'}
                    </DetailRow>
                ) : null}
                {!isNative && Array.isArray(assetInfo?.projects) && assetInfo.projects.length > 0 ? (
                    <DetailRow label="Projects">{assetInfo.projects.join(', ')}</DetailRow>
                ) : null}
                {!isNative ? (
                    <DetailRow label={<span>Status</span>}>
                        {loading ? (
                            <Skeleton shape="text" width="40%" height={20} />
                        ) : assetInfo?.locked == null ? (
                            '-'
                        ) : assetInfo.locked ? (
                            <span className={styles.lockedFlag}>Locked</span>
                        ) : (
                            <span className={styles.unlockedFlag}>Mutable</span>
                        )}
                    </DetailRow>
                ) : null}
            </ul>
        </div>
    );
}

function DetailRow({ label, children }) {
    return (
        <li>
            <ListRow className={styles.detailRow} title={label} trailing={children} />
        </li>
    );
}

function hasSupplementalTokenInfo(assetInfo) {
    if (!assetInfo) return false;
    const linkTargets = tokenLinkTargets(assetInfo);
    return Boolean(
        (assetInfo.owner && (assetInfo.owner.name || assetInfo.owner.title || assetInfo.owner.organization))
        || (Array.isArray(assetInfo.contacts) && assetInfo.contacts.length > 0)
        || (Array.isArray(assetInfo.categories) && assetInfo.categories.length > 0)
        || linkTargets.websites.length > 0
        || linkTargets.socials.length > 0
        || (Array.isArray(assetInfo.dns) && assetInfo.dns.length > 0)
        || assetInfo.pgpsig
    );
}

// Supplemental TIS metadata selected from More info. The description stays
// in Details so the primary page remains useful without opening this panel.
function InfoPanel({ isNative, assetInfo, loading, loadFailed = false }) {
    if (isNative) {
        return (
            <EmptyState
                title="Native coin"
                titleAs="p"
                body="Token-information documents apply only to XChain-issued tokens."
            />
        );
    }
    if (loading) {
        return (
            <div className={styles.infoCard} role="status" aria-label="Loading token information" aria-busy="true">
                <Skeleton.List rows={3} rowHeight={48} avatar={false} />
            </div>
        );
    }
    // The page-level notice already says the read failed; an empty-state here
    // would claim the issuer published nothing.
    if (loadFailed && (!assetInfo || assetInfo.loadError)) return null;
    if (!assetInfo) {
        return (
            <EmptyState
                title="No additional information"
                body="Information published by the token issuer appears here."
                titleAs="p"
            />
        );
    }
    const linkTargets = tokenLinkTargets(assetInfo);
    const hasLinks = linkTargets.websites.length > 0 || linkTargets.socials.length > 0;
    const hasOwner = Boolean(assetInfo.owner
        && (assetInfo.owner.name || assetInfo.owner.title || assetInfo.owner.organization));
    const hasContacts = Array.isArray(assetInfo.contacts) && assetInfo.contacts.length > 0;
    const hasCategories = Array.isArray(assetInfo.categories) && assetInfo.categories.length > 0;
    const hasPgpsig = Boolean(assetInfo.pgpsig);
    const hasDns = Array.isArray(assetInfo.dns) && assetInfo.dns.length > 0;
    const hasAbout = hasOwner
        || hasContacts
        || hasCategories
        || hasLinks
        || hasDns
        || hasPgpsig;
    if (!hasAbout) {
        return (
            <EmptyState
                title="No additional information"
                body="Information published by the token issuer appears here."
                titleAs="p"
            />
        );
    }
    return (
        <div className={`${styles.infoCard} ${styles.aboutCard}`}>
            {hasOwner ? <OwnerBlock owner={assetInfo.owner} /> : null}
            {hasCategories ? <CategoriesBlock categories={assetInfo.categories} /> : null}
            {hasContacts ? <ContactsBlock contacts={assetInfo.contacts} /> : null}
            {hasLinks ? (
                <div className={styles.metaBlock}>
                    <SectionHeader title="Links" />
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
            <SectionHeader title="DNS" />
            <table className={styles.metaTable} aria-label="DNS records">
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

function tokenMediaBuckets(assetInfo) {
    const images = Array.isArray(assetInfo?.images)
        ? assetInfo.images.filter((i) => {
            const mediaType = String(i?.type || '').toLowerCase();
            return safeHttpUrl(i?.url)
                && (mediaType === 'large' || mediaType === 'hires' || mediaType === 'hi-res' || mediaType === 'highres');
        })
        : [];
    const audio = Array.isArray(assetInfo?.audio)
        ? assetInfo.audio.filter((entry) => safeHttpUrl(entry?.url))
        : [];
    const video = Array.isArray(assetInfo?.video)
        ? assetInfo.video.filter((entry) => safeHttpUrl(entry?.url))
        : [];
    const files = Array.isArray(assetInfo?.files)
        ? assetInfo.files.filter((entry) => safeHttpUrl(entry?.url))
        : [];
    return { images, audio, video, files };
}

function hasPublishedMedia(assetInfo) {
    const media = tokenMediaBuckets(assetInfo);
    return media.images.length > 0 || media.audio.length > 0 || media.video.length > 0 || media.files.length > 0;
}

// Images, audio, video, and files published with the token's TIS document,
// selected from More info.
function MediaPanel({ isNative, assetInfo, loading }) {
    const tabsId = useId();
    // Only large + hires images count toward the Image surface (icon
    // and standard buckets render in the page header instead). We
    // derive the buckets unconditionally so the React hook below can
    // observe them, then decide what to render below based on
    // isNative / assetInfo state.
    const { images, audio, video, files } = tokenMediaBuckets(assetInfo);
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
    const selectedSubtab = subtabs.some((t) => t.id === activeSubtab)
        ? activeSubtab
        : subtabs[0]?.id;

    if (isNative) {
        return (
            <EmptyState title="No attached media" titleAs="p" body="Native coins don't carry attached media." />
        );
    }
    if (loading) {
        return (
            <div className={styles.infoCard} role="status" aria-label="Loading token media" aria-busy="true">
                <Skeleton height={144} />
            </div>
        );
    }
    if (!assetInfo) {
        return (
            <EmptyState
                title="No published media"
                body="Images, audio, video, and files published for this token appear here."
                titleAs="p"
            />
        );
    }
    if (subtabs.length === 0) {
        return (
            <EmptyState
                title="No published media"
                body="Images, audio, video, and files published for this token appear here."
                titleAs="p"
            />
        );
    }
    // Single media type. No need for a subtab strip; render directly.
    if (subtabs.length === 1) {
        return <MediaSubpanel kind={subtabs[0].id} images={images} audio={audio} video={video} files={files} />;
    }
    return (
        <div className={styles.mediaPanel}>
            <div className={styles.subtabs} role="tablist" aria-label="Token media">
                {subtabs.map((t) => (
                    // A native button preserves tab semantics and roving tab focus, which Button does not provide.
                    <button
                        key={t.id}
                        id={`${tabsId}-tab-${t.id}`}
                        type="button"
                        role="tab"
                        aria-selected={selectedSubtab === t.id ? 'true' : 'false'}
                        aria-controls={`${tabsId}-panel`}
                        tabIndex={selectedSubtab === t.id ? 0 : -1}
                        className={`${styles.subtab} ${selectedSubtab === t.id ? styles.subtabActive : ''}`}
                        onClick={() => setActiveSubtab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div
                id={`${tabsId}-panel`}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${selectedSubtab}`}
            >
                <MediaSubpanel kind={selectedSubtab} images={images} audio={audio} video={video} files={files} />
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
            // The kit has no file-list primitive, so native list semantics group these file links.
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
                            <span aria-hidden="true">↗</span>
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
            <SectionHeader title="Owner" />
            <table className={styles.metaTable} aria-label="Token owner">
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

// A plain address only: a query or fragment after it would add recipients or a body to the draft.
const PLAIN_EMAIL = /^[^\s@?&#:,;<>()"']+@[^\s@?&#:,;<>()"']+\.[^\s@?&#:,;<>()"']+$/;

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
            <SectionHeader title="Contact" />
            <table className={styles.metaTable} aria-label="Token contacts">
                <tbody>
                    {contacts.map((c, i) => {
                        const label = CONTACT_LABELS[c.type] || (c.type.charAt(0).toUpperCase() + c.type.slice(1));
                        const isMail = c.type === 'email' && PLAIN_EMAIL.test(c.value);
                        const isPhone = c.type === 'phone';
                        const safeUrl = safeHttpUrl(c.value);
                        let display = c.value;
                        if (isMail) {
                            display = <a href={`mailto:${c.value}`}>{c.value}</a>;
                        } else if (isPhone) {
                            display = <a href={`tel:${c.value.replace(/[^+\d]/g, '')}`}>{c.value}</a>;
                        } else if (safeUrl) {
                            display = (
                                <a href={safeUrl} target="_blank" rel="noreferrer noopener">
                                    {c.value} <span aria-hidden="true">↗</span>
                                </a>
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
            <SectionHeader title="Categories" />
            <table className={styles.metaTable} aria-label="Token categories">
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
            <SectionHeader title="PGP signature" />
            <pre className={styles.pgpsigBlock} tabIndex={0}>{pgpsig}</pre>
        </div>
    );
}

function ImageHero({ img }) {
    const [failedImageUrl, setFailedImageUrl] = useState(null);
    const safeUrl = safeHttpUrl(img.url);
    const failed = !safeUrl || failedImageUrl === safeUrl;
    const media = failed ? (
        <div
            className={styles.heroImageFallback}
            role="img"
            aria-label={`${img.name || 'Token media'} unavailable`}
        >
            Image unavailable
        </div>
    ) : (
        <a
            href={safeUrl}
            target="_blank"
            rel="noreferrer noopener"
            className={styles.heroImageLink}
            aria-label={img.name ? `Open image ${img.name}` : 'Open token image'}
            title={img.name || ''}
        >
            <img
                src={safeUrl}
                alt={img.name || ''}
                className={styles.heroImage}
                loading="lazy"
                decoding="async"
                style={{ aspectRatio: '1 / 1' }}
                onError={() => setFailedImageUrl(safeUrl)}
            />
            <span aria-hidden="true">↗</span>
        </a>
    );
    if (img.name) {
        return (
            <div className={styles.galleryMediaCard}>
                <div className={styles.galleryMediaCaption}>{img.name}</div>
                {media}
            </div>
        );
    }
    return media;
}

function AssetArtwork({ src, className, fallbackClassName, fallbackText }) {
    const [failedImageUrl, setFailedImageUrl] = useState(null);
    if (failedImageUrl === src) {
        return (
            <span className={fallbackClassName} aria-hidden="true">
                {String(fallbackText || '?').slice(0, 2)}
            </span>
        );
    }
    return (
        <img
            src={src}
            alt=""
            aria-hidden="true"
            className={className}
            onError={() => setFailedImageUrl(src)}
        />
    );
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
 * §27.6: links + files block. Renders the token's website, primary
 * social links, and file attachments below the media gallery. Returns
 * null when the TIS document carries none of these so the section
 * disappears entirely for tokens without rich metadata.
 */
function tokenLinkTargets(assetInfo) {
    // Prefer the `websites` array (primary + alternates) but fall back to
    // the singular `website` field for older bundles that haven't been
    // re-normalized. Files live in the Media panel's Files subtab now;
    // they're not rendered here.
    const websiteCandidates = Array.isArray(assetInfo?.websites) && assetInfo.websites.length > 0
        ? assetInfo.websites
        : (assetInfo?.website ? [assetInfo.website] : []);
    const websites = websiteCandidates.map(safeHttpUrl).filter(Boolean);
    const socials = Array.isArray(assetInfo?.socials)
        ? assetInfo.socials.flatMap((social) => {
            const url = safeHttpUrl(social?.url);
            return url ? [{ ...social, url }] : [];
        })
        : [];
    return { websites, socials };
}

/** The host a link opens, as the browser resolves it (punycode exposes look-alike letters). */
function linkHost(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

function LinksAndFiles({ assetInfo }) {
    const { websites, socials } = tokenLinkTargets(assetInfo);
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
                            <span>
                                {multipleWebsites ? `Website ${i + 1}` : 'Website'} · {linkHost(w)}
                            </span>
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
                            {socialLabel(s.platform)} · {s.host}
                            <span aria-hidden="true">↗</span>
                        </a>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

// Native-coin total supplies are well-known constants; no oracle call
// needed. Tokens read from assetInfo (XCP indexer).
const NATIVE_SUPPLY_BY_COIN = {
    bitcoin: '21,000,000 BTC',
    litecoin: '84,000,000 LTC',
    dogecoin: 'No cap (inflationary)',
};

function formatTotalSupply(isNative, chainId, assetInfo, divisibility) {
    if (isNative) {
        const coin = chainId.split('-')[0];
        return NATIVE_SUPPLY_BY_COIN[coin] || '-';
    }
    const totalSupply = detailText(assetInfo?.totalSupply);
    if (totalSupply === '-') return totalSupply;
    const total = formatTokenQuantity(totalSupply, divisibility);
    const maxSupply = detailText(assetInfo?.maxSupply);
    return maxSupply === '-' ? total : `${total} / ${formatTokenQuantity(maxSupply, divisibility)}`;
}

function detailText(value) {
    if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return '-';
    const text = String(value).trim();
    return !text || /^(?:undefined|null|nan)$/i.test(text) ? '-' : text;
}

// Token-gated content panel: renders the list of gated FILEs published
// for this token, grouped by KEY_HASH so packs (multi-file shares-one-key
// drops) appear as a single header with member files underneath. Each
// group has an Unlock button that pops an inline form (pick address,
// enter password) and decrypts every file in the group; viewers render
// inline for text / JSON / images and as a download link for everything
// else. See xchain-documentation/protocol/token-gated-content.md.
function GatedContentPanel({ walletId, chainId, tick, groups, loading, error, packsMeta, messaging, ownsToken, displayName }) {
    const [addresses, setAddresses] = useState(/** @type {any[] | null} */ (null));
    const [addressesError, setAddressesError] = useState(/** @type {string | null} */ (null));
    const [addressesLoading, setAddressesLoading] = useState(false);

    // Load the user's addresses for this chain on demand; only fired
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
        callAsync(() => messaging.getAddressesByChain(walletId))
            .then((byChain) => {
                const list = (byChain && byChain[chainId]) ? byChain[chainId] : [];
                const usable = list.filter((a) => a.source === 'hd' || a.source === 'imported-wif');
                setAddresses(usable);
                if (usable.length === 0) {
                    setAddressesError('No unlockable addresses for this network. Holders need an HD or imported-WIF address that holds the token.');
                }
            })
            .catch((err) => setAddressesError(err?.message || 'Failed to load addresses.'))
            .finally(() => setAddressesLoading(false));
    }, [addresses, addressesLoading, messaging, walletId, chainId]);

    if (loading) return <p className={styles.muted}>Loading gated content…</p>;
    if (error) return <StatusMessage variant="error" className={styles.error}>{error}</StatusMessage>;
    if (!groups || groups.length === 0) {
        return (
            <EmptyState
                title="No token-gated content"
                body="Holders unlock creator drops, packs, and sealed bundles here when the issuer publishes locked content for this token."
                titleAs="p"
            />
        );
    }
    return (
        <div className={styles.infoCard}>
            {/* PC-26: the send-side constraints, stated where holders learn
                the token is gated. Key handoff is Send-only and needs the
                recipient's on-chain pubkey. */}
            <p className={styles.muted}>
                Sending {tick} hands the unlock key to the recipient automatically,
                but only through a direct Send, and only to addresses that have made
                at least one transaction. Tokens received via airdrops, dispensers,
                trades, or dividends arrive without the key.
            </p>
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
                        chainId={chainId}
                        tick={tick}
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
    chainId,
    tick,
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
    /** @type {[{ name: string, declaredType: string | null, plaintextBase64: string } | null, Function]} */
    const [viewer, setViewer] = useState(null);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const fileOpenBusyRef = useRef(false);

    const passwordOpen = pendingFile !== null;

    useEffect(() => {
        if (passwordOpen && !submitting) {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [passwordOpen, submitting]);

    // PC-27: unlocked plaintext is attacker-controlled bytes, so it never
    // leaves this page as a document. The GatedFileViewer modal sniffs
    // the bytes and renders only through script-inert surfaces; the
    // declared file.type is passed for labeling/mismatch-warning only.
    function openFile(plain, file) {
        if (!plain) return;
        setViewer({
            name: file.name || `Action #${file.actionIndex}`,
            declaredType: file.type || null,
            plaintextBase64: plain.plaintextBase64,
        });
    }

    async function handleFileClick(file) {
        setAccessError(null);
        if (!ownsToken) {
            // PC-29: a file may declare an unlock threshold (GATE_MIN_AMOUNT);
            // name it in the copy so the requirement is honest. The real
            // enforcement is the key handoff itself - like the gate, a
            // threshold is a first-access lock, not a balance check here.
            const need = file.gateMinAmount ? `at least ${file.gateMinAmount}` : 'at least 1';
            setAccessError(
                `You need to hold ${need} ${tokenLabel} to view this content. Pick one up on a marketplace, or import a wallet that already holds one.`,
            );
            return;
        }
        const plain = unlocked.get(String(file.actionIndex));
        if (plain) {
            openFile(plain, file);
            return;
        }
        if (fileOpenBusyRef.current) return;
        fileOpenBusyRef.current = true;
        setSubmitting(true);
        // Demo content: the backend short-circuit (flows/gatedContent.js)
        // returns hardcoded plaintext for `demo:` action indices without
        // touching the vault, so we can unlock the whole group inline
        // without a password prompt or address picker.
        if (isDemoGatedActionIndex(file.actionIndex)) {
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
                fileOpenBusyRef.current = false;
                setSubmitting(false);
            }
            return;
        }
        // Real content, vault-first (PC-27): a pack key persisted at
        // publish time or by a prior recovery scan unlocks with no
        // password prompt - decryption is pure AES host-side, and the
        // gatedKeys row is only readable while the wallet session is
        // unlocked. Any failure here falls through to the password flow.
        if (typeof messaging.listGatedKeys === 'function') {
            let vaultHeld = false;
            try {
                const rows = await messaging.listGatedKeys({ walletId, chainId, gateTicker: tick });
                const want = String(group.keyHash).toLowerCase();
                vaultHeld = Array.isArray(rows)
                    && rows.some((r) => String(r?.keyHash || '').toLowerCase() === want);
            } catch (_e) {
                vaultHeld = false;
            }
            if (vaultHeld && !submitting) {
                setSubmitting(true);
                try {
                    const results = new Map(unlocked);
                    for (const f of group.files) {
                        if (results.has(String(f.actionIndex))) continue;
                        const resp = await messaging.unlockGatedContent({
                            walletId,
                            actionIndex: f.actionIndex,
                            keyHash: group.keyHash,
                            gateTicker: tick,
                            chainId,
                        });
                        results.set(String(f.actionIndex), {
                            plaintextBase64: resp.plaintextBase64,
                            byteLength: resp.byteLength,
                        });
                    }
                    setUnlocked(results);
                    const target = results.get(String(file.actionIndex));
                    if (target) openFile(target, file);
                    return;
                } catch (_e) {
                    // Vault row unusable (stale, explorer down, ...):
                    // fall through to the password-gated scan path.
                } finally {
                    fileOpenBusyRef.current = false;
                    setSubmitting(false);
                }
            }
        }
        // Password prompt path. The holding address is discovered
        // automatically on submit (handleUnlock iterates the user's
        // addresses to find whichever one received the seller's key
        // handoff for this group's KEY_HASH).
        fileOpenBusyRef.current = false;
        setSubmitting(false);
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
            setUnlockError('No usable holding address found for this network.');
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
                            // PC-27: lets the host persist the scan-recovered
                            // key into the vault, so the next unlock skips
                            // the password entirely.
                            gateTicker: tick,
                            chainId,
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
                        gateTicker: tick,
                        chainId,
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
                setUnlockError('Ciphertext not available from the explorer yet. Try again in a moment.');
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
            <SectionHeader title={heading} description={description} />
            {/* The kit has no file-list primitive, so native list semantics group these file actions. */}
            <ul className={styles.filesList}>
                {group.files.map((f) => {
                    const plain = unlocked.get(String(f.actionIndex));
                    if (plain) {
                        return (
                            <li key={f.actionIndex}>
                                <UnlockedFileLink
                                    name={f.name || `Action #${f.actionIndex}`}
                                    type={f.type}
                                    onOpen={() => openFile(plain, f)}
                                />
                            </li>
                        );
                    }
                    return (
                        <li key={f.actionIndex}>
                            <Button
                                onClick={() => handleFileClick(f)}
                                disabled={submitting}
                                aria-busy={submitting}
                                className={`${styles.fileLink} ${styles.fileButton}`}
                                style={{
                                    cursor: 'pointer',
                                    font: 'inherit',
                                    width: '100%',
                                    textAlign: 'left',
                                    opacity: ownsToken ? 1 : 0.65,
                                }}
                                aria-label={ownsToken
                                    ? `Unlock and open ${f.name || 'gated file'}`
                                    : `Locked: purchase required to access ${f.name || 'gated file'}`}
                                icon={null}
                            >
                                <span className={styles.fileLinkContent}>
                                    <span className={styles.fileLinkIcon} aria-hidden="true">
                                        <Icon.FileTypeIcon type={f.type} />
                                    </span>
                                    <span className={styles.fileLinkName}>{f.name || `Action #${f.actionIndex}`}</span>
                                    {f.type ? (
                                        <span className={styles.fileLinkType}>{f.type}</span>
                                    ) : null}
                                    {f.gateMinAmount ? (
                                        <span className={styles.fileLinkType}>
                                            hold ≥ {f.gateMinAmount} {tick} to unlock
                                        </span>
                                    ) : null}
                                </span>
                            </Button>
                        </li>
                    );
                })}
            </ul>
            <StatusMessage variant="error">{accessError}</StatusMessage>
            {passwordOpen ? (
                <form onSubmit={handleUnlock} noValidate style={{ marginTop: 'var(--xc-space-3)' }}>
                    {addressesLoading ? (
                        <p className={styles.muted}>Loading addresses…</p>
                    ) : addressesError ? (
                        <StatusMessage variant="error" className={styles.error}>{addressesError}</StatusMessage>
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
                        error={unlockError || undefined}
                    />
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
            {viewer ? (
                <GatedFileViewer
                    name={viewer.name}
                    declaredType={viewer.declaredType}
                    plaintextBase64={viewer.plaintextBase64}
                    onClose={() => setViewer(null)}
                />
            ) : null}
        </div>
    );
}

// Unlocked file rendered as the same colored full-width button used in
// the Media → Files section. Click opens the GatedFileViewer modal
// (PC-27): the plaintext is attacker-controlled, so it is never exposed
// as a blob href or new-tab document from here - the viewer sniffs the
// bytes and renders through script-inert surfaces only, with download
// as the fallback. The declared `type` is cosmetic (icon + chip).
function UnlockedFileLink({ name, type, onOpen }) {
    return (
        <Button
            onClick={onOpen}
            className={`${styles.fileLink} ${styles.fileButton}`}
            style={{
                cursor: 'pointer',
                font: 'inherit',
                width: '100%',
                textAlign: 'left',
            }}
            aria-label={`Open unlocked file ${name}`}
            icon={null}
        >
            <span className={styles.fileLinkContent}>
                <span className={styles.fileLinkIcon} aria-hidden="true">
                    <Icon.FileTypeIcon type={type} />
                </span>
                <span className={styles.fileLinkName}>{name}</span>
                {type ? (
                    <span className={styles.fileLinkType}>{type}</span>
                ) : null}
            </span>
        </Button>
    );
}

function HoldersPanel({
    holderListScope,
    holders,
    holdersLoading,
    holdersError,
    holdersFetchedAt,
    holdersHasMore,
    holdersLoadingMore,
    holdersMoreError,
    holdersTotal,
    onLoadMore,
    divisibility,
}) {
    const [holderWindow, setHolderWindow] = useState(() => ({
        scope: '',
        count: HOLDER_WINDOW_SIZE,
    }));
    const visibleHolderCount = holderWindow.scope === holderListScope
        ? holderWindow.count
        : HOLDER_WINDOW_SIZE;

    if (holdersLoading) return <p className={styles.muted}>Loading holders…</p>;
    if (holdersError) return <StatusMessage variant="error" className={styles.error}>{holdersError}</StatusMessage>;
    if (!holders || holders.length === 0) {
        return <EmptyState title="No holders yet" body="Mint or distribute supply to populate this list." titleAs="p" />;
    }
    const count = holdersTotal != null && holdersTotal > holders.length
        ? `${holders.length} of ${holdersTotal}`
        : String(holders.length);
    const renderedHolders = holders.slice(0, visibleHolderCount);
    const showMoreLoadedHolders = () => {
        setHolderWindow((current) => ({
            scope: holderListScope,
            count: Math.min(
                holders.length,
                (current.scope === holderListScope ? current.count : HOLDER_WINDOW_SIZE)
                    + HOLDER_WINDOW_SIZE,
            ),
        }));
    };
    return (
        <section className={styles.infoCard} aria-label="Holders">
            <SectionHeader title={`Holders (${count})`} />
            {holdersFetchedAt ? (
                <div className={styles.holdersStaleness}>
                    <StalenessLabel lastSyncedAt={holdersFetchedAt} warnAfterMs={10 * 60_000} />
                </div>
            ) : null}
            <ul className={styles.holdersList} aria-label="Holder balances">
                {renderedHolders.map((h, i) => {
                    const address = holderAddress(h);
                    const balance = formatHolderBalance(h, divisibility);
                    return (
                        <li key={holderIdentity(h) || `holder:${i}`}>
                            <ListRow
                                className={styles.holdersRow}
                                title={(
                                    <span className={styles.holdersAddrWrap}>
                                        {address === '-' ? (
                                            <span className={styles.holdersAddr}>-</span>
                                        ) : (
                                            <AddressText address={address} className={styles.holdersAddr} />
                                        )}
                                        {address !== '-' ? (
                                            <CopyButton
                                                value={address}
                                                ariaLabel={`Copy holder address ${i + 1}`}
                                            />
                                        ) : null}
                                    </span>
                                )}
                                trailing={<span className={styles.holdersQty}>{balance}</span>}
                                trailingClassName={styles.holdersTrailing}
                            />
                        </li>
                    );
                })}
            </ul>
            {holdersMoreError ? (
                <StatusMessage variant="error" className={styles.error}>{holdersMoreError}</StatusMessage>
            ) : null}
            {visibleHolderCount < holders.length ? (
                <Button type="button" variant="secondary" onClick={showMoreLoadedHolders}>
                    Show more holders ({Math.min(visibleHolderCount, holders.length).toLocaleString('en-US')} of {holders.length.toLocaleString('en-US')} shown)
                </Button>
            ) : holdersHasMore ? (
                <Button type="button" variant="secondary" loading={holdersLoadingMore} onClick={onLoadMore}>
                    Load more holders
                </Button>
            ) : null}
        </section>
    );
}

function holderIdentity(holder) {
    return holder?.address ?? holder?.ADDRESS ?? null;
}

function holderAddress(holder) {
    return detailText(holder?.address ?? holder?.ADDRESS);
}

function formatHolderBalance(holder, divisibility) {
    const atomic = holder?.quantity ?? holder?.QUANTITY;
    if (atomic != null) return formatAmount(atomic, divisibility);
    const amount = detailText(holder?.amount ?? holder?.AMOUNT);
    if (amount === '-' || !/^-?\d+(?:\.\d+)?$/.test(amount)) return '-';
    return formatWithThousands(amount);
}

function restoreBalanceRowFocus(chainId, tick) {
    if (typeof document === 'undefined') return;
    const key = `${chainId}:${tick}`;
    setTimeout(() => {
        const row = Array.from(document.querySelectorAll('[data-balance-key]'))
            .find((candidate) => candidate.getAttribute('data-balance-key') === key);
        const target = row?.matches('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')
            ? row
            : row?.querySelector('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])');
        target?.focus();
    }, 0);
}

function StatCell({ label, value, valueLabel, tone }) {
    const cls = tone === 'positive' ? styles.statValuePositive
        : tone === 'negative' ? styles.statValueNegative
        : styles.statValue;
    return (
        <div className={styles.statCell}>
            <div className={styles.statLabel}>{label}</div>
            <div className={cls} aria-label={valueLabel}>{value}</div>
        </div>
    );
}

function formatCompactFiat(value, currency) {
    if (value === null || value === undefined || !isFinite(value)) return '-';
    const abs = Math.abs(value);
    if (abs >= 1e12) return `${formatFiat(value / 1e12, currency)}T`;
    if (abs >= 1e9) return `${formatFiat(value / 1e9, currency)}B`;
    if (abs >= 1e6) return `${formatFiat(value / 1e6, currency)}M`;
    if (abs >= 1e3) return `${formatFiat(value / 1e3, currency)}K`;
    return formatFiat(value, currency);
}

/**
 * Fraction digits for a coin-denominated price: eight significant digits
 * past its leading zeros, so a small price keeps its value and its unit
 * fits the stats cell.
 * @param {string} decimal  expanded decimal text
 */
function priceDigits(decimal) {
    const fraction = /\.(\d+)$/.exec(decimal)?.[1] || '';
    const leadingZeros = /^-?0\./.test(decimal) ? /^0*/.exec(fraction)[0].length : 0;
    const digits = Math.min(fraction.length, leadingZeros + 8);
    return { minimumFractionDigits: 0, maximumFractionDigits: digits };
}

function positiveFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function kindLabel(kind) {
    if (kind === 'native') return 'Native coin';
    if (kind === 'subtoken') return 'Subtoken';
    return 'Token';
}

function nativeTickerOf(chainId) {
    const desc = chainRegistry.get(chainId);
    return tickerForCoin(desc?.coin);
}

function parseAtomicQuantity(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return Number.isSafeInteger(v) ? BigInt(v) : null;
    if (typeof v === 'string') {
        const t = v.trim();
        if (!/^-?\d+$/.test(t)) return null;
        return BigInt(t);
    }
    return null;
}

function normalizedDivisibility(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 8 ? parsed : null;
}

function formatAmount(quantityStr, divisibility) {
    if (parseAtomicQuantity(quantityStr) == null || normalizedDivisibility(divisibility) == null) return '-';
    return formatAtomicAmount(quantityStr, divisibility);
}

function amountWithUnit(quantity, divisibility, unit) {
    const amount = formatAmount(quantity, divisibility);
    return amount === '-' ? '-' : `${amount} ${unit}`;
}

function fiatValue(quantityStr, divisibility, fiatRate) {
    const quantity = parseAtomicQuantity(quantityStr);
    const scale = normalizedDivisibility(divisibility);
    if (quantity == null || scale == null || typeof fiatRate !== 'number' || !isFinite(fiatRate) || fiatRate <= 0) return null;
    const amount = decimalFromBaseUnits(quantity, scale);
    return multiplyDecimalStrings(amount, expandDecimalNotation(fiatRate));
}

// Returns just the symbol-prefixed numeric portion of a fiat value in
// the wallet's preferred currency ("€8,642.00", "¥1,200"). The ISO
// currency code is rendered separately as a styled suffix span by the
// caller so it can be sized down relative to the amount. Uses
// Intl.NumberFormat so currencies with non-USD symbols / decimal
// conventions render correctly; falls back to a plain-number rendering
// if the code is unknown to Intl.
function formatFiatNumber(value, currency) {
    if (value === null || value === undefined) return '-';
    return formatFiatAmount(String(value), currency);
}

// Fits its children on a single line by measuring overflow with a
// ResizeObserver and applying a CSS transform: scale(...) when the
// content is wider than the container. Avoids the wrapping that the
// old `word-break: break-all` rule produced on long fiat balances
// (e.g. JPY which can run 9+ digits). Scales down only, never up;
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
            // 2px safety margin absorbs subpixel rounding in transform
            // scaling; without it the trailing glyph can clip by a
            // fraction of a pixel ("USD" → "US", "BTC" → "BT+half C").
            const target = Math.max(0, cw - 2);
            const next = (iw <= 0 || cw <= 0 || iw <= target) ? 1 : target / iw;
            // Write the result back here too. The reset above is imperative,
            // and when `next` equals the scale already in state React skips
            // the re-render, so the reset stuck: every re-measure (fonts
            // settling, a resize) left a long balance unscaled and its ticker
            // clipped by up to 53px (2026-10-12).
            i.style.transform = `scale(${next})`;
            setScale(next);
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
