// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Order detail page's pieces in the ring layout (operator 2026-11-13,
// wallet-orders-layout-1-ring): the header card (the large fill ring,
// "Selling" or "Buying", the big amount, what it is for and the status
// chip), the Details panel (an optional setting row, then the facts in one
// card) and the Matches section. Details draws its facts exactly as Swap
// Details does (SwapViews.module.css): one row element per fact with one
// divider, so a tall value never splits the line; Network shows its icon and
// name, From the whole address when it fits (G99), and no row carries a copy
// button. Split out of OrderDetail so the page's look can change without
// touching its loading or its actions.

import { AddressText, ChainBadge, Icon, SectionHeader } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { boundListIndex } from '../../flows/accessListSlots.js';
import { TradeHeader } from '../components/TradeHeader.jsx';
import { formatActivityTime } from '../utils/dateTime.js';
import { divideDecimalStrings, formatDecimalAmount, trimAmountTail } from '../utils/amountFormat.js';
import {
    detailText,
    fillAmounts,
    fmtDate,
    orderDisplayStatus,
    orderTerms,
    placedAt,
    shortHash,
} from '../utils/orderView.js';
import { nativeTickFor, OrderFillRing, OrderStatusChip } from './OrderRow.jsx';
import V from '../components/SwapViews.module.css';
import D from './OrderDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();

// One fact: the label and its value in one row element, so the row has one divider.
function Fact({ label, children, testId }) {
    return (
        <div className={V.fact} data-testid={testId}>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

// A bound list as Swap Details words it: "List #2701" or "None".
const listText = (index) => (index ? `List #${index}` : 'None');

const grouped = (value) => formatDecimalAmount(trimAmountTail(String(value))) || String(value);

// The price as what one traded unit costs in the unit it is paid in
// ("0.000004 BTC each"); null for an ownership side or a zero amount.
function priceEach(row, terms) {
    if (!terms.hasMarket) return null;
    const buy = terms.side === 'buy';
    const ratio = buy
        ? divideDecimalStrings(row.give_amount, row.get_amount, 8)
        : divideDecimalStrings(row.get_amount, row.give_amount, 8);
    if (ratio == null) return null;
    return `${grouped(ratio)} ${terms.quote} each`;
}

/**
 * The detail header card.
 *
 * @param {{ item: any, status: string }} props
 */
export function OrderHeader({ item, status }) {
    if (!item?.row) return null;
    const terms = orderTerms(item.row, nativeTickFor(item.chainId));
    return (
        <TradeHeader
            label="Order"
            ring={<OrderFillRing item={item} status={status} size="lg" />}
            verb={terms.side === 'buy' ? 'Buying' : 'Selling'}
            amount={terms.main}
            counter={`for ${terms.counter}`}
            chip={<OrderStatusChip status={orderDisplayStatus(item, status)} />}
        />
    );
}

/**
 * The Details panel.
 *
 * @param {object} props
 * @param {{ chainId: string, owner: { address: string } | null, row: any, fill: any }} props.item
 * @param {string} props.status   the derived lifecycle status
 * @param {string | null} [props.explorerUrl]   the order transaction's explorer page
 * @param {import('react').ReactNode} [props.setting]   a setting row shown first (the auto-pay switch)
 */
export function OrderDetailBody({ item, status, explorerUrl = null, setting = null }) {
    // A route probe or a failed read can hand the body no order; draw nothing.
    if (!item?.row) return null;
    const { row } = item;
    const descriptor = chainRegistry.get(item.chainId);
    const terms = orderTerms(row, nativeTickFor(item.chainId));
    const giveUnit = detailText(terms.giveUnit);
    const price = priceEach(row, terms);
    const { filled, remaining } = fillAmounts(item, status);
    const giveWhole = detailText(row.give_amount) === '-' ? null : grouped(row.give_amount);
    const expires = fmtDate(item.fill?.expiration ?? row.expiration);
    const placed = placedAt(row);
    const allowList = boundListIndex(row.allow_list ?? row.allowList);
    const blockList = boundListIndex(row.block_list ?? row.blockList);
    const txHash = typeof row.tx_hash === 'string' && row.tx_hash.trim() ? row.tx_hash.trim() : null;
    const source = item.owner?.address || (typeof row.source === 'string' ? row.source : '');
    return (
        <div className={D.details}>
            {setting ? <div className={D.setting}>{setting}</div> : null}
            <dl className={V.facts} aria-label="Order details">
                {price ? <Fact label="Price">{price}</Fact> : null}
                {filled != null ? (
                    <Fact label="Filled">{giveWhole ? `${grouped(filled)} of ${giveWhole} ${giveUnit}` : `${grouped(filled)} ${giveUnit}`}</Fact>
                ) : null}
                {remaining != null ? <Fact label="Remaining">{`${grouped(remaining)} ${giveUnit}`}</Fact> : null}
                <Fact label="Expires">{expires || 'No expiration'}</Fact>
                {placed ? <Fact label="Placed">{formatActivityTime(placed)}</Fact> : null}
                <Fact label="Network" testId="order-detail-network">
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName /> : detailText(item.chainId)}
                </Fact>
                <Fact label="Order">#{detailText(row.action_index)}</Fact>
                {source ? (
                    <Fact label="From" testId="order-detail-from">
                        <span className={V.addressBox}><AddressText address={source} fit /></span>
                    </Fact>
                ) : null}
                <Fact label="Allow list">{listText(allowList)}</Fact>
                <Fact label="Block list">{listText(blockList)}</Fact>
                {row.memo ? <Fact label="Memo">{String(row.memo)}</Fact> : null}
                {txHash ? (
                    <Fact label="Transaction" testId="order-detail-transaction">
                        <code className={V.mono} title={txHash}>{shortHash(txHash)}</code>
                        {explorerUrl ? (
                            /* The kit has no link-button primitive for an external explorer destination. */
                            <a
                                className={V.txLink}
                                href={explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="View on the explorer"
                                title="View on the explorer"
                            >
                                <Icon.ExternalLinkIcon />
                            </a>
                        ) : null}
                    </Fact>
                ) : null}
            </dl>
        </div>
    );
}

/**
 * The Matches section: the order's lifecycle timeline under its heading,
 * the Matches tab's panel (or under Details on a page without the tabs).
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export function OrderMatches({ children }) {
    return (
        <section className={D.matches} aria-label="Matches">
            <SectionHeader title="Matches" />
            {children}
        </section>
    );
}
