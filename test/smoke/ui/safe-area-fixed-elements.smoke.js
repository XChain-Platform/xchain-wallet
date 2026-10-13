// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Viewport-positioned content does not inherit the body's safe-area padding.
// Keep each fixed or sticky source block responsible for an inset, with one
// explicit exception for a backdrop that contains no content of its own, and
// one for a sticky block marked safe-area-in-container: it sticks inside a
// route scroll container that already sits within the body's safe-area padding.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sourceRoot = join(wsRoot, 'packages');
const sourceExtensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx']);
const positionedBlock = /([^{}]+)\{([^{}]*\bposition\s*:\s*(?:fixed|sticky|['"]fixed['"]|['"]sticky['"])\s*[,;][^{}]*)\}/g;

function sourceFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return sourceExtensions.has(extname(entry.name)) ? [path] : [];
    });
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (comment) => (
            comment.includes('safe-area-backdrop') ? '/* safe-area-backdrop */'
                : comment.includes('safe-area-in-container') ? '/* safe-area-in-container */' : ''
        ))
        .replace(/\/\/.*$/gm, '');
}

const failures = [];
let checked = 0;

for (const path of sourceFiles(sourceRoot)) {
    const source = stripComments(readFileSync(path, 'utf8'));
    for (const match of source.matchAll(positionedBlock)) {
        checked += 1;
        const block = match[2];
        if (/env\(safe-area-inset-(?:top|right|bottom|left)/.test(block)) continue;
        if (block.includes('safe-area-backdrop')) continue;
        if (/\bposition\s*:\s*sticky\b/.test(block) && block.includes('safe-area-in-container')) continue;

        const owner = match[1].trim().split('\n').at(-1).trim();
        failures.push(`${relative(wsRoot, path)}: ${owner}`);
    }
}

assert.ok(checked >= 10, `safe-area audit found only ${checked} fixed/sticky blocks`);
assert.deepEqual(
    failures,
    [],
    `fixed/sticky blocks need env(safe-area-inset-*) or a content-free backdrop marker:\n${failures.join('\n')}`,
);

console.log(`safe-area-fixed-elements smoke OK (${checked} blocks)`);
