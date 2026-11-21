// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { tickerColor } from '../ui/AssetMark.jsx';
import { watchChart } from './watchChart.js';

export function nativeWatchChart(nativePriceMap, chainId) {
    return watchChart(nativePriceMap?.[chainId]?.sparkline);
}

export function watchRowMeta(row, { nativePriceMap, hasCachedTokenInfo } = {}) {
    const hasDetail = row.kind === 'native'
        ? nativeWatchChart(nativePriceMap, row.chainId) !== null
        : hasCachedTokenInfo?.(row.chainId, row.tick) === true;

    return {
        chainId: row.chainId,
        tick: row.tick,
        tickerColor: tickerColor(row.tick),
        unavailable: row.unavailable === true,
        hasDetail,
    };
}
