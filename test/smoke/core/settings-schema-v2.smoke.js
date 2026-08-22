// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 Settings: schema migrations (v1 -> v2 -> v3).
//
// v2 added reducedMotion, privacy.{blurOnBlur, labelsSurviveRestore},
// grace.testSendThresholdSats, panicMode.enabled, backupReminders.
// v3 (§35.10 / §36.6) un-freezes legacy copied per-chain defaults:
// values equal to what v2 seeding wrote become null = follow the
// current release default, resolved against the chain descriptor.

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { flows, storage as storageLib } from '../../../packages/core/src/index.js';
import {
    createDefaultSettings,
    validateSettings,
    CURRENT_VERSION,
    REDUCED_MOTION_MODES,
    BACKUP_REMINDER_CADENCES,
} from '../../../packages/core/src/schemas/settings.js';
import { migrateSettings } from '../../../packages/core/src/schemas/migrations.js';

// --- 1. Schema constants are at v3 ------------------------------------------

assert.equal(CURRENT_VERSION, 3, 'schema bumped to v3');
assert.deepEqual([...REDUCED_MOTION_MODES], ['auto', 'always', 'never']);
assert.deepEqual([...BACKUP_REMINDER_CADENCES], ['off', 'monthly', 'quarterly']);

// --- 2. createDefaultSettings carries the new fields -------------------------

const fresh = createDefaultSettings();
assert.equal(fresh.schemaVersion, 3);
assert.equal(fresh.reducedMotion, 'auto');
assert.equal(fresh.privacy.blurOnBlur, false);
assert.equal(fresh.privacy.labelsSurviveRestore, false);
assert.equal(fresh.grace.undoSendSeconds, 5);
assert.equal(fresh.grace.testSendThresholdSats, 0);
assert.equal(fresh.panicMode.enabled, false);
assert.equal(fresh.backupReminders, 'off');

const v = validateSettings(fresh);
assert.ok(v.ok, `default settings validate (got: ${(v.errors || []).join('; ')})`);

// --- 3. v1 record migrates forward with sensible defaults -------------------

/** @type {any} */
const v1 = {
    schemaVersion: 1,
    theme: 'dark',
    autolockMinutes: 30,
    fiatCurrency: 'EUR',
    language: 'en',
    sdkEndpoints: {
        'bitcoin-mainnet': {
            explorerUrl: 'https://x', encoderUrl: 'https://y', hubUrl: 'https://z', custom: true,
        },
    },
    fees: {
        'bitcoin-mainnet': { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true },
    },
    privacy: {
        torRouting: true,
        changeAddressRotation: false,
        hideSmallBalances: true,
    },
    ads: { enabled: false, perChain: {} },
    notifications: {
        txConfirmations: true, incomingReceipts: true,
        dispenserFills: true, orderFills: true, priceAlerts: false,
    },
    developerMode: true,
    learnMode: false,
    grace: { undoSendSeconds: 8 },
};

const migrated = migrateSettings(v1);
assert.equal(migrated.schemaVersion, 3, 'migrated all the way to v3');
// Pre-existing v1 fields preserved
assert.equal(migrated.theme, 'dark');
assert.equal(migrated.autolockMinutes, 30);
assert.equal(migrated.fiatCurrency, 'EUR');
assert.equal(migrated.privacy.torRouting, true);
assert.equal(migrated.privacy.changeAddressRotation, false, 'changeAddressRotation:false survives migration');
assert.equal(migrated.grace.undoSendSeconds, 8);
// New v2 fields default-filled
assert.equal(migrated.reducedMotion, 'auto');
assert.equal(migrated.privacy.blurOnBlur, false);
assert.equal(migrated.privacy.labelsSurviveRestore, false);
assert.equal(migrated.grace.testSendThresholdSats, 0);
assert.equal(migrated.panicMode.enabled, false);
assert.equal(migrated.backupReminders, 'off');

// v3 un-freezes the copied per-chain defaults: the fixture's fees entry
// holds exactly what v2 seeding wrote for BTC (strategy 'normal',
// rbfByDefault true), so both become null = follow the release default.
assert.equal(migrated.fees['bitcoin-mainnet'].strategy, null, 'legacy seeded strategy nulled by v3');
assert.equal(migrated.fees['bitcoin-mainnet'].rbfByDefault, null, 'legacy seeded rbf nulled by v3');

// Migrated record validates clean.
const v2 = validateSettings(migrated);
assert.ok(v2.ok, `migrated v1 record validates (got: ${(v2.errors || []).join('; ')})`);

// --- 4. updateSettings round-trip on the new fields -------------------------

function makeVault() {
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);
    return new storageLib.Vault({
        backend: new storageLib.InMemoryBackend(),
        masterKey,
    });
}

const vault = makeVault();
await vault.open();

await flows.updateSettings(vault, {
    reducedMotion: 'always',
    privacy: { blurOnBlur: true },
    grace: { testSendThresholdSats: 100000 },
    panicMode: { enabled: true },
    backupReminders: 'quarterly',
});
const persisted = await flows.getSettings(vault);
assert.equal(persisted.reducedMotion, 'always');
assert.equal(persisted.privacy.blurOnBlur, true);
assert.equal(persisted.privacy.changeAddressRotation, false, 'untouched privacy default preserved');
assert.equal(persisted.grace.testSendThresholdSats, 100000);
assert.equal(persisted.grace.undoSendSeconds, 5, 'untouched grace field preserved');
assert.equal(persisted.panicMode.enabled, true);
assert.equal(persisted.backupReminders, 'quarterly');

// Invalid reducedMotion rejected.
let threw = false;
try { await flows.updateSettings(vault, { reducedMotion: 'rave' }); } catch { threw = true; }
assert.ok(threw, 'invalid reducedMotion rejected');

console.log('settings-schema-v2 smoke OK');
