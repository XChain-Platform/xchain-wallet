// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pins test/helpers/siblingCheckout.js to the verdicts of the CommonJS original
// it ports, since no twin gate compares the two.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { siblingCheckout, skipOrFail } from '../helpers/siblingCheckout.js';

const made = [];
const FILESYSTEM_FIXTURE_TIMEOUT = 60_000;

/** A scratch parent holding `own` (a main or linked checkout) and the docs entry beside it. */
function layout({ ownLinked, docs }) {
    const top = realpathSync(mkdtempSync(join(tmpdir(), 'sibling-checkout-')));
    made.push(top);
    const parent = join(top, 'lane');
    const own = join(parent, 'xchain-wallet');
    mkdirSync(own, { recursive: true });
    if (ownLinked) writeFileSync(join(own, '.git'), 'gitdir: /elsewhere\n');
    else mkdirSync(join(own, '.git'));

    const target = join(top, 'target', 'xchain-documentation');
    mkdirSync(join(target, 'protocol'), { recursive: true });
    writeFileSync(join(target, 'protocol', 'action-manifest.json'), '{}\n');
    if (docs === 'main-symlink' || docs === 'worktree-symlink') {
        if (docs === 'main-symlink') mkdirSync(join(target, '.git'));
        else writeFileSync(join(target, '.git'), 'gitdir: /elsewhere\n');
        symlinkSync(target, join(parent, 'xchain-documentation'));
    }
    const literal = join(parent, 'xchain-documentation', 'protocol', 'action-manifest.json');
    return { own, literal };
}

afterEach(() => {
    while (made.length) rmSync(made.pop(), { recursive: true, force: true });
    vi.unstubAllEnvs();
});

describe('siblingCheckout verdicts', { timeout: FILESYSTEM_FIXTURE_TIMEOUT }, () => {
    it('refuses an absent sibling', () => {
        const { own, literal } = layout({ ownLinked: false, docs: 'absent' });
        const v = siblingCheckout(own, literal, { ownRoot: own });
        expect(v.usable).toBe(false);
        expect(v.reason).toMatch(/^sibling path absent: /);
    });

    it('refuses a linked worktree whose sibling symlinks into a main checkout', () => {
        const { own, literal } = layout({ ownLinked: true, docs: 'main-symlink' });
        const v = siblingCheckout(own, literal, { ownRoot: own });
        expect(v.usable).toBe(false);
        expect(v.reason).toMatch(/xchain-documentation resolves through a symlink into the live main checkout/);
    });

    it('allows a linked worktree whose sibling symlinks into another linked worktree', () => {
        const { own, literal } = layout({ ownLinked: true, docs: 'worktree-symlink' });
        expect(siblingCheckout(own, literal, { ownRoot: own }).usable).toBe(true);
    });

    it('allows a main checkout whose sibling is a symlink into a main checkout', () => {
        const { own, literal } = layout({ ownLinked: false, docs: 'main-symlink' });
        expect(siblingCheckout(own, literal, { ownRoot: own }).usable).toBe(true);
    });
});

describe('skipOrFail', { timeout: FILESYSTEM_FIXTURE_TIMEOUT }, () => {
    const refused = { usable: false, path: '/x', reason: 'sibling path absent: /x' };

    it('throws naming the guard and the reason when siblings are required', () => {
        vi.stubEnv('XCHAIN_REQUIRE_SIBLINGS', '1');
        const ctx = { skip: vi.fn() };
        expect(() => skipOrFail(ctx, refused, 'the probe guard'))
            .toThrow('XCHAIN_REQUIRE_SIBLINGS=1 but the probe guard cannot run: sibling path absent: /x');
        expect(ctx.skip).not.toHaveBeenCalled();
    });

    it('skips in soft mode and passes a usable verdict through', () => {
        vi.stubEnv('XCHAIN_REQUIRE_SIBLINGS', '');
        const ctx = { skip: vi.fn() };
        expect(skipOrFail(ctx, refused, 'the probe guard')).toBe(false);
        expect(ctx.skip).toHaveBeenCalledOnce();
        expect(skipOrFail(ctx, { usable: true, path: '/x', reason: null }, 'the probe guard')).toBe(true);
    });
});
