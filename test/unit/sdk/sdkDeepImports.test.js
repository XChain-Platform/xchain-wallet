// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node
//
// Every deep `xchain-sdk/src/...` path this repo names must resolve against
// the SDK that is actually installed.
//
// An SDK structure pass can move a module out from under a path the wallet
// spells. Without this guard the failure surfaces somewhere else: a static
// deep import fails at TRANSFORM time and kills every suite that imports the
// importer, and a resolver returning null reaches require() as a type error
// naming nothing. Resolution here throws naming the module and every spelling.
//
// Two assertions. Resolving the inventory proves the registered paths are
// good; it cannot prove the inventory is COMPLETE, so the scan below walks the
// repo for deep SDK specifiers and fails on any that is not registered.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDK_DEEP_PATHS, resolveSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

// Where wallet code that can name an SDK path lives. Everything generated or
// vendored is skipped: a hit inside node_modules or dist is the SDK's own
// business or a build artifact, not a spelling this repo maintains.
const SCAN_ROOTS = ['test', 'packages', 'bin', 'tools'];
const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'build', 'coverage', '.vite', '.turbo', 'playwright-report',
    'test-results', 'release', 'out',
]);
const SCAN_EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];

// A deep SDK path written as a quoted string literal, with any number of
// leading `../` segments. Quotes matter: prose references to SDK modules in
// comments are backticked or bare, some name modules that no longer exist, and
// a documentation mention is not a resolution the build performs.
const DEEP_SPEC = /['"]((?:\.\.\/)*xchain-sdk\/src\/[A-Za-z0-9_./-]+\.(?:js|cjs|mjs|json))['"]/g;

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (SCAN_EXTS.some((ext) => entry.endsWith(ext))) out.push(full);
    }
    return out;
}

/** Strip the leading `../` walk-up so a sibling-relative spelling and a
 *  package-relative one compare as the same SDK file. */
const tail = (spec) => spec.replace(/^(?:\.\.\/)+/, '').replace(/^xchain-sdk\//, '');

describe('deep xchain-sdk paths resolve against the installed SDK', () => {
    if (!sdkInstalled()) {
        // House convention (test/integration/hd/wallet-sdk-derivation-parity.test.js,
        // test/unit/ActionManifestConformance.test.js): a checkout without the
        // SDK skips, unless XCHAIN_REQUIRE_SIBLINGS=1 says a job checked it out.
        it('path guard requires the xchain-sdk package', (ctx) => {
            if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1') {
                throw new Error(
                    'xchain-sdk is not resolvable from packages/{web,extension,desktop} nor as a '
                    + 'sibling checkout, but XCHAIN_REQUIRE_SIBLINGS=1 says it should be. This '
                    + 'guard resolves every deep SDK path the wallet names and cannot run without '
                    + 'the SDK.'
                );
            }
            ctx.skip();
        });
        return;
    }

    for (const [name, candidates] of Object.entries(SDK_DEEP_PATHS)) {
        it(`${name} (${candidates.join(' or ')}) resolves`, () => {
            // The assertion IS resolveSdkDeep: it throws naming the path, which
            // is the readable message this whole guard exists to produce. A
            // wrapper that only checked a boolean would report "false".
            const { spec, filename } = resolveSdkDeep(name);
            expect(candidates.some((c) => spec === `xchain-sdk/${c}`)).toBe(true);
            // Resolution is not existence for a package with an exports map, so
            // read a byte of the file the resolver named.
            expect(readFileSync(filename).length).toBeGreaterThan(0);
        });
    }

    it('every deep SDK specifier written in this repo is registered and resolvable', () => {
        const files = SCAN_ROOTS
            .map((r) => join(repoRoot, r))
            .filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } })
            .flatMap((d) => walk(d));

        /** @type {string[]} */
        const unregistered = [];
        const registeredTails = new Set(
            Object.values(SDK_DEEP_PATHS).flatMap((c) => c)
        );

        for (const file of files) {
            const src = readFileSync(file, 'utf8');
            for (const m of src.matchAll(DEEP_SPEC)) {
                const t = tail(m[1]);
                if (registeredTails.has(t)) continue;
                unregistered.push(`${relative(repoRoot, file)}: ${m[1]}`);
            }
        }

        expect(
            unregistered,
            'These deep xchain-sdk specifiers are not in SDK_DEEP_PATHS '
            + '(test/helpers/sdkDeepPaths.js), so nothing proves they still resolve after an SDK '
            + 'structure pass. Register each one, listing the current spelling first and any '
            + 'pre-pass spelling after it:\n  ' + unregistered.join('\n  ')
        ).toEqual([]);
    });
});
