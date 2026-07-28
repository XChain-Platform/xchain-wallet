// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 Settings, Step 10: Network & Endpoints panel.

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
    /import \{ registry as registryLib(?:, sdk as sdkLib)? \} from '@xchain-wallet\/core'/,
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

// : the draft carries the port, and the override the user saves is
// consumed by SDKRegistry rather than persisted into a void.
assert.match(src, /sdkLib\.joinEndpoint\(descriptor\.explorer\)/, 'draft seeded with the joined default URL');
assert.ok(!/descriptor\.explorer\?\.defaultUrl/.test(src), 'no bare defaultUrl seeding (drops the port)');
assert.match(src, /function endpointError\(/, 'endpoint URLs are validated before they persist');

const registryPath = join(wsRoot, 'packages', 'core', 'src', 'sdk', 'SDKRegistry.js');
const registrySrc = readFileSync(registryPath, 'utf8');
assert.match(registrySrc, /applyEndpointOverridesFromSettings\(settings\)/, 'registry adopts Settings overrides');

const hostPath = join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
const hostSrc = readFileSync(hostPath, 'utf8');
assert.match(hostSrc, /applyEndpointOverridesFromVault\(/, 'host applies the persisted overrides');
assert.match(
    hostSrc,
    /hasOwnProperty\.call\(patch, 'sdkEndpoints'\)/,
    'a settings.update carrying sdkEndpoints re-applies them',
);

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ NetworkEndpointsSection \}/, 'Settings.jsx imports section');
const idx = settingsSrc.indexOf("id: 'network-endpoints'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*NetworkEndpointsSection/);

console.log('settings-network-endpoints smoke OK');
