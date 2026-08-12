// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pins every `@xchain-wallet/*` bare specifier to the package source in
// THIS checkout, instead of letting it resolve through
// `node_modules/@xchain-wallet/*`.
//
// Why this matters for the gate: those links are pnpm's, not
// git's. Nothing in the repo describes them, so a `pnpm install` run from
// a different root, a second checkout on the same machine, or a stale
// store can leave a link pointing at another copy of `packages/core`.
// Imports keep working - the other copy has the same files - so the run
// stays green almost everywhere. It only breaks where a test asserts on
// module IDENTITY, and `vi.mock` is exactly that: the mock is keyed on the
// resolved id, so if the subject resolves the specifier to a different
// realpath than the test did, the mock silently becomes a no-op. It does
// not error, it just never applies, and the test fails somewhere further
// down looking like a product bug.
//
// Two unit files mock a bare workspace specifier
// (bridge/auto-sign-localhost, routes/ImportWallet.backupPointer) and they
// are the two that went red at fd472252 while the other 331 stayed green.
// Aliasing removes the variable: a run always tests the tree it was
// started from.
//
// The map is derived from each package's own `exports` block rather than
// hand-written, so a new subpath export is covered the day it is added and
// this file cannot drift away from the package manifests.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Turn one `exports` key into a Vite alias entry. Exact keys become
// anchored patterns; wildcard keys capture the tail and splice it into the
// replacement, matching Node's own `*` substitution.
function aliasFor(pkgName, subpath, target, pkgDir) {
    const specifier = subpath === '.' ? pkgName : `${pkgName}/${subpath.slice(2)}`;
    const abs = resolve(pkgDir, target);

    if (!specifier.includes('*')) {
        return { find: new RegExp(`^${escapeRe(specifier)}$`), replacement: abs };
    }
    // `./ui/*` -> match `@xchain-wallet/core/ui/<tail>`, keep <tail>.
    const [head] = specifier.split('*');
    return {
        find: new RegExp(`^${escapeRe(head)}(.*)$`),
        replacement: abs.replace('*', '$1'),
    };
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the alias list for the wallet workspace.
 *
 * @param {string} repoRoot absolute path to the xchain-wallet root
 * @returns {Array<{find: RegExp, replacement: string}>} Vite alias entries
 */
export function workspaceAlias(repoRoot) {
    const packagesDir = join(repoRoot, 'packages');
    const entries = [];

    for (const dir of readdirSync(packagesDir)) {
        const pkgDir = join(packagesDir, dir);
        const manifest = join(pkgDir, 'package.json');
        if (!existsSync(manifest)) continue;

        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (!pkg.name?.startsWith('@xchain-wallet/')) continue;

        const exports = pkg.exports ?? { '.': pkg.main ?? './src/index.js' };
        for (const [subpath, target] of Object.entries(exports)) {
            // Conditional exports would need condition-aware resolution;
            // the wallet uses plain string targets. Skip anything else
            // rather than guess, so an unhandled shape falls back to
            // node_modules instead of resolving to the wrong file.
            if (typeof target !== 'string') continue;
            entries.push(aliasFor(pkg.name, subpath, target, pkgDir));
        }
    }

    // Vite walks the alias array in order and takes the first match, so a
    // wildcard like `./ui/*` must not shadow the exact `./ui/tokens.css`.
    // Longest literal prefix first puts exact keys ahead of the wildcards
    // that would otherwise swallow them.
    return entries.sort((a, b) => {
        const litA = a.find.source.split('(')[0].length;
        const litB = b.find.source.split('(')[0].length;
        return litB - litA;
    });
}
