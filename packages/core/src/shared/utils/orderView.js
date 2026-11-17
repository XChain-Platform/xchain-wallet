// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What My Orders and the Order detail page both read off an ORDER row: its
// side labels, its lifecycle status and its expiry. One module so the list
// and the detail can never disagree about whether an order is open.

import {
    compareDecimalStrings,
    decimalQuotientFloor,
    divideDecimalStrings,
    formatDecimalAmount,
    multiplyDecimalStrings,
    subtractDecimalStrings,
    trimAmountTail,
} from './amountFormat.js';
import { formatLocalDateTime } from './dateTime.js';

export function extractRows(resp) {
    let rows = [];
    if (Array.isArray(resp)) rows = resp;
    else if (Array.isArray(resp?.data)) rows = resp.data;
    else if (Array.isArray(resp?.rows)) rows = resp.rows;
    else if (Array.isArray(resp?.orders)) rows = resp.orders;
    // A null or scalar entry from the explorer would throw while reading a row field.
    return rows.filter((row) => row !== null && typeof row === 'object' && !Array.isArray(row));
}

export function detailText(value) {
    if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return '-';
    const text = String(value).trim();
    return !text || /^(?:undefined|null|nan)$/i.test(text) ? '-' : text;
}

// A side's human label: ownership, a token amount, or a native-coin amount
// (empty tick = the chain's native coin).
export function sideLabel(tick, coin, amount, ownership) {
    if (Number(ownership) === 1) return `ownership of ${detailText(tick)}`;
    const amountText = detailText(amount);
    const unitText = detailText(tick || coin);
    return amountText === '-' && unitText === '-' ? '-' : `${amountText} ${unitText}`;
}

export function isNativeGive(row) {
    return !row.give_tick || String(row.give_tick).length === 0;
}

export const ORDER_STATUS_LABELS = Object.freeze({
    open: 'Open',
    // A display status only: an open order with part of its give matched.
    partly: 'Partly filled',
    filled: 'Filled',
    // Display words only (operator 2026-11-14): the stored status stays
    // cancelling / cancelled; the short words keep the status column narrow.
    cancelling: 'Closing',
    cancelled: 'Closed',
    expiring: 'Expiring',
    expired: 'Expired',
    invalid: 'Invalid',
});

export function orderStatusLabel(status) {
    return ORDER_STATUS_LABELS[status] || 'Invalid';
}

// The lifecycle half of an order detail. `state.status` is the indexer's
// latest order status (open / cancelling / cancelled / expiring / expired /
// complete / filled) and `state.give_remaining` is the give amount net of settled
// matches, zeroed once the order is terminal. Null when the detail lacks
// the block, so the caller falls back to the feeds alone. The optional
// expiry_status records the chain-clock classification from the query flow.
export function fillStateOf(detail) {
    const state = detail && typeof detail === 'object' ? detail.state : null;
    if (!state || typeof state !== 'object') return null;
    return {
        status: String(state.status || ''),
        giveRemaining: state.give_remaining ?? null,
        expiration: state.expiration ?? null,
        ...(state.expiry_status != null ? { expiryStatus: state.expiry_status } : {}),
    };
}

export function deriveStatus(item, cancelledKeys, nowSec) {
    if (cancelledKeys.has(item.key)) return 'cancelled';
    if (String(item.row.status || 'valid') !== 'valid') return 'invalid';
    const fill = item.fill;
    if (fill) {
        if (fill.status === 'complete' || fill.status === 'filled') return 'filled';
        if (fill.status === 'cancelling') return 'cancelling';
        if (fill.status === 'cancelled') return 'cancelled';
        if (fill.status === 'expiring') return 'expiring';
        if (fill.status === 'expired') return 'expired';
        const remaining = compareDecimalStrings(fill.giveRemaining, '0');
        if (fill.status === 'open' && remaining !== null && remaining <= 0) return 'filled';
        if (fill.expiryStatus === 'expired') return 'expired';
        if (fill.expiryStatus != null) return 'open';
    }
    const exp = Number(fill?.expiration ?? item.row.expiration);
    if (Number.isFinite(exp) && exp > 0 && exp <= nowSec) return 'expired';
    return 'open';
}

// The give amount still on offer when an open order has been partly
// filled; null when nothing has filled or the detail did not say.
export function partialRemaining(item) {
    const fill = item.fill;
    if (!fill || fill.status !== 'open') return null;
    const aboveZero = compareDecimalStrings(fill.giveRemaining, '0');
    const belowTotal = compareDecimalStrings(fill.giveRemaining, item.row.give_amount);
    if (aboveZero !== 1 || belowTotal !== -1) return null;
    return String(fill.giveRemaining);
}

// Filled and remaining give amounts for the detail page, exact decimals.
// The indexer zeroes give_remaining once an order is terminal, so only a
// live order (open, or on its way to cancelled or expired) reads them off
// it; a filled order filled its whole give; a cancelled, expired or invalid
// one says neither, since its zero is not a fill. Null fields too for an
// ownership side or a detail with no remaining figure.
export function fillAmounts(item, status) {
    const row = item.row;
    const none = { filled: null, remaining: null };
    if (Number(row.give_ownership) === 1) return none;
    if (status === 'filled') {
        const whole = compareDecimalStrings(row.give_amount, '0') === null ? null : trimAmountTail(String(row.give_amount));
        return { filled: whole, remaining: whole == null ? null : '0' };
    }
    if (status !== 'open' && status !== 'cancelling' && status !== 'expiring') return none;
    const remaining = item.fill?.giveRemaining;
    if (remaining == null || compareDecimalStrings(remaining, '0') === null) return { filled: null, remaining: null };
    const filled = subtractDecimalStrings(row.give_amount, remaining);
    return {
        filled: filled == null ? null : trimAmountTail(filled),
        remaining: trimAmountTail(String(remaining)),
    };
}

// The price as "1 GIVE = x GET", from the order's own amounts; null for an
// ownership side or a zero amount.
export function priceText(row) {
    if (Number(row.give_ownership) === 1 || Number(row.get_ownership) === 1) return null;
    const ratio = divideDecimalStrings(row.get_amount, row.give_amount, 8);
    if (ratio == null) return null;
    const giveUnit = detailText(row.give_tick || row.give_coin);
    const getUnit = detailText(row.get_tick || row.get_coin);
    return `1 ${giveUnit} = ${trimAmountTail(ratio)} ${getUnit}`;
}

export function fmtDate(unixSec) {
    const n = Number(unixSec);
    // Protocol expirations are Unix seconds. A current millisecond timestamp
    // otherwise renders as a plausible date tens of thousands of years away.
    if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000_000) return null;
    return formatLocalDateTime(n);
}

// The status a row's ring caption and the detail chip show: the lifecycle
// status, except that an open order with part of its give matched reads as
// partly filled. The list filter and the actions keep the lifecycle status.
export function orderDisplayStatus(item, status) {
    return status === 'open' && item?.row && partialRemaining(item) != null ? 'partly' : status;
}

// How much of the order's give has filled, as a whole percent from 0 to 100,
// or null when the detail did not say. Built on fillAmounts, so the zero the
// indexer writes into a terminal order's give_remaining never reads as a
// full fill: a cancelled or expired order shows its share only while its
// state block still carries a live remaining figure.
export function fillPercent(item, status) {
    const row = item?.row;
    if (!row) return null;
    if (status === 'filled' || status === 'settled') return 100;
    let filled = fillAmounts(item, status).filled;
    const liveFill = item.fill && ['open', 'cancelling', 'expiring'].includes(item.fill.status);
    if (filled == null && (status === 'cancelled' || status === 'expired') && liveFill) {
        filled = fillAmounts(item, 'open').filled;
    }
    if (filled == null || compareDecimalStrings(row.give_amount, '0') !== 1) return null;
    // Exact decimal math, rounded down, so an order a hair short of full
    // never reads 100% and 57 of 100 never reads 56 through a float.
    const share = decimalQuotientFloor(multiplyDecimalStrings(filled, '100'), row.give_amount);
    const n = Number(share);
    if (share == null || !Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, n));
}

// The ring's colour and centre mark for a display status: a tick on a full
// green ring once filled or settled, a cross on a grey ring once cancelled,
// the share in amber while partly filled and in the accent while open, and
// the share on a grey ring for every other closed state.
export function fillRingLook(displayStatus) {
    switch (displayStatus) {
        case 'filled':
        case 'settled':
            return { tone: 'success', mark: 'tick' };
        case 'cancelled':
            return { tone: 'muted', mark: 'cross' };
        case 'partly':
            return { tone: 'warning', mark: null };
        case 'open':
            return { tone: 'accent', mark: null };
        default:
            return { tone: 'muted', mark: null };
    }
}

// One side as display text with its amount grouped ("1,000 XCHAIN"); an
// empty tick and coin is the chain's native coin, named by `nativeTick`.
export function sideAmountText(tick, coin, amount, ownership, nativeTick = '') {
    const unit = detailText(tick || coin || nativeTick);
    if (Number(ownership) === 1) return `ownership of ${unit}`;
    const raw = detailText(amount);
    // A side with neither an amount nor a unit of its own is unknown, not the native coin.
    if (raw === '-') return tick || coin ? unit : '-';
    const grouped = formatDecimalAmount(trimAmountTail(raw)) || raw;
    return unit === '-' ? grouped : `${grouped} ${unit}`;
}

// An order said as a trade: "Sell 1,000 XCHAIN for 0.004 BTC" when it gives
// a token for the native coin (or for another token), "Buy 5,000 PEPE for
// 0.02 BTC" when it gives the native coin or asks for a token name's
// ownership. `main` is the side the trade is about (what is sold or bought)
// and `counter` the side it is paid in; `base` and `quote` name the market
// pair the order trades on, quote last, the way the markets page opens it.
export function orderTerms(row, nativeTick = '') {
    const r = row && typeof row === 'object' ? row : {};
    const giveOwnership = Number(r.give_ownership) === 1;
    const getOwnership = Number(r.get_ownership) === 1;
    const giveNative = !r.give_tick && !giveOwnership;
    const getNative = !r.get_tick && !getOwnership;
    const buy = (giveNative && !getNative) || (getOwnership && !giveOwnership);
    const give = sideAmountText(r.give_tick, r.give_coin, r.give_amount, r.give_ownership, nativeTick);
    const get = sideAmountText(r.get_tick, r.get_coin, r.get_amount, r.get_ownership, nativeTick);
    const giveUnit = String(r.give_tick || r.give_coin || nativeTick || '');
    const getUnit = String(r.get_tick || r.get_coin || nativeTick || '');
    return {
        side: buy ? 'buy' : 'sell',
        main: buy ? get : give,
        counter: buy ? give : get,
        give,
        get,
        giveUnit,
        getUnit,
        base: buy ? getUnit : giveUnit,
        quote: buy ? giveUnit : getUnit,
        // A market trades token amounts; a token name's ownership has no book.
        hasMarket: !giveOwnership && !getOwnership && Boolean(giveUnit) && Boolean(getUnit) && giveUnit !== getUnit,
    };
}

// When the row was placed, as Unix seconds, from the feed's timestamp or
// block time; null when the row carries neither.
export function placedAt(row) {
    const n = Number(row?.timestamp ?? row?.block_time ?? row?.blockTime);
    return Number.isFinite(n) && n > 0 ? n : null;
}

// A transaction id cut to its first and last four characters ("a3f9...c21e").
export function shortHash(hash) {
    const text = typeof hash === 'string' ? hash.trim() : '';
    if (text.length <= 12) return text;
    return `${text.slice(0, 4)}…${text.slice(-4)}`;
}
