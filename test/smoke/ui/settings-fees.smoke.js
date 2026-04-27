// Smoke for §35 Settings — Step 9 — Fees panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'FeesSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');
const schemaPath = join(wsRoot, 'packages', 'core', 'src', 'schemas', 'settings.js');

const src = readFileSync(sectionPath, 'utf8');
const schemaSrc = readFileSync(schemaPath, 'utf8');

assert.match(src, /import \{ useSettings \}/, 'imports useSettings');
assert.match(
    src,
    /import \{ registry as registryLib \} from '@xchain-wallet\/core'/,
    'imports chain registry',
);
assert.match(
    src,
    /update\(\{\s*fees:\s*\{\s*\[chainId\]:\s*patch\s*\}\s*\}\)/,
    'fees writes through nested per-chain patch',
);

// Strategies cover the schema's FEE_STRATEGIES tuple
const strategiesMatch = /export const FEE_STRATEGIES = \/\*\* @type \{const\} \*\/ \(\[([^\]]+)\]\);/.exec(schemaSrc);
assert.ok(strategiesMatch, 'schema exports FEE_STRATEGIES tuple');
const schemaStrategies = strategiesMatch[1]
    .split(',')
    .map((s) => s.replace(/['"\s]/g, ''))
    .filter(Boolean);
assert.deepEqual(schemaStrategies, ['low', 'normal', 'fast', 'custom'], 'schema strategies as expected');
for (const s of schemaStrategies) {
    assert.ok(src.includes(`value: '${s}'`), `STRATEGIES has '${s}'`);
}

// Custom rate input visible only when strategy='custom'
assert.match(src, /fees\.strategy === 'custom'/, 'custom-rate input gated on custom strategy');
assert.match(src, /sats \/ KB/, 'custom rate is sats/KB');

// RBF toggle present and disabled when descriptor doesn't support RBF
assert.match(src, /label="RBF by default"/, 'RBF toggle present');
assert.match(src, /disabled=\{!descriptor\?\.feeStrategy\?\.rbfSupported\}/, 'RBF toggle gates on chain support');

// Empty-state message when no fee profiles present
assert.match(src, /No chain fee profiles yet/, 'empty-state copy present');

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ FeesSection \}/, 'Settings.jsx imports FeesSection');
const idx = settingsSrc.indexOf("id: 'fees'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/);
assert.match(block, /Component:\s*FeesSection/);

console.log('settings-fees smoke OK');
