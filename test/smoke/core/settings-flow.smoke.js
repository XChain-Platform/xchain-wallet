// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 Settings substrate (Step 1 of the Settings build).
//
// Covers:
//   1. flows.getSettings: returns createDefaultSettings() against an
//      empty vault (no record persisted yet).
//   2. flows.updateSettings: top-level scalar replacement, nested
//      shallow merge, chain-keyed deep merge by key, validation
//      rejection of malformed values.
//   3. flows index re-exports getSettings / updateSettings.
//   4. Extension popup + web messaging modules export getSettings /
//      updateSettings (static source check, no runtime).
//   5. createBackgroundHost.js registers `settings.get` and
//      `settings.update` (static source check).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    flows,
    storage as storageLib,
} from '../../../packages/core/src/index.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

function makeVault() {
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);
    return new storageLib.Vault({
        backend: new storageLib.InMemoryBackend(),
        masterKey,
    });
}

// --- 1. getSettings on empty vault returns default ---------------------------
{
    const vault = makeVault();
    await vault.open();
    const s = await flows.getSettings(vault);
    assert.deepEqual(s, createDefaultSettings(), 'empty vault returns default settings');
    assert.equal(s.theme, 'system');
    assert.equal(s.developerMode, false);
}

// --- 2a. updateSettings: top-level scalar replacement ------------------------
{
    const vault = makeVault();
    await vault.open();
    const after = await flows.updateSettings(vault, { theme: 'dark', autolockMinutes: 30 });
    assert.equal(after.theme, 'dark');
    assert.equal(after.autolockMinutes, 30);
    assert.equal(after.fiatCurrency, 'USD', 'unrelated fields preserved');

    const reread = await flows.getSettings(vault);
    assert.deepEqual(reread, after, 'persisted record matches return value');
}

// --- 2b. updateSettings: nested shallow merge --------------------------------
{
    const vault = makeVault();
    await vault.open();
    await flows.updateSettings(vault, { privacy: { torRouting: true } });
    const s = await flows.getSettings(vault);
    assert.equal(s.privacy.torRouting, true);
    assert.equal(s.privacy.changeAddressRotation, false, 'sibling default preserved');
    assert.equal(s.privacy.hideSmallBalances, false, 'sibling default preserved');
}

// --- 2c. updateSettings: chain-keyed merge by key ----------------------------
{
    const vault = makeVault();
    await vault.open();
    // Seed two chain endpoints.
    await flows.updateSettings(vault, {
        sdkEndpoints: {
            'bitcoin-mainnet': {
                explorerUrl: 'https://e1', encoderUrl: 'https://n1',
                hubUrl: 'https://h1', custom: false,
            },
            'litecoin-mainnet': {
                explorerUrl: 'https://e2', encoderUrl: 'https://n2',
                hubUrl: 'https://h2', custom: false,
            },
        },
    });
    // Update only one chain.
    await flows.updateSettings(vault, {
        sdkEndpoints: {
            'bitcoin-mainnet': {
                explorerUrl: 'https://changed', encoderUrl: 'https://n1',
                hubUrl: 'https://h1', custom: true,
            },
        },
    });
    const s = await flows.getSettings(vault);
    assert.equal(s.sdkEndpoints['bitcoin-mainnet'].explorerUrl, 'https://changed');
    assert.equal(s.sdkEndpoints['bitcoin-mainnet'].custom, true);
    assert.equal(s.sdkEndpoints['litecoin-mainnet'].explorerUrl, 'https://e2',
        'untouched chain key preserved');
}

// --- 2d. updateSettings: validation rejects malformed values -----------------
{
    const vault = makeVault();
    await vault.open();
    await flows.updateSettings(vault, { theme: 'dark' });
    let threw = false;
    try {
        await flows.updateSettings(vault, { theme: 'neon' });
    } catch (err) {
        threw = true;
        assert.match(String(err.message), /invalid settings/, 'validation error surfaced');
    }
    assert.ok(threw, 'invalid theme rejected');
    const s = await flows.getSettings(vault);
    assert.equal(s.theme, 'dark', 'on-disk record unchanged after rejection');
}

// --- 3. flows index re-exports ----------------------------------------------
{
    assert.equal(typeof flows.getSettings, 'function', 'flows.getSettings exported');
    assert.equal(typeof flows.updateSettings, 'function', 'flows.updateSettings exported');
}

// --- 4. messaging modules export the helpers ---------------------------------
{
    const popupSrc = readFileSync(
        join(wsRoot, 'packages/extension/src/popup/messaging.js'), 'utf8',
    );
    assert.match(popupSrc, /export function getSettings\b/, 'popup messaging exports getSettings');
    assert.match(popupSrc, /export function updateSettings\b/, 'popup messaging exports updateSettings');
    assert.match(popupSrc, /sendMessage\('settings\.get'\)/, 'popup wires settings.get');
    assert.match(popupSrc, /sendMessage\('settings\.update'/, 'popup wires settings.update');

    const webSrc = readFileSync(
        join(wsRoot, 'packages/web/src/messaging.js'), 'utf8',
    );
    assert.match(webSrc, /export function getSettings\b/, 'web messaging exports getSettings');
    assert.match(webSrc, /export function updateSettings\b/, 'web messaging exports updateSettings');
    assert.match(webSrc, /sendMessage\('settings\.get'\)/, 'web wires settings.get');
    assert.match(webSrc, /sendMessage\('settings\.update'/, 'web wires settings.update');
}

// --- 5. host registers the handlers -----------------------------------------
{
    const hostSrc = readFileSync(
        join(wsRoot, 'packages/extension/src/background/createBackgroundHost.js'), 'utf8',
    );
    assert.match(hostSrc, /host\.register\('settings\.get'/, 'host registers settings.get');
    assert.match(hostSrc, /host\.register\('settings\.update'/, 'host registers settings.update');
}

console.log('settings-flow smoke OK');
