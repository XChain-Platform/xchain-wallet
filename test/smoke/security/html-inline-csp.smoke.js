// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findInlineCspViolations } from '../../helpers/htmlCsp.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const extensionDir = join(root, 'packages', 'extension');
const htmlFiles = [
    join(root, 'packages', 'web', 'index.html'),
    join(root, 'packages', 'desktop', 'renderer', 'index.html'),
    ...readdirSync(extensionDir)
        .filter((file) => file.endsWith('.html'))
        .map((file) => join(extensionDir, file)),
];

for (const file of htmlFiles) {
    const violations = findInlineCspViolations(readFileSync(file, 'utf8'));
    assert.deepEqual(
        violations,
        [],
        `${relative(root, file)} contains code blocked by a strict script-src CSP: ${JSON.stringify(violations)}`,
    );
}

console.log(`html-inline-csp smoke OK (${htmlFiles.length} entry documents scanned)`);
