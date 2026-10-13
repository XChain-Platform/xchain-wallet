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
const componentsRoot = join(sharedRoot, 'components');
const uiRoot = join(sharedRoot, '../ui');
const tokensPath = join(sharedRoot, '../ui/tokens.css');
const cardModules = [
    'BackupReminderCard.module.css',
    'CollectiblesView.module.css',
    'DemoBanner.module.css',
    'HwFirmwareBanner.module.css',
    'OwnerWithdrawWarning.module.css',
    'QueuedBroadcastBanner.module.css',
    'QueuedResultPanel.module.css',
    'ReachabilityBanner.module.css',
    'TotalBalanceHero.module.css',
];

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

function cardClassTokens(selector) {
    return [...selector.matchAll(/\.([\w-]+)/g)].flatMap((match) => (
        match[1]
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .split(/[-_]/)
            .map((token) => token.toLowerCase())
    ));
}

function rawCardPadding(file, css) {
    const cardWords = new Set(['banner', 'box', 'card', 'hero', 'notice', 'panel']);
    const violations = [];

    for (const match of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const [, selector, declarations] = match;
        if (!cardClassTokens(selector).some((token) => cardWords.has(token))) continue;

        for (const padding of declarations.matchAll(/(?:^|;)\s*(padding(?:-[\w-]+)?)\s*:\s*([^;]+)/g)) {
            if (/\d+(?:\.\d+)?px/.test(padding[2])) {
                violations.push(`${file}: ${selector.trim()}: ${padding[1]}: ${padding[2].trim()}`);
            }
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

it('lists raw pixel paddings on card-like module CSS rules', () => {
    expect(rawCardPadding('Fixture.module.css', '.summaryCard { padding: 12px 8px; }')).toEqual([
        'Fixture.module.css: .summaryCard: padding: 12px 8px',
    ]);

    const violations = [];

    for (const root of [componentsRoot, uiRoot]) {
        for (const file of cssModulesBelow(root)) {
            violations.push(...rawCardPadding(
                relative(join(sharedRoot, '..'), file),
                readFileSync(file, 'utf8'),
            ));
        }
    }

    expect(violations).toEqual([]);
});

it('uses the shared padding and radius for explicit card modules', () => {
    const tokens = readFileSync(tokensPath, 'utf8');
    expect(tokens).toContain('--xc-card-pad: var(--xc-space-4);');
    expect(tokens).toContain('--xc-card-radius: var(--xc-radius-md);');

    for (const file of cardModules) {
        const css = readFileSync(join(componentsRoot, file), 'utf8');
        expect(css, file).toContain('padding: var(--xc-card-pad);');
        expect(css, file).toContain('border-radius: var(--xc-card-radius);');
    }
});
