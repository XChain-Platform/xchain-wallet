// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const sharedRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../packages/core/src/shared',
);
const tokensPath = join(sharedRoot, '../ui/tokens.css');

function cssModulesBelow(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModulesBelow(path);
        return path.endsWith('.module.css') ? [path] : [];
    });
}

function withoutComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function spacingValuesFrom(css) {
    return new Set([...css.matchAll(/--xc-space-\d+:\s*(\d+)px/g)].map((match) => match[1]));
}

function hardCodedSpacing(file, css, spacingValues) {
    const violations = [];
    const declarations = withoutComments(css)
        .matchAll(/(?:^|[;{])\s*((?:margin|padding)(?:-[\w-]+)?)\s*:\s*([^;}]+)/gm);

    for (const [, property, value] of declarations) {
        const literals = [...value.matchAll(/(?<![\w.-])(\d+)px(?![\w-])/g)]
            .map((match) => match[1])
            .filter((literal) => spacingValues.has(literal));

        if (literals.length > 0) {
            violations.push(`${file}: ${property}: ${value.trim()}`);
        }
    }

    return violations;
}

it('detects token-sized spacing literals only in margin and padding declarations', () => {
    const spacingValues = new Set(['4', '8']);
    const css = `
        /* padding: 4px; */
        .fixture {
            font-size: 4px;
            gap: 8px;
            margin-top: 4px;
            padding: 2px 8px;
        }
    `;

    expect(hardCodedSpacing('Fixture.module.css', css, spacingValues)).toEqual([
        'Fixture.module.css: margin-top: 4px',
        'Fixture.module.css: padding: 2px 8px',
    ]);
});

it('uses spacing tokens for matching shared module margins and paddings', () => {
    const spacingValues = spacingValuesFrom(readFileSync(tokensPath, 'utf8'));
    const violations = [];

    for (const file of cssModulesBelow(sharedRoot)) {
        violations.push(...hardCodedSpacing(
            relative(sharedRoot, file),
            readFileSync(file, 'utf8'),
            spacingValues,
        ));
    }

    expect(violations).toEqual([]);
});
