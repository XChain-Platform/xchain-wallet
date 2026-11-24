// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

function validateInputs(fixtures, expected, prefixes) {
    if (!Array.isArray(fixtures) || fixtures.length === 0) {
        throw new TypeError('fixtures must be a non-empty array');
    }
    if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
        throw new TypeError('expected must be an object');
    }
    if (prefixes === null || typeof prefixes !== 'object' || Array.isArray(prefixes)) {
        throw new TypeError('prefixes must be a non-empty object');
    }

    const prefixEntries = Object.entries(prefixes);
    if (prefixEntries.length === 0) {
        throw new TypeError('prefixes must be a non-empty object');
    }
    if (prefixEntries.some(([, prefix]) => typeof prefix !== 'string' || prefix === '')) {
        throw new TypeError('each prefix must be a non-empty string');
    }

    return prefixEntries;
}

function entryKeys(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];

    return Object.entries(value)
        .filter(([, entry]) => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
        .map(([key]) => key);
}

export function expectedEntryFailures({ fixtures, expected, prefixes } = {}) {
    const prefixEntries = validateInputs(fixtures, expected, prefixes);
    const fixtureNames = new Set(fixtures);
    const failures = [];

    for (const [file, prefix] of prefixEntries) {
        if (!Object.hasOwn(expected, file)) {
            failures.push(`expected/${file}:absent`);
            continue;
        }

        const entries = entryKeys(expected[file]);
        const entryNames = new Set(entries);
        const coveredFixtures = fixtures
            .filter((fixture) => fixture.startsWith(prefix))
            .sort();

        for (const fixture of coveredFixtures) {
            if (!entryNames.has(fixture)) {
                failures.push(`expected/${file}:missing:${fixture}`);
            }
        }

        for (const key of entries.sort()) {
            if (!fixtureNames.has(key) || !key.startsWith(prefix)) {
                failures.push(`expected/${file}:unknown:${key}`);
            }
        }
    }

    return failures;
}
