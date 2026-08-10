// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Names the node_modules tree these smokes are about to resolve through, when
// it belongs to a checkout other than the one being tested .
//
// A bare specifier like `@xchain-wallet/extension` resolves by walking up from
// the importing file to the nearest node_modules. The workspace links inside
// it are RELATIVE symlinks (`@xchain-wallet/extension -> ../../packages/
// extension`), and Node resolves symlinks to their real path, so those links
// point at whichever checkout physically owns the node_modules directory. A
// git worktree that borrows a sibling's node_modules therefore runs a hybrid:
// files reached relatively come from the worktree, files reached by specifier
// come from the checkout next door. Both trees are real, both are XChain, and
// nothing in the output says two of them were involved.
//
// That silence is the whole cost. Measured 2026-08-06, a full 431-suite run at
// a throwaway origin/master worktree reported exactly two reds, both pure
// registration assertions inside the desktop signer bridge, and they were read
// as a bridge regression and filed as . The bridge was correct. The
// suites were comparing a registry written through one copy of
// `background/signerBridge.js` against a registry read through another.
// Re-measured 2026-08-09: green at 9f9f1f5a in a worktree holding its own
// node_modules, red at 3d0558de in one symlinking a sibling's, same code.
//
// Two things follow, and this file is only the second of them. The suites
// themselves now import that registry by the same specifier their subject
// uses, so they no longer split. This notice covers everything that fix does
// not: a borrowed tree still means the verdict describes code from another
// checkout, which matters most in the exact situation that produced ,
// someone measuring origin/master and trusting the number.
//
// The unit suite already met this hazard and closed it a different way: see
// test/vitest/workspaceAlias.js , where a `@xchain-wallet/*` link into
// a second checkout turned `vi.mock` into a silent no-op and two tests "failed
// somewhere further down looking like a product bug". Vitest can pin every
// specifier to this checkout with a resolve alias. The smokes are plain `node`
// processes with no such hook, so they get the other half of the treatment:
// the suites import shared singletons by the same specifier their subject
// uses, and this says out loud which tree that specifier found.
//
// ADVISORY, LIKE THE DOCS-TREE NOTICE IT SITS BESIDE (_docs-repo.js, ).
// It prints and never changes a verdict. A borrowed node_modules is a normal
// way to run these suites cheaply and is usually harmless; failing on it would
// be a new way for the gate to go red for reasons that are not the wallet. It
// also stays silent when it cannot tell, rather than guessing.
//
// Not a `*.smoke.js` file, so the runner does not try to execute it.

import { realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));        // .../test/smoke
const WS_ROOT = join(here, '..', '..');                       // .../xchain-wallet

// One workspace package is enough to identify the tree: every link in
// node_modules/@xchain-wallet/ is created by the same install and points into
// the same checkout. `extension` is the one  was actually about.
const PROBE_SPECIFIER = '@xchain-wallet/extension/package.json';

let noticeShown = false;

// Both sides of the comparison must be real paths or the comparison is
// meaningless: the borrowing is expressed AS a symlink, so an unresolved
// node_modules path sits inside the worktree and looks local.
function realpathOr(p) {
    try { return realpathSync(p); } catch { return p; }
}

/**
 * Where the workspace specifiers actually land.
 *
 * @param {{ resolve?: (spec: string) => string, root?: string }} [io]
 * @returns {{ root: string, resolved: string, borrowed: boolean } | null}
 *          null when resolution is unavailable, which is not a finding.
 */
export function workspaceLinkage(io = {}) {
    const root = io.root || realpathOr(WS_ROOT);
    const resolve = io.resolve || createRequire(import.meta.url).resolve;

    let resolved;
    try {
        // The package DIRECTORY, not its manifest: the reader needs to see
        // which tree they are in, and a trailing `/package.json` only buries
        // that under a filename.
        resolved = realpathOr(dirname(resolve(PROBE_SPECIFIER)));
    } catch {
        // No install at all, or a layout that does not expose the subpath.
        // Either way this helper has nothing to say; the suites that need the
        // package will fail on their own terms and say so plainly.
        return null;
    }

    // Compare on a path-boundary, so a sibling named `xchain-wallet-old` is
    // not mistaken for this checkout by a bare prefix match.
    const borrowed = !(resolved === root || resolved.startsWith(root + sep));
    return { root, resolved, borrowed };
}

/**
 * Clear the once-per-process latch. Test-only: the latch is deliberate
 * behavior, so the unit suite resets it between cases rather than being
 * written around it (a suite that shares the latch passes its later cases
 * vacuously, having silenced the thing they claim to check).
 */
export function resetWorkspaceLinkageNotice() {
    noticeShown = false;
}

/**
 * Print the borrowed-tree notice at most once per run. Never throws, never
 * changes an exit code.
 *
 * @param {{ resolve?: (spec: string) => string, root?: string, err?: Function }} [io]
 */
export function noteWorkspaceLinkage(io = {}) {
    if (noticeShown) return null;

    // Once per RUN, not per process: `_run-smokes.js` spawns every smoke
    // separately, so the flag above cannot reach them. Same mechanism the
    // docs-tree notice uses, and for the same reason (it printed 24 copies of
    // itself before it had one).
    if (process.env.XCHAIN_WORKSPACE_LINKAGE_NOTED === '1') return null;

    let state;
    try {
        state = workspaceLinkage(io);
    } catch {
        return null;
    }
    if (!state || !state.borrowed) return null;

    noticeShown = true;
    const err = io.err || console.error;
    err(`NOTICE: workspace imports below resolve into ${state.resolved},\n`
        + `  which is outside the checkout under test (${state.root}).\n`
        + '  This node_modules belongs to another tree, so anything reached by a\n'
        + '  bare @xchain-wallet/* specifier is THAT tree\'s code while relative\n'
        + '  imports are this one\'s. A verdict here can differ from the same commit\n'
        + '  installed on its own, in either direction. Run `pnpm install` in this\n'
        + '  checkout before believing a result you intend to act on.');
    return state;
}
