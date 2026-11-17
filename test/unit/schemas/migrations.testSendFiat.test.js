// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings v4 -> v5 (operator ruling 2026-11-14): the new-recipient test-send
// threshold moves from sats to the display currency. Off stays Off; any other
// value converts at the bitcoin price this process holds, rounded to a whole
// amount, or becomes the $1,000 default when there is no price.

import { describe, expect, it } from 'vitest';
import {
    migrateLegacyTestSend,
    migrateSettings,
} from '../../../packages/core/src/schemas/migrations.js';
import {
    CURRENT_VERSION,
    TEST_SEND_FIAT_DEFAULT,
    createDefaultSettings,
    isTestSendFiat,
    resolveTestSendFiat,
    validateSettings,
} from '../../../packages/core/src/schemas/settings.js';

const at = (rate) => ({ testSendRateFor: () => (rate === null ? null : { rate, decimals: 8 }) });

function v4(grace, extra = {}) {
    const full = createDefaultSettings();
    return { ...full, ...extra, schemaVersion: 4, grace: { undoSendSeconds: 5, undoSendEnabled: false, testSendThresholdSats: 0, ...grace } };
}

describe('settings v4 -> v5 test-send threshold', () => {
    it('is the current schema version', () => {
        expect(CURRENT_VERSION).toBe(5);
    });

    it('keeps Off as Off', () => {
        expect(migrateLegacyTestSend(v4({ testSendThresholdSats: 0 }), at(50000))).toBe('0');
        expect(migrateLegacyTestSend(v4({ testSendThresholdSats: '0' }), at(50000))).toBe('0');
        const out = migrateSettings(v4({ testSendThresholdSats: 0 }), at(50000));
        expect(out.schemaVersion).toBe(5);
        expect(resolveTestSendFiat(out)).toBeNull();
    });

    it('converts a sats threshold at the current price, rounded to a whole amount', () => {
        // 100,000 sats at $50,000 a coin is $50.
        expect(migrateLegacyTestSend(v4({ testSendThresholdSats: 100000 }), at(50000))).toBe('50');
        // 1,234,567 sats at $43,210.50 is $533.46, rounded to $533.
        expect(migrateLegacyTestSend(v4({ testSendThresholdSats: '1234567' }), at(43210.5))).toBe('533');
        // A tiny threshold never rounds down to Off.
        expect(migrateLegacyTestSend(v4({ testSendThresholdSats: 1 }), at(50000))).toBe('1');
        const out = migrateSettings(v4({ testSendThresholdSats: 100000 }), at(50000));
        expect(out.grace.testSendThresholdFiat).toBe('50');
        expect(resolveTestSendFiat(out)).toBe('50');
        expect(validateSettings(out).ok).toBe(true);
    });

    it('defaults to $1,000 when there is no price', () => {
        expect(TEST_SEND_FIAT_DEFAULT).toBe('1000');
        expect(migrateLegacyTestSend(v4({ testSendThresholdSats: 100000 }), at(null))).toBe('1000');
        const out = migrateSettings(v4({ testSendThresholdSats: 25000 }), at(null));
        expect(out.grace.testSendThresholdFiat).toBe('1000');
    });

    it('converts in the record display currency', () => {
        let asked = null;
        const ctx = { testSendRateFor: (currency) => { asked = currency; return { rate: 40000, decimals: 8 }; } };
        expect(migrateLegacyTestSend(v4({ testSendThresholdSats: 250000 }, { fiatCurrency: 'EUR' }), ctx)).toBe('100');
        expect(asked).toBe('EUR');
    });

    it('migrates a sparse record that stored no grace block as Off, adding nothing', () => {
        const out = migrateSettings({ schemaVersion: 4 }, at(50000));
        expect(out).toEqual({ schemaVersion: 5 });
    });

    it('caps a huge legacy threshold at the largest amount the setting holds', () => {
        const out = migrateLegacyTestSend(v4({ testSendThresholdSats: '9007199254740993' }), at(1e9));
        expect(out).toBe('1000000000');
        expect(isTestSendFiat(out)).toBe(true);
    });

    it('runs from older versions straight through to v5', () => {
        const v3 = { ...v4({ testSendThresholdSats: 100000 }), schemaVersion: 3 };
        const out = migrateSettings(v3, { ...at(50000), adsRateFor: () => null });
        expect(out.schemaVersion).toBe(5);
        expect(out.grace.testSendThresholdFiat).toBe('50');
    });
});

describe('test-send fiat values', () => {
    it.each([
        ['0', true], ['100', true], ['2500.5', true], ['1000000000', true],
        ['', false], ['-1', false], ['1e3', false], ['12.345', false], ['01', false], ['1000000001', false],
    ])('%s is a stored threshold: %s', (value, ok) => {
        expect(isTestSendFiat(value)).toBe(ok);
    });

    it('rejects a malformed stored threshold and a non-boolean lookalike flag', () => {
        const good = createDefaultSettings();
        expect(validateSettings(good).ok).toBe(true);
        expect(validateSettings({ ...good, grace: { ...good.grace, testSendThresholdFiat: '1e3' } }).ok).toBe(false);
        expect(validateSettings({ ...good, grace: { ...good.grace, lookalikeWarnings: 'yes' } }).ok).toBe(false);
        expect(validateSettings({ ...good, grace: { ...good.grace, lookalikeWarnings: false } }).ok).toBe(true);
    });
});
