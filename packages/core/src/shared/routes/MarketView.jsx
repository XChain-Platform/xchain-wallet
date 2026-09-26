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
import { Button, ChainBadge, Icon, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { MarketChart } from '../components/MarketChart.jsx';
import { OrderbookPanel } from '../components/OrderbookPanel.jsx';
import { RecentTradesPanel } from '../components/RecentTradesPanel.jsx';
import { PlaceOrderPanel } from '../components/PlaceOrderPanel.jsx';
import { OpenOrdersPanel } from '../components/OpenOrdersPanel.jsx';
import { TradeHistoryPanel } from '../components/TradeHistoryPanel.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { sampleMatchesFor } from '../../market/sampleMarketData.js';
import { normalizeMarketHistoryRowExact } from '../../market/history_rows.js';
import {
    compareDecimalStrings,
    divideDecimalStrings,
    multiplyDecimalStrings,
    roundDecimalString,
    subtractDecimalStrings,
    sumDecimalStrings,
} from '../utils/amountFormat.js';
import styles from './IssueTokenForm.module.css';
import receivePickerStyles from './TokenPicker.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Market view (§41.3). Trading surface for a single market.
 *
 * Four panels laid out in the spec's ASCII mock:
 *
 *   ┌──────────────────┬──────────────────────────┬──────────────────┐
 *   │   Chart (§41.3.1)│   Orderbook (§41.3.2)    │  Trades (§41.3.3)│
 *   ├──────────────────┴──────────────────────────┴──────────────────┤
 *   │   Place order + My open orders (§41.3.4 + §41.3.5)             │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Each panel lands as its own component in subsequent steps (this is
 * the Step 2 shell). Live data comes in per-step; for now the header
 * renders the market-summary line (last price / 24h change / depth)
 * pulled from `messaging.getMarket` so the scaffold demonstrates the
 * end-to-end passthrough without waiting for the charting libs.
 *
 * Popup vs full variant:
 *   - `full` (extension full-screen, web, desktop): four-panel grid.
 *   - `popup`: stacks panels vertically; the popup form-factor is
 *     too narrow for a trading grid, but all panels remain reachable.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {() => void} props.onBack
 * @param {() => void} [props.onSwap] renders the reverse-pair control; reopens the market with tick1/tick2 flipped
 */
export function MarketView({ walletId, chainId, tick1, tick2, onBack, onSwap }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';
    // Demo wallets get sample feeds so the trading surface is fully
    // populated without live liquidity. Real wallets show live data and
    // the panels' own empty states, never fabricated prices/trades.
    const demo = flowsLib.isDemoWallet(walletId);

    const [summary, setSummary] = useState(/** @type {any | null} */ (null));
    const [summaryError, setSummaryError] = useState(/** @type {string | null} */ (null));
    const [prefillPrice, setPrefillPrice] = useState(/** @type {string | null} */ (null));
    const [tab, setTab] = useState(/** @type {'book' | 'trades' | 'place' | 'orders' | 'history'} */ ('book'));

    useEffect(() => {
        let cancelled = false;
        setSummary(null);
        setSummaryError(null);
        messaging.getMarket({ chainId, tick1, tick2 })
            .then((resp) => { if (!cancelled) setSummary(resp); })
            .catch((err) => {
                if (!cancelled) setSummaryError(err?.message || String(err));
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2]);

    const descriptor = chainRegistry.get(chainId);

    // Header 24h stats (last / change / high / low / volume) derive from
    // the live getMarketHistory feed, the same data the chart + trades
    // panel render. Demo wallets fall back to sample matches; real wallets
    // show real stats, or blanks (empty) when the market has no fills yet.
    const [historyRows, setHistoryRows] = useState(/** @type {any[]} */ ([]));
    useEffect(() => {
        let cancelled = false;
        setHistoryRows([]);
        messaging.getMarketHistory({ chainId, tick1, tick2 })
            .then((resp) => {
                if (cancelled) return;
                const real = extractHistoryRows(resp);
                setHistoryRows(real.length > 0 ? real : (demo ? sampleMatchesFor(tick1, tick2) : []));
            })
            .catch(() => {
                if (!cancelled) setHistoryRows(demo ? sampleMatchesFor(tick1, tick2) : []);
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2, demo]);
    const stats = useMemo(() => derive24hStats(historyRows, tick1, tick2), [historyRows, tick1, tick2]);
    const lastPrice = stats.lastPrice;
    const changePct = stats.changePct;
    const changeColor = Number.isFinite(changePct)
        ? (changePct > 0 ? 'var(--xc-success, #16a34a)' : changePct < 0 ? 'var(--xc-danger, #dc2626)' : 'var(--xc-text-muted)')
        : 'var(--xc-text-muted)';

    const header = (
        <PageHeader
            onBack={onBack}
            title={`${tick1}/${tick2}`}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    const headerCard = (
        <div style={{
            background: 'var(--xc-bg-muted)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
            padding: 'var(--xc-space-3)',
            marginBottom: 'var(--xc-space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <TickerIcon chainId={chainId} tick={tick1} size={32} />
                    <TickerIcon chainId={chainId} tick={tick2} size={32} />
                </span>
                <span style={{ flex: 1, fontSize: 'var(--xc-text-md)', fontWeight: 700, color: 'var(--xc-text)' }}>
                    {tick1} <span style={{ color: 'var(--xc-text-muted)', fontWeight: 500 }}>/</span> {tick2}
                </span>
                {typeof onSwap === 'function' ? (
                    <button
                        type="button"
                        onClick={onSwap}
                        aria-label={`Reverse pair to ${tick2}/${tick1}`}
                        title={`Reverse to ${tick2}/${tick1}`}
                        style={{
                            appearance: 'none',
                            background: 'var(--xc-surface-raised)',
                            border: '1px solid var(--xc-border)',
                            borderRadius: '50%',
                            width: 32,
                            height: 32,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--xc-text)',
                            cursor: 'pointer',
                            flex: '0 0 auto',
                        }}
                    >
                        <Icon.SwapIcon />
                    </button>
                ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--xc-space-2)' }}>
                <span style={{ fontSize: 'var(--xc-text-lg)', fontWeight: 700, color: 'var(--xc-text)' }}>
                    {formatPrice(lastPrice)} <span style={{ fontSize: 'var(--xc-text-xs)', color: 'var(--xc-text-muted)', fontWeight: 500 }}>{tick2}</span>
                </span>
                {Number.isFinite(changePct) ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 'var(--xc-text-sm)', fontWeight: 600, color: changeColor }}>
                        {formatChangePct(changePct)}
                        {changePct !== 0 ? (
                            <span aria-hidden="true" style={{ fontSize: '0.8em', lineHeight: 1 }}>
                                {changePct > 0 ? '▲' : '▼'}
                            </span>
                        ) : null}
                    </span>
                ) : null}
            </div>
            <div style={{ height: 1, background: 'var(--xc-border)' }} />
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 'var(--xc-space-3)', rowGap: 2, fontSize: 'var(--xc-text-xs)' }}>
                <dt style={{ color: 'var(--xc-text-muted)' }}>24h high</dt>
                <dd style={{ margin: 0, color: 'var(--xc-text)' }}>{formatPrice(stats.high)} {tick2}</dd>
                <dt style={{ color: 'var(--xc-text-muted)' }}>24h low</dt>
                <dd style={{ margin: 0, color: 'var(--xc-text)' }}>{formatPrice(stats.low)} {tick2}</dd>
                <dt style={{ color: 'var(--xc-text-muted)' }}>24h vol</dt>
                <dd style={{ margin: 0, color: 'var(--xc-text)' }}>{formatVolume(stats.volume)} {tick1}</dd>
            </dl>
        </div>
    );

    return wrap(
        <>
            {summaryError ? (
                <StatusMessage variant="error" className={styles.error}>{summaryError}</StatusMessage>
            ) : null}
            {headerCard}

            <div style={{ marginTop: 'var(--xc-space-3)' }}>
                <MarketChart chainId={chainId} tick1={tick1} tick2={tick2} demo={demo} />
            </div>

            <div
                className={receivePickerStyles.kindSegments}
                role="tablist"
                aria-label="Market panels"
                style={{ width: '100%', marginTop: 'var(--xc-space-3)', marginBottom: 'var(--xc-space-3)', flexShrink: 1 }}
            >
                {[
                    { id: 'book',    label: 'Book' },
                    { id: 'trades',  label: 'Trades' },
                    { id: 'place',   label: 'Place' },
                    { id: 'orders',  label: 'Orders' },
                    { id: 'history', label: 'History' },
                ].map((opt) => {
                    const active = tab === opt.id;
                    return (
                        <button
                            key={opt.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            className={`${receivePickerStyles.kindSegment} ${active ? receivePickerStyles.kindSegmentActive : ''}`}
                            style={{ flex: 1 }}
                            onClick={() => setTab(opt.id)}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'book' ? (
                <OrderbookPanel
                    chainId={chainId}
                    tick1={tick1}
                    tick2={tick2}
                    demo={demo}
                    onPickPrice={(price) => { setPrefillPrice(price); setTab('place'); }}
                />
            ) : null}
            {tab === 'trades' ? (
                <RecentTradesPanel chainId={chainId} tick1={tick1} tick2={tick2} demo={demo} />
            ) : null}
            {tab === 'place' ? (
                <PlaceOrderPanel
                    walletId={walletId}
                    chainId={chainId}
                    tick1={tick1}
                    tick2={tick2}
                    prefillPrice={prefillPrice}
                />
            ) : null}
            {tab === 'orders' ? (
                <OpenOrdersPanel
                    walletId={walletId}
                    chainId={chainId}
                    tick1={tick1}
                    tick2={tick2}
                />
            ) : null}
            {tab === 'history' ? (
                <TradeHistoryPanel
                    walletId={walletId}
                    chainId={chainId}
                    tick1={tick1}
                    tick2={tick2}
                />
            ) : null}

            <div className={styles.actions}>
            </div>
        </>,
    );
}

/** Normalize the explorer's getMarketHistory response into a row array. */
function extractHistoryRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.history)) return resp.history;
    return [];
}

/**
 * Walk a list of match rows and compute last price, 24h change, 24h
 * high/low, and 24h volume (in tick1).
 *
 * Each projected match row carries `price`, `amount`, `type`, and a timestamp.
 * Raw give/get rows remain accepted for older explorers.
 */
function derive24hStats(rows, tick1, tick2) {
    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 86400;
    let lastPrice = null;
    let lastTs = -Infinity;
    let firstPriceIn24h = null;
    let firstTsIn24h = Infinity;
    let high = null;
    let low = null;
    let volume = '0';
    for (const row of rows || []) {
        const parsed = normalizeMarketHistoryRowExact(row, tick1, tick2);
        if (!parsed) continue;
        const { price, amount: sizeT1, timestamp: ts } = parsed;
        if (ts > lastTs) { lastTs = ts; lastPrice = price; }
        if (ts >= dayAgo) {
            if (ts < firstTsIn24h) { firstTsIn24h = ts; firstPriceIn24h = price; }
            if (high === null || compareDecimalStrings(price, high) === 1) high = price;
            if (low === null || compareDecimalStrings(price, low) === -1) low = price;
            volume = sumDecimalStrings([volume, sizeT1]);
        }
    }
    const change = lastPrice !== null && compareDecimalStrings(firstPriceIn24h, '0') === 1
        ? subtractDecimalStrings(lastPrice, firstPriceIn24h)
        : null;
    const changePctText = change === null
        ? null
        : divideDecimalStrings(multiplyDecimalStrings(change, '100'), firstPriceIn24h, 8);
    return {
        lastPrice,
        changePct: changePctText === null ? NaN : Number(changePctText),
        high,
        low,
        volume,
    };
}

function formatPrice(n) {
    if (compareDecimalStrings(n, '0') === null) return '-';
    if (compareDecimalStrings(n, '0') === 0) return '0';
    if (compareDecimalStrings(n, '1') >= 0) return roundDecimalString(n, 4);
    if (compareDecimalStrings(n, '0.01') >= 0) return roundDecimalString(n, 6);
    return roundDecimalString(n, 8);
}

function formatChangePct(n) {
    if (!Number.isFinite(n)) return '';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(2)}%`;
}

function formatVolume(n) {
    if (compareDecimalStrings(n, '0') !== 1) return '0';
    if (compareDecimalStrings(n, '1000000') >= 0) {
        return `${divideDecimalStrings(n, '1000000', 2)}M`;
    }
    if (compareDecimalStrings(n, '1000') >= 0) {
        return `${divideDecimalStrings(n, '1000', 2)}K`;
    }
    return roundDecimalString(n, 0);
}
