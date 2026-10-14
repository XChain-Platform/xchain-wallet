// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 Settings, Step 7: Safety panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'SafetySection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

const src = readFileSync(sectionPath, 'utf8');

assert.match(src, /import \{ useSettings \}/, 'imports useSettings');
assert.match(
    src,
    /update\(\{\s*autolockMinutes:\s*Number\(next\)\s*\}\)/,
    'autolock writes through update({ autolockMinutes })',
);

// Undo-send was scrapped v0.132.0; the row + its handler are gone.
// (Comments may still reference the dead schema field.
// settings.grace.undoSendSeconds stays writable until v3, per settings
// close FOLLOWUP 12; we check for actionable wiring, not substrings.)
assert.doesNotMatch(src, /aria-label="Undo-send grace"/, 'undo-send <select> removed');
assert.doesNotMatch(src, /onUndoSendChange/, 'undo-send handler removed');
assert.doesNotMatch(src, /UNDO_SEND_OPTIONS/, 'undo-send option list removed');

// Sensible coverage of common autolock option values
for (const v of [1, 5, 15, 60]) {
    assert.ok(src.includes(`value: ${v},`), `AUTOLOCK_OPTIONS includes ${v}`);
}
assert.ok(src.includes('value: 0'), 'autolock supports 0 (never)');

// Live rows: test-send warning, always-on recipient protection, biometric
// unlock, panic-mode activation, and automatic backup reminders.
assert.match(src, /New-recipient test-send warning \(sats\)/, 'test-send warning row present');
assert.match(src, /testSendThresholdSats:\s*threshold/, 'test-send writes through grace.testSendThresholdSats');
assert.match(src, /native-coin sends above this amount/, 'test-send threshold explains its scope');
assert.match(src, /outside your contacts\s*and send history/, 'test-send threshold explains recipient novelty');
assert.match(src, /Lookalike address warnings/, 'lookalike warning status is present');
assert.match(src, /Always on/, 'lookalike warnings are not presented as optional');
assert.match(src, /<BiometricRow \/>/, 'biometric unlock row mounted');
assert.match(src, /<PanicModeRow \/>/, 'panic-mode activation row mounted');
// The auto-arm toggle was removed: nothing reads panicMode.enabled, so the
// section must not offer a preference that does nothing.
assert.doesNotMatch(src, /Auto-arm panic mode/, 'no auto-arm toggle (no code delivers auto-arming)');
assert.doesNotMatch(src, /panicMode:\s*\{\s*enabled/, 'Safety section does not write panicMode.enabled');
assert.match(src, /Backup reminders/, 'backup reminders row present');
assert.match(src, /wallets without a verified recovery phrase/, 'backup reminders describe actual automatic scope');
assert.doesNotMatch(src, /backupReminders:\s*e\.target\.value/, 'ignored backup cadence is not offered');

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ SafetySection \}/, 'Settings.jsx imports SafetySection');
const idx = settingsSrc.indexOf("id: 'safety'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*SafetySection/);

console.log('settings-safety smoke OK');
