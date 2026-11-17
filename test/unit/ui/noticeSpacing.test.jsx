// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One notice spacing rule: 8px between a notice and the element above it
// (usually the page header) and the element below it. The stack that places a
// notice spaces it with its own 8px gap, and Screen's 8px content inset puts a
// leading notice 8px under the header, so the notice itself has no outer
// margin. A margin on the notice stacked on those gaps and drew 16px; a page
// that pulled the next element up to undo the old margin drew 0px (the
// 2026-11-16 notice sweep found both on the screen wall).
//
// This pins the shared rule so no page brings the stacked gap back:
//   - the Notice row has no outer margin;
//   - no stylesheet gives a notice root ([data-variant], [role=status],
//     [role=alert]) a non-zero block margin;
//   - FormPage's status slot is the form's first item (inside its card from
//     600px), 8px above the next element and 8px apart from another notice;
//   - an untitled FormSection draws no empty header, which took a gap.
// Vitest blanks CSS modules, so the rules are read from the CSS text.

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { FormSection } from '../../../packages/core/src/ui/FormSection.jsx';
import { StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';

const repoRoot = process.cwd();
const requireFromVite = createRequire(
    createRequire(join(repoRoot, 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'release', 'android', 'ios', 'www', 'coverage', 'wallMocks']);

function cssFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (SKIP_DIRS.has(entry.name)) return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssFiles(path);
        return entry.name.endsWith('.css') ? [path] : [];
    });
}

const rel = (path) => relative(repoRoot, path).split(sep).join('/');
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

/** True when a margin value moves the block edges (any non-zero top or bottom). */
function blockMargin(prop, value) {
    const parts = value.trim().split(/\s+(?![^(]*\))/);
    const zero = (v) => /^-?0(px|rem|em)?$/.test(v);
    if (prop === 'margin') return !zero(parts[0]) || (parts.length > 2 ? !zero(parts[2]) : !zero(parts[0]));
    if (/^margin-(top|bottom|block|block-start|block-end)$/.test(prop)) return parts.some((v) => !zero(v));
    return false;
}

/** The last compound of a selector targets a notice root. */
function targetsNoticeRoot(selector) {
    const last = selector.trim().split(/\s*[>+~\s]\s*(?![^[]*\])/).pop() || '';
    return /\[data-variant\]|\[role=["']?(status|alert)["']?\]/.test(last);
}

/** Every rule that gives a notice root a block margin: "file | selector | prop: value". */
function noticeMargins(sources) {
    const found = [];
    for (const { path, source } of sources) {
        postcss.parse(source).walkRules((rule) => {
            for (const selector of rule.selectors) {
                if (!targetsNoticeRoot(selector)) continue;
                rule.each((node) => {
                    if (node.type === 'decl' && blockMargin(node.prop, node.value)) {
                        found.push(`${path} | ${selector.trim()} | ${node.prop}: ${node.value}`);
                    }
                });
            }
        });
    }
    return found;
}

/** The declarations of the first rule whose selector list holds `selector`. */
function declsOf(source, selector) {
    let out = null;
    postcss.parse(source).walkRules((rule) => {
        if (out || !rule.selectors.map((s) => s.trim()).includes(selector)) return;
        out = {};
        rule.each((node) => { if (node.type === 'decl') out[node.prop] = node.value; });
    });
    return out;
}

afterEach(() => cleanup());

describe('the notice has no outer margin', () => {
    const statusCss = read('packages/core/src/ui/StatusMessage.module.css');

    it('the Notice row (.row) sets no block margin', () => {
        const row = declsOf(statusCss, '.row');
        expect(row).not.toBeNull();
        for (const [prop, value] of Object.entries(row)) {
            expect(blockMargin(prop, value), `.row ${prop}: ${value}`).toBe(false);
        }
    });

    it('recognizes a notice-root margin and leaves zero margins and other elements alone', () => {
        expect(noticeMargins([{
            path: 'Fixture.module.css',
            source: [
                '.stack > [data-variant] { margin: 8px 0; }',
                '.page [role="alert"] { margin-top: var(--xc-space-2); }',
                '.list > [data-variant] { margin: 0; }',
                '.row > [data-variant] { margin-inline: 8px; }',
                '[data-variant] .title { margin-top: 4px; }',
            ].join('\n'),
        }])).toEqual([
            'Fixture.module.css | .stack > [data-variant] | margin: 8px 0',
            'Fixture.module.css | .page [role="alert"] | margin-top: var(--xc-space-2)',
        ]);
    });

    it('no stylesheet gives a notice root a block margin, so no page stacks one on its gap', () => {
        const sources = cssFiles(join(repoRoot, 'packages')).map((path) => ({ path: rel(path), source: readFileSync(path, 'utf8') }));
        expect(noticeMargins(sources)).toEqual([]);
    });
});

describe('FormPage places its notices 8px from their neighbours', () => {
    const formCss = read('packages/core/src/ui/FormPage.module.css');
    const standardCss = read('packages/core/src/shared/components/formStandard/formStandard.module.css');

    it('stacks several notices 8px apart', () => {
        expect(declsOf(formCss, '.status').gap).toBe('var(--xc-space-2)');
    });

    it('puts the next element, and a form title above, 8px from the status slot instead of the form gap', () => {
        const pull = 'calc(var(--xc-space-2) - var(--xc-form-gap, var(--xc-space-4)))';
        expect(declsOf(formCss, '.status:not(:empty) + *')?.['margin-block-start']).toBe(pull);
        expect(declsOf(formCss, '.pageHeader + .status:not(:empty)')?.['margin-block-start']).toBe(pull);
    });

    it('puts the element under a notice placed in the form body 8px below it, not the field gap', () => {
        const pull = 'calc(var(--xc-space-2) - var(--xc-form-gap, var(--xc-space-4)))';
        expect(declsOf(formCss, '.body > [data-variant] + *')?.['margin-block-start']).toBe(pull);
        expect(declsOf(formCss, '.sectionBody > [data-variant] + *')?.['margin-block-start']).toBe(pull);
    });

    it('keeps no pull on the form below a page-level notice (it drew 0px once the page gap was 8px)', () => {
        expect(standardCss).not.toMatch(/\[data-form-status\]\s*\+\s*\[data-form-frame\]/);
    });

    it('draws a plain form\'s notice as the form\'s first item, so the wide card wraps it', () => {
        const { container } = render(
            <FormPage label="Fixture" status={<StatusMessage variant="error">Something went wrong.</StatusMessage>}>
                <input aria-label="Name" />
            </FormPage>,
        );
        const form = container.querySelector('form');
        const slot = container.querySelector('[data-form-status]');
        expect(form).not.toBeNull();
        expect(form.contains(slot)).toBe(true);
        expect(form.firstElementChild).toBe(slot);
    });
});

describe('an untitled FormSection draws no empty header', () => {
    it('renders the body alone, with no heading and no dangling label reference', () => {
        const { container } = render(<FormSection><input aria-label="Password" /></FormSection>);
        const section = container.querySelector('section');
        expect(section.querySelector('[data-xc-section-header], h2, h3')).toBeNull();
        expect(section.hasAttribute('aria-labelledby')).toBe(false);
    });

    it('keeps a titled section named by its heading', () => {
        const { container } = render(<FormSection title="Backup"><input aria-label="Password" /></FormSection>);
        const section = container.querySelector('section');
        const id = section.getAttribute('aria-labelledby');
        expect(id).toBeTruthy();
        expect(container.querySelector(`[id="${id}"]`)?.textContent).toBe('Backup');
    });
});
