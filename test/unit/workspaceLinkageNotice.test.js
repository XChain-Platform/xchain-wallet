// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// test/smoke/_workspace-linkage.js is the smoke runner's notice for a
// node_modules that belongs to a DIFFERENT checkout . A borrowed tree
// makes a run a hybrid: bare `@xchain-wallet/*` specifiers load the owning
// checkout's code while relative imports load the tree under test. That is how
// a correct desktop signer bridge was measured red at an origin/master
// worktree and filed as a regression.
//
// What these cases pin is the part that is easy to get subtly wrong and
// impossible to notice: WHEN it speaks. A notice that fires in an ordinary
// checkout is noise that gets tuned out within a week, and a notice that stays
// quiet on a borrowed tree is the silence that cost  in the first
// place. So both directions are asserted, plus the two ways it must decline to
// guess.
//
// The helper is pure apart from its printing, so the seams (`resolve`, `root`,
// `err`) are injected here rather than staged on disk.

import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';

import {
    workspaceLinkage,
    noteWorkspaceLinkage,
    resetWorkspaceLinkageNotice,
} from '../smoke/_workspace-linkage.js';

const ROOT = '/checkouts/xchain-wallet';
const local = join(ROOT, 'packages', 'extension', 'package.json');
const foreign = '/checkouts/other-wallet/packages/extension/package.json';

/** Collect what the notice printed, if anything. */
function capture(io) {
    const lines = [];
    const state = noteWorkspaceLinkage({ err: (m) => lines.push(m), ...io });
    return { state, out: lines.join('\n') };
}

describe('workspaceLinkage', () => {
    it('calls a node_modules inside the checkout local', () => {
        const state = workspaceLinkage({ root: ROOT, resolve: () => local });
        expect(state.borrowed).toBe(false);
        // Reports the package DIRECTORY: a trailing /package.json buries the
        // only thing the reader is looking for, which is the tree.
        expect(state.resolved).toBe(join(ROOT, 'packages', 'extension'));
    });

    it('calls a node_modules owned by another checkout borrowed', () => {
        const state = workspaceLinkage({ root: ROOT, resolve: () => foreign });
        expect(state.borrowed).toBe(true);
        expect(state.resolved).toBe('/checkouts/other-wallet/packages/extension');
    });

    it('does not mistake a sibling sharing our name prefix for our own tree', () => {
        // The bug a bare `startsWith` would have: `/checkouts/xchain-wallet-old`
        // begins with `/checkouts/xchain-wallet` and is a different repo.
        const state = workspaceLinkage({
            root: ROOT,
            resolve: () => '/checkouts/xchain-wallet-old/packages/extension/package.json',
        });
        expect(state.borrowed).toBe(true);
    });

    it('returns null rather than a verdict when nothing is installed', () => {
        const state = workspaceLinkage({
            root: ROOT,
            resolve: () => { throw new Error('MODULE_NOT_FOUND'); },
        });
        expect(state).toBe(null);
    });
});

describe('noteWorkspaceLinkage', () => {
    // The once-per-process latch is shared module state. Without this reset the
    // first case to print silences every case after it, and they pass having
    // asserted nothing.
    beforeEach(() => resetWorkspaceLinkageNotice());

    it('stays silent in an ordinary checkout', () => {
        const { state, out } = capture({ root: ROOT, resolve: () => local });
        expect(state).toBe(null);
        expect(out).toBe('');
    });

    it('names both trees when node_modules is borrowed', () => {
        const { state, out } = capture({ root: ROOT, resolve: () => foreign });
        expect(state.borrowed).toBe(true);
        // Naming the foreign tree is the entire job:  was two hours of
        // reading a correct bridge because nothing said a second tree existed.
        expect(out).toContain('/checkouts/other-wallet/packages/extension');
        expect(out).toContain(ROOT);
        expect(out).toContain('pnpm install');
    });

    it('prints once per process, not once per call', () => {
        const first = capture({ root: ROOT, resolve: () => foreign });
        const second = capture({ root: ROOT, resolve: () => foreign });
        expect(first.out).not.toBe('');
        expect(second.out).toBe('');
        expect(second.state).toBe(null);
    });

    it('never fails the run: it returns state and throws nothing', () => {
        // Advisory by contract, like the docs-tree notice beside it. A venue
        // notice that could itself go red would be a new way for the smoke
        // gate to fail for reasons that are not the wallet.
        expect(() => capture({ root: ROOT, resolve: () => foreign })).not.toThrow();
        expect(() => capture({
            root: ROOT,
            resolve: () => { throw new Error('boom'); },
        })).not.toThrow();
    });

    it('says nothing when the run already reported its linkage', () => {
        // `_run-smokes.js` spawns each smoke as its own process, so the
        // once-per-run flag travels in the environment. Without it the docs
        // notice printed 24 copies of itself; this one would print 431.
        const prev = process.env.XCHAIN_WORKSPACE_LINKAGE_NOTED;
        process.env.XCHAIN_WORKSPACE_LINKAGE_NOTED = '1';
        try {
            const { state, out } = capture({ root: ROOT, resolve: () => foreign });
            expect(state).toBe(null);
            expect(out).toBe('');
        } finally {
            if (prev === undefined) delete process.env.XCHAIN_WORKSPACE_LINKAGE_NOTED;
            else process.env.XCHAIN_WORKSPACE_LINKAGE_NOTED = prev;
        }
    });
});
