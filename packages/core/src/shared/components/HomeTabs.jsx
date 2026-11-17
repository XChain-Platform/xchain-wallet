// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Icon, Tabs } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    BalanceList,
    buildBalanceRows,
    buildPlatformTokenRow,
    detectSpamCandidates,
    coinFromChainId,
    fiatValue,
    isAssetImageSourceAllowed,
} from './BalanceList.jsx';
import { CollectiblesView } from './CollectiblesView.jsx';
import { AllocationCard } from './AllocationCard.jsx';
import { HOME_WIDE_MIN_PX, HomeWideLayout, useHomeWide } from './HomeWideLayout.jsx';
import { listDetailStyles } from './PanelSplit.jsx';
import { TotalBalanceHero as TotalBalanceHeroBase } from './TotalBalanceHero.jsx';
import { PortfolioChart as PortfolioChartBase } from './PortfolioChart.jsx';
import { prepareValuation } from '../utils/portfolioValuation.js';
import { HoldingValueContext } from './holdingValueContext.js';
import { useWalletHistory } from '../hooks/useWalletHistory.js';
import { DEMO_CHART_SEED } from '../../flows/demoCapture.js';
import { RouteErrorBoundary } from './RouteErrorBoundary.jsx';
import { HomeListFilterMenu } from './HomeListFilterMenu.jsx';
import { activityRowAmount, activityRowAmountQualifier, activityRowTick } from '../utils/activityAmount.js';
import { ActivityRow as SharedActivityRow, actionIconForAction } from './ActivityRow.jsx';
import { isDemoWallet } from '@xchain-wallet/core/flows';
import { synthesizeDemoNativePrices } from '../../flows/demoFixtures.js';
import { classifyEntryAction, classifyEntryStatus } from '../utils/historyFilter.js';
import { recentActivityEntries } from '../utils/historyRow.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import {
    activityEntryLabel,
    activityEntryMatchesQuery,
    balanceRowMatchesQuery,
    defiPositionMatchesQuery,
    filterBalanceRowsByQuery,
    normalizeHomeQuery,
    sortDefiPositions,
} from '../utils/homeListFilter.js';
import { useCollectibleKeys } from '../hooks/useCollectibleKeys.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { useProofVerification } from '../hooks/useProofVerification.js';
import { useMessaging } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import {
    useNativeFiatRates,
    useTokenFiatRates,
    priceNativeRows,
    priceTokenRows,
} from '../hooks/useFiatRate.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { resolveSmallBalanceFiat } from '../../schemas/settings.js';
import { isMainnetChainId } from '../utils/mainnetChain.js';
import { compareDecimalStrings } from '../utils/amountFormat.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import styles from './HomeTabs.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/balances.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/receive.js';

const TotalBalanceHero = memo(TotalBalanceHeroBase);
const PortfolioChart = memo(PortfolioChartBase);

const BALANCE_SORT_STORAGE_KEY = 'xc:balances:sort';
const BALANCE_SORT_OPTIONS = new Set(['value', 'name']);

function balanceSortStorageKey(walletId) {
    return `${BALANCE_SORT_STORAGE_KEY}:${walletId || 'none'}`;
}

function readBalanceSort(walletId) {
    try {
        const value = globalThis.localStorage?.getItem(balanceSortStorageKey(walletId));
        return BALANCE_SORT_OPTIONS.has(value) ? value : 'name';
    } catch {
        return 'name';
    }
}

function persistBalanceSort(walletId, value) {
    try {
        globalThis.localStorage?.setItem(balanceSortStorageKey(walletId), value);
    } catch {
        // Storage can be unavailable in privacy-restricted shells.
    }
}

// The Balances list's Type filter (operator 2026-11-15): one list of coins
// and tokens, narrowed to coins or tokens from the filter popover,
// remembered per wallet beside the sort.
const BALANCE_TYPE_STORAGE_KEY = 'xc:balances:type';
export const HOME_BALANCE_TYPES = Object.freeze(['all', 'coins', 'tokens']);

function balanceTypeStorageKey(walletId) {
    return `${BALANCE_TYPE_STORAGE_KEY}:${walletId || 'none'}`;
}

function readBalanceType(walletId) {
    try {
        const value = globalThis.localStorage?.getItem(balanceTypeStorageKey(walletId));
        return HOME_BALANCE_TYPES.includes(value) ? value : 'all';
    } catch {
        return 'all';
    }
}

function persistBalanceType(walletId, value) {
    try {
        globalThis.localStorage?.setItem(balanceTypeStorageKey(walletId), value);
    } catch {
        // Storage can be unavailable in privacy-restricted shells.
    }
}

/** Home's three tabs (operator 2026-11-15; G toggles hold at most four). */
export const HOME_TABS = Object.freeze(['balances', 'nfts', 'defi']);

/**
 * Maps a Home tab value, current or retired, to the tab it opens and the
 * Type filter it sets. The retired All, Coins and Tokens tabs open Balances
 * with the matching Type; the retired Activity tab (History holds that
 * list) opens Balances as it is. A value it does not know opens Balances.
 *
 * @param {string | null | undefined} value
 * @returns {{ tab: 'balances' | 'nfts' | 'defi', type?: 'all' | 'coins' | 'tokens' }}
 */
export function resolveHomeTab(value) {
    switch (value) {
        case 'nfts':
        case 'defi':
            return { tab: value };
        case 'all':
        case 'coins':
        case 'tokens':
            return { tab: 'balances', type: value };
        default:
            return { tab: 'balances' };
    }
}

function withoutTestNetworkFiat(rows) {
    return rows.map((row) => (isMainnetChainId(row.chainId) ? row : {
        ...row,
        fiatRate: null,
        fiatRateSource: null,
        fiatRateFetchedAt: null,
        fiatRateStale: false,
        change24hPct: null,
    }));
}

function compareBalanceNames(a, b) {
    const byName = String(a.displayName || a.tick || '').localeCompare(
        String(b.displayName || b.tick || ''),
        undefined,
        { sensitivity: 'base' },
    );
    if (byName !== 0) return byName;
    return `${a.chainId || ''}:${a.tick || ''}`.localeCompare(`${b.chainId || ''}:${b.tick || ''}`);
}

/**
 * Sort balance rows without converting exact fiat values to floating point.
 * Missing values stay at the end, with name order as the stable fallback so
 * an unavailable price never makes a row jump unpredictably.
 */
export function sortBalanceRows(rows, sortBy) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    if (sortBy !== 'value') return list.sort(compareBalanceNames);
    return list.sort((a, b) => {
        const aMetric = fiatValue(a.quantity, a.divisibility, a.fiatRate);
        const bMetric = fiatValue(b.quantity, b.divisibility, b.fiatRate);
        const aMissing = aMetric === null;
        const bMissing = bMetric === null;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        if (aMissing) return compareBalanceNames(a, b);
        const compared = compareDecimalStrings(String(bMetric), String(aMetric));
        return compared || compareBalanceNames(a, b);
    });
}

/**
 * Top-level tabbed view for Home (operator 2026-11-15, every width).
 *
 *   Balances - one list of coins, then every non-native tick, narrowed by
 *              the filter popover's Type (All types, Coins, Tokens)
 *   NFTs     - a grid of large images of the tokens matching the protocol
 *              collectible rule (DECIMALS = 0 AND LOCK_MAX_SUPPLY = 1)
 *   DeFi     - open orders, dispensers, stakes and other open positions
 *
 * NFTs is a subset of the tokens, not their complement (not a divisible /
 * indivisible split), so an NFT also lists under Balances.
 *
 * Network filter applies across every tab so flipping `BTC` filters
 * all tabs to BTC at once. Filter state owned here so it persists
 * when the user moves between tabs.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {Record<string, Array<{ balances: any | null }>>} props.balances
 * @param {number | null} [props.balancesFetchedAt]   Unix ms of the last successful balance fetch. Refreshes prices and dates saved data while offline.
 * @param {string} props.networkFilter   'all' or a coin family
 * @param {{ threshold: number, cosignerCount: number, scheme: string } | null} [props.multisig]
 * @param {string} [props.multisigChainId]
 * @param {() => void} [props.onReceive]   forwarded to empty-state nudges so the "No balances yet" cards can render a one-tap Receive CTA (G077)
 * @param {() => void} [props.onBuy]       opens the coin exchange from the first-funding state
 * @param {boolean} [props.hasAddresses]   whether the active account has any receiving address
 * @param {() => void} [props.onAddAddress] opens address generation for an account with no addresses
 * @param {() => void} [props.onHistory]   opens the complete chronological feed from the Activity tab's View all control
 * @param {any[] | null} [props.recentActivity] the wallet's newest history entries for the Activity tab; null while they load
 * @param {boolean} [props.recentActivityFailed] the recent-activity read failed and no saved rows exist
 * @param {() => void} [props.onActivityOpen] asks the host to load recent activity when the Activity tab opens
 * @param {any[] | null} [props.defiPositions] the wallet's open DeFi positions; null while they load
 * @param {boolean} [props.defiPositionsFailed] the DeFi reads failed without returning any rows
 * @param {() => void} [props.onDefiOpen] asks the host to load DeFi positions when the DeFi tab opens
 * @param {boolean} [props.hideSmallBalances]: `settings.privacy.hideSmallBalances`, forwarded to the Coins and Tokens lists so dust rows collapse into their own section
 * @param {() => void} [props.onRefresh]    manually refreshes portfolio balances and expired prices
 * @param {boolean} [props.refreshing]      whether a manual portfolio refresh is running
 * @param {boolean} [props.balanceNoticeShown] Home shows its own balance notice, so an empty tab shows no empty state
 * @param {(item: HomeDetailItem) => import('react').ReactNode} [props.renderDetail]
 *   wide Home (G115): the host draws the selected item's detail beside the list.
 *   Without it Home stays one column at every width.
 * @param {HomeDetailItem | null} [props.detailSelection] the item the host holds as selected; null opens the first asset
 * @param {(item: HomeDetailItem) => void} [props.onDetailSelect] a row picked on wide Home
 * @param {import('react').ReactNode} [props.footer] the page's closing card (the backup
 *   reminder): under the list in one column, at the end of the list column on wide Home
 * @param {(wide: boolean) => void} [props.onWideChange] told whether the wide layout
 *   shows (false again on unmount), so the host lays its Screen body out for the split
 *   (G128: the body stops scrolling and each panel scrolls on its own)
 */
export const HomeTabs = memo(function HomeTabs({ onWideChange, walletName = '', chainRegistry, balances, activeByChain = null, balancesFetchedAt, walletId, accountId = null, networkFilter, tokenQuery = '', coinFamilies, onNetworkFilterChange, onTokenQueryChange, multisig, multisigChainId, onReceive, onBuy, hasAddresses = true, onAddAddress, onHistory, recentActivity = null, recentActivityFailed = false, onActivityOpen, defiPositions = null, defiPositionsFailed = false, onDefiOpen, onSelectToken, onSelectEntry, pinnedKeys, onTogglePin, hiddenKeys, onToggleHide, verifyProofsEnabled = false, hideSmallBalances = false, onRefresh, refreshing = false, onCommandPalette, onOpenSettings, onLockWallet, balanceNoticeShown = false, renderDetail, detailSelection = null, onDetailSelect, footer = null }) {
    const tabsId = useId();
    // Wide Home (G115) shows only on a desktop-wide Home whose host can draw
    // the detail panel; everything below keeps the one-column Home otherwise.
    const [wrapRef, wide] = useHomeWide(HOME_WIDE_MIN_PX, typeof renderDetail === 'function');
    // Before paint, so the host's body never paints one frame scrolling as
    // one column around the split.
    useLayoutEffect(() => {
        if (typeof onWideChange !== 'function') return undefined;
        onWideChange(wide);
        return () => onWideChange(false);
    }, [wide, onWideChange]);
    // Home opens on Balances at every width; the Type filter narrows it.
    const [active, setActiveTab] = useState(/** @type {'balances' | 'nfts' | 'defi'} */ ('balances'));
    const [balanceType, setBalanceType] = useState(() => readBalanceType(walletId));
    const changeBalanceType = useCallback((value) => {
        if (!HOME_BALANCE_TYPES.includes(value)) return;
        setBalanceType(value);
        persistBalanceType(walletId, value);
    }, [walletId]);
    // Every tab change goes through the mapper, so a retired tab value
    // (All, Coins, Tokens) still lands on Balances with its Type.
    const setActive = useCallback((value) => {
        const next = resolveHomeTab(value);
        setActiveTab(next.tab);
        if (next.type) changeBalanceType(next.type);
    }, [changeBalanceType]);
    // Proof checks read once per (address, token): the explorer serves no
    // bulk balance proof, so they run only while the list shows tokens alone,
    // as the old Tokens tab did. Token prices are one batch and run always.
    const tokensOnly = active === 'balances' && balanceType === 'tokens';
    // A host that does not hold the selection still gets one, for this visit.
    const [localSelection, setLocalSelection] = useState(/** @type {HomeDetailItem | null} */ (null));
    const selection = typeof onDetailSelect === 'function' ? detailSelection : localSelection;
    const selectDetail = typeof onDetailSelect === 'function' ? onDetailSelect : setLocalSelection;
    // The chart's change over the selected range, shown in the balance card.
    const [rangeChange, setRangeChange] = useState(null);
    const [sortBy, setSortBy] = useState(() => readBalanceSort(walletId));
    const isDemo = isDemoWallet(walletId);
    const canFilter = typeof onNetworkFilterChange === 'function' && typeof onTokenQueryChange === 'function';
    const changeSort = useCallback((value) => {
        if (!BALANCE_SORT_OPTIONS.has(value)) return;
        setSortBy(value);
        persistBalanceSort(walletId, value);
    }, [walletId]);
    const { messaging } = useMessaging();
    const verifyMap = useProofVerification({
        messaging,
        balances,
        enabled: verifyProofsEnabled && tokensOnly,
    });

    useEffect(() => {
        setSortBy(readBalanceSort(walletId));
        setBalanceType(readBalanceType(walletId));
    }, [walletId]);

    const builtRows = useMemo(
        () => buildBalanceRows(balances, chainRegistry, activeByChain),
        [balances, chainRegistry, activeByChain],
    );
    // Real balance reads carry no price, so native rows get the coin's live
    // §45 rate here; without it the hero and the chart count every coin as
    // unpriced. A demo wallet asks for nothing (its fixtures price
    // themselves), and nothing is fetched until a settings snapshot loads,
    // so an opted-out user does not reach the CoinGecko fallback before
    // their choice is known, or at all when the settings read fails.
    const { settings, loading: settingsLoading } = useSettings();
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const watchedRows = useMemo(
        () => buildWatchedTokenRows(settings?.watchedTokens, builtRows, chainRegistry),
        [settings?.watchedTokens, builtRows, chainRegistry],
    );
    const displayRows = useMemo(
        () => [...builtRows, ...watchedRows],
        [builtRows, watchedRows],
    );
    const allowRemoteImages = Boolean(settings)
        && settings.privacy?.metadataFetchEnabled !== false;
    const nativeCoins = useMemo(() => {
        if (isDemo) return [];
        return displayRows
            .filter((r) => r.kind === 'native' && isMainnetChainId(r.chainId))
            .map((r) => r.coin || coinFromChainId(r.chainId));
    }, [displayRows, isDemo]);
    const nativeRates = useNativeFiatRates({
        chainCoins: nativeCoins,
        fiatCurrency,
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
        refreshEnabled: Boolean(settings) && !settingsLoading,
        refreshKey: balancesFetchedAt,
    });
    const spamKeys = useMemo(
        () => new Set(detectSpamCandidates(builtRows)),
        [builtRows],
    );
    // Every held token is priced for every tab and Type, so the default All
    // types list and the hero total carry live token prices. The refresh is
    // one batch whose reads follow the chains, never the tokens (one oracle
    // snapshot and one markets read per coin family), and spam-looking dust
    // is never asked for.
    const tokenRequests = useMemo(() => {
        if (isDemoWallet(walletId)) return [];
        return displayRows
            .filter((r) => r.kind !== 'native'
                && isMainnetChainId(r.chainId)
                && typeof r.fiatRate !== 'number'
                && !spamKeys.has(`${r.chainId}:${r.tick}`))
            .map((r) => {
                const descriptor = chainRegistry.get(r.chainId);
                return {
                    chainCoin: descriptor?.coin,
                    tick: r.tick,
                    nativeTicker: tickerForCoin(descriptor?.coin),
                };
            });
    }, [displayRows, chainRegistry, spamKeys, walletId]);
    const tokenRates = useTokenFiatRates({
        tokens: tokenRequests,
        fiatCurrency,
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
        refreshEnabled: Boolean(settings) && !settingsLoading,
        refreshKey: balancesFetchedAt,
    });
    const allRows = useMemo(
        () => {
            const pricedRows = priceTokenRows(priceNativeRows(displayRows, nativeRates), tokenRates);
            return isDemo ? pricedRows : withoutTestNetworkFiat(pricedRows);
        },
        [displayRows, nativeRates, tokenRates, isDemo],
    );
    const nativeChainIds = useMemo(
        () => allRows
            .filter((row) => row.kind === 'native'
                && (isDemo || isMainnetChainId(row.chainId)))
            .map((row) => row.chainId)
            .sort(),
        [allRows, isDemo],
    );
    const nativeChainKey = nativeChainIds.join(',');
    const [nativePriceMap, setNativePriceMap] = useState(/** @type {Record<string, any>} */ ({}));
    const [nativePricesLoading, setNativePricesLoading] = useState(false);
    const [nativePricesError, setNativePricesError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        if (isDemo) {
            setNativePriceMap(synthesizeDemoNativePrices(nativeChainIds));
            setNativePricesLoading(false);
            setNativePricesError(null);
            return undefined;
        }
        if (typeof messaging?.getNativePricesRequest !== 'function' || nativeChainIds.length === 0) {
            setNativePriceMap({});
            setNativePricesLoading(false);
            setNativePricesError(null);
            return undefined;
        }
        let cancelled = false;
        setNativePricesLoading(true);
        setNativePricesError(null);
        messaging.getNativePricesRequest({
            chainIds: nativeChainIds,
            includeSparkline: true,
            fiatCurrency,
        }).then((result) => {
            if (cancelled) return;
            setNativePriceMap(result?.disabled ? {} : (result?.prices || {}));
            setNativePricesLoading(false);
        }).catch((err) => {
            if (cancelled) return;
            setNativePriceMap({});
            setNativePricesLoading(false);
            setNativePricesError(readFailureMessage(err, 'load portfolio price history'));
        });
        return () => { cancelled = true; };
    }, [isDemo, messaging, nativeChainKey, fiatCurrency]); // eslint-disable-line react-hooks/exhaustive-deps
    const filteredRows = useMemo(() => {
        if (networkFilter === 'all') return allRows;
        return allRows.filter((r) => (r.coin || coinFromChainId(r.chainId)) === networkFilter);
    }, [allRows, networkFilter]);
    // One query for every tab: each list keeps only rows whose visible text
    // contains it, while the hero and chart keep the whole network's total.
    const tokenQueryTrim = normalizeHomeQuery(tokenQuery);
    const clearQuery = canFilter && tokenQueryTrim ? () => onTokenQueryChange('') : undefined;
    const coins = useMemo(
        () => sortBalanceRows(filterBalanceRowsByQuery(filteredRows.filter((r) => r.kind === 'native'), tokenQueryTrim), sortBy),
        [filteredRows, tokenQueryTrim, sortBy],
    );
    // Tokens = every non-native tick, regardless of divisibility or imagery,
    // in the chosen order. An unavailable token price reads as zero in this
    // display-only list, matching the coins' three-column layout without
    // changing the total; a picked row gets its real rate back as it opens
    // (openBalanceRow).
    const tokenRows = useMemo(() => {
        if (active !== 'balances' || balanceType === 'coins') return [];
        return sortBalanceRows(filterBalanceRowsByQuery(
            filteredRows.filter((r) => r.kind !== 'native'),
            tokenQueryTrim,
        ), sortBy).map((row) => (
            fiatValue(row.quantity, row.divisibility, row.fiatRate) === null
                ? { ...row, fiatRate: 0 }
                : row
        ));
    }, [active, balanceType, filteredRows, tokenQueryTrim, sortBy]);
    // The Balances list: the coins, then the tokens, each group in the
    // chosen order, from the rows already read (it adds no read), or one of
    // the two groups when the Type filter narrows it.
    const balanceRows = useMemo(() => {
        if (active !== 'balances') return [];
        if (balanceType === 'coins') return coins;
        if (balanceType === 'tokens') return tokenRows;
        return [...coins, ...tokenRows];
    }, [active, balanceType, coins, tokenRows]);
    // Read only to keep the wallet's own tokens out of the unknown-token
    // filter. Off for a demo wallet: its rows carry the wallet's real
    // addresses, and a demo wallet's addresses never go to an explorer
    // (issue #82).
    const ownedTokens = useOwnedTokens(
        balances,
        !isDemo && settings?.hideUnknownTokens === true,
    );
    const automaticHiddenKeys = useMemo(
        () => settings?.hideUnknownTokens === true
            ? unknownTokenKeys(allRows, {
                pinnedKeys,
                watchedTokens: settings?.watchedTokens,
                ownedTokens,
            })
            : new Set(),
        [settings?.hideUnknownTokens, settings?.watchedTokens, allRows, pinnedKeys, ownedTokens],
    );
    const portfolioRows = useMemo(
        () => filteredRows.filter((row) => {
            const key = `${row.chainId}:${row.tick}`;
            return !hiddenKeys?.has(key) && !automaticHiddenKeys.has(key);
        }),
        [filteredRows, hiddenKeys, automaticHiddenKeys],
    );
    // The value chart's history: batch reads of every address the wallet
    // holds on each chain the chart values (token history with its balance
    // effects, native coin history, and the held tokens' price series), one
    // call per 20 addresses per page, refreshed with the balances for only
    // what is newer. The demo wallet's line is synthesized and reads none.
    const walletAddressesByChain = useMemo(() => {
        const out = {};
        for (const [chainId, entries] of Object.entries(balances || {})) {
            if (!Array.isArray(entries)) continue;
            out[chainId] = entries.map((entry) => entry?.address).filter((a) => typeof a === 'string' && a);
        }
        return out;
    }, [balances]);
    // History is read for the chains the chart values; price series for every
    // held mainnet token, priced now or not, so the set (and the one price
    // read per chain) does not move as each token's current rate lands.
    // Spam-looking dust is never asked for, as in the current-rate batch.
    const valuedReads = useMemo(() => {
        const chainIds = new Set();
        const tokenTicksByChain = {};
        for (const row of portfolioRows) {
            if (!row?.chainId) continue;
            if (row.kind !== 'native' && isMainnetChainId(row.chainId) && !spamKeys.has(`${row.chainId}:${row.tick}`)) {
                (tokenTicksByChain[row.chainId] ||= []).push(row.tick);
            }
            if (fiatValue(row.quantity, row.divisibility, row.fiatRate) !== null) chainIds.add(row.chainId);
        }
        return { chainIds: [...chainIds], tokenTicksByChain };
    }, [portfolioRows, spamKeys]);
    const walletHistory = useWalletHistory({
        walletId,
        accountId,
        activeNetwork: settingsLoading ? null : (settings?.activeNetwork || 'mainnet'),
        messaging,
        addressesByChain: walletAddressesByChain,
        chainIds: valuedReads.chainIds,
        tokenTicksByChain: valuedReads.tokenTicksByChain,
        refreshKey: balancesFetchedAt,
        enabled: !isDemo,
    });
    // The unit the balance card shows its total in; the chart follows it.
    const [heroUnit, setHeroUnit] = useState(/** @type {{ tick: string, chainId: string, price: number } | null} */ (null));
    // One valuation input for the chart and wide Home's detail panel, so the
    // panel's holding line is the chart's share of that asset.
    const holdingValueSource = useMemo(() => ({
        prepared: prepareValuation({ rows: portfolioRows, history: isDemo ? null : walletHistory, activeByChain }),
        priceMap: nativePriceMap,
        seedId: isDemo ? DEMO_CHART_SEED : walletId,
        synthesize: isDemo,
        requestRange: isDemo ? null : walletHistory.requestRange,
    }), [portfolioRows, walletHistory, activeByChain, nativePriceMap, isDemo, walletId]);
    // Test coins have no market price, so the fiat chart is hidden only when
    // every held row is on a test network; an empty wallet keeps its chart,
    // and the demo wallet prices its synthetic test-network holdings.
    const chainRows = portfolioRows.filter((row) => typeof row?.chainId === 'string' && row.chainId);
    const testCoinsOnly = !isDemoWallet(walletId)
        && chainRows.length > 0
        && chainRows.every((row) => !isMainnetChainId(row.chainId));
    // On wide Home a row opens its detail beside the list instead of a page.
    const selectAssetInPanel = useCallback((token) => {
        selectDetail({ type: 'asset', key: `${token.chainId}:${token.tick}` });
    }, [selectDetail]);
    const openToken = wide ? selectAssetInPanel : onSelectToken;
    const openEntry = wide && typeof onSelectEntry === 'function'
        ? (entry) => selectDetail({ type: 'entry', key: `entry:${entry?.key ?? ''}`, entry })
        : onSelectEntry;
    // A Balances row opens with its real rate: the list shows an unpriced
    // token at zero, and the page it opens must not price it at zero.
    const openBalanceRow = useMemo(() => (typeof openToken === 'function'
        ? (token) => {
            const source = filteredRows.find((row) => (
                row.chainId === token.chainId && row.tick === token.tick
            ));
            openToken(source
                ? { ...token, fiatRate: source.fiatRate ?? null, fiatRateSource: source.fiatRateSource }
                : token);
        }
        : undefined), [filteredRows, openToken]);
    // A row whose balance read failed may hold funds, so it never reads as
    // an empty wallet that needs its first funding.
    const hasHoldings = allRows.some((row) => hasNonZeroQuantity(row) || Boolean(row?.unavailable));
    const showFirstFunding = networkFilter === 'all' && !tokenQueryTrim && !hasHoldings;
    // While Home's own balance notice is up, that notice is the one message
    // and an empty tab stays quiet.
    const quietEmpty = Boolean(balanceNoticeShown);
    // Any row on the network keeps the menu (and its Type field) reachable,
    // so a Type that matches nothing can always be changed back.
    const showBalanceSort = !showFirstFunding && active === 'balances' && filteredRows.length > 0;
    // The first-funding state and the quiet empty tab speak only for an
    // unfiltered list; a query that matches nothing reads as no matches.
    // Narrowed to Tokens there is no first funding (the old Tokens tab's rule).
    const balancesFirstFunding = showFirstFunding && balanceType !== 'tokens';
    const balancesQuiet = quietEmpty && !tokenQueryTrim
        && (balancesFirstFunding || balanceRows.length === 0);
    // NFTs = tokens matching the canonical NFT pattern (NFT_Standard.md:
    // DECIMALS=0 AND LOCK_MAX_SUPPLY=1 (indivisible, supply can never
    // inflate). Classification, not decoration: a divisible token with a
    // pretty icon (e.g. PEPECASH) belongs in Tokens, not here, and a true
    // collectible with no artwork still earns its tile (letter fallback).
    // A tick can appear in BOTH Tokens (balance row) and NFTs (tile).
    const collectibleKeys = useCollectibleKeys(active === 'nfts' ? filteredRows : [], isDemo);
    const nfts = useMemo(
        () => active === 'nfts'
            ? sortBalanceRows(filteredRows.filter(
                (r) => r.kind !== 'native'
                    && collectibleKeys.has(`${r.chainId}:${r.tick}`)
                    && balanceRowMatchesQuery(r, tokenQueryTrim),
            ), sortBy)
            : [],
        [active, filteredRows, collectibleKeys, tokenQueryTrim, sortBy],
    );
    // The item whose detail shows beside the list: the one picked, or the
    // first asset (the first coin, else the first token). It is looked up in
    // the live rows, so a balance poll updates it in place.
    const detailItem = useMemo(() => {
        if (!wide) return null;
        if (selection?.type === 'entry' && selection.entry) {
            return { type: 'entry', key: selection.key, entry: selection.entry };
        }
        const byKey = (key) => filteredRows.find((r) => `${r.chainId}:${r.tick}` === key) || null;
        const picked = selection?.type === 'asset' ? byKey(selection.key) : null;
        const row = picked
            || coins[0]
            || sortBalanceRows(filteredRows.filter((r) => r.kind !== 'native'), sortBy)[0]
            || null;
        if (!row) return null;
        return {
            type: 'asset',
            key: `${row.chainId}:${row.tick}`,
            token: {
                chainId: row.chainId,
                tick: row.tick,
                kind: row.kind,
                displayName: row.displayName,
                divisibility: row.divisibility,
                fiatRate: row.fiatRate ?? null,
                fiatRateSource: row.fiatRateSource,
                fiatRateStale: row.fiatRateStale === true,
                fiatRateFetchedAt: row.fiatRateFetchedAt || null,
                quantity: row.quantity,
                imageUrl: isAssetImageSourceAllowed(row.imageUrl, allowRemoteImages) ? row.imageUrl : null,
            },
        };
    }, [wide, selection, filteredRows, coins, sortBy, allowRemoteImages]);
    const selectedAssetKey = detailItem?.type === 'asset' ? detailItem.key : null;

    // Each tab label carries an icon. There is no Activity tab because History
    // holds the same list.
    const tabLabel = (IconGlyph, text) => (
        <span className={styles.tabWithIcon}><span className={styles.tabIcon} aria-hidden="true"><IconGlyph /></span>{text}</span>
    );
    const tabs = [
        { id: 'balances', label: tabLabel(Icon.CoinsIcon, t('balances.balances')) },
        { id: 'nfts',     label: tabLabel(Icon.ImageIcon, t('home.tabs.nfts')) },
        { id: 'defi',     label: tabLabel(Icon.StakeIcon, t('home.tabs.defi')) },
    ];
    // The Balances list's empty copy follows the Type it is narrowed to.
    const balancesEmpty = tokenQueryTrim
        ? {
            title: balanceType === 'tokens' ? t('home.tabs.noMatchingTokens') : t('home.tabs.noMatches'),
            body: balanceType === 'tokens' ? t('home.tabs.matchingTokensAppearHereAfter') : t('home.tabs.matchesAppearHereAfter'),
        }
        : {
            all: {
                title: t('home.tabs.noAssetsYet'),
                body: t('home.tabs.assetsAppearHereAfterYou'),
            },
            coins: networkFilter === 'all'
                ? { title: t('home.tabs.noCoinsYet'), body: t('home.tabs.coinsAppearHereAfterYou') }
                : { title: t('home.tabs.noCoinsOnThisNetwork'), body: t('home.tabs.coinsOnThisNetworkAppear') },
            tokens: networkFilter === 'all'
                ? { title: t('home.tabs.noTokensYet'), body: t('home.tabs.tokensAppearHereAfterYou') }
                : { title: t('home.tabs.noTokensOnThisNetwork'), body: t('home.tabs.tokensOnThisNetworkAppear') },
        }[balanceType];

    // The page is built from three blocks (the balance card, the tab row and
    // the chosen tab's list), stacked in one column, or on wide Home laid out
    // by HomeWideLayout beside the allocation card and the detail panel.
    // Hero rolls up visible coins + tokens + NFTs. DeFi + Activity contribute
    // their own dollar amounts via separate flows once they wire up; for now
    // they're not in the sum. The balance card and its chart share one cell,
    // the chart drawn behind the balance on the card's app blue.
    const heroNode = (
            <div className={testCoinsOnly ? styles.heroStack : `${styles.heroStack} ${styles.heroStackWithChart}`}>
            <RouteErrorBoundary
                variant="compact"
                resetKey={`${walletId || ''}:${networkFilter}:price`}
            >
                <TotalBalanceHero
                    walletName={walletName}
                    rangeChange={rangeChange}
                    rows={portfolioRows}
                    walletId={walletId}
                    networkFilter={networkFilter}
                    onRefresh={onRefresh}
                    refreshing={refreshing}
                    onCommandPalette={onCommandPalette}
                    onOpenSettings={onOpenSettings}
                    onLockWallet={onLockWallet}
                    nativePriceMap={nativePriceMap}
                    onUnitChange={setHeroUnit}
                />
            </RouteErrorBoundary>

            <RouteErrorBoundary
                variant="compact"
                resetKey={`${walletId || ''}:${networkFilter}:chart`}
            >
                {!testCoinsOnly ? (
                    <PortfolioChart
                        rows={portfolioRows}
                        walletId={walletId}
                        nativePriceMap={nativePriceMap}
                        nativePricesLoading={nativePricesLoading}
                        nativePricesError={nativePricesError}
                        behind
                        onRangeChange={setRangeChange}
                        history={isDemo ? null : walletHistory}
                        activeByChain={activeByChain}
                        unit={heroUnit}
                    />
                ) : null}
            </RouteErrorBoundary>
            </div>
    );

    const tabsRowNode = (
            <div className={canFilter || showBalanceSort ? `${styles.tabsRow} ${styles.tabsRowWithFilter}` : styles.tabsRow}>
                <Tabs
                    id={tabsId}
                    items={tabs}
                    value={active}
                    onChange={setActive}
                    panelId={`${tabsId}-panel`}
                    aria-label={t('home.tabs.walletView')}
                />

                {canFilter || showBalanceSort ? (
                    <HomeListFilterMenu
                        sortBy={sortBy}
                        onSortChange={changeSort}
                        chainRegistry={chainRegistry}
                        coinFamilies={coinFamilies || []}
                        networkFilter={networkFilter}
                        onNetworkFilterChange={onNetworkFilterChange}
                        tokenQuery={tokenQuery}
                        onTokenQueryChange={onTokenQueryChange}
                        tab={active === 'balances' && balanceType !== 'all' ? balanceType : active}
                        balanceType={active === 'balances' ? balanceType : undefined}
                        onBalanceTypeChange={active === 'balances' ? changeBalanceType : undefined}
                    />
                ) : null}
            </div>
    );

    const panelNode = (
            <div
                id={`${tabsId}-panel`}
                className={styles.panel}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${active}`}
            >
                {active === 'balances' && !balancesQuiet ? (
                    balancesFirstFunding ? (
                        <EmptyState
                            title={t('home.tabs.fundYourWallet')}
                            body={hasAddresses
                                ? t('home.tabs.receiveCoinsFromAnotherWallet')
                                : t('home.tabs.generateAReceivingAddressThen')}
                            actionLabel={hasAddresses ? t('home.receive') : t('receive.generateAnAddress')}
                            onAction={hasAddresses ? onReceive : onAddAddress}
                            actionIcon={hasAddresses ? <Icon.ReceiveIcon /> : <Icon.PlusIcon />}
                            secondaryActionLabel={onBuy ? t('home.tabs.buyCoins') : undefined}
                            onSecondaryAction={onBuy}
                            secondaryActionIcon={<Icon.MarketIcon />}
                        />
                    ) : (
                        <BalanceList
                            rows={balanceRows}
                            fiatCurrency={settings?.fiatCurrency || 'USD'}
                            multisig={multisig}
                            multisigChainId={multisigChainId}
                            emptyTitle={balancesEmpty.title}
                            emptyBody={balancesEmpty.body}
                            emptyActionLabel={clearQuery ? t('home.tabs.clearFilter') : undefined}
                            onEmptyAction={clearQuery}
                            onReceive={networkFilter === 'all' && !tokenQueryTrim && balanceType !== 'tokens' ? onReceive : undefined}
                            onSelectToken={openBalanceRow}
                            pinnedKeys={pinnedKeys}
                            onTogglePin={onTogglePin}
                            hiddenKeys={hiddenKeys}
                            automaticHiddenKeys={automaticHiddenKeys}
                            onToggleHide={onToggleHide}
                            verifyMap={tokensOnly ? verifyMap : undefined}
                            hideSmallBalances={hideSmallBalances}
                            smallBalanceFiat={resolveSmallBalanceFiat(settings)}
                            numberFormat={settings?.numberFormat}
                            allowRemoteImages={allowRemoteImages}
                            showChain={networkFilter === 'all'}
                            selectedKey={selectedAssetKey}
                        />
                    )
                ) : null}

                {active === 'nfts' ? (
                    <>
                        <RouteErrorBoundary
                            variant="compact"
                            resetKey={`${walletId || ''}:${networkFilter}:collectibles`}
                        >
                            <CollectiblesView
                                rows={nfts}
                                demo={isDemo}
                                size="large"
                                emptyTitle={tokenQueryTrim
                                    ? t('home.tabs.noMatches')
                                    : (networkFilter === 'all' ? t('home.tabs.noCollectiblesYet') : t('home.tabs.noCollectiblesOnThisNetwork'))}
                                emptyBody={tokenQueryTrim
                                    ? t('home.tabs.matchesAppearHereAfter')
                                    : (networkFilter === 'all'
                                        ? t('home.tabs.collectiblesAppearHereAfterYou')
                                        : t('home.tabs.collectiblesOnThisNetworkAppear'))}
                                emptyActionLabel={clearQuery ? t('home.tabs.clearFilter') : undefined}
                                onEmptyAction={clearQuery}
                                onReceive={networkFilter === 'all' && !tokenQueryTrim ? onReceive : undefined}
                                onSelectToken={openToken}
                                pinnedKeys={pinnedKeys}
                                onTogglePin={onTogglePin}
                                hiddenKeys={hiddenKeys}
                                automaticHiddenKeys={automaticHiddenKeys}
                                onToggleHide={onToggleHide}
                                allowRemoteImages={allowRemoteImages}
                                selectedKey={selectedAssetKey}
                            />
                        </RouteErrorBoundary>
                    </>
                ) : null}

                {active === 'activity' ? (
                    <RecentActivityList
                        entries={recentActivity}
                        failed={recentActivityFailed}
                        balances={balances}
                        networkFilter={networkFilter}
                        query={tokenQueryTrim}
                        onClearQuery={clearQuery}
                        onOpen={onActivityOpen}
                        onHistory={onHistory}
                        onSelectEntry={onSelectEntry}
                        allowRemoteImages={allowRemoteImages}
                    />
                ) : null}

                {active === 'defi' ? (
                    <DefiList
                        positions={defiPositions}
                        failed={defiPositionsFailed}
                        networkFilter={networkFilter}
                        query={tokenQueryTrim}
                        sortBy={sortBy}
                        onClearQuery={clearQuery}
                        balances={balances}
                        onOpen={onDefiOpen}
                        onSelectEntry={openEntry}
                        allowRemoteImages={allowRemoteImages}
                    />
                ) : null}
            </div>
    );

    if (!wide) {
        return (
            <div ref={wrapRef} className={styles.wrap}>
                {heroNode}
                {tabsRowNode}
                {panelNode}
                {footer}
            </div>
        );
    }
    const detailLabel = detailItem?.type === 'asset'
        ? (detailItem.token.displayName || detailItem.token.tick)
        : undefined;
    return (
        // A box between Home's Screen body and the split: it passes the
        // body's height down (G128).
        <div ref={wrapRef} className={[styles.wrap, listDetailStyles.splitFill].filter(Boolean).join(' ')}>
            <HomeWideLayout
                hero={heroNode}
                allocation={<AllocationCard rows={portfolioRows} chainRegistry={chainRegistry} fiatCurrency={fiatCurrency} />}
                listHeader={tabsRowNode}
                // The footer (the backup reminder) closes the list column, so
                // nothing follows the split and its line runs to the bottom
                // edge (operator 2026-11-15).
                list={(
                    <>
                        {panelNode}
                        {footer}
                    </>
                )}
                detail={detailItem ? (
                    <HoldingValueContext.Provider value={holdingValueSource}>
                        {renderDetail(detailItem)}
                    </HoldingValueContext.Provider>
                ) : (
                    <EmptyState title={t('home.wide.noSelectionTitle')} body={t('home.wide.noSelectionBody')} titleAs="p" />
                )}
                detailLabel={detailLabel}
            />
        </div>
    );
});

/**
 * What wide Home's detail panel shows (G115): a coin, token or NFT by its
 * `chainId:tick` key, with the live row as `token` when it is drawn, or one
 * History entry (a DeFi position row).
 *
 * @typedef {{ type: 'asset', key: string, token?: any } | { type: 'entry', key: string, entry: any }} HomeDetailItem
 */

/**
 * Builds zero-balance rows for watched tokens that are absent from the latest
 * balance read. Keys stay chain-scoped so the same ticker can be watched on
 * several chains without one row masking another.
 *
 * @param {unknown} watchedTokens
 * @param {Array<any>} balanceRows
 * @param {import('../../registry/index.js').ChainRegistry} chainRegistry
 * @returns {Array<any>}
 */
export function buildWatchedTokenRows(watchedTokens, balanceRows, chainRegistry) {
    if (!Array.isArray(watchedTokens)) return [];
    const present = new Set((balanceRows || []).map((row) => `${row.chainId}:${row.tick}`));
    const added = new Set();
    const rows = [];
    for (const key of watchedTokens) {
        if (typeof key !== 'string' || present.has(key) || added.has(key)) continue;
        const separator = key.indexOf(':');
        if (separator <= 0 || separator === key.length - 1) continue;
        const chainId = key.slice(0, separator);
        const tick = key.slice(separator + 1);
        const row = buildPlatformTokenRow(chainId, tick, null, chainRegistry);
        if (!row) continue;
        rows.push(row);
        added.add(key);
    }
    return rows;
}

/**
 * Finds held tokens that have no useful metadata or price and no explicit
 * wallet relationship. Pins and watches are direct user choices, issuer
 * ownership proves a stronger relationship, and escrow proves an open order.
 * Native coins never qualify.
 *
 * @param {Array<any>} rows
 * @param {{ pinnedKeys?: Set<string> | null, watchedTokens?: unknown, ownedTokens?: Array<any> }} [relationships]
 * @returns {Set<string>}
 */
export function unknownTokenKeys(rows, relationships = {}) {
    const familiar = new Set(relationships.pinnedKeys || []);
    if (Array.isArray(relationships.watchedTokens)) {
        for (const key of relationships.watchedTokens) {
            if (typeof key === 'string') familiar.add(key);
        }
    }
    if (Array.isArray(relationships.ownedTokens)) {
        for (const token of relationships.ownedTokens) {
            if (typeof token?.chainId === 'string' && typeof token?.tick === 'string') {
                familiar.add(`${token.chainId}:${token.tick}`);
            }
        }
    }

    const unknown = new Set();
    for (const row of rows || []) {
        if (!row || row.kind === 'native' || row.escrowed) continue;
        const key = `${row.chainId}:${row.tick}`;
        if (familiar.has(key)) continue;
        const tick = String(row.tick || '').trim();
        const name = String(row.displayName || '').trim();
        const hasName = Boolean(name) && name.toLocaleLowerCase() !== tick.toLocaleLowerCase();
        const hasImage = typeof row.imageUrl === 'string' && row.imageUrl.trim().length > 0;
        const hasPrice = typeof row.fiatRate === 'number' && Number.isFinite(row.fiatRate);
        if (!hasName && !hasImage && !hasPrice) unknown.add(key);
    }
    return unknown;
}

// Ticks any of the wallet's addresses owns, balance or not: a token whose
// whole supply was sent on still belongs to its issuer. Failed reads yield
// nothing rather than an error, since the balance rows above stand alone.
function useOwnedTokens(balances, enabled) {
    const { messaging } = useMessaging();
    const [owned, setOwned] = useState([]);
    const addressKey = useMemo(() => {
        if (!enabled) return '';
        const pairs = [];
        for (const [chainId, entries] of Object.entries(balances || {})) {
            if (!Array.isArray(entries)) continue;
            for (const e of entries) {
                if (typeof e?.address === 'string') pairs.push(`${chainId}|${e.address}`);
            }
        }
        return [...new Set(pairs)].sort().join(',');
    }, [balances, enabled]);

    useEffect(() => {
        if (!enabled || !addressKey || typeof messaging?.getOwnedTokens !== 'function') return undefined;
        let cancelled = false;
        Promise.all(addressKey.split(',').map((pair) => {
            const [chainId, address] = pair.split('|');
            return Promise.resolve(messaging.getOwnedTokens({ chainId, address }))
                .then((rows) => (Array.isArray(rows) ? rows : [])
                    .filter((r) => typeof r?.tick === 'string')
                    .map((r) => ({ chainId, tick: r.tick, divisibility: Number(r.divisibility) })))
                .catch(() => []);
        })).then((batches) => {
            if (!cancelled) setOwned(batches.flat());
        });
        return () => { cancelled = true; };
    }, [enabled, addressKey, messaging]);
    return owned;
}

function hasNonZeroQuantity(row) {
    try {
        return BigInt(row?.quantity ?? 0) !== 0n || BigInt(row?.pendingQuantity ?? 0) !== 0n;
    } catch {
        const quantity = Number(row?.quantity);
        const pending = Number(row?.pendingQuantity);
        return (Number.isFinite(quantity) && quantity !== 0)
            || (Number.isFinite(pending) && pending !== 0);
    }
}

// Builds an tick lookup keyed by `${chainId}|${tick}` so ActivityRow
// can resolve a token's imageUrl + divisibility when rendering a
// non-native row. Falls back gracefully to null when the token doesn't
// appear in the wallet's balances (e.g. a SEND of an tick the user
// no longer holds).
function buildTokenLookup(balances) {
    /** @type {Map<string, { divisibility?: number, imageUrl?: string | null, displayName?: string }>} */
    const m = new Map();
    if (!balances || typeof balances !== 'object') return m;
    for (const [chainId, entries] of Object.entries(balances)) {
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
            const native = e?.balances?.native;
            if (native?.tick) {
                m.set(`${chainId}|${native.tick}`, {
                    divisibility: native.divisibility,
                    imageUrl: null,
                    displayName: native.tick,
                });
            }
            const tokens = e?.balances?.tokens || [];
            for (const a of tokens) {
                if (!a?.tick) continue;
                m.set(`${chainId}|${a.tick}`, {
                    divisibility: a.divisibility,
                    imageUrl: typeof a.imageUrl === 'string' && a.imageUrl.length > 0 ? a.imageUrl : null,
                    displayName: a.displayName || a.tick,
                });
            }
        }
    }
    return m;
}

export const ActivityEntryRow = memo(function ActivityEntryRow({ entry, walletAddresses, assetLookup, chainTip, onSelectEntry, allowRemoteImages, chevron = false }) {
    const [balancesHidden] = useBalancesHidden();
    const kind = classifyEntryAction(entry, walletAddresses);
    const status = classifyEntryStatus(entry);
    const tick = activityRowTick(entry);
    const tokenInfo = tick ? (assetLookup.get(`${entry.chainId}|${tick}`) || null) : null;
    const tokenImageUrl = isAssetImageSourceAllowed(tokenInfo?.imageUrl, allowRemoteImages)
        ? tokenInfo.imageUrl
        : null;
    const nativeTicker = (entry.chainId.split('-')[0] || '').toUpperCase()
        .replace('BITCOIN', 'BTC')
        .replace('LITECOIN', 'LTC')
        .replace('DOGECOIN', 'DOGE');
    const isNative = tick === nativeTicker;
    // A row in the 'other' bucket reads its own action, as History's rows do.
    const label = activityEntryLabel(entry, walletAddresses);
    const direction = kind === 'send' ? 'out' : kind === 'receive' ? 'in' : null;
    // One formatter with History: a SEND carries whole units, every other
    // action base units.
    const amount = activityRowAmount(entry, {
        divisibility: tokenInfo?.divisibility ?? 8,
        direction,
    });
    const amountQualifier = activityRowAmountQualifier(entry);
    const primary = amount
        ? `${amount}${tick ? ` ${tick}` : ''}${amountQualifier ? ` ${amountQualifier}` : ''}`
        : (tick || nativeTicker);
    const displayPrimary = balancesHidden && primary ? '•••••' : primary;
    return (
        <li>
            <SharedActivityRow
                chainId={entry.chainId}
                tick={tick || nativeTicker}
                imageUrl={tokenImageUrl}
                isNative={isNative}
                label={label}
                actionIcon={actionIconForAction(kind === 'send' || kind === 'receive' ? kind : entry.action)}
                amount={displayPrimary}
                status={status}
                timestamp={entry.timestamp}
                block={entry.blockIndex
                    ? t('history.row.block', { block: String(entry.blockIndex) })
                    : null}
                onClick={typeof onSelectEntry === 'function' ? () => onSelectEntry({
                    ...entry,
                    detailContext: {
                        chainTip: chainTip ?? null,
                        indexerWatermark: null,
                        walletAddresses: [...walletAddresses],
                    },
                }) : undefined}
                // A row that opens its detail page reads as tappable with the
                // Back-sized forward chevron; a row that opens nothing has none.
                trailing={chevron && typeof onSelectEntry === 'function'
                    ? <span className={styles.rowChevron} data-row-chevron><Icon.ForwardIcon /></span>
                    : null}
                data-activity-row
            />
        </li>
    );
});

// The Activity tab ends with one full-width success button that opens the
// complete History feed; it renders only when the host can open History.
function SeeAllActivityButton({ onHistory }) {
    if (typeof onHistory !== 'function') return null;
    return (
        <Button
            variant="success"
            block
            className={styles.seeAllActivity}
            icon={<Icon.HistoryIcon />}
            onClick={onHistory}
        >
            {t('home.tabs.openHistory')}
        </Button>
    );
}

// The Activity tab's newest history rows in History's row layout, ending with
// See all activity, which opens the complete feed. The host loads the rows
// when the tab opens, so Home's first paint reads no history.
function RecentActivityList({ entries, failed, balances, networkFilter, query = '', onClearQuery, onOpen, onHistory, onSelectEntry, allowRemoteImages }) {
    useEffect(() => {
        if (typeof onOpen === 'function') onOpen();
    }, [onOpen]);
    const assetLookup = useMemo(() => buildTokenLookup(balances), [balances]);
    const walletAddresses = useMemo(
        () => new Set((entries || []).map((e) => e?.address).filter(Boolean)),
        [entries],
    );
    const rows = useMemo(() => {
        const recent = recentActivityEntries(entries);
        const onNetwork = networkFilter === 'all'
            ? recent
            : recent.filter((e) => coinFromChainId(e.chainId) === networkFilter);
        return query ? onNetwork.filter((e) => activityEntryMatchesQuery(e, query, walletAddresses)) : onNetwork;
    }, [entries, networkFilter, query, walletAddresses]);
    if (entries === null && !failed) {
        return (
            <>
                <p className={styles.tabNote} role="status">{t('home.tabs.loadingRecentActivity')}</p>
                <SeeAllActivityButton onHistory={onHistory} />
            </>
        );
    }
    if (rows.length === 0) {
        if (query && !failed) {
            return (
                <>
                    <EmptyState
                        title={t('home.tabs.noMatches')}
                        body={t('home.tabs.matchesAppearHereAfter')}
                        actionLabel={onClearQuery ? t('home.tabs.clearFilter') : undefined}
                        onAction={onClearQuery}
                    />
                    <SeeAllActivityButton onHistory={onHistory} />
                </>
            );
        }
        if (failed) {
            return (
                <>
                    <EmptyState
                        title={t('home.tabs.recentActivityUnavailable')}
                        body={t('home.tabs.recentActivityUnavailableBody')}
                    />
                    <SeeAllActivityButton onHistory={onHistory} />
                </>
            );
        }
        return (
            <>
                <EmptyState
                    title={networkFilter === 'all' ? t('history.empty.noActivityTitle') : t('home.tabs.noActivityOnThisNetwork')}
                    body={t('home.tabs.sendsReceivesAndOtherActionsAppear')}
                />
                <SeeAllActivityButton onHistory={onHistory} />
            </>
        );
    }
    return (
        <>
            <ul className={`${styles.demoList} ${styles.activityList}`} aria-label={t('home.tabs.recentActivity')}>
                {rows.map((e) => (
                    <ActivityEntryRow
                        key={e.key}
                        entry={e}
                        walletAddresses={walletAddresses}
                        assetLookup={assetLookup}
                        chainTip={null}
                        allowRemoteImages={allowRemoteImages}
                        onSelectEntry={onSelectEntry}
                    />
                ))}
            </ul>
            <SeeAllActivityButton onHistory={onHistory} />
        </>
    );
}

// Convert a DeFi position into a History-shaped entry so ActionDetail can
// render the same source row when the user opens it.
function defiPositionToEntry(position, idx) {
    const address = String(position.address || position.raw?.source || '');
    const aIdx = String(position.actionIndex || position.raw?.action_index || position.id || idx);
    return {
        key: `${position.chainId}:${aIdx}:${address}`,
        chainId: position.chainId,
        address,
        actionIndex: aIdx,
        action: position.action,
        blockIndex: Number(position.blockIndex || 0),
        timestamp: Number(position.timestamp || 0),
        txHash: String(position.txHash || position.raw?.tx_hash || ''),
        source: String(position.raw?.source || address),
        raw: { ...position.raw, ...position },
        link: null,
    };
}

function DefiList({ positions, failed, networkFilter, query = '', sortBy = 'name', onClearQuery, balances, onOpen, onSelectEntry, allowRemoteImages }) {
    const [balancesHidden] = useBalancesHidden();
    useEffect(() => {
        if (typeof onOpen === 'function') onOpen();
    }, [onOpen]);
    const rows = useMemo(() => {
        const all = Array.isArray(positions) ? positions : [];
        const onNetwork = networkFilter === 'all'
            ? all
            : all.filter((p) => coinFromChainId(p.chainId) === networkFilter);
        const matching = query ? onNetwork.filter((p) => defiPositionMatchesQuery(p, query)) : onNetwork;
        return sortDefiPositions(matching, sortBy);
    }, [positions, networkFilter, query, sortBy]);
    const assetLookup = useMemo(() => buildTokenLookup(balances), [balances]);

    if (positions === null && !failed && typeof onOpen === 'function') {
        return <p className={styles.tabNote} role="status">{t('home.tabs.loadingDefiPositions')}</p>;
    }
    if (rows.length === 0) {
        if (query && !failed) {
            return (
                <EmptyState
                    title={t('home.tabs.noMatches')}
                    body={t('home.tabs.matchesAppearHereAfter')}
                    actionLabel={onClearQuery ? t('home.tabs.clearFilter') : undefined}
                    onAction={onClearQuery}
                />
            );
        }
        if (failed) {
            return (
                <EmptyState
                    title={t('home.tabs.defiPositionsUnavailable')}
                    body={t('home.tabs.defiPositionsUnavailableBody')}
                />
            );
        }
        return (
            <EmptyState
                title={t('home.tabs.noDefiPositionsYet')}
                body={t('home.tabs.stakingDispensersContractBalancesAnd')}
            />
        );
    }
    return (
        <ul className={`${styles.demoList} ${styles.activityList}`}>
            {rows.map((p, idx) => {
                // A stake is always XCHAIN, the protocol's only stakeable
                // token, drawn with its product mark; a row whose tick is the
                // chain's native ticker draws the chain mark; any other
                // token draws its artwork with the chain overlay.
                const isStake = p.action === 'STAKE';
                const nativeTicker = (p.chainId.split('-')[0] || '').toUpperCase()
                    .replace('BITCOIN', 'BTC')
                    .replace('LITECOIN', 'LTC')
                    .replace('DOGECOIN', 'DOGE');
                const tick = isStake ? 'XCHAIN' : (p.tick || '');
                const isNativeAsset = !isStake && Boolean(tick) && tick === nativeTicker;
                const tokenInfo = (!isStake && tick && !isNativeAsset)
                    ? assetLookup.get(`${p.chainId}|${tick}`)
                    : null;
                const imageUrl = isStake
                    ? branding.faviconUrl()
                    : isAssetImageSourceAllowed(tokenInfo?.imageUrl, allowRemoteImages)
                        ? tokenInfo.imageUrl
                        : null;
                return (
                    <li key={p.id}>
                        <SharedActivityRow
                            chainId={p.chainId}
                            tick={tick || p.action}
                            imageUrl={imageUrl}
                            isNative={isNativeAsset}
                            label={actionDisplayLabel(p.action)}
                            actionIcon={actionIconForAction(p.action)}
                            amount={balancesHidden ? '•••••' : p.primary}
                            /* Two lines, the height of a Coins or Tokens row: the status
                               badge beside the action, the date beside the amount, and no
                               block number. */
                            className={styles.defiRow}
                            status={p.status}
                            timestamp={p.timestamp}
                            block={null}
                            onClick={typeof onSelectEntry === 'function'
                                ? () => onSelectEntry(defiPositionToEntry(p, idx))
                                : undefined}
                            /* The Back-sized chevron the Coins and Tokens rows carry. */
                            trailing={typeof onSelectEntry === 'function'
                                ? <span className={styles.rowChevron}><Icon.ForwardIcon /></span>
                                : null}
                            data-activity-row
                        />
                    </li>
                );
            })}
        </ul>
    );
}
