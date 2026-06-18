// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §17.7.1 / G028: clipboard auto-clear configurable 0-600s.
// The default lives in the settings schema, the Privacy panel exposes
// it as a number input, and ViewPrivateKey reads the chosen value to
// time its post-copy clipboard wipe (0 disables). Cluster E Step 5 of 5.

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

// --- 2. PrivacySection renders a number input bound to the setting -------

const ps = readFileSync(join(components, 'settings', 'PrivacySection.jsx'), 'utf8');
assert.ok(/Clipboard auto-clear/.test(ps),
    'PrivacySection labels the new row "Clipboard auto-clear …"');
assert.ok(/type="number"/.test(ps),
    'PrivacySection renders a number input');
assert.ok(/onClipboardSecondsChange/.test(ps),
    'PrivacySection has an onClipboardSecondsChange handler');
assert.ok(/clipboardAutoClearSeconds/.test(ps),
    'PrivacySection patches settings.privacy.clipboardAutoClearSeconds');
// Handler clamps to [MIN, MAX].
assert.ok(/Math\.max\(\s*CLIPBOARD_AUTO_CLEAR_MIN/.test(ps),
    'PrivacySection clamps user input down to the MIN bound');
assert.ok(/Math\.min\(\s*CLIPBOARD_AUTO_CLEAR_MAX/.test(ps),
    'PrivacySection clamps user input up to the MAX bound');

// --- 3. ViewPrivateKey reads the setting and uses it for the timer -------

const vpk = readFileSync(join(routes, 'ViewPrivateKey.jsx'), 'utf8');
assert.ok(/useSettings/.test(vpk),
    'ViewPrivateKey calls useSettings');
assert.ok(/clipboardAutoClearSeconds/.test(vpk),
    'ViewPrivateKey reads clipboardAutoClearSeconds from settings');
// 0 disables; the timer effect must short-circuit when value is <= 0.
assert.ok(/clipboardAutoClearSeconds\s*<=\s*0/.test(vpk),
    'ViewPrivateKey skips the timer when the setting is 0 (disabled)');
// Timer multiplies seconds by 1000 to ms.
assert.ok(/clipboardAutoClearSeconds\s*\*\s*1000/.test(vpk),
    'ViewPrivateKey multiplies seconds-by-1000 to feed setTimeout');
// Hard-coded 60_000 must be gone; otherwise the setting is a no-op.
assert.ok(!/60_000/.test(vpk),
    'ViewPrivateKey no longer hard-codes the 60s timeout');

console.log('clipboard-auto-clear-setting smoke OK');
