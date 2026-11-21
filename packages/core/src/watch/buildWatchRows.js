// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { smallBalanceKeys } from '../shared/components/BalanceList.jsx';

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
