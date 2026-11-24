// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

function skipQuoted(source, start, delimiter) {
    let index = start + delimiter.length;

    while (index < source.length) {
        if (source[index] === '\\') {
            index += 2;
            continue;
        }
        if (source.startsWith(delimiter, index)) return index + delimiter.length;
        index += 1;
    }

    return -1;
}

export function sourceLiterals(source) {
    const literals = [];
    let index = 0;

    while (index < source.length) {
        if (source.startsWith('//', index)) {
            const end = source.indexOf('\n', index + 2);
            index = end === -1 ? source.length : end + 1;
            continue;
        }

        if (source.startsWith('/*', index)) {
            let depth = 1;
            index += 2;
            while (index < source.length && depth > 0) {
                if (source.startsWith('/*', index)) {
                    depth += 1;
                    index += 2;
                } else if (source.startsWith('*/', index)) {
                    depth -= 1;
                    index += 2;
                } else {
                    index += 1;
                }
            }
            continue;
        }

        if (source[index] === "'") {
            const end = skipQuoted(source, index, "'");
            index = end === -1 ? source.length : end;
            continue;
        }

        if (source[index] !== '"') {
            index += 1;
            continue;
        }

        const delimiter = source.startsWith('"""', index) ? '"""' : '"';
        const contentStart = index + delimiter.length;
        const end = skipQuoted(source, index, delimiter);
        if (end === -1) break;
        literals.push(source.slice(contentStart, end - delimiter.length));
        index = end;
    }

    return literals;
}

function validateInputs(fixtures, sources) {
    if (!Array.isArray(fixtures) || fixtures.length === 0) {
        throw new TypeError('fixtures must be a non-empty array');
    }
    if (fixtures.some((fixture) => typeof fixture !== 'string' || fixture.trim() === '')) {
        throw new TypeError('fixtures must contain no blank names');
    }
    if (sources === null || typeof sources !== 'object' || Array.isArray(sources)) {
        throw new TypeError('sources must be a non-empty object');
    }

    const entries = Object.entries(sources);
    if (entries.length === 0) throw new TypeError('sources must be a non-empty object');
    if (entries.some(([, source]) => typeof source !== 'string')) {
        throw new TypeError('each source must be a string');
    }

    return entries;
}

function reaches(literals, fixture) {
    return literals.some((literal) => (
        literal === fixture
        || literal === `${fixture}.json`
        || (
            literal.endsWith('-')
            && !literal.includes('/')
            && !fixture.includes('/')
            && fixture.startsWith(literal)
        )
    ));
}

export function fixtureReachFailures({ fixtures, sources } = {}) {
    const sourceEntries = validateInputs(fixtures, sources);
    const sortedFixtures = [...fixtures].sort();
    const failures = [];

    for (const [platform, source] of sourceEntries) {
        const literals = sourceLiterals(source);
        for (const fixture of sortedFixtures) {
            if (!reaches(literals, fixture)) failures.push(`${platform}:unreached:${fixture}`);
        }
    }

    return failures;
}
