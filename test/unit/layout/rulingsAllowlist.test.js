// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The UI rulings allowlist only shrinks. Each entry is open UI debt the
// rulings gate (test/e2e/tests/layout/rulings-gate.spec.js) tolerates on one
// screen; a fix takes its entry off, and nothing adds one. Against the
// committed allowlist (HEAD, and the merge base with origin/develop when the
// remote is there) no screen may gain an entry or a larger count, and no
// ruling may hold more in all. Every entry names its ruling and a reason.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULING_KEYS, allowlistGrowth } from '../../e2e/layout/rulings-gate.js';

const repoRoot = resolve(__dirname, '../../..');
const ALLOWLIST = 'test/e2e/tests/layout/rulings.allowlist.json';
const current = JSON.parse(readFileSync(resolve(repoRoot, ALLOWLIST), 'utf8'));

const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** The allowlist as committed at `ref`, or null where it is not there. */
function committedAt(ref) {
    try {
        return JSON.parse(git('show', `${ref}:${ALLOWLIST}`));
    } catch {
        return null;
    }
}

function mergeBase() {
    try {
        return git('merge-base', 'HEAD', 'origin/develop');
    } catch {
        return null;
    }
}

describe('UI rulings allowlist', () => {
    it('names a known key, its ruling and a reason for every entry', () => {
        const faults = [];
        for (const [key, entry] of Object.entries(current)) {
            if (!RULING_KEYS[key]) { faults.push(`${key}: not a rulings gate key`); continue; }
            if (entry.ruling !== RULING_KEYS[key].ruling) faults.push(`${key}: ruling ${entry.ruling}, expected ${RULING_KEYS[key].ruling}`);
            const screens = Object.entries(entry.screens || {});
            if (screens.length === 0) faults.push(`${key}: no screens; take the key off`);
            for (const [id, { count, reason }] of screens) {
                if (!/^[a-z0-9-]+ \| .+/.test(id)) faults.push(`${key} ${id}: screen is not "<venue> | <label>"`);
                if (!Number.isInteger(count) || count < 1) faults.push(`${key} ${id}: count ${count}`);
                if (typeof reason !== 'string' || reason.trim().length < 10) faults.push(`${key} ${id}: no reason`);
            }
        }
        expect(faults).toEqual([]);
    });

    it('grows against nothing committed', () => {
        const bases = [['HEAD', committedAt('HEAD')]];
        const base = mergeBase();
        if (base) bases.push([`merge base ${base.slice(0, 12)}`, committedAt(base)]);
        const growth = bases
            .filter(([, list]) => list !== null)
            .flatMap(([name, list]) => allowlistGrowth(list, current).map((line) => `${name}: ${line}`));
        expect(growth, 'the allowlist only shrinks; fix the screen instead').toEqual([]);
    });

    it('reads a new entry, a larger count and a larger ruling total as growth', () => {
        const entry = (screens) => ({ ruling: 'U16', rule: 'cards', screens });
        const base = { offTokenCards: entry({ 'phone-360 | home: coins': { count: 2, reason: 'measured at the seed' } }) };
        expect(allowlistGrowth(base, base)).toEqual([]);
        expect(allowlistGrowth(base, { offTokenCards: entry({ 'phone-360 | home: coins': { count: 1, reason: 'one fixed' } }) })).toEqual([]);
        expect(allowlistGrowth(base, {})).toEqual([]);
        expect(allowlistGrowth(base, { offTokenCards: entry({ 'phone-360 | home: coins': { count: 3, reason: 'more' } }) })).toEqual([
            'offTokenCards on phone-360 | home: coins: 2 to 3',
            'U16: 2 to 3 allowed in all',
        ]);
        expect(allowlistGrowth(base, {
            offTokenCards: entry({ 'phone-360 | home: coins': { count: 2, reason: 'same' } }),
            dashedBorders: entry({ 'phone-360 | nav: Send': { count: 1, reason: 'a new one' } }),
        })).toEqual([
            'dashedBorders on phone-360 | nav: Send: new entry',
            'U16: 2 to 3 allowed in all',
        ]);
    });
});
