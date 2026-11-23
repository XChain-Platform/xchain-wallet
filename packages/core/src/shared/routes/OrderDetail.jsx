// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Order detail (operator 2026-11-13): one of the wallet's DEX orders, opened
// from its My Orders row, in the approved ring layout
// (wallet-orders-layout-1-ring). The header card is the large fill ring and
// the trade ("Selling 1,000 XCHAIN for 0.004 BTC") with its status; then the
// Actions | Details | Matches toggle (G102, G13), Actions first: Edit and
// Cancel while the order is open and owned, the market, the explorer and
// Copy transaction ID, one ActionList row each (G101). Details holds the
// native-coin auto-pay switch as a setting row and the facts; Matches holds
// the lifecycle timeline. Edit and Cancel open the edit-order and
// cancel-order routes (standard forms) where the host wires them, and draw
// the same form in place where it does not (My Orders' own detail).
//
// Reads are a fixed handful whatever the wallet holds: the wallet's
// addresses and the order's detail together, then the owner's cancels feed
// and, for a native-coin GIVE, the auto-pay records. Status comes from the
// same deriveStatus the list uses, over the same two signals, so a row and
// its detail never disagree about whether the order is open.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, Icon, ListPage, PageHeader, Screen, StatusMessage, Switch } from '@xchain-wallet/core/ui';
import { flows as flowsLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { copyText } from '../clipboard.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import { MarketLifecycleTimeline } from '../components/MarketLifecycleTimeline.jsx';
import { MobileAutopayNotice } from '../components/MobileAutopayNotice.jsx';
import {
    deriveStatus,
    detailText,
    extractRows,
    fillAmounts,
    fillStateOf,
    isNativeGive,
    orderTerms,
    shortHash,
    sideAmountText,
} from '../utils/orderView.js';
import { hasOrderCancelBroadcast, markOrderCancelBroadcast, orderKey } from '../utils/orderCancelMarks.js';
import { OrderActionPanel } from './OrderActionPanel.jsx';
import { OrderDetailBody, OrderHeader, OrderMatches } from './OrderDetailBody.jsx';
import { nativeTickFor } from './OrderRow.jsx';
import D from './OrderDetail.module.css';

const isActionIndex = (value) => /^[1-9]\d*$/.test(String(value ?? '').trim());

// The explorer answers one action as `[row]`, and its wrappers pass that on
// bare or as `{ data: row }` / `{ data: [row] }`; take the one row.
function orderRowOf(detail) {
    let row = detail;
    if (row && typeof row === 'object' && !Array.isArray(row) && row.data && typeof row.data === 'object') row = row.data;
    if (Array.isArray(row)) row = row[0];
    return row && typeof row === 'object' && !Array.isArray(row) ? row : null;
}

// The auto-pay records, after first binding any record placed before its
// order indexed to that order's index (what My Orders did before the toggle
// moved here). The toggle is best-effort UI, so a failed read only hides it.
async function readAutopayRecords(messaging, walletId) {
    if (typeof messaging.listAutopayOrders !== 'function') return null;
    if (typeof messaging.resolveAutopayIndexes === 'function') {
        await messaging.resolveAutopayIndexes({ walletId }).catch(() => {});
    }
    return messaging.listAutopayOrders({ walletId }).catch(() => null);
}

/**
 * Read one order and everything its detail page shows, in a fixed number of
 * reads. Resolves `{ item: null }` when the order is unknown or unreadable.
 *
 * @param {any} messaging
 * @param {{ walletId: string, accountId?: string, chainId: string, actionIndex: string, now?: number }} params
 * @returns {Promise<{ item: any, chainAddresses: any[], autopay: any | null }>}
 */
export async function loadOrderDetail(messaging, { walletId, accountId, chainId, actionIndex, now = Date.now() }) {
    const empty = { item: null, chainAddresses: [], autopay: null };
    if (!chainId || !isActionIndex(actionIndex) || typeof messaging?.getAddressesByChain !== 'function') return empty;
    const index = String(actionIndex).trim();
    const key = orderKey(chainId, index);

    if (flowsLib.isDemoWallet(walletId)) {
        // A demo wallet's orders are the bundled demo rows its first address owns.
        const chains = (await messaging.getAddressesByChain(walletId, accountId).catch(() => null)) || {};
        const addrs = chains[chainId] || [];
        const owner = addrs.find((a) => typeof a?.address === 'string' && a.address.length > 0);
        const row = owner
            ? flowsLib.synthesizeDemoOrders(chainId, owner.address, { now }).find((r) => String(r.action_index) === index)
            : null;
        if (!row) return empty;
        return {
            item: { chainId, owner, row, key, cancelledKeys: new Set(), fill: fillStateOf(row) },
            chainAddresses: addrs,
            autopay: null,
        };
    }
    if (typeof messaging.getOrderDetail !== 'function') return empty;

    const [chains, detail] = await Promise.all([
        messaging.getAddressesByChain(walletId, accountId),
        messaging.getOrderDetail({ chainId, actionIndex: index }),
    ]);
    const found = orderRowOf(detail);
    if (!found) return empty;
    const row = { ...found, action_index: found.action_index ?? index };
    const addrs = (chains || {})[chainId] || [];
    // Only an address of this wallet that placed the order can cancel or edit it.
    const owner = addrs.find((a) => typeof a?.address === 'string' && a.address === String(row.source ?? '')) || null;

    const [cancels, autopayRecords] = await Promise.all([
        owner && typeof messaging.getOrderCancelsForAddress === 'function'
            ? messaging.getOrderCancelsForAddress({ chainId, address: owner.address })
            : Promise.resolve(null),
        owner && isNativeGive(row) ? readAutopayRecords(messaging, walletId) : Promise.resolve(null),
    ]);
    // Only an applied cancel closes the order; a rejected attempt is listed too.
    const cancelledKeys = new Set();
    for (const c of extractRows(cancels)) {
        if (owner && String(c.source) === owner.address && String(c.status || 'valid') === 'valid') {
            cancelledKeys.add(orderKey(chainId, c.order_action_index));
        }
    }
    const autopay = (Array.isArray(autopayRecords) ? autopayRecords : [])
        .find((rec) => rec?.orderActionIndex != null && orderKey(rec.chainId, rec.orderActionIndex) === key) || null;
    return {
        item: { chainId, owner, row, key, cancelledKeys, fill: fillStateOf(row) },
        chainAddresses: addrs,
        autopay,
    };
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {() => void} props.onBack
 * @param {(chainId: string, tick1: string, tick2: string) => void} [props.onOpenMarket]
 *   opens the order's market, the shell's market navigation (as MarketsList
 *   calls it); a host that leaves it out shows no Open market row
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onEditOrder]
 *   opens the edit-order route; without it Edit draws the form in place
 * @param {(ref: { chainId: string, actionIndex: string }) => void} [props.onCancelOrder]
 *   opens the cancel-order route; without it Cancel draws the form in place
 */
export function OrderDetail({
    walletId, accountId, chainId, actionIndex, onBack, onOpenMarket, onEditOrder, onCancelOrder,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const { settings } = useSettings();
    const [data, setData] = useState(/** @type {{ item: any, chainAddresses: any[], autopay: any } | null} */ (null));
    const [activeAction, setActiveAction] = useState(/** @type {'cancel' | 'edit' | null} */ (null));
    // The Copy transaction ID row's brief "Copied" note, in place of its short id.
    const [copyNote, setCopyNote] = useState(/** @type {string | null} */ (null));
    const copyNoteTimer = useRef(/** @type {any} */ (null));
    useEffect(() => () => clearTimeout(copyNoteTimer.current), []);
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
    // Bumped when a cancel broadcasts, so the page re-renders as Cancelling from the mark.
    const [, setCancelMarkTick] = useState(0);
    const requestId = useRef(0);

    const load = useCallback(async () => {
        const id = ++requestId.current;
        try {
            const result = await loadOrderDetail(messaging, { walletId, accountId, chainId, actionIndex });
            if (id !== requestId.current) return;
            setNowSec(Math.floor(Date.now() / 1000));
            setData(result);
        } catch {
            // A failed read shows the plain not-found state: the reachability
            // banner reports network trouble once (G91).
            if (id !== requestId.current) return;
            setData({ item: null, chainAddresses: [], autopay: null });
        }
    }, [messaging, walletId, accountId, chainId, actionIndex]);

    useEffect(() => {
        load();
        return () => { requestId.current += 1; };
    }, [load]);

    async function toggleAutopay(record) {
        if (typeof messaging?.setAutopayEnabled !== 'function') return;
        await messaging.setAutopayEnabled({ id: record.id, enabled: record.autopay !== true }).catch(() => {});
        const records = typeof messaging.listAutopayOrders === 'function'
            ? await messaging.listAutopayOrders({ walletId }).catch(() => null)
            : null;
        const next = (Array.isArray(records) ? records : []).find((rec) => rec?.id === record.id);
        setData((current) => (current ? { ...current, autopay: next || current.autopay } : current));
    }

    const header = <PageHeader onBack={onBack} title="Order Detail" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
        </Screen>
    );

    if (data === null) return wrap(<StatusMessage variant="status">Loading order…</StatusMessage>);
    const { item, chainAddresses, autopay } = data;
    if (!item) return wrap(<EmptyState title="Order not found" body="It may not be indexed yet." />);

    const derived = deriveStatus(item, item.cancelledKeys, nowSec);
    const status = derived === 'open' && hasOrderCancelBroadcast(messaging, item.key) ? 'cancelling' : derived;
    const canAct = status === 'open' && Boolean(item.owner);

    // Only an open order offers the actions, but an open form stays up until
    // it is done: a broadcast cancel turns the order Cancelling under it, and
    // the form still has its result to show.
    if (activeAction && item.owner) {
        return (
            <OrderActionPanel
                type={activeAction}
                item={item}
                chainAddresses={chainAddresses}
                variant={variant}
                walletId={walletId}
                messaging={messaging}
                onDone={() => { setActiveAction(null); load(); }}
                onCancelBroadcast={() => {
                    markOrderCancelBroadcast(messaging, item.key);
                    setCancelMarkTick((n) => n + 1);
                }}
                onBack={() => setActiveAction(null)}
            />
        );
    }

    const txHash = typeof item.row.tx_hash === 'string' && item.row.tx_hash.trim() ? item.row.tx_hash.trim() : null;
    const explorerUrl = txHash
        ? explorerPageUrl({ chainId: item.chainId, kind: 'transaction', value: txHash, settings })
        : null;
    const terms = orderTerms(item.row, nativeTickFor(item.chainId));
    const canOpenMarket = typeof onOpenMarket === 'function' && terms.hasMarket;

    // Edit and Cancel open their own routes where the host has them.
    const orderRef = { chainId: item.chainId, actionIndex: String(item.row.action_index) };
    const openAction = (type) => {
        const route = type === 'edit' ? onEditOrder : onCancelOrder;
        if (typeof route === 'function') route(orderRef); else setActiveAction(type);
    };

    async function copyTxHash() {
        const { ok } = await copyText(txHash);
        setCopyNote(ok ? 'Copied' : 'Copy failed: the clipboard is unavailable');
        clearTimeout(copyNoteTimer.current);
        copyNoteTimer.current = setTimeout(() => setCopyNote(null), 1500);
    }

    // Every action this order allows, one row each (G101). Edit and Cancel
    // show only while the order is open and this wallet owns it; a closed or
    // foreign order leaves them out rather than showing them disabled.
    const actionRows = [
        canAct ? (
            <ActionListItem
                key="edit"
                icon={<Icon.PencilIcon />}
                title="Edit order"
                description="Change the expiry or the allow and block lists"
                onClick={() => openAction('edit')}
            />
        ) : null,
        canOpenMarket ? (
            <ActionListItem
                key="market"
                icon={<Icon.SwapIcon />}
                title={`Open the ${terms.base} / ${terms.quote} market`}
                description="See the book and trade"
                onClick={() => onOpenMarket(item.chainId, terms.base, terms.quote)}
            />
        ) : null,
        explorerUrl ? (
            <ActionListItem
                key="explorer"
                icon={<Icon.ExternalLinkIcon />}
                title="View on the explorer"
                description="The order's transaction"
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
            />
        ) : null,
        txHash ? (
            <ActionListItem
                key="copy"
                icon={<Icon.CopyIcon />}
                title="Copy transaction ID"
                description={copyNote || shortHash(txHash)}
                onClick={copyTxHash}
                chevron={false}
            />
        ) : null,
        canAct ? (
            <ActionListItem
                key="cancel"
                icon={<Icon.XIcon />}
                title="Cancel order"
                description={cancelDescription(item, status, terms)}
                tone="danger"
                onClick={() => openAction('cancel')}
            />
        ) : null,
    ].filter(Boolean);
    const actionList = actionRows.length > 0 ? <ActionList label="Order actions">{actionRows}</ActionList> : null;

    const details = (
        <OrderDetailBody
            item={item}
            status={status}
            explorerUrl={explorerUrl}
            // The auto-pay switch moved here from My Orders; it heads Details as a setting row.
            setting={autopay && isNativeGive(item.row) ? (
                <>
                    <Switch
                        label={`Auto-pay ${autopay.autopay === true ? 'on' : 'off (notify-only)'}`}
                        help="On, this wallet sends the coin payment for a match on this order before its payment window closes. Off, it only notifies you so you can pay by hand."
                        checked={autopay.autopay === true}
                        onChange={() => toggleAutopay(autopay)}
                    />
                    <MobileAutopayNotice />
                </>
            ) : null}
        />
    );
    // The matches (the lifecycle timeline) read only once their tab is chosen.
    const matches = item.owner ? (
        <OrderMatches>
            <MarketLifecycleTimeline
                messaging={messaging}
                kind="order"
                chainId={item.chainId}
                address={item.owner.address}
                actionIndex={item.row.action_index}
                createdBlock={item.row.block_index}
            />
        </OrderMatches>
    ) : null;

    return wrap(
        <div className={D.page}>
            <OrderHeader item={item} status={status} />
            {/* More than one action: the Actions | Details | Matches toggle, Actions first (G102). */}
            {actionRows.length > 1 ? (
                <ActionsDetailsToggle actions={actionList} details={details} matches={matches} />
            ) : (
                <>
                    {actionList}
                    {details}
                    {matches}
                </>
            )}
        </div>,
    );
}

// What Cancel gives back: a token give is escrowed, so the rest of it
// returns; a native-coin give is never escrowed (it is paid on a match), so
// cancelling only takes the order off the book.
function cancelDescription(item, status, terms) {
    const row = item.row;
    if (isNativeGive(row) && Number(row.give_ownership) !== 1) return 'Takes the order off the book';
    if (Number(row.give_ownership) === 1) return `Returns the ${terms.give} still escrowed`;
    const { remaining } = fillAmounts(item, status);
    const rest = remaining ?? (item.fill ? null : row.give_amount);
    const unit = terms.giveUnit;
    if (rest == null || detailText(rest) === '-') return `Returns the ${unit} still escrowed`;
    return `Returns the ${sideAmountText(row.give_tick, row.give_coin, rest, 0)} still escrowed`;
}
