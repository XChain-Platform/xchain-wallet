// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sourceRoot = join(wsRoot, 'packages', 'core', 'src');

function cssFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssFiles(path);
        return entry.name.endsWith('.css') ? [path] : [];
    });
}

const textContainer = /(?:^|\s|[>+~])\.(?:bar|banner|body|card|chipGroup|content|description|header|item|label|message|netSelect|readOnlyValue|row|search|searchInput|summary|tab|title)\b/;
const fixedLengthHeight = /(?:^|;)\s*height\s*:\s*(?:\d*\.)?\d+(?:px|r?em)\b/;
const violations = [];

for (const path of cssFiles(sourceRoot)) {
    const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1].trim().replace(/\s+/g, ' ');
        const declarations = match[2];
        if (!textContainer.test(selector) || !fixedLengthHeight.test(declarations)) continue;

        const visuallyHidden = /(?:^|[\s.])(sr-only|srOnly)\b/.test(selector)
            || (/width:\s*1px/.test(declarations) && /clip(?:-path)?:/.test(declarations));
        if (!visuallyHidden) {
            violations.push(`${relative(wsRoot, path)}: ${selector}`);
        }
    }
}

assert.deepEqual(
    violations,
    [],
    `text containers use min-height or content sizing, not fixed lengths:\n${violations.join('\n')}`,
);

console.log('OK: reflow fixed-height smoke (text containers grow with wrapped or enlarged text)');
