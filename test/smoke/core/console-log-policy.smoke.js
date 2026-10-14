// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const sourceRoot = join(root, 'packages', 'core', 'src');
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const devOnlyAllowlist = new Set([
    'shared/components/LogConsole.jsx',
    'shared/utils/logConsole.js',
]);

function sourceFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...sourceFiles(path));
        else if (sourceExtensions.has(extname(entry.name))) files.push(path);
    }
    return files;
}

const violations = sourceFiles(sourceRoot)
    .map((path) => ({
        path,
        relativePath: relative(sourceRoot, path),
        source: readFileSync(path, 'utf8'),
    }))
    .filter(({ relativePath, source }) => (
        !devOnlyAllowlist.has(relativePath) && /\bconsole\s*\.\s*log\b/.test(source)
    ))
    .map(({ relativePath }) => relativePath);

assert.deepEqual(
    violations,
    [],
    `shipped core source must not use console.log: ${violations.join(', ')}`,
);

console.log('OK: shipped core source contains no console.log usage');
