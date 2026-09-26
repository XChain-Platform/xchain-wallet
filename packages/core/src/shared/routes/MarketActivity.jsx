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
import { Screen, PageHeader, Icon, Skeleton } from '@xchain-wallet/core/ui';
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

const chainRegistry = registryLib.defaultRegistry();

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
    const [offers, setOffers] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [sales, setSales] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexOrders, setDexOrders] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));
    const [dexSwaps, setDexSwaps] = useState(/** @type {Array<{chainId: string, row: any}> | null} */ (null));

    const tick = (selected.tick || '').toUpperCase();

    // Load the selected market on landing and whenever the user picks a
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
                // The explorer's status is a string label ('valid'), which
                // Number() made NaN, so a numeric test here dropped every row.
                .then((resp) => extractRows(resp)
                    .filter((d) => isOpenDispenserSelling(d, tick))
                    .map((row) => ({ chainId: cid, row })))
                .catch(() => []),
        );
        const salesByChain = chains.map((cid) =>
            typeof messaging.getDispenses === 'function'
                ? messaging.getDispenses({ chainId: cid, query: tick, type: 'token' })
                    // A refused dispense (a barred payer, a dark oracle) moved
                    // nothing, so it is not a sale.
                    .then((resp) => extractRows(resp)
                        .filter((row) => flowsLib.dispenseIsValid(row))
                        .map((row) => ({ chainId: cid, row })))
                    .catch(() => [])
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
                    .catch(() => [])
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
                                // Explorer fields: GIVE_AMOUNT per fill, GET_AMOUNT
                                // (0 on a fiat-priced one), live escrow_remaining.
                                const remaining = flowsLib.dispenserLiveState(row).giveRemaining;
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
                                    <li key={`${chainId}:${i}`}>
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
