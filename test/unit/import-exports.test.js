// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Static guard: every named/default import must resolve to a real export
// of its target module.
//
// WHY THIS EXISTS
// ---------------
// The sibling of the missing-import bug (see jsx-imports.test.js): here the
// import statement IS present, but the target module doesn't export that
// name anymore; a refactor renamed/removed it. The bound name is then
// `undefined`, and using it crashes (`X is not a function`, or a render
// blow-up). Vite resolves the *module* fine, so neither the build nor a
// smoke test catches it; it only fails at runtime on the code path that
// touches the name. It's the import-side form of the `chainRegistry.list()`
// bug. No linter is configured in this workspace, so this is the only net.
//
// SCOPE
// -----
// Checks RELATIVE imports (`./ ../`) and WORKSPACE-ALIAS imports
// (`@xchain-wallet/*`, resolved through each package's `exports` map),
// against JS/JSX targets only; CSS-module / asset / json imports have
// their default synthesized by the bundler and are skipped. Re-export
// barrels (`export * from`, `export { x } from`) are followed so imports
// from an index file validate against the real origin. Third-party package
// imports are out of scope. A target we can't parse, or a `export *` we
// can't follow, is treated as opaque (allow-all) so it never false-fails.
//
// IMPLEMENTATION NOTE
// -------------------
// Reads sources with `fs` (not `import.meta.glob`) and does ALL work inside
// the test body. Eager-globbing 500+ raw sources made *collection* heavy,
// which the Parallels share thrashed into intermittent "no tests" runs. A
// plain in-process read pass (with the share's ENOENT-race retry) keeps
// collection trivial and the run deterministic. The root is located by
// walking up to the `pnpm-workspace.yaml`, so it's cwd-independent.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

import { slowTimeout } from '../helpers/testEnvSpeed.js';

const traverse = _traverse.default || _traverse;

const PARSER_PLUGINS = [
    'jsx', 'classProperties', 'classPrivateProperties', 'classPrivateMethods',
    'decorators-legacy', 'importAssertions', 'topLevelAwait',
    'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator',
    'dynamicImport',
];

// The Parallels share intermittently ENOENTs an existing file mid-read;
// retry a couple times before giving up (returns null → treated opaque).
function safeRead(file) {
    for (let i = 0; i < 4; i += 1) {
        try { return readFileSync(file, 'utf8'); } catch { /* retry */ }
    }
    return null;
}
function safeReaddir(dir) {
    for (let i = 0; i < 4; i += 1) {
        try { return readdirSync(dir, { withFileTypes: true }); } catch { /* retry */ }
    }
    return [];
}

function findRoot() {
    let dir = process.cwd();
    for (let i = 0; i < 10; i += 1) {
        if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))
            && existsSync(resolve(dir, 'packages'))) return dir;
        const up = dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    throw new Error('cannot locate wallet root (pnpm-workspace.yaml + packages/)');
}

// Build output is NOT source. Skipping it is not a convenience: this guard
// parses every file it finds, and a minified 3.7 MB bundle costs hundreds of
// megabytes of Babel AST. With the shells' dist/ trees present the walk was
// already carrying ~13 MB of bundles; the mobile shell stages the web build
// into two more places (its Capacitor webDir and the copy under android/),
// which took a local `pnpm test:unit` after a build straight into
// "Reached heap limit". Nothing in these directories is written by hand, so
// nothing in them can carry the import bug this file looks for.
const GENERATED_DIRS = new Set([
    'node_modules', 'dist', 'dist-staging', 'build', 'coverage', 'www', 'android', 'ios',
]);

function walkJs(dir, out = []) {
    for (const ent of safeReaddir(dir)) {
        if (GENERATED_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        const p = resolve(dir, ent.name);
        if (ent.isDirectory()) walkJs(p, out);
        else if (/\.(js|jsx)$/.test(ent.name)) out.push(p);
    }
    return out;
}

describe('every named/default import resolves to a real export', () => {
    // Explicit timeout: this walks and parses EVERY js/jsx file under
    // packages/, so its runtime grows with the codebase and rises again under
    // the parallel load of a full suite run. At the 20s default it began
    // overrunning by a few hundred ms - a TIMEOUT, not an assertion failure,
    // which reads in CI as "the import graph is broken" and sends whoever sees
    // it hunting a defect that is not there. The budget is generous on purpose:
    // a walk that genuinely got slow enough to hit 60s is worth investigating.
    //
    // It then overran the 60s too, on the `coverage` job, in exactly the way
    // the sentence above predicts: a timeout that reads as a broken import
    // graph. 60s is still the dev-box budget; `slowTimeout` is what carries
    // it to an instrumented run. See test/helpers/testEnvSpeed.js.
    it('relative + workspace-alias imports all resolve (no rot)', { timeout: slowTimeout(60_000) }, () => {
        const root = findRoot();
        const pkgsDir = resolve(root, 'packages');
        const files = walkJs(pkgsDir);
        const fileSet = new Set(files);

        function tryExt(base) {
            const cands = [base, `${base}.js`, `${base}.jsx`,
                `${base}/index.js`, `${base}/index.jsx`];
            return cands.find((c) => fileSet.has(c)) || null;
        }

        const pkgMap = new Map();
        for (const ent of safeReaddir(pkgsDir)) {
            if (!ent.isDirectory()) continue;
            const pj = resolve(pkgsDir, ent.name, 'package.json');
            const raw = existsSync(pj) ? safeRead(pj) : null;
            if (!raw) continue;
            try {
                const json = JSON.parse(raw);
                if (json.name) {
                    pkgMap.set(json.name, {
                        dir: resolve(pkgsDir, ent.name),
                        exports: json.exports || null,
                        main: json.main || null,
                    });
                }
            } catch { /* skip */ }
        }

        function applyExports(exportsMap, subpath) {
            if (!exportsMap) return null;
            const pick = (v) =>
                (typeof v === 'string' ? v : v && (v.import || v.default)) || null;
            if (exportsMap[subpath]) return pick(exportsMap[subpath]);
            for (const [key, val] of Object.entries(exportsMap)) {
                if (key.endsWith('/*')) {
                    const prefix = key.slice(0, -1);
                    if (subpath.startsWith(prefix)) {
                        const t = pick(val);
                        if (t) return t.replace('*', subpath.slice(prefix.length));
                    }
                }
            }
            return null;
        }

        function resolveImport(fromFile, source) {
            if (source.startsWith('.')) {
                return tryExt(resolve(dirname(fromFile), source));
            }
            for (const [name, info] of pkgMap) {
                if (source === name || source.startsWith(`${name}/`)) {
                    const rest = source === name ? '' : source.slice(name.length + 1);
                    const subpath = rest ? `./${rest}` : '.';
                    const rel = info.exports
                        ? applyExports(info.exports, subpath)
                        : rest ? `./${rest}` : info.main || './index.js';
                    if (!rel) return null;
                    return tryExt(resolve(info.dir, rel));
                }
            }
            return null; // third-party; out of scope
        }

        const astCache = new Map();
        function astOf(file) {
            if (astCache.has(file)) return astCache.get(file);
            const code = safeRead(file);
            let ast = null;
            if (code != null) {
                try { ast = parse(code, { sourceType: 'module', plugins: PARSER_PLUGINS }); }
                catch { ast = null; }
            }
            astCache.set(file, ast);
            return ast;
        }

        const exportCache = new Map();
        function collectExports(file, seen = new Set()) {
            if (exportCache.has(file)) return exportCache.get(file);
            if (seen.has(file)) return new Set();
            seen.add(file);
            const ast = astOf(file);
            const names = new Set();
            if (!ast) { names.add('*'); exportCache.set(file, names); return names; }
            for (const node of ast.program.body) {
                if (node.type === 'ExportDefaultDeclaration') {
                    names.add('default');
                } else if (node.type === 'ExportNamedDeclaration') {
                    const d = node.declaration;
                    if (d) {
                        if (d.id) names.add(d.id.name);
                        for (const decl of d.declarations || []) {
                            if (decl.id.type === 'Identifier') names.add(decl.id.name);
                        }
                    }
                    for (const spec of node.specifiers || []) names.add(spec.exported.name);
                } else if (node.type === 'ExportAllDeclaration') {
                    const target = resolveImport(file, node.source.value);
                    if (target) {
                        for (const n of collectExports(target, seen)) {
                            if (n !== 'default') names.add(n);
                        }
                    } else {
                        names.add('*'); // unresolved star → allow-all
                    }
                }
            }
            exportCache.set(file, names);
            return names;
        }

        const broken = [];
        let checked = 0;
        for (const file of files) {
            const ast = astOf(file);
            if (!ast) continue;
            traverse(ast, {
                ImportDeclaration(path) {
                    const source = path.node.source.value;
                    const target = resolveImport(file, source);
                    if (!target || !/\.(js|jsx)$/.test(target)) return;
                    const exports = collectExports(target);
                    if (exports.has('*')) return; // opaque target
                    for (const spec of path.node.specifiers) {
                        let want;
                        if (spec.type === 'ImportDefaultSpecifier') want = 'default';
                        else if (spec.type === 'ImportSpecifier') want = spec.imported.name;
                        else continue; // namespace import; always valid
                        checked += 1;
                        if (!exports.has(want)) {
                            const rel = file.slice(root.length + 1);
                            broken.push(`${rel}:${spec.loc?.start.line} imports {${want}} from '${source}' (not exported by target)`);
                        }
                    }
                },
            });
        }

        // Guard against a resolution regression silently checking nothing.
        expect(checked).toBeGreaterThan(1000);
        expect(broken).toEqual([]);
    });
});
