// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const packages = join(root, 'packages');

function* cssModules(dir) {
    for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) yield* cssModules(path);
        else if (name.endsWith('.module.css')) yield path;
    }
}

function channels(hex) {
    const value = hex.slice(1);
    const expanded = value.length === 3 || value.length === 4
        ? [...value].map((digit) => digit + digit).join('')
        : value;
    return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
}

const semanticSelector = /(success|warn|error|danger|critical|info|positive|negative)/i;
const violations = [];

for (const path of cssModules(packages)) {
    const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!semanticSelector.test(rule[1])) continue;
        for (const declaration of rule[2].split(';')) {
            // A token-first fallback stays theme-responsive. A direct chromatic
            // literal bypasses the palette and cannot adapt to dark mode.
            if (declaration.includes('var(--xc-')) continue;
            for (const match of declaration.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
                const [red, green, blue] = channels(match[0]);
                if (red === green && green === blue) continue;
                violations.push(`${relative(root, path)}: ${rule[1].trim()} uses ${match[0]}`);
            }
        }
    }
}

assert.deepEqual(
    violations,
    [],
    `status rules use semantic tokens instead of raw chromatic hex:\n${violations.join('\n')}`,
);

console.log('OK: CSS module status colors use semantic tokens');
