// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One card look across the wallet: every card composes ui/Card.module.css (or,
// inline, uses the four card tokens), so each has the same solid 1px border,
// corner radius, inner padding and fill. No product stylesheet draws a dashed
// or dotted line except a drop zone while a file is dragged over it.
//
// Bordered, rounded boxes that are not cards (controls, menus and dialogs,
// tone notices, code and value boxes) are named one by one in
// cardSurfaces.allowlist.json with the reason. The list may only shrink: an
// entry that no longer matches a rule fails, so a fixed one is taken off.

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const packagesRoot = join(repoRoot, 'packages');
const allowlist = JSON.parse(readFileSync(join(repoRoot, 'test/unit/ui/cardSurfaces.allowlist.json'), 'utf8'));
const requireFromVite = createRequire(
    createRequire(join(repoRoot, 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'release', 'test-dapp', 'android', 'ios', 'coverage']);
const SURFACE_PROPS = new Set(['border', 'border-radius', 'padding', 'background', 'background-color']);
const CARD_COMPOSES = /^(card|flush)\s+from\s+['"][^'"]*\/Card\.module\.css['"]$/;
// The one exception to "no dashed lines": a drop zone while a file is over it.
const DRAG_OVER = /drag-?over|dropZoneActive/i;

function files(directory, test) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (SKIP_DIRS.has(entry.name)) return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return files(path, test);
        return test(entry.name) ? [path] : [];
    });
}

const rel = (path) => relative(repoRoot, path).split(sep).join('/');

/** A border-radius that rounds a box, not a pill, circle or reset. */
function isBoxRadius(value) {
    return !/^(0|inherit|initial|unset|50%)$/.test(value.trim())
        && !/9{3,}px|radius-pill|avatar-shape|badge-radius/.test(value);
}

function isVisibleBorder(value) {
    return !/^(0|none|0\s+none)\b/.test(value.trim()) && !/\s+transparent\s*$/.test(value);
}

/** A rule drawn straight from the card tokens is a card, composed or not. */
function isTokenCard(decls) {
    return decls.border === 'var(--xc-card-border)'
        && decls['border-radius'] === 'var(--xc-card-radius)'
        && ['var(--xc-card-pad)', '0'].includes(decls.padding)
        && decls.background === 'var(--xc-card-bg)';
}

/** Every bordered, rounded rule that draws its own surface, keyed "file | selector". */
function ownSurfaceRules(sources) {
    const found = [];
    for (const { path, source } of sources) {
        postcss.parse(source).walkRules((rule) => {
            const decls = {};
            rule.each((node) => { if (node.type === 'decl') decls[node.prop] = node.value; });
            if (isTokenCard(decls)) return;
            if (decls.border && decls['border-radius'] && isVisibleBorder(decls.border) && isBoxRadius(decls['border-radius'])) {
                found.push(`${path} | ${rule.selector.replace(/\s+/g, ' ')}`);
            }
        });
    }
    return found;
}

/** Rules that compose the card yet redraw part of its surface. */
function cardOverrides(sources) {
    const found = [];
    for (const { path, source } of sources) {
        postcss.parse(source).walkRules((rule) => {
            const decls = [];
            let composesCard = false;
            rule.each((node) => {
                if (node.type !== 'decl') return;
                if (node.prop === 'composes' && CARD_COMPOSES.test(node.value)) composesCard = true;
                else if (SURFACE_PROPS.has(node.prop)) decls.push(node.prop);
            });
            if (composesCard && decls.length) found.push(`${path} | ${rule.selector} | ${decls.join(', ')}`);
        });
    }
    return found;
}

/** Dashed or dotted borders and outlines outside a drag-over selector. */
function dashedLines(sources) {
    const found = [];
    for (const { path, source } of sources) {
        postcss.parse(source).walkDecls((decl) => {
            if (!/^(border|outline)/.test(decl.prop) || !/\b(dashed|dotted)\b/.test(decl.value)) return;
            const selector = decl.parent?.selector || '';
            if (DRAG_OVER.test(selector)) return;
            found.push(`${path} | ${selector} | ${decl.prop}: ${decl.value}`);
        });
    }
    return found;
}

/** Dashed or dotted lines in inline JSX styles, outside a drag-over expression. */
function inlineDashedLines(sources) {
    const found = [];
    for (const { path, source } of sources) {
        source.split('\n').forEach((line, index) => {
            if (!/\b(border|outline)\w*\s*:/.test(line) || !/\b(dashed|dotted)\b/.test(line)) return;
            if (/isDragOver|dragOver/.test(line)) return;
            found.push(`${path}:${index + 1}`);
        });
    }
    return found;
}

const INLINE_CARD = {
    border: "'var(--xc-card-border)'",
    borderRadius: "'var(--xc-card-radius)'",
    padding: "'var(--xc-card-pad)'",
};

/** Inline style objects that draw a bordered, rounded, padded box off the card tokens, counted per file. */
function inlineOffCardBoxes(sources) {
    const counts = {};
    for (const { path, source } of sources) {
        const objects = source.match(/\{[^{}]*\bborder\s*:[^{}]*\}/g) || [];
        for (const body of objects) {
            const value = (key) => new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*([^,\\n}]+)`).exec(body)?.[1]?.trim();
            const border = value('border');
            const radius = value('borderRadius');
            if (!border || !radius || !value('padding')) continue;
            if (!/^['"`]/.test(border) || /^['"`](0|none)\b/.test(border) || /\s+transparent['"`]$/.test(border)) continue;
            if (/^['"`]?(0|50%|9{3,})/.test(radius) || /radius-pill/.test(radius)) continue;
            if (Object.entries(INLINE_CARD).every(([key, token]) => value(key) === token)) continue;
            counts[path] = (counts[path] || 0) + 1;
        }
    }
    return counts;
}

const read = (path) => ({ path: rel(path), source: readFileSync(path, 'utf8') });
const moduleCss = files(packagesRoot, (name) => name.endsWith('.module.css')).map(read);
const allCss = files(packagesRoot, (name) => name.endsWith('.css')).map(read);
const jsx = files(packagesRoot, (name) => /\.jsx?$/.test(name) && !/\.test\./.test(name)).map(read);

describe('card surfaces', () => {
    it('draws the card from the four shared card tokens', () => {
        const tokens = readFileSync(join(packagesRoot, 'core/src/ui/tokens.css'), 'utf8');
        expect(tokens).toContain('--xc-card-border: 1px solid var(--xc-border);');
        expect(tokens).toContain('--xc-card-radius: var(--xc-radius-md);');
        expect(tokens).toContain('--xc-card-pad: var(--xc-space-4);');
        expect(tokens).toContain('--xc-card-bg: var(--xc-surface-raised);');

        const card = postcss.parse(readFileSync(join(packagesRoot, 'core/src/ui/Card.module.css'), 'utf8'));
        const body = (selector) => {
            const decls = {};
            card.walkRules((rule) => {
                if (rule.selector === selector && rule.parent.type === 'root') rule.each((d) => { decls[d.prop] = d.value; });
            });
            return decls;
        };
        expect(body('.card')).toEqual({
            padding: 'var(--xc-card-pad)',
            background: 'var(--xc-card-bg)',
            border: 'var(--xc-card-border)',
            'border-radius': 'var(--xc-card-radius)',
        });
        expect(body('.flush')).toEqual({ ...body('.card'), padding: '0' });
    });

    it('flattens a card inside a card', () => {
        const source = readFileSync(join(packagesRoot, 'core/src/ui/Card.module.css'), 'utf8');
        expect(source).toMatch(/\.card \.card,\s*\.card \.flush,\s*\.flush \.card,\s*\.flush \.flush\s*\{[^}]*border:\s*0/);
        expect(source).toMatch(/@media \(min-width: 600px\)\s*\{\s*\.formCard \.card,\s*\.formCard \.flush\s*\{[^}]*border:\s*0/);
    });

    it('draws the wide form card with the same tokens', () => {
        const form = readFileSync(join(packagesRoot, 'core/src/ui/FormPage.module.css'), 'utf8');
        const wide = /@media \(min-width: 600px\)\s*\{\s*\.form\s*\{([^}]*)\}/.exec(form)?.[1] || '';
        expect(wide).toMatch(/max-width:\s*var\(--xc-form-card-max-width\)/);
        expect(wide).toMatch(/padding:\s*var\(--xc-card-pad\)/);
        expect(wide).toMatch(/background:\s*var\(--xc-card-bg\)/);
        expect(wide).toMatch(/border:\s*var\(--xc-card-border\)/);
        expect(wide).toMatch(/border-radius:\s*var\(--xc-card-radius\)/);
    });

    it('recognizes own surfaces, card overrides and dashed lines', () => {
        const fixture = [{
            path: 'Fixture.module.css',
            source: [
                '.panel { border: 1px solid var(--xc-border); border-radius: 8px; padding: 4px; }',
                '.pill { border: 1px solid red; border-radius: var(--xc-radius-pill); }',
                '.ghost { border: 1px solid transparent; border-radius: 8px; }',
                ".ok { composes: card from '../../ui/Card.module.css'; margin: 0; }",
                ".bad { composes: card from '../../ui/Card.module.css'; padding: 4px; }",
                '.rule { border-top: 1px dashed var(--xc-border); }',
                '.zone.dragOver { outline: 2px dashed var(--xc-accent-primary); }',
            ].join('\n'),
        }];
        expect(ownSurfaceRules(fixture)).toEqual(['Fixture.module.css | .panel']);
        expect(cardOverrides(fixture)).toEqual(['Fixture.module.css | .bad | padding']);
        expect(dashedLines(fixture)).toEqual(['Fixture.module.css | .rule | border-top: 1px dashed var(--xc-border)']);

        const inline = [{
            path: 'Fixture.jsx',
            source: [
                "const A = { border: '1px solid var(--xc-border)', borderRadius: '4px', padding: '0.5rem' };",
                "const B = { border: 'var(--xc-card-border)', borderRadius: 'var(--xc-card-radius)', padding: 'var(--xc-card-pad)' };",
                "const C = { border: drop.isDragOver ? '2px dashed var(--xc-accent)' : 'none' };",
                "const D = { borderBottom: '1px dotted red' };",
            ].join('\n'),
        }];
        expect(inlineOffCardBoxes(inline)).toEqual({ 'Fixture.jsx': 1 });
        expect(inlineDashedLines(inline)).toEqual(['Fixture.jsx:4']);
    });

    it('draws no dashed or dotted lines outside a drag-over drop zone', () => {
        expect(dashedLines(allCss)).toEqual([]);
        expect(inlineDashedLines(jsx)).toEqual([]);
    });

    it('never redraws the surface of a rule that composes the card', () => {
        expect(cardOverrides(moduleCss)).toEqual([]);
    });

    it('draws every other bordered, rounded box only where the allowlist names why', () => {
        const found = ownSurfaceRules(moduleCss);
        const unlisted = found.filter((key) => !(key in allowlist.rules));
        const stale = Object.keys(allowlist.rules).filter((key) => !found.includes(key));
        expect(unlisted, 'compose card or flush from ui/Card.module.css, or list the rule with its reason').toEqual([]);
        expect(stale, 'take fixed rules off cardSurfaces.allowlist.json').toEqual([]);
    });

    it('keeps inline bordered boxes on the card tokens, with the named exceptions only shrinking', () => {
        const counts = inlineOffCardBoxes(jsx);
        expect(counts).toEqual(Object.fromEntries(Object.entries(allowlist.inline).map(([path, entry]) => [path, entry.count])));
    });
});
