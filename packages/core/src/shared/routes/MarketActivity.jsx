// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { Screen, ScreenHeader, Icon, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import styles from './MarketActivity.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Featured market shown on landing (same for everyone, independent of
// holdings) — XChain's own token. Tapping the header swaps it for any
// other coin/token via the shared picker.
const FEATURED_MARKET = { tick: 'XCHAIN', displayName: 'XChain', chainId: null, imageUrl: null };

function extractRows(resp) {
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp?.data)) return resp.data;
    return [];
}

const byTimeDesc = (a, b) => {
    const ta = Number(a.row?.timestamp || a.row?.block_time || 0);
    const tb = Number(b.row?.timestamp || b.row?.block_time || 0);
    return tb - ta;
};

/**
 * §41/§42 — Marketplace.
 *
 * Mirrors the Decentralized Exchange shape: you land on a pre-selected
 * market (the featured XChain token) and tap the token header to pull up
 * the full coin/token list (the shared {@link TokenPicker}) and switch
 * which market you're viewing. For the selected token it surfaces both
 * trading venues across every supported chain — fixed-price dispensers
 * AND the DEX — with open offers/orders and recent fills.
 *
 * Distinct from §40.7.2 DispenserExplorer (open dispenser offers only):
 * this covers dispensers + DEX, open + filled.
 *
 * @param {object} props
 * @param {string} [props.walletId]  active wallet; when it's the demo
 *        wallet, feeds come from {@link flowsLib.synthesizeDemoMarketActivity}
 *        instead of the live explorer.
 * @param {string} [props.accountId]
 * @param {() => void} props.onBack
 * @param {(chainId: string, actionIndex: string) => void} [props.onOpenDispenser]
 */
export function MarketActivity({ walletId, accountId, onBack, onOpenDispenser }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const chains = useMemo(() => chainRegistry.supportedChains().map((d) => d.id), []);
    // A representative chain for the featured-token icon (prefer Bitcoin).
    const defaultChainId = useMemo(
        () => chains.find((id) => coinFromChainId(id) === 'bitcoin') || chains[0] || null,
        [chains],
    );

    const [selected, setSelected] = useState(FEATURED_MARKET);
    const [picking, setPicking] = useState(false);
    const [loading, setLoading] = useState(true);
    const [offers, setOffers] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [sales, setSales] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexOrders, setDexOrders] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexSwaps, setDexSwaps] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));

    const tick = (selected.tick || '').toUpperCase();

    // Load the selected market — on landing and whenever the user picks a
    // different coin/token. Demo wallets are served fabricated feeds; real
    // wallets fan out across every supported chain in parallel.
    useEffect(() => {
        if (!tick) return undefined;
        let cancelled = false;
        setLoading(true);
        setOffers(null);
        setSales(null);
        setDexOrders(null);
        setDexSwaps(null);

        if (walletId && flowsLib.isDemoWallet(walletId)) {
            const demo = flowsLib.synthesizeDemoMarketActivity(tick);
            if (!cancelled) {
                setOffers(demo.offers);
                setSales(demo.sales);
                setDexOrders(demo.dexOrders);
                setDexSwaps(demo.dexSwaps);
                setLoading(false);
            }
            return () => { cancelled = true; };
        }

        const offersByChain = chains.map((cid) =>
            messaging.getDispensersForToken({ chainId: cid, token: tick })
                .then((resp) => extractRows(resp)
                    .filter((d) => d && (d.status === undefined || Number(d.status) === 0))
                    .map((row) => ({ chainId: cid, row })))
                .catch(() => []),
        );
        const salesByChain = chains.map((cid) =>
            typeof messaging.getDispenses === 'function'
                ? messaging.getDispenses({ chainId: cid, query: tick, type: 'token' })
                    .then((resp) => extractRows(resp).map((row) => ({ chainId: cid, row })))
                    .catch(() => [])
                : Promise.resolve([]),
        );
        const ordersByChain = chains.map((cid) =>
            typeof messaging.getOrdersForToken === 'function'
                ? messaging.getOrdersForToken({ chainId: cid, tick })
                    .then((resp) => extractRows(resp)
                        .filter((o) => o && (o.status === undefined || o.status === 'open' || Number(o.status) === 0))
                        .map((row) => ({ chainId: cid, row })))
                    .catch(() => [])
                : Promise.resolve([]),
        );
        const swapsByChain = chains.map((cid) =>
            typeof messaging.getSwapsForToken === 'function'
                ? messaging.getSwapsForToken({ chainId: cid, tick })
                    .then((resp) => extractRows(resp).map((row) => ({ chainId: cid, row })))
                    .catch(() => [])
                : Promise.resolve([]),
        );

        Promise.all([
            Promise.all(offersByChain),
            Promise.all(salesByChain),
            Promise.all(ordersByChain),
            Promise.all(swapsByChain),
        ]).then(([offersBatches, salesBatches, ordersBatches, swapsBatches]) => {
            if (cancelled) return;
            setOffers(offersBatches.flat());
            setSales(salesBatches.flat().sort(byTimeDesc));
            setDexOrders(ordersBatches.flat());
            setDexSwaps(swapsBatches.flat().sort(byTimeDesc));
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [tick, walletId, messaging, chains]);

    // Sub-view: tapping the token header opens the shared picker to switch
    // markets. 'receive' purpose enables cross-chain token discovery so the
    // user can view a market for a token they don't hold.
    if (picking) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                accountId={accountId}
                title="Select a market"
                titleIcon={<Icon.MarketIcon />}
                backLabel="Back to marketplace"
                onBack={() => setPicking(false)}
                onSelect={(sel) => {
                    setSelected({
                        tick: sel.tick,
                        chainId: sel.chainId,
                        displayName: sel.displayName,
                        imageUrl: sel.imageUrl,
                    });
                    setPicking(false);
                }}
            />
        );
    }

    const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back"
            title="Marketplace"
            titleIcon={<Icon.MarketIcon />}
        />
    );

    const iconChainId = selected.chainId || defaultChainId;

    return (
        <Screen variant={variant} header={header}>
            <button
                type="button"
                className={styles.marketSelector}
                onClick={() => setPicking(true)}
                aria-label={`Change market (currently ${selected.displayName || tick})`}
            >
                <TickerIcon chainId={iconChainId} tick={tick} size={40} />
                <span className={styles.marketSelectorText}>
                    <span className={styles.marketSelectorName}>{selected.displayName || tick}</span>
                    <span className={styles.marketSelectorSub}>{tick}</span>
                </span>
                <span className={styles.marketSelectorChevron} aria-hidden="true">›</span>
            </button>

            {loading && offers === null ? (
                <div className={styles.list}>
                    <Skeleton height={56} />
                    <Skeleton height={56} />
                    <Skeleton height={56} />
                </div>
            ) : null}

            {offers !== null ? (
                <section className={styles.section} aria-label="Open dispensers">
                    <header className={styles.sectionHeader}>
                        <h3 className={styles.sectionTitle}>
                            Open dispensers <span className={styles.count}>{offers.length}</span>
                        </h3>
                    </header>
                    {offers.length === 0 ? (
                        <p className={styles.empty}>No open dispensers selling {tick}.</p>
                    ) : (
                        <ul className={styles.list} role="list">
                            {offers.map(({ chainId, row }) => {
                                const give = row.give_quantity ?? row.give_remaining;
                                const getTick = row.get_tick || row.mainchainrate_tick || 'COIN';
                                const get = row.get_quantity ?? row.mainchainrate;
                                const remaining = row.give_remaining ?? row.escrow_quantity;
                                const actionIndex = row.action_index || row.actionIndex || row.tx_hash || row.id;
                                const onClick = typeof onOpenDispenser === 'function' && actionIndex
                                    ? () => onOpenDispenser(chainId, actionIndex)
                                    : undefined;
                                return (
                                    <li key={`${chainId}:${actionIndex}`}>
                                        <button
                                            type="button"
                                            className={styles.row}
                                            onClick={onClick}
                                            disabled={!onClick}
                                        >
                                            <TickerIcon chainId={chainId} tick={tick} size={32} />
                                            <span className={styles.rowText}>
                                                <span className={styles.rowTitle}>
                                                    {give && get ? `${Number(get).toLocaleString()} ${getTick} per ${Number(give).toLocaleString()} ${tick}` : 'Open dispenser'}
                                                </span>
                                                <span className={styles.rowSub}>
                                                    {remaining != null ? `${Number(remaining).toLocaleString()} ${tick} remaining` : ''}
                                                </span>
                                            </span>
                                            {onClick ? <Icon.ForwardIcon /> : null}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            ) : null}

            {dexOrders !== null ? (
                <section className={styles.section} aria-label="Open DEX orders">
                    <header className={styles.sectionHeader}>
                        <h3 className={styles.sectionTitle}>
                            Open DEX orders <span className={styles.count}>{dexOrders.length}</span>
                        </h3>
                    </header>
                    {dexOrders.length === 0 ? (
                        <p className={styles.empty}>No open DEX orders involving {tick}.</p>
                    ) : (
                        <ul className={styles.list} role="list">
                            {dexOrders.slice(0, 50).map(({ chainId, row }, i) => {
                                const giveTick = row.give_tick || row.giveTick || '';
                                const getTick = row.get_tick || row.getTick || '';
                                const giveQty = row.give_quantity ?? row.give_remaining;
                                const getQty = row.get_quantity ?? row.get_remaining;
                                const isSell = giveTick.toUpperCase() === tick;
                                const title = isSell
                                    ? (giveQty != null && getQty != null
                                        ? `Sell ${Number(giveQty).toLocaleString()} ${tick} for ${Number(getQty).toLocaleString()} ${getTick}`
                                        : `Sell ${tick}`)
                                    : (giveQty != null && getQty != null
                                        ? `Buy ${Number(getQty).toLocaleString()} ${tick} for ${Number(giveQty).toLocaleString()} ${giveTick}`
                                        : `Buy ${tick}`);
                                const key = row.action_index || row.actionIndex || row.tx_hash || `${chainId}:${i}`;
                                return (
                                    <li key={String(key)}>
                                        <div className={styles.row}>
                                            <TickerIcon chainId={chainId} tick={tick} size={32} />
                                            <span className={styles.rowText}>
                                                <span className={styles.rowTitle}>{title}</span>
                                            </span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            ) : null}

            {sales !== null ? (
                <section className={styles.section} aria-label="Recent dispenses">
                    <header className={styles.sectionHeader}>
                        <h3 className={styles.sectionTitle}>
                            Recent dispenses <span className={styles.count}>{sales.length}</span>
                        </h3>
                    </header>
                    {sales.length === 0 ? (
                        <p className={styles.empty}>No recent dispenses of {tick}.</p>
                    ) : (
                        <ul className={styles.list} role="list">
                            {sales.slice(0, 50).map(({ chainId, row }, i) => {
                                const give = row.give_quantity ?? row.dispense_quantity ?? row.quantity;
                                const getTick = row.get_tick || row.mainchainrate_tick || 'COIN';
                                const get = row.get_quantity ?? row.mainchainrate ?? row.price;
                                const ts = Number(row.timestamp || row.block_time || 0);
                                const dateLabel = ts > 0
                                    ? new Date(ts * (ts > 1e12 ? 1 : 1000)).toLocaleString()
                                    : '';
                                return (
                                    <li key={`${chainId}:${i}`}>
                                        <div className={styles.row}>
                                            <TickerIcon chainId={chainId} tick={tick} size={32} />
                                            <span className={styles.rowText}>
                                                <span className={styles.rowTitle}>
                                                    {give ? `Sold ${Number(give).toLocaleString()} ${tick}` : `Sold ${tick}`}
                                                    {give && get ? ` for ${Number(get).toLocaleString()} ${getTick}` : ''}
                                                </span>
                                                <span className={styles.rowSub}>
                                                    {dateLabel}
                                                </span>
                                            </span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            ) : null}

            {dexSwaps !== null ? (
                <section className={styles.section} aria-label="Recent DEX swaps">
                    <header className={styles.sectionHeader}>
                        <h3 className={styles.sectionTitle}>
                            Recent DEX swaps <span className={styles.count}>{dexSwaps.length}</span>
                        </h3>
                    </header>
                    {dexSwaps.length === 0 ? (
                        <p className={styles.empty}>No recent DEX swaps involving {tick}.</p>
                    ) : (
                        <ul className={styles.list} role="list">
                            {dexSwaps.slice(0, 50).map(({ chainId, row }, i) => {
                                const giveTick = row.give_tick || row.giveTick || '';
                                const getTick = row.get_tick || row.getTick || '';
                                const giveQty = row.give_quantity ?? null;
                                const getQty = row.get_quantity ?? null;
                                const ts = Number(row.timestamp || row.block_time || 0);
                                const dateLabel = ts > 0
                                    ? new Date(ts * (ts > 1e12 ? 1 : 1000)).toLocaleString()
                                    : '';
                                const isSell = giveTick.toUpperCase() === tick;
                                const title = isSell
                                    ? (giveQty != null && getQty != null
                                        ? `Sold ${Number(giveQty).toLocaleString()} ${tick} for ${Number(getQty).toLocaleString()} ${getTick}`
                                        : `Sold ${tick}`)
                                    : (giveQty != null && getQty != null
                                        ? `Bought ${Number(getQty).toLocaleString()} ${tick} for ${Number(giveQty).toLocaleString()} ${giveTick}`
                                        : `Bought ${tick}`);
                                const key = row.action_index || row.actionIndex || row.tx_hash || `${chainId}:${i}`;
                                return (
                                    <li key={String(key)}>
                                        <div className={styles.row}>
                                            <TickerIcon chainId={chainId} tick={tick} size={32} />
                                            <span className={styles.rowText}>
                                                <span className={styles.rowTitle}>{title}</span>
                                                <span className={styles.rowSub}>{dateLabel}</span>
                                            </span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            ) : null}
        </Screen>
    );
}
