// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { ListRow, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging } from '../useMessaging.js';
import { useNativePrice } from '../hooks/useNativePrice.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { normalizeMarketHistoryRowExact } from '../../market/history_rows.js';
import {
    compareDecimalStrings,
    divideDecimalStrings,
    expandDecimalNotation,
    formatDecimalAmount,
    multiplyDecimalStrings,
    subtractDecimalStrings,
    sumDecimalStrings,
} from '../utils/amountFormat.js';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import { dispenserRateLabel, formatDecimal, isOpenDispenserSelling, isOpenOffer } from '../utils/dispenserPricing.js';
import { formatAgo } from './StalenessLabel.jsx';
import styles from './TokenMarketTab.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/tokenMarket.js';

const chainRegistry = registryLib.defaultRegistry();
// Past this many open offers the rows collapse to one "Trades on" count.
const MAX_LISTED_OFFERS = 4;
const DISPENSER_PAGE_LIMIT = 100;
const DAY_SECONDS = 86400;

/**
 * Market facts for one coin or token as label and value rows, for the
 * detail page's Details list. Every row comes from a read the wallet
 * already makes; a fact with no source has no row.
 *
 * Native coins: the price oracle entry (CoinGecko spot price, 24h change,
 * market cap, and the hourly sparkline for the 24h high and low). Native
 * coins have no on-platform order or dispenser market of their own, so
 * they get no "where it trades" rows.
 *
 * Tokens: the indexer's DEX price and supply for price and market cap, one
 * market-history read against the chain's coin for the 24h change, high,
 * low, volume and the last trade's age, and one read each of the token's
 * orders and dispensers for where it trades. Three reads in all, never one
 * per row.
 *
 * The rows are `<li>` items for the caller's list. Pass the list's row,
 * label and value classes so they match its other rows; without them the
 * rows use simple styles of their own.
 *
 * @param {object} props
 * @param {string} [props.walletId]
 * @param {string} props.chainId
 * @param {string} props.tick
 * @param {boolean} props.isNative
 * @param {any} [props.assetInfo]        useTokenInfo record (tokens)
 * @param {boolean} [props.assetLoading] the token read is still out; when
 *   omitted, an empty assetInfo counts as loading
 * @param {boolean} [props.assetFailed]  the token read failed
 * @param {{ entry: any, loading: boolean, disabled: boolean, error: string | null } | null} [props.nativePrice]
 *   the page's useNativePrice result; read here when not passed
 * @param {string} [props.fiatCurrency]
 * @param {string} [props.rowClassName]
 * @param {string} [props.labelClassName]
 * @param {string} [props.valueClassName]
 * @param {() => void} [props.onOpenMarket]      opens this token's DEX market
 * @param {() => void} [props.onOpenDispensers]  opens the dispensers selling it
 */
export function TokenMarketRows({
    walletId,
    chainId,
    tick,
    isNative,
    assetInfo = null,
    assetLoading,
    assetFailed = false,
    nativePrice = null,
    fiatCurrency = 'USD',
    rowClassName,
    labelClassName,
    valueClassName,
    onOpenMarket,
    onOpenDispensers,
}) {
    const isDemo = isDemoWallet(walletId);
    const descriptor = chainRegistry.get(chainId);
    const nativeTick = tickerForCoin(descriptor?.coin);
    // The coin price oracle covers mainnet coins only; the demo wallet
    // prices its sample holdings.
    const oraclePriced = isDemo || descriptor?.networkKind === 'mainnet';
    const ownNativePrice = useNativePrice(isNative && !nativePrice && oraclePriced && !isDemo ? chainId : null, {
        includeSparkline: true,
        fiatCurrency,
    });
    const native = nativePrice || ownNativePrice;
    const reads = useTokenMarketReads({ chainId, tick, nativeTick, enabled: !isNative && Boolean(nativeTick) });

    const classes = {
        row: rowClassName || styles.row,
        label: `${labelClassName || styles.label} ${styles.labelCell}`,
        value: `${valueClassName || styles.value} ${styles.valueCell}`,
    };
    const rows = isNative
        ? nativeRows({ native, oraclePriced, isDemo, fiatCurrency })
        : tokenRows({ assetInfo, assetLoading, assetFailed, reads, tick, nativeTick });
    const offers = isNative ? null : tradeRows({ reads, tick, onOpenMarket, onOpenDispensers });

    return (
        <>
            {rows.map((row) => (
                <MarketRow key={row.id} classes={classes} label={row.label} tone={row.tone} valueLabel={row.valueLabel}>
                    {row.value}
                </MarketRow>
            ))}
            {offers ? offers.rows.map((row) => (
                <MarketRow key={row.id} classes={classes} label={row.label}>{row.value}</MarketRow>
            )) : null}
            {offers ? offers.links.map((link) => (
                <li key={link.id}>
                    <ListRow className={rowClassName || styles.row} title={link.label} onClick={link.onSelect} chevron />
                </li>
            )) : null}
        </>
    );
}

/**
 * The market rows in a card of their own, for a surface without a list to
 * join. The detail page uses TokenMarketRows inside its Details list.
 *
 * @param {Parameters<typeof TokenMarketRows>[0]} props
 */
export function TokenMarketTab(props) {
    return (
        <section className={styles.card} aria-label={t('tokenMarket.label')}>
            <ul className={styles.list}>
                <TokenMarketRows {...props} />
            </ul>
        </section>
    );
}

function MarketRow({ classes, label, tone, valueLabel, children }) {
    const toneClass = tone === 'positive' ? styles.positive : tone === 'negative' ? styles.negative : '';
    return (
        <li>
            <div className={classes.row}>
                <span className={classes.label}>{label}</span>
                <span className={`${classes.value} ${toneClass}`} aria-label={valueLabel || undefined}>{children}</span>
            </div>
        </li>
    );
}

const loadingValue = () => <Skeleton shape="text" width={72} ariaLabel={t('tokenMarket.loading')} />;

function nativeRows({ native, oraclePriced, isDemo, fiatCurrency }) {
    if (!oraclePriced) return [{ id: 'price', label: t('tokenMarket.price'), value: t('tokenMarket.none') }];
    if (native?.disabled) return [{ id: 'price', label: t('tokenMarket.price'), value: t('tokenMarket.disabled') }];
    const entry = native?.entry || null;
    if (!entry) {
        const loading = native?.loading || (!native?.disabled && !native?.error);
        return [{ id: 'price', label: t('tokenMarket.price'), value: loading ? loadingValue() : t('tokenMarket.none') }];
    }
    const rows = [];
    const price = positiveNumber(entry.priceFiat);
    if (price !== null) rows.push({ id: 'price', label: t('tokenMarket.price'), value: formatFiatAmount(price, fiatCurrency) });
    const change = percentChangeDisplay(finiteNumber(entry.change24hPct));
    if (change) {
        rows.push({ id: 'change-24h', label: t('tokenMarket.change24h'), value: change.text, tone: change.direction, valueLabel: change.label });
    }
    // The oracle's sparkline is hourly, so its last 24 points span the day.
    const day = Array.isArray(entry.sparkline)
        ? entry.sparkline.filter((p) => Number.isFinite(p) && p > 0).slice(-24)
        : [];
    if (day.length >= 2) {
        rows.push({ id: 'high-24h', label: t('tokenMarket.high24h'), value: formatFiatAmount(Math.max(...day), fiatCurrency) });
        rows.push({ id: 'low-24h', label: t('tokenMarket.low24h'), value: formatFiatAmount(Math.min(...day), fiatCurrency) });
    }
    const cap = positiveNumber(entry.marketCapFiat);
    if (cap !== null) rows.push({ id: 'market-cap', label: t('tokenMarket.marketCap'), value: compactFiat(cap, fiatCurrency) });
    const source = isDemo ? t('tokenMarket.sourceSample') : t('tokenMarket.sourceCoinGecko');
    rows.push({
        id: 'source',
        label: t('tokenMarket.source'),
        value: Number.isFinite(entry.fetchedAt) && !isDemo
            ? t('tokenMarket.sourceAge', { source, when: formatAgo(Date.now() - entry.fetchedAt) })
            : source,
    });
    return rows;
}

function tokenRows({ assetInfo, assetLoading, assetFailed, reads, tick, nativeTick }) {
    const stats = reads.history ? derive24hStats(reads.history, tick, nativeTick) : null;
    const indexed = assetInfo?.marketPrice != null ? expandDecimalNotation(String(assetInfo.marketPrice)) : null;
    const price = indexed !== null && compareDecimalStrings(indexed, '0') === 1 ? indexed : (stats?.lastPrice ?? null);
    if (price === null) {
        // A failed token read leaves assetInfo empty for good, so a missing
        // record counts as loading only until the page says the read ended.
        const failed = assetFailed || assetInfo?.loadError === true;
        const loading = reads.historyLoading || (!failed && (assetLoading ?? !assetInfo));
        const value = loading ? loadingValue() : failed ? t('tokenMarket.loadFailed') : t('tokenMarket.noTrades');
        return [{ id: 'price', label: t('tokenMarket.price'), value }];
    }
    const coinAmount = (value) => `${formatDecimalAmount(value, undefined, priceDigits(value))} ${nativeTick}`;
    const rows = [{ id: 'price', label: t('tokenMarket.priceDex'), value: coinAmount(price) }];
    if (stats && stats.tradesIn24h > 0) {
        const change = percentChangeDisplay(stats.changePct);
        if (change) {
            rows.push({ id: 'change-24h', label: t('tokenMarket.change24h'), value: change.text, tone: change.direction, valueLabel: change.label });
        }
        rows.push({ id: 'high-24h', label: t('tokenMarket.high24h'), value: coinAmount(stats.high) });
        rows.push({ id: 'low-24h', label: t('tokenMarket.low24h'), value: coinAmount(stats.low) });
    }
    if (assetInfo?.totalSupply != null) {
        const supply = String(assetInfo.totalSupply).replace(/[,_]/g, '');
        const cap = multiplyDecimalStrings(price, supply);
        if (cap !== null) {
            rows.push({
                id: 'market-cap',
                label: t('tokenMarket.marketCap'),
                value: `${formatDecimalAmount(cap, undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })} ${nativeTick}`,
            });
        }
    }
    if (stats) {
        rows.push({
            id: 'volume-24h',
            label: t('tokenMarket.volume24h'),
            value: `${formatDecimalAmount(stats.volume, undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 })} ${tick}`,
        });
    }
    const source = t('tokenMarket.sourceDex');
    rows.push({
        id: 'source',
        label: t('tokenMarket.source'),
        value: stats?.lastTimestamp
            ? t('tokenMarket.sourceAge', { source, when: formatAgo(Date.now() - stats.lastTimestamp * 1000) })
            : source,
    });
    return rows;
}

function tradeRows({ reads, tick, onOpenMarket, onOpenDispensers }) {
    const links = [
        typeof onOpenMarket === 'function' ? { id: 'open-dex', label: t('tokenMarket.openDex'), onSelect: onOpenMarket } : null,
        typeof onOpenDispensers === 'function' ? { id: 'open-dispensers', label: t('tokenMarket.openDispensers'), onSelect: onOpenDispensers } : null,
    ].filter(Boolean);
    if (reads.offersLoading) {
        return { rows: [{ id: 'trades-on', label: t('tokenMarket.tradesOn'), value: loadingValue() }], links };
    }
    // A failed read is left out rather than shown as an empty market.
    if (reads.dispensers === null && reads.orders === null) return { rows: [], links };
    const want = String(tick).toUpperCase();
    const dispensers = (reads.dispensers || [])
        .filter((row) => isOpenDispenserSelling(row, tick))
        .sort((a, b) => unitPrice(a) - unitPrice(b));
    const orders = (reads.orders || []).filter((row) => isOpenOffer(row)
        && (String(row.give_tick || '').toUpperCase() === want || String(row.get_tick || '').toUpperCase() === want));
    const total = dispensers.length + orders.length;
    if (total === 0) {
        return { rows: [{ id: 'trades-on', label: t('tokenMarket.tradesOn'), value: t('tokenMarket.tradesOnNone') }], links };
    }
    if (total > MAX_LISTED_OFFERS) {
        const parts = [
            dispensers.length > 0 ? t('tokenMarket.dispenserCount', { count: dispensers.length }) : null,
            orders.length > 0 ? t('tokenMarket.orderCount', { count: orders.length }) : null,
        ].filter(Boolean);
        const value = parts.length === 2 ? t('tokenMarket.countJoin', { a: parts[0], b: parts[1] }) : parts[0];
        return { rows: [{ id: 'trades-on', label: t('tokenMarket.tradesOn'), value }], links };
    }
    const rows = [
        ...dispensers.map((row, i) => ({
            id: `dispenser-${row.action_index ?? i}`,
            label: t('tokenMarket.dispenser'),
            value: dispenserRateLabel(row, null),
        })),
        ...orders.map((row, i) => {
            const selling = String(row.give_tick || '').toUpperCase() === want;
            return {
                id: `order-${row.action_index ?? i}`,
                label: selling ? t('tokenMarket.sellOrder') : t('tokenMarket.buyOrder'),
                value: t('tokenMarket.orderTerms', {
                    give: `${formatDecimal(row.give_remaining ?? row.give_amount)} ${row.give_tick || row.give_coin || '?'}`,
                    get: `${formatDecimal(row.get_remaining ?? row.get_amount)} ${row.get_tick || row.get_coin || '?'}`,
                }),
            };
        }),
    ];
    return { rows, links };
}

/**
 * The token's three market reads, each once per chain and token: the fills
 * against the chain's coin, the token's orders and its dispensers. Each
 * settles on its own; a failed read leaves its value null.
 */
function useTokenMarketReads({ chainId, tick, nativeTick, enabled }) {
    const { messaging } = useMessaging();
    const [state, setState] = useState({ history: null, orders: null, dispensers: null, historyLoading: enabled, offersLoading: enabled });
    useEffect(() => {
        if (!enabled) {
            setState({ history: null, orders: null, dispensers: null, historyLoading: false, offersLoading: false });
            return undefined;
        }
        let cancelled = false;
        setState({ history: null, orders: null, dispensers: null, historyLoading: true, offersLoading: true });
        const read = (name, req) => (typeof messaging?.[name] === 'function'
            ? Promise.resolve().then(() => messaging[name](req)).then(extractRows, () => null)
            : Promise.resolve(null));
        read('getMarketHistory', { chainId, tick1: tick, tick2: nativeTick }).then((history) => {
            if (!cancelled) setState((prev) => ({ ...prev, history, historyLoading: false }));
        });
        Promise.all([
            read('getOrdersForToken', { chainId, tick }),
            read('getDispensersForToken', { chainId, token: tick, opts: { page: 1, limit: DISPENSER_PAGE_LIMIT } }),
        ]).then(([orders, dispensers]) => {
            if (!cancelled) setState((prev) => ({ ...prev, orders, dispensers, offersLoading: false }));
        });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick, nativeTick, enabled]);
    return state;
}

function extractRows(resp) {
    const rows = Array.isArray(resp) ? resp
        : Array.isArray(resp?.data) ? resp.data
        : Array.isArray(resp?.rows) ? resp.rows
        : Array.isArray(resp?.history) ? resp.history
        : [];
    return rows.filter((row) => row !== null && typeof row === 'object');
}

/**
 * Last price, and the 24h change, high, low and volume (in tick1) from a
 * market's fills, as MarketView's header derives them.
 */
function derive24hStats(rows, tick1, tick2) {
    const dayAgo = Math.floor(Date.now() / 1000) - DAY_SECONDS;
    let lastPrice = null;
    let lastTimestamp = null;
    let firstPrice = null;
    let firstTimestamp = Infinity;
    let high = null;
    let low = null;
    let volume = '0';
    let tradesIn24h = 0;
    for (const row of rows) {
        const fill = normalizeMarketHistoryRowExact(row, tick1, tick2);
        if (!fill) continue;
        const { price, amount, timestamp } = fill;
        if (lastTimestamp === null || timestamp > lastTimestamp) {
            lastTimestamp = timestamp;
            lastPrice = price;
        }
        if (timestamp < dayAgo) continue;
        tradesIn24h += 1;
        if (timestamp < firstTimestamp) {
            firstTimestamp = timestamp;
            firstPrice = price;
        }
        if (high === null || compareDecimalStrings(price, high) === 1) high = price;
        if (low === null || compareDecimalStrings(price, low) === -1) low = price;
        volume = sumDecimalStrings([volume, amount]);
    }
    const changePct = tradesIn24h > 0 && compareDecimalStrings(firstPrice, '0') === 1
        ? Number(divideDecimalStrings(multiplyDecimalStrings(subtractDecimalStrings(lastPrice, firstPrice), '100'), firstPrice, 8))
        : NaN;
    return { lastPrice, lastTimestamp, changePct, high, low, volume, tradesIn24h };
}

// Coin per token for sorting dispensers cheapest first; display only.
function unitPrice(row) {
    const give = Number(row?.give_amount);
    const get = Number(row?.get_amount);
    return give > 0 && get > 0 ? get / give : Infinity;
}

/** Eight significant digits past a small price's leading zeros. */
function priceDigits(decimal) {
    const fraction = /\.(\d+)$/.exec(decimal)?.[1] || '';
    const leadingZeros = /^-?0\./.test(decimal) ? /^0*/.exec(fraction)[0].length : 0;
    return { minimumFractionDigits: 0, maximumFractionDigits: Math.min(fraction.length, leadingZeros + 8) };
}

function compactFiat(value, currency) {
    const abs = Math.abs(value);
    if (abs >= 1e12) return `${formatFiatAmount(value / 1e12, currency)}T`;
    if (abs >= 1e9) return `${formatFiatAmount(value / 1e9, currency)}B`;
    if (abs >= 1e6) return `${formatFiatAmount(value / 1e6, currency)}M`;
    if (abs >= 1e3) return `${formatFiatAmount(value / 1e3, currency)}K`;
    return formatFiatAmount(value, currency);
}

function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
    const parsed = finiteNumber(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}
