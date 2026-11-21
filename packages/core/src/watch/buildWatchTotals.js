// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveWatchSettings } from '../schemas/settings.js';
import { formatFiat, sumFiatValue } from '../shared/components/BalanceList.jsx';
import { normalizeDisplayCurrency } from '../shared/utils/displayCurrency.js';

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

export function buildWatchTotals(rows, {
    settings = {},
    session = 'locked',
    walletName = '',
    accountId,
    activeAccountId = accountId,
} = {}) {
    const effectiveSettings = normalizeDisplayCurrency(settings).settings || {};
    const network = watchNetwork(effectiveSettings);
    const fiatCode = effectiveSettings.fiatCurrency || 'USD';
    const activeName = accountId === activeAccountId ? watchWalletName(walletName) : undefined;

    return {
        session: session === 'unlocked' ? 'unlocked' : 'locked',
        network,
        fiatCode,
        unitDefault: network.isTest ? 'units' : resolveWatchSettings(effectiveSettings).startIn,
        walletName: activeName || '',
        totals: {
            fiatText: network.isTest ? '' : formatFiat(sumFiatValue(rows).total, fiatCode),
            unitsText: 'Balances',
        },
    };
}
