// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Guards the alias map that pins `@xchain-wallet/*` to this checkout
//The map is generated from each package's own `exports` block,
// so these tests are mostly about the two ways generation can go wrong:
// a wildcard swallowing a more specific exact key, and a replacement that
// points at a file nobody moved the alias to follow.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, sep } from 'node:path';
import { workspaceAlias } from '../../vitest/workspaceAlias.js';

// jsdom gives `import.meta.url` an http: origin, so walk up from cwd to
// the workspace marker instead - the same approach import-exports.test.js
// uses for its tree scan.
function findRepoRoot() {
    let dir = process.cwd();
    while (!existsSync(`${dir}${sep}pnpm-workspace.yaml`)) {
        const up = dirname(dir);
        if (up === dir) throw new Error('xchain-wallet root not found above ' + process.cwd());
        dir = up;
    }
    return dir + sep;
}

const repoRoot = findRepoRoot();
const alias = workspaceAlias(repoRoot);

// Mirror how Vite applies an alias array: first match wins.
function resolveVia(specifier) {
    for (const { find, replacement } of alias) {
        if (find.test(specifier)) return specifier.replace(find, replacement);
    }
    return null;
}

const rel = (abs) => abs?.slice(repoRoot.length);

describe('workspaceAlias', () => {
    it('pins the bare package specifier to package source', () => {
        expect(rel(resolveVia('@xchain-wallet/core'))).toBe('packages/core/src/index.js');
    });

    it('resolves an exact subpath export to its index, not into the wildcard', () => {
        // `./ui` and `./ui/*` are both declared; the exact key must win or
        // every `@xchain-wallet/core/ui` import lands on a directory.
        expect(rel(resolveVia('@xchain-wallet/core/ui'))).toBe('packages/core/src/ui/index.js');
        expect(rel(resolveVia('@xchain-wallet/core/shared'))).toBe('packages/core/src/shared/index.js');
        expect(rel(resolveVia('@xchain-wallet/core/flows'))).toBe('packages/core/src/flows/index.js');
    });

    it('keeps a longer exact key ahead of the wildcard that would swallow it', () => {
        // `./ui/tokens.css` is exported explicitly AND matched by `./ui/*`.
        // Both land on the same file here, but the ordering rule is what
        // stops a future asymmetric pair from silently taking the wrong one.
        expect(rel(resolveVia('@xchain-wallet/core/ui/tokens.css')))
            .toBe('packages/core/src/ui/tokens.css');
    });

    it('splices the tail of a wildcard export, including nested paths', () => {
        expect(rel(resolveVia('@xchain-wallet/core/shared/utils/logConsole.js')))
            .toBe('packages/core/src/shared/utils/logConsole.js');
        expect(rel(resolveVia('@xchain-wallet/core/branding/images/logo.svg')))
            .toBe('packages/core/src/branding/images/logo.svg');
    });

    it('covers the non-core workspace packages too', () => {
        expect(rel(resolveVia('@xchain-wallet/bridge-spec'))).toMatch(/^packages\/bridge-spec\//);
        expect(rel(resolveVia('@xchain-wallet/signers-trezor'))).toMatch(/^packages\/signers-trezor\//);
    });

    it('leaves third-party specifiers alone', () => {
        expect(resolveVia('react')).toBeNull();
        expect(resolveVia('@testing-library/react')).toBeNull();
        // Near-miss: not a workspace package, must not be captured.
        expect(resolveVia('@xchain-wallet-other/core')).toBeNull();
    });

    it('never resolves outside this checkout', () => {
        // The property the whole file exists for. An alias pointing at
        // another copy of the tree is the failure mode being fixed.
        for (const { replacement } of alias) {
            expect(replacement.startsWith(repoRoot), replacement).toBe(true);
        }
    });

    it('points every non-wildcard alias at a file that exists', () => {
        const missing = alias
            .filter(({ replacement }) => !replacement.includes('$1'))
            .map(({ replacement }) => replacement)
            .filter((p) => !existsSync(p));
        expect(missing, 'exports entries whose target is gone').toEqual([]);
    });

    it('covers every string export every workspace package declares', () => {
        // Generation is only as good as its coverage: if a package adds a
        // subpath export and the generator skips it, that import quietly
        // falls back to node_modules and the pinning has a hole.
        const holes = [];
        for (const dir of ['core', 'extension', 'web', 'bridge-spec', 'signers-ledger', 'signers-trezor']) {
            const manifest = `${repoRoot}packages/${dir}/package.json`;
            if (!existsSync(manifest)) continue;
            const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
            for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
                if (typeof target !== 'string' || subpath.includes('*')) continue;
                const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
                if (!resolveVia(specifier)) holes.push(specifier);
            }
        }
        expect(holes, 'exported specifiers with no alias entry').toEqual([]);
    });
});
