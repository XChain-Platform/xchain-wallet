// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useMemo, useState } from 'react';
import { Screen, ScreenHeader, Input, Icon, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { TickerIcon } from '../components/TickerIcon.jsx';
import styles from './MarketActivity.module.css';

const chainRegistry = registryLib.defaultRegistry();

function extractRows(resp) {
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp?.data)) return resp.data;
    return [];
}

/**
 * §41/§42 — Marketplace activity feed.
 *
 * Distinct from §40.7.2 DispenserExplorer (buyer-facing browse, open
 * dispenser offers only): MarketActivity covers both trading venues
 * for the searched token — fixed-price dispensers AND the DEX —
 * surfacing both open offers and recent fills so users can answer
 * "what's been bought and sold lately?"
 *
 * The explorer backend has no "all platform" wildcard for any of
 * these queries; they are always scoped. This page therefore centers
 * on a token search and fans out across every supported chain in
 * parallel, merging results.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {(chainId: string, actionIndex: string) => void} [props.onOpenDispenser]
 */
export function MarketActivity({ onBack, onOpenDispenser }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const chains = useMemo(() => chainRegistry.supportedChains().map((d) => d.id), []);

    const [query, setQuery] = useState('');
    const [lastQuery, setLastQuery] = useState(/** @type {string | null} */ (null));
    const [searching, setSearching] = useState(false);
    const [offers, setOffers] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [sales, setSales] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexOrders, setDexOrders] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexSwaps, setDexSwaps] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    function handleSearch(event) {
        event.preventDefault();
        const q = query.trim().toUpperCase();
        if (!q) return;
        if (!/^[A-Za-z0-9.^]+$/.test(q)) {
            setError('Token search accepts A–Z, 0–9, period, or ^TICK_ID.');
            setLastQuery(q);
            return;
        }
        setError(null);
        setLastQuery(q);
        setSearching(true);
        setOffers(null);
        setSales(null);
        setDexOrders(null);
        setDexSwaps(null);

        const offersByChain = chains.map((cid) =>
            messaging.getDispensersForToken({ chainId: cid, token: q })
                .then((resp) => extractRows(resp)
                    .filter((d) => d && (d.status === undefined || Number(d.status) === 0))
                    .map((row) => ({ chainId: cid, row })))
                .catch(() => []),
        );
        const salesByChain = chains.map((cid) =>
            typeof messaging.getDispenses === 'function'
                ? messaging.getDispenses({ chainId: cid, query: q, type: 'token' })
                    .then((resp) => extractRows(resp).map((row) => ({ chainId: cid, row })))
                    .catch(() => [])
                : Promise.resolve([]),
        );
        const ordersByChain = chains.map((cid) =>
            typeof messaging.getOrdersForToken === 'function'
                ? messaging.getOrdersForToken({ chainId: cid, tick: q })
                    .then((resp) => extractRows(resp)
                        .filter((o) => o && (o.status === undefined || o.status === 'open' || Number(o.status) === 0))
                        .map((row) => ({ chainId: cid, row })))
                    .catch(() => [])
                : Promise.resolve([]),
        );
        const swapsByChain = chains.map((cid) =>
            typeof messaging.getSwapsForToken === 'function'
                ? messaging.getSwapsForToken({ chainId: cid, tick: q })
                    .then((resp) => extractRows(resp).map((row) => ({ chainId: cid, row })))
                    .catch(() => [])
                : Promise.resolve([]),
        );

        const byTimeDesc = (a, b) => {
            const ta = Number(a.row?.timestamp || a.row?.block_time || 0);
            const tb = Number(b.row?.timestamp || b.row?.block_time || 0);
            return tb - ta;
        };

        Promise.all([
            Promise.all(offersByChain),
            Promise.all(salesByChain),
            Promise.all(ordersByChain),
            Promise.all(swapsByChain),
        ]).then(([offersBatches, salesBatches, ordersBatches, swapsBatches]) => {
            setOffers(offersBatches.flat());
            setSales(salesBatches.flat().sort(byTimeDesc));
            setDexOrders(ordersBatches.flat());
            setDexSwaps(swapsBatches.flat().sort(byTimeDesc));
            setSearching(false);
        });
    }

    const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back"
            title="Marketplace"
            titleIcon={<Icon.MarketIcon />}
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <form className={styles.searchRow} onSubmit={handleSearch} noValidate>
                <Input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by token (e.g. PEPECASH)"
                    aria-label="Search marketplace by token"
                />
                <button
                    type="submit"
                    className={styles.searchButton}
                    disabled={!query.trim() || searching}
                >
                    <Icon.SearchIcon />
                    Search
                </button>
            </form>

            {error ? <p className={styles.error}>{error}</p> : null}

            {!lastQuery ? (
                <p className={styles.empty}>
                    Enter a ticker to see dispensers, DEX orders, and
                    recent trades across every supported chain.
                </p>
            ) : null}

            {lastQuery && searching && offers === null ? (
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
                        <p className={styles.empty}>No open dispensers selling {lastQuery}.</p>
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
                                            <TickerIcon chainId={chainId} tick={lastQuery} size={32} />
                                            <span className={styles.rowText}>
                                                <span className={styles.rowTitle}>
                                                    {give && get ? `${Number(get).toLocaleString()} ${getTick} per ${Number(give).toLocaleString()} ${lastQuery}` : 'Open dispenser'}
                                                </span>
                                                <span className={styles.rowSub}>
                                                    {remaining != null ? `${Number(remaining).toLocaleString()} ${lastQuery} remaining` : ''}
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
                        <p className={styles.empty}>No open DEX orders involving {lastQuery}.</p>
                    ) : (
                        <ul className={styles.list} role="list">
                            {dexOrders.slice(0, 50).map(({ chainId, row }, i) => {
                                const giveTick = row.give_tick || row.giveTick || '';
                                const getTick = row.get_tick || row.getTick || '';
                                const giveQty = row.give_quantity ?? row.give_remaining;
                                const getQty = row.get_quantity ?? row.get_remaining;
                                const isSell = giveTick.toUpperCase() === lastQuery;
                                const title = isSell
                                    ? (giveQty != null && getQty != null
                                        ? `Sell ${Number(giveQty).toLocaleString()} ${lastQuery} for ${Number(getQty).toLocaleString()} ${getTick}`
                                        : `Sell ${lastQuery}`)
                                    : (giveQty != null && getQty != null
                                        ? `Buy ${Number(getQty).toLocaleString()} ${lastQuery} for ${Number(giveQty).toLocaleString()} ${giveTick}`
                                        : `Buy ${lastQuery}`);
                                const key = row.action_index || row.actionIndex || row.tx_hash || `${chainId}:${i}`;
                                return (
                                    <li key={String(key)}>
                                        <div className={styles.row}>
                                            <TickerIcon chainId={chainId} tick={lastQuery} size={32} />
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
                        <p className={styles.empty}>No recent dispenses of {lastQuery}.</p>
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
                                            <TickerIcon chainId={chainId} tick={lastQuery} size={32} />
                                            <span className={styles.rowText}>
                                                <span className={styles.rowTitle}>
                                                    {give ? `Sold ${Number(give).toLocaleString()} ${lastQuery}` : `Sold ${lastQuery}`}
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
                        <p className={styles.empty}>No recent DEX swaps involving {lastQuery}.</p>
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
                                const isSell = giveTick.toUpperCase() === lastQuery;
                                const title = isSell
                                    ? (giveQty != null && getQty != null
                                        ? `Sold ${Number(giveQty).toLocaleString()} ${lastQuery} for ${Number(getQty).toLocaleString()} ${getTick}`
                                        : `Sold ${lastQuery}`)
                                    : (giveQty != null && getQty != null
                                        ? `Bought ${Number(getQty).toLocaleString()} ${lastQuery} for ${Number(giveQty).toLocaleString()} ${giveTick}`
                                        : `Bought ${lastQuery}`);
                                const key = row.action_index || row.actionIndex || row.tx_hash || `${chainId}:${i}`;
                                return (
                                    <li key={String(key)}>
                                        <div className={styles.row}>
                                            <TickerIcon chainId={chainId} tick={lastQuery} size={32} />
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
