// Smoke for §35 Settings — Step 10 — Network & Endpoints panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'NetworkEndpointsSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

const src = readFileSync(sectionPath, 'utf8');

assert.match(src, /import \{ useSettings \}/, 'imports useSettings');
assert.match(
    src,
    /import \{ registry as registryLib \} from '@xchain-wallet\/core'/,
    'imports chain registry',
);
assert.match(
    src,
    /chainRegistry\.supportedChains\(\)/,
    'iterates registry.supportedChains',
);
assert.match(
    src,
    /update\(\{\s*sdkEndpoints:\s*\{\s*\[d\.id\]:\s*next\s*\}\s*\}\)/,
    'writes through nested per-chain patch',
);

// Network-kind sort order: mainnet first, then testnet, then regtest.
assert.match(src, /mainnet:\s*0,\s*testnet:\s*1,\s*regtest:\s*2/, 'sort order constant present');

// Three URL fields per chain.
for (const label of ['Explorer URL', 'Encoder URL', 'Hub URL']) {
    assert.ok(src.includes(`label="${label}"`), `URL field labelled "${label}"`);
}

// Reset-to-default + Save controls
assert.match(src, /Reset to default/, 'Reset-to-default action present');
assert.match(src, /onClick=\{onCommit\}/, 'Save action wired (onCommit)');

// `custom` flag derived from whether draft equals defaults.
assert.match(src, /matchesDefault\b/, 'matchesDefault check present');
assert.match(src, /custom: !matchesDefault/, 'custom flag set when draft diverges from defaults');

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ NetworkEndpointsSection \}/, 'Settings.jsx imports section');
const idx = settingsSrc.indexOf("id: 'network-endpoints'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*NetworkEndpointsSection/);

console.log('settings-network-endpoints smoke OK');
