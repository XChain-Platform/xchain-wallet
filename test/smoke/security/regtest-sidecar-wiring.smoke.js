// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke: both store-capable shells wire the regtest-sidecar strip plugin.
//
// regtestSidecarPlugin is the only guard between the regtest full-node sidecar
// and a store build (mobile ships the web dist verbatim, so it inherits the web
// wiring). Its unit test proves the plugin; this proves each vite config imports
// it and calls it with the resolved profile on a line that is not commented out.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...parts) => readFileSync(join(wsRoot, 'packages', ...parts), 'utf8');

const LOST = 'the store build would lose its only regtest-sidecar guard';

const webSrc = read('web', 'vite.config.js');
assert.match(webSrc, /^import \{ regtestSidecarPlugin \} from '\.\/regtestSidecar\.js';?$/m,
    `packages/web/vite.config.js no longer imports regtestSidecarPlugin: ${LOST}`);
assert.match(webSrc, /^const BUILD_PROFILE = resolveBuildProfile\(\);?$/m,
    `packages/web/vite.config.js no longer resolves BUILD_PROFILE: ${LOST}`);
assert.match(webSrc, /^\s*regtestSidecarPlugin\(BUILD_PROFILE\),?\s*$/m,
    `packages/web/vite.config.js no longer calls regtestSidecarPlugin(BUILD_PROFILE): ${LOST}`);

const extSrc = read('extension', 'vite.config.js');
assert.match(extSrc, /^import \{ regtestSidecarPlugin \} from '\.\.\/web\/regtestSidecar\.js';?$/m,
    `packages/extension/vite.config.js no longer imports regtestSidecarPlugin: ${LOST}`);
assert.match(extSrc, /^\s*regtestSidecarPlugin\(resolveBuildProfile\(\)\),?\s*$/m,
    `packages/extension/vite.config.js no longer calls regtestSidecarPlugin(resolveBuildProfile()): ${LOST}`);

console.log('regtest-sidecar wiring smoke OK');
