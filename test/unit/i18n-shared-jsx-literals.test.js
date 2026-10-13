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
import { describe, expect, test } from 'vitest';

import { en } from '../../packages/core/src/i18n/locales/en/index.js';
import { findViolations } from '../../tools/eslint/rules/no-jsx-literal-strings.js';

const sharedSources = import.meta.glob(
    '../../packages/core/src/shared/**/*.jsx',
    { query: '?raw', import: 'default', eager: true },
);

const shellSources = import.meta.glob(
    [
        '../../packages/desktop/renderer/**/*.jsx',
        '../../packages/web/src/App.jsx',
        '../../packages/web/src/components/**/*.jsx',
    ],
    { query: '?raw', import: 'default', eager: true },
);

describe('shipping JSX localization', () => {
    test('localized shared screens and shell code keep user-facing copy in the locale dictionary', () => {
        const violations = [];
        const missingKeys = [];

        const localizedSources = {
            ...Object.fromEntries(
                Object.entries(sharedSources).filter(([, source]) => /\bt\s*\(/.test(source)),
            ),
            ...shellSources,
        };

        for (const [file, source] of Object.entries(localizedSources)) {
            for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) {
                if (!(match[1] in en)) missingKeys.push(`${file}: ${match[1]}`);
            }
            const ast = parse(source, {
                sourceType: 'module',
                plugins: ['jsx', 'estree'],
            });
            for (const violation of findViolations(ast.program)) {
                violations.push(`${file}:${violation.node.loc.start.line} ${violation.message}`);
            }
        }

        expect(violations).toEqual([]);
        expect(missingKeys).toEqual([]);
    });
});
