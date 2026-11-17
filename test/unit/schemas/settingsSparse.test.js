// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: sparse settings storage (§35.10, the "FreeWallet rule"). The vault
// stores only what differs from the current release's defaults, so a
// default retuned in a later release reaches every wallet whose user
// never overrode it. Covers deflate (drop values equal to code defaults,
// keep chain-keyed entries whose keys mark active chains), inflate (lay
// stored deltas over createDefaultSettings), the deflate/inflate
// roundtrip, the v2→v3 step that un-freezes legacy copied defaults, and
// the v3→v4 step that folds the per-chain donation queues into one fiat
// queue (ruling 2026-11-14).

import { describe, it, expect } from 'vitest';
import {
    CURRENT_VERSION,
    createDefaultSettings,
    deflateSettings,
    inflateSettings,
    validateSettings,
} from '../../../packages/core/src/schemas/settings.js';
import {
    migrateLegacyAds,
    migrateSettings,
    settingsMigrations,
} from '../../../packages/core/src/schemas/migrations.js';

describe('deflateSettings', () => {
    it('reduces a pristine default record to schemaVersion only', () => {
        expect(deflateSettings(createDefaultSettings())).toEqual({ schemaVersion: CURRENT_VERSION });
    });

    it('keeps only the differing top-level and one-level-deep fields', () => {
        const s = createDefaultSettings();
        const d = deflateSettings({
            ...s,
            theme: 'dark',
            notifications: { ...s.notifications, priceAlerts: true },
            ads: { ...s.ads, queued: '3.45', donationCount: 2 },
        });
        expect(d).toEqual({
            schemaVersion: CURRENT_VERSION,
            theme: 'dark',
            notifications: { priceAlerts: true },
            ads: { queued: '3.45', donationCount: 2 },
        });
    });

    it('keeps chain-keyed entries (their keys are load-bearing) minus null fields', () => {
        const s = createDefaultSettings();
        const d = deflateSettings({
            ...s,
            fees: { 'bitcoin-mainnet': { strategy: null, customSatsPerKb: null, rbfByDefault: false } },
        });
        expect(d.fees).toEqual({ 'bitcoin-mainnet': { rbfByDefault: false } });
    });

    it('an entry emptied to {} still survives (it marks the chain active)', () => {
        const s = createDefaultSettings();
        const d = deflateSettings({
            ...s,
            fees: { 'bitcoin-mainnet': { strategy: null, customSatsPerKb: null, rbfByDefault: null } },
        });
        expect(d.fees).toEqual({ 'bitcoin-mainnet': {} });
    });
});

describe('inflateSettings', () => {
    it('lays stored deltas over the current defaults', () => {
        const full = inflateSettings({ schemaVersion: CURRENT_VERSION, theme: 'dark', notifications: { priceAlerts: true } });
        const defaults = createDefaultSettings();
        expect(full.theme).toBe('dark');
        expect(full.notifications.priceAlerts).toBe(true);
        expect(full.notifications.txConfirmations).toBe(defaults.notifications.txConfirmations);
        expect(full.autolockMinutes).toBe(defaults.autolockMinutes);
    });

    it('deflate → inflate roundtrips any record to the same full form', () => {
        const s = {
            ...createDefaultSettings(),
            theme: 'light',
            developerMode: true,
            activeNetwork: 'regtest',
            fees: { 'dogecoin-regtest': { strategy: 'fast', customSatsPerKb: null, rbfByDefault: null } },
        };
        s.ads = { ...s.ads, sendAt: '50', recipient: 'community', queued: '12.3' };
        const roundtripped = inflateSettings(deflateSettings(s));
        expect(roundtripped.theme).toBe('light');
        expect(roundtripped.developerMode).toBe(true);
        expect(roundtripped.activeNetwork).toBe('regtest');
        expect(roundtripped.fees['dogecoin-regtest'].strategy).toBe('fast');
        expect(roundtripped.ads).toEqual(s.ads);
        // absent fields read as undefined; ?? treats them like null at resolve time
        expect(roundtripped.fees['dogecoin-regtest'].rbfByDefault).toBeUndefined();
    });

    it('a released default change reaches a wallet that never overrode it', () => {
        const stored = { schemaVersion: CURRENT_VERSION };
        expect(inflateSettings(stored)).toEqual(createDefaultSettings());
    });

    it('keeps an explicitly stored send-at amount', () => {
        const stored = { schemaVersion: CURRENT_VERSION, ads: { sendAt: '25' } };
        expect(inflateSettings(stored).ads.sendAt).toBe('25');
        expect(inflateSettings({ schemaVersion: CURRENT_VERSION }).ads.sendAt).toBe('5');
    });
});

describe('settings v2 → v3 step (un-freezing legacy copied defaults)', () => {
    const v2 = {
        schemaVersion: 2,
        theme: 'system',
        fees: {
            'bitcoin-mainnet': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
            'dogecoin-mainnet': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: false },
            'litecoin-mainnet': { strategy: 'fast', customSatsPerKb: null, rbfByDefault: false },
        },
        ads: {
            enabled: true,
            perChain: {
                'bitcoin-mainnet': { perTxAmountSats: 1, triggerAmountSats: 1000, accumulatedSats: 17, lifetimeDonatedSats: 5000, lifetimeTxCount: 17 },
                'dogecoin-mainnet': { perTxAmountSats: 9, triggerAmountSats: 1000, accumulatedSats: 0, lifetimeDonatedSats: 0, lifetimeTxCount: 0 },
            },
        },
    };
    const m = settingsMigrations[2](v2);

    it('bumps to v3 and un-freezes the legacy fee seeds', () => {
        expect(m.schemaVersion).toBe(3);
        expect(m.fees['bitcoin-mainnet'].strategy).toBe(null);
        expect(m.fees['bitcoin-mainnet'].rbfByDefault).toBe(null);
        expect(m.fees['dogecoin-mainnet'].rbfByDefault).toBe(null);
        expect(m.fees['litecoin-mainnet'].strategy).toBe('fast');
        expect(m.fees['litecoin-mainnet'].rbfByDefault).toBe(false);
    });

    it('a v2 record walks all the way to the current fiat queue', () => {
        const full = migrateSettings(v2, { adsRateFor: () => null });
        expect(full.schemaVersion).toBe(CURRENT_VERSION);
        expect(full.ads).toMatchObject({ perTransaction: '0.05', queued: '0' });
        expect(full.ads.perChain).toBeUndefined();
    });
});

describe('settings v3 → v4: one wallet-wide fiat queue', () => {
    // BTC at 100,000 and DOGE at 0.2 in the record's currency; LTC has no price.
    const rates = { 'bitcoin-mainnet': 100000, 'dogecoin-mainnet': 0.2 };
    const adsRateFor = (chainId) => (rates[chainId] ? { rate: rates[chainId], decimals: 8 } : null);

    it('converts each mainnet queue at its current price and adds them up', () => {
        const ads = migrateLegacyAds({
            schemaVersion: 3,
            fiatCurrency: 'USD',
            ads: {
                enabled: true,
                perChain: {
                    'bitcoin-mainnet': { accumulatedSats: 12345, lifetimeDonatedSats: 0, lifetimeTxCount: 1 },  // $12.345 -> 12.35
                    'dogecoin-mainnet': { accumulatedSats: 500000000, lifetimeDonatedSats: 0, lifetimeTxCount: 1 }, // 5 DOGE -> $1
                    'litecoin-mainnet': { accumulatedSats: 9000000, lifetimeDonatedSats: 0, lifetimeTxCount: 1 },  // no price -> dropped
                },
            },
        }, { adsRateFor });
        expect(ads.queued).toBe('13.35');
        expect(ads.donated).toBe('0');
        expect(ads.perTransaction).toBe('0.05');
    });

    it('starts the queue at 0 when no price is available', () => {
        const ads = migrateLegacyAds({
            schemaVersion: 3,
            ads: { perChain: { 'bitcoin-mainnet': { accumulatedSats: 20000, lifetimeDonatedSats: 0, lifetimeTxCount: 4 } } },
        }, { adsRateFor: () => null });
        expect(ads.queued).toBe('0');
    });

    it('never turns a test-network queue into money (the default reader prices mainnet only)', () => {
        const ads = migrateLegacyAds({
            schemaVersion: 3,
            ads: { perChain: { 'bitcoin-testnet': { accumulatedSats: 99999999, lifetimeDonatedSats: 0, lifetimeTxCount: 4 } } },
        });
        expect(ads.queued).toBe('0');
    });

    it('is on at the default amount when ADS was on anywhere, off as an explicit 0 otherwise', () => {
        // The sparse stored form omits enabled when it was the old default (on).
        expect(migrateLegacyAds({ schemaVersion: 3 }).perTransaction).toBe('0.05');
        expect(migrateLegacyAds({ schemaVersion: 3, ads: { perChain: {} } }).perTransaction).toBe('0.05');
        expect(migrateLegacyAds({ schemaVersion: 3, ads: { enabled: false } }).perTransaction).toBe('0');
        // On, but every network's amount set to 0, was off in effect.
        expect(migrateLegacyAds({
            schemaVersion: 3,
            ads: { perChain: { 'bitcoin-mainnet': { perTxAmountSats: 0, accumulatedSats: 0, lifetimeDonatedSats: 0, lifetimeTxCount: 0 } } },
        }).perTransaction).toBe('0');
        // ...and one network still adding is on.
        expect(migrateLegacyAds({
            schemaVersion: 3,
            ads: {
                perChain: {
                    'bitcoin-mainnet': { perTxAmountSats: 0, accumulatedSats: 0, lifetimeDonatedSats: 0, lifetimeTxCount: 0 },
                    'dogecoin-mainnet': { perTxAmountSats: null, accumulatedSats: 0, lifetimeDonatedSats: 0, lifetimeTxCount: 0 },
                },
            },
        }).perTransaction).toBe('0.05');
    });

    it('keeps the chosen recipient', () => {
        const pick = (roles) => migrateLegacyAds({
            schemaVersion: 3,
            ads: {
                perChain: Object.fromEntries(roles.map((role, i) => [`c${i}`, {
                    accumulatedSats: 0, lifetimeDonatedSats: 0, lifetimeTxCount: 0,
                    ...(role ? { donationAddressRole: role } : {}),
                }])),
            },
        }, { adsRateFor: () => null }).recipient;
        expect(pick([null])).toBe('protocol');
        expect(pick(['DONATE2'])).toBe('community');
        expect(pick(['DONATE1', 'EXPLORER'])).toBe('explorer');
        expect(pick(['DONATE9'])).toBe('protocol');
    });

    it('keeps the display currency, and the result validates in the sparse and the full form', () => {
        const sparse = migrateSettings({ schemaVersion: 3, fiatCurrency: 'EUR', ads: { enabled: false } }, { adsRateFor });
        expect(sparse.ads).toMatchObject({ currency: 'EUR', perTransaction: '0' });
        expect(validateSettings(inflateSettings(sparse)).ok).toBe(true);

        const fullV3 = {
            ...createDefaultSettings(),
            schemaVersion: 3,
            ads: {
                enabled: true,
                perChain: {
                    'bitcoin-mainnet': { perTxAmountSats: null, triggerAmountSats: null, accumulatedSats: 25000, lifetimeDonatedSats: 1000, lifetimeTxCount: 25, donationAddressRole: 'DONATE2' },
                },
            },
        };
        const full = migrateSettings(fullV3, { adsRateFor });
        expect(full.ads).toEqual({
            perTransaction: '0.05',
            sendAt: '5',
            recipient: 'community',
            currency: 'USD',
            queued: '25',
            donated: '0',
            donationCount: 0,
        });
        expect(validateSettings(full).ok).toBe(true);
    });
});
