// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Discovers every `*.smoke.js` under this directory (recursively) and
// runs them sequentially. Exits non-zero on the first failure.
//
// Each smoke is a standalone Node script that exercises a thin slice
// of wiring (no Vitest, no jsdom). The runner stays small on purpose
// so dropping a new `*.smoke.js` into any subdirectory is enough to
// pick it up; no manifest to update.
//
// `cwd` for spawned smokes is the wallet repo root so smokes that
// read project files via relative paths get a stable base.

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { noteWorkspaceLinkage } from './_workspace-linkage.js';

const here = dirname(fileURLToPath(import.meta.url));        // .../test/smoke
const wsRoot = join(here, '..', '..');                        // .../xchain-wallet

/**
 * Say ONCE, before anything runs, when this checkout is the kind of venue that
 * produces failures which are not in the code ( frontier row 73).
 *
 * Measured on 2026-08-08 in a linked worktree: the suite came back 28 / 441
 * failed, then 4, then 2, and every one of those was the venue rather than the
 * tree. Twenty-eight were the strict docs sibling with no XCHAIN_DOCS_ROOT set
 * (that message is clear, but it arrives 28 times and buries whatever else
 * broke); two were a NEIGHBOURING session's uncommitted edits to the docs
 * checkout, which the content smokes read as defects here; and two were module
 * identity - a `node_modules` symlinked in from another checkout resolves
 * `@xchain-wallet/extension` to a different copy of the same file, so a module
 * that registers into a Map and a smoke that reads that Map are looking at two
 * different objects. That last one asserts as `actual: 'object', expected:
 * 'function'`, a message naming neither symlinks nor packages.
 *
 * These are NOTES, never a refusal: the run continues either way, because a
 * warning that stopped the suite would be worse than the confusion it prevents.
 */
function venueNotes() {
    const notes = [];
    const insideThisCheckout = realpathSync(wsRoot);

    // 1. Is node_modules ours, or borrowed from another checkout?
    const borrowed = (p) => {
        if (!existsSync(p)) return null;
        const real = realpathSync(p);
        return real.startsWith(insideThisCheckout) ? null : real;
    };
    const nm = borrowed(join(wsRoot, 'node_modules'));
    const alias = borrowed(join(wsRoot, 'node_modules', '@xchain-wallet', 'extension'));
    if (alias) {
        notes.push(`node_modules/@xchain-wallet/extension resolves OUTSIDE this checkout (${alias}).`
            + ' A workspace alias pointing at another tree makes an import-by-alias and an import-by-relative-path'
            + ' two different modules, so a registry built in one is invisible to the other. Point'
            + " node_modules/@xchain-wallet/* at this checkout's own packages/, or run pnpm install here.");
    } else if (nm) {
        notes.push(`node_modules is borrowed from ${nm}. Fine for most smokes; check the alias links under`
            + ' node_modules/@xchain-wallet/ first if a failure looks like a registry that lost its entries.');
    }

    // 2. The docs sibling: absent, or dirty with somebody else's edits.
    const docsRoot = process.env.XCHAIN_DOCS_ROOT || join(wsRoot, '..', 'xchain-documentation');
    if (!existsSync(join(docsRoot, 'components', 'wallet'))) {
        notes.push(`the wallet docs sibling is not readable at ${docsRoot}. Every content-asserting smoke will`
            + ' fail with the same message; set XCHAIN_DOCS_ROOT to a checkout of xchain-documentation.');
    } else {
        try {
            const dirty = execFileSync('git', ['status', '--porcelain', 'components/wallet'], {
                cwd: docsRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (dirty) {
                notes.push(`the docs checkout at ${docsRoot} has UNCOMMITTED changes under components/wallet`
                    + ` (${dirty.split('\n').length} file(s)). A docs-content smoke failing here may be measuring`
                    + " another session's work in progress rather than this tree; re-check it against a clean"
                    + ' worktree of the docs repo before believing it.');
            }
        } catch { /* not a git checkout, or no git on PATH: nothing to say */ }
    }

    return notes;
}

for (const note of venueNotes()) {
    console.log(`VENUE: ${note}\n`);
}

function* walkSmokes(dir) {
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
            yield* walkSmokes(full);
        } else if (name.endsWith('.smoke.js')) {
            yield full;
        }
    }
}

const smokes = [...walkSmokes(here)];

// Name the node_modules tree the workspace specifiers resolve through when it
// belongs to a different checkout . A borrowed node_modules makes a
// run a hybrid of two trees, which is how a correct signer bridge was measured
// red at an origin/master worktree and filed as a regression. Said here because
// the smokes are separate processes and cannot see each other's notice; the
// flag tells them so. The sibling docs-tree notice this used to sit beside now
// happens inline above, so only the linkage half is announced here.
noteWorkspaceLinkage();
process.env.XCHAIN_WORKSPACE_LINKAGE_NOTED = '1';

let failures = 0;
for (const fullPath of smokes) {
    const display = fullPath.slice(here.length + 1);
    const start = Date.now();
    const result = spawnSync(process.execPath, [fullPath], {
        stdio: 'inherit',
        cwd: wsRoot,
    });
    const ms = Date.now() - start;
    if (result.status !== 0) {
        failures += 1;
        console.error(`FAIL ${display} (${ms}ms, exit ${result.status})`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} / ${smokes.length} smoke(s) failed`);
    process.exit(1);
}
console.log(`\n${smokes.length} smoke(s) passed`);
