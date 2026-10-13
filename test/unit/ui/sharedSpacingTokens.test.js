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
const viewPrivateKeyStylesPath = join(sharedRoot, 'routes/ViewPrivateKey.module.css');
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
const routeModules = [
    'DispenserExplorer.module.css',
    'Home.module.css',
    'ImportWallet.module.css',
    'IssueTokenForm.module.css',
    'Loading.module.css',
];
const tokenCleanupModules = [
    'ActionIntentSummary.module.css',
    'AlertsOverlay.module.css',
    'AmountField.module.css',
    'BackupReminderCard.module.css',
    'BalanceChanges.module.css',
    'CollectiblesView.module.css',
];
const auditedGeometryModules = [
    'ConfirmActionModal.module.css',
    'ContactsPickerScreen.module.css',
    'DataTable.module.css',
    'DemoBanner.module.css',
    'DerivationPathCrossCheck.module.css',
    'DraftDiscardButton.module.css',
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

function declarationsWithPixels(css) {
    return [...withoutComments(css).matchAll(
        /(?:^|[;{])\s*([\w-]+)\s*:\s*([^;}]*?(?:-?\d+(?:\.\d+)?px)[^;}]*)/gm,
    )].map(([, property, value]) => `${property}: ${value.trim()}`);
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

it('uses shared tokens for route control, icon, and loader geometry', () => {
    const routesRoot = join(sharedRoot, 'routes');
    const routeCss = new Map(routeModules.map((file) => [
        file,
        readFileSync(join(routesRoot, file), 'utf8'),
    ]));
    const home = routeCss.get('Home.module.css');
    const imported = routeCss.get('ImportWallet.module.css');
    const issue = routeCss.get('IssueTokenForm.module.css');
    const loading = routeCss.get('Loading.module.css');

    for (const [file, css] of routeCss) {
        expect(withoutComments(css), file)
            .not.toMatch(/(?:gap|font-size|border-radius)\s*:[^;}]*(?:\d*\.)?\d+px/);
    }
    expect(home).toMatch(
        /\.menuBtn\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\)[^}]*width:\s*var\(--xc-control-h-md\)[^}]*height:\s*var\(--xc-control-h-md\)/s,
    );
    expect(home).toMatch(
        /\.quickActionIcon\s*\{[^}]*width:\s*var\(--xc-control-h-sm\)[^}]*height:\s*var\(--xc-control-h-sm\)/s,
    );
    expect(home).toMatch(
        /\.quickActionMoreItemIcon\s*\{[^}]*width:\s*var\(--xc-icon-sm\)[^}]*height:\s*var\(--xc-icon-sm\)/s,
    );
    expect(imported).not.toMatch(/(?:margin|padding|outline-offset):[^;]*-?2px/);
    expect(issue).not.toMatch(/outline-offset:\s*-?2px/);
    expect(loading).toMatch(
        /\.dots > span\s*\{[^}]*width:\s*var\(--xc-space-2\)[^}]*height:\s*var\(--xc-space-2\)/s,
    );
});

it('limits ViewPrivateKey raw pixels to documented hairlines and sub-scale insets', () => {
    const css = readFileSync(viewPrivateKeyStylesPath, 'utf8');
    const lines = css.split('\n');
    const rawPixelDeclarations = lines.flatMap((line, index) => {
        const match = line.match(/^\s*([\w-]+)\s*:\s*([^;]*\d+(?:\.\d+)?px[^;]*);/);
        if (!match) return [];
        return [{
            declaration: `${match[1]}: ${match[2]}`,
            precedingLine: lines[index - 1]?.trim(),
        }];
    });

    expect(rawPixelDeclarations.map(({ declaration }) => declaration)).toEqual([
        'border: 1px solid var(--xc-border)',
        'padding: 2px var(--xc-space-1)',
        'border: 1px solid var(--xc-border)',
        'border: 1px dashed var(--xc-border-strong)',
        'outline: 2px solid var(--xc-focus-ring)',
        'outline-offset: 2px',
        'border: 1px solid var(--xc-border)',
    ]);
    for (const { precedingLine } of rawPixelDeclarations) {
        expect(precedingLine).toMatch(/^\/\* .+ \*\/$/);
    }
});

it('keeps audited component geometry free of tokenizable pixel dimensions', () => {
    const geometryDeclaration = /(?:^|[;{])\s*((?:(?:margin|padding)(?:-[\w-]+)?|(?:row-|column-)?gap|border-radius|(?:(?:min|max)-)?(?:width|height|block-size|inline-size)|font-size|outline-offset))\s*:\s*([^;}]+)/gm;
    const violations = [];

    for (const file of auditedGeometryModules) {
        const css = withoutComments(readFileSync(join(componentsRoot, file), 'utf8'));
        for (const [, property, value] of css.matchAll(geometryDeclaration)) {
            const trimmedValue = value.trim();
            const isClippingBox = ['width', 'height'].includes(property)
                && trimmedValue === '1px';
            if (!isClippingBox && /(?<![\w.-])[1-9]\d*px(?![\w-])/.test(value)) {
                violations.push(`${file}: ${property}: ${trimmedValue}`);
            }
        }
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

it('tokenizes shared component dimensions except documented pixel exceptions', () => {
    const expectedPixelDeclarations = {
        'ActionIntentSummary.module.css': [
            'border-inline-start: 3px solid var(--xc-warning)',
            'border: 1px solid var(--xc-border)',
        ],
        'AlertsOverlay.module.css': [
            'max-width: min(380px, 100%)',
            'border-bottom: 1px solid var(--xc-border)',
            'padding: 1px var(--xc-space-2)',
            'outline: 2px solid var(--xc-focus-ring)',
            'outline-offset: 2px',
        ],
        'AmountField.module.css': [],
        'BackupReminderCard.module.css': [
            'border: 1px solid var(--xc-border)',
            'flex: 1 1 240px',
            'outline: 2px solid var(--xc-focus-ring)',
            'outline-offset: 2px',
        ],
        'BalanceChanges.module.css': [
            'border: 1px solid var(--xc-border)',
            'border-bottom: 1px dashed var(--xc-border-soft, var(--xc-border))',
            'border-top: 1px solid var(--xc-border-soft, var(--xc-border))',
        ],
        'CollectiblesView.module.css': [
            'border: 1px solid var(--xc-border)',
            'outline: 2px solid var(--xc-focus-ring)',
            'outline-offset: -2px',
            'outline: 2px solid var(--xc-on-accent)',
            'outline-offset: 2px',
            'border-top: 1px dashed var(--xc-border)',
        ],
    };

    for (const file of tokenCleanupModules) {
        const css = readFileSync(join(componentsRoot, file), 'utf8');
        expect(declarationsWithPixels(css), file).toEqual(expectedPixelDeclarations[file]);
    }

    const alerts = readFileSync(join(componentsRoot, 'AlertsOverlay.module.css'), 'utf8');
    expect(alerts).toContain('translateX(var(--xc-space-5))');
    expect(alerts).toMatch(/\.close\s*\{[^}]*width: var\(--xc-control-h-sm\);[^}]*height: var\(--xc-control-h-sm\)/s);
    expect(alerts).toContain('border-inline-start: var(--xc-space-1) solid');

    const collectibles = readFileSync(join(componentsRoot, 'CollectiblesView.module.css'), 'utf8');
    expect(collectibles).toContain('font-size: var(--xc-text-2xl);');
    expect(collectibles).toMatch(/\.chainOverlay\s*\{[^}]*width: var\(--xc-icon-lg\);[^}]*height: var\(--xc-icon-lg\)/s);
    expect(collectibles).toMatch(/\.pinBtn,[\s\S]*?\.hideBtn\s*\{[^}]*width: var\(--xc-control-h-sm\);[^}]*height: var\(--xc-control-h-sm\)/);
    expect(collectibles).toContain('font-size: var(--xc-text-lg);');
});
