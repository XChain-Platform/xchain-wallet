// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    compareDecimalStrings,
    divideDecimalStrings,
} from '../shared/utils/amountFormat.js';

/** Normalize one projected market fill while retaining raw-row compatibility. */
export function normalizeMarketHistoryRow(row, tick1, tick2) {
    const exact = normalizeMarketHistoryRowExact(row, tick1, tick2);
    if (!exact) return null;
    return {
        ...exact,
        price: Number(exact.price),
        amount: Number(exact.amount),
    };
}

/** Normalize one market fill while preserving exact decimal price and amount strings. */
export function normalizeMarketHistoryRowExact(row, tick1, tick2) {
    if (!row || typeof row !== 'object') return null;
    const price = String(row.price ?? '').trim();
    const amount = String(row.amount ?? '').trim();
    const side = String(row.type || '').toLowerCase();
    const timestamp = historyTimestamp(row);
    if (
        compareDecimalStrings(price, '0') === 1
        && compareDecimalStrings(amount, '0') === 1
        && (side === 'buy' || side === 'sell')
        && Number.isFinite(timestamp)
    ) {
        return historyResult(row, { price, amount, side, timestamp });
    }
    return normalizeRawMatchExact(row, tick1, tick2, timestamp);
}

function normalizeRawMatchExact(row, tick1, tick2, timestamp) {
    const giveTick = row.give_tick || row.giveTick;
    const getTick = row.get_tick || row.getTick;
    const giveAmount = String(row.give_amount ?? row.giveAmount ?? '');
    const getAmount = String(row.get_amount ?? row.getAmount ?? '');
    if (!giveTick || !getTick || !Number.isFinite(timestamp)) return null;
    if (compareDecimalStrings(giveAmount, '0') !== 1) return null;
    if (compareDecimalStrings(getAmount, '0') !== 1) return null;
    if (giveTick === tick1 && getTick === tick2) {
        return historyResult(row, {
            price: divideDecimalStrings(getAmount, giveAmount, 18),
            amount: giveAmount,
            side: 'sell',
            timestamp,
        });
    }
    if (giveTick === tick2 && getTick === tick1) {
        return historyResult(row, {
            price: divideDecimalStrings(giveAmount, getAmount, 18),
            amount: getAmount,
            side: 'buy',
            timestamp,
        });
    }
    return null;
}

function historyResult(row, values) {
    return {
        ...values,
        actionIndex: row.action_index ?? row.actionIndex ?? null,
        txHash: row.tx_hash ?? row.txHash ?? null,
    };
}

export function historyTimestamp(row) {
    if (Number.isFinite(Number(row?.timestamp))) return Number(row.timestamp);
    if (Number.isFinite(Number(row?.block_time))) return Number(row.block_time);
    if (row?.created_at) {
        const milliseconds = Date.parse(row.created_at);
        if (Number.isFinite(milliseconds)) return Math.floor(milliseconds / 1000);
    }
    return null;
}
