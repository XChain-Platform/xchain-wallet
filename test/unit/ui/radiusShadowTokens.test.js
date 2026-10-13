// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const tokensPath = join(repoRoot, 'packages', 'core', 'src', 'ui', 'tokens.css');
const coreSrcDir = join(repoRoot, 'packages', 'core', 'src');
const tokensCss = readFileSync(tokensPath, 'utf8');

const expectedTokens = new Map([
    ['--xc-radius-xs', '2px'],
    ['--xc-radius-control', 'var(--xc-control-radius)'],
    ['--xc-border-strong', 'var(--xc-border)'],
    ['--xc-shadow-sm', '0 1px 2px rgba(15, 23, 42, 0.06)'],
    ['--xc-shadow-md', '0 4px 12px rgba(15, 23, 42, 0.08)'],
    ['--xc-shadow-modal', '0 16px 40px rgba(0, 0, 0, 0.35)'],
    ['--xc-shadow-surface-ring', '0 0 0 1.5px var(--xc-surface)'],
    ['--xc-shadow-accent-ring', '0 0 0 1px var(--xc-accent-primary, var(--xc-border-strong))'],
    ['--xc-shadow-focus-ring', '0 0 0 3px var(--xc-focus-ring)'],
    ['--xc-shadow-danger-focus-ring', '0 0 0 3px rgba(220, 38, 38, 0.2)'],
    ['--xc-shadow-nav-indicator', 'inset 3px 0 0 var(--xc-accent-primary, var(--xc-text))'],
]);

const elevationAliases = new Map([
    ['--xc-shadow-header-menu', '--xc-shadow-md'],
    ['--xc-shadow-toast', '--xc-shadow-md'],
    ['--xc-shadow-popover', '--xc-shadow-md'],
    ['--xc-shadow-side-panel', '--xc-shadow-modal'],
    ['--xc-shadow-bottom-sheet', '--xc-shadow-modal'],
]);

function readModuleCss(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return readModuleCss(path);
        if (!entry.name.endsWith('.module.css')) return [];
        return [{ path: relative(repoRoot, path), source: readFileSync(path, 'utf8') }];
    });
}

function isRawElevation(value) {
    const shadow = value.trim();
    if (/^var\(--[\w-]+\)$/.test(shadow) || shadow === 'none') return false;
    if (/^inset\b/.test(shadow)) return false;
    return !/^0(?:[a-z%]+)?\s+0(?:[a-z%]+)?(?:\s|$)/i.test(shadow);
}

function findRawElevationShadows(files) {
    return files.flatMap(({ path, source }) => source.split('\n').flatMap((line, index) => {
        const declaration = /\bbox-shadow:\s*([^;]+);/.exec(line);
        if (!declaration || !isRawElevation(declaration[1])) return [];
        return [`${path}:${index + 1}`];
    }));
}

describe('shared component radius and shadow tokens', () => {
    it('defines the shared elevation scale and non-elevation effects', () => {
        for (const [token, value] of expectedTokens) {
            expect(tokensCss).toContain(`${token}: ${value};`);
        }
    });

    it('maps semantic surface shadows onto three elevation levels', () => {
        for (const [alias, elevation] of elevationAliases) {
            expect(tokensCss).toContain(`${alias}: var(${elevation});`);
        }
    });

    it('recognizes raw drop shadows while leaving rings and inset strokes alone', () => {
        const files = [{
            path: 'Fixture.module.css',
            source: [
                '.token { box-shadow: var(--xc-shadow-md); }',
                '.drop { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); }',
                '.fallback { box-shadow: var(--xc-shadow-md, 0 4px 12px #000); }',
                '.ring { box-shadow: 0 0 0 2px currentColor; }',
                '.inset { box-shadow: inset 1px 0 0 currentColor; }',
            ].join('\n'),
        }];

        expect(findRawElevationShadows(files)).toEqual([
            'Fixture.module.css:2',
            'Fixture.module.css:3',
        ]);
    });

    it('keeps shared module CSS free of raw elevation shadows', () => {
        expect(findRawElevationShadows(readModuleCss(coreSrcDir))).toEqual([]);
    });
});
