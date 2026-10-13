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

const sources = import.meta.glob(
    '../../packages/core/src/shared/**/*.jsx',
    { query: '?raw', import: 'default', eager: true },
);

const newlyLocalizedRoutes = [
    'Loading.jsx',
    'MarketView.jsx',
    'MultisigCosignerShare.jsx',
    'OnboardingCarousel.jsx',
];

describe('shared route localization', () => {
    test('screens using t() keep user-facing JSX copy in the locale dictionary', () => {
        const violations = [];
        const missingKeys = [];

        for (const [file, source] of Object.entries(sources)) {
            if (!/\bt\s*\(/.test(source)) continue;
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
        for (const route of newlyLocalizedRoutes) {
            const source = Object.entries(sources).find(([file]) => file.endsWith(`/${route}`))?.[1];
            expect(source, `${route} must remain localized`).toMatch(/\bt\s*\(/);
        }
    });
});
