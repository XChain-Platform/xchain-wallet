// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { HoldingValueContext, holdingBalanceSeries, holdingValueSeries } from '../components/holdingValueContext.js';
import { assetKeyOf } from '../utils/portfolioValueHistory.js';
import { AddressText, Button, ChainBadge, CopyButton, EmptyState, FormErrorSummary, Icon, Input, ListPage, ListRow, Notice, PageHeader, Screen, SectionHeader, Skeleton, StatusMessage, Tabs, useFormErrors } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { getDemoGatedGroupsForTick, isDemoGatedActionIndex } from '../../flows/demoGatedContent.js';
import { StalenessLabel } from '../components/StalenessLabel.jsx';
import { GatedFileViewer } from '../components/GatedFileViewer.jsx';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { formatCompactChartValue, Sparkline, synthesizeTokenChart } from '../components/Sparkline.jsx';
import { isDemoWallet } from '../../flows/demoMode.js';
import { DEMO_CHART_SEED } from '../../flows/demoCapture.js';
import { synthesizeDemoNativePrices } from '../../flows/demoFixtures.js';
import { BEHIND_CHART_FILL, BEHIND_CHART_STROKE, ChartRangeTabs, RANGES as CHART_RANGES, defaultRangeId, priceHistoryForRange, rangeChangeFor, rangeWindowStart } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import { rangeChangeText } from '../components/TotalBalanceHero.jsx';
import heroStyles from '../components/TotalBalanceHero.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { TokenHistoryTab, useTokenHistory } from '../components/TokenHistoryTab.jsx';
import {
    TOKEN_OWNER_GROUP_ACTION_IDS,
    TokenOwnerActionGroups,
    buildTokenOwnerGroups,
    tokenOwnerDetailRows,
    useTokenOwnerState,
} from '../components/TokenOwnerActions.jsx';
import { balanceSeries, balanceWindowStart } from '../utils/assetBalanceSeries.js';
import { TokenMarketRows } from '../components/TokenMarketTab.jsx';
import listRowStyles from '../../ui/ListRow.module.css';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { useNativePrice } from '../hooks/useNativePrice.js';
import { useWalletHistory } from '../hooks/useWalletHistory.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { PriceAlertEditorPage } from '../components/settings/PriceAlertsSection.jsx';
import { useBackHandler } from '../../ui/backStack.js';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { pinnedTokensForWallet, pinnedTokensPatchForWallet } from '../../schemas/settings.js';
import { explorerChainUrl, explorerPageUrl } from '../utils/explorerLinks.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { useBalanceUnit } from '../hooks/useBalanceUnit.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { useWalletSource } from '../hooks/useDemoGuard.jsx';
import { prepareValuation } from '../utils/portfolioValuation.js';
import { coinFromChainId, formatFiat } from '../components/BalanceList.jsx';
import { BridgeOriginTick } from './BridgeOriginBadge.jsx';
import { parseBridgedTick, bridgeDisplayTick, coinDisplay } from './BridgeTick.js';
import { destroyRefusalFor } from '../../registry/destroyPolicy.js';
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
import { nativeDecimalsFor, tickerForCoin } from '../../registry/coinTicker.js';
import { useDocumentTitleSection } from '../hooks/useDocumentTitle.js';
import { extractHolderRows } from '../utils/holderRows.js';
import { explorerPage, uniqueRows } from '../utils/pagedRows.js';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import { safeHttpUrl, safeImageSrc } from '../utils/externalUrl.js';
import { embeddedDataLabel, isDataUrl } from '../utils/embeddedDataLabel.js';
import { readActiveAccount } from '../utils/activeAccountMemory.js';
import { isBalanceCacheFresh, readBalanceCache } from '../utils/balanceCache.js';
import { chainReadFailed, sumTickOnChain } from '../utils/walletBalanceShape.js';
import styles from './TokenDetail.module.css';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { buildActionEntries } from '../actionEntries.js';
import { ENTRY_ICON } from './ActionsMenu.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/balances.js';
import '../../i18n/locales/en/addressList.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/home.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/tokenDetail.js';

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
 * @param {() => void} [props.onManageToken]         navigate to the issuer's Manage Token view for this tick
 * @param {Record<string, (() => void) | undefined>} [props.assetActions]
 *   handlers keyed by the action registry's handler names (actionEntries.js),
 *   each opening its flow pre-filled with this asset; the Actions tab offers
 *   the ones that apply to this coin or token
 * @param {(entry: any) => void} [props.onSelectEntry] open one History row's detail (the History tab)
 * @param {boolean} [props.embedded] drawn as wide Home's detail panel beside the balances list (G115):
 *   Home's Screen owns the header, the scroller and the notices, so the page has no header or
 *   Back of its own; every coin and token keeps the same value-chart hero in the panel
 * @param {Record<string, ((ctx?: { issuer?: string }) => void) | undefined>} [props.manageActions]
 *   the issuer's handlers (onMint, onLock, onIssueSubtoken, ... as the shells wire them), each
 *   opening its form with this token and its resolved issuer; when given, the issuer actions
 *   in grouped lists in the Actions tab and their facts in the Details card
 * @param {boolean} [props.ownerView] opened from My Tokens (the manage-token route): shows the
 *   issuer's groups while keeping the shared coin-and-token hero
 * @param {(issuer: string | null) => void} [props.onIssuerResolved] told the token's issuer once read
 *
 * Every coin and token route opens with the shared blue value-chart hero.
 * Actions, Details and History stay shared.
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
    assetActions = null,
    onSelectEntry,
    embedded = false,
    manageActions = null,
    ownerView = false,
    onIssuerResolved,
}) {
    const { messaging, shell } = useMessaging();
    const { settings, error: settingsError, update: updateSettings } = useSettings();
    // The token's place in the watched, pinned and hidden lists (the lists
    // Settings, Appearance, Tokens shows); the Actions rows below edit them.
    const listKey = `${chainId}:${tick}`;
    const watchedList = Array.isArray(settings?.watchedTokens) ? settings.watchedTokens : [];
    const hiddenList = Array.isArray(settings?.hiddenTokens) ? settings.hiddenTokens : [];
    const pinnedList = settings ? pinnedTokensForWallet(settings, walletId) : [];
    const isWatchedToken = watchedList.includes(listKey);
    const isPinnedToken = pinnedList.includes(listKey);
    const isHiddenToken = hiddenList.includes(listKey);
    const canEditLists = Boolean(settings) && typeof updateSettings === 'function';
    const [listActionFailed, setListActionFailed] = useState(false);
    const writeList = (patch) => {
        setListActionFailed(false);
        Promise.resolve(updateSettings(patch)).catch(() => setListActionFailed(true));
    };
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    // The balance card formats its coin amounts as Home's does.
    const fiatLocale = settings?.language || 'en-US';
    // The mode is this wallet's own (§20); a wallet list that cannot say
    // still opens the screen in full mode. A watch-only wallet holds no keys:
    // Send stays live (it builds an unsigned transaction for the paired
    // signer), while every other signing action stays visible but disabled
    // with its reason.
    const { isSignerMode, isWatcherMode, walletModeKnown: walletModeReady } = useWalletMode(walletId);
    const isDemo = isDemoWallet(walletId);
    const { offline: networkOffline } = useNetworkOffline({ walletId });
    const networkActionsAvailable = !networkOffline;
    const variant = screenVariantFor(shell);
    const tabsId = useId();
    const [filterQuery, setFilterQuery] = useState('');
    const [revealedExtra, setRevealedExtra] = useState(null);
    const externalLinkConfirm = useConfirmModal();
    const openIssuerLink = useCallback(async (url) => {
        const safeUrl = safeHttpUrl(url);
        if (!safeUrl) return;
        const confirmed = await externalLinkConfirm.confirm({
            title: 'Open External Link?',
            message: safeUrl,
            confirmLabel: 'Open Link',
        });
        if (confirmed) globalThis.open?.(safeUrl, '_blank', 'noopener,noreferrer');
    }, [externalLinkConfirm.confirm]);
    // The system Back from the Add Price Alert page returns to this page.
    useBackHandler(revealedExtra === 'price-alert' ? () => setRevealedExtra(null) : undefined, false, 'screen');
    const [resolvedQuantity, setResolvedQuantity] = useState(
        typeof suppliedQuantity === 'string' ? suppliedQuantity : null,
    );
    // A failed balance read leaves the amount unknown; it never reads as zero.
    const [balanceFailed, setBalanceFailed] = useState(false);
    // Home's saved balances answer while fresh, so the network is known first.
    const settingsReady = Boolean(settings) || Boolean(settingsError);
    // Home's default when the setting is unset.
    const balanceNetwork = settingsReady ? (settings?.activeNetwork || 'mainnet') : null;
    useEffect(() => {
        setBalanceFailed(false);
        if (typeof suppliedQuantity === 'string') {
            setResolvedQuantity(suppliedQuantity);
            return undefined;
        }
        setResolvedQuantity(null);
        if (!settingsReady) return undefined;
        // A failed address, or an unreadable half this asset lives in,
        // leaves the total short, so the amount is unknown.
        const settle = (byChain) => {
            const half = kind === 'native' ? 'native' : 'tokens';
            if (chainReadFailed(byChain, chainId, { half })) setBalanceFailed(true);
            else setResolvedQuantity(sumTickOnChain(byChain, chainId, tick));
        };
        const accountId = readActiveAccount(walletId) || undefined;
        const saved = !isDemoWallet(walletId) && balanceNetwork
            ? readBalanceCache(walletId, accountId, balanceNetwork)
            : null;
        if (isBalanceCacheFresh(saved)) {
            settle(saved.balances);
            return undefined;
        }
        if (typeof messaging.getWalletBalances !== 'function') {
            setBalanceFailed(true);
            return undefined;
        }
        let cancelled = false;
        messaging.getWalletBalances(walletId, accountId)
            .then((byChain) => {
                if (!cancelled) settle(byChain);
            })
            .catch(() => {
                if (!cancelled) setBalanceFailed(true);
            });
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId, tick, kind, suppliedQuantity, settingsReady, balanceNetwork]);
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
    const [collectionChildren, setCollectionChildren] = useState(/** @type {any[] | null} */ (null));
    useEffect(() => {
        if (isNative || typeof messaging.getSubassetsForToken !== 'function') {
            setCollectionChildren([]);
            return undefined;
        }
        let cancelled = false;
        setCollectionChildren(null);
        callAsync(() => messaging.getSubassetsForToken({ chainId, tick, opts: { limit: 100 } }))
            .then((response) => {
                if (cancelled) return;
                const rows = Array.isArray(response) ? response : (Array.isArray(response?.data) ? response.data : []);
                setCollectionChildren(rows);
            })
            .catch(() => { if (!cancelled) setCollectionChildren([]); });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick, isNative]);

    // The issuer's groups open their forms for any wallet. Each form runs its
    // own preflight and refuses a source that cannot perform the action.
    const tokenOwnerAddress = isNative ? null : (assetInfo?.creator || null);
    const showOwnerGroups = !isNative && manageActions != null;
    const ownerState = useTokenOwnerState({ messaging, chainId, tick, enabled: showOwnerGroups });
    useEffect(() => {
        if (showOwnerGroups && typeof onIssuerResolved === 'function') onIssuerResolved(tokenOwnerAddress);
    }, [showOwnerGroups, tokenOwnerAddress, onIssuerResolved]);

    // A coin whose price is never asked for (a test network) charts its own
    // balance from the wallet's rows, as a token does, so its blue hero still
    // has a chart (G10).
    const nativeBalanceChart = isNative && !(fiatSupported && fiatAllowed);
    // On wide Home the hero draws this holding from the wallet's one history
    // read (HoldingValueContext), so the panel reads its own rows only once
    // its History tab opens (the tab reads them itself when none are handed in).
    const holdingSource = useContext(HoldingValueContext);
    const holdingDrawn = embedded
        && Boolean(holdingSource?.prepared?.assets?.some((asset) => asset.key === assetKeyOf(chainId, tick)));
    const readsOwnHistory = !holdingDrawn;
    const historySource = useWalletSource(walletId);
    // This wallet's own rows: one read feeds the hero's balance line and the
    // History tab. A coin with a price line leaves its tab to read its own.
    const tokenHistory = useTokenHistory({ messaging: historySource.messaging, walletId, chainId, tick, isNative, enabled: readsOwnHistory });
    const chartAddressesByChain = useMemo(() => ({
        [chainId]: Array.isArray(tokenHistory.addresses) ? tokenHistory.addresses : [],
    }), [chainId, tokenHistory.addresses]);
    const chartTicksByChain = useMemo(
        () => (isNative ? {} : { [chainId]: [tick] }),
        [chainId, isNative, tick],
    );
    const canReadValueHistory = readsOwnHistory && !isDemo
        && chartAddressesByChain[chainId].length > 0
        && (isNative
            ? typeof messaging?.getNativeHistoryBatch === 'function'
            : typeof messaging?.getWalletHistoryBatch === 'function');
    const detailWalletHistory = useWalletHistory({
        walletId,
        activeNetwork: settings?.activeNetwork || 'mainnet',
        messaging: historySource.messaging,
        addressesByChain: chartAddressesByChain,
        chainIds: [chainId],
        tokenTicksByChain: chartTicksByChain,
        enabled: canReadValueHistory,
    });

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
    // A detail route can open before Home has attached its bulk token rate.
    // Keep the carried row rate first, then use the same oracle-first,
    // DEX-second lookup the amount fields use when that live answer lands.
    const carriedTokenRate = !isNative ? positiveFiniteNumber(displayFiatRate) : null;
    const liveTokenRate = !isNative ? positiveFiniteNumber(tokenAlertRate?.rate) : null;
    const liveTokenSource = tokenAlertRate?.source || null;
    const preferLiveTokenRate = liveTokenRate !== null && (
        carriedTokenRate === null
        || (liveTokenSource === 'oracle' && fiatRateSource !== 'oracle')
        || (liveTokenSource === 'market' && fiatRateSource === 'dispenser')
    );
    const holdingFiatRate = isNative
        ? (liveNativeRate ?? displayFiatRate)
        : (preferLiveTokenRate ? liveTokenRate : carriedTokenRate);
    const holdingFiatRateSource = isNative
        ? fiatRateSource
        : (preferLiveTokenRate ? liveTokenSource : fiatRateSource);
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
        const webImages = tisImages.filter((i) => !i?.locked && safeImageSrc(i?.url));
        const iconHit = webImages.find((i) => String(i?.type || '').toLowerCase() === 'icon');
        const fromTis = iconHit?.url
            || webImages[0]?.url
            || safeImageSrc(assetInfo?.imageUrl)
            || rowImageUrl
            || null;
        if (fromTis) return fromTis;
        const platformIcon = branding.platformTokenIconUrl(tick);
        if (platformIcon) return platformIcon;
        if (isNative) {
            return branding.chainIconLargeUrl(chainId)
                || branding.chainIconSmallUrl(chainId)
                || null;
        }
        return null;
    }, [assetInfo, rowImageUrl, isNative, chainId, tick]);

    // An outlined open-in-new button on the title line opens this coin
    // or token on the XChain explorer, for everything this page does not show.
    // A native coin has no token page there, so it opens its chain's page.
    const explorerUrl = isNative
        ? explorerChainUrl({ chainId, settings })
        : explorerPageUrl({ chainId, kind: 'token', value: tick, settings });
    const explorerTitle = t('tokenDetail.actions.explorerTitle', { tick });
    const pageTitle = displayName || bridgeDisplayTick(tick, coinFromChainId(chainId)).label;
    // The window title names the asset, as the page header does; wide Home's
    // panel leaves the window to Home.
    useDocumentTitleSection(embedded ? null : pageTitle);
    const filterMenu = !isNative ? (
        <ListFilterMenu
            query={filterQuery}
            onQueryChange={setFilterQuery}
            searchPlaceholder="Search this token"
            searchLabel="Search token details, files, and history"
            label="Filter token content"
            resultsId={`${tabsId}-panel`}
        />
    ) : null;
    const header = (
        <PageHeader
            onBack={handleBack}
            trailing={filterMenu || explorerUrl ? (<>{filterMenu}{explorerUrl ? (
                <Button
                    type="button"
                    size="md"
                    variant="secondary"
                    className={styles.explorerButton}
                    icon={<Icon.ExternalLinkIcon />}
                    onClick={() => window.open(explorerUrl, '_blank', 'noopener,noreferrer')}
                    aria-label={explorerTitle}
                    title={explorerTitle}
                    data-explorer-link=""
                >
                    {null}
                </Button>
            ) : null}</>) : null}
            // A bridged copy is titled by its bare name; the rooted wire form
            // and the origin chain are both on the Details panel below, so the
            // page never hides which asset this really is.
            title={(
                <span className={styles.headerTitleWithIcon}>
                    {headerIconUrl ? (
                        <span className={styles.cardCaptionIconWrap}>
                            <AssetArtwork
                                src={headerIconUrl}
                                className={styles.cardCaptionIcon}
                                fallbackClassName={styles.cardCaptionIconFallback}
                                fallbackText={tick}
                            />
                            {!isNative && chainId ? (
                                <img
                                    src={branding.chainIconSmallUrl(chainId)}
                                    alt=""
                                    aria-hidden="true"
                                    className={styles.cardCaptionChain}
                                />
                            ) : null}
                        </span>
                    ) : null}
                    <span className={styles.headerTitle} title={pageTitle}>
                        {pageTitle}
                    </span>
                </span>
            )}
        />
    );

    const nativePriceValue = positiveFiniteNumber(nativePrice.entry?.priceFiat);
    const hasAbout = !isNative && hasSupplementalTokenInfo(assetInfo);
    const hasMedia = !isNative && hasPublishedMedia(assetInfo);

    // Actions comes first and opens selected; Details stays one tap away.
    // Secondary token surfaces are selected from More info and revealed above
    // the tabs. Each tab label carries a 16px icon, as the Home tabs do.
    const tabLabel = (IconGlyph, text) => (
        <span className={homeTabsStyles.tabWithIcon}><span className={homeTabsStyles.tabIcon} aria-hidden="true"><IconGlyph /></span>{text}</span>
    );
    // Actions | Details | History, Actions selected first. Market figures are
    // rows in the Details list.
    const tabs = [
        { id: 'actions', label: tabLabel(Icon.ZapIcon, t('tokenDetail.tabs.actions')) },
        { id: 'details', label: tabLabel(Icon.InfoIcon, t('tokenDetail.tabs.details')) },
        !isNative ? { id: 'files', label: tabLabel(Icon.DocumentIcon, t('tokenDetail.tabs.files')) } : null,
        { id: 'history', label: tabLabel(Icon.HistoryIcon, t('tokenDetail.tabs.history')) },
    ].filter(Boolean);
    const [activeTab, setActiveTab] = useState('actions');
    const chooseTab = useCallback((nextTab) => {
        setActiveTab(nextTab);
        if (nextTab === 'files') setGatedOpen(true);
    }, []);

    const [balanceHidden, toggleBalanceHidden] = useBalancesHidden();
    const [assetUnit, toggleAssetUnit] = useBalanceUnit('asset');

    const fiatAvailable = fiat != null && isFinite(fiat);
    // Amount + unit code are kept separate so the unit can render as a
    // smaller styled span next to the digits (matches the Home total-
    // balance hero treatment). For BTC the code is the tick ticker;
    // for fiat the code is the wallet's preferred currency.
    const assetAmount = formatAmount(quantity, resolvedDivisibility);
    const fiatAmount = fiatAvailable ? formatFiatNumber(fiat, fiatCurrency) : null;
    // The stored choice owns the mode on mainnet. Test networks have no fiat
    // value, so their heroes stay in Balance mode and offer no unit toggle.
    // Missing mainnet market data changes the Value contents, never the choice
    // or the availability of the toggle.
    const fiatModeAvailable = fiatSupported && fiatAllowed;
    const showFiatPrimary = fiatModeAvailable && !assetUnit;
    const primaryAmount = showFiatPrimary ? (fiatAmount ?? 'No price yet') : assetAmount;
    const primaryCode = showFiatPrimary && fiatAvailable ? fiatCurrency : (!showFiatPrimary ? tick : null);
    const priceSourceLabel = showFiatPrimary && fiatAvailable
        ? holdingFiatRateSource === 'market' ? 'Price from the exchange'
            : holdingFiatRateSource === 'dispenser' ? 'Price from dispensers'
                : null
        : null;
    const atomicQuantity = parseAtomicQuantity(quantity);
    const holdingUnits = atomicQuantity != null && resolvedDivisibility != null
        ? Number(decimalFromBaseUnits(atomicQuantity, resolvedDivisibility))
        : NaN;
    const unitPrice = fiatAvailable ? Number(holdingFiatRate) : 1;

    // A token has no recorded price history (nor a coin on a test network), so
    // its hero draws what this wallet's own rows prove: the balance over the
    // range, valued at the current fiat price when there is one (never a
    // synthesized walk).
    const tokenHistoryEntries = tokenHistory.entries;
    const tokenHistoryAddresses = tokenHistory.addresses;
    // A coin row may arrive without its divisibility; the chain names it.
    const seriesDivisibility = resolvedDivisibility ?? (isNative ? nativeDecimalsFor(descriptor || chainId) : null);
    const tokenSeriesFor = useCallback((range) => {
        if (!readsOwnHistory || tokenHistoryEntries === null || atomicQuantity == null) return null;
        const nowMs = Date.now();
        // Every own address on the chain, so a move between two of them
        // never reads as a send.
        const own = Array.isArray(tokenHistoryAddresses)
            ? new Set(tokenHistoryAddresses.map((address) => String(address).toLowerCase()))
            : undefined;
        const units = balanceSeries({
            entries: tokenHistoryEntries,
            currentAtomic: atomicQuantity,
            tick,
            divisibility: seriesDivisibility,
            walletAddresses: own,
            points: range.points,
            windowStart: balanceWindowStart(range, nowMs, rangeWindowStart),
            nowMs,
        });
        return units;
    }, [readsOwnHistory, tokenHistoryEntries, tokenHistoryAddresses, atomicQuantity, tick, seriesDivisibility]);

    const localHoldingSource = useMemo(() => {
        if (!readsOwnHistory || !fiatAvailable || tokenHistoryEntries === null || atomicQuantity === null) return null;
        const fallbackHistory = {
            entries: tokenHistoryEntries,
            addressesByChain: chartAddressesByChain,
            tokenPrices: detailWalletHistory.tokenPrices,
        };
        const history = detailWalletHistory.reads instanceof Map ? detailWalletHistory : fallbackHistory;
        return {
            prepared: prepareValuation({
                rows: [{
                    chainId,
                    tick,
                    kind: isNative ? 'native' : 'token',
                    quantity: String(atomicQuantity),
                    divisibility: seriesDivisibility,
                    fiatRate: unitPrice,
                }],
                history,
            }),
            priceMap: {},
            seedId: isDemo ? DEMO_CHART_SEED : walletId,
            synthesize: isDemo,
            requestRange: detailWalletHistory.requestRange,
        };
    }, [readsOwnHistory, fiatAvailable, tokenHistoryEntries, atomicQuantity, chartAddressesByChain, detailWalletHistory, chainId, tick, isNative, seriesDivisibility, unitPrice, walletId, isDemo]);

    // The price chart behind the balance card, its range buttons and
    // the stats row under the card all read one market state.
    // Wide Home's detail panel draws this holding's value over time (the
    // wallet's balance of the asset at each point times its price then), the
    // asset's share of Home's portfolio chart from the same valuation and the
    // same one history read. The page opened on its own keeps its price line.
    const selectedHoldingSource = holdingDrawn ? holdingSource : localHoldingSource;
    const holdingSeriesFor = useMemo(() => (selectedHoldingSource
        ? (range, priceEntry) => (showFiatPrimary
            ? holdingValueSeries(selectedHoldingSource, { chainId, tick, range, priceEntry })
            : holdingBalanceSeries(selectedHoldingSource, { chainId, tick, range }))
        : null), [selectedHoldingSource, chainId, tick, showFiatPrimary]);
    const market = useMarketData({
        holdingSeriesFor,
        tokenSeriesFor,
        tokenSeriesLoading: readsOwnHistory && (tokenHistoryEntries === null || (atomicQuantity == null && !balanceFailed)),
        showFiat: showFiatPrimary,
        hasFiatPrice: fiatAvailable,
        nativeBalanceChart,
        enabled: fiatSupported,
        isNative,
        nativePrice,
        isDemo,
        assetInfo,
        tick,
        chainId,
        fiatRate: holdingFiatRate,
        fiatRateSource: holdingFiatRateSource,
        fiatCurrency,
        loading: metadataLoading,
        loadFailed,
    });
    // The card's change pill, as on Home: what the holding gained or
    // lost over the selected range. The price line is scaled to the holding's
    // value, so it ends at the balance and the percent is the price's own move.
    // Without a fiat value the change is counted in the coin itself. A
    // balance line (or its value at today's price) has no pill: a receive is
    // not a gain, so only a price line says how the holding moved.
    const rangeChange = useMemo(() => {
        const series = market.sparkline;
        // A value line is already the holding's fiat value over the range.
        if (market.seriesKind === 'value') {
            if (market.chartBusy || !Array.isArray(series) || series.length < 2) return null;
            return rangeChangeFor(series, market.range.label, (value) => formatFiatAmount(String(value), fiatCurrency));
        }
        if (market.seriesKind !== 'price') return null;
        if (market.chartBusy || !Array.isArray(series) || series.length < 2) return null;
        const last = series[series.length - 1];
        const holdingValue = fiatAvailable ? Number(fiat) : holdingUnits;
        if (!(last > 0) || !Number.isFinite(holdingValue)) return null;
        const scaled = series.map((price) => (price / last) * holdingValue);
        return rangeChangeFor(scaled, market.range.label, (value) => (fiatAvailable
            ? formatFiatAmount(String(value), fiatCurrency)
            : `${new Intl.NumberFormat(fiatLocale, { maximumFractionDigits: 8 }).format(value)} ${tick}`));
    }, [market.sparkline, market.seriesKind, market.chartBusy, market.range.label, fiatAvailable, fiat, holdingUnits, fiatCurrency, fiatLocale, tick]);
    const changeInCoin = !showFiatPrimary;
    // The figure measures the selected range, so it names that period for
    // screen readers as the Home balance does with 24h.
    const rangeChangeShown = rangeChange?.text
        ? rangeChangeText(rangeChange, {
            showInCoin: changeInCoin,
            unitPrice,
            unitTick: tick,
            locale: fiatLocale,
        })
        : null;
    const captionId = useId();
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
    // Add Price Alert opens as this page's own full page, which wide Home's
    // detail panel cannot hold, so the panel leaves the row to the coin page.
    const showPriceAlertItem = !embedded
        && fiatSupported
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
        !isNative && !manageActions && typeof onManageToken === 'function' ? {
            id: 'manage',
            label: 'Manage',
            Icon: Icon.GearIcon,
            onSelect: onManageToken,
        } : null,
    ].filter(Boolean);

    // More's information items are links in the Details tab.
    const DETAIL_LINK_IDS = ['supply-history', 'holders'];
    const infoItems = moreItems.filter((item) => DETAIL_LINK_IDS.includes(item.id));

    const actionGrid = buildAssetActionTiles({
        assetActions,
        isNative,
        isSignerMode,
        isWatcherMode,
        tick,
        sourceCoin: coinFromChainId(chainId),
        atomicQuantity,
        networkActionsAvailable,
        core: [
            {
                id: 'send',
                label: t('tokenDetail.actions.send'),
                description: t('tokenDetail.actionDescriptions.send', { tick }),
                Icon: Icon.SendIcon,
                onSelect: onSend,
                reason: sendDisabledReason,
            },
            {
                id: 'receive',
                label: t('tokenDetail.actions.receive'),
                description: t('tokenDetail.actionDescriptions.receive', { tick }),
                Icon: Icon.ReceiveIcon,
                onSelect: onReceive,
                reason: receiveDisabledReason,
            },
            typeof onBuy === 'function'
                ? {
                    id: 'exchange',
                    label: t('tokenDetail.actions.exchange'),
                    description: t('tokenDetail.actionDescriptions.exchange', { tick }),
                    Icon: Icon.MarketIcon,
                    onSelect: onBuy,
                    reason: tradeDisabledReason,
                }
                : null,
        ],
        tail: [
            showPriceAlertItem ? {
                id: 'price-alert',
                label: t('tokenDetail.actions.priceAlert'),
                description: t('tokenDetail.actionDescriptions.priceAlert', { tick }),
                Icon: Icon.BellIcon || Icon.InfoIcon,
                onSelect: () => setRevealedExtra('price-alert'),
                shortReason: isNative && (nativePriceLoading || nativePriceValue === null)
                    ? t('tokenDetail.actions.needsPrice')
                    : null,
            } : null,
            canEditLists && isWatchedToken ? {
                id: 'stop-watching',
                label: t('tokenDetail.actions.stopWatching'),
                description: t('tokenDetail.actionDescriptions.stopWatching', { tick }),
                Icon: Icon.EyeOffIcon,
                onSelect: () => writeList({ watchedTokens: watchedList.filter((key) => key !== listKey) }),
            } : null,
            canEditLists ? {
                id: 'pin',
                label: isPinnedToken ? t('balances.unpin2') : t('balances.pinToTop'),
                description: isPinnedToken
                    ? t('tokenDetail.actionDescriptions.unpin', { tick })
                    : t('tokenDetail.actionDescriptions.pin', { tick }),
                Icon: PinGlyph,
                onSelect: () => writeList(pinnedTokensPatchForWallet(
                    walletId,
                    isPinnedToken ? pinnedList.filter((key) => key !== listKey) : [...pinnedList, listKey],
                )),
            } : null,
            canEditLists ? {
                id: 'hide',
                label: isHiddenToken ? t('settings.display.unhide2') : t('settings.developer.hide'),
                description: isHiddenToken
                    ? t('tokenDetail.actionDescriptions.unhide', { tick })
                    : t('tokenDetail.actionDescriptions.hide', { tick }),
                Icon: isHiddenToken ? Icon.EyeIcon : Icon.EyeOffIcon,
                onSelect: () => writeList({
                    hiddenTokens: isHiddenToken
                        ? hiddenList.filter((key) => key !== listKey)
                        : [...hiddenList, listKey],
                }),
            } : null,
        ],
        // A shell that wires the issuer's handlers gets their groups on this
        // page; one that does not keeps the Manage row to the issuer's page.
        manage: !isNative && !manageActions && typeof onManageToken === 'function'
            ? {
                id: 'manage',
                label: t('tokenDetail.actions.manage'),
                description: t('tokenDetail.actionDescriptions.manage', { tick }),
                Icon: Icon.GearIcon,
                onSelect: onManageToken,
            }
            : null,
        ownerGroupsShown: showOwnerGroups,
    });
    // The issuer's groups, with the registry's issuer actions the groups do
    // not already hold (Publish oracle price) folded in.
    const issuerActionBlockedReason = isWatcherMode
        ? capitalize(t('tokenDetail.actions.needsSigner'))
        : !networkActionsAvailable ? capitalize(t('tokenDetail.actions.needsNetwork')) : null;
    const ownerGroups = showOwnerGroups
        ? buildTokenOwnerGroups({
            assetInfo,
            sleepState: ownerState.sleepState,
            handlers: manageActions,
            owner: tokenOwnerAddress,
            blockedReason: issuerActionBlockedReason,
            // Destroy, Dispenser and Airdrop spend the token, so with none held
            // they stay locked with that reason (an unknown balance does not lock).
            noBalanceReason: atomicQuantity != null && atomicQuantity <= 0n
                ? capitalize(t('tokenDetail.actions.needsBalance', { tick }))
                : null,
            // The Supply group's Destroy follows the same refusal rule as the
            // registry tile; the Destroy form keeps its own refusal as the backstop.
            destroyRefusalReason: destroyRefusalFor({ tick, sourceCoin: coinFromChainId(chainId) })?.reason || null,
            extraActions: actionGrid.ownerExtra.map((tile) => ({
                id: tile.id,
                label: tile.label,
                description: tile.description,
                Icon: tile.Icon,
                onSelect: tile.onSelect,
                disabled: Boolean(rowReason(tile)) || typeof tile.onSelect !== 'function',
                disabledReason: rowReason(tile) || t('routes.manageToken.actionUnavailable'),
                danger: tile.danger,
            })),
        })
        : null;
    const ownerDetailRows = showOwnerGroups
        ? tokenOwnerDetailRows({
            creator: tokenOwnerAddress,
            issuer: ownerState.genesis?.source || tokenOwnerAddress,
            maxSupply: assetInfo?.maxSupply ?? null,
            divisibility: resolvedDivisibility,
            tokenLocks: assetInfo?.locks || {},
            lockBridge: assetInfo?.lockBridge === true,
            paused: ownerState.sleepState.paused,
            createdBlock: ownerState.genesis?.blockIndex ?? assetInfo?.blockIndex ?? assetInfo?.block_index ?? null,
            lockedClassName: styles.ownerLocked,
            editableClassName: styles.ownerEditable,
        })
        : [];

    // The Price alert action opens Add Price Alert as its own page with this
    // asset chosen; Back (or a saved alert) returns to this page.
    if (revealedExtra === 'price-alert' && showPriceAlertItem) {
        return (
            <PriceAlertEditorPage
                nested={false}
                variant={variant}
                walletId={walletId}
                fiatCurrency={String(fiatCurrency).toLowerCase()}
                allowCoingeckoFallback={false}
                initialChainId={chainId}
                initialTick={isNative ? undefined : tick}
                currentPrice={isNative ? nativePriceValue : tokenPriceValue}
                onBack={() => setRevealedExtra(null)}
                onSave={async (input) => {
                    await messaging.savePriceAlert({ walletId, ...input });
                    setRevealedExtra(null);
                }}
            />
        );
    }

    // Embedded in wide Home's detail panel, Home's Screen is the page (its
    // header, scroller and notices), so this page adds none of its own.
    const PageFrame = embedded ? EmbeddedPageFrame : Screen;
    // A blue hero always has its chart (G10): a coin's price line, or, where
    // there is no price (a token, a coin on a test network), its own balance.
    const showHeroChart = !isNative || fiatSupported || nativeBalanceChart;

    if (tokenMissing) {
        return (
            <PageFrame variant={variant} header={header}>
                <ListPage><EmptyState title="Token not found" body="It may not be indexed yet, or the name may be mistyped." /></ListPage>
            </PageFrame>
        );
    }

    return (
        <PageFrame variant={variant} header={header}>
            {/* 8px between the coin page blocks, as on Home. */}
            <ListPage className={styles.detailPage}>
                {/* The panel's own heading, where the page header would name it. */}
                {embedded ? <h2 className="sr-only">{pageTitle}</h2> : null}
                {loadFailed ? (
                    <StatusMessage variant="error">
                        Token details could not be loaded from the explorer. Try again in a moment.
                    </StatusMessage>
                ) : null}
                {listActionFailed ? (
                    <StatusMessage variant="error">{t('tokenDetail.actions.listSaveFailed')}</StatusMessage>
                ) : null}
                {/* No ownership pre-warning: an owner action that would fail is refused
                    by its preflight when the user tries it (operator 2026-11-16). */}
                {/* Every coin and token surface uses the same Home-style
                    value-chart hero. */}
                <div className={showHeroChart ? `${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart}` : homeTabsStyles.heroStack}>
                    {/* Full-page and wide-Home asset heroes repeat Home's identity
                        row: artwork, then the name with its active mode below. */}
                    <section className={heroStyles.hero} aria-labelledby={captionId}>
                        <div className={`${heroStyles.row} ${heroStyles.rowWithActions}`}>
                            <span className={`${heroStyles.label} ${heroStyles.walletLabel} ${styles.cardCaption}`}>
                                <span className={styles.cardCaptionIconWrap}>
                                    {headerIconUrl ? (
                                        <AssetArtwork
                                            src={headerIconUrl}
                                            className={styles.cardCaptionIcon}
                                            fallbackClassName={styles.cardCaptionIconFallback}
                                            fallbackText={tick}
                                        />
                                    ) : metadataLoading ? (
                                        <Skeleton
                                            shape="card"
                                            width="100%"
                                            height="100%"
                                            ariaLabel="Loading token artwork"
                                        />
                                    ) : (
                                        <span className={styles.cardCaptionIconFallback} aria-hidden="true">
                                            {String(tick || '?').slice(0, 2)}
                                        </span>
                                    )}
                                    {!isNative && chainId ? (
                                        <img
                                            src={branding.chainIconSmallUrl(chainId)}
                                            alt=""
                                            aria-hidden="true"
                                            className={styles.cardCaptionChain}
                                        />
                                    ) : null}
                                </span>
                                <span className={heroStyles.walletLabelCopy}>
                                    <span id={captionId} className={`${heroStyles.walletLabelText} ${styles.cardCaptionText}`} title={pageTitle}>
                                        {pageTitle}
                                    </span>
                                    <span className={heroStyles.modeCaption}>
                                        {showFiatPrimary ? t('home.tabs.value') : t('addressList.detail.balance')}
                                    </span>
                                </span>
                            </span>
                            <div
                                className={heroStyles.amount}
                                aria-label={balanceHidden ? t('balances.balanceHidden') : primaryCode ? `${primaryAmount} ${primaryCode}` : primaryAmount}
                            >
                                {balanceHidden ? (
                                    <span className={heroStyles.hidden}>•••••</span>
                                ) : (
                                    <>
                                        <span className={`${heroStyles.amountValue}${showFiatPrimary && !fiatAvailable ? ` ${styles.noPriceAmount}` : ''}`}>{primaryAmount}</span>
                                        {primaryCode ? <span className={heroStyles.amountCode}>{primaryCode}</span> : null}
                                    </>
                                )}
                            </div>
                            <div className={`${heroStyles.actions} ${heroStyles.inlineActions}`}>
                                {!embedded ? (
                                    <Button
                                        type="button"
                                        className={heroStyles.eye}
                                        onClick={toggleBalanceHidden}
                                        aria-label={balanceHidden ? t('components.totalBalanceHero.showBalance') : t('components.totalBalanceHero.hideBalance')}
                                        aria-pressed={balanceHidden ? 'false' : 'true'}
                                        title={balanceHidden ? t('components.totalBalanceHero.showBalance') : t('components.totalBalanceHero.hideBalance')}
                                        icon={balanceHidden ? <Icon.EyeOffIcon /> : <Icon.EyeIcon />}
                                    >
                                        {null}
                                    </Button>
                                ) : null}
                                {fiatModeAvailable ? (
                                    <Button
                                        type="button"
                                        className={heroStyles.eye}
                                        onClick={toggleAssetUnit}
                                        aria-label={showFiatPrimary
                                            ? t('tokenDetail.hero.showBalance', { unit: tick })
                                            : t('tokenDetail.hero.showValue', { unit: fiatCurrency })}
                                        title={showFiatPrimary
                                            ? t('tokenDetail.hero.showBalance', { unit: tick })
                                            : t('tokenDetail.hero.showValue', { unit: fiatCurrency })}
                                        icon={<Icon.SwapIcon />}
                                    >
                                        {null}
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                        <div className={heroStyles.meta} role="group" aria-label={t('components.totalBalanceHero.balanceSummary')}>
                            <span className={heroStyles.metaLeft}>
                                {balanceHidden ? (
                                    <span className={`${heroStyles.hidden} ${heroStyles.hiddenChange}`} aria-label={t('balances.balanceHidden')}>••••</span>
                                ) : rangeChange?.text ? (
                                    <span
                                        className={rangeChange.direction === 'positive' ? heroStyles.changePositive : rangeChange.direction === 'negative' ? heroStyles.changeNegative : heroStyles.changeNeutral}
                                        aria-label={t('tokenDetail.rangeChange', { range: rangeChange.label, change: rangeChangeShown })}
                                    >
                                        {rangeChangeShown}
                                    </span>
                                ) : (
                                    // No change to show yet: an unseen pill keeps the row's height.
                                    <span className={`${heroStyles.hiddenChange} ${styles.cardChangeIdle}`} aria-hidden="true">••••</span>
                                )}
                            </span>
                        </div>
                        {/* The card shows only the preferred unit; the swap button flips it. */}
                        {priceSourceLabel || (fiatAvailable && showStaleFiatRate) ? (
                            <div className={styles.cardSecondary}>
                                {priceSourceLabel ? <span>{priceSourceLabel}</span> : null}
                                {showStaleFiatRate ? (
                                    <StalenessLabel
                                        lastSyncedAt={staleFiatRateAsOf}
                                        className={styles.cardStaleness}
                                    />
                                ) : null}
                            </div>
                        ) : null}
                    </section>
                    {showHeroChart ? (
                        <RouteErrorBoundary
                            variant="compact"
                            resetKey={`${chainId}:${tick}:market`}
                        >
                            <MarketPanel
                                market={market}
                                hidden={balanceHidden}
                                showFiat={showFiatPrimary}
                                currency={fiatCurrency}
                                unit={tick}
                                locale={fiatLocale}
                            />
                        </RouteErrorBoundary>
                    ) : null}
                </div>

                {/* The market figures are a Market group at the top of the Details tab. */}

                {/* The Actions tab holds the action list (G101); the information items
                    (Supply over time, About, Media, Gated content, Holders) are
                    links in the Details tab. */}

                {/* Actions first and selected, then Details. */}
                <Tabs
                    id={tabsId}
                    className={styles.detailTabs}
                    items={tabs}
                    value={activeTab}
                    onChange={chooseTab}
                    panelId={`${tabsId}-panel`}
                    aria-label={t('tokenDetail.tabs.label')}
                />

                        <div
                            id={`${tabsId}-panel`}
                            className={styles.tabPanel}
                            role="tabpanel"
                            aria-labelledby={`${tabsId}-tab-${activeTab}`}
                        >
                            {activeTab === 'actions' ? (
                                <>
                                <AssetActionsPanel grid={actionGrid} tick={tick} ownerGroups={ownerGroups} ownerFirst={ownerView} />
                                </>
                            ) : activeTab === 'history' ? (
                                <TokenHistoryTab
                                    walletId={walletId}
                                    chainId={chainId}
                                    tick={tick}
                                    isNative={isNative}
                                    history={readsOwnHistory ? tokenHistory : null}
                                    onSelectEntry={onSelectEntry}
                                    query={filterQuery}
                                />
                            ) : activeTab === 'files' ? (
                                <FilesPanel
                                    walletId={walletId}
                                    chainId={chainId}
                                    tick={tick}
                                    assetInfo={assetInfo}
                                    loading={metadataLoading || gatedLoading}
                                    error={gatedError}
                                    groups={gatedGroups}
                                    messaging={messaging}
                                    quantity={quantity}
                                    divisibility={resolvedDivisibility}
                                    query={filterQuery}
                                    displayName={displayName || tick}
                                    onOpenExternal={openIssuerLink}
                                />
                            ) : (
                            <>
                            {!isNative ? (
                                <TokenProfile
                                    assetInfo={assetInfo}
                                    tick={tick}
                                    chainId={chainId}
                                    loading={metadataLoading}
                                    loadFailed={loadFailed}
                                    explorerUrl={explorerUrl}
                                    settings={settings}
                                    children={collectionChildren}
                                    query={filterQuery}
                                    onOpenExternal={openIssuerLink}
                                />
                            ) : null}
                            {/* Details is one list in the standard card (Card.module.css),
                                one detail per line, 8px under the tab row; the information
                                items are rows at its foot that open under the card. */}
                            <div className={styles.detailsCard} data-details-card="">
                                <DetailsPanel
                                    extraRows={ownerDetailRows}
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
                                    query={filterQuery}
                                    marketRows={(
                                        <TokenMarketRows
                                            walletId={walletId}
                                            chainId={chainId}
                                            tick={tick}
                                            isNative={isNative}
                                            assetInfo={assetInfo}
                                            assetLoading={metadataLoading}
                                            assetFailed={loadFailed}
                                            nativePrice={nativePrice}
                                            fiatCurrency={fiatCurrency}
                                            rowClassName={`${listRowStyles.row} ${styles.detailRow}`}
                                            labelClassName={listRowStyles.title}
                                            valueClassName={listRowStyles.trailing}
                                        />
                                    )}
                                    linkRows={infoItems.map((item) => ({
                                        ...item,
                                        pressed: revealedExtra === item.id,
                                        onSelect: revealedExtra === item.id ? () => setRevealedExtra(null) : item.onSelect,
                                    }))}
                                />
                            </div>
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
                            </>
                            )}
                        </div>

            </ListPage>
            {externalLinkConfirm.request ? (
                <ConfirmModal
                    {...externalLinkConfirm.request}
                    onConfirm={externalLinkConfirm.onConfirm}
                    onCancel={externalLinkConfirm.onCancel}
                />
            ) : null}
        </PageFrame>
    );
}

/** Wide Home's detail panel: the page's content with no Screen around it. */
function EmbeddedPageFrame({ children }) {
    return children;
}

// Registry actions that act on a holding of an issued token. Native coins
// (BTC, LTC, DOGE) are not XChain-issued, so none of these apply to them.
const TOKEN_HOLDER_ACTION_IDS = new Set([
    'destroy', 'sweep', 'dispenser', 'dispenser-explorer', 'airdrop',
    'swap', 'cross-chain-swap', 'bridge-move',
]);
// Registry actions only the token's issuer can take.
const TOKEN_OWNER_ACTION_IDS = new Set([
    'mint', 'lock', 'description', 'transfer', 'oracle', 'dividend', 'bridge-settings',
]);
// Registry actions that only look things up; every other registry action
// builds a transaction for this wallet to sign.
const READ_ONLY_ACTION_IDS = new Set(['dispenser-explorer']);
// Holder actions that spend this token, so they need a balance of it.
const NEEDS_BALANCE_ACTION_IDS = new Set([
    'destroy', 'dispenser', 'airdrop', 'swap', 'cross-chain-swap', 'bridge-move',
]);
// The star on the Pin row, drawn as Home's row star is.
function PinGlyph() {
    return (
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
    );
}

// Registry actions drawn in the danger tone (G101): they burn tokens.
const DANGER_ACTION_IDS = new Set(['destroy']);
// The one line under each registry action's title on this page, naming the
// token it acts on. An id missing here falls back to the registry's own text.
const ACTION_DESCRIPTION_KEYS = {
    destroy: 'tokenDetail.actionDescriptions.destroy',
    sweep: 'tokenDetail.actionDescriptions.sweep',
    dispenser: 'tokenDetail.actionDescriptions.dispenser',
    'dispenser-explorer': 'tokenDetail.actionDescriptions.dispenserExplorer',
    airdrop: 'tokenDetail.actionDescriptions.airdrop',
    swap: 'tokenDetail.actionDescriptions.swap',
    'cross-chain-swap': 'tokenDetail.actionDescriptions.crossChainSwap',
    'bridge-move': 'tokenDetail.actionDescriptions.bridgeMove',
    mint: 'tokenDetail.actionDescriptions.mint',
    lock: 'tokenDetail.actionDescriptions.lock',
    description: 'tokenDetail.actionDescriptions.description',
    transfer: 'tokenDetail.actionDescriptions.transfer',
    oracle: 'tokenDetail.actionDescriptions.oracle',
    dividend: 'tokenDetail.actionDescriptions.dividend',
    'bridge-settings': 'tokenDetail.actionDescriptions.bridgeSettings',
};

/**
 * The Actions tab's rows for one coin or token: the per-asset basics
 * (Send, Receive, Exchange), the registry actions this asset kind allows
 * and the price alert, then the issuer's actions in their own group. A
 * gated action stays as a disabled row with its reason; an action the shell
 * does not wire is left out, as the registry does.
 */
function buildAssetActionTiles({
    assetActions,
    isNative,
    isSignerMode,
    isWatcherMode,
    tick,
    sourceCoin,
    atomicQuantity,
    networkActionsAvailable,
    core,
    tail,
    manage,
    ownerGroupsShown = false,
}) {
    const entries = isSignerMode || isNative || !assetActions
        ? []
        : buildActionEntries(assetActions);
    const registryTile = (entry) => {
        const EntryIcon = ENTRY_ICON[entry.id] || Icon.iconForLabel?.(entry.label) || Icon.MoreIcon;
        let reason = null;
        if (isWatcherMode && !READ_ONLY_ACTION_IDS.has(entry.id)) reason = t('tokenDetail.actions.needsSigner');
        else if (!networkActionsAvailable) reason = t('tokenDetail.actions.needsNetwork');
        else if (NEEDS_BALANCE_ACTION_IDS.has(entry.id) && atomicQuantity != null && atomicQuantity <= 0n) {
            reason = t('tokenDetail.actions.needsBalance', { tick });
        } else if (entry.id === 'destroy') {
            reason = destroyRefusalFor({ tick, sourceCoin })?.reason || null;
        }
        const descriptionKey = ACTION_DESCRIPTION_KEYS[entry.id];
        return {
            id: entry.id,
            label: entry.label,
            description: descriptionKey ? t(descriptionKey, { tick }) : entry.description,
            Icon: EntryIcon,
            onSelect: entry.onSelect,
            shortReason: reason,
            danger: DANGER_ACTION_IDS.has(entry.id),
        };
    };
    // With the issuer's groups on the page, an action they hold (Destroy,
    // Dispenser, Airdrop, Mint, Lock, ...) is listed once, in its group; the
    // registry's issuer actions the groups lack (Publish oracle price) join them.
    const holder = entries
        .filter((e) => TOKEN_HOLDER_ACTION_IDS.has(e.id))
        .filter((e) => !ownerGroupsShown || !TOKEN_OWNER_GROUP_ACTION_IDS.has(e.id))
        .map(registryTile);
    const owner = !ownerGroupsShown
        ? entries.filter((e) => TOKEN_OWNER_ACTION_IDS.has(e.id)).map(registryTile)
        : [];
    const ownerExtra = ownerGroupsShown
        ? entries
            .filter((e) => TOKEN_OWNER_ACTION_IDS.has(e.id) && !REGISTRY_OWNER_IDS_IN_GROUPS.has(e.id))
            .map(registryTile)
        : [];
    const main = [...core.filter(Boolean), ...holder, ...tail.filter(Boolean)];
    const ownerTiles = [manage, ...owner].filter(Boolean);
    return { main, owner: ownerTiles, ownerExtra };
}

// Registry issuer actions the issuer's groups already offer under their own
// ids (lock is Lock settings, bridge-settings is Bridge).
const REGISTRY_OWNER_IDS_IN_GROUPS = new Set(['mint', 'lock', 'description', 'transfer', 'dividend', 'bridge-settings']);

function capitalize(text) {
    const value = String(text || '');
    return value.charAt(0).toUpperCase() + value.slice(1);
}

// A short reason ("needs a balance of X.") is a fragment; under a row's
// title it stands alone, so it opens with a capital.
function rowReason(tile) {
    if (tile.reason) return tile.reason;
    if (!tile.shortReason) return null;
    return capitalize(tile.shortReason);
}

function AssetActionRow({ tile }) {
    const RowIcon = tile.Icon || Icon.MoreIcon;
    const reason = rowReason(tile);
    const blocked = Boolean(reason || tile.disabled || typeof tile.onSelect !== 'function');
    return (
        <ActionListItem
            data-action-id={tile.id}
            icon={<RowIcon />}
            title={tile.label}
            description={tile.description}
            onClick={tile.onSelect}
            tone={tile.danger ? 'danger' : 'default'}
            disabled={blocked}
            disabledReason={reason || undefined}
        />
    );
}

// The Actions tab (G101): one action list for everyone, then the issuer's
// actions as lists under their own headings (one per group when the shell
// wires the issuer's handlers).
function AssetActionsPanel({ grid, tick, ownerGroups = null, ownerFirst = false }) {
    if (grid.main.length === 0 && grid.owner.length === 0 && !ownerGroups?.length) {
        return <p className={styles.muted}>{t('tokenDetail.actions.empty')}</p>;
    }
    // Opened from My Tokens, the page is for managing the token, so the issuer's
    // groups lead and the everyday coin actions follow.
    const mainList = grid.main.length > 0 ? (
        <ActionList label={t('tokenDetail.actions.label', { tick })}>
            {grid.main.map((tile) => <AssetActionRow key={tile.id} tile={tile} />)}
        </ActionList>
    ) : null;
    return (
        <div className={styles.assetActions}>
            {ownerFirst ? null : mainList}
            {grid.owner.length > 0 ? (
                <section className={styles.assetActionOwner} aria-label={t('tokenDetail.actions.ownerHeading')}>
                    <SectionHeader title={t('tokenDetail.actions.ownerHeading')} />
                    <ActionList label={t('tokenDetail.actions.ownerHeading')}>
                        {grid.owner.map((tile) => <AssetActionRow key={tile.id} tile={tile} />)}
                    </ActionList>
                </section>
            ) : null}
            {ownerGroups?.length ? (
                <TokenOwnerActionGroups groups={ownerGroups} sectionClassName={styles.assetActionOwner} />
            ) : null}
            {ownerFirst ? mainList : null}
        </div>
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

// Chart placeholder for real wallets: a price line is drawn only from real
// history (wallet rule: never fabricate a number), so an absent series gets
// this message instead of a synthesized walk.
const NO_PRICE_HISTORY = 'No price history yet';

/**
 * The market state behind a coin or token's balance card. One read feeds the
 * price chart, its range buttons, the change pill and the stats row, so all
 * of them follow the same selected range.
 *
 * Every wallet opens on 1W; native coins use hourly history for 24h and 1W,
 * then lazily request daily history for longer ranges. Demo wallets
 * synthesize every range without requesting history.
 */
function useMarketData({ enabled, isNative, nativePrice, isDemo, assetInfo, tick, chainId, fiatRate, fiatRateSource, fiatCurrency, loading, loadFailed = false, tokenSeriesFor = null, tokenSeriesLoading = false, showFiat = true, hasFiatPrice = true, nativeBalanceChart = false, holdingSeriesFor = null }) {
    const [rangeId, setRangeId] = useState(defaultRangeId());
    const range = CHART_RANGES.find((item) => item.id === rangeId) || CHART_RANGES[0];
    // Once a daily range has been picked the daily request stays armed, so
    // moving back to 1W and out again does not reload the line.
    const [dailyArmed, setDailyArmed] = useState(false);
    useEffect(() => {
        if (range.source === 'daily') setDailyArmed(true);
    }, [range.source]);
    const wantsDailyHistory = enabled && isNative && !isDemo && Boolean(nativePrice.entry) && !nativePrice.disabled
        && (dailyArmed || range.source === 'daily');
    const dailyNativePrice = useNativePrice(wantsDailyHistory ? chainId : null, {
        includeHistory: true,
        fiatCurrency,
    });

    // The stats keep the same shape whatever the data: placeholders stand in
    // when the price oracle is disabled, still loading, or has nothing for
    // this asset (testnet, regtest).
    let priceCell = '-';
    let priceLabel = 'Price';
    let marketCapCell = '-';
    let pctLabel24h;
    let pctTone24h;
    let pct24h = '-';
    let sparkline = null;
    let note = null;
    let chartBusy = false;
    let showRanges = false;
    let seriesKind = 'price';

    if (isNative && nativeBalanceChart) {
        // A coin on a test network has no price to ask for, so its hero draws
        // the balance this wallet's own rows prove, as a token's does.
        chartBusy = tokenSeriesLoading;
        sparkline = chartBusy || typeof tokenSeriesFor !== 'function' ? null : tokenSeriesFor(range);
        if (sparkline) seriesKind = 'balance';
        showRanges = Boolean(sparkline);
        if (!chartBusy && !sparkline) note = 'No market data available for this network.';
    } else if (isNative) {
        const nativeLoading = nativePrice.loading
            || (!nativePrice.entry && !nativePrice.disabled && !nativePrice.error);
        const dailyHistoryLoading = wantsDailyHistory && range.source === 'daily' && (dailyNativePrice.loading
            || (!dailyNativePrice.entry && !dailyNativePrice.disabled && !dailyNativePrice.error));
        // True when any range has a recorded series, so the range buttons stay
        // up even while the selected range has no history of its own.
        let anyRecordedRange = false;
        if (nativePrice.disabled) {
            note = 'Price data is disabled. Enable “Native coin price data” in Settings → Privacy to populate this section.';
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
            if (!sparkline && !dailyHistoryLoading) {
                note = anyRecordedRange ? NO_PRICE_HISTORY : 'No market data available for this network.';
            }
        } else if (!nativeLoading) {
            note = 'No market data available for this network.';
        }
        chartBusy = nativeLoading || dailyHistoryLoading;
        showRanges = !nativeLoading && (Boolean(sparkline) || anyRecordedRange || dailyHistoryLoading);
    } else {
        // Token path: try assetInfo.marketPrice first (XCP-denominated
        // price from the indexer); if unavailable, fall back to fiatRate
        // passed in from the balance fixture so the demo wallet still
        // gets a populated chart + 24h cell. Both paths feed into the
        // same synthesized sparkline keyed on tick+chain.
        const nativeTick = nativeTickerOf(chainId);
        const marketPriceNum = assetInfo?.marketPrice != null ? Number(assetInfo.marketPrice) : null;
        let hint = null;
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
        chartBusy = loading;
        showRanges = Boolean(sparkline) && isDemo;
        if (!chartBusy && !sparkline) {
            note = loadFailed ? (hint || 'Market data is unavailable.') : NO_PRICE_HISTORY;
        }
    }

    // The selected unit owns the series, not only its labels. Asset mode is
    // the replayed balance. Fiat mode multiplies that balance by the price at
    // each matching point, so receives and sends affect the value line too.
    const balanceLine = !tokenSeriesLoading && typeof tokenSeriesFor === 'function'
        ? tokenSeriesFor(range)
        : null;
    if (!showFiat && balanceLine) {
        sparkline = balanceLine;
        seriesKind = 'balance';
        chartBusy = false;
        note = null;
        showRanges = true;
    } else if (showFiat && balanceLine && seriesKind === 'price' && sparkline) {
        sparkline = multiplyAlignedSeries(balanceLine, sparkline);
        seriesKind = 'value';
        note = null;
        showRanges = Boolean(sparkline);
    }

    // Wide Home's panel: the holding's value line replaces the price or
    // balance line once the prices it needs are in. A coin brings its own
    // price entry (with the daily series this page loaded), so the panel's
    // line reads the same prices the page shows. Without a price history the
    // card says so instead of drawing a line.
    let holding = false;
    // A coin waits for its prices; a token's line needs nothing the page
    // is still loading (its metadata only feeds the stats).
    const holdingReady = isNative ? !chartBusy && !nativePrice.disabled : true;
    if (typeof holdingSeriesFor === 'function' && holdingReady) {
        const ownEntry = isNative && nativePrice.entry
            ? (dailyNativePrice.entry
                ? { ...nativePrice.entry, historyDaily: dailyNativePrice.entry.historyDaily ?? null }
                : nativePrice.entry)
            : null;
        const result = holdingSeriesFor(range, ownEntry);
        if (result) {
            holding = true;
            chartBusy = false;
            sparkline = result.series;
            seriesKind = showFiat ? 'value' : 'balance';
            note = result.series ? null : NO_PRICE_HISTORY;
            showRanges = Boolean(result.series) || (isNative && showRanges);
        }
    }

    // Value remains a real mode for an asset with no market price. Its empty
    // chart keeps the hero's shape, names the missing price, and leaves both
    // the scale and change pill out until a source becomes available.
    const noMarketPrice = showFiat && !hasFiatPrice;
    if (noMarketPrice) {
        holding = false;
        chartBusy = false;
        sparkline = null;
        seriesKind = 'value';
        note = `No market price for ${tick} yet`;
        showRanges = false;
    }

    return {
        range,
        setRangeId,
        sparkline,
        seriesKind,
        holding,
        chartBusy,
        showRanges,
        noMarketPrice,
        note,
        stats: { priceLabel, priceCell, marketCapCell, pct24h, pctLabel24h, pctTone24h },
    };
}

function multiplyAlignedSeries(balances, prices) {
    if (!Array.isArray(balances) || balances.length === 0 || !Array.isArray(prices) || prices.length === 0) return null;
    if (prices.length === 1) return balances.map((balance) => balance * prices[0]);
    const lastBalance = Math.max(1, balances.length - 1);
    const lastPrice = prices.length - 1;
    return balances.map((balance, index) => {
        const at = (index / lastBalance) * lastPrice;
        const left = Math.floor(at);
        const right = Math.min(lastPrice, left + 1);
        const price = prices[left] + ((prices[right] - prices[left]) * (at - left));
        return balance * price;
    });
}

/**
 * The coin or token's price chart drawn behind its balance card, as Home
 * draws the portfolio chart (PortfolioChart's `behind` mode): the range
 * buttons sit along the card's foot. Privacy mode hides the line and the
 * buttons but keeps their room.
 */
function MarketPanel({ market, hidden, showFiat, currency, unit, locale }) {
    const panelId = useId();
    const { range, setRangeId, sparkline, chartBusy, showRanges, seriesKind = 'price', holding = false, noMarketPrice = false, note = null } = market;
    const formatChartAmount = (value) => formatCompactChartValue(value, showFiat
        ? { locale, currency }
        : { locale, unit });
    // Wide Home's holding line: with no price history the card says so where
    // the line would be.
    const holdingNote = (noMarketPrice || holding) && !sparkline && !chartBusy && !hidden ? note : null;
    return (
        <section
            className={`${portfolioChartStyles.wrap} ${portfolioChartStyles.behind}${hidden ? ` ${portfolioChartStyles.behindHidden}` : ''}`}
            data-chart-behind="true"
            data-series-kind={seriesKind}
            aria-label={seriesKind === 'balance'
                ? t('tokenDetail.chart.balance')
                : seriesKind === 'value' ? t('tokenDetail.chart.value') : t('tokenDetail.chart.price')}
            aria-busy={chartBusy || undefined}
        >
            <div
                id={panelId}
                role="tabpanel"
                aria-labelledby={`${panelId}-tab-${range.id}`}
            >
                <div className={portfolioChartStyles.slot}>
                    {/* A balance or value line is the holding itself, so privacy
                        mode leaves it out of the page, not only out of sight. */}
                    {sparkline && !chartBusy && !(hidden && seriesKind !== 'price') ? (
                        <div className={portfolioChartStyles.chart}>
                            <Sparkline
                                series={sparkline}
                                height="100%"
                                strokeColor={BEHIND_CHART_STROKE}
                                areaFill={BEHIND_CHART_FILL}
                                edgeToEdge
                                rangeLabel={range.label}
                                formatValue={formatChartAmount}
                                formatScaleValue={formatChartAmount}
                                showScale
                                heroScale
                                label={showFiat
                                    ? t('tokenDetail.chart.valueOver', { range: range.label })
                                    : t('tokenDetail.chart.balanceOver', { range: range.label })}
                            />
                        </div>
                    ) : null}
                </div>
            </div>
            {/* With no history to switch between, the buttons keep their
                room unseen so the card holds one height. */}
            <div className={portfolioChartStyles.foot}>
                {holdingNote ? (
                    <div className={`${portfolioChartStyles.tokenNote}${showRanges ? '' : ` ${styles.noteInIdleRanges}`}`} data-chart-note={noMarketPrice ? 'no-market-price' : 'no-price-history'}>{holdingNote}</div>
                ) : null}
                <ChartRangeTabs
                    panelId={panelId}
                    ranges={CHART_RANGES}
                    rangeId={range.id}
                    onSelect={setRangeId}
                    className={showRanges ? '' : styles.rangesIdle}
                />
            </div>
        </section>
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
    marketRows = null,
    linkRows = [],
    extraRows = [],
    query = '',
}) {
    const [balanceHidden] = useBalancesHidden();
    const factsMatch = matchesFilter(query, [
        tick, displayName, kindLabel(kind), descriptor?.displayName, assetInfo?.description,
        assetInfo?.creator, assetInfo?.totalSupply, assetInfo?.maxSupply, divisibility,
        ...extraRows.flatMap((row) => [row.label, row.value]),
    ]);
    if (!factsMatch) return <EmptyState title="No matching details" body="Try another name, category, link, or fact." />;
    return (
        <div
            className={styles.infoStack}
            role="region"
            aria-label="Token details"
            aria-busy={loading || undefined}
        >
            <ul className={styles.detailList} aria-label="Token detail fields">
                {/* The market rows open the list (TokenMarketRows). They describe
                    the asset, not the holding, so privacy mode leaves them. */}
                {marketRows}
                {isNative ? <DetailRow label="Name">{displayName || tick}</DetailRow> : null}
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
                {/* The issuer's facts (supply cap, lock states, pause state,
                    creation block) in the same card, before the link rows. */}
                {extraRows.map((row) => (
                    <li key={row.id} data-detail-id={row.id}>
                        <ListRow className={styles.detailRow} title={row.label} trailing={row.value} />
                    </li>
                ))}
                {linkRows.map(({ id, label, onSelect, pressed }) => (
                    <li key={id}>
                        <ListRow
                            className={styles.detailRow}
                            title={label}
                            onClick={onSelect}
                            chevron
                            data-detail-id={id}
                            aria-expanded={pressed ? 'true' : 'false'}
                        />
                    </li>
                ))}
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

function projectEntry(project) {
    if (typeof project === 'string') return { project, linkActionIndex: null, rosterActionIndex: null };
    return project && typeof project === 'object' ? project : null;
}

function tokenNameFromRow(row) {
    return row?.tick || row?.info?.tick || row?.name || row?.ticker || null;
}

function TokenProfile({ assetInfo, tick, chainId, loading, loadFailed, explorerUrl, settings, children, query, onOpenExternal }) {
    if (loading) {
        return <div className={styles.profileCard} role="status" aria-label="Loading token profile"><Skeleton height={180} /></div>;
    }
    if (loadFailed && (!assetInfo || assetInfo.loadError)) return null;
    const projects = (Array.isArray(assetInfo?.projects) ? assetInfo.projects : []).map(projectEntry).filter(Boolean);
    const childTicks = (Array.isArray(children) ? children : []).map(tokenNameFromRow).filter(Boolean);
    const parentTick = String(tick).includes('.') ? String(tick).split('.').slice(0, -1).join('.') : null;
    const hasInfo = Boolean(assetInfo?.tisAvailable
        || assetInfo?.tisReadError
        || assetInfo?.name
        || assetInfo?.description
        || hasSupplementalTokenInfo(assetInfo)
        || hasPublishedMedia(assetInfo)
        || projects.length
        || assetInfo?.registry
        || parentTick
        || childTicks.length);
    if (!hasInfo) {
        return matchesFilter(query, ['No token information']) ? (
            <div className={styles.quietNote} role="note">
                <Icon.InfoIcon aria-hidden="true" />
                <span><strong>No token information</strong><small>The issuer has not published a token information document.</small></span>
            </div>
        ) : null;
    }
    const profileValues = [
        assetInfo?.name, assetInfo?.description, assetInfo?.owner, assetInfo?.contacts,
        assetInfo?.categories, assetInfo?.dns, tokenPublishedLinks(assetInfo), projects,
        assetInfo?.registry, parentTick, childTicks,
    ];
    if (!matchesFilter(query, profileValues)) return null;
    const images = Array.isArray(assetInfo?.images) ? assetInfo.images : [];
    const banner = images.find((image) => ['large', 'hires', 'hi-res', 'highres', 'standard'].includes(String(image?.type || '').toLowerCase()) && safeImageSrc(image?.url));
    const logo = images.find((image) => String(image?.type || '').toLowerCase() === 'icon' && safeImageSrc(image?.url)) || images.find((image) => safeImageSrc(image?.url));
    const hasOwner = Boolean(assetInfo?.owner && (assetInfo.owner.name || assetInfo.owner.title || assetInfo.owner.organization));
    const hasContacts = Array.isArray(assetInfo?.contacts) && assetInfo.contacts.length > 0;
    const publishedLinks = tokenPublishedLinks(assetInfo);
    const hasLinks = publishedLinks.websites.length > 0 || publishedLinks.socials.length > 0;
    return (
        <section className={styles.profileCard} aria-label="Token information profile">
            {banner ? <img className={styles.profileBanner} src={banner.url} alt="" /> : null}
            <div className={styles.profileBody}>
                {assetInfo?.tisReadError ? (
                    <div className={styles.quietNote} role="note">
                        <Icon.InfoIcon aria-hidden="true" />
                        <span>The token information file couldn't be read</span>
                    </div>
                ) : null}
                <div className={styles.profileIdentity}>
                    {logo ? <AssetArtwork src={logo.url} className={styles.profileLogo} fallbackClassName={styles.profileLogoFallback} fallbackText={tick} /> : null}
                    <span><strong>{assetInfo?.name || tick}</strong><small>{tick}</small></span>
                </div>
                {projects.map((project) => {
                    const proofAction = project.linkActionIndex ?? project.rosterActionIndex;
                    const proofUrl = proofAction == null ? null : explorerPageUrl({ chainId, kind: 'action', value: proofAction, settings });
                    if (!proofUrl) return null;
                    return (
                        <div className={styles.officialLine} key={`${project.project}:${project.linkActionIndex || ''}`}>
                            <Icon.CheckIcon aria-hidden="true" />
                            <span>Official: part of the <strong>{project.project}</strong> project</span>
                            {proofUrl ? <a href={proofUrl} target="_blank" rel="noreferrer noopener">Proof <Icon.ExternalLinkIcon aria-hidden="true" /></a> : null}
                        </div>
                    );
                })}
                {assetInfo?.description ? <p className={styles.profileDescription}>{assetInfo.description}</p> : null}
                {Array.isArray(assetInfo?.categories) && assetInfo.categories.length > 0 ? (
                    <div className={styles.categoryChips} aria-label="Token categories">
                        {assetInfo.categories.map((category, index) => <span key={`${category.type}:${index}`}>{capitalize(category.type)}: {category.value}</span>)}
                    </div>
                ) : null}
                {hasLinks ? <LinksAndFiles assetInfo={assetInfo} onOpenExternal={onOpenExternal} /> : null}
                {hasOwner ? <OwnerBlock owner={assetInfo.owner} /> : null}
                {hasContacts ? <ContactsBlock contacts={assetInfo.contacts} onOpenExternal={onOpenExternal} /> : null}
                {Array.isArray(assetInfo?.dns) && assetInfo.dns.length > 0 ? <DnsBlock dns={assetInfo.dns} /> : null}
                {assetInfo?.packs && Object.keys(assetInfo.packs).length > 0 ? <PacksBlock packs={assetInfo.packs} /> : null}
                {assetInfo?.registry ? (
                    <p className={styles.projectOwnership}>
                        This token owns the <strong>{tick}</strong> project:{' '}
                        {explorerUrl ? <a href={explorerUrl} target="_blank" rel="noreferrer noopener">view its {formatWithThousands(String(assetInfo.registry.total))} official tokens <Icon.ExternalLinkIcon aria-hidden="true" /></a> : `view its ${formatWithThousands(String(assetInfo.registry.total))} official tokens`}.
                    </p>
                ) : null}
                {parentTick ? (
                    <p className={styles.collectionLine}>Parent token: <a href={explorerPageUrl({ chainId, kind: 'token', value: parentTick, settings }) || '#'} target="_blank" rel="noreferrer noopener">{parentTick} <Icon.ExternalLinkIcon aria-hidden="true" /></a></p>
                ) : null}
                {childTicks.length > 0 ? (
                    <div className={styles.collectionChildren}><strong>Child tokens</strong>{childTicks.map((child) => <a key={child} href={explorerPageUrl({ chainId, kind: 'token', value: child, settings }) || '#'} target="_blank" rel="noreferrer noopener">{child} <Icon.ExternalLinkIcon aria-hidden="true" /></a>)}</div>
                ) : null}
                {/* Issuer HTML never enters the wallet DOM, even in a sandboxed
                    iframe. The explorer owns the isolated presentation surface. */}
                {assetInfo?.htmlAvailable && explorerUrl ? (
                    <a className={styles.explorerInfoLink} href={explorerUrl} target="_blank" rel="noreferrer noopener">Interactive content: view on the explorer <Icon.ExternalLinkIcon aria-hidden="true" /></a>
                ) : null}
            </div>
        </section>
    );
}

function fileDisplayName(file, fallback = 'Untitled file') {
    if (file?.title || file?.name) return file.title || file.name;
    // A data: URL's "path" is its payload, so it names the file by its label.
    if (isDataUrl(file?.url)) return embeddedDataLabel(file.url);
    try {
        const path = new URL(file?.url || '').pathname.split('/').filter(Boolean);
        return decodeURIComponent(path[path.length - 1] || fallback);
    } catch {
        return fallback;
    }
}

export function tokenFileEntries(assetInfo) {
    const out = [];
    const add = (kind, file, index) => {
        if (!file) return;
        const url = safeHttpUrl(file.url) || safeImageSrc(file.url);
        out.push({
            ...file,
            kind,
            url,
            id: `${kind}:${file.dataRef || file.actionIndex || url || file.source || 'entry'}:${index}`,
            displayName: fileDisplayName(file, `${kind} file`),
        });
    };
    for (const kind of ['images', 'audio', 'video', 'files']) {
        for (const [index, file] of (Array.isArray(assetInfo?.[kind]) ? assetInfo[kind] : []).entries()) {
            add(kind === 'images' ? 'image' : kind === 'files' ? 'file' : kind, file, index);
        }
    }
    for (const [index, file] of (Array.isArray(assetInfo?.linkedFiles) ? assetInfo.linkedFiles : []).entries()) {
        if (!file.gated) add(String(file.type || '').startsWith('image/') ? 'image' : 'file', file, index);
    }
    const seen = new Set();
    return out.filter((file) => {
        const key = file.dataRef || file.actionIndex || file.url || `${file.kind}:${file.source}:${file.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function PublicFileTile({ file, onOpenExternal }) {
    const [imageFailed, setImageFailed] = useState(false);
    // Only an http(s) address opens; a picture data: URL is a thumbnail source
    // and never a link (safeImageSrc's contract).
    const canOpen = Boolean(safeHttpUrl(file.url)) && !file.locked;
    // A picture embedded only in the source (normalizeMediaUrl takes no data:
    // URL as an address) still draws when safeImageSrc admits it.
    const previewSrc = file.kind === 'image' && !file.locked
        ? safeImageSrc(file.url) || (isDataUrl(file.source) ? safeImageSrc(file.source) : null)
        : null;
    const body = (
        <>
            <span className={styles.fileTilePreview}>
                {previewSrc && !imageFailed ? <img src={previewSrc} alt={file.displayName} loading="lazy" onError={() => setImageFailed(true)} /> : <Icon.FileTypeIcon type={file.type || file.kind} aria-label={imageFailed ? `${file.displayName} unavailable` : undefined} />}
                {(file.kind === 'audio' || file.kind === 'video') ? <span className={styles.fileTilePlay}><Icon.PlayIcon /></span> : null}
            </span>
            <span className={styles.fileTileBody}>
                <strong>{file.title || file.name || file.displayName}</strong>
                {file.name ? <small>Name: {file.name}</small> : null}
                {file.title ? <small>Title: {file.title}</small> : null}
                <small>Type: {file.type || file.kind || 'Unknown'}</small>
                {file.size ? <small>Size: {file.size}</small> : null}
                {file.hash ? <small className={styles.fileHash}>Hash: {file.hash}</small> : null}
                <small>Locked: {file.locked ? 'Yes' : 'No'}</small>
                {file.packId ? <small>Pack ID: {file.packId}</small> : null}
                {file.dataRef ? <small>Linked action: {file.dataRef}</small> : null}
                {file.source ? <small>{isDataUrl(file.source) ? embeddedDataLabel(file.source) : `URL: ${file.source}`}</small> : null}
            </span>
            {canOpen ? <Icon.ExternalLinkIcon aria-hidden="true" /> : null}
        </>
    );
    if (!canOpen) return <div className={styles.fileTile}>{body}</div>;
    return (
        <a
            className={styles.fileTile}
            href={file.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${file.displayName}`}
            onClick={(event) => {
                event.preventDefault();
                onOpenExternal?.(file.url);
            }}
        >
            {body}
            <span className="sr-only" aria-hidden="true">↗</span>
        </a>
    );
}

function FilesPanel({ walletId, chainId, tick, assetInfo, loading, error, groups, messaging, quantity, divisibility, query, displayName, onOpenExternal }) {
    const viewTabsId = useId();
    const [view, setView] = useState('all');
    const publicFiles = tokenFileEntries(assetInfo).filter((file) => matchesFilter(query, [file.displayName, file.title, file.name, file.type, file.hash]));
    const holderGroups = Array.isArray(groups) ? groups.map((group) => ({
        ...group,
        files: (Array.isArray(group.files) ? group.files : []).filter((file) => matchesFilter(query, [file.name, file.title, file.type])),
    })).filter((group) => group.files.length > 0) : groups;
    const holderCount = Array.isArray(holderGroups) ? holderGroups.reduce((count, group) => count + group.files.length, 0) : 0;
    const totalCount = publicFiles.length + holderCount;
    const tabs = [
        { id: 'all', label: <><Icon.GridIcon aria-hidden="true" /> All</> },
        { id: 'public', label: <><Icon.ExternalLinkIcon aria-hidden="true" /> Public</> },
        { id: 'holders', label: <><Icon.LockIcon aria-hidden="true" /> Holders</> },
    ];
    if (loading && !assetInfo) return <Skeleton height={180} ariaLabel="Loading token files" />;
    const showHolderSection = view === 'all' || view === 'holders';
    return (
        <div className={styles.filesPanel}>
            <Tabs id={viewTabsId} className={styles.filesToggle} items={tabs} value={view} onChange={setView} panelId={`${viewTabsId}-panel`} aria-label="File visibility" />
            <div id={`${viewTabsId}-panel`} role="tabpanel" aria-labelledby={`${viewTabsId}-tab-${view}`}>
                {(view === 'all' || view === 'public') && publicFiles.length > 0 ? <div className={styles.fileGrid}>{publicFiles.map((file) => <PublicFileTile key={file.id} file={file} onOpenExternal={onOpenExternal} />)}</div> : null}
                {showHolderSection && (holderCount > 0 || (loading && !groups) || error) ? (
                    <GatedContentPanel
                        walletId={walletId}
                        chainId={chainId}
                        tick={tick}
                        groups={holderGroups}
                        loading={loading && !groups}
                        error={error}
                        packsMeta={assetInfo?.packs || {}}
                        messaging={messaging}
                        ownsToken={(() => { try { return BigInt(String(quantity || '0')) > 0n; } catch { return false; } })()}
                        displayName={displayName}
                        heldLabel={amountWithUnit(quantity, divisibility, tick)}
                        showSummary={view === 'holders'}
                    />
                ) : null}
                {totalCount === 0 && !loading && !error ? (
                    assetInfo?.tisReadError ? (
                        <div className={styles.quietNote} role="note"><Icon.InfoIcon aria-hidden="true" /><span>The token information file couldn't be read</span></div>
                    ) : <EmptyState title="No files yet" body={query ? 'No files match this filter.' : 'Media and files published or attached on chain appear here.'} titleAs="p" />
                ) : null}
            </div>
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

function PacksBlock({ packs }) {
    return (
        <div className={styles.metaBlock}>
            <SectionHeader title="Packs" />
            <table className={styles.metaTable} aria-label="Token content packs">
                <tbody>
                    {Object.entries(packs).map(([packId, pack]) => (
                        <tr key={packId} className={styles.metaRow}>
                            <th scope="row">{packId}</th>
                            <td>
                                {pack?.name ? <div>{pack.name}</div> : null}
                                {pack?.description ? <div>{pack.description}</div> : null}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// A locked entry never carries a URL (its raw bytes are ciphertext), so it is
// kept by its locked flag rather than dropped by the URL test.
function tokenMediaBuckets(assetInfo) {
    const keep = (entry) => entry?.locked === true || safeHttpUrl(entry?.url);
    const images = Array.isArray(assetInfo?.images)
        ? assetInfo.images.filter((i) => {
            const mediaType = String(i?.type || '').toLowerCase();
            return (i?.locked === true || safeImageSrc(i?.url))
                && (mediaType === 'large' || mediaType === 'hires' || mediaType === 'hi-res' || mediaType === 'highres');
        })
        : [];
    const audio = Array.isArray(assetInfo?.audio)
        ? assetInfo.audio.filter(keep)
        : [];
    const video = Array.isArray(assetInfo?.video)
        ? assetInfo.video.filter(keep)
        : [];
    const files = Array.isArray(assetInfo?.files)
        ? assetInfo.files.filter(keep)
        : [];
    return { images, audio, video, files };
}

function hasPublishedMedia(assetInfo) {
    const media = tokenMediaBuckets(assetInfo);
    return media.images.length > 0 || media.audio.length > 0 || media.video.length > 0 || media.files.length > 0;
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

const CONTACT_LABELS = {
    email: 'Email',
    phone: 'Phone',
    fax: 'Fax',
    url: 'Web',
    address: 'Address',
};

function ContactsBlock({ contacts, onOpenExternal }) {
    return (
        <div className={styles.metaBlock}>
            <SectionHeader title="Contact" />
            <table className={styles.metaTable} aria-label="Token contacts">
                <tbody>
                    {contacts.map((c, i) => {
                        const label = CONTACT_LABELS[c.type] || (c.type.charAt(0).toUpperCase() + c.type.slice(1));
                        const safeUrl = c.type === 'url' ? safeHttpUrl(c.value) : null;
                        let display = c.value;
                        if (safeUrl) {
                            display = (
                                <a
                                    href={safeUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        onOpenExternal?.(safeUrl);
                                    }}
                                >
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

function tokenPublishedLinks(assetInfo) {
    const websiteCandidates = Array.isArray(assetInfo?.websites) && assetInfo.websites.length > 0
        ? assetInfo.websites
        : [assetInfo?.websiteText || assetInfo?.website].filter(Boolean);
    const websites = websiteCandidates.flatMap((value) => typeof value === 'string'
        ? [{ value, url: safeHttpUrl(value) }]
        : []);
    const socials = Array.isArray(assetInfo?.socials)
        ? assetInfo.socials.flatMap((social) => {
            const value = typeof social?.value === 'string' ? social.value : social?.url;
            return typeof value === 'string' ? [{ ...social, value, url: safeHttpUrl(value) }] : [];
        })
        : [];
    return { websites, socials };
}

function LinksAndFiles({ assetInfo, onOpenExternal }) {
    const { websites, socials } = tokenPublishedLinks(assetInfo);
    const hasAnything = websites.length > 0 || socials.length > 0;
    if (!hasAnything) return null;
    const multipleWebsites = websites.length > 1;
    return (
        <div className={styles.linksBlock}>
            {websites.length > 0 ? (
                <div className={styles.socialsRow}>
                    {websites.map((website, i) => {
                        const content = <><span className={styles.socialChipIcon} aria-hidden="true"><Icon.ExternalLinkIcon /></span><span>{multipleWebsites ? `Website ${i + 1}` : 'Website'}: {website.value}</span></>;
                        return website.url ? (
                            <a
                                key={`${website.value}:${i}`}
                                href={website.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className={styles.socialChip}
                                title={website.value}
                                onClick={(event) => {
                                    event.preventDefault();
                                    onOpenExternal?.(website.url);
                                }}
                            >{content}<span className="sr-only" aria-hidden="true">↗</span></a>
                        ) : <span key={`${website.value}:${i}`} className={styles.socialChip}>{content}</span>;
                    })}
                </div>
            ) : null}
            {socials.length > 0 ? (
                <div className={styles.socialsRow}>
                    {socials.map((social, i) => {
                        const content = <><SocialIcon platform={social.platform} />{socialLabel(social.platform)}: {social.value}{social.url ? <span aria-hidden="true">↗</span> : null}</>;
                        return social.url ? (
                            <a
                                key={`${social.value}:${i}`}
                                href={social.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className={styles.socialChip}
                                title={social.value}
                                onClick={(event) => {
                                    event.preventDefault();
                                    onOpenExternal?.(social.url);
                                }}
                            >{content}<span className="sr-only" aria-hidden="true">↗</span></a>
                        ) : <span key={`${social.value}:${i}`} className={styles.socialChip}>{content}</span>;
                    })}
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

function searchableText(value) {
    if (value == null || value === false) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return String(value);
    if (Array.isArray(value)) return value.map(searchableText).join(' ');
    if (typeof value === 'object' && value.props) return searchableText(value.props.children);
    if (typeof value === 'object') return Object.values(value).map(searchableText).join(' ');
    return '';
}

function matchesFilter(query, values) {
    const wanted = String(query || '').trim().toLocaleLowerCase();
    if (!wanted) return true;
    return searchableText(values).toLocaleLowerCase().includes(wanted);
}

// Token-gated content panel: renders the list of gated FILEs published
// for this token, grouped by KEY_HASH so packs (multi-file shares-one-key
// drops) appear as a single header with member files underneath. Each
// group has an Unlock button that pops an inline form (pick address,
// enter password) and decrypts every file in the group; viewers render
// inline for text / JSON / images and as a download link for everything
// else. See xchain-documentation/protocol/token-gated-content.md.
function GatedContentPanel({ walletId, chainId, tick, groups, loading, error, packsMeta, messaging, ownsToken, displayName, heldLabel = `0 ${tick}`, showSummary = false }) {
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
            .catch((err) => setAddressesError(userFacingMessage(err, 'Failed to load addresses.')))
            .finally(() => setAddressesLoading(false));
    }, [addresses, addressesLoading, messaging, walletId, chainId]);

    if (loading) return <p className={styles.muted}>Loading gated content…</p>;
    if (error) return <Notice tone="danger" title="Files unavailable">{error}</Notice>;
    if (!groups || groups.length === 0) {
        return (
            <EmptyState
                title="No token-gated content"
                body="Holders unlock creator drops, packs, and sealed bundles here when the issuer publishes locked content for this token."
                titleAs="p"
            />
        );
    }
    const thresholds = groups.flatMap((group) => group.files || []).map((file) => file.gateMinAmount || '1');
    const orderedThresholds = [...new Set(thresholds)].sort((a, b) => Number(a) - Number(b));
    const firstThreshold = orderedThresholds[0] || '1';
    const lastThreshold = orderedThresholds[orderedThresholds.length - 1] || firstThreshold;
    const firstCount = thresholds.filter((threshold) => Number(threshold) <= Number(firstThreshold)).length;
    const allCount = thresholds.length;
    return (
        <div className={styles.gatedContent}>
            {showSummary ? (
                <div className={styles.holdersSummary}>
                    <strong>
                        Hold {formatWithThousands(firstThreshold)} for {firstCount} {firstCount === 1 ? 'file' : 'files'}, {formatWithThousands(lastThreshold)} for all {allCount}
                    </strong>
                    <span>You hold {heldLabel.endsWith(` ${tick}`) ? heldLabel.slice(0, -tick.length - 1) : heldLabel}</span>
                </div>
            ) : null}
            {/* PC-26: the send-side constraints, stated where holders learn
                the token is gated. Key handoff is Send-only and needs the
                recipient's on-chain pubkey. */}
            <Notice tone="info" title="Holder unlocks">
                Sending {tick} hands the unlock key to the recipient automatically,
                but only through a direct Send, and only to addresses that have made
                at least one transaction. Tokens received via airdrops, dispensers,
                trades, or dividends arrive without the key.
            </Notice>
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
                        key={`${g.publisher || ''}|${g.keyHash}`}
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

/** @typedef {{ plaintextBase64: string, byteLength: number, storedForm: boolean, inflateError: string | null }} UnlockedGatedFile */

// Keeps the inflate outcome beside the bytes so the viewer can say when it is
// showing a file's stored form because decompression failed.
function unlockedGatedFileOf(resp) {
    return /** @type {UnlockedGatedFile} */ ({
        plaintextBase64: resp.plaintextBase64,
        byteLength: resp.byteLength,
        storedForm: resp.storedForm === true,
        inflateError: resp.inflateError ?? null,
    });
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
    const unlockErrors = useFormErrors();
    const [unlockError, setUnlockError] = useState(/** @type {string | null} */ (null));
    const [accessError, setAccessError] = useState(/** @type {string | null} */ (null));
    const [submitting, setSubmitting] = useState(false);
    /** @type {[Map<string, UnlockedGatedFile>, Function]} */
    const [unlocked, setUnlocked] = useState(() => new Map());
    /** @type {[any | null, Function]} */
    const [pendingFile, setPendingFile] = useState(null);
    /** @type {[({ name: string, declaredType: string | null } & UnlockedGatedFile) | null, Function]} */
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
            ...plain,
            name: file.name || `Action #${file.actionIndex}`,
            declaredType: file.type || null,
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
                    results.set(String(f.actionIndex), unlockedGatedFileOf(resp));
                }
                setUnlocked(results);
                const target = results.get(String(file.actionIndex));
                if (target) openFile(target, file);
            } catch (err) {
                setAccessError(userFacingMessage(err, 'Failed to unlock demo content.'));
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
                        results.set(String(f.actionIndex), unlockedGatedFileOf(resp));
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
        unlockErrors.reset();
    }

    async function handleUnlock(event) {
        event.preventDefault();
        if (submitting) return;
        if (!Array.isArray(addresses) || addresses.length === 0) return;
        if (password.length === 0) {
            setUnlockError(null);
            unlockErrors.validate({ 'gated-file-password': 'Enter your wallet password.' });
            return;
        }
        unlockErrors.reset();
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
                results.set(String(firstFile.actionIndex), unlockedGatedFileOf(firstResp));
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
                    results.set(String(file.actionIndex), unlockedGatedFileOf(resp));
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
                setUnlockError(userFacingMessage(err, 'Failed to unlock.'));
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
            <ul className={styles.gatedGrid}>
                {group.files.map((f) => {
                    const plain = unlocked.get(String(f.actionIndex));
                    if (plain) {
                        return (
                            <li key={f.actionIndex}>
                                <UnlockedFileLink
                                    fileLabel={f.name || `Action #${f.actionIndex}`}
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
                                className={`${styles.gatedTile} ${styles.fileButton}`}
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
                                <span className={styles.gatedTileContent}>
                                    <span className={styles.gatedTilePreview} aria-hidden="true">
                                        <Icon.FileTypeIcon type={f.type} />
                                        <span className={styles.gatedTileLock}><Icon.LockIcon /> Hold {formatWithThousands(f.gateMinAmount || '1')}</span>
                                    </span>
                                    <span className={styles.gatedTileBody}><strong>{f.title || f.name || `Action #${f.actionIndex}`}</strong><small>{[f.type, f.byteLength ? `${formatWithThousands(String(f.byteLength))} bytes` : null].filter(Boolean).join(', ') || 'File, size unavailable'}</small></span>
                                </span>
                            </Button>
                        </li>
                    );
                })}
            </ul>
            <StatusMessage variant="error">{accessError}</StatusMessage>
            {passwordOpen ? (
                <form onSubmit={handleUnlock} noValidate style={{ marginTop: 'var(--xc-space-3)' }}>
                    <FormErrorSummary form={unlockErrors} />
                    {addressesLoading ? (
                        <p className={styles.muted}>Loading addresses…</p>
                    ) : addressesError ? (
                        <Notice tone="danger">{addressesError}</Notice>
                    ) : null}
                    <Input
                        ref={passwordRef}
                        id="gated-file-password"
                        type="password"
                        label="Wallet password"
                        help="The password that unlocks this wallet on this device. Your address key then decrypts the gated files this token opens."
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            unlockErrors.clear('gated-file-password');
                            if (unlockError) setUnlockError(null);
                        }}
                        autoComplete="current-password"
                        error={unlockError || unlockErrors.errorFor('gated-file-password') || undefined}
                    />
                    <div style={{ display: 'flex', gap: 'var(--xc-space-2)', marginTop: 'var(--xc-space-2)' }}>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={submitting}
                            aria-disabled={!Array.isArray(addresses) || addresses.length === 0 ? 'true' : undefined}
                        >
                            Open File
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
                    storedForm={viewer.storedForm}
                    inflateError={viewer.inflateError}
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
function UnlockedFileLink({ fileLabel, type, onOpen }) {
    return (
        <Button
            onClick={onOpen}
            className={`${styles.gatedTile} ${styles.fileButton} ${styles.gatedTileUnlocked}`}
            style={{
                cursor: 'pointer',
                font: 'inherit',
                width: '100%',
                textAlign: 'left',
            }}
            aria-label={`Open unlocked file ${fileLabel}`}
            icon={null}
        >
            <span className={styles.gatedTileContent}>
                <span className={styles.gatedTilePreview} aria-hidden="true">
                    <Icon.FileTypeIcon type={type} />
                    <span className={styles.gatedTileOpen}><Icon.UnlockIcon /> Open</span>
                </span>
                <span className={styles.gatedTileBody}><strong>{fileLabel}</strong><small>{type || 'File'}</small></span>
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
    if (holdersError) return <Notice tone="danger">{holdersError}</Notice>;
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
                <Notice tone="danger">{holdersMoreError}</Notice>
            ) : null}
            {visibleHolderCount < holders.length ? (
                <Button type="button" variant="secondary" icon={<Icon.ChevronDownIcon />} onClick={showMoreLoadedHolders}>
                    Show More Holders ({Math.min(visibleHolderCount, holders.length).toLocaleString('en-US')} of {holders.length.toLocaleString('en-US')} Shown)
                </Button>
            ) : holdersHasMore ? (
                <Button type="button" variant="secondary" loading={holdersLoadingMore} icon={<Icon.ChevronDownIcon />} onClick={onLoadMore}>
                    Load More Holders
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
