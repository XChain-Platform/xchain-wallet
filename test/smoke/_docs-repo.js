// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Locates the wallet's prose documentation, which a later change moved OUT of this
// repo and into the sibling `xchain-documentation` checkout, published at
// https://docs.xchain.io/components/wallet/.
//
// Several smokes assert on the CONTENT of those docs (a store form must
// answer what the policy says, an error-code table must list what the code
// emits). Those assertions are worth keeping, so they follow the docs across
// the repo boundary rather than being deleted.
//
// DECLARED-AND-MISSING IS A FAILURE, NOT A SKIP.
//
// This used to skip whenever the sibling was absent, on the reasoning that an
// isolated single-repo checkout legitimately has no siblings. That made the
// skip indistinguishable from a broken gate. The CI dispatcher resolved
// siblings from the PUSHING worktree, so a push from a linked git worktree
// shipped the wrong repository into the xchain-documentation slot; the slot
// then held no wallet docs, every smoke here took its documented skip, and the
// gate reported GREEN having exercised none of them (measured 2026-08-03).
//
// So the rule follows the declaration instead of the filesystem: when
// .ci-siblings names xchain-documentation, the sibling is a gate dependency
// and its absence is a red, exactly as a missing coverage floor is. The
// dispatcher now refuses to run at all when a declared sibling is unresolvable,
// so under the gate these two guards agree.
//
// Escape hatches, both deliberate and both loud:
//   XCHAIN_DOCS_ROOT=<path>      the sibling lives somewhere else
//   XCHAIN_DOCS_OPTIONAL=1       a genuinely isolated checkout; skip as before
//
// Not a `*.smoke.js` file, so the runner does not try to execute it.

// A PRESENT SIBLING IS NOT THE SAME AS A CURRENT ONE (frontier row
// 123).
//
// Everything above is about whether the slot is filled. What it never asked is
// what is IN it. These are shared, long-lived checkouts that a second coder
// works through, so the tree this resolver hands to 28 test files routinely
// carries another session's uncommitted edits, or sits behind origin/master.
// Both change verdicts silently, in both directions: measured 2026-08-08,
// `mobile-ios-shell.smoke.js` was RED against the sibling and GREEN at the
// same commit against a clean worktree of docs `origin/master`, with nothing
// anywhere saying the two runs had read different bytes.
//
// This is the defect frontier row 115 found one repo over, where a red test
// blamed a missing publication that had shipped six days earlier because it
// read a sibling 91 commits behind. That fix taught ONE test to name the tree
// it read. The resolver is where it belongs, because it is the single place
// all 28 of them come through.
//
// Deliberately advisory and deliberately wrapped: it prints a NOTICE and never
// changes a verdict, and a checkout with no git, no origin, or no such branch
// says nothing at all rather than failing. A tree-state notice that could
// itself go red would be a new way for the docs gates to fail for reasons that
// are not the docs.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));          // test/smoke
const wsRoot = join(here, '..', '..');                          // xchain-wallet

// Resolved from this file's own location, never cwd, so a smoke run from
// anywhere finds the same checkout. XCHAIN_DOCS_ROOT overrides it when the
// sibling lives somewhere other than beside this repo.
export const DOCS_ROOT = process.env.XCHAIN_DOCS_ROOT
    || join(wsRoot, '..', 'xchain-documentation');

export const WALLET_DOCS = join(DOCS_ROOT, 'components', 'wallet');

const SIBLINGS_FILE = join(wsRoot, '.ci-siblings');

/**
 * Does this repo DECLARE the docs sibling as a CI dependency? Declared means
 * the harness is contracted to ship it, so absence is a harness failure rather
 * than a checkout that never had it.
 */
export function docsDeclared() {
    try {
        return readFileSync(SIBLINGS_FILE, 'utf8')
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'))
            // A declaration may carry modifiers: `name@branch` pins the branch
            // the harness ships (docs is pinned to master, matching this repo's
            // own GitHub checkout of it), `name+scripts` picks the install mode.
            // The NAME is what declares the dependency, so read past both. An
            // exact-line match read the pin as "never declared", which is the
            // silent skip this guard exists to prevent, arriving through the
            // guard itself.
            .map((l) => l.split('+')[0].split('@')[0])
            .includes('xchain-documentation');
    } catch {
        return false;                    // no .ci-siblings: nothing was promised
    }
}

/**
 * Verdict on the sibling, without acting on it. Exported for the unit test that
 * pins these rules; smokes call docsAvailable().
 *
 * 'ok'      -> the wallet docs are there
 * 'skip'    -> absent and not declared (or opted out): the old behaviour
 * 'refuse'  -> declared but unresolvable: the silent hole, now a red
 */
export function docsVerdict() {
    if (existsSync(WALLET_DOCS)) return { status: 'ok', reason: '' };
    if (process.env.XCHAIN_DOCS_OPTIONAL === '1') {
        return { status: 'skip', reason: 'XCHAIN_DOCS_OPTIONAL=1' };
    }
    if (!docsDeclared()) {
        return { status: 'skip', reason: `${SIBLINGS_FILE} does not declare xchain-documentation` };
    }
    // Name what IS in the slot: "the wrong repo is mounted here" and "nothing is
    // mounted here" need different fixes, and the wrong-repo case is the one
    // that produced a green gate.
    let occupant = 'nothing is there';
    if (existsSync(DOCS_ROOT)) {
        let name = '';
        try {
            name = JSON.parse(readFileSync(join(DOCS_ROOT, 'package.json'), 'utf8')).name || '';
        } catch { /* not every checkout has one */ }
        occupant = name
            ? `the slot holds a checkout of '${name}', which has no components/wallet`
            : 'the slot exists but has no components/wallet';
    }
    return {
        status: 'refuse',
        reason: `${WALLET_DOCS} is not readable: ${occupant}`,
    };
}

/**
 * What state is the docs checkout we are about to read actually in?
 *
 * Scoped to `components/wallet` on purpose: that is the only surface these
 * smokes assert on, so an unrelated edit elsewhere in the docs repo is not
 * this notice's business and reporting it would train readers to ignore it.
 *
 * `root` travels back out in the result because the notice has to name the tree
 * it read, and naming a different one than it measured is the very confusion
 * this exists to end.
 *
 * @returns {{root: string, git: boolean, dirty: string[], behind: string|null, reason: string|null}}
 */
export function docsTreeState({ root = DOCS_ROOT, run = execFileSync } = {}) {
    const git = (...args) => run('git', ['-C', root, ...args],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

    try {
        if (git('rev-parse', '--is-inside-work-tree') !== 'true') {
            return { root, git: false, dirty: [], behind: null, reason: 'not a git checkout' };
        }
    } catch (e) {
        // Both outcomes are silent, but they are not the same thing and the
        // reason string is the only place a reader learns which: a directory
        // that is not a checkout makes git EXIT non-zero, while a machine
        // without git fails to spawn it at all. Reporting the second for the
        // first sends anyone reading this notice to install a tool they have.
        const missingBinary = e?.code === 'ENOENT';
        return {
            root,
            git: false,
            dirty: [],
            behind: null,
            reason: missingBinary ? 'git is unavailable here' : 'not a git checkout',
        };
    }

    const state = { root, git: true, dirty: [], behind: null, reason: null };

    try {
        state.dirty = git('status', '--porcelain', '--', 'components/wallet')
            .split('\n').map((l) => l.trim()).filter(Boolean);
    } catch { /* a worktree mid-operation can refuse status; stay quiet */ }

    try {
        // Only the wallet docs matter, so ask whether origin/master carries a
        // commit touching them that this tree does not.
        const missing = git('log', '--oneline', 'HEAD..origin/master', '--', 'components/wallet');
        if (missing) state.behind = missing.split('\n').filter(Boolean).length + ' commit(s)';
    } catch { /* no origin, no such ref, shallow clone: say nothing */ }

    return state;
}

// Said at most once per process: every smoke that reads a doc comes through
// docsAvailable(), and repeated copies of one notice is how a real signal gets
// filtered out.
let treeNoticeShown = false;

/**
 * Say, once, what tree the docs assertions in this process were read from.
 *
 * Silent when the tree is clean and current, which is the normal case, so the
 * notice only ever appears when it explains something.
 */
export function noteDocsTreeState(io = {}) {
    if (treeNoticeShown) return null;

    // Once per RUN, not merely once per process. `_run-smokes.js` spawns each
    // smoke separately, so the flag above cannot see across them: measured
    // 2026-08-08 against a dirty docs clone, the suite printed 24 copies of one
    // notice. A caller that has already reported the tree exports
    // XCHAIN_DOCS_TREE_NOTED=1 and its children stay quiet.
    if (process.env.XCHAIN_DOCS_TREE_NOTED === '1') return null;

    const state = docsTreeState(io);
    if (!state.git) return null;
    if (!state.dirty.length && !state.behind) return null;

    const parts = [];
    if (state.dirty.length) parts.push(`${state.dirty.length} uncommitted change(s)`);
    if (state.behind) parts.push(`${state.behind} behind origin/master`);

    treeNoticeShown = true;
    const err = io.err || console.error;
    err(`NOTICE: the docs assertions below read ${state.root},\n`
        + `  which carries ${parts.join(' and ')} under components/wallet.\n`
        + '  This is a shared checkout, so a verdict here can differ from the same\n'
        + '  commit read at origin/master, in either direction. If a docs assertion\n'
        + '  fails, confirm it against a clean worktree before believing it.');
    return state;
}

/** Absolute path to a wallet doc, e.g. docsPath('privacy', 'privacy-policy.md'). */
export function docsPath(...parts) {
    return join(WALLET_DOCS, ...parts);
}

/**
 * True when the sibling checkout is present and carries the wallet docs.
 *
 * When the sibling is DECLARED and still unreachable this does not return at
 * all: it exits 1. Every caller here is shaped `if (docsAvailable())` or
 * `if (!docsAvailable())`, so refusing inside the predicate is what makes the
 * whole family fail loud without 51 call sites having to remember to.
 */
export function docsAvailable() {
    const v = docsVerdict();
    // Said here rather than at 28 call sites, for the same reason the refusal
    // below is: this predicate is the one thing they all pass through.
    if (v.status === 'ok') { noteDocsTreeState(); return true; }
    if (v.status === 'skip') return false;
    console.error(`FAIL: the wallet docs sibling is DECLARED in .ci-siblings but unreachable.\n`
        + `  ${v.reason}\n`
        + '  moved the wallet docs to the sibling xchain-documentation repo, and this\n'
        + '  repo declares it in .ci-siblings, so the CI harness is contracted to ship it.\n'
        + '  Skipping here would report GREEN on documentation parity that nothing checked\n'
        + '  (a push from a linked worktree shipped the WRONG repo into this slot).\n'
        + '  Fix the checkout: clone xchain-documentation beside this repo, or set\n'
        + '  XCHAIN_DOCS_ROOT. To accept an unverified docs surface, set XCHAIN_DOCS_OPTIONAL=1.');
    process.exit(1);
}

/** Read a wallet doc as UTF-8. Caller is expected to have skipped first. */
export function readDoc(...parts) {
    return readFileSync(docsPath(...parts), 'utf8');
}

/**
 * Skip the calling smoke, loudly, when the sibling checkout is absent AND not
 * declared. When it IS declared, docsAvailable() has already exited 1 and this
 * never reaches the skip: a promised sibling that is missing is a red.
 * Exits 0 (a skip, not a pass) after saying which smoke went unrun and why.
 */
export function skipUnlessDocs(smokeName) {
    if (docsAvailable()) return;
    console.log(`SKIP: ${smokeName} - the wallet docs are not in this checkout. `
        + 'moved them to the sibling xchain-documentation repo'
        + `(expected at ${WALLET_DOCS}); clone it beside this one, or set `
        + 'XCHAIN_DOCS_ROOT, to run this gate.');
    process.exit(0);
}
