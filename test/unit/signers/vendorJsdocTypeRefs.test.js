// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Dangling JSDoc type references in the extracted vendor signer packages.
//
// `signers-ledger` and `signers-trezor` were split out of
// `@xchain-wallet/core`. The split repointed the runtime `import` statements
// and left the JSDoc `import('...')` ones behind, so every `@param` and
// `@returns` on both vendor signers named a sibling file that does not exist
// in the package: `./types.js`, `./Signer.js`, `../sdk/index.js`.
//
// Nothing caught it. Neither vendor package declares a `typecheck` script, so
// the root `pnpm -r --if-present typecheck` runs no checker over them at all,
// and a type annotation that resolves to nothing type-checks nothing while
// still reading, to a person, like a contract. This is the check that makes
// that class of rot visible: every relative specifier inside a comment must
// name a file that is really there.
//
// Scoped to the two vendor packages deliberately. They are the seam the
// extraction cut, and a repo-wide sweep would fold unrelated debt into a
// guard that has to stay green to be worth anything.

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const VENDOR_SRC_DIRS = [
    join(repoRoot, 'packages', 'signers-ledger', 'src'),
    join(repoRoot, 'packages', 'signers-trezor', 'src'),
];

/** Every `.js` file directly under the given source directories. */
function vendorSourceFiles() {
    return VENDOR_SRC_DIRS.flatMap((dir) => readdirSync(dir)
        .filter((name) => name.endsWith('.js'))
        .map((name) => join(dir, name)));
}

/** Every `import('<spec>')` specifier in a file, with its line number. */
function importSpecifiers(source) {
    const found = [];
    source.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(/import\('([^']+)'\)/g)) {
            found.push({ specifier: match[1], line: index + 1 });
        }
    });
    return found;
}

describe('vendor signer JSDoc type references', () => {
    it('finds the files it is meant to scan', () => {
        // The guard above the guard: readdirSync on a package that has been
        // renamed away returns nothing, and an empty scan passes every
        // assertion below without reading a single line.
        const files = vendorSourceFiles();
        expect(files.length).toBeGreaterThanOrEqual(6);
        expect(files.some((f) => f.endsWith('ledgerFormat.js'))).toBe(true);
        expect(files.some((f) => f.endsWith('trezorFormat.js'))).toBe(true);
    });

    it('reads at least one type reference out of each vendor package', () => {
        // Same shape of guard: a regex that stopped matching would leave the
        // resolution check below iterating an empty list.
        for (const dir of VENDOR_SRC_DIRS) {
            const refs = readdirSync(dir)
                .filter((name) => name.endsWith('.js'))
                .flatMap((name) => importSpecifiers(readFileSync(join(dir, name), 'utf8')));
            expect(refs.filter((r) => r.specifier.startsWith('.')).length).toBeGreaterThan(0);
        }
    });

    it('resolves every relative specifier to a file that exists', () => {
        const dangling = [];
        for (const file of vendorSourceFiles()) {
            for (const { specifier, line } of importSpecifiers(readFileSync(file, 'utf8'))) {
                if (!specifier.startsWith('.')) continue;
                const target = resolve(dirname(file), specifier);
                if (!existsSync(target)) {
                    dangling.push(`${file.slice(repoRoot.length + 1)}:${line} -> ${specifier} (${target})`);
                }
            }
        }
        expect(dangling, `JSDoc type references naming a file that does not exist:\n${dangling.join('\n')}`)
            .toEqual([]);
    });
});
