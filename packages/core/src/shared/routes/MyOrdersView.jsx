// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MyOrdersView (PC-17): the unified, cross-pair "My orders" surface. It
// lists every ORDER the wallet placed (as SOURCE) across all chains and
// addresses - including native-coin pairs, which the per-market
// OpenOrdersPanel silently drops - as one plain list, newest first, each
// row carrying its status chip (operator 2026-11-13: no Open / Closed split).
// Every row opens the order's detail page (OrderDetail), which holds Cancel
// (ORDER v1), Edit (ORDER v2), the PC-16 auto-pay toggle for native-coin
// GIVE orders and the lifecycle timeline.
//
// Status derivation: the list feed (getOrdersForAddress) carries only the
// action-VALIDITY status, and a single order's getAction(...).state.status
// does NOT promptly reflect a cancel, so "cancelled" is read from the
// authoritative + immediate order_cancels table (getOrderCancelsForAddress)
// and "expired" from the order's own EXPIRATION vs the current indexed
// chain clock. Neither feed carries fills, so every order those two leave
// open is read once
// through orders.detail, whose `state` block nets settled matches out of
// give_remaining and reports `complete` or `filled` once the order is fully filled.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, PageHeader, Screen, Select, Skeleton } from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
// The standard list filter, on the title line.
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { deriveStatus, extractRows, fillStateOf, orderStatusLabel, sideAmountText, sideLabel } from '../utils/orderView.js';
import { hasOrderCancelBroadcast, orderKey } from '../utils/orderCancelMarks.js';
import { OrderRow } from './OrderRow.jsx';
import { OrderDetail } from './OrderDetail.jsx';
import L from './ObligationsView.module.css';

// The status helpers moved to utils/orderView.js; tests and callers still
// import them from here.
export { deriveStatus, fillStateOf } from '../utils/orderView.js';

// How many orders.detail reads are in flight at once while the open
// subset is enriched; the whole batch is still one wait.
const FILL_READ_CONCURRENCY = 6;

// The filter's Status choices; a transitional status files with the one it
// becomes (Cancelling with Cancelled, Expiring with Expired).
const STATUS_GROUP = Object.freeze({
    open: 'open',
    filled: 'filled',
    cancelling: 'cancelled',
    cancelled: 'cancelled',
    expiring: 'expired',
    expired: 'expired',
});

// The list feed hydrates each row with its detail's `state` block when the
// chain clock is current, so a row that carries a lifecycle status already
// holds what orders.detail would return.
function hydratedFillState(row) {
    const status = row?.state?.status;
    return typeof status === 'string' && status.trim() ? fillStateOf(row) : null;
}

// Return key -> fill state for the open candidates: a hydrated row's own
// state, otherwise its detail read a few at a time. A failed or shapeless
// read leaves the order as the feeds saw it rather than failing the whole list.
async function readFillStates(messaging, candidates) {
    const fills = new Map();
    const unread = [];
    for (const it of candidates) {
        const own = hydratedFillState(it.row);
        if (own) fills.set(it.key, own);
        else unread.push(it);
    }
    if (typeof messaging?.getOrderDetail !== 'function') return fills;
    for (let i = 0; i < unread.length; i += FILL_READ_CONCURRENCY) {
        const slice = unread.slice(i, i + FILL_READ_CONCURRENCY);
        const details = await Promise.all(slice.map((it) => messaging
            .getOrderDetail({ chainId: it.chainId, actionIndex: String(it.row.action_index) })
            .catch(() => null)));
        slice.forEach((it, j) => {
            const fill = fillStateOf(details[j]);
            if (fill) fills.set(it.key, fill);
        });
    }
    return fills;
}

// The list items for a demo wallet: the bundled demo orders, owned by the
// first address on each chain, each with its hydrated fill state.
function demoOrderItems(chains, nowMs) {
    const items = [];
    for (const [chainId, addrs] of Object.entries(chains || {})) {
        const owner = (addrs || []).find((a) => typeof a?.address === 'string' && a.address.length > 0);
        if (!owner) continue;
        for (const row of flowsLib.synthesizeDemoOrders(chainId, owner.address, { now: nowMs })) {
            const key = orderKey(chainId, row.action_index);
            items.push({ chainId, owner, row, key, cancelled: false, cancelledKeys: new Set(), fill: fillStateOf(row) });
        }
    }
    items.sort((a, b) => Number(b.row.action_index || 0) - Number(a.row.action_index || 0));
    return items;
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onCreateOrder]
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onOpenOrder]
 *   opens the order-detail route; a host without that route leaves it out
 *   and the detail opens in place
 * @param {(chainId: string, tick1: string, tick2: string) => void} [props.onOpenMarket]
 *   the shell's market navigation, handed to the in-place order detail
 */
export function MyOrdersView({ walletId, accountId, onBack, onCreateOrder, onOpenOrder, onOpenMarket }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [items, setItems] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    // The order the in-place detail shows, when no host route opens it.
    const [openRef, setOpenRef] = useState(/** @type {{ chainId: string, actionIndex: string } | null} */ (null));
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
    // The title-line filter's state (search text, Status and Sort).
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortBy, setSortBy] = useState('newest');
    const loadRequestId = useRef(0);

    useEffect(() => {
        const current = Math.floor(Date.now() / 1000);
        setNowSec(current);
        const hasLiveExpiration = () => (items || []).some((item) => {
            const expiration = Number(item.fill?.expiration ?? item.row?.expiration);
            return Number.isFinite(expiration) && expiration > Math.floor(Date.now() / 1000);
        });
        if (!hasLiveExpiration()) return undefined;
        const t = setInterval(() => {
            setNowSec(Math.floor(Date.now() / 1000));
            if (!hasLiveExpiration()) clearInterval(t);
        }, 30000);
        return () => clearInterval(t);
    }, [items]);

    const load = useCallback(async () => {
        const requestId = ++loadRequestId.current;
        if (flowsLib.isDemoWallet(walletId)) {
            // A demo wallet has no explorer history; it lists the bundled
            // demo orders owned by its first address on each chain.
            const chains = typeof messaging?.getAddressesByChain === 'function'
                ? ((await messaging.getAddressesByChain(walletId, accountId).catch(() => null)) || {})
                : {};
            if (requestId !== loadRequestId.current) return;
            setItems(demoOrderItems(chains, Date.now()));
            setLoadError(null);
            return;
        }
        if (typeof messaging?.getAddressesByChain !== 'function'
            || typeof messaging?.getOrdersForAddress !== 'function') {
            setItems([]); return;
        }
        setItems(null);
        setLoadError(null);
        try {
            const chains = (await messaging.getAddressesByChain(walletId, accountId)) || {};
            if (requestId !== loadRequestId.current) return;
            const pairs = [];
            for (const [chainId, addrs] of Object.entries(chains)) {
                for (const a of addrs || []) pairs.push({ chainId, owner: a });
            }
            const results = await Promise.all(pairs.map((p) => Promise.all([
                messaging.getOrdersForAddress({ chainId: p.chainId, address: p.owner.address }),
                (typeof messaging.getOrderCancelsForAddress === 'function'
                    ? messaging.getOrderCancelsForAddress({ chainId: p.chainId, address: p.owner.address })
                    : Promise.resolve(null)),
            ]).then(([o, c]) => ({ p, orders: extractRows(o), cancels: extractRows(c) }))));
            if (requestId !== loadRequestId.current) return;

            // The cancels feed also lists rejected ORDER_CANCEL attempts (a
            // cancel sent against a filled order is recorded as invalid), and
            // only an applied cancel closes the order.
            const cancelledKeys = new Set();
            for (const r of results) {
                for (const c of r.cancels) {
                    if (String(c.source) === r.p.owner.address && String(c.status || 'valid') === 'valid') {
                        cancelledKeys.add(orderKey(r.p.chainId, c.order_action_index));
                    }
                }
            }
            const seen = new Set();
            const all = [];
            for (const r of results) {
                for (const o of r.orders) {
                    // Only orders this wallet placed (is the seller/SOURCE of); the
                    // feed also returns orders where the address is the get_address.
                    if (String(o.source) !== r.p.owner.address) continue;
                    const key = orderKey(r.p.chainId, o.action_index);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    all.push({ chainId: r.p.chainId, owner: r.p.owner, row: o, key });
                }
            }
            all.sort((a, b) => Number(b.row.action_index || 0) - Number(a.row.action_index || 0));
            for (const it of all) it.cancelled = cancelledKeys.has(it.key);
            // Read valid, uncancelled candidates before applying mutable expiration.
            const candidates = all.filter((it) => !cancelledKeys.has(it.key)
                && String(it.row.status || 'valid') === 'valid');
            const fills = await readFillStates(messaging, candidates);
            if (requestId !== loadRequestId.current) return;
            setItems(all.map((it) => ({ ...it, cancelledKeys, fill: fills.get(it.key) || null })));
            setLoadError(null);
        } catch {
            if (requestId !== loadRequestId.current) return;
            setLoadError('Could not load your orders. Try again.');
            setItems([]);
        }
    }, [messaging, walletId, accountId]);

    useEffect(() => {
        load();
        return () => { loadRequestId.current += 1; };
    }, [load]);

    // The title bar holds the filter and New order (plus) icons; the
    // page body is only the order list.
    const filterMenu = (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            active={statusFilter !== 'all' || sortBy !== 'newest'}
            label="Filter orders"
            searchPlaceholder="Search"
            searchLabel="Search orders"
        >
            {/* Filter-panel dropdowns carry no visible label; each option names itself. */}
            <Select
                aria-label="Status"
                size="md"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
            >
                <Select.Option value="all" icon={<Icon.ListIcon />}>All statuses</Select.Option>
                <Select.Option value="open" icon={<Icon.PlayIcon />}>Open</Select.Option>
                <Select.Option value="filled" icon={<Icon.CheckIcon />}>Filled</Select.Option>
                <Select.Option value="cancelled" icon={<Icon.XIcon />}>Closed</Select.Option>
                <Select.Option value="expired" icon={<Icon.HistoryIcon />}>Expired</Select.Option>
            </Select>
            <Select
                aria-label="Sort"
                size="md"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
            >
                <Select.Option value="newest" icon={<Icon.HistoryIcon />}>Newest first</Select.Option>
                <Select.Option value="oldest" icon={<Icon.ClockIcon />}>Oldest first</Select.Option>
                <Select.Option value="expiring" icon={<Icon.PauseIcon />}>Expiring soonest</Select.Option>
            </Select>
        </ListFilterMenu>
    );
    const header = (
        <PageHeader
            onBack={onBack}
            title="My Orders"
            trailing={(
                <>
                    {filterMenu}
                    {onCreateOrder ? (
                        <Button variant="secondary" icon={<Icon.PlusIcon />} aria-label="New order" title="New order" onClick={onCreateOrder}>
                            {null}
                        </Button>
                    ) : null}
                </>
            )}
        />
    );
    const wrap = (children, { notices } = {}) => (
        <Screen variant={variant} header={header}>
            <ListPage notices={notices}>
                {children}
            </ListPage>
        </Screen>
    );

    if (openRef) {
        return (
            <OrderDetail
                walletId={walletId}
                accountId={accountId}
                chainId={openRef.chainId}
                actionIndex={openRef.actionIndex}
                onBack={() => { setOpenRef(null); load(); }}
                onOpenMarket={onOpenMarket}
            />
        );
    }

    if (items === null) {
        return wrap(
            <div role="status" aria-label="Loading orders">
                <Skeleton.List rows={5} />
            </div>,
        );
    }
    // A failed read shows the plain empty state: the app's reachability
    // banner reports network trouble once, so no page adds its own error or
    // Try Again (G91).
    if (loadError || items.length === 0) {
        return wrap(
            <EmptyState
                title="No orders yet"
                body="Orders you place on the DEX show up here across every pair."
            />,
        );
    }

    // A cancel this session broadcast shows Cancelling until the feed lists it.
    const statusOf = (it) => {
        const status = deriveStatus(it, it.cancelledKeys, nowSec);
        return status === 'open' && hasOrderCancelBroadcast(messaging, it.key) ? 'cancelling' : status;
    };
    // The title-line filter narrows the list by search text and Status.
    const needle = query.trim().toLowerCase();
    const matches = (it) => {
        if (!needle) return true;
        const row = it.row;
        const hay = [
            sideLabel(row.give_tick, row.give_coin, row.give_amount, row.give_ownership),
            sideLabel(row.get_tick, row.get_coin, row.get_amount, row.get_ownership),
            // The rows show grouped amounts ("1,000"), so a search typed as shown matches too.
            sideAmountText(row.give_tick, row.give_coin, row.give_amount, row.give_ownership),
            sideAmountText(row.get_tick, row.get_coin, row.get_amount, row.get_ownership),
            row.action_index, it.owner.address, it.chainId, orderStatusLabel(statusOf(it)),
        ].join(' ').toLowerCase();
        return hay.includes(needle);
    };
    const inStatus = (it) => statusFilter === 'all' || STATUS_GROUP[statusOf(it)] === statusFilter;
    // Items arrive newest first (highest order ID); Sort reorders the list.
    const expiryOf = (it) => {
        const n = Number(it.fill?.expiration ?? it.row.expiration);
        return Number.isFinite(n) && n > 0 ? n : Infinity;
    };
    const sorted = [...items];
    if (sortBy === 'oldest') sorted.reverse();
    else if (sortBy === 'expiring') sorted.sort((a, b) => expiryOf(a) - expiryOf(b));
    const shown = sorted.filter((it) => matches(it) && inStatus(it));

    // A filter or search with no matches reads as one plain empty state.
    if (shown.length === 0) {
        return wrap(<EmptyState title="No matching orders" body="Change or clear the filter to see more." titleAs="p" />);
    }
    const open = (it) => {
        const ref = { chainId: it.chainId, actionIndex: String(it.row.action_index) };
        if (typeof onOpenOrder === 'function') onOpenOrder(ref);
        else setOpenRef(ref);
    };
    return wrap(
        /* Safari needs an explicit list role because this class removes list styling. */
        <ul className={L.list} role="list" aria-label="Orders">
            {shown.map((it) => (
                <li key={it.key} className={L.item} data-order-row={it.key}>
                    <OrderRow item={it} status={statusOf(it)} onOpen={() => open(it)} />
                </li>
            ))}
        </ul>,
    );
}
