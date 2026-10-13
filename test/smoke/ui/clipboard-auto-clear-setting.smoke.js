// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the clipboard setting's schema, control, and sensitive-copy reader.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const schemas = join(core, 'src', 'schemas');
const components = join(core, 'src', 'shared', 'components');
const routes = join(core, 'src', 'shared', 'routes');
const shared = join(core, 'src', 'shared');

// --- 1. Schema exposes bounds + default + tolerant validation ------------

const settingsSchema = readFileSync(join(schemas, 'settings.js'), 'utf8');
assert.ok(/CLIPBOARD_AUTO_CLEAR_MIN\s*=\s*0/.test(settingsSchema),
    'schema exports CLIPBOARD_AUTO_CLEAR_MIN = 0');
assert.ok(/CLIPBOARD_AUTO_CLEAR_MAX\s*=\s*600/.test(settingsSchema),
    'schema exports CLIPBOARD_AUTO_CLEAR_MAX = 600');
assert.ok(/CLIPBOARD_AUTO_CLEAR_DEFAULT\s*=\s*60/.test(settingsSchema),
    'schema exports CLIPBOARD_AUTO_CLEAR_DEFAULT = 60');
assert.ok(/clipboardAutoClearSeconds:\s*CLIPBOARD_AUTO_CLEAR_DEFAULT/.test(settingsSchema),
    'createDefaultSettings seeds clipboardAutoClearSeconds');
// Tolerant validation: undefined OK, integer in [0, 600] OK, anything else fails.
assert.ok(/clipboardAutoClearSeconds === undefined/.test(settingsSchema),
    'validateSettings tolerates missing clipboardAutoClearSeconds (older v2 records)');
assert.ok(/Number\.isInteger\(\s*r\.privacy\.clipboardAutoClearSeconds\s*\)/.test(settingsSchema),
    'validateSettings requires integer when present');

// --- 2. PrivacySection persists the clipboard control -----------

const ps = readFileSync(join(components, 'settings', 'PrivacySection.jsx'), 'utf8');
const psBody = ps.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
assert.ok(/Clipboard auto-clear/.test(psBody),
    'PrivacySection renders the clipboard auto-clear row');
assert.ok(/clipboardAutoClearSeconds/.test(psBody),
    'PrivacySection reads and writes settings.privacy.clipboardAutoClearSeconds');
assert.ok(/CLIPBOARD_AUTO_CLEAR_MIN/.test(psBody) && /CLIPBOARD_AUTO_CLEAR_MAX/.test(psBody),
    'PrivacySection applies the schema bounds');
assert.ok(/Change-address rotation/.test(psBody) && /Form draft retention/.test(psBody),
    'the surrounding Privacy rows remain present');

// --- 3. Private-key copies use the shared sensitive clipboard policy ------
//
// ViewPrivateKey selects the active preference and the shared clipboard owns
// scheduling, cancellation, and compare-before-clear.
const vpk = readFileSync(join(routes, 'ViewPrivateKey.jsx'), 'utf8');
const clipboard = readFileSync(join(shared, 'clipboard.js'), 'utf8');
assert.ok(/clipboardAutoClearSeconds/.test(vpk) && /configureClipboardAutoClear/.test(vpk),
    'ViewPrivateKey applies the configured clipboard timeout');
assert.ok(!/navigator\.clipboard/.test(vpk),
    'ViewPrivateKey never writes directly to the browser clipboard');
assert.ok(/<CopyButton[\s\S]*?sensitive/.test(vpk),
    'ViewPrivateKey marks private-key copies sensitive');
assert.ok(/cancelPendingAutoClear\(\)/.test(clipboard)
    && /expectedValue: value/.test(clipboard)
    && /seconds <= 0/.test(clipboard),
    'shared clipboard cancels old timers, supports zero, and compares before clearing');

console.log('clipboard-auto-clear-setting smoke OK (schema, control, and sensitive-copy policy connected)');
