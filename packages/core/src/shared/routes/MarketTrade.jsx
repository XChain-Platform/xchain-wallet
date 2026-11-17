// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Trade page (route `market-trade`), opened by the Market page's Buy and Sell buttons
// or a tapped book price. The page is one Form Standard form (PlaceOrderPanel layout="trade"):
// From, Trade Details with the Buy | Sell and Swap | Limit | Market toggles, Fees, then a
// summary line and the one Place Order action. The page owns the side and the mode; Swap,
// Limit and Market are one panel, so a typed order survives a mode switch and every mode
// submits through the panel's own guard, confirm and sign path. The page polls the best
// bid and ask and reads the last trade for Market orders, Fill now and the start price.

import { useEffect, useMemo, useState } from 'react';
import { ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/market.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { PlaceOrderPanel } from '../components/PlaceOrderPanel.jsx';
import { tidyQuotePrice } from '../components/marketTradeParts.jsx';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary.jsx';
import { normalizeOrderbook } from '../../market/orderbook.js';
import { sampleMatchesFor, sampleOrderbookFor } from '../../market/sampleMarketData.js';
import { normalizeMarketHistoryRowExact } from '../../market/history_rows.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { startVisibleInterval } from '../utils/visibleInterval.js';
import styles from './MarketTrade.module.css';

const QUOTE_POLL_MS = 5000;

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {'buy' | 'sell'} [props.side]
 * @param {'swap' | 'market'} [props.mode]   'market' opens the toggle at Limit
 * @param {string | null} [props.price]      a picked order-book price (opens the toggle at Limit)
 * @param {number} [props.pick]              counts book picks, so the same price picked again refills
 * @param {() => void} props.onBack
 */
export function MarketTrade({ walletId, chainId, tick1, tick2, side: initialSide = 'buy', mode: initialMode = 'swap', price: pickedPrice = null, pick, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const demo = flowsLib.isDemoWallet(walletId);
    const [side, setSide] = useState(/** @type {'buy' | 'sell'} */ (initialSide === 'sell' ? 'sell' : 'buy'));
    const [mode, setMode] = useState(/** @type {'swap' | 'market'} */ (pickedPrice ? 'market' : (initialMode === 'market' ? 'market' : 'swap')));
    const [quoteKey, setQuoteKey] = useState(0);

    // The best bid and ask, polled like the order book itself so Market
    // orders and Fill now take a current quote.
    const [book, setBook] = useState(/** @type {{ bid: string | null, ask: string | null }} */ ({ bid: null, ask: null }));
    const [bookError, setBookError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        let requestId = 0;
        const read = async () => {
            const current = ++requestId;
            try {
                const resp = await messaging.getOrderbook({ chainId, tick1, tick2 });
                if (cancelled || current !== requestId) return;
                let normalized = normalizeOrderbook(resp);
                if (demo && normalized.bids.length === 0 && normalized.asks.length === 0) {
                    normalized = normalizeOrderbook(sampleOrderbookFor(tick1, tick2));
                }
                setBook({ bid: normalized.bids[0]?.displayPrice ?? null, ask: normalized.asks[0]?.displayPrice ?? null });
                setBookError(null);
            } catch (err) {
                if (cancelled || current !== requestId) return;
                if (demo) {
                    const sample = normalizeOrderbook(sampleOrderbookFor(tick1, tick2));
                    setBook({ bid: sample.bids[0]?.displayPrice ?? null, ask: sample.asks[0]?.displayPrice ?? null });
                }
                setBookError(readFailureMessage(err, 'load the order book'));
            }
        };
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') read();
        const stop = startVisibleInterval(read, QUOTE_POLL_MS);
        return () => {
            cancelled = true;
            stop();
        };
    }, [messaging, chainId, tick1, tick2, demo, quoteKey]);

    // The last trade, from the same history feed the Market page reads: the
    // Limit price starts there and the Price field's hint names it.
    const [historyRows, setHistoryRows] = useState(/** @type {any[]} */ ([]));
    const [historyError, setHistoryError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        let cancelled = false;
        setHistoryError(null);
        messaging.getMarketHistory({ chainId, tick1, tick2 })
            .then((resp) => {
                if (cancelled) return;
                const rows = historyRowsOf(resp);
                setHistoryRows(rows.length > 0 ? rows : (demo ? sampleMatchesFor(tick1, tick2) : []));
            })
            .catch((err) => {
                if (cancelled) return;
                setHistoryRows(demo ? sampleMatchesFor(tick1, tick2) : []);
                setHistoryError(readFailureMessage(err, 'refresh market prices'));
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2, demo, quoteKey]);
    const lastPrice = useMemo(() => lastTradePrice(historyRows, tick1, tick2), [historyRows, tick1, tick2]);

    const failed = [bookError ? 'order book' : null, historyError ? 'prices' : null].filter(Boolean);

    return (
        <Screen
            variant={variant}
            header={<PageHeader onBack={onBack} title={t('market.trade.title', { pair: `${tick1}/${tick2}` })} />}
        >
            <ListPage className={styles.page}>
                {failed.length > 0 ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: t('common.tryAgain'), onAction: () => setQuoteKey((key) => key + 1) }}
                    >
                        {t('market.trade.loadFailed', { list: failed.join(t('market.trade.orThe')) })}
                    </StatusMessage>
                ) : null}

                {/* No price tiles above the form: the Swap | Limit | Market
                    toggle and every field live in the form's Trade Details
                    section, under From. */}
                <RouteErrorBoundary variant="compact" resetKey={`${chainId}:${tick1}:${tick2}:trade`}>
                    <PlaceOrderPanel
                        key={`${chainId}:${tick1}:${tick2}`}
                        walletId={walletId}
                        chainId={chainId}
                        tick1={tick1}
                        tick2={tick2}
                        layout="trade"
                        view={mode}
                        onViewChange={setMode}
                        side={side}
                        onSideChange={setSide}
                        bestBid={book.bid}
                        bestAsk={book.ask}
                        lastPrice={lastPrice}
                        prefillPrice={pickedPrice}
                        prefillPick={pick}
                        initialOrderType="limit"
                    />
                </RouteErrorBoundary>
            </ListPage>
        </Screen>
    );
}

function historyRowsOf(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    for (const key of ['data', 'rows', 'history']) if (Array.isArray(resp[key])) return resp[key];
    return [];
}

/** The newest trade price, tidied as the starting limit price reads it. */
function lastTradePrice(rows, tick1, tick2) {
    let price = null;
    let lastTs = -Infinity;
    for (const row of rows || []) {
        const parsed = normalizeMarketHistoryRowExact(row, tick1, tick2);
        if (!parsed) continue;
        if (parsed.timestamp > lastTs) { lastTs = parsed.timestamp; price = parsed.price; }
    }
    return tidyQuotePrice(price);
}
