// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { colorMixFallback } from '../../../packages/web/cssFallbacks.js';
import { findChrome102CssIssues } from '../../helpers/chrome102CssAudit.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const requireFromVite = createRequire(
    createRequire(join(repo, 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');
const viteConfig = readFileSync(join(repo, 'packages', 'web', 'vite.config.js'), 'utf8');
const files = execFileSync(
    'git', ['ls-files', '*.module.css', '**/tokens.css', 'tokens.css'],
    { cwd: repo, encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

assert.match(
    viteConfig,
    /postcss:\s*\{\s*plugins:\s*\[colorMixFallback\(\)\]\s*\}/,
    'the web build applies the color-mix fallback before the compatibility audit',
);
assert.ok(files.length > 100, 'the Chrome 102 audit scans the complete CSS module and token inventory');

const failures = [];
for (const file of files) {
    const css = readFileSync(join(repo, file), 'utf8');
    const result = postcss([colorMixFallback()]).process(css, { from: join(repo, file) }).sync();
    for (const issue of findChrome102CssIssues(result.root)) {
        failures.push(`${file}:${issue.line}: ${issue.feature} needs a fallback or @supports guard`);
    }
}

assert.deepEqual(failures, [], failures.join('\n'));
console.log(`chrome102-css smoke OK (${files.length} files)`);
