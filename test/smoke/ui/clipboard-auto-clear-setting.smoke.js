// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §17.7.1 / G028 as it stands after.
//
// The setting was born with two halves: a schema field with bounds, and a
// Privacy-panel number input that ViewPrivateKey read to time its post-copy
// clipboard wipe. a later change removed the Copy button, killing the only reader;
// (operator ruling a, 2026-08-11) then removed the control, because a
// privacy switch that governs nothing misinforms the user who trusts it.
//
// What this smoke guards is therefore the SPLIT: the schema half survives for
// compatibility, and the UI half must stay gone. Both directions matter. A
// re-added input would resurrect the lie; a deleted schema field would turn
// stored settings into a migration.

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

// --- 2. PrivacySection offers NO clipboard control -------------
//
// Asserted by absence of every trace the control left behind, not just the
// label: a reworded row ("Clear clipboard after…") would slip past a
// label-only check while making exactly the same false promise.

const ps = readFileSync(join(components, 'settings', 'PrivacySection.jsx'), 'utf8');
const psBody = ps.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
assert.ok(!/Clipboard auto-clear/.test(psBody),
    'PrivacySection no longer renders a "Clipboard auto-clear" row');
assert.ok(!/onClipboardSecondsChange/.test(psBody),
    'PrivacySection has no clipboard-seconds change handler');
assert.ok(!/clipboardAutoClearSeconds/.test(psBody),
    'PrivacySection neither reads nor writes settings.privacy.clipboardAutoClearSeconds');
assert.ok(!/CLIPBOARD_AUTO_CLEAR_/.test(psBody),
    'PrivacySection imports none of the clipboard bounds any more');
// The rest of the panel is untouched: this was a removal, not a rewrite.
assert.ok(/Change-address rotation/.test(psBody) && /Form draft retention/.test(psBody),
    'the surrounding Privacy rows survive the removal');

// --- 3. Private-key copies use the fixed sensitive clipboard policy -------
//
// The settings control stays absent. Private-key copies use the shared
// sensitive clipboard TTL so native expiry and the browser clear agree.
const vpk = readFileSync(join(routes, 'ViewPrivateKey.jsx'), 'utf8');
assert.ok(!/clipboardAutoClearSeconds/.test(vpk),
    'ViewPrivateKey does not promise a configurable clipboard timeout');
assert.ok(!/navigator\.clipboard/.test(vpk),
    'ViewPrivateKey never writes directly to the browser clipboard');
assert.ok(/<CopyButton[\s\S]*?sensitive/.test(vpk),
    'ViewPrivateKey marks private-key copies sensitive');
assert.ok(/SENSITIVE_CLIP_TTL_SECONDS/.test(vpk) && /clearClipboard\(\)/.test(vpk),
    'ViewPrivateKey clears sensitive copies at the shared TTL');

console.log('clipboard-auto-clear-setting smoke OK (schema field retained; private-key copy uses fixed sensitive expiry)');
