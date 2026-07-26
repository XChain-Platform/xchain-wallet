// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-32: ADDRESS v0 on-chain preferences. Pins the whole chain:
// flow (write-all-three + consensus fold) -> host routes -> 3-shell
// messaging -> form (confirm-time re-fetch) -> AddressList panel -> the
// declassification lockstep (registry + vendored manifest agree that
// ADDRESS is authorable, guarded byte-level by ActionManifestConformance).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');
const core = (...p) => read('packages', 'core', 'src', ...p);

// ---- flow ----
const flow = core('flows', 'addressPreferences.js');
assert.match(flow, /VERSION: '0'/, 'flow composes ADDRESS v0');
for (const f of ['FEE_PREFERENCE', 'REQUIRE_MEMO', 'DISPENSER_PREFERENCE']) {
    assert.match(flow, new RegExp(`${f} must be one of`), `flow refuses blank/invalid ${f} (write-all-three rail)`);
}
assert.match(flow, /VALID_FEE_PREFERENCE = \['0', '1', '2'\]/, 'fee valid set mirrors indexer validValues (no 3)');
assert.match(flow, /payFeeInNativeCoin/, 'flow threads the PC-51 native-fee opt-in');
assert.match(flow, /getAddresses\(/, 'fold reads the explorer ADDRESS-action history');
assert.match(flow, /isBlank\(row\.dispenser_preference\)/, 'dispenser null-guard mirrored');
assert.match(core('flows', 'index.js'), /addressPreferences\.js/, 'flow exported from flows index');

// ---- host + messaging ----
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /'action\.addressPrefs'/, 'host software route');
assert.match(host, /'action\.addressPrefs\.hw'/, 'host HW route');
assert.match(host, /'address\.preferences'/, 'host read route');
for (const shell of [['web', 'src'], ['desktop', 'renderer'], ['extension', 'src', 'popup']]) {
    const m = read('packages', ...shell, 'messaging.js');
    assert.match(m, /addressPreferencesAction/, `${shell[0]} messaging exports the write`);
    assert.match(m, /addressPreferencesActionHw/, `${shell[0]} messaging exports the HW write`);
    assert.match(m, /getAddressPreferences/, `${shell[0]} messaging exports the read`);
}

// ---- form ----
const form = core('shared', 'routes', 'AddressPreferencesForm.jsx');
assert.match(form, /getAddressPreferences\(\{ chainId, address \}\)/, 'form reads current values');
assert.match(form, /handleReview/, 'form has a review gate');
assert.match(form, /Could not re-check the current on-chain values/, 'review is blocked without a fresh re-fetch (stale-read rail)');
assert.match(form, /reviewBaseline/, 'review compares against the re-fetched baseline');
assert.match(form, /CHANGED/, 'review marks changed rows');
assert.match(form, /unchanged/, 'review shows unchanged rows being re-written too');
assert.match(form, /<NativeFeeToggle/, 'PC-51 toggle mounted');
assert.match(form, /WatcherResultPanel/, 'watcher encode-only lane');
assert.match(form, /SignCredentials/, 'software/HW signing lane');

// ---- AddressList panel + shells ----
const list = core('shared', 'routes', 'AddressList.jsx');
assert.match(list, /onEditPreferences/, 'AddressList exposes the edit affordance');
assert.match(list, /getAddressPreferences/, 'AddressList loads current prefs for the panel');
assert.match(list, /On-chain preferences/, 'panel rendered in the detail view');
for (const shell of [['web', 'src'], ['desktop', 'renderer'], ['extension', 'src', 'popup']]) {
    const app = read('packages', ...shell, 'App.jsx');
    assert.match(app, /AddressPreferencesForm/, `${shell[0]} App mounts the form`);
    assert.match(app, /'address-preferences'/, `${shell[0]} App routes the view`);
}

// ---- declassification lockstep ----
const registry = core('registry', 'actions.js');
assert.match(registry, /COMMON_ACTIONS = \/\*\* @type \{const\} \*\/ \(\[\n    'ADDRESS',/, 'ADDRESS is authorable');
assert.doesNotMatch(registry, /PROTOCOL_ONLY_ACTIONS = [^\]]*'ADDRESS'/s, 'ADDRESS no longer protocol-only');
const manifest = JSON.parse(read('test', 'fixtures', 'action-manifest.json'));
assert.equal(manifest.actions.ADDRESS.walletForm, true, 'vendored manifest carries ADDRESS walletForm:true');
const advanced = core('shared', 'routes', 'AdvancedActionsForm.jsx');
assert.match(advanced, /'PRICE', 'ADDRESS',\n\]\);/, 'ADDRESS listed among dedicated-form actions');

console.log('address-preferences smoke: all assertions passed');
