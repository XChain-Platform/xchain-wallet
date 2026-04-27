// Smoke for §35 Settings — Step 4 — Appearance panel.
//
// Source-level checks: AppearanceSection wires `useSettings`, renders
// a Theme <select> with the three values (system, light, dark) the
// schema's THEMES tuple defines, and writes via `update({ theme })`.
// Settings.jsx flips the appearance section from stub to panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const appearancePath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'AppearanceSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');
const schemaPath = join(wsRoot, 'packages', 'core', 'src', 'schemas', 'settings.js');

// ─── 1. AppearanceSection wiring ─────────────────────────────────────

const src = readFileSync(appearancePath, 'utf8');
assert.match(
    src,
    /import \{ useSettings \} from '\.\.\/\.\.\/hooks\/useSettings\.js'/,
    'AppearanceSection imports useSettings',
);
assert.match(src, /export function AppearanceSection\(/, 'AppearanceSection is a named export');
assert.match(src, /update\(\{\s*theme:\s*next\s*\}\)/, 'theme write goes through update({ theme })');

// ─── 2. THEME_OPTIONS covers the schema's THEMES tuple ───────────────

const schemaSrc = readFileSync(schemaPath, 'utf8');
const themesMatch = /export const THEMES = \/\*\* @type \{const\} \*\/ \(\[([^\]]+)\]\);/.exec(schemaSrc);
assert.ok(themesMatch, 'schema exports THEMES tuple');
const schemaThemes = themesMatch[1]
    .split(',')
    .map((s) => s.replace(/['"\s]/g, ''))
    .filter(Boolean);
assert.deepEqual(schemaThemes, ['system', 'light', 'dark'], 'schema themes are the expected three');

for (const theme of schemaThemes) {
    assert.ok(
        src.includes(`value: '${theme}'`),
        `AppearanceSection has THEME_OPTIONS entry for '${theme}'`,
    );
}

// ─── 3. Loading / error / no-settings status surfaces ────────────────

assert.match(src, /loading\)\s*return\s*<Status/, 'loading state renders Status');
assert.match(src, /error\)\s*return\s*<Status/, 'error state renders Status');

// ─── 4. Reduced motion is live (schema v2); accent color still deferred

assert.match(src, /Reduced motion/, 'Reduced motion row present');
assert.match(src, /update\(\{\s*reducedMotion:\s*next\s*\}\)/, 'reducedMotion writes through update');
assert.match(src, /value:\s*'auto'/, 'auto option present');
assert.match(src, /value:\s*'always'/, 'always option present');
assert.match(src, /value:\s*'never'/, 'never option present');
assert.match(src, /Accent color/, 'Accent color row present');
assert.match(src, /finalized at brand cut/, 'accent-color deferral copy');

// ─── 5. Settings.jsx wires AppearanceSection as the appearance panel ─

const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(
    settingsSrc,
    /import \{ AppearanceSection \} from '\.\.\/components\/settings\/AppearanceSection\.jsx'/,
    'Settings.jsx imports AppearanceSection',
);
const idx = settingsSrc.indexOf("id: 'appearance'");
assert.ok(idx >= 0, 'appearance section literal present');
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/, 'appearance section flipped to panel');
assert.match(block, /Component:\s*AppearanceSection/, 'appearance section wires AppearanceSection');

console.log('settings-appearance smoke OK');
