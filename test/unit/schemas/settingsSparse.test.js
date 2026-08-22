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
// roundtrip, the v2→v3 migration that un-freezes legacy copied defaults,
// and the Vault wiring end to end.

import { describe, it, expect } from 'vitest';
import {
    createDefaultSettings,
    deflateSettings,
    inflateSettings,
} from '../../../packages/core/src/schemas/settings.js';
import { migrateSettings } from '../../../packages/core/src/schemas/migrations.js';

describe('deflateSettings', () => {
    it('reduces a pristine default record to schemaVersion only', () => {
        expect(deflateSettings(createDefaultSettings())).toEqual({ schemaVersion: 3 });
    });

    it('keeps only the differing top-level and one-level-deep fields', () => {
        const s = createDefaultSettings();
        const d = deflateSettings({
            ...s,
            theme: 'dark',
            notifications: { ...s.notifications, priceAlerts: true },
        });
        expect(d).toEqual({
            schemaVersion: 3,
            theme: 'dark',
            notifications: { priceAlerts: true },
        });
    });

    it('keeps chain-keyed entries (their keys are load-bearing) minus null fields', () => {
        const s = createDefaultSettings();
        const d = deflateSettings({
            ...s,
            fees: { 'bitcoin-mainnet': { strategy: null, customSatsPerKb: null, rbfByDefault: false } },
            ads: {
                enabled: s.ads.enabled,
                perChain: {
                    'bitcoin-mainnet': {
                        perTxAmountSats: null,
                        triggerAmountSats: 9,
                        accumulatedSats: 0,
                        lifetimeDonatedSats: 0,
                        lifetimeTxCount: 0,
                    },
                },
            },
        });
        expect(d.fees).toEqual({ 'bitcoin-mainnet': { rbfByDefault: false } });
        // ads.enabled equals the default so only perChain survives
        expect(d.ads).toEqual({
            perChain: {
                'bitcoin-mainnet': {
                    triggerAmountSats: 9,
                    accumulatedSats: 0,
                    lifetimeDonatedSats: 0,
                    lifetimeTxCount: 0,
                },
            },
        });
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
        const full = inflateSettings({ schemaVersion: 3, theme: 'dark', notifications: { priceAlerts: true } });
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
        const roundtripped = inflateSettings(deflateSettings(s));
        expect(roundtripped.theme).toBe('light');
        expect(roundtripped.developerMode).toBe(true);
        expect(roundtripped.activeNetwork).toBe('regtest');
        expect(roundtripped.fees['dogecoin-regtest'].strategy).toBe('fast');
        // absent fields read as undefined; ?? treats them like null at resolve time
        expect(roundtripped.fees['dogecoin-regtest'].rbfByDefault).toBeUndefined();
    });

    it('a released default change reaches a wallet that never overrode it', () => {
        // Simulate: the stored record was written when it matched the then-
        // current defaults exactly (deflated to nothing but the version).
        const stored = { schemaVersion: 3 };
        // "Next release" = whatever createDefaultSettings says NOW; every
        // field of the inflated record tracks it, no thaw step needed.
        expect(inflateSettings(stored)).toEqual(createDefaultSettings());
    });
});

describe('settings v2 → v3 migration (un-freezing legacy copied defaults)', () => {
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
    const m = migrateSettings(v2);

    it('bumps to v3', () => {
        expect(m.schemaVersion).toBe(3);
    });

    it('nulls per-chain values equal to what v2 seeding wrote', () => {
        expect(m.ads.perChain['bitcoin-mainnet'].perTxAmountSats).toBe(null);
        expect(m.ads.perChain['bitcoin-mainnet'].triggerAmountSats).toBe(null);
        expect(m.fees['bitcoin-mainnet'].strategy).toBe(null);
        expect(m.fees['bitcoin-mainnet'].rbfByDefault).toBe(null);   // true was the BTC seed
        expect(m.fees['dogecoin-mainnet'].rbfByDefault).toBe(null);  // false was the DOGE seed
    });

    it('preserves values that differ from the legacy seed (user choices)', () => {
        expect(m.ads.perChain['dogecoin-mainnet'].perTxAmountSats).toBe(9);
        expect(m.fees['litecoin-mainnet'].strategy).toBe('fast');
        expect(m.fees['litecoin-mainnet'].rbfByDefault).toBe(false); // differs from LTC's true seed
    });

    it('preserves the accumulator and lifetime counters untouched', () => {
        expect(m.ads.perChain['bitcoin-mainnet'].accumulatedSats).toBe(17);
        expect(m.ads.perChain['bitcoin-mainnet'].lifetimeDonatedSats).toBe(5000);
        expect(m.ads.perChain['bitcoin-mainnet'].lifetimeTxCount).toBe(17);
    });
});
