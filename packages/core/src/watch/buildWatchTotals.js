// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

const NETWORKS = new Set(['mainnet', 'testnet', 'regtest']);
const MAX_WALLET_NAME_UNITS = 40;

export function watchNetwork(settings) {
    const kind = NETWORKS.has(settings?.activeNetwork) ? settings.activeNetwork : 'mainnet';
    return { kind, isTest: kind !== 'mainnet' };
}

export function watchWalletName(name) {
    if (typeof name !== 'string') return undefined;

    const trimmed = name.trim();
    if (!trimmed) return undefined;

    let result = trimmed.slice(0, MAX_WALLET_NAME_UNITS);
    const lastUnit = result.charCodeAt(result.length - 1);
    if (lastUnit >= 0xD800 && lastUnit <= 0xDBFF) result = result.slice(0, -1);
    return result;
}
