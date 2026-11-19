// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readSource = (path) => readFileSync(join(root, path), 'utf8');
const readCss = (path) => readFileSync(join(root, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return match?.[2] || '';
}

function mediaBlock(text, query) {
    const start = text.indexOf(`@media ${query}`);
    if (start < 0) return '';
    const open = text.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === '{') depth += 1;
        if (text[index] === '}') depth -= 1;
        if (depth === 0) return text.slice(open + 1, index);
    }
    return '';
}

const routeStyles = [
    'packages/core/src/shared/routes/IssueTokenForm.module.css',
];

const migratedRoutes = [
    'packages/core/src/shared/routes/TokenWizard.jsx',
    'packages/core/src/shared/routes/CrossChainSwapForm.jsx',
    'packages/core/src/shared/routes/CrossChainOrderForm.jsx',
];

describe('token issuance mobile layout', () => {
    it.each(migratedRoutes)('%s uses kit controls except documented native checkbox and radio inputs', (path) => {
        const source = readSource(path);
        expect(source).not.toMatch(/<(?:button|select|textarea)\b/);

        const nativeInputs = source.match(/<input\b[\s\S]*?\/>/g) || [];
        for (const input of nativeInputs) {
            expect(input).toMatch(/type="(?:checkbox|radio)"/);
        }
        expect(source.match(/Native (?:checkbox|radio) remains because the UI kit has no/g) || [])
            .toHaveLength(nativeInputs.length);
    });

    it('uses shared fields, sections, and result actions for cross-chain authoring', () => {
        const issue = readSource('packages/core/src/shared/routes/IssueTokenForm.jsx');
        const swap = readSource(migratedRoutes[1]);
        const order = readSource(migratedRoutes[2]);

        expect(issue).toMatch(/<AddressField[\s\S]*?label={t\('issue\.transferOwnership'\)}/);
        expect(issue).toMatch(/<FormSection\s+id="locks"/);
        expect(issue).toMatch(/<FormSection\s+id="callback"/);
        expect(issue).toMatch(/<FormFrame\b/);

        for (const source of [swap, order]) {
            expect(source).toMatch(/<AddressField[\s\S]*?label="Receive at"/);
            expect(source).toMatch(/<SectionHeader title="Cross-chain (?:swap|order) broadcast"/);
            expect(source).toMatch(/<CopyButton value={txid} label="Copy Transaction ID"/);
        }
    });

    it.each(routeStyles)('%s keeps review text inside its grid track', (path) => {
        const css = readCss(path);
        // Label-left value-right rows at every width (the FactRows look): the
        // label track and a wider value track whose text wraps at the end edge.
        expect(ruleBody(css, '.detailsList'))
            .toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)\s+minmax\(0, 2fr\)/);
        expect(ruleBody(css, '.detailsValue')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.detailsValue')).toMatch(/overflow-wrap:\s*anywhere/);
        expect(ruleBody(css, '.detailsValue')).toMatch(/text-align:\s*end/);
        expect(ruleBody(css, '.detailsValue')).toMatch(/font-variant-numeric:\s*tabular-nums/);
        expect(css).toContain('border-top: var(--xc-table-row-divider);');
        expect(ruleBody(css, '.summary')).toMatch(/overflow-wrap:\s*anywhere/);
    });

    it('draws the shared details labels as sentence-case rows, never uppercase stacked labels', () => {
        const css = readCss(routeStyles[0]);
        const label = ruleBody(css, '.detailsLabel');
        expect(label).not.toMatch(/text-transform/);
        expect(label).not.toMatch(/letter-spacing/);
        expect(label).toMatch(/padding-block:\s*var\(--xc-space-2\)/);
        expect(ruleBody(css, '.detailsValue')).toMatch(/padding:\s*var\(--xc-space-2\) 0/);
        // No width switch: the rows are the same on a phone and a desktop.
        expect(ruleBody(mediaBlock(css, '(min-width: 834px)'), '.detailsList')).toBe('');
    });

    it('lets long ticker and description values shrink within shared inputs', () => {
        const css = readCss('packages/core/src/ui/Input.module.css');
        expect(ruleBody(css, '.field')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.input')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.input')).toMatch(/max-width:\s*100%/);
    });

    it('keeps the token item editor inside a 320px viewport', () => {
        const css = readCss(routeStyles[0]);
        expect(ruleBody(css, '.picker')).toMatch(/width:\s*100%/);
        expect(ruleBody(css, '.picker')).toMatch(/box-sizing:\s*border-box/);
        expect(ruleBody(css, '.tickItem')).toMatch(/flex-wrap:\s*wrap/);
        expect(ruleBody(css, '.tickItemName')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.tickItemName')).toMatch(/overflow-wrap:\s*anywhere/);
    });
});
