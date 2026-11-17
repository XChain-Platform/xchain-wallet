// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One My Orders row and the order status chip, in the approved ring layout
// (operator 2026-11-13, wallet-orders-layout-1-ring): the pair's two token
// icons overlapped, the trade in words ("Sell 1,000 XCHAIN"), what it is
// for and when it was placed, then the fill ring with the status word under
// it in place of a status chip. The whole row is one button that opens the
// order's detail, so it holds no other control (Edit, Cancel, the matches
// and auto-pay live on the detail page).

import { ListRow } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { FillRing } from '../components/FillRing.jsx';
import { PairIcons } from '../components/PairIcons.jsx';
import { TradeRowMeta } from '../components/TradeHeader.jsx';
import { formatActivityTime } from '../utils/dateTime.js';
import {
    fillPercent,
    fillRingLook,
    orderDisplayStatus,
    orderStatusLabel,
    orderTerms,
    placedAt,
} from '../utils/orderView.js';
import L from './ObligationsView.module.css';

const chainRegistry = registryLib.defaultRegistry();

/** The chain's own coin ticker ("BTC"), which an order's empty tick stands for. */
export function nativeTickFor(chainId) {
    return tickerForDescriptor(chainRegistry.get(chainId)) || '';
}

/**
 * The status chip an order shows on its detail header. `status` may be the
 * display status, so a partly filled order reads Partly filled in amber.
 */
export function OrderStatusChip({ status }) {
    let tone = L.chipExpired;
    if (status === 'open' || status === 'filled') tone = L.chipOpen;
    else if (status === 'partly') tone = L.chipAtRisk;
    return <span className={`${L.chip} ${tone}`}>{orderStatusLabel(status)}</span>;
}

/** The word under a row's ring: the status, with Partly for a partly filled order. */
export function orderRingCaption(displayStatus) {
    return displayStatus === 'partly' ? 'Partly' : orderStatusLabel(displayStatus);
}

/**
 * The fill ring an order shows on its row (small, with the status word) and
 * its detail header (large).
 *
 * @param {{ item: any, status: string, size?: 'sm' | 'lg' }} props
 */
export function OrderFillRing({ item, status, size = 'sm' }) {
    const display = orderDisplayStatus(item, status);
    const percent = fillPercent(item, status);
    const { tone, mark } = fillRingLook(display);
    const word = orderRingCaption(display);
    return (
        <FillRing
            percent={percent}
            tone={tone}
            mark={mark}
            size={size}
            status={display}
            caption={size === 'sm' ? word : null}
            fitCaption
            label={percent == null ? word : `${percent}% filled`}
        />
    );
}

/**
 * @param {object} props
 * @param {{ chainId: string, owner: { address: string }, row: any, key: string, fill?: any }} props.item
 * @param {string} props.status   the derived lifecycle status
 * @param {() => void} props.onOpen
 */
export function OrderRow({ item, status, onOpen }) {
    // A route probe or a stale list can hand the row no order; draw nothing.
    if (!item?.row) return null;
    const { row } = item;
    const terms = orderTerms(row, nativeTickFor(item.chainId));
    const placed = placedAt(row);
    const when = placed ? formatActivityTime(placed) : '';
    // The list item around the row is MyOrdersView's, as My Swaps does it.
    return (
        <ListRow
            type="button"
            onClick={onOpen}
            chevron
            leading={<PairIcons chainId={item.chainId} first={terms.base} second={terms.quote} />}
            title={`${terms.side === 'buy' ? 'Buy' : 'Sell'} ${terms.main}`}
            subtitle={<TradeRowMeta parts={[`for ${terms.counter}`, when]} />}
            trailing={<OrderFillRing item={item} status={status} />}
            trailingClassName={L.ringSlot}
        />
    );
}
