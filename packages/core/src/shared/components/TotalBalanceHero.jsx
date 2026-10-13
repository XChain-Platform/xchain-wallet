// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { sumFiatValue } from './BalanceList.jsx';
import { StalenessLabel } from './StalenessLabel.jsx';
import { useMessaging } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { usePortfolioChartVisible } from '../hooks/usePortfolioChartVisible.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { synthesizeDemoNativePrices } from '../../flows/demoFixtures.js';
import styles from './TotalBalanceHero.module.css';
import { compareDecimalStrings } from '../utils/amountFormat.js';
import { formatFiatAmount as formatFiatValue } from '../utils/fiatAmountFormat.js';

/**
 * Hero block at the top of Home: total fiat value across every
 * priced row (coins + tokens + NFTs). Honours the active network
 * filter so flipping to BTC shows only BTC-side wealth.
 *
 * The eye toggle hides the number for shoulder-surfing scenarios
 * (public coffee-shop unlocks, etc.). State is component-local so
 * it resets on reload, not persisted.
 *
 * @param {object} props
 * @param {Array<any>} props.rows                rows from `buildBalanceRows`, already filtered
 * @param {string | null} [props.walletId]       the wallet these rows belong to; only used to tell a demo wallet apart, which prices itself from its own fixtures instead of the live oracle
 * @param {'all' | string} props.networkFilter
 * @param {number | null} [props.lastSyncedAt]   Unix ms of the last successful balance fetch. Drives the staleness label rendered on the right of the note row.
 * @param {number | null} [props.pricesFetchedAt] Unix ms of the oldest live price used by the total.
 * @param {() => void} [props.onRefresh]          refreshes balances and any expired prices.
 * @param {boolean} [props.refreshing]            whether a manual refresh is running.
 * @param {boolean} [props.filterOpen]           whether the inline filter row is currently shown; drives the filter button's pressed state
 * @param {() => void} [props.onToggleFilter]    when provided, renders a filter toggle button next to the chart toggle
 * @param {() => void} [props.onCommandPalette]  when provided, renders a search button that opens the §33 command palette. The extension popup passes it (no AppHeader/LeftNav to host a trigger there); web + desktop leave it unset.
 * @param {() => void} [props.onLockWallet]      when provided, renders a lock button. Same reason: the popup and side panel have no header, so without it the only ways to lock were a shortcut and the palette.
 */
export function TotalBalanceHero({ rows, walletId, networkFilter, lastSyncedAt, pricesFetchedAt, onRefresh, refreshing = false, filterOpen, onToggleFilter, onCommandPalette, onOpenSettings, onLockWallet }) {
    const { total, unpriced, priceUnavailable } = useMemo(() => {
        const sum = sumFiatValue(rows);
        const meaningful = (rows || []).filter(hasNonZeroQuantity);
        const meaningfulSum = sumFiatValue(meaningful);
        return {
            ...sum,
            unpriced: meaningfulSum.unpriced,
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
            if (r?.kind === 'native' && typeof r.chainId === 'string' && r.chainId) {
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
    }, [messaging, nativeChainKey, isDemo, fiatCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

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
                ? priceMap[r.chainId]?.change24hPct
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
    }, [rows, priceMap, total]);

    const filterLabel = networkFilter === 'all' ? null : networkFilter.toUpperCase();
    const hasUnpriced = unpriced > 0;
    const hasSync = typeof lastSyncedAt === 'number' && lastSyncedAt > 0;
    const hasPriceSync = typeof pricesFetchedAt === 'number' && pricesFetchedAt > 0;
    const hasChange = !hidden
        && change24h
        && Number.isFinite(change24h.delta)
        && Number.isFinite(change24h.pct);
    const showMeta = !hidden && (hasChange || hasUnpriced || hasSync || hasPriceSync);

    return (
        // Home's rows hold only the ACTIVE address on each chain (Home.jsx), so
        // "Total balance" read as the whole wallet while the wallet's other
        // addresses went uncounted (xchain-wallet#57). The label says what the
        // figure is.
        <section className={styles.hero} aria-label="Active address balance">
            <div className={styles.row}>
                <span className={styles.label}>
                    Active address balance
                    {filterLabel ? (
                        <span className={styles.scope}>· {filterLabel}</span>
                    ) : null}
                </span>
                <div className={styles.actions}>
                    {typeof onRefresh === 'function' ? (
                        <button
                            type="button"
                            className={`${styles.eye} ${refreshing ? styles.refreshing : ''}`}
                            onClick={onRefresh}
                            disabled={refreshing}
                            aria-label={refreshing ? 'Refreshing portfolio' : 'Refresh portfolio'}
                            title={refreshing ? 'Refreshing portfolio' : 'Refresh portfolio'}
                        >
                            <Icon.RefreshIcon />
                        </button>
                    ) : null}
                    {/* Shells with no navigation surface need a
                        VISIBLE way into Settings. Only the MV3 popup passes
                        this (web and desktop reach Settings from the nav
                        rail), so nothing changes for them. Prop-gated rather
                        than variant-sniffed: the shell that lacks the route
                        is the one that knows it. */}
                    {typeof onOpenSettings === 'function' ? (
                        <button
                            type="button"
                            className={styles.eye}
                            onClick={onOpenSettings}
                            aria-label="Open settings"
                            title="Settings"
                        >
                            <Icon.GearIcon />
                        </button>
                    ) : null}
                    {typeof onCommandPalette === 'function' ? (
                        <button
                            type="button"
                            className={styles.eye}
                            onClick={onCommandPalette}
                            aria-label="Open command palette"
                            aria-keyshortcuts="Meta+K Control+K"
                            title="Search (Cmd/Ctrl+K)"
                        >
                            <Icon.SearchIcon />
                        </button>
                    ) : null}
                    {typeof onToggleFilter === 'function' ? (
                        <button
                            type="button"
                            className={`${styles.eye} ${filterOpen ? styles.eyeActive : ''}`}
                            onClick={onToggleFilter}
                            aria-pressed={filterOpen ? 'true' : 'false'}
                            aria-label={filterOpen ? 'Hide filters' : 'Show filters'}
                            title={filterOpen ? 'Hide filters' : 'Show filters'}
                        >
                            <Icon.FilterIcon />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className={`${styles.eye} ${chartVisible ? styles.eyeActive : ''}`}
                        onClick={toggleChartVisible}
                        aria-pressed={chartVisible ? 'true' : 'false'}
                        aria-label={chartVisible ? 'Hide chart' : 'Show chart'}
                        title={chartVisible ? 'Hide chart' : 'Show chart'}
                    >
                        <Icon.LineChartIcon />
                    </button>
                    <button
                        type="button"
                        className={styles.eye}
                        onClick={toggleHidden}
                        aria-label={hidden ? 'Show balance' : 'Hide balance'}
                        title={hidden ? 'Show balance' : 'Hide balance'}
                    >
                        {hidden ? <Icon.EyeOffIcon /> : <Icon.EyeIcon />}
                    </button>
                    {typeof onLockWallet === 'function' ? (
                        <button
                            type="button"
                            className={styles.eye}
                            onClick={onLockWallet}
                            aria-label="Lock wallet"
                            title="Lock wallet"
                        >
                            <Icon.LockIcon />
                        </button>
                    ) : null}
                </div>
            </div>
            <div className={styles.amount}>
                {hidden ? (
                    <span className={styles.hidden}>•••••</span>
                ) : (
                    <>
                        <span className={styles.amountValue}>
                            {priceUnavailable
                                ? 'Price unavailable'
                                : formatFiatAmount(total, fiatCurrency, fiatLocale, true)}
                        </span>
                        {!priceUnavailable ? <span className={styles.amountCode}>{fiatCurrency}</span> : null}
                    </>
                )}
            </div>
            {showMeta ? (
                <div className={styles.meta} aria-label="Balance summary">
                    <span className={styles.metaLeft}>
                        {hasChange ? (
                            <span
                                className={
                                    change24h.delta > 0 ? styles.changePositive
                                        : change24h.delta < 0 ? styles.changeNegative
                                        : styles.changeNeutral
                                }
                            >
                                {change24h.delta > 0 ? '▲' : change24h.delta < 0 ? '▼' : '-'}{' '}
                                {formatFiatAmount(Math.abs(change24h.delta), fiatCurrency, fiatLocale)}{' '}
                                ({change24h.pct > 0 ? '+' : ''}{change24h.pct.toFixed(2)}%)
                            </span>
                        ) : null}
                        {hasUnpriced ? (
                            <span className={styles.metaUnpriced}>
                                {unpricedLabel(rows)}
                            </span>
                        ) : null}
                    </span>
                    {hasSync ? (
                        <StalenessLabel
                            lastSyncedAt={lastSyncedAt}
                            warnAfterMs={5 * 60_000}
                            className={styles.metaRight}
                        />
                    ) : null}
                    {hasPriceSync ? (
                        <StalenessLabel
                            lastSyncedAt={pricesFetchedAt}
                            prefix="Prices updated"
                            warnAfterMs={5 * 60_000}
                            className={styles.metaRight}
                        />
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

// The "not priced" note, naming coins and tokens apart: BTC, LTC and DOGE
// are coins, so "3 tokens not priced" misnamed them. Counts the same rows
// `sumFiatValue` counts as unpriced.
function unpricedLabel(rows) {
    let coins = 0;
    let tokens = 0;
    for (const r of rows || []) {
        if (!hasNonZeroQuantity(r)) continue;
        if (sumFiatValue([r]).unpriced === 0) continue;
        if (r?.kind === 'native') coins += 1;
        else tokens += 1;
    }
    const parts = [];
    if (coins > 0) parts.push(`${coins} ${coins === 1 ? 'coin' : 'coins'}`);
    if (tokens > 0) parts.push(`${tokens} ${tokens === 1 ? 'token' : 'tokens'}`);
    return `${parts.join(' and ')} not priced`;
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
    // Change lines use the shared localized formatter; only the main total needs
    // the code-symbol suppression below.
    if (!omitCodeSymbol) return formatFiatValue(value, currency, locale);
    const code = String(currency || 'USD').toUpperCase();
    try {
        let fmt;
        try {
            fmt = new Intl.NumberFormat(locale || 'en-US', {
                style: 'currency',
                currency: code,
                currencyDisplay: 'symbol',
            });
        } catch {
            fmt = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: code,
                currencyDisplay: 'symbol',
            });
        }
        const minorUnit = fmt.resolvedOptions().maximumFractionDigits === 0 ? 1 : 0.01;
        const displayValue = compareDecimalStrings(value, '0') === 1
            && compareDecimalStrings(value, String(minorUnit)) === -1
            ? minorUnit
            : String(value);
        const parts = fmt.formatToParts(displayValue);
        const currencyIsCode = omitCodeSymbol && parts.some(
            (part) => part.type === 'currency' && part.value.toUpperCase() === code,
        );
        const formatted = parts
            .filter((part) => !currencyIsCode || part.type !== 'currency')
            .map((part) => part.value)
            .join('')
            .trim();
        return displayValue === minorUnit ? `<${formatted}` : formatted;
    } catch {
        return String(value);
    }
}
