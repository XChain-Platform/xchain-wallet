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
    'packages/core/src/shared/routes/TokenWizard.module.css',
    'packages/core/src/shared/routes/IssueTokenForm.module.css',
];

describe('token issuance mobile layout', () => {
    it.each(routeStyles)('%s keeps review text inside its grid track', (path) => {
        const css = readCss(path);
        expect(ruleBody(css, '.detailsList')).toMatch(
            /grid-template-columns:\s*minmax\(0, max-content\)\s+minmax\(0, 1fr\)/,
        );
        expect(ruleBody(css, '.detailsValue')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.detailsValue')).toMatch(/overflow-wrap:\s*anywhere/);
        expect(ruleBody(css, '.summary')).toMatch(/overflow-wrap:\s*anywhere/);
    });

    it.each(routeStyles)('%s stacks review labels and values at 360px', (path) => {
        const narrow = mediaBlock(readCss(path), '(max-width: 399px)');
        expect(ruleBody(narrow, '.detailsList')).toMatch(
            /grid-template-columns:\s*minmax\(0, 1fr\)/,
        );
    });

    it('lets long ticker and description values shrink within shared inputs', () => {
        const css = readCss('packages/core/src/ui/Input.module.css');
        expect(ruleBody(css, '.field')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.input')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.input')).toMatch(/max-width:\s*100%/);
    });

    it('wraps the wizard result actions instead of widening the viewport', () => {
        const css = readCss(routeStyles[0]);
        expect(ruleBody(css, '.actions')).toMatch(/flex-wrap:\s*wrap/);
    });

    it('keeps the token item editor inside a 320px viewport', () => {
        const css = readCss(routeStyles[1]);
        expect(ruleBody(css, '.picker')).toMatch(/width:\s*100%/);
        expect(ruleBody(css, '.picker')).toMatch(/box-sizing:\s*border-box/);
        expect(ruleBody(css, '.tickItem')).toMatch(/flex-wrap:\s*wrap/);
        expect(ruleBody(css, '.tickItemName')).toMatch(/min-width:\s*0/);
        expect(ruleBody(css, '.tickItemName')).toMatch(/overflow-wrap:\s*anywhere/);
    });
});
