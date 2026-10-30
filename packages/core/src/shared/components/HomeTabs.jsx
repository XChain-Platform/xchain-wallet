// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { memo, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { EmptyState, Icon, Tabs } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    BalanceList,
    buildBalanceRows,
    buildPlatformTokenRow,
    detectSpamCandidates,
    sortByChainThenAsset,
    coinFromChainId,
    fiatValue,
    isAssetImageSourceAllowed,
    tickerColor,
} from './BalanceList.jsx';
import balanceStyles from './BalanceList.module.css';
import { CollectiblesView } from './CollectiblesView.jsx';
import { TotalBalanceHero as TotalBalanceHeroBase } from './TotalBalanceHero.jsx';
import { PortfolioChart as PortfolioChartBase } from './PortfolioChart.jsx';
import { RouteErrorBoundary } from './RouteErrorBoundary.jsx';
import { HomeFilterBar } from './HomeFilterBar.jsx';
import { BalancesUncheckedState } from './BalancesUncheckedState.jsx';
import { activityRowAmount } from '../utils/activityAmount.js';
import { ActivityRow as SharedActivityRow } from './ActivityRow.jsx';
import {
    isDemoWallet,
    synthesizeDemoHistory,
    synthesizeDemoDefiPositions,
} from '@xchain-wallet/core/flows';
import { synthesizeDemoNativePrices } from '../../flows/demoFixtures.js';
import { classifyEntryAction, classifyEntryStatus } from '../utils/historyFilter.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
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
import { isMainnetChainId } from '../utils/mainnetChain.js';
import { formatRelativeTime } from '../utils/dateTime.js';
import { compareDecimalStrings } from '../utils/amountFormat.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import styles from './HomeTabs.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/receive.js';
import '../../i18n/locales/en/walletDetails.js';

const TotalBalanceHero = memo(TotalBalanceHeroBase);
const PortfolioChart = memo(PortfolioChartBase);

const BALANCE_SORT_STORAGE_KEY = 'xc:balances:sort';
const BALANCE_SORT_OPTIONS = new Set(['value', 'name', 'change']);

function balanceSortStorageKey(walletId) {
    return `${BALANCE_SORT_STORAGE_KEY}:${walletId || 'none'}`;
}

function readBalanceSort(walletId) {
    try {
        const value = globalThis.localStorage?.getItem(balanceSortStorageKey(walletId));
        return BALANCE_SORT_OPTIONS.has(value) ? value : 'value';
    } catch {
        return 'value';
    }
}

function persistBalanceSort(walletId, value) {
    try {
        globalThis.localStorage?.setItem(balanceSortStorageKey(walletId), value);
    } catch {
        // Storage can be unavailable in privacy-restricted shells.
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
 * Missing values and changes stay at the end, with name order as the stable
 * fallback so an unavailable price never makes a row jump unpredictably.
 */
export function sortBalanceRows(rows, sortBy, nativePriceMap = {}) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    if (sortBy === 'name') return list.sort(compareBalanceNames);
    return list.sort((a, b) => {
        const aMetric = sortBy === 'change'
            ? (Number.isFinite(a.change24hPct)
                ? a.change24hPct
                : nativePriceMap[a.chainId]?.change24hPct)
            : fiatValue(a.quantity, a.divisibility, a.fiatRate);
        const bMetric = sortBy === 'change'
            ? (Number.isFinite(b.change24hPct)
                ? b.change24hPct
                : nativePriceMap[b.chainId]?.change24hPct)
            : fiatValue(b.quantity, b.divisibility, b.fiatRate);
        const aMissing = sortBy === 'change'
            ? !Number.isFinite(Number(aMetric))
            : aMetric === null;
        const bMissing = sortBy === 'change'
            ? !Number.isFinite(Number(bMetric))
            : bMetric === null;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        if (aMissing) return compareBalanceNames(a, b);
        const compared = sortBy === 'change'
            ? Math.sign(Number(bMetric) - Number(aMetric))
            : compareDecimalStrings(String(bMetric), String(aMetric));
        return compared || compareBalanceNames(a, b);
    });
}

/**
 * Top-level tabbed view for Home.
 *
 *   Coins    - native rows (BTC / LTC / DOGE / …) only
 *   Tokens   - every non-native tick, divisible or not
 *   NFTs     - the subset of Tokens matching the protocol collectible
 *              rule (DECIMALS = 0 AND LOCK_MAX_SUPPLY = 1)
 *   History  - chronological transaction stream (placeholder)
 *   DeFi     - staking, dispensers, contracts (placeholder)
 *
 * The Tokens and NFTs descriptions above were stale until 2026-09-22 and
 * are the reason the tab read as arbitrary: they described a divisible /
 * indivisible split the code stopped implementing. NFTs is a subset of
 * Tokens, not its complement, and the rule is now stated on screen too
 * rather than left for the user to infer.
 *
 * Network filter applies across every tab so flipping `BTC` filters
 * all tabs to BTC at once. Filter state owned here so it persists
 * when the user moves between tabs.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {Record<string, Array<{ balances: any | null }>>} props.balances
 * @param {number | null} [props.balancesFetchedAt]   Unix ms of the last successful balance fetch. Drives the staleness label below the tab strip (Cluster G FOLLOWUP 5 / G155).
 * @param {string} props.networkFilter   'all' or a coin family
 * @param {{ threshold: number, cosignerCount: number, scheme: string } | null} [props.multisig]
 * @param {string} [props.multisigChainId]
 * @param {import('react').ReactNode} [props.actions]   slot rendered between the total-balance hero and the tab strip; used by Home for the Send / Receive / Swap / Buy quick-action row
 * @param {() => void} [props.onReceive]   forwarded to empty-state nudges so the "No balances yet" cards can render a one-tap Receive CTA (G077)
 * @param {() => void} [props.onBuy]       opens the coin exchange from the first-funding state
 * @param {boolean} [props.hasAddresses]   whether the active account has any receiving address
 * @param {() => void} [props.onAddAddress] opens address generation for an account with no addresses
 * @param {() => void} [props.onHistory]   opens the complete chronological feed from the non-demo Activity placeholder
 * @param {boolean} [props.hideSmallBalances]: `settings.privacy.hideSmallBalances`, forwarded to the Coins and Tokens lists so dust rows collapse into their own section
 * @param {() => void} [props.onRefresh]    manually refreshes portfolio balances and expired prices
 * @param {boolean} [props.refreshing]      whether a manual portfolio refresh is running
 * @param {boolean} [props.balancesUnchecked] balances could not be checked: an empty tab says that instead of "nothing yet"
 * @param {() => void} [props.onRecheckBalances] rechecks reachability and balances from that state
 * @param {boolean} [props.balanceNoticeShown] Home shows its own balance notice, so an empty tab shows no empty state
 */
export const HomeTabs = memo(function HomeTabs({ chainRegistry, balances, activeByChain = null, balancesFetchedAt, walletId, networkFilter, tokenQuery = '', coinFamilies, onNetworkFilterChange, onTokenQueryChange, multisig, multisigChainId, actions, onReceive, onBuy, hasAddresses = true, onAddAddress, onHistory, onSelectToken, onSelectEntry, pinnedKeys, onTogglePin, hiddenKeys, onToggleHide, verifyProofsEnabled = false, hideSmallBalances = false, onRefresh, refreshing = false, onCommandPalette, onOpenSettings, onLockWallet, balancesUnchecked = false, onRecheckBalances, balanceNoticeShown = false }) {
    const tabsId = useId();
    const [active, setActive] = useState('coins');
    const [sortBy, setSortBy] = useState(() => readBalanceSort(walletId));
    const isDemo = isDemoWallet(walletId);
    // Inline filter row (search + network dropdown) is collapsed by
    // default and revealed by the filter button in the hero. State lives
    // here so it persists across tab switches.
    // It opens on its own while a token query is live: the query outlives
    // this component (the shell owns it), so a remount would otherwise hide
    // the only control showing why the Tokens list is empty.
    const [filterOpen, setFilterOpen] = useState(() => tokenQuery.trim().length > 0);
    const canFilter = typeof onNetworkFilterChange === 'function' && typeof onTokenQueryChange === 'function';
    const toggleFilter = useCallback(() => setFilterOpen((value) => !value), []);
    const { messaging } = useMessaging();
    const verifyMap = useProofVerification({
        messaging,
        balances,
        enabled: verifyProofsEnabled && active === 'tokens',
    });

    useEffect(() => {
        setSortBy(readBalanceSort(walletId));
    }, [walletId]);

    const builtRows = useMemo(
        () => buildBalanceRows(balances, chainRegistry, activeByChain),
        [balances, chainRegistry, activeByChain],
    );
    const balanceChainIds = useMemo(() => Object.keys(balances || {}), [balances]);
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
    // Every tab names the tokens it wants priced so the hero keeps any rate
    // already in the shared store; only the Tokens tab may fetch fresh ones.
    // Gating the list itself dropped known token values from the total each
    // time the user left the Tokens tab.
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
        refreshEnabled: Boolean(settings) && !settingsLoading && active === 'tokens',
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
    const coins = useMemo(
        () => sortBalanceRows(filteredRows.filter((r) => r.kind === 'native'), sortBy, nativePriceMap),
        [filteredRows, sortBy, nativePriceMap],
    );
    // Tokens = every non-native tick, regardless of divisibility or
    // imagery. The single canonical "what do I hold?" surface.
    const tokens = useMemo(
        () => active === 'tokens'
            ? sortBalanceRows(filteredRows.filter(
                (r) => r.kind !== 'native',
            ), sortBy, nativePriceMap)
            : [],
        [active, filteredRows, sortBy, nativePriceMap],
    );
    const tokenQueryTrim = tokenQuery.trim().toLowerCase();
    // Off for a demo wallet: its rows carry the wallet's real addresses, and
    // a demo wallet's addresses never go to an explorer (issue #82).
    const ownedTokens = useOwnedTokens(
        balances,
        !isDemo && (active === 'tokens' || settings?.hideUnknownTokens === true),
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
    // Test coins have no market price, so the fiat chart is hidden only when
    // every held row is on a test network; an empty wallet keeps its chart,
    // and the demo wallet prices its synthetic test-network holdings.
    const chainRows = portfolioRows.filter((row) => typeof row?.chainId === 'string' && row.chainId);
    const testCoinsOnly = !isDemoWallet(walletId)
        && chainRows.length > 0
        && chainRows.every((row) => !isMainnetChainId(row.chainId));
    const issuedUnheld = useMemo(() => {
        if (active !== 'tokens') return [];
        const held = new Set(allRows.map((r) => `${r.chainId}:${r.tick}`));
        const out = [];
        for (const o of ownedTokens) {
            if (held.has(`${o.chainId}:${o.tick}`)) continue;
            const coin = chainRegistry.get(o.chainId)?.coin || coinFromChainId(o.chainId);
            if (networkFilter !== 'all' && coin !== networkFilter) continue;
            if (tokenQueryTrim && !o.tick.toLowerCase().includes(tokenQueryTrim)) continue;
            const row = buildPlatformTokenRow(o.chainId, o.tick, null, chainRegistry);
            if (!row) continue;
            out.push(Number.isFinite(o.divisibility) ? { ...row, divisibility: o.divisibility } : row);
        }
        return sortByChainThenAsset(out);
    }, [active, ownedTokens, allRows, networkFilter, tokenQueryTrim, chainRegistry]);
    const filteredTokens = useMemo(() => {
        if (!tokenQueryTrim) return tokens;
        return tokens.filter((r) => {
            const tick = String(r.tick || '').toLowerCase();
            const name = String(r.displayName || '').toLowerCase();
            return tick.includes(tokenQueryTrim) || name.includes(tokenQueryTrim);
        });
    }, [tokens, tokenQueryTrim]);
    const pricedTokens = useMemo(
        () => filteredTokens.filter((row) => fiatValue(row.quantity, row.divisibility, row.fiatRate) !== null),
        [filteredTokens],
    );
    const unpricedTokens = useMemo(
        () => filteredTokens.filter((row) => fiatValue(row.quantity, row.divisibility, row.fiatRate) === null),
        [filteredTokens],
    );
    const pricesFetchedAt = useMemo(() => {
        let oldest = null;
        for (const row of filteredRows) {
            if (!hasNonZeroQuantity(row) || fiatValue(row.quantity, row.divisibility, row.fiatRate) === null) continue;
            const fetchedAt = Date.parse(row.fiatRateFetchedAt);
            if (!Number.isFinite(fetchedAt)) continue;
            oldest = oldest === null ? fetchedAt : Math.min(oldest, fetchedAt);
        }
        return oldest;
    }, [filteredRows]);
    // A row whose balance read failed may hold funds, so it never reads as
    // an empty wallet that needs its first funding.
    const hasHoldings = allRows.some((row) => hasNonZeroQuantity(row) || Boolean(row?.unavailable));
    const showFirstFunding = networkFilter === 'all' && !tokenQueryTrim && !hasHoldings;
    // An empty tab while balances could not be checked proves nothing, so it
    // says that once (and the shell's stale-balances notice steps aside).
    // While Home's own balance notice is up, that notice is the one message
    // and an empty tab stays quiet.
    const quietEmpty = Boolean(balanceNoticeShown) && !isDemo;
    const showUnchecked = !quietEmpty && balancesUnchecked && !isDemo && typeof onRecheckBalances === 'function';
    const uncheckedState = showUnchecked ? (
        <BalancesUncheckedState
            plain={false}
            onRetry={onRecheckBalances}
            onReceive={hasAddresses ? onReceive : undefined}
        />
    ) : null;
    const showBalanceSort = (active === 'coins' && !showFirstFunding && coins.length > 0)
        || (active === 'tokens' && filteredTokens.length > 0);
    // NFTs = tokens matching the canonical NFT pattern (NFT_Standard.md:
    // DECIMALS=0 AND LOCK_MAX_SUPPLY=1 (indivisible, supply can never
    // inflate). Classification, not decoration: a divisible token with a
    // pretty icon (e.g. PEPECASH) belongs in Tokens, not here, and a true
    // collectible with no artwork still earns its tile (letter fallback).
    // A tick can appear in BOTH Tokens (balance row) and NFTs (tile).
    const collectibleKeys = useCollectibleKeys(active === 'nfts' ? filteredRows : [], isDemo);
    const nfts = useMemo(
        () => active === 'nfts'
            ? sortByChainThenAsset(filteredRows.filter(
                (r) => r.kind !== 'native'
                    && collectibleKeys.has(`${r.chainId}:${r.tick}`),
            ))
            : [],
        [active, filteredRows, collectibleKeys],
    );

    const tabs = [
        { id: 'coins',    label: t('home.tabs.coins')    },
        { id: 'tokens',   label: t('home.tabs.tokens')   },
        { id: 'nfts',     label: t('home.tabs.nfts')     },
        { id: 'defi',     label: t('home.tabs.defi')     },
        { id: 'activity', label: t('home.tabs.activity') },
    ];

    return (
        <div className={styles.wrap}>
            {/* Hero rolls up visible coins + tokens + NFTs. DeFi + Activity contribute
                their own dollar amounts via separate flows once they
                wire up; for now they're not in the sum. */}
            <RouteErrorBoundary
                variant="compact"
                resetKey={`${walletId || ''}:${networkFilter}:price`}
            >
                <TotalBalanceHero
                    rows={portfolioRows}
                    walletId={walletId}
                    networkFilter={networkFilter}
                    lastSyncedAt={balancesFetchedAt}
                    pricesFetchedAt={pricesFetchedAt}
                    onRefresh={onRefresh}
                    refreshing={refreshing}
                    filterOpen={filterOpen}
                    onToggleFilter={canFilter ? toggleFilter : undefined}
                    onCommandPalette={onCommandPalette}
                    onOpenSettings={onOpenSettings}
                    onLockWallet={onLockWallet}
                    nativePriceMap={nativePriceMap}
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
                    />
                ) : null}
            </RouteErrorBoundary>

            {actions}

            {canFilter && filterOpen ? (
                <HomeFilterBar
                    chainRegistry={chainRegistry}
                    coinFamilies={coinFamilies || []}
                    networkFilter={networkFilter}
                    onNetworkFilterChange={onNetworkFilterChange}
                    tokenQuery={tokenQuery}
                    onTokenQueryChange={onTokenQueryChange}
                />
            ) : null}

            <div className={styles.tabsRow}>
                <Tabs
                    id={tabsId}
                    items={tabs}
                    value={active}
                    onChange={setActive}
                    panelId={`${tabsId}-panel`}
                    aria-label={t('home.tabs.walletView')}
                />

                {showBalanceSort ? (
                    <label className={styles.sortControl}>
                        <span className={styles.sortLabel}>{t('home.tabs.sortBalances')}</span>
                        <span className={styles.sortCompactValue} aria-hidden="true">
                            {sortBy === 'change' ? t('home.tabs.24hChange') : sortBy[0].toUpperCase() + sortBy.slice(1)}
                        </span>
                        <span className={styles.sortCompactIcon} aria-hidden="true">
                            <Icon.ChevronDownIcon />
                        </span>
                        <select
                            className={styles.sortSelect}
                            aria-label={t('home.tabs.sortBalances')}
                            value={sortBy}
                            onChange={(event) => {
                                const value = event.target.value;
                                if (!BALANCE_SORT_OPTIONS.has(value)) return;
                                setSortBy(value);
                                persistBalanceSort(walletId, value);
                            }}
                        >
                            <option value="value">{t('home.tabs.value')}</option>
                            <option value="name">{t('walletDetails.name')}</option>
                            <option value="change">{t('home.tabs.24hChange')}</option>
                        </select>
                    </label>
                ) : null}
            </div>

            <div
                id={`${tabsId}-panel`}
                className={styles.panel}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${active}`}
            >
                {active === 'coins' && showUnchecked && (showFirstFunding || coins.length === 0) ? uncheckedState : null}
                {active === 'coins' && !(showUnchecked && (showFirstFunding || coins.length === 0))
                    && !(quietEmpty && (showFirstFunding || coins.length === 0)) ? (
                    showFirstFunding ? (
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
                            rows={coins}
                            fiatCurrency={settings?.fiatCurrency || 'USD'}
                            multisig={multisig}
                            multisigChainId={multisigChainId}
                            emptyTitle={networkFilter === 'all' ? t('home.tabs.noCoinsYet') : t('home.tabs.noCoinsOnThisNetwork')}
                            emptyBody={networkFilter === 'all'
                                ? t('home.tabs.coinsAppearHereAfterYou')
                                : t('home.tabs.coinsOnThisNetworkAppear')}
                            onReceive={networkFilter === 'all' ? onReceive : undefined}
                            onSelectToken={onSelectToken}
                            pinnedKeys={pinnedKeys}
                            onTogglePin={onTogglePin}
                            hiddenKeys={hiddenKeys}
                            automaticHiddenKeys={automaticHiddenKeys}
                            onToggleHide={onToggleHide}
                            hideSmallBalances={hideSmallBalances}
                            smallBalanceThreshold={settings?.smallBalanceThreshold}
                            numberFormat={settings?.numberFormat}
                            allowRemoteImages={allowRemoteImages}
                            showChain={networkFilter === 'all'}
                        />
                    )
                ) : null}

                {active === 'tokens' ? (
                    <>
                    {filteredTokens.length === 0 && showUnchecked && !tokenQueryTrim ? uncheckedState : null}
                    {filteredTokens.length === 0 && !(showUnchecked && !tokenQueryTrim) && !(quietEmpty && !tokenQueryTrim) ? (
                        <BalanceList
                            rows={[]}
                            emptyTitle={tokenQueryTrim
                                ? t('home.tabs.noMatchingTokens')
                                : (networkFilter === 'all' ? t('home.tabs.noTokensYet') : t('home.tabs.noTokensOnThisNetwork'))}
                            emptyBody={tokenQueryTrim
                                ? t('home.tabs.matchingTokensAppearHereAfter')
                                : (networkFilter === 'all'
                                    ? t('home.tabs.tokensAppearHereAfterYou')
                                    : t('home.tabs.tokensOnThisNetworkAppear'))}
                            emptyActionLabel={tokenQueryTrim && canFilter ? t('home.tabs.clearFilter') : undefined}
                            onEmptyAction={tokenQueryTrim && canFilter ? () => onTokenQueryChange('') : undefined}
                        />
                    ) : null}
                    {pricedTokens.length > 0 ? (
                        <BalanceList
                            rows={pricedTokens}
                            fiatCurrency={settings?.fiatCurrency || 'USD'}
                            onSelectToken={onSelectToken}
                            pinnedKeys={pinnedKeys}
                            onTogglePin={onTogglePin}
                            hiddenKeys={hiddenKeys}
                            automaticHiddenKeys={automaticHiddenKeys}
                            onToggleHide={onToggleHide}
                            verifyMap={verifyMap}
                            hideSmallBalances={hideSmallBalances}
                            smallBalanceThreshold={settings?.smallBalanceThreshold}
                            numberFormat={settings?.numberFormat}
                            allowRemoteImages={allowRemoteImages}
                            showChain={networkFilter === 'all'}
                        />
                    ) : null}
                    {unpricedTokens.length > 0 ? (
                        <section aria-label={t('home.tabs.unpricedTokens')}>
                            <p className={styles.tabNote}>{t('home.tabs.unpricedTokens')}</p>
                            <BalanceList
                                rows={unpricedTokens}
                                fiatCurrency={settings?.fiatCurrency || 'USD'}
                                onSelectToken={onSelectToken}
                                pinnedKeys={pinnedKeys}
                                onTogglePin={onTogglePin}
                                hiddenKeys={hiddenKeys}
                                automaticHiddenKeys={automaticHiddenKeys}
                                onToggleHide={onToggleHide}
                                verifyMap={verifyMap}
                                hideSmallBalances={hideSmallBalances}
                                smallBalanceThreshold={settings?.smallBalanceThreshold}
                                numberFormat={settings?.numberFormat}
                                allowRemoteImages={allowRemoteImages}
                                showChain={networkFilter === 'all'}
                            />
                        </section>
                    ) : null}
                    {issuedUnheld.length > 0 ? (
                        <section aria-label={t('home.tabs.issuedByYou')} data-testid="issued-unheld">
                            <p className={styles.tabNote}>{t('home.tabs.issuedByYou')}</p>
                            <BalanceList
                                rows={issuedUnheld}
                                fiatCurrency={settings?.fiatCurrency || 'USD'}
                                onSelectToken={onSelectToken}
                                pinnedKeys={pinnedKeys}
                                onTogglePin={onTogglePin}
                                hiddenKeys={hiddenKeys}
                                automaticHiddenKeys={automaticHiddenKeys}
                                onToggleHide={onToggleHide}
                                verifyMap={verifyMap}
                                numberFormat={settings?.numberFormat}
                                allowRemoteImages={allowRemoteImages}
                                showChain={networkFilter === 'all'}
                            />
                        </section>
                    ) : null}
                    </>
                ) : null}

                {active === 'nfts' ? (
                    <>
                        {/* The rule, on screen. A user holding six ticks under
                            Tokens and two here cannot otherwise tell why, and
                            guessing "the ones with pictures" is wrong: artwork
                            plays no part in it. Wording tracks
                            protocol/NFT_Standard.md. */}
                        {nfts.length > 0 ? (
                        <p className={styles.tabNote}>
                            {t('home.tabs.aTickAppearsHereWhen')}
                        </p>
                        ) : null}
                        <RouteErrorBoundary
                            variant="compact"
                            resetKey={`${walletId || ''}:${networkFilter}:collectibles`}
                        >
                            <CollectiblesView
                                rows={nfts}
                                demo={isDemo}
                                emptyTitle={networkFilter === 'all' ? t('home.tabs.noCollectiblesYet') : t('home.tabs.noCollectiblesOnThisNetwork')}
                                emptyBody={networkFilter === 'all'
                                    ? t('home.tabs.collectiblesAppearHereAfterYou')
                                    : t('home.tabs.collectiblesOnThisNetworkAppear')}
                                onReceive={networkFilter === 'all' ? onReceive : undefined}
                                onSelectToken={onSelectToken}
                                pinnedKeys={pinnedKeys}
                                onTogglePin={onTogglePin}
                                hiddenKeys={hiddenKeys}
                                automaticHiddenKeys={automaticHiddenKeys}
                                onToggleHide={onToggleHide}
                                allowRemoteImages={allowRemoteImages}
                            />
                        </RouteErrorBoundary>
                    </>
                ) : null}

                {active === 'activity' ? (
                    isDemo ? (
                        <DemoActivityList
                            chainIds={balanceChainIds}
                            balances={balances}
                            networkFilter={networkFilter}
                            walletId={walletId}
                            onSelectEntry={onSelectEntry}
                            allowRemoteImages={allowRemoteImages}
                        />
                    ) : (
                        <EmptyState
                            title={t('home.tabs.yourActivityIsInHistory')}
                            body={t('home.tabs.everySendReceiveAndOther')}
                            actionLabel={t('home.tabs.openHistory')}
                            onAction={onHistory}
                        />
                    )
                ) : null}

                {active === 'defi' ? (
                    isDemo ? (
                        <DemoDefiList
                            networkFilter={networkFilter}
                            balances={balances}
                            chainRegistry={chainRegistry}
                            onSelectEntry={onSelectEntry}
                            allowRemoteImages={allowRemoteImages}
                        />
                    ) : (
                        <EmptyState
                            title={t('home.tabs.noDefiPositionsYet')}
                            body={t('home.tabs.stakingDispensersContractBalancesAnd')}
                        />
                    )
                ) : null}
            </div>
        </div>
    );
});

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

const ACTION_ICON = {
    send:       (k) => <Icon.SendIcon key={k} />,
    receive:    (k) => <Icon.ReceiveIcon key={k} />,
    issue:      (k) => <Icon.PlusIcon key={k} />,
    mint:       (k) => <Icon.TokenIcon key={k} />,
    destroy:    (k) => <Icon.TrashIcon key={k} />,
    sweep:      (k) => <Icon.DownloadIcon key={k} />,
    dispenser:  (k) => <Icon.MarketIcon key={k} />,
    dispense:   (k) => <Icon.DownloadIcon key={k} />,
    order:      (k) => <Icon.MarketIcon key={k} />,
    swap:       (k) => <Icon.SwapIcon key={k} />,
    dividend:   (k) => <Icon.DollarIcon key={k} />,
    broadcast:  (k) => <Icon.BroadcastIcon key={k} />,
    message:    (k) => <Icon.MessageIcon key={k} />,
    crosschain: (k) => <Icon.LinkIcon key={k} />,
    stake:      (k) => <Icon.StakeIcon key={k} />,
    contract:   (k) => <Icon.ContractIcon key={k} />,
    other:      (k) => <Icon.HistoryIcon key={k} />,
};

const ActivityEntryRow = memo(function ActivityEntryRow({ entry, walletAddresses, assetLookup, chainTip, onSelectEntry, allowRemoteImages }) {
    const [balancesHidden] = useBalancesHidden();
    const kind = classifyEntryAction(entry, walletAddresses);
    const status = classifyEntryStatus(entry);
    const tick = entry.raw?.tick || entry.raw?.TICK || '';
    const tokenInfo = tick ? (assetLookup.get(`${entry.chainId}|${tick}`) || null) : null;
    const tokenImageUrl = isAssetImageSourceAllowed(tokenInfo?.imageUrl, allowRemoteImages)
        ? tokenInfo.imageUrl
        : null;
    const nativeTicker = (entry.chainId.split('-')[0] || '').toUpperCase()
        .replace('BITCOIN', 'BTC')
        .replace('LITECOIN', 'LTC')
        .replace('DOGECOIN', 'DOGE');
    const isNative = tick === nativeTicker;
    const label = actionDisplayLabel(kind) || actionDisplayLabel(entry.action) || 'Event';
    const direction = kind === 'send' ? 'out' : kind === 'receive' ? 'in' : null;
    // One formatter with History: a SEND carries whole units, every other
    // action base units.
    const amount = activityRowAmount(entry, {
        divisibility: tokenInfo?.divisibility ?? 8,
        direction,
    });
    const primary = amount
        ? `${amount}${tick ? ` ${tick}` : ''}`
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
                amount={displayPrimary}
                status={status}
                timestamp={entry.timestamp}
                onClick={typeof onSelectEntry === 'function' ? () => onSelectEntry({
                    ...entry,
                    detailContext: {
                        chainTip: chainTip ?? null,
                        indexerWatermark: null,
                        walletAddresses: [...walletAddresses],
                    },
                }) : undefined}
                data-activity-row
            />
        </li>
    );
});

// Demo activity feed: synthesizes per-chain rows, wraps each in the
// History entry shape so onSelectEntry can hand them to ActionDetail.
function DemoActivityList({ chainIds, balances, networkFilter, walletId, onSelectEntry, allowRemoteImages }) {
    void walletId;
    const walletAddresses = useMemo(() => new Set(['demo-address']), []);
    const assetLookup = useMemo(() => buildTokenLookup(balances), [balances]);
    const entries = useMemo(() => {
        /** @type {Array<any>} */
        const all = [];
        for (const cid of chainIds) {
            if (networkFilter !== 'all' && coinFromChainId(cid) !== networkFilter) continue;
            const history = synthesizeDemoHistory(cid, 'demo-address');
            for (const h of history) {
                const aIdx = String(h.action_index ?? h.actionIndex ?? '');
                if (!aIdx) continue;
                all.push({
                    key: `${cid}|${aIdx}:demo-address`,
                    chainId: cid,
                    address: 'demo-address',
                    actionIndex: aIdx,
                    action: String(h.action || 'ACTION'),
                    blockIndex: Number(h.block_index ?? h.blockIndex ?? 0),
                    timestamp: Number(h.timestamp ?? 0),
                    txHash: String(h.tx_hash ?? h.txHash ?? ''),
                    source: String(h.source ?? ''),
                    raw: h,
                    link: null,
                });
            }
        }
        return all.sort((a, b) => b.timestamp - a.timestamp);
    }, [chainIds, networkFilter]);

    // Synthetic chain tip per chainId: max blockIndex across visible entries
    // plus a small buffer, so the detail view reads a plausible confirmation
    // count instead of "1" for the freshest confirmed entry.
    const chainTips = useMemo(() => {
        /** @type {Record<string, number>} */
        const tips = {};
        for (const e of entries) {
            if (!e.chainId || !e.blockIndex) continue;
            if (!tips[e.chainId] || e.blockIndex > tips[e.chainId]) {
                tips[e.chainId] = e.blockIndex;
            }
        }
        for (const cid of Object.keys(tips)) tips[cid] += 8;
        return tips;
    }, [entries]);

    if (entries.length === 0) {
        return <EmptyState title={t('history.empty.noActivityTitle')} body={t('home.tabs.synthesizedDemoActivityWillAppear')} />;
    }
    return (
        <ul className={`${styles.demoList} ${styles.activityList}`}>
            {entries.map((e) => (
                <ActivityEntryRow
                    key={e.key}
                    entry={e}
                    walletAddresses={walletAddresses}
                    assetLookup={assetLookup}
                    chainTip={chainTips[e.chainId] || null}
                    allowRemoteImages={allowRemoteImages}
                    onSelectEntry={onSelectEntry}
                />
            ))}
        </ul>
    );
}

// DeFi action list: three-line history-row style. Left side is always
// the XCHAIN product mark (the only thing stakeable on the protocol)
// with the chain icon overlaid in the bottom-right; right side surfaces
// the action label + status on line one, the primary subject (amount /
// token / lock) on line two, and block / confirms / relative time on
// line three.
// Convert a synthetic DeFi position into a History-shaped entry so the
// shared ActionDetail page can render it. action_index / tx_hash are
// fabricated (the position doesn't have a real on-chain index) but are
// stable per position, so navigating back and forth keeps the same key.
function defiPositionToEntry(position, idx) {
    const aIdx = String(300000 + idx);
    return {
        key: `${position.chainId}|${aIdx}:demo-address`,
        chainId: position.chainId,
        address: 'demo-address',
        actionIndex: aIdx,
        action: position.action,
        blockIndex: Number(position.blockIndex || 0),
        timestamp: Number(position.timestamp || 0),
        txHash: `demo-defi-${position.id}`,
        source: 'demo-address',
        raw: { ...position },
        link: null,
    };
}

function DemoDefiList({ networkFilter, balances, chainRegistry, onSelectEntry, allowRemoteImages }) {
    const [balancesHidden] = useBalancesHidden();
    const positions = useMemo(() => {
        const all = synthesizeDemoDefiPositions();
        const filtered = networkFilter === 'all'
            ? all
            : all.filter((p) => coinFromChainId(p.chainId) === networkFilter);
        return [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }, [networkFilter]);
    const assetLookup = useMemo(() => buildTokenLookup(balances), [balances]);

    if (positions.length === 0) {
        return <EmptyState title={t('home.tabs.noDefiPositions')} body={t('home.tabs.noDemoPositionsOnThe')} />;
    }
    return (
        <ul className={styles.demoList}>
            {positions.map((p, idx) => {
                const chainIconUrl = branding.chainIconSmallUrl(p.chainId);
                const statusLabel = p.status === 'confirmed' ? 'Confirmed'
                    : p.status === 'failed' ? 'Failed'
                    : 'Pending';
                const statusClass = p.status === 'confirmed' ? styles.statusValid
                    : p.status === 'failed' ? styles.statusInvalid
                    : styles.statusPending;
                // Icon resolution:
                //   STAKE   → XCHAIN product mark (square) + chain overlay,
                //             because the only stakeable token on the
                //             protocol is XCHAIN and stake is BTC-only.
                //   native  → circular chain icon (no overlay), when the
                //             row's tick matches the chain's native ticker
                //             (e.g. a contract holding BTC on Bitcoin).
                //   token   → square token image / tinted-letter, with a
                //             chain icon overlay so the user can tell
                //             which chain it lives on.
                const isStake = p.action === 'STAKE';
                const nativeTicker = (p.chainId.split('-')[0] || '').toUpperCase()
                    .replace('BITCOIN', 'BTC')
                    .replace('LITECOIN', 'LTC')
                    .replace('DOGECOIN', 'DOGE');
                const tick = p.tick || '';
                const isNativeAsset = !isStake && tick && tick === nativeTicker;
                const tokenInfo = (!isStake && tick && !isNativeAsset)
                    ? assetLookup.get(`${p.chainId}|${tick}`)
                    : null;
                const tokenImageUrl = isAssetImageSourceAllowed(tokenInfo?.imageUrl, allowRemoteImages)
                    ? tokenInfo.imageUrl
                    : null;
                return (
                    <li key={p.id}>
                        <button
                            type="button"
                            className={styles.demoRowButton}
                            onClick={() => {
                                if (typeof onSelectEntry === 'function') {
                                    onSelectEntry(defiPositionToEntry(p, idx));
                                }
                            }}
                        >
                            <div className={balanceStyles.iconWrap}>
                                {!isStake ? (
                                    <span
                                        className={balanceStyles.iconLetter}
                                        style={{ background: tickerColor(tick || p.action) }}
                                        aria-hidden="true"
                                    >
                                        {(tick || p.action).slice(0, 1).toUpperCase()}
                                    </span>
                                ) : null}
                                {isStake ? (
                                    <img
                                        src={branding.faviconUrl()}
                                        alt=""
                                    aria-hidden="true"
                                    className={styles.tokenIconSquare}
                                    loading="lazy"
                                    decoding="async"
                                    />
                                ) : isNativeAsset ? (
                                    chainIconUrl ? (
                                        <img
                                            src={chainIconUrl}
                                            alt=""
                                            aria-hidden="true"
                                            className={balanceStyles.iconImg}
                                            loading="lazy"
                                            decoding="async"
                                            style={{ position: 'absolute', inset: 0 }}
                                        />
                                    ) : null
                                ) : tokenImageUrl ? (
                                    <img
                                        src={tokenImageUrl}
                                        alt=""
                                        aria-hidden="true"
                                        className={styles.tokenIconSquare}
                                        loading="lazy"
                                        decoding="async"
                                        style={{ position: 'absolute', inset: 0 }}
                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                ) : null}
                                {!isNativeAsset && chainIconUrl ? (
                                    <img src={chainIconUrl} alt="" aria-hidden="true" className={balanceStyles.chainOverlay} loading="lazy" decoding="async" />
                                ) : null}
                            </div>
                            <div className={styles.demoRowBody}>
                                <div className={styles.demoRowMain}>
                                    {(() => {
                                        const iconFn = ACTION_ICON[String(p.action || '').toLowerCase()] || ACTION_ICON.other;
                                        return (
                                            <span className={styles.activityActionIcon} aria-hidden="true">
                                                {iconFn('icon')}
                                            </span>
                                        );
                                    })()}
                                    <span className={styles.demoActionTag}>{actionDisplayLabel(p.action)}</span>
                                    <span className={`${styles.statusBadge} ${statusClass}`}>{statusLabel}</span>
                                </div>
                                <div className={styles.demoRowPrimary}>
                                    {balancesHidden ? '•••••' : p.primary}
                                </div>
                                <div className={styles.demoRowMeta}>
                                    {p.blockIndex ? (
                                        <>
                                            <span>{t('home.tabs.blockNumber', { block: Number(p.blockIndex) })}</span>
                                            <span className={styles.confirmationsPill}>
                                                {p.confirms} {t('home.tabs.confirms')}
                                            </span>
                                        </>
                                    ) : (
                                        <span className={styles.confirmationsPill}>{t('home.tabs.unconfirmed')}</span>
                                    )}
                                    {p.timestamp ? (
                                        <span className={styles.rowRelativeTime}>
                                            {formatRelativeTime(p.timestamp)}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
