// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Normalize one projected market fill while retaining raw-row compatibility. */
export function normalizeMarketHistoryRow(row, tick1, tick2) {
    if (!row || typeof row !== 'object') return null;
    const price = Number(row.price);
    const amount = Number(row.amount);
    const side = String(row.type || '').toLowerCase();
    const timestamp = historyTimestamp(row);
    if (
        Number.isFinite(price) && price > 0
        && Number.isFinite(amount) && amount > 0
        && (side === 'buy' || side === 'sell')
        && Number.isFinite(timestamp)
    ) {
        return historyResult(row, { price, amount, side, timestamp });
    }
    return normalizeRawMatch(row, tick1, tick2, timestamp);
}

function normalizeRawMatch(row, tick1, tick2, timestamp) {
    const giveTick = row.give_tick || row.giveTick;
    const getTick = row.get_tick || row.getTick;
    const giveAmount = Number(row.give_amount ?? row.giveAmount);
    const getAmount = Number(row.get_amount ?? row.getAmount);
    if (!giveTick || !getTick || !Number.isFinite(timestamp)) return null;
    if (!Number.isFinite(giveAmount) || giveAmount <= 0) return null;
    if (!Number.isFinite(getAmount) || getAmount <= 0) return null;
    if (giveTick === tick1 && getTick === tick2) {
        return historyResult(row, {
            price: getAmount / giveAmount,
            amount: giveAmount,
            side: 'sell',
            timestamp,
        });
    }
    if (giveTick === tick2 && getTick === tick1) {
        return historyResult(row, {
            price: giveAmount / getAmount,
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
