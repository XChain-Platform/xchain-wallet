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
import { TotalBalanceHero as TotalBalanceHeroBase } from './TotalBalanceHero.jsx';
import { PortfolioChart as PortfolioChartBase } from './PortfolioChart.jsx';
import { RouteErrorBoundary } from './RouteErrorBoundary.jsx';
import { HomeListFilterMenu } from './HomeListFilterMenu.jsx';
import { BalancesUncheckedState } from './BalancesUncheckedState.jsx';
import { activityRowAmount, activityRowAmountQualifier, activityRowTick } from '../utils/activityAmount.js';
import { ActivityRow as SharedActivityRow, actionIconForAction } from './ActivityRow.jsx';
import { isDemoWallet } from '@xchain-wallet/core/flows';
import { synthesizeDemoNativePrices } from '../../flows/demoFixtures.js';
import { classifyEntryAction, classifyEntryStatus } from '../utils/historyFilter.js';
import { recentActivityEntries } from '../utils/historyRow.js';
import { compareMergedEntries } from '../utils/pendingHistory.js';
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
import { compareDecimalStrings, formatDecimalAmount } from '../utils/amountFormat.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import styles from './HomeTabs.module.css';
import { t } from '../../i18n/index.js';
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
 * @param {number | null} [props.balancesFetchedAt]   Unix ms of the last successful balance fetch. Refreshes prices and dates saved data while offline.
 * @param {string} props.networkFilter   'all' or a coin family
 * @param {{ threshold: number, cosignerCount: number, scheme: string } | null} [props.multisig]
 * @param {string} [props.multisigChainId]
 * @param {import('react').ReactNode} [props.actions]   slot rendered between the total-balance hero and the tab strip; used by Home for the Send / Receive / Swap / Buy quick-action row
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
 * @param {boolean} [props.balancesUnchecked] balances could not be checked: an empty tab says that instead of "nothing yet"
 * @param {() => void} [props.onRecheckBalances] rechecks reachability and balances from that state
 * @param {boolean} [props.balanceNoticeShown] Home shows its own balance notice, so an empty tab shows no empty state
 */
export const HomeTabs = memo(function HomeTabs({ chainRegistry, balances, activeByChain = null, balancesFetchedAt, walletId, networkFilter, tokenQuery = '', coinFamilies, onNetworkFilterChange, onTokenQueryChange, multisig, multisigChainId, actions, onReceive, onBuy, hasAddresses = true, onAddAddress, onHistory, recentActivity = null, recentActivityFailed = false, onActivityOpen, defiPositions = null, defiPositionsFailed = false, onDefiOpen, onSelectToken, onSelectEntry, pinnedKeys, onTogglePin, hiddenKeys, onToggleHide, verifyProofsEnabled = false, hideSmallBalances = false, onRefresh, refreshing = false, onCommandPalette, onOpenSettings, onLockWallet, balancesUnchecked = false, onRecheckBalances, balanceNoticeShown = false }) {
    const tabsId = useId();
    const [active, setActive] = useState('coins');
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
        enabled: verifyProofsEnabled && active === 'tokens',
    });

    useEffect(() => {
        setSortBy(readBalanceSort(walletId));
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
        () => sortBalanceRows(filteredRows.filter((r) => r.kind === 'native'), sortBy),
        [filteredRows, sortBy],
    );
    // Tokens = every non-native tick, regardless of divisibility or
    // imagery. The single canonical "what do I hold?" surface.
    const tokens = useMemo(
        () => active === 'tokens'
            ? sortBalanceRows(filteredRows.filter(
                (r) => r.kind !== 'native',
            ), sortBy)
            : [],
        [active, filteredRows, sortBy],
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
        return sortBalanceRows(out, sortBy);
    }, [active, ownedTokens, allRows, networkFilter, tokenQueryTrim, chainRegistry, sortBy]);
    const filteredTokens = useMemo(() => {
        if (!tokenQueryTrim) return tokens;
        return tokens.filter((r) => {
            const tick = String(r.tick || '').toLowerCase();
            const name = String(r.displayName || '').toLowerCase();
            return tick.includes(tokenQueryTrim) || name.includes(tokenQueryTrim);
        });
    }, [tokens, tokenQueryTrim]);
    // An unavailable token price contributes zero to this display-only list,
    // matching native rows' three-column layout without changing the total.
    const listedTokens = useMemo(() => filteredTokens.map((row) => (
        fiatValue(row.quantity, row.divisibility, row.fiatRate) === null
            ? { ...row, fiatRate: 0 }
            : row
    )), [filteredTokens]);
    const listedIssuedTokens = useMemo(() => issuedUnheld.map((row) => (
        fiatValue(row.quantity, row.divisibility, row.fiatRate) === null
            ? { ...row, fiatRate: 0 }
            : row
    )), [issuedUnheld]);
    const selectListedToken = useCallback((token) => {
        const source = [...filteredTokens, ...issuedUnheld].find((row) => (
            row.chainId === token.chainId && row.tick === token.tick
        ));
        onSelectToken({
            ...token,
            fiatRate: source?.fiatRate ?? null,
            fiatRateSource: source?.fiatRateSource,
        });
    }, [filteredTokens, issuedUnheld, onSelectToken]);
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
    const showBalanceSort = active === 'coins' && !showFirstFunding && coins.length > 0;
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
                    && collectibleKeys.has(`${r.chainId}:${r.tick}`),
            ), sortBy)
            : [],
        [active, filteredRows, collectibleKeys, sortBy],
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
                    />
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
                    {listedTokens.length > 0 ? (
                        <BalanceList
                            rows={listedTokens}
                            fiatCurrency={settings?.fiatCurrency || 'USD'}
                            onSelectToken={onSelectToken ? selectListedToken : undefined}
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
                    {listedIssuedTokens.length > 0 ? (
                        <section aria-label={t('home.tabs.issuedByYou')} data-testid="issued-unheld">
                            <p className={styles.tabNote}>{t('home.tabs.issuedByYou')}</p>
                            <BalanceList
                                rows={listedIssuedTokens}
                                fiatCurrency={settings?.fiatCurrency || 'USD'}
                                onSelectToken={onSelectToken ? selectListedToken : undefined}
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
                    <RecentActivityList
                        entries={recentActivity}
                        failed={recentActivityFailed}
                        balances={balances}
                        networkFilter={networkFilter}
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
                        balances={balances}
                        onOpen={onDefiOpen}
                        onSelectEntry={onSelectEntry}
                        allowRemoteImages={allowRemoteImages}
                    />
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

const ActivityEntryRow = memo(function ActivityEntryRow({ entry, walletAddresses, assetLookup, chainTip, onSelectEntry, allowRemoteImages }) {
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
    // 'other' is a filter bucket, not a name: a row in it (a contract call,
    // a stake, any verb the buckets do not list) reads its own action, as
    // History's rows do.
    const label = actionDisplayLabel(kind === 'other' ? entry.action : kind)
        || actionDisplayLabel(entry.action)
        || 'Event';
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
                    ? t('history.row.block', { block: formatDecimalAmount(entry.blockIndex) })
                    : null}
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
function RecentActivityList({ entries, failed, balances, networkFilter, onOpen, onHistory, onSelectEntry, allowRemoteImages }) {
    useEffect(() => {
        if (typeof onOpen === 'function') onOpen();
    }, [onOpen]);
    const assetLookup = useMemo(() => buildTokenLookup(balances), [balances]);
    const rows = useMemo(() => {
        const recent = recentActivityEntries(entries);
        if (networkFilter === 'all') return recent;
        return recent.filter((e) => coinFromChainId(e.chainId) === networkFilter);
    }, [entries, networkFilter]);
    const walletAddresses = useMemo(
        () => new Set((entries || []).map((e) => e?.address).filter(Boolean)),
        [entries],
    );
    if (entries === null && !failed) {
        return (
            <>
                <p className={styles.tabNote} role="status">{t('home.tabs.loadingRecentActivity')}</p>
                <SeeAllActivityButton onHistory={onHistory} />
            </>
        );
    }
    if (rows.length === 0) {
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

function DefiList({ positions, failed, networkFilter, balances, onOpen, onSelectEntry, allowRemoteImages }) {
    const [balancesHidden] = useBalancesHidden();
    useEffect(() => {
        if (typeof onOpen === 'function') onOpen();
    }, [onOpen]);
    const rows = useMemo(() => {
        const all = Array.isArray(positions) ? positions : [];
        const filtered = networkFilter === 'all'
            ? all
            : all.filter((p) => coinFromChainId(p.chainId) === networkFilter);
        return [...filtered].sort(compareMergedEntries);
    }, [positions, networkFilter]);
    const assetLookup = useMemo(() => buildTokenLookup(balances), [balances]);

    if (positions === null && !failed && typeof onOpen === 'function') {
        return <p className={styles.tabNote} role="status">{t('home.tabs.loadingDefiPositions')}</p>;
    }
    if (rows.length === 0) {
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
                            status={p.status}
                            timestamp={p.timestamp}
                            block={p.blockIndex
                                ? t('history.row.block', { block: formatDecimalAmount(p.blockIndex) })
                                : null}
                            onClick={typeof onSelectEntry === 'function'
                                ? () => onSelectEntry(defiPositionToEntry(p, idx))
                                : undefined}
                            data-activity-row
                        />
                    </li>
                );
            })}
        </ul>
    );
}
