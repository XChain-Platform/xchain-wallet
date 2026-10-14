// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: confirm layout compatibility.
//
//   [P1] 2026-10-13: Chrome 102 has no container-query support. The narrow
//        confirm layout comes from the top-level rule or the phone viewport
//        reflow, never a container query, so rows and actions stay usable.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, '..', '..', 'packages', 'core', 'src', 'shared', 'components');
const confirmCss = readFileSync(join(components, 'ConfirmActionModal.module.css'), 'utf8');
const summaryCss = readFileSync(join(components, 'ActionIntentSummary.module.css'), 'utf8');

// Declarations a phone viewport sees: the top-level rule, then the 480px
// viewport reflow, which media queries apply on every supported WebView.
function defaultDeclarations(css, selector) {
    const root = postcss.parse(css);
    const matches = (node) => node.type === 'rule' && node.selectors.includes(selector);
    const rules = [
        ...root.nodes.filter(matches),
        ...root.nodes
            .filter((node) => node.type === 'atrule' && node.name === 'media'
                && node.params === '(max-width: 480px)')
            .flatMap((media) => media.nodes.filter(matches)),
    ];
    expect(rules.length, `${selector} rule`).toBeGreaterThan(0);
    return Object.fromEntries(rules.flatMap((rule) => rule.nodes)
        .filter((node) => node.type === 'decl')
        .map((node) => [node.prop, node.value]));
}

describe('regression/confirm-no-container-queries', () => {
    it.each([
        ['ConfirmActionModal.module.css', confirmCss],
        ['ActionIntentSummary.module.css', summaryCss],
    ])('[REGRESSION P1] %s uses no container queries', (_filename, css) => {
        const containerRules = [];
        postcss.parse(css).walkAtRules((rule) => {
            if (rule.name.toLowerCase() === 'container') containerRules.push(rule);
        });
        expect(containerRules).toHaveLength(0);
    });

    it('[REGRESSION P1] gives phone viewports the narrow confirm layout without container queries', () => {
        expect(defaultDeclarations(confirmCss, '.credentials dl'))
            .toMatchObject({ 'grid-template-columns': 'minmax(0, 1fr)' });
        expect(defaultDeclarations(confirmCss, '.footer'))
            .toMatchObject({ 'flex-direction': 'column' });

        for (const selector of ['.row', '.delta']) {
            expect(defaultDeclarations(summaryCss, selector))
                .toMatchObject({ 'grid-template-columns': 'minmax(0, 1fr)' });
        }
        for (const selector of ['.row dd', '.deltaValues']) {
            expect(defaultDeclarations(summaryCss, selector))
                .toMatchObject({ 'text-align': 'start' });
        }
    });
});
