// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseline = JSON.parse(readFileSync(
    join(process.cwd(), 'test/unit/build/chrome102-js-features-baseline.json'),
    'utf8',
));

const features = [
    ['Array.prototype.findLast', /[.]findLast\s*[(]/],
    ['Array.prototype.findLastIndex', /[.]findLastIndex\s*[(]/],
    ['Object.groupBy', /(?:^|[^\w$])Object[.]groupBy\s*[(]/],
    ['structuredClone', /(?:^|[^\w$])structuredClone\s*[(]/],
    ['Array.prototype.toSorted', /[.]toSorted\s*[(]/],
    ['Array.prototype.toReversed', /[.]toReversed\s*[(]/],
    ['Array.prototype.with', /[.]with\s*[(]/],
    ['String.prototype.isWellFormed', /[.]isWellFormed\s*[(]/],
    ['Promise.withResolvers', /(?:^|[^\w$])Promise[.]withResolvers\s*[(]/],
];

const grepPattern = [
    '[.](findLast|findLastIndex|toSorted|toReversed|with|isWellFormed)[[:space:]]*[(]',
    '(^|[^[:alnum:]_$])(Object[.]groupBy|structuredClone|Promise[.]withResolvers)[[:space:]]*[(]',
].join('|');

function isGuardedStructuredClone(source) {
    return /typeof\s+(?:(?:globalThis|window|self)[.])?structuredClone\s*={2,3}\s*['"]function['"]/.test(source)
        || /(?:globalThis|window|self)[.]structuredClone[?][.]\s*[(]/.test(source);
}

function featuresInLine(source) {
    return features
        .filter(([name, pattern]) => pattern.test(source)
            && !(name === 'structuredClone' && isGuardedStructuredClone(source)))
        .map(([name]) => name);
}

function scanPackageSources() {
    const result = spawnSync('git', [
        'grep',
        '-n',
        '-E',
        grepPattern,
        '--',
        'packages/core/src/*.js',
        'packages/core/src/**/*.js',
        'packages/core/src/*.jsx',
        'packages/core/src/**/*.jsx',
        'packages/web/src/*.js',
        'packages/web/src/**/*.js',
        'packages/web/src/*.jsx',
        'packages/web/src/**/*.jsx',
    ], { cwd: process.cwd(), encoding: 'utf8' });

    expect(result.error).toBeUndefined();
    expect([0, 1]).toContain(result.status);

    return result.stdout.trim().split('\n').filter(Boolean).flatMap((line) => {
        const match = /^([^:]+):(\d+):(.*)$/.exec(line);
        if (!match) return [];
        const [, path, lineNumber, source] = match;
        return featuresInLine(source).map((name) => `${path}:${lineNumber}:${name}`);
    });
}

describe('Chrome 102 JavaScript feature audit', () => {
    it.each([
        ['Array.prototype.findLast', 'items.findLast(predicate)'],
        ['Array.prototype.findLastIndex', 'items.findLastIndex(predicate)'],
        ['Object.groupBy', 'Object.groupBy(items, keyFor)'],
        ['structuredClone', 'structuredClone(value)'],
        ['Array.prototype.toSorted', 'items.toSorted(compare)'],
        ['Array.prototype.toReversed', 'items.toReversed()'],
        ['Array.prototype.with', 'items.with(0, value)'],
        ['String.prototype.isWellFormed', 'text.isWellFormed()'],
        ['Promise.withResolvers', 'Promise.withResolvers()'],
    ])('detects %s', (name, source) => {
        expect(featuresInLine(source)).toContain(name);
    });

    it('allows guarded structuredClone calls', () => {
        expect(featuresInLine(
            "if (typeof structuredClone === 'function') structuredClone(value);",
        )).toEqual([]);
    });

    it('does not exceed the current offender baseline', () => {
        const offenders = scanPackageSources();
        const additions = offenders.filter((offender) => !baseline.includes(offender));

        expect(
            additions,
            'Chrome 102 JavaScript feature offenders need a guard or polyfill',
        ).toEqual([]);
        expect(offenders.length).toBeLessThanOrEqual(baseline.length);
    });
});
