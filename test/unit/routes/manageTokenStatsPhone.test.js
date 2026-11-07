// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Manage token's stats and action grids stay one-up below the 834px tablet
// boundary, then gain columns only when the shell has room for them.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withEnglishCopy } from '../../helpers/englishSource.js';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const requireFromVite = createRequire(
    createRequire(join(repoRoot, 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const cssPath = join(repoRoot, 'packages/core/src/shared/routes/ManageToken.module.css');
const jsxPath = join(repoRoot, 'packages/core/src/shared/routes/ManageToken.jsx');

function mediaRules(pattern) {
    const root = postcss.parse(readFileSync(cssPath, 'utf8'));
    const rules = [];
    root.walkAtRules('media', (media) => {
        if (!pattern.test(media.params)) return;
        media.walkRules((rule) => {
            const decls = {};
            rule.walkDecls((d) => { decls[d.prop] = d.value; });
            rules.push({ selector: rule.selector, decls });
        });
    });
    return rules;
}

describe('Manage token stats strip', () => {
    it('lays the strip out one-up below 834px, two-up from 834px, and four-up from 1024px', () => {
        const root = postcss.parse(readFileSync(cssPath, 'utf8'));
        let base = null;
        let tablet = null;
        let wide = null;
        root.walkRules('.statsStrip', (rule) => {
            rule.walkDecls('grid-template-columns', (d) => {
                if (rule.parent.type === 'root') base = d.value;
                else if (/^\(min-width:\s*834px\)$/.test(rule.parent.params)) tablet = d.value;
                else if (/^\(min-width:\s*1024px\)$/.test(rule.parent.params)) wide = d.value;
            });
        });
        expect(base).toBe('minmax(0, 1fr)');
        expect(tablet).toBe('repeat(2, minmax(0, 1fr))');
        expect(wide).toBe('repeat(4, minmax(0, 1fr))');
    });

    it('keeps management actions one-up below 834px', () => {
        const root = postcss.parse(readFileSync(cssPath, 'utf8'));
        let base = null;
        root.walkRules('.manageGrid', (rule) => {
            if (rule.parent.type !== 'root') return;
            rule.walkDecls('grid-template-columns', (d) => { base = d.value; });
        });
        const tablet = mediaRules(/^\(min-width:\s*834px\)$/)
            .find((rule) => rule.selector === '.manageGrid');

        expect(base).toBe('minmax(0, 1fr)');
        expect(tablet?.decls['grid-template-columns']).toBe('repeat(4, minmax(0, 1fr))');
    });

    it('renders supply and holding as the first two cells', () => {
        const source = withEnglishCopy(readFileSync(jsxPath, 'utf8'));
        const strip = source.slice(source.indexOf('className={styles.statsStrip}'));
        const labels = [...strip.matchAll(/className=\{styles\.statLabel\}>\s*([^<]+?)\s*</g)]
            .map((m) => m[1].trim());
        expect(labels[0]).toMatch(/supply/);
        expect(labels[1]).toBe('You hold');
        expect(labels.slice(2, 4)).toEqual(['Holders', 'Open offers']);
    });
});
