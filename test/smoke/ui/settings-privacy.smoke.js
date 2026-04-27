// Smoke for §35 Settings — Step 6 — Privacy panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'PrivacySection.jsx');
const primitivesPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', '_settingsPrimitives.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

const src = readFileSync(sectionPath, 'utf8');

assert.match(src, /import \{ useSettings \}/, 'imports useSettings');
assert.match(
    src,
    /update\(\{\s*privacy:\s*\{\s*\[field\]:\s*next\s*\}\s*\}\)/,
    'privacy writes go through update({ privacy: { [field]: next } }) — nested merge',
);

// All three live toggles
for (const field of ['torRouting', 'changeAddressRotation', 'hideSmallBalances']) {
    assert.ok(
        src.includes(`onToggle('${field}'`),
        `toggle for privacy.${field} present`,
    );
}

// Two deferred rows render disabled toggles with "Coming soon" hints.
assert.match(src, /Blur sensitive data on blur/, 'blur-on-blur deferred row present');
assert.match(src, /Labels survive restore/, 'labels-survive-restore deferred row present');
const deferredCount = (src.match(/Coming soon/g) || []).length;
assert.ok(deferredCount >= 2, `at least 2 "Coming soon" hints (got ${deferredCount})`);
assert.match(src, /disabled\b/, 'deferred toggles use disabled prop');

// Primitives module exports what the section consumes.
const primSrc = readFileSync(primitivesPath, 'utf8');
for (const name of ['ROW', 'STACK', 'ROW_HINT', 'ToggleRow', 'Status']) {
    assert.match(
        primSrc,
        new RegExp(`export (const|function) ${name}\\b`),
        `_settingsPrimitives exports ${name}`,
    );
}
assert.match(primSrc, /role="switch"/, 'ToggleRow renders an aria switch');

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ PrivacySection \}/, 'Settings.jsx imports PrivacySection');
const idx = settingsSrc.indexOf("id: 'privacy'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/, 'flipped to panel');
assert.match(block, /Component:\s*PrivacySection/, 'wires PrivacySection');

console.log('settings-privacy smoke OK');
