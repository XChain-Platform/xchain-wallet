// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import { cachedSourceFiles } from '../../helpers/sourceScan.js';
import {
    CHROME_102_UNSUPPORTED_API_REGEX,
    CHROME_102_UNSUPPORTED_INSTANCE_APIS,
    CHROME_102_UNSUPPORTED_STATIC_APIS,
} from '../../smoke/_chrome102-js-apis.js';

const packageSources = cachedSourceFiles(
    process.cwd(),
    'packages/*/src/**/*.{js,jsx,mjs,cjs}',
);

function findRegExpVFlags(source) {
    const findings = [];
    const stack = [parse(source, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'importAttributes'],
    })];

    while (stack.length > 0) {
        const node = stack.pop();
        if (node.type === 'RegExpLiteral' && node.flags.includes('v')) {
            findings.push(node.loc.start.line);
        }
        if (
            (node.type === 'CallExpression' || node.type === 'NewExpression')
            && node.callee?.type === 'Identifier'
            && node.callee.name === 'RegExp'
            && node.arguments[1]?.type === 'StringLiteral'
            && node.arguments[1].value.includes('v')
        ) {
            findings.push(node.loc.start.line);
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                stack.push(...value.filter((child) => child?.type));
            } else if (value?.type) {
                stack.push(value);
            }
        }
    }

    return findings;
}

describe('Chrome 102 JavaScript API audit', () => {
    it.each(CHROME_102_UNSUPPORTED_INSTANCE_APIS)(
        'detects instance API %s',
        (name) => {
            expect(`value.${name} ()`).toMatch(CHROME_102_UNSUPPORTED_API_REGEX);
        },
    );

    it.each(CHROME_102_UNSUPPORTED_STATIC_APIS)(
        'detects static API %s',
        (name) => {
            expect(`${name} ()`).toMatch(CHROME_102_UNSUPPORTED_API_REGEX);
        },
    );

    it('allows APIs available in Chrome 102', () => {
        const source = 'const copy = structuredClone(value); values.sort();';
        expect(source).not.toMatch(CHROME_102_UNSUPPORTED_API_REGEX);
    });

    it.each([
        'const matcher = /[a--b]/v;',
        "const matcher = new RegExp('[a--b]', 'v');",
    ])('detects unsupported RegExp syntax in %s', (source) => {
        expect(findRegExpVFlags(source)).toEqual([1]);
    });

    it('finds no unsupported APIs in package JavaScript sources', () => {
        const violations = packageSources.flatMap(({ relativePath, source }) => {
            const pattern = new RegExp(
                CHROME_102_UNSUPPORTED_API_REGEX.source,
                CHROME_102_UNSUPPORTED_API_REGEX.flags,
            );
            return Array.from(source.matchAll(pattern), (match) => {
                const line = source.slice(0, match.index).split('\n').length;
                return `${relativePath}:${line}:${match[0].trim()}`;
            });
        });

        expect(violations).toEqual([]);
    });

    it('finds no RegExp v flags that the ES2022 build leaves unsupported', () => {
        const violations = packageSources.flatMap(({ relativePath, source }) => (
            findRegExpVFlags(source).map((line) => `${relativePath}:${line}`)
        ));

        expect(violations).toEqual([]);
    });
});
