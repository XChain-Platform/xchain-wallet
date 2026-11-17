// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Derive one dispenser stock value for list rows and detail panels.
 * Decimal strings are scaled to integers before division so fractional token
 * amounts cannot lose a dispense through floating point rounding.
 *
 * The original escrow is the preferred denominator. Some explorer list lanes
 * instead provide a total dispense count or only the number already dispensed,
 * so those values are accepted without inventing a total when none is known.
 */
export function dispenserStock({
    remainingEscrow,
    giveAmount,
    originalEscrow,
    totalDispenses,
    dispenseCount,
} = {}) {
    const remaining = dispensesFromAmount(remainingEscrow, giveAmount);
    const originalTotal = dispensesFromAmount(originalEscrow, giveAmount);
    const explorerTotal = wholeNumber(totalDispenses);
    const filled = wholeNumber(dispenseCount);
    const countedTotal = remaining != null && filled != null ? remaining + filled : null;
    const candidates = [originalTotal, explorerTotal, countedTotal]
        .filter((value) => value != null && value >= 0n);
    const total = candidates.length > 0
        ? candidates.reduce((largest, value) => value > largest ? value : largest)
        : null;
    const percent = remaining == null || total == null || total === 0n
        ? 0
        : Math.min(100, Number((remaining * 10000n) / total) / 100);

    return {
        remaining,
        total,
        percent,
        label: remaining == null || total == null
            ? 'Stock unavailable'
            : `${formatWhole(remaining)} of ${formatWhole(total)} left`,
    };
}

function wholeNumber(value) {
    if (value == null || value === '') return null;
    const text = String(value).trim();
    return /^\d+$/.test(text) ? BigInt(text) : null;
}

function dispensesFromAmount(amount, perDispense) {
    if (amount == null || perDispense == null) return null;
    const decimals = (value) => (String(value).split('.')[1] || '').length;
    const places = Math.max(decimals(amount), decimals(perDispense));
    const scaled = (value) => {
        const text = String(value).trim();
        if (!/^\d+(\.\d+)?$/.test(text)) return null;
        const [integer, fraction = ''] = text.split('.');
        return BigInt(integer + fraction.padEnd(places, '0'));
    };
    const available = scaled(amount);
    const each = scaled(perDispense);
    if (available == null || each == null || each <= 0n) return null;
    return available / each;
}

function formatWhole(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
