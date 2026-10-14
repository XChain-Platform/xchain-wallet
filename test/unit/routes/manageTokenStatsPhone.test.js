// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Manage token's stats strip: the supply and holding values are whole token
// quantities, and in a quarter of the card (768px up to about 1100px) or in
// half of a 360px row they broke in the middle of the number
// ("50,000,000,000,0" over "00"). The strip is two columns at every width,
// quantities first, and below 600px each quantity takes a full row.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const requireFromVite = createRequire(
    createRequire(join(repoRoot, 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const cssPath = join(repoRoot, 'packages/core/src/shared/routes/ManageToken.module.css');
const jsxPath = join(repoRoot, 'packages/core/src/shared/routes/ManageToken.jsx');

function phoneRules() {
    const root = postcss.parse(readFileSync(cssPath, 'utf8'));
    const rules = [];
    root.walkAtRules('media', (media) => {
        if (!/not all and \(min-width:\s*600px\)/.test(media.params)) return;
        media.walkRules((rule) => {
            const decls = {};
            rule.walkDecls((d) => { decls[d.prop] = d.value; });
            rules.push({ selector: rule.selector, decls });
        });
    });
    return rules;
}

describe('Manage token stats strip', () => {
    it('lays the strip out in two columns at every width', () => {
        const root = postcss.parse(readFileSync(cssPath, 'utf8'));
        let base = null;
        root.walkRules('.statsStrip', (rule) => {
            if (rule.parent.type === 'root') rule.walkDecls('grid-template-columns', (d) => { base = d.value; });
        });
        expect(base).toBe('repeat(2, minmax(0, 1fr))');
        expect(phoneRules().find((r) => r.selector === '.statsStrip')).toBeUndefined();
    });

    it('gives the first two cells a full row each', () => {
        const wide = phoneRules().find((r) => /^\.stat:nth-child\(-n\s*\+\s*2\)$/.test(r.selector));
        expect(wide?.decls['grid-column']).toBe('1 / -1');
    });

    it('renders supply and holding as the first two cells', () => {
        const source = readFileSync(jsxPath, 'utf8');
        const strip = source.slice(source.indexOf('className={styles.statsStrip}'));
        const labels = [...strip.matchAll(/className=\{styles\.statLabel\}>\s*([^<]+?)\s*</g)]
            .map((m) => m[1].trim());
        expect(labels[0]).toMatch(/supply/);
        expect(labels[1]).toBe('You hold');
        expect(labels.slice(2, 4)).toEqual(['Holders', 'Open offers']);
    });
});
