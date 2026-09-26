// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// May a cross-repo guard trust the sibling file it is about to read?
//
// ESM port of xchain-indexer/test/helpers/sibling_checkout.js, kept by hand
// because the CommonJS original cannot load in this `type: module` package.
// It is NOT a byte twin, so test/unit/siblingCheckout.test.js pins the same
// verdicts the original returns.
//
// A sibling is refused when it is absent, and also when this checkout is a
// linked worktree and the sibling entry beside it is a symlink whose target is
// a main checkout (its `.git` is a directory): that path reads a peer
// session's live working tree, which no commit pins. A symlink into another
// linked worktree is allowed, being a deliberately cut tree at a known ref.
// Guards skip on a refusal in soft mode and fail naming the reason when the
// run declared XCHAIN_REQUIRE_SIBLINGS=1, which is what skipOrFail() does.

import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, basename, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** True when the sibling checkouts were declared supplied for this run. */
export function siblingsRequired(env = process.env) {
    return env.XCHAIN_REQUIRE_SIBLINGS === '1';
}

/** A linked worktree carries a `.git` FILE pointing at its common dir. */
export function isLinkedWorktree(root) {
    try { return lstatSync(join(root, '.git')).isFile(); }
    catch { return false; }
}

/** The nearest ancestor of `dir` (inclusive) that holds a `.git` entry, or null. */
function checkoutRootOf(dir) {
    for (let d = dir; ; d = dirname(d)) {
        if (existsSync(join(d, '.git'))) return d;
        if (dirname(d) === d) return null;
    }
}

/**
 * Judge one sibling path.
 *
 * @param {string} fromDir   the directory the guard's literal is relative to
 * @param {string} target    the guard's own path literal, relative or absolute
 * @param {{ownRoot?: string}} [opts]  ownRoot: the checkout the guard runs in; defaults to this repo
 * @returns {{usable: boolean, path: string, reason: string|null}}
 */
export function siblingCheckout(fromDir, target, opts = {}) {
    const ownRoot = opts.ownRoot || OWN_ROOT;
    const abs = resolve(fromDir, target);

    if (!existsSync(abs))
        return { usable: false, path: abs, reason: 'sibling path absent: ' + abs };

    // Only the entry directly beside this checkout can be the lane symlink.
    const parent = dirname(ownRoot);
    const rel = relative(parent, abs);
    if (rel.startsWith('..') || isAbsolute(rel))
        return { usable: true, path: abs, reason: null };
    const entry = join(parent, rel.split(sep)[0]);

    if (!isLinkedWorktree(ownRoot) || !lstatSync(entry).isSymbolicLink())
        return { usable: true, path: abs, reason: null };

    const targetRoot = checkoutRootOf(realpathSync(entry));
    const targetIsMain = targetRoot !== null && lstatSync(join(targetRoot, '.git')).isDirectory();
    if (targetIsMain)
        return {
            usable: false, path: abs,
            reason: 'sibling ' + basename(entry) + ' resolves through a symlink into the live main checkout '
                + targetRoot + ', which no commit pins; cut a real sibling worktree to test against it',
        };
    return { usable: true, path: abs, reason: null };
}

/**
 * Act on a refusal inside a vitest test: fail when siblings were declared
 * supplied, otherwise skip through the test context.
 *
 * @param {{skip: Function}} ctx  the vitest test context
 * @param {{usable: boolean, reason: string|null}} verdict  from siblingCheckout()
 * @param {string} what  one clause naming the guard, for the failure message
 * @returns {boolean} true when the sibling is usable
 */
export function skipOrFail(ctx, verdict, what) {
    if (verdict.usable) return true;
    if (siblingsRequired())
        throw new Error('XCHAIN_REQUIRE_SIBLINGS=1 but ' + what + ' cannot run: ' + verdict.reason);
    ctx.skip();
    return false;
}
