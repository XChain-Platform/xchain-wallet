// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const viteConfig = readFileSync(resolve(repoRoot, 'packages/web/vite.config.js'), 'utf8');

const limitMatch = viteConfig.match(/WEB_ENTRY_CHUNK_SIZE_LIMIT\s*=\s*([\d_]+)/);
assert.ok(limitMatch, 'web build declares a main entry chunk size limit');

const limit = Number(limitMatch[1].replaceAll('_', ''));
assert.equal(limit, 1_000_000, 'web main entry chunk ceiling remains 1,000,000 bytes');
assert.match(
    viteConfig,
    /output\.isEntry[\s\S]{0,100}?output\.name === 'index'/,
    'entry chunk guard identifies the main index entry',
);
assert.match(
    viteConfig,
    /Buffer\.byteLength\(entry\.code\)/,
    'entry chunk guard measures emitted bytes',
);
assert.ok(
    viteConfig.includes('entryChunkSizePlugin,'),
    'web build enables the entry chunk size guard',
);
assert.match(
    viteConfig,
    /manualChunks[\s\S]{0,200}?\/node_modules\/\.pnpm\/qrcode@/,
    'web build keeps the shared QR encoder in a route-loaded chunk',
);
assert.match(
    viteConfig,
    /moduleSideEffects[\s\S]{0,200}?\/node_modules\/\.pnpm\/qrcode@/,
    'unused UI barrel exports do not preload the QR encoder',
);

console.log('web-entry-chunk-size smoke: 6 passed');
