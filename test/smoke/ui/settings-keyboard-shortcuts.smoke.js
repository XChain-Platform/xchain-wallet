// Smoke for §35 Settings — Step 17 — Keyboard Shortcuts panel (preview).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'KeyboardShortcutsSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

const src = readFileSync(sectionPath, 'utf8');
const settingsSrc = readFileSync(settingsPath, 'utf8');

assert.match(src, /PLANNED_SHORTCUTS/, 'planned-shortcut table present');
for (const keys of ['?', 'Cmd \\/ Ctrl \\+ K', 'Esc', 'g h']) {
    assert.match(src, new RegExp(`keys:\\s*'${keys}'`), `shortcut for ${keys} present`);
}
assert.match(src, /not yet active/, 'each row labelled as not yet active');
assert.match(src, /Rebind controls land/, 'leading status message explains deferred rebind');

assert.match(settingsSrc, /import \{ KeyboardShortcutsSection \}/, 'Settings.jsx imports section');
const idx = settingsSrc.indexOf("id: 'keyboard'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/);
assert.match(block, /Component:\s*KeyboardShortcutsSection/);

console.log('settings-keyboard-shortcuts smoke OK');
