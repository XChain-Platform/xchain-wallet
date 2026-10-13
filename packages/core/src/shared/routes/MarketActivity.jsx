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
import { Button, EmptyState, Icon, ListPage, PageHeader, Screen, SectionHeader, Skeleton, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { useOracleFeeds } from '../hooks/useOracleFeeds.js';
import {
    dispenserRateLabel,
    enrichOfferRows,
    formatDecimal,
    isCompleteSwap,
    isDispenserPriceStale,
    isOpenDispenserSelling,
    isOpenOffer,
    offerAmounts,
} from '../utils/dispenserPricing.js';
import styles from './MarketActivity.module.css';
import { formatWithThousands } from '../utils/amountFormat.js';
import { actionRowIdentity, uniqueRows } from '../utils/pagedRows.js';

const chainRegistry = registryLib.defaultRegistry();
const ACTIVITY_PAGE_SIZE = 50;

// Featured market shown on landing (same for everyone, independent of
// holdings): XChain's own token. Tapping the header swaps it for any
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
 * §41/§42: Marketplace.
 *
 * Mirrors the Decentralized Exchange shape: you land on a pre-selected
 * market (the featured XChain token) and tap the token header to pull up
 * the full coin/token list (the shared {@link TokenPicker}) and switch
 * which market you're viewing. For the selected token it surfaces both
 * trading venues across every supported chain: fixed-price dispensers
 * and the DEX, with open offers/orders and recent fills.
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

    // Live registry read (re-rendered on every descriptor mutation), so a
    // synced chain reaches the market picker without a restart.
    const supportedChains = useSupportedChains(chainRegistry);
    const chains = useMemo(() => supportedChains.map((d) => d.id), [supportedChains]);
    // A representative chain for the featured-token icon (prefer Bitcoin).
    const defaultChainId = useMemo(
        () => chains.find((id) => coinFromChainId(id) === 'bitcoin') || chains[0] || null,
        [chains],
    );

    const [selected, setSelected] = useState(FEATURED_MARKET);
    const [picking, setPicking] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [reload, setReload] = useState(0);
    const [offers, setOffers] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [sales, setSales] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexOrders, setDexOrders] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexSwaps, setDexSwaps] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [visibleCounts, setVisibleCounts] = useState({
        offers: ACTIVITY_PAGE_SIZE,
        orders: ACTIVITY_PAGE_SIZE,
        sales: ACTIVITY_PAGE_SIZE,
        swaps: ACTIVITY_PAGE_SIZE,
    });

    const tick = (selected.tick || '').toUpperCase();

    // Load the selected market on landing and whenever the user picks a
    // different coin/token. Demo wallets are served fabricated feeds; real
    // wallets fan out across every supported chain in parallel.
    useEffect(() => {
        if (!tick) return undefined;
        let cancelled = false;
        setLoading(true);
        setLoadError(false);
        setOffers(null);
        setSales(null);
        setDexOrders(null);
        setDexSwaps(null);
        setVisibleCounts({
            offers: ACTIVITY_PAGE_SIZE,
            orders: ACTIVITY_PAGE_SIZE,
            sales: ACTIVITY_PAGE_SIZE,
            swaps: ACTIVITY_PAGE_SIZE,
        });

        if (walletId && flowsLib.isDemoWallet(walletId)) {
            const demo = flowsLib.synthesizeDemoMarketActivity(tick);
            if (!cancelled) {
                setOffers(uniqueRows(demo.offers, marketRowIdentity));
                setSales(uniqueRows(demo.sales, marketRowIdentity));
                setDexOrders(uniqueRows(demo.dexOrders, marketRowIdentity));
                setDexSwaps(uniqueRows(demo.dexSwaps, marketRowIdentity));
                setLoading(false);
            }
            return () => { cancelled = true; };
        }

        let failed = false;
        const markFailed = () => {
            failed = true;
            return [];
        };
        const offersByChain = chains.map((cid) =>
            messaging.getDispensersForToken({ chainId: cid, token: tick })
                // The explorer's status is a string label ('valid'), which
                // Number() made NaN, so a numeric test here dropped every row.
                .then((resp) => extractRows(resp)
                    .filter((d) => isOpenDispenserSelling(d, tick))
                    .map((row) => ({ chainId: cid, row })))
                .catch(markFailed),
        );
        const salesByChain = chains.map((cid) =>
            typeof messaging.getDispenses === 'function'
                ? messaging.getDispenses({ chainId: cid, query: tick, type: 'token' })
                    // A refused dispense (a barred payer, a dark oracle) moved
                    // nothing, so it is not a sale.
                    .then((resp) => extractRows(resp)
                        .filter((row) => flowsLib.dispenseIsValid(row))
                        .map((row) => ({ chainId: cid, row })))
                    .catch(markFailed)
                : Promise.resolve([]),
        );
        const ordersByChain = chains.map((cid) =>
            typeof messaging.getOrdersForToken === 'function'
                ? messaging.getOrdersForToken({ chainId: cid, tick })
                    .then(async (resp) => enrichOfferRows(extractRows(resp),
                        typeof messaging.getOrderDetail === 'function'
                            ? (row) => messaging.getOrderDetail({ chainId: cid, actionIndex: String(row.action_index) })
                            : null))
                    .then((rows) => rows.filter((row) => isOpenOffer(row))
                        .map((row) => ({ chainId: cid, row })))
                    .catch(markFailed)
                : Promise.resolve([]),
        );
        const swapsByChain = chains.map((cid) =>
            typeof messaging.getSwapsForToken === 'function'
                ? messaging.getSwapsForToken({ chainId: cid, tick })
                    .then(async (resp) => enrichOfferRows(extractRows(resp),
                        typeof messaging.getSwapDetail === 'function'
                            ? (row) => messaging.getSwapDetail({ chainId: cid, actionIndex: String(row.action_index) })
                            : null))
                    .then((rows) => rows.filter((row) => isCompleteSwap(row))
                        .map((row) => ({ chainId: cid, row })))
                    .catch(markFailed)
                : Promise.resolve([]),
        );

        Promise.all([
            Promise.all(offersByChain),
            Promise.all(salesByChain),
            Promise.all(ordersByChain),
            Promise.all(swapsByChain),
        ]).then(([offersBatches, salesBatches, ordersBatches, swapsBatches]) => {
            if (cancelled) return;
            setOffers(uniqueRows(offersBatches.flat(), marketRowIdentity));
            setSales(uniqueRows(salesBatches.flat().sort(byTimeDesc), marketRowIdentity));
            setDexOrders(uniqueRows(ordersBatches.flat(), marketRowIdentity));
            setDexSwaps(uniqueRows(swapsBatches.flat().sort(byTimeDesc), marketRowIdentity));
            setLoadError(failed);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [tick, walletId, messaging, chains, reload]);

    // A Mode B offer carries no price on this lane; it comes from its oracle.
    const oracleFeedsFor = useOracleFeeds(messaging, offers);

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
        <PageHeader
            onBack={onBack}
            backLabel="Back"
            title="Marketplace"
            titleIcon={<Icon.MarketIcon />}
        />
    );

    const iconChainId = selected.chainId || defaultChainId;
    const marketSelector = (
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
    );

    return (
        <Screen variant={variant} header={header}>
            <ListPage toolbar={marketSelector}>
                {loading && offers === null ? (
                    <div className={styles.list} role="status" aria-label="Loading marketplace activity">
                        <Skeleton height={56} />
                        <Skeleton height={56} />
                        <Skeleton height={56} />
                    </div>
                ) : null}

                {loadError ? (
                    <StatusMessage
                        variant="error"
                        recovery={{ label: 'Try again', onAction: () => setReload((value) => value + 1) }}
                    >
                        Some marketplace activity could not be loaded.
                    </StatusMessage>
                ) : null}

                {offers !== null ? (
                    <section className={styles.section} aria-label="Open dispensers">
                        <SectionHeader
                            as="h2"
                            title={(
                                <>
                                    Open dispensers <span className={styles.count}>{offers.length}</span>
                                </>
                            )}
                        />
                        {offers.length === 0 ? (
                            loadError ? null : <EmptyState title="No open dispensers" body={<>Open dispensers selling {tick} appear here.</>} titleAs="p" />
                        ) : (
                            <ul className={styles.list} role="list">
                                {offers.slice(0, visibleCounts.offers).map(({ chainId, row }, index) => {
                                    // Explorer fields: GIVE_AMOUNT per fill, GET_AMOUNT
                                    // (0 on a fiat-priced one), live escrow_remaining.
                                    const remaining = flowsLib.dispenserLiveState(row).giveRemaining;
                                    const actionIndex = row.action_index || row.actionIndex || row.tx_hash || row.id;
                                    const onClick = typeof onOpenDispenser === 'function' && actionIndex
                                        ? () => onOpenDispenser(chainId, actionIndex)
                                        : undefined;
                                    const content = (
                                        <>
                                            <TickerIcon chainId={chainId} tick={tick} size={32} />
                                            <span className={styles.rowText}>
                                                <span className={styles.rowTitle}>
                                                    {isDispenserPriceStale(row)
                                                        ? dispenserRateLabel(row)
                                                        : row.give_amount
                                                            ? dispenserRateLabel(row, oracleFeedsFor(chainId, row))
                                                            : 'Open dispenser'}
                                                </span>
                                                <span className={styles.rowSub}>
                                                    {remaining != null ? `${formatDecimal(remaining)} ${tick} remaining` : ''}
                                                </span>
                                            </span>
                                            {onClick ? <Icon.ForwardIcon /> : null}
                                        </>
                                    );
                                    return (
                                        <li key={marketRowIdentity({ chainId, row }) || `offer:${index}`}>
                                            {onClick ? (
                                                <button type="button" className={styles.row} onClick={onClick}>
                                                    {content}
                                                </button>
                                            ) : <div className={styles.row}>{content}</div>}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        {offers.length > visibleCounts.offers ? (
                            <LoadMoreActivity onClick={() => setVisibleCounts((counts) => ({
                                ...counts,
                                offers: counts.offers + ACTIVITY_PAGE_SIZE,
                            }))} label="Load more open dispensers" />
                        ) : null}
                    </section>
                ) : null}

                {dexOrders !== null ? (
                    <section className={styles.section} aria-label="Open DEX orders">
                        <SectionHeader
                            as="h2"
                            title={(
                                <>
                                    Open DEX orders <span className={styles.count}>{dexOrders.length}</span>
                                </>
                            )}
                        />
                        {dexOrders.length === 0 ? (
                            loadError ? null : <EmptyState title="No open DEX orders" body={<>Open orders involving {tick} appear here.</>} titleAs="p" />
                        ) : (
                            <ul className={styles.list} role="list">
                                {dexOrders.slice(0, visibleCounts.orders).map(({ chainId, row }, i) => {
                                    const giveTick = row.give_tick || row.give_coin || row.giveTick || row.giveCoin || '';
                                    const getTick = row.get_tick || row.get_coin || row.getTick || row.getCoin || '';
                                    const { give: giveQty, get: getQty } = offerAmounts(row);
                                    const isSell = giveTick.toUpperCase() === tick;
                                    const title = isSell
                                        ? (giveQty != null && getQty != null
                                            ? `Sell ${formatWithThousands(giveQty)} ${tick} for ${formatWithThousands(getQty)} ${getTick}`
                                            : `Sell ${tick}`)
                                        : (giveQty != null && getQty != null
                                            ? `Buy ${formatWithThousands(getQty)} ${tick} for ${formatWithThousands(giveQty)} ${giveTick}`
                                            : `Buy ${tick}`);
                                    return (
                                        <li key={marketRowIdentity({ chainId, row }) || `order:${i}`}>
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
                        {dexOrders.length > visibleCounts.orders ? (
                            <LoadMoreActivity onClick={() => setVisibleCounts((counts) => ({
                                ...counts,
                                orders: counts.orders + ACTIVITY_PAGE_SIZE,
                            }))} label="Load more DEX orders" />
                        ) : null}
                    </section>
                ) : null}

                {sales !== null ? (
                    <section className={styles.section} aria-label="Recent dispenses">
                        <SectionHeader
                            as="h2"
                            title={(
                                <>
                                    Recent dispenses <span className={styles.count}>{sales.length}</span>
                                </>
                            )}
                        />
                        {sales.length === 0 ? (
                            loadError ? null : <EmptyState title="No recent dispenses" body={<>Recent dispenses of {tick} appear here.</>} titleAs="p" />
                        ) : (
                            <ul className={styles.list} role="list">
                                {sales.slice(0, visibleCounts.sales).map(({ chainId, row }, i) => {
                                    // A dispense row's GET_AMOUNT is what the buyer actually
                                    // paid, so it is right even for a fiat-priced dispenser.
                                    const give = row.give_amount;
                                    const soldTick = row.give_tick || tick;
                                    const payAsset = row.get_tick || row.get_coin || '';
                                    const get = row.get_amount;
                                    const ts = Number(row.timestamp || row.block_time || 0);
                                    const dateLabel = ts > 0
                                        ? new Date(ts * (ts > 1e12 ? 1 : 1000)).toLocaleString()
                                        : '';
                                    return (
                                        <li key={marketRowIdentity({ chainId, row }) || `sale:${i}`}>
                                            <div className={styles.row}>
                                                <TickerIcon chainId={chainId} tick={tick} size={32} />
                                                <span className={styles.rowText}>
                                                    <span className={styles.rowTitle}>
                                                        {give ? `Sold ${formatDecimal(give)} ${soldTick}` : `Sold ${soldTick}`}
                                                        {give && Number(get) > 0 && payAsset ? ` for ${formatDecimal(get)} ${payAsset}` : ''}
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
                        {sales.length > visibleCounts.sales ? (
                            <LoadMoreActivity onClick={() => setVisibleCounts((counts) => ({
                                ...counts,
                                sales: counts.sales + ACTIVITY_PAGE_SIZE,
                            }))} label="Load more recent dispenses" />
                        ) : null}
                    </section>
                ) : null}

                {dexSwaps !== null ? (
                    <section className={styles.section} aria-label="Recent DEX swaps">
                        <SectionHeader
                            as="h2"
                            title={(
                                <>
                                    Recent DEX swaps <span className={styles.count}>{dexSwaps.length}</span>
                                </>
                            )}
                        />
                        {dexSwaps.length === 0 ? (
                            loadError ? null : <EmptyState title="No recent DEX swaps" body={<>Recent swaps involving {tick} appear here.</>} titleAs="p" />
                        ) : (
                            <ul className={styles.list} role="list">
                                {dexSwaps.slice(0, visibleCounts.swaps).map(({ chainId, row }, i) => {
                                    const giveTick = row.give_tick || row.give_coin || row.giveTick || row.giveCoin || '';
                                    const getTick = row.get_tick || row.get_coin || row.getTick || row.getCoin || '';
                                    const giveQty = row.give_amount ?? row.giveAmount ?? null;
                                    const getQty = row.get_amount ?? row.getAmount ?? null;
                                    const ts = Number(row.timestamp || row.block_time || 0);
                                    const dateLabel = ts > 0
                                        ? new Date(ts * (ts > 1e12 ? 1 : 1000)).toLocaleString()
                                        : '';
                                    const isSell = giveTick.toUpperCase() === tick;
                                    const title = isSell
                                        ? (giveQty != null && getQty != null
                                            ? `Sold ${formatWithThousands(giveQty)} ${tick} for ${formatWithThousands(getQty)} ${getTick}`
                                            : `Sold ${tick}`)
                                        : (giveQty != null && getQty != null
                                            ? `Bought ${formatWithThousands(getQty)} ${tick} for ${formatWithThousands(giveQty)} ${giveTick}`
                                            : `Bought ${tick}`);
                                    return (
                                        <li key={marketRowIdentity({ chainId, row }) || `swap:${i}`}>
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
                        {dexSwaps.length > visibleCounts.swaps ? (
                            <LoadMoreActivity onClick={() => setVisibleCounts((counts) => ({
                                ...counts,
                                swaps: counts.swaps + ACTIVITY_PAGE_SIZE,
                            }))} label="Load more recent DEX swaps" />
                        ) : null}
                    </section>
                ) : null}
            </ListPage>
        </Screen>
    );
}

function LoadMoreActivity({ onClick, label }) {
    return (
        <Button type="button" variant="secondary" onClick={onClick} aria-label={label}>
            {label}
        </Button>
    );
}

function marketRowIdentity(entry) {
    const identity = actionRowIdentity(entry?.row);
    return identity == null ? null : `${entry.chainId}:${identity}`;
}
