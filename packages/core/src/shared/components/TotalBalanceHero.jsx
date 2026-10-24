// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Icon } from '@xchain-wallet/core/ui';
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

const COMPACT_ACTIONS_QUERY = '(max-width: 479px)';

function compactActionsMatch() {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') {
        return window.matchMedia(COMPACT_ACTIONS_QUERY).matches;
    }
    return window.innerWidth < 480;
}

function useCompactActions() {
    const [compact, setCompact] = useState(compactActionsMatch);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        if (typeof window.matchMedia !== 'function') {
            const onResize = () => setCompact(compactActionsMatch());
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }

        const query = window.matchMedia(COMPACT_ACTIONS_QUERY);
        const onChange = (event) => setCompact(event.matches);
        setCompact(query.matches);
        if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', onChange);
            return () => query.removeEventListener('change', onChange);
        }
        if (typeof query.addListener === 'function') {
            query.addListener(onChange);
            return () => query.removeListener(onChange);
        }
        return undefined;
    }, []);

    return compact;
}

function enabledMenuItems(menu) {
    return Array.from(menu?.querySelectorAll([
        '[role="menuitem"]:not([aria-disabled="true"])',
        '[role="menuitemcheckbox"]:not([aria-disabled="true"])',
    ].join(',')) || []);
}

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
export function TotalBalanceHero({ rows, walletId, networkFilter, lastSyncedAt, pricesFetchedAt, onRefresh, refreshing = false, filterOpen, onToggleFilter, onCommandPalette, onOpenSettings, onLockWallet, nativePriceMap }) {
    const labelId = useId();
    const rowsWithChain = (rows || []).filter((row) => typeof row?.chainId === 'string' && row.chainId);
    // The demo wallet prices its synthetic test-network holdings on purpose.
    const testCoinsOnly = !isDemoWallet(walletId)
        && rowsWithChain.length > 0
        && rowsWithChain.every((row) => !isMainnetChainId(row.chainId));
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
    const compactActions = useCompactActions();
    const [actionsOpen, setActionsOpen] = useState(false);
    const actionsWrapRef = useRef(null);
    const actionsTriggerRef = useRef(null);
    const actionsMenuRef = useRef(null);

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
    const hasUnpriced = unpriced > 0;
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
    const showMeta = !hidden && (testCoinsOnly
        ? hasUpdate
        : (hasChange || hasUnpriced || hasUpdate));
    const balanceDisplay = testCoinsOnly
        ? 'Test coins have no value'
        : priceUnavailable
            ? 'Price unavailable'
            : formatFiatAmount(total, fiatCurrency, fiatLocale, true);
    const balanceSpeech = testCoinsOnly
        ? 'Test coins have no value'
        : priceUnavailable
            ? 'Price unavailable'
            : formatFiatAmountForSpeech(total, fiatCurrency, fiatLocale);
    const balanceIsMessage = testCoinsOnly || priceUnavailable;
    const actionItems = [
        typeof onRefresh === 'function' ? {
            id: 'refresh',
            label: refreshing ? t('components.totalBalanceHero.refreshingPortfolio') : t('components.totalBalanceHero.refreshPortfolio'),
            title: refreshing ? t('components.totalBalanceHero.refreshingPortfolio') : t('components.totalBalanceHero.refreshPortfolio'),
            Icon: Icon.RefreshIcon,
            handler: onRefresh,
            disabled: refreshing,
            className: refreshing ? styles.refreshing : '',
        } : null,
        typeof onOpenSettings === 'function' ? ({
            id: 'settings', label: t('components.totalBalanceHero.openSettings'), title: t('home.settings'), Icon: Icon.GearIcon, handler: onOpenSettings,
        }) : null,
        typeof onCommandPalette === 'function' ? {
            id: 'search', label: t('components.leftNav.openCommandPalette'), title: t('components.leftNav.searchCmdCtrlK'), Icon: Icon.SearchIcon, handler: onCommandPalette, keyShortcuts: 'Meta+K Control+K',
        } : null,
        typeof onToggleFilter === 'function' ? {
            id: 'filter', label: filterOpen ? t('components.totalBalanceHero.hideFilters') : t('components.totalBalanceHero.showFilters'), title: filterOpen ? t('components.totalBalanceHero.hideFilters') : t('components.totalBalanceHero.showFilters'), Icon: Icon.FilterIcon, handler: onToggleFilter, pressed: filterOpen,
        } : null,
        !testCoinsOnly ? {
            id: 'chart', label: chartVisible ? t('components.totalBalanceHero.hideChart') : t('components.totalBalanceHero.showChart'), title: chartVisible ? t('components.totalBalanceHero.hideChart') : t('components.totalBalanceHero.showChart'), Icon: Icon.LineChartIcon, handler: toggleChartVisible, pressed: chartVisible,
        } : null,
        {
            id: 'privacy', label: hidden ? t('components.totalBalanceHero.showBalance') : t('components.totalBalanceHero.hideBalance'), title: hidden ? t('components.totalBalanceHero.showBalance') : t('components.totalBalanceHero.hideBalance'), Icon: hidden ? Icon.EyeOffIcon : Icon.EyeIcon, handler: toggleHidden,
        },
        typeof onLockWallet === 'function' ? {
            id: 'lock', label: t('home.lockWallet'), title: t('home.lockWallet'), Icon: Icon.LockIcon, handler: onLockWallet,
        } : null,
    ].filter(Boolean);

    useEffect(() => {
        if (!actionsOpen) return undefined;
        const onPointerDown = (event) => {
            if (!actionsWrapRef.current?.contains(event.target)) setActionsOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setActionsOpen(false);
            actionsTriggerRef.current?.focus();
        };
        // Tabbing out of the menu closes it, as the header menu does, so no
        // menu stays open while focus sits on the page behind it.
        const onFocusIn = (event) => {
            if (!actionsWrapRef.current?.contains(event.target)) setActionsOpen(false);
        };
        window.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('focusin', onFocusIn);
        return () => {
            window.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('focusin', onFocusIn);
        };
    }, [actionsOpen]);

    useEffect(() => {
        if (actionsOpen) enabledMenuItems(actionsMenuRef.current)[0]?.focus();
    }, [actionsOpen]);

    useEffect(() => {
        if (!compactActions) setActionsOpen(false);
    }, [compactActions]);

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
                {compactActions ? (
                    <div ref={actionsWrapRef} className={styles.compactActions}>
                        <Button
                            ref={actionsTriggerRef}
                            type="button"
                            className={styles.eye}
                            onClick={() => setActionsOpen((open) => !open)}
                            aria-label={t('components.totalBalanceHero.balanceActions')}
                            aria-haspopup="menu"
                            aria-expanded={actionsOpen ? 'true' : 'false'}
                            title={t('components.totalBalanceHero.balanceActions')}
                            icon={<Icon.MoreIcon />}
                        >
                            {null}
                        </Button>
                        {actionsOpen ? (
                            <div
                                ref={actionsMenuRef}
                                className={styles.actionMenu}
                                role="menu"
                                aria-label={t('components.totalBalanceHero.balanceActions')}
                                onKeyDown={(event) => {
                                    if (!event.target.closest?.('[role="menuitem"], [role="menuitemcheckbox"]')) return;
                                    const items = enabledMenuItems(actionsMenuRef.current);
                                    const index = items.indexOf(document.activeElement);
                                    let nextIndex = null;
                                    if (event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
                                    if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
                                    if (event.key === 'Home') nextIndex = 0;
                                    if (event.key === 'End') nextIndex = items.length - 1;
                                    if (nextIndex === null || items.length === 0) return;
                                    event.preventDefault();
                                    items[nextIndex]?.focus();
                                }}
                            >
                                {actionItems.map(({ id, label, Icon: ActionIcon, handler, disabled, pressed, keyShortcuts }) => (
                                    <Button
                                        key={id}
                                        type="button"
                                        role={pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
                                        className={styles.actionRow}
                                        disabled={disabled}
                                        aria-disabled={disabled ? 'true' : undefined}
                                        aria-checked={pressed === undefined ? undefined : String(Boolean(pressed))}
                                        aria-keyshortcuts={keyShortcuts}
                                        onClick={() => {
                                            setActionsOpen(false);
                                            handler();
                                        }}
                                        icon={<ActionIcon />}
                                    >
                                        {label}
                                    </Button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className={styles.actions}>
                        {actionItems.map(({ id, label, title, Icon: ActionIcon, handler, disabled, pressed, keyShortcuts, className }) => (
                            id === 'settings' ? (
                                <Button
                                    key={id}
                                    type="button"
                                    className={styles.eye}
                                    onClick={handler}
                                    aria-label={t('components.totalBalanceHero.openSettings')}
                                    title={title}
                                    icon={<ActionIcon />}
                                >
                                    {null}
                                </Button>
                            ) : (
                                <Button
                                    key={id}
                                    type="button"
                                    className={`${styles.eye} ${pressed ? styles.eyeActive : ''} ${className || ''}`}
                                    onClick={handler}
                                    disabled={disabled}
                                    aria-pressed={pressed === undefined ? undefined : String(Boolean(pressed))}
                                    aria-label={label}
                                    aria-keyshortcuts={keyShortcuts}
                                    title={title}
                                    icon={<ActionIcon />}
                                >
                                    {null}
                                </Button>
                            )
                        ))}
                    </div>
                )}
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
                        {hasUnpriced && !testCoinsOnly ? (
                            <span className={styles.metaUnpriced}>
                                {unpricedLabel(rows)}
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
    return formatFiatValue(value, currency, locale, { omitCodeSymbol });
}
