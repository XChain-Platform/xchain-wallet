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
const budgetSource = readFileSync(resolve(repoRoot, 'packages/web/bundleBudget.js'), 'utf8');

const jsLimitMatch = budgetSource.match(/WEB_INITIAL_JS_SIZE_LIMIT\s*=\s*([\d_]+)/);
assert.ok(jsLimitMatch, 'web build declares an initial JavaScript size limit');
assert.equal(
    Number(jsLimitMatch[1].replaceAll('_', '')),
    905_000,
    'web initial JavaScript ceiling remains 905,000 bytes',
);

const cssLimitMatch = budgetSource.match(/WEB_INITIAL_CSS_SIZE_LIMIT\s*=\s*([\d_]+)/);
assert.ok(cssLimitMatch, 'web build declares an initial CSS size limit');
assert.equal(
    Number(cssLimitMatch[1].replaceAll('_', '')),
    120_000,
    'web initial CSS ceiling remains 120,000 bytes',
);
assert.match(
    budgetSource,
    /output\.isEntry[\s\S]{0,100}?output\.name === entryName/,
    'initial bundle guard identifies the main index entry',
);
assert.match(
    budgetSource,
    /for \(const fileName of chunk\.imports\)/,
    'initial bundle guard follows static chunk imports',
);
assert.ok(
    viteConfig.includes('initialBundleSizePlugin,'),
    'web build enables the initial bundle size guard',
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

console.log('web-entry-chunk-size smoke: 9 passed');
