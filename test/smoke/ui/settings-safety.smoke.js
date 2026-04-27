// Smoke for §35 Settings — Step 7 — Safety panel.

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

// Undo-send was scrapped v0.132.0 — the row + its handler are gone.
// (Comments may still reference the dead schema field —
// settings.grace.undoSendSeconds stays writable until v3, per settings
// close FOLLOWUP 12 — so we check for actionable wiring, not substrings.)
assert.doesNotMatch(src, /aria-label="Undo-send grace"/, 'undo-send <select> removed');
assert.doesNotMatch(src, /onUndoSendChange/, 'undo-send handler removed');
assert.doesNotMatch(src, /UNDO_SEND_OPTIONS/, 'undo-send option list removed');

// Sensible coverage of common autolock option values
for (const v of [1, 5, 15, 60]) {
    assert.ok(src.includes(`value: ${v},`), `AUTOLOCK_OPTIONS includes ${v}`);
}
assert.ok(src.includes('value: 0'), 'autolock supports 0 (never)');

// Three rows live now: test-send warning, panic mode, backup reminders.
assert.match(src, /Test-send warning \(sats\)/, 'test-send warning row present');
assert.match(src, /testSendThresholdSats:\s*n/, 'test-send writes through grace.testSendThresholdSats');
assert.match(src, /label="Panic mode"/, 'panic mode toggle present');
assert.match(src, /panicMode:\s*\{\s*enabled:\s*v\s*\}/, 'panic mode writes through panicMode.enabled');
assert.match(src, /Backup reminders/, 'backup reminders row present');
assert.match(src, /backupReminders:\s*e\.target\.value/, 'backup reminders writes through update');

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ SafetySection \}/, 'Settings.jsx imports SafetySection');
const idx = settingsSrc.indexOf("id: 'safety'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*SafetySection/);

console.log('settings-safety smoke OK');
