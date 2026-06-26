// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Static guard: every JSX component reference must be imported or declared.
//
// WHY THIS EXISTS
// ---------------
// The #1 latent-crash class in this wallet is a component used in JSX but
// never imported (`<PageHeader>` without its import → `ReferenceError:
// PageHeader is not defined` → white screen. A botched import-organizer
// dropped that import from 35 route files at once, and the "green" smoke
// suite (source-regex assertions that never render) sailed right past it.
// There is no linter configured in this workspace, so nothing catches the
// `no-undef` family. This test is that net.
//
// COMPLEMENTS THE RENDER HARNESS
// ------------------------------
// `routes-render.test.jsx` actually mounts the 73 top-level routes (+ an
// effects flush + interaction) and catches a broad set of crash types;
// but only for components it reaches. This test is the breadth axis: a
// STATIC AST scan over EVERY `.jsx` in the wallet (~194 files, incl. the
// components/ui that routes only render transitively, and screens hidden
// behind data/interaction the harness never reaches). It catches exactly
// one bug class (undefined JSX component) but everywhere.
//
// HOW IT WORKS
// ------------
// Parse each file with Babel and walk every JSXOpeningElement. For a
// capitalized element name (lowercase = intrinsic HTML), resolve the
// leftmost identifier (`<Icon.Foo>` → `Icon`) and ask Babel's scope
// whether it's bound anywhere up the lexical chain (imports, local decls,
// params, destructuring all count. `noGlobals: true` means a stray JS
// builtin name can't mask a missing component import. React/Fragment are
// always OK (automatic JSX runtime needs no import). Zero false positives
// on the current tree; if a legit new pattern trips it, extend ALWAYS_OK
// rather than loosening the check.
//
// Sources are pulled via `import.meta.glob({ query: '?raw' })`, compile-
// time, path-relative, so no fs/cwd fragility and no share reads (a single
// in-process scan, never the per-file spawn storm the smokes suffer).

import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

// Raw source of every JSX file across all wallet packages (incl. the
// Electron desktop renderer, which lives under renderer/ not src/).
// node_modules excluded so vendored JSX can't trip the guard.
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

// Automatic JSX runtime (vite react plugin) injects these; no import needed.
const ALWAYS_OK = new Set(['React', 'Fragment']);

function scan(code) {
    const ast = parse(code, { sourceType: 'module', plugins: PARSER_PLUGINS });
    const hits = [];
    traverse(ast, {
        JSXOpeningElement(path) {
            let nameNode = path.node.name;
            while (nameNode.type === 'JSXMemberExpression') {
                nameNode = nameNode.object; // <Foo.Bar> → base identifier Foo
            }
            if (nameNode.type !== 'JSXIdentifier') return;
            const name = nameNode.name;
            if (!/^[A-Z]/.test(name)) return; // intrinsic HTML element
            if (ALWAYS_OK.has(name)) return;
            if (path.scope.hasBinding(name, /* noGlobals */ true)) return;
            hits.push({ name, line: nameNode.loc?.start.line });
        },
    });
    return hits;
}

// Normalize the glob key to a repo-relative path for readable failures.
const display = (key) => key.replace(/^(\.\.\/)+/, '');

describe('every JSX component reference is imported or declared', () => {
    const entries = Object.entries(sources).sort(([a], [b]) =>
        a.localeCompare(b),
    );

    it('discovers JSX files to scan', () => {
        // A glob that silently matches nothing would make this suite a
        // no-op. The wallet has ~190 JSX files; assert a sane floor.
        expect(entries.length).toBeGreaterThan(100);
    });

    for (const [key, code] of entries) {
        it(display(key), () => {
            // A file we can't parse blinds the guard; let it throw and
            // surface as a failure rather than silently passing.
            const hits = scan(code);
            // Empty array on success; on failure the message names the
            // undefined component(s) and line(s) directly.
            expect(hits.map((h) => `<${h.name}> (line ${h.line})`)).toEqual([]);
        });
    }
});
