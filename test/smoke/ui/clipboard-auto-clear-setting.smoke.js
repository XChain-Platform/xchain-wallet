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

// --- 3. The consumer, which no longer exists ---------------------------
//
// ViewPrivateKey used to read this setting and clear the clipboard on its
// timer. (operator decision, 2026-08-01) made key material
// uncopyable on every shell, so the Copy button that timer served is gone and
// with it the only reader of this value.
//
// The setting is therefore ORPHANED: the control below still writes
// `settings.privacy.clipboardAutoClearSeconds` and nothing reads it. That is
// tracked as, and it is deliberately asserted here rather than left
// implicit - a smoke that still demanded a consumer would be a reason not to
// fix the gap, and one that said nothing would let the gap go quiet.
const vpk = readFileSync(join(routes, 'ViewPrivateKey.jsx'), 'utf8');
assert.ok(!/clipboardAutoClearSeconds/.test(vpk),
    'ViewPrivateKey no longer reads the setting ( removed its Copy button)');
assert.ok(!/navigator\.clipboard/.test(vpk),
    'ViewPrivateKey writes no clipboard at all');

console.log('clipboard-auto-clear-setting smoke OK (schema + control guarded; the consumer is gone by  and the orphaned setting is )');
