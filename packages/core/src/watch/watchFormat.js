// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fiatValue, formatAmount, formatFiat } from '../shared/components/BalanceList.jsx';
import { normalizeDisplayCurrency } from '../shared/utils/displayCurrency.js';
import balanceStrings from './contract/strings-balances.json' with { type: 'json' };

export function ageBucket(balancesAt, now) {
    const elapsedMs = Math.max(0, now - balancesAt);
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);
    const amber = elapsedMs > 15 * 60_000;

    if (elapsedMs < 60_000) return { bucket: 'justNow', n: 0, amber };
    if (elapsedMinutes < 60) return { bucket: 'minutes', n: elapsedMinutes, amber };

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return { bucket: 'hours', n: elapsedHours, amber };
    return { bucket: 'day', n: elapsedHours, amber };
}

export function amountText(row, settings = {}) {
    const amount = formatAmount(row?.quantity, row?.divisibility, settings?.numberFormat);
    return `${amount} ${String(row?.tick || '').trim()}`.trim();
}

export function fiatText(row, settings = {}) {
    const value = fiatValue(row?.quantity, row?.divisibility, row?.fiatRate);
    if (value === null) return balanceStrings['state.noPriceYet'];
    const effective = normalizeDisplayCurrency(settings).settings;
    return formatFiat(value, effective?.fiatCurrency);
}

export function ageText(balancesAt, now) {
    const age = ageBucket(balancesAt, now);
    if (age.bucket === 'justNow') return 'Updated just now';
    if (age.bucket === 'minutes') return `Updated ${age.n} min ago`;
    if (age.bucket === 'hours') return `Updated ${age.n} h ago`;
    return balanceStrings['state.stale24h'];
}
