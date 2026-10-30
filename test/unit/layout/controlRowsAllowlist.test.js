// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The control-row allowlist only shrinks. Each entry is a screen whose
// mismatched control row the gate (test/e2e/layout/control-rows.spec.js,
// ruling U07) tolerates, with its reason; a fix takes its entry off, and
// nothing adds one. Against the committed allowlist (HEAD, and the merge base
// with origin/develop when the remote is there) no screen may gain an entry
// or a larger count. The default suite runs the gate at every venue the
// allowlist names.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    controlRowAllowlistGrowth, controlRowOverruns, controlRowSlack, countControlRows,
} from '../../e2e/layout/control-rows-gate.js';
import defaultConfig from '../../e2e/playwright.config.js';
import controlRowsConfig from '../../e2e/playwright.control-rows.config.js';

const repoRoot = resolve(__dirname, '../../..');
const ALLOWLIST = 'test/e2e/layout/control-rows.allowlist.json';
const current = JSON.parse(readFileSync(resolve(repoRoot, ALLOWLIST), 'utf8'));

const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

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

describe('control-row allowlist', () => {
    it('names the ruling and a reason for every screen', () => {
        expect(current.ruling).toBe('U07');
        const venues = controlRowsConfig.projects.map((project) => project.name);
        const faults = [];
        for (const [id, { count, reason }] of Object.entries(current.screens)) {
            const venue = id.split(' | ')[0];
            if (!venues.includes(venue) || !/ \| .+/.test(id)) faults.push(`${id}: not "<control-rows venue> | <route>"`);
            if (!Number.isInteger(count) || count < 1) faults.push(`${id}: count ${count}`);
            if (typeof reason !== 'string' || reason.trim().length < 20) faults.push(`${id}: no reason`);
        }
        expect(faults).toEqual([]);
    });

    it('grows against nothing committed', () => {
        const bases = [['HEAD', committedAt('HEAD')]];
        const base = mergeBase();
        if (base) bases.push([`merge base ${base.slice(0, 12)}`, committedAt(base)]);
        const growth = bases
            .filter(([, list]) => list !== null)
            .flatMap(([name, list]) => controlRowAllowlistGrowth(list, current).map((line) => `${name}: ${line}`));
        expect(growth, 'the allowlist only shrinks; fix the row instead').toEqual([]);
    });

    it('reads a new screen and a larger count as growth, and a smaller one as slack', () => {
        const base = { screens: { 'control-rows-768 | home: coins': { count: 1, reason: 'square tab tint beside a select' } } };
        expect(controlRowAllowlistGrowth(base, base)).toEqual([]);
        expect(controlRowAllowlistGrowth(base, { screens: {} })).toEqual([]);
        expect(controlRowAllowlistGrowth(base, { screens: { 'control-rows-768 | home: coins': { count: 2, reason: 'x' } } }))
            .toEqual(['control-rows-768 | home: coins: 1 -> 2']);
        expect(controlRowAllowlistGrowth(base, { screens: { 'control-rows-360 | nav: DEX': { count: 1, reason: 'x' } } }))
            .toEqual(['control-rows-360 | nav: DEX: new entry']);

        const counts = countControlRows('control-rows-768', [{ route: 'home: coins' }, { route: 'nav: DEX' }]);
        expect(counts).toEqual({ 'control-rows-768 | home: coins': 1, 'control-rows-768 | nav: DEX': 1 });
        expect(controlRowOverruns(counts, base)).toEqual(['control-rows-768 | nav: DEX: 1 (allowlist 0)']);
        expect(controlRowSlack({}, base, 'control-rows-768')).toEqual(['control-rows-768 | home: coins: 0 (allowlist 1)']);
        expect(controlRowSlack({}, base, 'control-rows-1280')).toEqual([]);
    });

    it('runs the gate in the default suite at every control-rows width', () => {
        const venue = (project) => [project.name, project.use.viewport.width];
        const inDefault = defaultConfig.projects
            .filter((project) => String(project.testMatch) === String(/control-rows\.spec\.js$/))
            .map(venue);
        expect(inDefault).toEqual(controlRowsConfig.projects.map(venue));
        expect(inDefault.map(([, width]) => width)).toEqual([360, 768, 1280]);
    });
});
