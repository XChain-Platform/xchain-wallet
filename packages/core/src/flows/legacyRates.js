// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
// SPDX-License-Identifier: AGPL-3.0-or-later

// The prices the settings migrations (schemas/migrations.js) convert legacy
// amounts at. They live here, not in the migration file, because that file is
// in the vault import graph and the registry and the price lookup are not
// every-OS rehearsal trigger paths. Callers hand legacySettingsMigrationCtx()
// to the Vault (settingsMigrationCtx) or to migrateSettings.

import { nativeDecimalsFor } from '../registry/coinTicker.js';
import { defaultRegistry } from '../registry/index.js';
import { getFiatRate } from './priceLookup.js';

/**
 * The price a v3 per-coin queue converts at: the rate this process already
 * holds for the coin (memory or the persisted cache), mainnet only. A testnet
 * or regtest queue is test coin with no fiat value, so it never becomes real
 * money in the wallet-wide queue.
 *
 * @param {string} chainId
 * @param {string} currency
 * @returns {{ rate: number, decimals: number } | null}
 */
export function legacyAdsRateFor(chainId, currency) {
    try {
        const descriptor = defaultRegistry().get(chainId);
        if (!descriptor || descriptor.networkKind !== 'mainnet') return null;
        const found = getFiatRate({ chainCoin: descriptor.coin, fiatCurrency: currency });
        const rate = Number(found?.rate);
        if (!Number.isFinite(rate) || rate <= 0) return null;
        return { rate, decimals: nativeDecimalsFor(descriptor) };
    } catch {
        return null;
    }
}

/**
 * The price a v4 sats test-send threshold converts at: the bitcoin mainnet
 * rate this process already holds (memory or the persisted cache). The old
 * threshold counted base units of whichever coin was sent, and bitcoin's
 * 8-decimal unit is the one it was written for.
 *
 * @param {string} currency
 * @returns {{ rate: number, decimals: number } | null}
 */
export function legacyTestSendRateFor(currency) {
    try {
        const found = getFiatRate({ chainCoin: 'bitcoin', fiatCurrency: currency });
        const rate = Number(found?.rate);
        if (!Number.isFinite(rate) || rate <= 0) return null;
        return { rate, decimals: 8 };
    } catch {
        return null;
    }
}

/** The ctx that gives migrateSettings its live prices. */
export function legacySettingsMigrationCtx() {
    return { adsRateFor: legacyAdsRateFor, testSendRateFor: legacyTestSendRateFor };
}
