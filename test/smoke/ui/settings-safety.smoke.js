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
assert.match(
    src,
    /update\(\{\s*grace:\s*\{\s*undoSendSeconds:\s*Number\(next\)\s*\}\s*\}\)/,
    'undo-send writes through nested grace patch',
);

// Sensible coverage of common autolock / undo-send option values
for (const v of [1, 5, 15, 60]) {
    assert.ok(src.includes(`value: ${v},`), `AUTOLOCK_OPTIONS includes ${v}`);
}
assert.ok(src.includes('value: 0'), 'autolock supports 0 (never)');
for (const v of [3, 5, 10, 15]) {
    const re = new RegExp(`{\\s*value:\\s*${v},\\s*label:\\s*'${v}\\s*seconds'\\s*\\}`);
    assert.match(src, re, `UNDO_SEND_OPTIONS has ${v}-second entry`);
}

// Three deferred rows
for (const label of ['Test-send warning', 'Panic mode', 'Backup reminders']) {
    assert.ok(src.includes(`label="${label}"`), `${label} deferred row present`);
}
const comingSoonCount = (src.match(/Coming soon/g) || []).length;
assert.ok(comingSoonCount >= 3, `at least 3 "Coming soon" hints (got ${comingSoonCount})`);

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ SafetySection \}/, 'Settings.jsx imports SafetySection');
const idx = settingsSrc.indexOf("id: 'safety'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/);
assert.match(block, /Component:\s*SafetySection/);

console.log('settings-safety smoke OK');
