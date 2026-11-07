// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useMemo, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { BalanceHeroMenu } from './BalanceHeroMenu.jsx';
import { sumFiatValue } from './BalanceList.jsx';
import { StalenessLabel } from './StalenessLabel.jsx';
import { useMessaging } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { usePortfolioChartVisible } from '../hooks/usePortfolioChartVisible.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { synthesizeDemoNativePrices } from '../../flows/demoFixtures.js';
import styles from './TotalBalanceHero.module.css';
import {
    formatFiatAmount as formatFiatValue,
    formatFiatAmountForSpeech,
} from '../utils/fiatAmountFormat.js';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import { isMainnetChainId } from '../utils/mainnetChain.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/balances.js';
import '../../i18n/locales/en/components.js';

/**
 * Hero block at the top of Home: total fiat value across every
 * priced row (coins + tokens + NFTs). Honours the active network
 * filter so flipping to BTC shows only BTC-side wealth.
 *
 * Its controls sit in one "Balance actions" menu at every width (the
 * same BalanceHeroMenu a token's balance hero uses): hide the chart,
 * hide the balance for shoulder-surfing moments, then the Home-only
 * rows below.
 *
 * @param {object} props
 * @param {Array<any>} props.rows                rows from `buildBalanceRows`, already filtered
 * @param {string | null} [props.walletId]       the wallet these rows belong to; only used to tell a demo wallet apart, which prices itself from its own fixtures instead of the live oracle
 * @param {'all' | string} props.networkFilter
 * @param {number | null} [props.lastSyncedAt]   Unix ms of the last successful balance fetch. Drives the staleness label rendered on the right of the note row.
 * @param {number | null} [props.pricesFetchedAt] Unix ms of the oldest live price used by the total.
 * @param {() => void} [props.onRefresh]          refreshes balances and any expired prices.
 * @param {boolean} [props.refreshing]            whether a manual refresh is running.
 * @param {boolean} [props.filterOpen]           whether the inline filter row is currently shown; drives the filter row's checked state
 * @param {() => void} [props.onToggleFilter]    when provided, adds a filter toggle row to the menu
 * @param {() => void} [props.onCommandPalette]  when provided, adds a search row that opens the §33 command palette. The extension popup passes it (no AppHeader/LeftNav to host a trigger there); web + desktop leave it unset.
 * @param {() => void} [props.onLockWallet]      when provided, adds a lock row. Same reason: the popup and side panel have no header, so without it the only ways to lock were a shortcut and the palette.
 */
export function TotalBalanceHero({ rows, walletId, networkFilter, lastSyncedAt, pricesFetchedAt, onRefresh, refreshing = false, filterOpen, onToggleFilter, onCommandPalette, onOpenSettings, onLockWallet, nativePriceMap }) {
    const labelId = useId();
    const rowsWithChain = (rows || []).filter((row) => typeof row?.chainId === 'string' && row.chainId);
    // The demo wallet prices its synthetic test-network holdings on purpose.
    const testCoinsOnly = !isDemoWallet(walletId)
        && rowsWithChain.length > 0
        && rowsWithChain.every((row) => !isMainnetChainId(row.chainId));
    const { total, priceUnavailable } = useMemo(() => {
        const sum = sumFiatValue(rows);
        const meaningful = (rows || []).filter(hasNonZeroQuantity);
        const meaningfulSum = sumFiatValue(meaningful);
        return {
            ...sum,
            priceUnavailable: meaningful.length > 0 && meaningfulSum.priced === 0,
        };
    }, [rows]);
    const { settings } = useSettings();
    const { messaging } = useMessaging();
    const fiatCurrency = String(settings?.fiatCurrency || 'USD').toUpperCase();
    const fiatLocale = settings?.language || 'en-US';
    const [hidden, toggleHidden] = useBalancesHidden();
    const [chartVisible, toggleChartVisible] = usePortfolioChartVisible();

    // Fetch 24h change for every native chain that has a row in the
    // balance list. Tokens without a published 24h delta are treated as
    // unchanged in the total; the figure still reads as "what's moved
    // in the last 24 hours" rather than a misleading whole-portfolio
    // weighted average. Skipped when the user has price data disabled
    // (the messaging route returns `{ disabled: true }`).
    const nativeChainIds = useMemo(() => {
        const set = new Set();
        for (const r of rows || []) {
            if (r?.kind === 'native' && isMainnetChainId(r.chainId)) {
                set.add(r.chainId);
            }
        }
        return Array.from(set);
    }, [rows]);
    const nativeChainKey = nativeChainIds.join(',');

    // A demo wallet prices itself from its own fixtures. Every other
    // number in this hero is synthetic, so a LIVE 24h move applied to
    // imaginary holdings was never the honest version of this line: it
    // made a third-party request from a wallet whose whole design is to
    // fetch nothing, and whether that request landed before a screenshot
    // decided whether the change line was there at all - which moved the
    // entire card 24px and was the last thing keeping two store-listing
    // captures of one tree from matching.
    const isDemo = isDemoWallet(walletId);

    const [priceMap, setPriceMap] = useState(/** @type {Record<string, any>} */ ({}));
    useEffect(() => {
        if (nativePriceMap !== undefined) return undefined;
        if (isDemo) {
            setPriceMap(synthesizeDemoNativePrices(nativeChainIds));
            return undefined;
        }
        if (typeof messaging?.getNativePricesRequest !== 'function' || nativeChainIds.length === 0) {
            setPriceMap({});
            return undefined;
        }
        let cancelled = false;
        messaging.getNativePricesRequest({ chainIds: nativeChainIds, fiatCurrency })
            .then((result) => {
                if (cancelled) return;
                if (result?.disabled) { setPriceMap({}); return; }
                setPriceMap(result?.prices || {});
            })
            .catch(() => { if (!cancelled) setPriceMap({}); });
        return () => { cancelled = true; };
    }, [messaging, nativeChainKey, isDemo, fiatCurrency, nativePriceMap]); // eslint-disable-line react-hooks/exhaustive-deps
    const effectivePriceMap = nativePriceMap ?? priceMap;

    // Compute 24h delta: for each native row with a known change pct,
    // back-derive the 24h-ago fiat value and accumulate the difference.
    // Non-native rows + native rows without 24h data are treated as
    // unchanged.
    const change24h = useMemo(() => {
        let total24hAgo = 0;
        let hasAny = false;
        for (const r of rows || []) {
            const cur = fiatValueOf(r);
            if (cur == null) continue;
            const pct = r.kind === 'native' && r.chainId
                ? effectivePriceMap[r.chainId]?.change24hPct
                : null;
            if (typeof pct === 'number' && Number.isFinite(pct)) {
                hasAny = true;
                total24hAgo += cur / (1 + pct / 100);
            } else {
                total24hAgo += cur;
            }
        }
        if (!hasAny || total24hAgo <= 0) return null;
        const delta = Number(total) - total24hAgo;
        const pct = (delta / total24hAgo) * 100;
        return { delta, pct };
    }, [rows, effectivePriceMap, total]);

    const filterLabel = networkFilter === 'all' ? null : networkFilter.toUpperCase();
    const stalePriceAsOf = oldestStalePriceTimestamp(rows);
    // A failed price refresh keeps the last 24h move on screen, so its age
    // joins the one freshness line instead of reading as current.
    const staleChangeAsOf = oldestStaleChangeTimestamp(rows, effectivePriceMap);
    // Test networks show no fiat, but a saved balance still says how old it is.
    const portfolioUpdatedAt = testCoinsOnly
        ? oldestFreshnessTimestamp(lastSyncedAt)
        : oldestFreshnessTimestamp(
            lastSyncedAt,
            pricesFetchedAt,
            stalePriceAsOf,
            staleChangeAsOf,
        );
    const hasUpdate = portfolioUpdatedAt !== null;
    const hasChange = !hidden
        && change24h
        && Number.isFinite(change24h.delta)
        && Number.isFinite(change24h.pct);
    const changeDisplay = hasChange ? percentChangeDisplay(change24h.pct) : null;
    // A holding without a price adds nothing to the total and no status
    // text: a price simply shows when one exists.
    const showMeta = !hidden && (testCoinsOnly
        ? hasUpdate
        : (hasChange || hasUpdate));
    // A row whose balance read failed carries no number, so the headline
    // cannot sum it as zero: with nothing else priced the total is unknown,
    // and beside priced rows it is a floor, the way the row itself says.
    const unreadRows = (rows || []).filter((row) => row?.unavailable === 'all' || row?.unavailable === 'partial');
    const balanceUnread = unreadRows.length > 0 && Number(total) === 0;
    const balanceFloor = unreadRows.length > 0 && !balanceUnread ? 'At least ' : '';
    const balanceDisplay = testCoinsOnly
        ? 'Test coins have no value'
        : balanceUnread
            ? 'Balance unavailable'
            : priceUnavailable
                ? 'Price unavailable'
                : `${balanceFloor}${formatFiatAmount(total, fiatCurrency, fiatLocale, true)}`;
    const balanceSpeech = testCoinsOnly
        ? 'Test coins have no value'
        : balanceUnread
            ? 'Balance unavailable'
            : priceUnavailable
                ? 'Price unavailable'
                : `${balanceFloor}${formatFiatAmountForSpeech(total, fiatCurrency, fiatLocale)}`;
    const balanceIsMessage = testCoinsOnly || priceUnavailable || balanceUnread;
    // The hero's own toggles, the same rows a token's balance hero offers;
    // a checked row means the chart or the balance is on screen.
    const heroMenuItems = [
        !testCoinsOnly ? {
            id: 'chart', label: chartVisible ? t('components.totalBalanceHero.hideChart') : t('components.totalBalanceHero.showChart'), Icon: Icon.LineChartIcon, onSelect: toggleChartVisible, checked: chartVisible,
        } : null,
        {
            id: 'privacy', label: hidden ? t('components.totalBalanceHero.showBalance') : t('components.totalBalanceHero.hideBalance'), Icon: hidden ? Icon.EyeOffIcon : Icon.EyeIcon, onSelect: toggleHidden, checked: !hidden,
        },
    ].filter(Boolean);
    // Home-only rows. A shell with no header or nav passes the settings,
    // search and lock handlers, so the menu is where those live there.
    const homeMenuItems = [
        typeof onRefresh === 'function' ? {
            id: 'refresh',
            label: refreshing ? t('components.totalBalanceHero.refreshingPortfolio') : t('components.totalBalanceHero.refreshPortfolio'),
            Icon: Icon.RefreshIcon,
            onSelect: onRefresh,
            disabled: refreshing,
            className: refreshing ? styles.refreshing : '',
        } : null,
        typeof onOpenSettings === 'function' ? {
            id: 'settings', label: t('components.totalBalanceHero.openSettings'), Icon: Icon.GearIcon, onSelect: onOpenSettings,
        } : null,
        typeof onCommandPalette === 'function' ? {
            id: 'search', label: t('components.leftNav.openCommandPalette'), Icon: Icon.SearchIcon, onSelect: onCommandPalette, keyShortcuts: 'Meta+K Control+K',
        } : null,
        typeof onToggleFilter === 'function' ? {
            id: 'filter', label: filterOpen ? t('components.totalBalanceHero.hideFilters') : t('components.totalBalanceHero.showFilters'), Icon: Icon.FilterIcon, onSelect: onToggleFilter, checked: Boolean(filterOpen),
        } : null,
        typeof onLockWallet === 'function' ? {
            id: 'lock', label: t('home.lockWallet'), Icon: Icon.LockIcon, onSelect: onLockWallet,
        } : null,
    ].filter(Boolean);

    return (
        // Home's rows hold only the ACTIVE address on each chain (Home.jsx), so
        // "Total balance" read as the whole wallet while the wallet's other
        // addresses went uncounted (xchain-wallet#57). The label says what the
        // figure is.
        <section className={styles.hero} aria-labelledby={labelId}>
            <div className={styles.row}>
                <span id={labelId} className={styles.label}>
                    {t('components.totalBalanceHero.activeAddressBalance')}
                    {filterLabel ? (
                        <span className={styles.scope}>· {filterLabel}</span>
                    ) : null}
                </span>
                <div
                    className={`${styles.amount} ${balanceIsMessage ? styles.amountMessage : ''}`}
                    aria-label={hidden ? t('balances.balanceHidden') : balanceSpeech}
                >
                    {hidden ? (
                        <span className={styles.hidden}>•••••</span>
                    ) : (
                        <>
                            <span className={styles.amountValue}>
                                {balanceDisplay}
                            </span>
                            {!testCoinsOnly && !priceUnavailable ? <span className={styles.amountCode}>{fiatCurrency}</span> : null}
                        </>
                    )}
                </div>
                <BalanceHeroMenu
                    className={styles.actions}
                    items={heroMenuItems}
                    extraItems={homeMenuItems}
                />
            </div>
            {showMeta ? (
                <div className={styles.meta} aria-label={t('components.totalBalanceHero.balanceSummary')}>
                    <span className={styles.metaLeft}>
                        {hasChange && !testCoinsOnly ? (
                            <span
                                className={
                                    changeDisplay.direction === 'positive' ? styles.changePositive
                                        : changeDisplay.direction === 'negative' ? styles.changeNegative
                                        : styles.changeNeutral
                                }
                                aria-label={t('components.totalBalanceHero.24HourChange', { label: changeDisplay.label, formatFiatAmountForSpeechValue: formatFiatAmountForSpeech(Math.abs(change24h.delta), fiatCurrency, fiatLocale) })}
                            >
                                {changeDisplay.direction === 'positive' ? '▲' : changeDisplay.direction === 'negative' ? '▼' : '-'}{' '}
                                {formatFiatAmount(Math.abs(change24h.delta), fiatCurrency, fiatLocale)}{' '}
                                ({changeDisplay.text}{t('components.totalBalanceHero.24h')}
                            </span>
                        ) : null}
                    </span>
                    {hasUpdate ? (
                        <StalenessLabel
                            lastSyncedAt={portfolioUpdatedAt}
                            warnAfterMs={5 * 60_000}
                            className={styles.metaRight}
                        />
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

function oldestFreshnessTimestamp(...timestamps) {
    const valid = timestamps.filter((timestamp) => (
        typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
    ));
    return valid.length > 0 ? Math.min(...valid) : null;
}

function oldestStaleChangeTimestamp(rows, priceMap) {
    let oldest = null;
    for (const row of rows || []) {
        if (row?.kind !== 'native' || !row.chainId || fiatValueOf(row) == null) continue;
        const entry = priceMap?.[row.chainId];
        if (entry?.stale !== true || !Number.isFinite(entry.change24hPct)) continue;
        const timestamp = Number(entry.fetchedAt);
        if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
        if (oldest === null || timestamp < oldest) oldest = timestamp;
    }
    return oldest;
}

function oldestStalePriceTimestamp(rows) {
    let oldest = null;
    for (const row of rows || []) {
        if (row?.fiatRateStale !== true || typeof row.fiatRate !== 'number') continue;
        const timestamp = Date.parse(row.fiatRateFetchedAt);
        if (!Number.isFinite(timestamp)) continue;
        if (oldest === null || timestamp < oldest) oldest = timestamp;
    }
    return oldest;
}

function hasNonZeroQuantity(row) {
    try {
        return BigInt(row?.quantity ?? 0) !== 0n;
    } catch {
        const quantity = Number(row?.quantity);
        return Number.isFinite(quantity) && quantity !== 0;
    }
}

// Per-row fiat value used by the 24h-change accumulator. Mirrors the
// internal `fiatValue` helper in BalanceList.jsx but returns null when
// the row has no price so the change calculation can treat it as a
// no-data slot.
function fiatValueOf(row) {
    if (!row) return null;
    const exact = sumFiatValue([row]).total;
    return Number(exact);
}

// Format the numeric portion of the total balance in the wallet's preferred
// fiat and locale. The main total has a separate ISO suffix, so it can omit a
// formatter "symbol" that is itself the code without affecting change lines.
function formatFiatAmount(value, currency, locale, omitCodeSymbol = false) {
    if (value === null || value === undefined) return '-';
    return formatFiatValue(value, currency, locale, { omitCodeSymbol });
}
