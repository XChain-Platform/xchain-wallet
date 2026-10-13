// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const coreSource = join(process.cwd(), 'packages', 'core', 'src');
const requireFromVite = createRequire(
    createRequire(join(process.cwd(), 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const physicalProperties = new Set([
    'margin-left',
    'margin-right',
    'padding-left',
    'padding-right',
    'left',
    'right',
    'border-left',
    'border-left-color',
    'border-left-style',
    'border-left-width',
    'border-right',
    'border-right-color',
    'border-right-style',
    'border-right-width',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-left-radius',
    'border-bottom-right-radius',
]);

function cssModules(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModules(path);
        return entry.name.endsWith('.module.css') ? [path] : [];
    });
}

function physicalDeclarations(source, from = 'Fixture.module.css') {
    const findings = [];
    postcss.parse(source, { from }).walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        const value = declaration.value.trim().toLowerCase();
        if (physicalProperties.has(property)
            || (property === 'text-align' && /^(?:left|right)$/.test(value))) {
            findings.push({
                property,
                value,
                line: declaration.source.start.line,
            });
        }
    });
    return findings;
}

describe('core CSS module logical properties', () => {
    it('detects physical inline-axis declarations regardless of formatting', () => {
        const source = [
            '.a { margin-left: 1rem; right: 0; }',
            '.b { text-align: right; border-top-left-radius: 2px; }',
        ].join('\n');

        expect(physicalDeclarations(source)).toEqual([
            { property: 'margin-left', value: '1rem', line: 1 },
            { property: 'right', value: '0', line: 1 },
            { property: 'text-align', value: 'right', line: 2 },
            { property: 'border-top-left-radius', value: '2px', line: 2 },
        ]);
    });

    it('uses logical inline-axis declarations throughout core CSS modules', () => {
        const modules = cssModules(coreSource);
        const findings = modules.flatMap((file) => (
            physicalDeclarations(readFileSync(file, 'utf8'), file).map((finding) => ({
                file: relative(process.cwd(), file),
                ...finding,
            }))
        ));

        expect(modules.length).toBeGreaterThan(0);
        expect(findings).toEqual([]);
    });
});
