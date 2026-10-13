// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Build-profile surfaces (§2.3).
//
// The 2026-10-09 review decision ships the DEX in every profile. The
// compile-out switch remains available for a future reviewed decision, so its
// twin and module-graph invariants remain tested even though no current profile
// selects it.
//
// Three things can break that quietly, and each has a test below:
//   1. the twin drifting from the real module, so a profile that selects it
//      calls an export that does not exist;
//   2. the twin importing something, which would put the surface back in the
//      bundle while every label still said it was gone;
//   3. a second importer of a DEX route component appearing anywhere in the
//      web shell, which defeats the alias no matter how the alias is written.
//
// What these do NOT prove is the artifact: only a real build does that, which
// is why the build itself fails shut on (3) via the vite guard plugin, and why
// the item's closure ran both builds and diffed them.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
    BUILD_PROFILES,
    DEFAULT_BUILD_PROFILE,
    HIDDEN_SURFACES,
    SURFACES,
    SURFACE_MODULES,
    SURFACE_VIEWS,
    hiddenSurfacesFor,
    isSurfaceEnabled,
} from '../../../packages/web/src/surfaces/registry.js';
import * as realDex from '../../../packages/web/src/surfaces/dex.jsx';
import * as hiddenDex from '../../../packages/web/src/surfaces/dex.hidden.jsx';

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, '..', '..', '..', 'packages', 'web', 'src');
const surfacesDir = join(webSrc, 'surfaces');

/** Every .js/.jsx file under packages/web/src, so no importer can hide. */
function webSourceFiles(dir = webSrc, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules' || entry === 'dist') continue;
            webSourceFiles(full, out);
        } else if (/\.jsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

describe('the surface registry', () => {
    it('describes every profile the build system knows about', () => {
        // A profile missing from the table would silently mean "hides
        // nothing", making the artifact drift from the reviewed registry.
        for (const profile of BUILD_PROFILES) {
            expect(Object.keys(HIDDEN_SURFACES)).toContain(profile);
        }
        expect(HIDDEN_SURFACES[DEFAULT_BUILD_PROFILE]).toEqual([]);
    });

    it('ships the DEX surface in every profile and keeps the hide switch', () => {
        expect(SURFACES).toContain('dex');
        for (const profile of BUILD_PROFILES) {
            expect(hiddenSurfacesFor(profile)).toEqual([]);
            expect(isSurfaceEnabled('dex', profile)).toBe(true);
        }
    });

    it('refuses an unknown surface or profile instead of guessing', () => {
        // Either guess can make the built surface set disagree with the
        // reviewed registry, so both fail loudly at build time.
        expect(() => isSurfaceEnabled('dexx', 'store')).toThrow(/unknown surface/);
        expect(() => isSurfaceEnabled('dex', 'mobile')).toThrow(/unknown build profile/);
    });

    it('names a twin file and at least one owned module for every surface', () => {
        const files = readdirSync(surfacesDir);
        for (const surface of SURFACES) {
            expect(files).toContain(`${surface}.jsx`);
            expect(files).toContain(`${surface}.hidden.jsx`);
            expect(SURFACE_MODULES[surface].length).toBeGreaterThan(0);
            expect(SURFACE_VIEWS[surface].length).toBeGreaterThan(0);
        }
    });
});

describe('the hidden twin', () => {
    it('exports exactly what the real module exports', () => {
        // A profile that selects the twin runs it. A name added on one side
        // only would become undefined at runtime.
        expect(Object.keys(hiddenDex).sort()).toEqual(Object.keys(realDex).sort());
    });

    it('reports the surface as absent, and renders no view at all', () => {
        expect(realDex.DEX_SURFACE_ENABLED).toBe(true);
        expect(hiddenDex.DEX_SURFACE_ENABLED).toBe(false);
        for (const view of SURFACE_VIEWS.dex) {
            expect(hiddenDex.renderDexRoute(view, {})).toBeNull();
        }
        // And nothing else either: an unmatched view falls through to Home.
        expect(hiddenDex.renderDexRoute('home', {})).toBeNull();
    });

    it('imports nothing, which is the entire mechanism', () => {
        // An import here would drag the surface back into a hidden-profile
        // bundle while every label still said it was absent - the false claim
        // in a signed manifest that that gate exists to prevent.
        const src = readFileSync(join(surfacesDir, 'dex.hidden.jsx'), 'utf8');
        expect(src).not.toMatch(/^\s*import\s/m);
        expect(src).not.toMatch(/\bimport\s*\(/);
        expect(src).not.toMatch(/\brequire\s*\(/);
    });
});

describe('the DEX route components', () => {
    it('are imported by the surface module and nowhere else in the web shell', () => {
        // This is the one way the alias swap can silently fail: it replaces the
        // surface module, so a second importer keeps the code in the bundle.
        // vite.config.js fails the build on it too; this says which file, in a
        // second rather than in a build.
        const owner = join(surfacesDir, 'dex.jsx');
        const offenders = [];
        for (const file of webSourceFiles()) {
            if (file === owner) continue;
            const src = readFileSync(file, 'utf8');
            for (const mod of SURFACE_MODULES.dex) {
                const name = mod.split('/').pop();
                // An IMPORT, not a mention: the registry names these same paths
                // as data, which is the point of it.
                const imports = new RegExp(
                    `(?:from|import\\()\\s*['"][^'"]*shared/routes/${name}['"]`,
                );
                if (imports.test(src)) {
                    offenders.push(`${relative(webSrc, file)} -> ${name}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('are all actually imported by the surface module', () => {
        // The other direction: a module listed in SURFACE_MODULES but no longer
        // imported here is a stale entry, and a stale entry makes the build
        // guard assert something nothing can violate.
        const src = readFileSync(join(surfacesDir, 'dex.jsx'), 'utf8');
        for (const mod of SURFACE_MODULES.dex) {
            expect(src).toContain(mod);
        }
    });

    it('are every import of the surface module, bar the allowlisted shared ones', () => {
        // The reverse direction: a route imported here but missing from
        // SURFACE_MODULES.dex is watched by no guard, so a later second
        // importer would put it back in a hidden-profile bundle with the build
        // green.
        const specifiers = importSpecifiers(dexCode());
        expect(specifiers.length).toBeGreaterThan(0);
        const listed = [...SURFACE_MODULES.dex, ...DEX_SHARED_IMPORTS];
        const unlisted = specifiers.filter((s) => !listed.some((m) => s.endsWith(`/${m}`)));
        expect(unlisted, 'add each to SURFACE_MODULES.dex in surfaces/registry.js').toEqual([]);

        // And the allowlist may neither rot nor overlap the registry.
        for (const shared of DEX_SHARED_IMPORTS) {
            expect(specifiers.some((s) => s.endsWith(`/${shared}`))).toBe(true);
            expect(SURFACE_MODULES.dex).not.toContain(shared);
        }
    });
});

describe('the DEX views', () => {
    it('are exactly the views the surface module routes', () => {
        // A view branch missing from SURFACE_VIEWS.dex is never checked
        // against the twin, so the registry must match the routing exactly.
        const code = dexCode();
        const routed = [...code.matchAll(/\bunlockedView\s*===\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
        expect([...new Set(routed)].sort()).toEqual([...SURFACE_VIEWS.dex].sort());

        // Fail closed on any other routing shape (a switch, an includes()):
        // every use of the name is the parameter or a `=== '<view>'` test.
        const uses = code.match(/\bunlockedView\b/g) ?? [];
        expect(uses.length, "route DEX views as `unlockedView === '<name>'`").toBe(routed.length + 1);
    });
});

// Shared components the surface merely USES, which registry.js deliberately
// leaves out of SURFACE_MODULES (ReceivePicker also serves `receive-picker`).
const DEX_SHARED_IMPORTS = ['shared/routes/ReceivePicker.jsx'];

/** dex.jsx with comments stripped, so prose naming a view or module is not counted. */
function dexCode() {
    return readFileSync(join(surfacesDir, 'dex.jsx'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

/** Every static and dynamic import specifier in `code`. */
function importSpecifiers(code) {
    return [...code.matchAll(/(?:\bfrom|\bimport\s*\(|^\s*import)\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}
