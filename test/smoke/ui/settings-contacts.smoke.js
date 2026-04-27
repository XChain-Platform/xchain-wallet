// Smoke for §35 Settings — Step 15 — Contacts panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'ContactsSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

const src = readFileSync(sectionPath, 'utf8');

assert.match(src, /messaging\.listContacts\(\)/, 'lists contacts via messaging');
assert.match(src, /messaging\.saveContact\(\{\s*record\s*\}\)/, 'imports via saveContact({ record })');

// Export uses Blob + JSON.stringify
assert.match(src, /JSON\.stringify\(/, 'serializes to JSON');
assert.match(src, /new Blob\(/, 'wraps in Blob for download');
assert.match(src, /\.json/, 'download filename has .json');

// Import path: file input + JSON.parse + Array check
assert.match(src, /type="file"/, 'file input present');
assert.match(src, /accept="application\/json,\.json"/, 'restricts to JSON files');
assert.match(src, /JSON\.parse\(/, 'parses imported text');
assert.match(src, /Array\.isArray\(parsed\)/, 'rejects non-arrays');

// Counts + status + error rendering
assert.match(src, /contact\$\{count === 1 \? '' : 's'\}/, 'pluralises contact count');
assert.match(src, /Imported \$\{imported\}/, 'reports imported count');

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ ContactsSection \}/, 'Settings.jsx imports section');
const idx = settingsSrc.indexOf("id: 'contacts'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/);
assert.match(block, /Component:\s*ContactsSection/);

console.log('settings-contacts smoke OK');
