// Smoke for §35 Settings — Step 5 — Language & Region panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'LanguageRegionSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

const src = readFileSync(sectionPath, 'utf8');

// useSettings + write paths
assert.match(src, /import \{ useSettings \}/, 'imports useSettings');
assert.match(src, /update\(\{\s*language:\s*next\s*\}\)/, 'language write through update({ language })');
assert.match(src, /update\(\{\s*fiatCurrency:\s*next\s*\}\)/, 'currency picker write through update({ fiatCurrency })');
assert.match(src, /update\(\{\s*fiatCurrency:\s*code\s*\}\)/, 'custom currency input write through update');

// Language picker present
assert.match(src, /value:\s*'en'/, 'English language option');
assert.match(src, /label:\s*'English'/, 'English label');

// Currency picker covers a sensible breadth of common codes
for (const code of ['USD', 'EUR', 'GBP', 'JPY']) {
    assert.ok(src.includes(`value: '${code}'`), `FIAT_CURRENCIES has '${code}'`);
}
assert.match(src, /__custom__/, 'custom currency sentinel present');
assert.match(src, /placeholder="ISO code"/, 'custom currency input has ISO-code placeholder');

// Loading / error guards
assert.match(src, /loading\)\s*return\s*<Status/, 'loading state renders Status');
assert.match(src, /error\)\s*return\s*<Status/, 'error state renders Status');

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ LanguageRegionSection \}/, 'Settings.jsx imports LanguageRegionSection');
const idx = settingsSrc.indexOf("id: 'language-region'");
assert.ok(idx >= 0, 'language-region section literal present');
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/, 'flipped to panel');
assert.match(block, /Component:\s*LanguageRegionSection/, 'wires LanguageRegionSection');

console.log('settings-language-region smoke OK');
