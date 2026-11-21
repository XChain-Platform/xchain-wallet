// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatTokenQuantity } from '../shared/utils/amountFormat.js';
import { percentChangeDisplay } from '../shared/utils/percentFormat.js';
import {
    readTokenInfoCache,
    tokenInfoCacheKey,
} from '../shared/utils/tokenInfoCache.js';
import balanceStrings from './contract/strings-balances.json' with { type: 'json' };
import { watchChart } from './watchChart.js';

const PRICE_SOURCE_LABELS = {
    market: 'XChain DEX',
    oracle: 'CoinGecko',
    dispenser: 'XChain dispenser',
    demo: 'Sample data',
};

export function cutAtWord(text, max) {
    if (typeof text !== 'string' || !Number.isInteger(max) || max <= 0) return '';

    const trimmed = text.trim();
    const codePoints = [...trimmed];
    if (codePoints.length <= max) return trimmed;

    const prefix = codePoints.slice(0, max - 1);
    let whitespaceIndex = -1;
    for (let index = prefix.length - 1; index >= 0; index -= 1) {
        if (!/\s/u.test(prefix[index])) continue;
        whitespaceIndex = index;
        break;
    }
    const cut = whitespaceIndex === -1 ? prefix : prefix.slice(0, whitespaceIndex);

    return `${cut.join('').trimEnd()}…`;
}

function shortAddress(address) {
    const value = typeof address === 'string' ? address.trim() : '';
    return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value || 'Unknown';
}

function changeText(value) {
    const change = percentChangeDisplay(value);
    return change ? `${change.text} over 24 h` : null;
}

function sourceText(source) {
    if (typeof source !== 'string' || !source.trim()) return null;
    return PRICE_SOURCE_LABELS[source] || source.trim();
}

function tokenFacts(row, info) {
    const divisibility = Number.isInteger(info.divisibility)
        && info.divisibility >= 0 && info.divisibility <= 8
        ? info.divisibility
        : null;
    const supply = formatTokenQuantity(info.totalSupply, divisibility);
    const type = row.kind === 'subtoken' ? 'Subtoken' : 'Token';

    return [
        { label: balanceStrings['w2.type'], value: type },
        { label: balanceStrings['w2.supply'], value: supply ? `${supply} ${row.tick}` : 'Unknown' },
        {
            label: balanceStrings['w2.divisibility'],
            value: divisibility === null
                ? 'Unknown'
                : `${divisibility} ${divisibility === 1 ? 'decimal' : 'decimals'}`,
        },
        {
            label: balanceStrings['w2.status'],
            value: info.locked === true ? 'Locked' : info.locked === false ? 'Mutable' : 'Unknown',
        },
        { label: balanceStrings['w2.creator'], value: shortAddress(info.creator) },
    ];
}

function cachedTokenInfo(row, options) {
    if (Object.hasOwn(options, 'tokenInfo')) return options.tokenInfo;
    const baseKey = tokenInfoCacheKey(row.chainId, row.tick);
    const key = options.demo === true && baseKey ? `demo|${baseKey}` : baseKey;
    const cached = readTokenInfoCache(key);
    return cached.hit ? cached.value : null;
}

export function buildWatchDetail(row, options = {}) {
    if (!row?.id || !row.chainId || !row.tick) return null;
    const settings = options && typeof options === 'object' ? options : {};

    if (row.kind === 'native') {
        const entry = settings.nativePriceMap?.[row.chainId];
        const chart = watchChart(entry?.sparkline);
        if (!chart) return null;
        const change = changeText(entry?.change24hPct);
        return {
            v: 1,
            tokenId: row.id,
            ...(change ? { changeText: change } : {}),
            priceSourceText: 'CoinGecko',
            chart,
        };
    }

    const info = cachedTokenInfo(row, settings);
    if (!info || info.loadError === true) return null;
    const artworkHash = settings.artworkHash
        || settings.hashByImageUrl?.get?.(info.imageUrl)
        || (info.imageUrl ? settings.hashByImageUrl?.[info.imageUrl] : null);
    const description = cutAtWord(info.description, 280);
    const change = changeText(row.change24hPct);
    const priceSource = sourceText(row.fiatRateSource);

    return {
        v: 1,
        tokenId: row.id,
        ...(artworkHash ? { artworkHash } : {}),
        ...(change ? { changeText: change } : {}),
        ...(priceSource ? { priceSourceText: priceSource } : {}),
        facts: tokenFacts(row, info),
        ...(description ? { description } : {}),
    };
}
