// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One warning box and one error box across the wallet: every inline warning,
// error or refusal renders through <StatusMessage> (packages/core/src/ui), which
// owns one look per tone. A route or component stylesheet that paints its own
// box in a warning or danger tone (a tinted fill or a tone border, with
// padding) is a second look for the same message, so it fails here.
//
// The shared kit under packages/core/src/ui is out of scope: StatusMessage is
// the box, and the field primitives draw their compact field error rows.
// Badges, a menu section, a result card and the like are named one by one in
// noticeBoxes.allowlist.json with the reason they are not a message box. The
// list may only shrink: an entry that no longer matches a rule fails, so a
// converted one is taken off.

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const packagesRoot = join(repoRoot, 'packages');
const allowlist = JSON.parse(readFileSync(join(repoRoot, 'test/unit/ui/noticeBoxes.allowlist.json'), 'utf8'));
const requireFromVite = createRequire(
    createRequire(join(repoRoot, 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'release', 'test-dapp', 'android', 'ios', 'coverage', 'www']);
const KIT = 'packages/core/src/ui/';
const TONE = /var\(--xc-(warning|danger|error)(-bg|-fg|-text|-border)?\b/;
const FILL = new Set(['background', 'background-color']);
const EDGE = /^border(-(top|bottom|left|right|inline|block|inline-start|inline-end|block-start|block-end))?(-color)?$/;

function files(directory, test) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (SKIP_DIRS.has(entry.name)) return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return files(path, test);
        return test(entry.name) ? [path] : [];
    });
}

const rel = (path) => relative(repoRoot, path).split(sep).join('/');

function hasPadding(decls) {
    return Object.entries(decls).some(([prop, value]) => /^padding/.test(prop) && !/^0(px)?$/.test(value.trim()));
}

/**
 * Every class that paints its own warning or danger box, keyed "file | .class".
 * Declarations are gathered per class across the file, so a box split over a
 * shared layout rule and a per-tone colour rule is still one box.
 */
function ownNoticeBoxes(sources) {
    const found = [];
    for (const { path, source } of sources) {
        if (path.startsWith(KIT)) continue;
        const byClass = new Map();
        postcss.parse(source).walkRules((rule) => {
            for (const selector of rule.selectors) {
                const name = /^\.([\w-]+)$/.exec(selector.trim())?.[1];
                if (!name) continue;
                const decls = byClass.get(name) || {};
                rule.each((node) => { if (node.type === 'decl') decls[node.prop] = node.value; });
                byClass.set(name, decls);
            }
        });
        for (const [name, decls] of byClass) {
            const fill = Object.entries(decls).some(([prop, value]) => FILL.has(prop) && TONE.test(value));
            const edge = Object.entries(decls).some(([prop, value]) => EDGE.test(prop) && TONE.test(value));
            // A tone fill or edge with its own padding is a box; so is a tone
            // fill plus a tone edge whose padding comes from a shared class.
            if (((fill || edge) && hasPadding(decls)) || (fill && edge)) found.push(`${path} | .${name}`);
        }
    }
    return found;
}

/** Inline style objects that paint a warning or danger fill, counted per file. */
function inlineNoticeBoxes(sources) {
    const counts = {};
    for (const { path, source } of sources) {
        const objects = source.match(/\{[^{}]*\bbackground(?:Color)?\s*:[^{}]*\}/g) || [];
        for (const body of objects) {
            const fill = /\bbackground(?:Color)?\s*:\s*([^,\n}]+)/.exec(body)?.[1] || '';
            if (TONE.test(fill)) counts[path] = (counts[path] || 0) + 1;
        }
    }
    return counts;
}

const jsx = files(packagesRoot, (name) => /\.jsx?$/.test(name) && !/\.test\./.test(name))
    .map((path) => ({ path: rel(path), source: readFileSync(path, 'utf8') }));
const moduleCss = files(packagesRoot, (name) => name.endsWith('.module.css'))
    .map((path) => ({ path: rel(path), source: readFileSync(path, 'utf8') }));

describe('notice boxes', () => {
    it('recognizes a warning or danger box and leaves plain text, controls without fill and the kit alone', () => {
        const fixture = [
            {
                path: 'packages/core/src/shared/routes/Fixture.module.css',
                source: [
                    '.warnings { border: 1px solid var(--xc-warning); background: var(--xc-warning-bg); padding: 4px 8px; }',
                    '.stripe { border-inline-start: 3px solid var(--xc-danger); padding: 4px; }',
                    '.tinted { background: color-mix(in srgb, var(--xc-warning, #B07A00) 12%, transparent); padding: 4px; }',
                    '.redText { color: var(--xc-danger-fg); font-size: 12px; }',
                    '.flatRow { background: var(--xc-danger-bg); padding: 0; }',
                    '.info { background: var(--xc-info-bg); padding: 4px; }',
                    '.banner, .other { padding: 8px; }',
                    '.banner { border: 1px solid var(--xc-danger); }',
                    '.row { padding: 8px; }',
                    '.rowWarn { background: var(--xc-warning-bg); border-inline-start-color: var(--xc-warning); }',
                ].join('\n'),
            },
            {
                path: 'packages/core/src/ui/StatusMessage.module.css',
                source: '.row.warning { background: var(--xc-warning-bg); border: 1px solid var(--xc-warning); padding: 4px; }',
            },
        ];
        expect(ownNoticeBoxes(fixture)).toEqual([
            'packages/core/src/shared/routes/Fixture.module.css | .warnings',
            'packages/core/src/shared/routes/Fixture.module.css | .stripe',
            'packages/core/src/shared/routes/Fixture.module.css | .tinted',
            'packages/core/src/shared/routes/Fixture.module.css | .banner',
            'packages/core/src/shared/routes/Fixture.module.css | .rowWarn',
        ]);
        expect(inlineNoticeBoxes([{
            path: 'Fixture.jsx',
            source: [
                "const A = { background: 'var(--xc-warning-bg)', padding: 8 };",
                "const B = { color: 'var(--xc-danger-fg)' };",
                "const C = { background: 'var(--xc-surface)' };",
            ].join('\n'),
        }])).toEqual({ 'Fixture.jsx': 1 });
    });

    it('paints the warning and error boxes once, in StatusMessage', () => {
        const css = readFileSync(join(packagesRoot, 'core/src/ui/StatusMessage.module.css'), 'utf8');
        expect(css).toMatch(/^\.row\.warning \{[^}]*background: var\(--xc-warning-bg\);/m);
        expect(css).toMatch(/^\.row\.error \{[^}]*background: var\(--xc-danger\);/m);
    });

    it('draws no other warning or danger box except where the allowlist names why', () => {
        const found = ownNoticeBoxes(moduleCss);
        const unlisted = found.filter((key) => !(key in allowlist.rules));
        const stale = Object.keys(allowlist.rules).filter((key) => !found.includes(key));
        expect(unlisted, 'render the message through <StatusMessage variant="warning|error">, or list the rule with its reason').toEqual([]);
        expect(stale, 'take converted rules off noticeBoxes.allowlist.json').toEqual([]);
    });

    it('paints no warning or danger fill in an inline style, with the named exceptions only shrinking', () => {
        expect(inlineNoticeBoxes(jsx)).toEqual(
            Object.fromEntries(Object.entries(allowlist.inline).map(([path, entry]) => [path, entry.count])),
        );
    });

    it('gives every allowlist entry a reason', () => {
        for (const [key, reason] of Object.entries(allowlist.rules)) {
            expect(typeof reason === 'string' && reason.length > 20, key).toBe(true);
        }
        for (const [key, entry] of Object.entries(allowlist.inline)) {
            expect(typeof entry.reason === 'string' && entry.reason.length > 20, key).toBe(true);
        }
    });
});
