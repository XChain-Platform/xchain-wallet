// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { smallBalanceKeys } from '../shared/components/BalanceList.jsx';
import { tickerColor } from '../ui/AssetMark.jsx';
import balanceStrings from './contract/strings-balances.json' with { type: 'json' };
import { amountText, fiatText } from './watchFormat.js';

const MAX_ROWS = 50;

function valueFor(values, key) {
    if (values instanceof Set) return values.has(key);
    return values instanceof Map ? values.get(key) : values?.[key];
}

function displayName(row) {
    let value = String(row.displayName || row.tick).slice(0, 64);
    if (/^[\s\S]*[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
    return value;
}

function hasPending(row) {
    try {
        return BigInt(row?.pendingQuantity ?? 0) > 0n;
    } catch {
        return false;
    }
}

export function selectWatchRows(rows, {
    pinnedOnly = false,
    pinnedKeys,
    hideSmallBalances = false,
    smallBalanceFiat,
    cap = 50,
} = {}) {
    let selected = rows;

    if (pinnedOnly) {
        selected = rows.filter((row) => pinnedKeys?.has(`${row.chainId}:${row.tick}`));
    } else if (hideSmallBalances) {
        const smallKeys = smallBalanceKeys(rows, smallBalanceFiat, pinnedKeys);
        selected = rows.filter((row) => !smallKeys.has(`${row.chainId}:${row.tick}`));
    }

    return {
        rows: selected.slice(0, cap),
        capped: selected.length > cap,
    };
}

export function buildWatchRows(rows, {
    settings = {},
    pinnedKeys,
    pinnedOnly = settings?.watch?.tokenMode === 'pinned',
    hideSmallBalances = false,
    smallBalanceFiat,
    hashByImageUrl,
    tokenInfoByKey,
    nativePriceMap,
} = {}) {
    const selected = selectWatchRows(rows, {
        pinnedOnly,
        pinnedKeys,
        hideSmallBalances,
        smallBalanceFiat,
        cap: MAX_ROWS,
    });

    return {
        capped: selected.capped,
        rows: selected.rows.map((row) => {
            const id = `${row.chainId}:${row.tick}`;
            const formattedFiat = fiatText(row, settings);
            const sparkline = valueFor(nativePriceMap, row.chainId)?.sparkline;
            return {
                id,
                chainId: row.chainId,
                tick: row.tick,
                displayName: displayName(row),
                amountText: amountText(row, settings),
                fiatText: formattedFiat,
                noPrice: formattedFiat === balanceStrings['state.noPriceYet'],
                pendingText: hasPending(row)
                    ? `${amountText({ ...row, quantity: row.pendingQuantity }, settings)} pending`
                    : '',
                unavailable: Boolean(row.unavailable),
                iconHash: valueFor(hashByImageUrl, row.imageUrl) || '',
                tickerColor: tickerColor(row.tick),
                hasDetail: row.kind === 'native'
                    ? Array.isArray(sparkline) && sparkline.length > 0
                    : Boolean(valueFor(tokenInfoByKey, id)),
            };
        }),
    };
}
