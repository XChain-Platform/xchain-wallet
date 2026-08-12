// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §8: every workspace package the desktop MAIN
// process can reach must be a declared dependency of packages/desktop.
//
// WHAT THIS IS DEFENDING, and it is not hypothetical. The packaged desktop
// app could not start AT ALL, at any Electron version, and every gate this
// repo has stayed green while it could not. Launched from the real
// linux-unpacked output it died immediately with:
//
//   ERR_MODULE_NOT_FOUND: Cannot find module
//   '/app/resources/app.asar/node_modules/@xchain-wallet/signers-trezor/src/
//    TrezorSigner.js' imported from
//   '.../@xchain-wallet/core/src/signers/index.js'
//
// The mechanism is a name that is only correct in one directory layout.
// `@xchain-wallet/core` imports both signers packages by a relative path
// that ESCAPES ITS OWN PACKAGE (`../../../signers-trezor/...`) and declares
// neither as a dependency. In the source tree that resolves through the
// monorepo layout. electron-builder packs the DECLARED production
// dependency tree, so the packed asar carried `@xchain-wallet/{core,
// extension}` and neither signers package, and the escape pointed at
// nothing.
//
// Why nothing caught it:
//
//   - the web and extension shells are Vite-bundled, so the import is
//     inlined at build time and the relative path never survives to run;
//   - the desktop MAIN process is the one consumer that loads this code
//     UNBUNDLED from the asar at runtime;
//   - and no test, smoke or CI job in this repo has ever started the
//     packaged app. §8 asks for exactly that smoke ("app launches"); it
//     did not exist.
//
// So this check is static and cheap on purpose: it is the part of the
// launch smoke that can run without a machine, and it fails on the exact
// condition that produced the crash. It walks the main-process import
// graph across package boundaries and requires that every workspace
// package reachable from it is declared in packages/desktop's
// dependencies, which is the only thing the packer honours.

import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// name -> directory, for every workspace package under packages/.
const workspaceByName = new Map();
for (const entry of readdirSync(packagesDir)) {
    const dir = join(packagesDir, entry);
    const manifest = join(dir, 'package.json');
    if (!statSync(dir).isDirectory() || !existsSync(manifest)) continue;
    workspaceByName.set(readJson(manifest).name, dir);
}

const desktopDir = join(packagesDir, 'desktop');
const desktopPkg = readJson(join(desktopDir, 'package.json'));
const declared = new Set(Object.keys(desktopPkg.dependencies || {}));

// Which workspace package does an absolute path belong to?
function owningPackage(absPath) {
    for (const [name, dir] of workspaceByName) {
        const rel = relative(dir, absPath);
        if (rel && !rel.startsWith('..') && !rel.startsWith(sep)) return name;
    }
    return null;
}

// Resolve a relative specifier to a file on disk, tolerating the extension
// styles used in this repo. A specifier that does not resolve is reported
// rather than skipped: an unresolvable import in the main process is the
// very failure this smoke exists for.
function resolveRelative(fromFile, spec) {
    const base = resolve(dirname(fromFile), spec);
    const candidates = [
        base,
        `${base}.js`,
        `${base}.mjs`,
        `${base}.cjs`,
        join(base, 'index.js'),
    ];
    for (const c of candidates) {
        if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
}

const IMPORT_RE = /(?:^|[^\w$.])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[^\w$.])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersIn(file) {
    // Block comments are stripped first, because JSDoc type annotations use
    // the same `import('...')` syntax as a real dynamic import and are not
    // loaded by anything. Three of them in this repo point at paths that do
    // not exist (`../sdk/index.js` from both signers packages), which is a
    // dead type reference rather than a packaging defect - a guard that
    // counted them would cry wolf on every run and get switched off.
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    for (const m of src.matchAll(IMPORT_RE)) {
        const spec = m[1] || m[2] || m[3];
        if (spec) out.push(spec);
    }
    return out;
}

// Walk from the main-process entry points across relative imports, through
// package boundaries, collecting every workspace package reached.
const entryPoints = [
    join(desktopDir, desktopPkg.main.replace(/^\.\//, '')),
    join(desktopDir, 'preload.cjs'),
].filter(existsSync);

assert.ok(entryPoints.length > 0,
    'the desktop package must have a resolvable main entry point to walk');

const seen = new Set();
const reached = new Map(); // workspace package name -> an example importer
const unresolved = [];
const queue = [...entryPoints];

while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    for (const spec of specifiersIn(file)) {
        // BARE WORKSPACE SPECIFIERS COUNT TOO, and missing one of those is the
        // third instance this found: `@xchain-wallet/extension` imports
        // `@xchain-wallet/bridge-spec`, which NEITHER extension nor core
        // declares, so nothing put it in the asar and the packaged app died on
        // it once the two relative-path defects above were fixed. A walk that
        // followed only relative imports would have handed that back one
        // 20-minute container build at a time.
        if (!spec.startsWith('.')) {
            const owner = [...workspaceByName.keys()]
                .filter((n) => spec === n || spec.startsWith(`${n}/`))
                // longest match wins, so a scope prefix cannot shadow a package
                .sort((a, b) => b.length - a.length)[0];
            if (owner && owner !== desktopPkg.name) {
                if (!reached.has(owner)) reached.set(owner, relative(repoRoot, file));
                // and walk into it, so its own imports are covered
                const entry = join(workspaceByName.get(owner), 'src', 'index.js');
                if (existsSync(entry)) queue.push(entry);
                const sub = spec.slice(owner.length + 1);
                if (sub) {
                    const subFile = join(workspaceByName.get(owner), sub);
                    if (existsSync(subFile) && statSync(subFile).isFile()) queue.push(subFile);
                }
            }
            continue;
        }
        const target = resolveRelative(file, spec);
        if (!target) {
            // Only report escapes: a missing intra-package file is a
            // different (and louder) problem than the one this guards.
            if (spec.includes('..')) unresolved.push({ file, spec });
            continue;
        }
        const owner = owningPackage(target);
        if (owner && owner !== desktopPkg.name && !reached.has(owner)) {
            reached.set(owner, relative(repoRoot, file));
        }
        queue.push(target);
    }
}

// 1. Every workspace package the main process reaches is declared, so the
//    packer copies it into the asar.
for (const [name, importer] of reached) {
    assert.ok(
        declared.has(name),
        `packages/desktop must declare "${name}" as a dependency: the main-process `
        + `import graph reaches it (via ${importer}), but electron-builder packs only `
        + `the declared production tree, so it would be ABSENT from app.asar and the `
        + `app would die at startup with ERR_MODULE_NOT_FOUND. This is exactly how the `
        + `packaged build was broken at every version until.`,
    );
}

// 2. The two signers packages specifically, because they are the ones that
//    were missing and the ones a future refactor is most likely to drop:
//    core reaches both, so both must be declared whatever the walk finds.
for (const name of ['@xchain-wallet/signers-trezor', '@xchain-wallet/signers-ledger']) {
    assert.ok(workspaceByName.has(name), `${name} must exist as a workspace package`);
    assert.ok(
        declared.has(name),
        `packages/desktop must declare "${name}": @xchain-wallet/core imports it by a `
        + `path that escapes its own package and declares no dependency on it, so the `
        + `only thing putting it in the asar is this declaration`,
    );
}

// 3. No main-process import escapes its package and resolves to nothing.
//    That is the shape of the original crash, caught statically.
assert.equal(
    unresolved.length, 0,
    'a main-process import escapes its package and resolves to no file on disk:\n'
    + unresolved.map((u) => `  ${relative(repoRoot, u.file)} -> ${u.spec}`).join('\n'),
);

// 4. AND THE SHARPER RULE, which is the second defect this found and the one
//    declaring a dependency CANNOT fix. `main/` is packed at the ROOT of
//    app.asar, so a relative specifier that leaves packages/desktop leaves
//    the ARCHIVE: `main/messageHost.js` importing
//    `../../extension/src/background/createBackgroundHost.js` resolved, once
//    packed, to `/app/resources/extension/...`, and resources/ holds only
//    app-update.yml, app.asar, app.asar.unpacked, apparmor-profile and
//    package-type. It resolves in the source tree, which is the whole trap.
//    Nothing but a package-name specifier is correct here, so relative
//    escapes out of packages/desktop are refused outright rather than
//    checked for a declaration that would not help.
{
    const escapes = [];
    for (const file of seen) {
        const rel = relative(desktopDir, file);
        const isDesktopMainFile = rel && !rel.startsWith('..') && !rel.startsWith(sep);
        if (!isDesktopMainFile) continue;
        for (const spec of specifiersIn(file)) {
            if (!spec.startsWith('.')) continue;
            const target = resolve(dirname(file), spec);
            const outside = relative(desktopDir, target);
            if (outside.startsWith('..')) {
                escapes.push({ file: relative(repoRoot, file), spec });
            }
        }
    }
    assert.equal(
        escapes.length, 0,
        'a desktop main-process file imports across the package boundary by a RELATIVE path. '
        + 'main/ is packed at the root of app.asar, so this specifier leaves the archive at '
        + 'runtime and the app dies at startup, even though it resolves fine in the source '
        + 'tree. Import it by package name instead (@xchain-wallet/core/..., '
        + '@xchain-wallet/extension/...), adding an exports entry to the target package if the '
        + 'subpath is not exposed yet:\n'
        + escapes.map((e) => `  ${e.file} -> ${e.spec}`).join('\n'),
    );
}

console.log(
    `OK: desktop packed-workspace-deps smoke (walked ${seen.size} main-process file(s) from`
    + `${entryPoints.length} entry point(s); every workspace package the graph reaches `
    + `[${[...reached.keys()].sort().join(', ') || 'none'}] is a declared dependency of packages/desktop, so `
    + `electron-builder packs it into app.asar. This is the static half of §8's missing packaged-app launch `
    + `smoke: the packaged app died at startup on ERR_MODULE_NOT_FOUND for @xchain-wallet/signers-trezor, which `
    + `core imports by a path escaping its own package while declaring no dependency on it, and which the packer `
    + `therefore never copied)`,
);
