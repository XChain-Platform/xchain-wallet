// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Static guard: no form carries a bottom "Back" button that just repeats the
// header chevron, and no wizard loses its in-form step-back.
//
// WHY THIS EXISTS 
// ------------------------
// Watching the E2E runs, forms kept showing a Back button at the bottom of
// the screen while the page header already carried a back chevron wired to
// the same `onBack`. A survey found 48 back-style controls; 29 were that
// exact duplicate and were removed.
//
// The other 19 had to stay, and telling the two apart is the whole point of
// this test. A bottom control that calls `onBack` LEAVES THE ROUTE, which is
// what the chevron already does. A bottom control that calls `setStage(...)`,
// `setView(...)` or similar moves BETWEEN STAGES OF ONE FORM, which the
// chevron cannot do; deleting those strands a user mid-wizard. Three more sit
// on screens that render no header back control at all, where the button is
// the only way out.
//
// So this guard runs in both directions:
//   1. no back-labelled control anywhere whose handler is just `onBack`
//      (outside the header-less screens listed below), and
//   2. every wizard/escape known to need its own back control still has one.
//
// Direction 2 is a subset check, not an equality check: adding a new wizard
// with a legitimate step-back must not turn this suite red. Removing one must.
//
// Sources are pulled via `import.meta.glob({ query: '?raw' })` at compile
// time, path-relative, so there is no fs/cwd fragility. Same approach as
// jsx-imports.test.js.

import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

const sources = import.meta.glob(
    ['../../packages/**/*.jsx', '!../../packages/**/node_modules/**'],
    { query: '?raw', import: 'default', eager: true },
);

const PARSER_PLUGINS = [
    'jsx',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'decorators-legacy',
    'importAssertions',
    'topLevelAwait',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
    'dynamicImport',
];

// Screens that render no header back control, so their bottom button is the
// only exit. If one of these is ever refactored onto PageHeader, drop it from
// here and delete its bottom button in the same change.
const HEADER_LESS_SCREENS = new Set([
    'packages/core/src/shared/routes/CreateWallet.jsx',
    'packages/core/src/shared/routes/ResumeConfirm.jsx',
    'packages/core/src/shared/components/OpenOrdersPanel.jsx',
]);

// Files whose in-form step-back must survive: each moves between stages of a
// single form (or between the panes of the multisig session), which the header
// chevron cannot do. Losing one of these is a regression, not a cleanup.
const STEP_BACK_REQUIRED = [
    'packages/core/src/shared/components/OpenOrdersPanel.jsx',
    'packages/core/src/shared/routes/AttachContentForm.jsx',
    'packages/core/src/shared/routes/BatchComposerForm.jsx',
    'packages/core/src/shared/routes/ContractFundsForm.jsx',
    'packages/core/src/shared/routes/CreateWallet.jsx',
    'packages/core/src/shared/routes/GatedPublishForm.jsx',
    'packages/core/src/shared/routes/LinkForm.jsx',
    'packages/core/src/shared/routes/ListCreateForm.jsx',
    'packages/core/src/shared/routes/ListForkForm.jsx',
    'packages/core/src/shared/routes/MultisigSigningSession.jsx',
    'packages/core/src/shared/routes/OnboardingCarousel.jsx',
    'packages/core/src/shared/routes/ParallelComposer.jsx',
    'packages/core/src/shared/routes/PollDetail.jsx',
    'packages/core/src/shared/routes/ProjectRosterForm.jsx',
    'packages/core/src/shared/routes/PublishFileForm.jsx',
    'packages/core/src/shared/routes/ResumeConfirm.jsx',
];

// "Back", "Back to tracker", "Back to compose". Deliberately anchored so
// "Back up now" (the seed-backup prompt) is not mistaken for navigation.
const BACK_LABEL = /^Back(\s+to\b.*)?$/;

// True when the handler's only effect is leaving the route, i.e. `onBack`
// itself or an arrow whose entire body is a call to it. A handler that also
// does other work is left alone: it is not the duplicate the sweep removed.
function callsOnlyOnBack(node) {
    if (!node) return false;
    if (node.type === 'Identifier') return node.name === 'onBack';
    if (node.type !== 'ArrowFunctionExpression') return false;
    let body = node.body;
    if (body.type === 'BlockStatement') {
        if (body.body.length !== 1 || body.body[0].type !== 'ExpressionStatement') return false;
        body = body.body[0].expression;
    }
    if (body.type !== 'CallExpression' && body.type !== 'OptionalCallExpression') return false;
    const callee = body.callee;
    return callee.type === 'Identifier' && callee.name === 'onBack';
}

// Every JSX element whose visible text child reads as a back control.
function backControls(code) {
    const ast = parse(code, { sourceType: 'module', plugins: PARSER_PLUGINS });
    const hits = [];
    traverse(ast, {
        JSXElement(path) {
            const label = path.node.children
                .filter((c) => c.type === 'JSXText')
                .map((c) => c.value.trim())
                .filter(Boolean)
                .join(' ')
                .trim();
            if (!BACK_LABEL.test(label)) return;
            const onClick = path.node.openingElement.attributes.find(
                (a) => a.type === 'JSXAttribute' && a.name.name === 'onClick',
            );
            const handler = onClick?.value?.type === 'JSXExpressionContainer'
                ? onClick.value.expression
                : null;
            hits.push({
                label,
                line: path.node.loc?.start.line,
                routeLevel: callsOnlyOnBack(handler),
            });
        },
    });
    return hits;
}

const display = (key) => key.replace(/^(\.\.\/)+/, '');

const entries = Object.entries(sources)
    .map(([key, code]) => [display(key), code])
    .sort(([a], [b]) => a.localeCompare(b));

describe('bottom Back buttons do not duplicate the header chevron', () => {
    it('discovers JSX files to scan', () => {
        // A glob that silently matched nothing would make this a no-op.
        expect(entries.length).toBeGreaterThan(100);
    });

    for (const [file, code] of entries) {
        // Cheap filter first; parsing ~190 files for a word most lack is waste.
        if (!/\bBack\b/.test(code)) continue;
        it(file, () => {
            const duplicates = backControls(code)
                .filter((h) => h.routeLevel && !HEADER_LESS_SCREENS.has(file))
                .map((h) => `"${h.label}" → onBack (line ${h.line})`);
            // The header already renders a chevron wired to onBack on these
            // screens, so a bottom button doing the same is dead weight.
            expect(duplicates).toEqual([]);
        });
    }

    it.each(STEP_BACK_REQUIRED)('%s keeps its in-form step-back', (file) => {
        const code = sources[`../../${file}`];
        // A rename here is a silent pass otherwise: the file must exist.
        expect(code, `${file} not found; update STEP_BACK_REQUIRED`).toBeTypeOf('string');
        const kept = backControls(code).filter((h) => !h.routeLevel);
        expect(kept.length).toBeGreaterThan(0);
    });
});
