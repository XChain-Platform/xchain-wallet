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
    'QueuedBroadcastBanner.module.css',
    'QueuedResultPanel.module.css',
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
    'DerivationPathCrossCheck.module.css',
    'DraftDiscardButton.module.css',
];
const controlDimensionModules = [
    'EmptyStateNudge.module.css',
    'GatedFileViewer.module.css',
    'HeaderActionMenu.module.css',
    'HwFirmwareBanner.module.css',
    'HwSignBlock.module.css',
    'LayoutModeToggle.module.css',
];
const statusModalModules = [
    'NetworkStatusIndicator.module.css',
    'NoticeModal.module.css',
    'OriginIdentity.module.css',
    'OwnerWithdrawWarning.module.css',
    'PlatformSwitcher.module.css',
    'PortfolioChart.module.css',
];
const pixelTokenModules = [
    'PreflightPanel.module.css',
    'PsbtIntentPanel.module.css',
    'QueuedBroadcastBanner.module.css',
    'QueuedResultPanel.module.css',
    'RawPsbtViewer.module.css',
    'ReachabilityBanner.module.css',
];
const settingsGeometryModules = [
    'WalletIdentity.module.css',
    'WatcherResultPanel.module.css',
    'settings/BackupSection.module.css',
    'settings/DeveloperModeSection.module.css',
    'settings/ThisWalletSection.module.css',
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

function undocumentedPixelGeometry(file, css) {
    const lines = css.split('\n');
    const violations = [];

    for (let index = 0; index < lines.length; index += 1) {
        const declaration = /^\s*([\w-]+)\s*:\s*.*?-?\d+(?:\.\d+)?px/.exec(lines[index]);
        if (!declaration) continue;

        const property = declaration[1];
        const hairline = /^(?:border(?:-(?:block|inline)(?:-(?:start|end))?)?|outline)$/.test(property)
            && [...lines[index].matchAll(/(-?\d+(?:\.\d+)?)px/g)]
                .every((match) => Math.abs(Number(match[1])) <= 2);
        if (hairline) continue;

        const previousLine = lines[index - 1] || '';
        if (!/^\s*\/\* .* has no .*token equivalent\. \*\/\s*$/.test(previousLine)) {
            violations.push(`${file}:${index + 1}: ${lines[index].trim()}`);
        }
    }

    return violations;
}

function undocumentedPixelDimensions(file, css) {
    const violations = [];

    for (const match of css.matchAll(/(^|\n)([^\n{}]+:\s*[^;{}]*\d+(?:\.\d+)?px[^;{}]*;)/g)) {
        const declaration = match[2].trim();
        const property = declaration.slice(0, declaration.indexOf(':')).trim();
        const values = [...declaration.matchAll(/(\d+(?:\.\d+)?)px/g)]
            .map((value) => Number(value[1]));
        const isHairline = /^(?:border(?:-[\w-]+)?|outline)$/.test(property)
            && values.every((value) => value <= 2);
        const isBreakpoint = property === 'max-width' || property === 'min-width';
        const previousLine = css.slice(0, match.index).trimEnd().split('\n').at(-1).trim();
        const hasExceptionComment = /^\/\*.*(?:no (?:border-width )?token|spacing scale).*\*\/$/.test(previousLine);

        if (!isHairline && !isBreakpoint && !hasExceptionComment) {
            violations.push(`${file}: ${declaration}`);
        }
    }

    return violations;
}

function rawComponentGeometry(file, css) {
    const geometryProperty = /^(?:flex|gap|row-gap|column-gap|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|border-radius|font-size|(?:min-|max-)?(?:width|height)|outline-offset)$/;
    const violations = [];

    for (const declaration of withoutComments(css).matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;}]+)/gm)) {
        const [, property, value] = declaration;
        if (geometryProperty.test(property) && /\d+(?:\.\d+)?px/.test(value)) {
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
        'padding: 2px var(--xc-space-1)',
        'border: 1px solid var(--xc-border)',
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

it('uses shared dimension tokens across the empty, gated, menu, hardware, and layout controls', () => {
    const modules = Object.fromEntries(controlDimensionModules.map((file) => [
        file,
        readFileSync(join(componentsRoot, file), 'utf8'),
    ]));

    // The slide-in offset is a spacing token that RTL negates.
    expect(modules['HeaderActionMenu.module.css']).toContain('--xc-slide-in-offset: var(--xc-space-5)');
    expect(modules['HeaderActionMenu.module.css']).toContain('transform: translateX(var(--xc-slide-in-offset))');
    expect(modules['HeaderActionMenu.module.css']).toMatch(
        /\.close\s*\{[^}]*width:\s*var\(--xc-control-h-sm\);[^}]*height:\s*var\(--xc-control-h-sm\)/s,
    );
    expect(modules['HeaderActionMenu.module.css']).toMatch(
        /\.rowIcon\s*\{[^}]*width:\s*var\(--xc-icon-xl\);[^}]*height:\s*var\(--xc-icon-xl\)/s,
    );
    expect(modules['HeaderActionMenu.module.css']).toMatch(
        /\.rowChevron\s*\{[^}]*width:\s*var\(--xc-icon-sm\);[^}]*height:\s*var\(--xc-icon-sm\)/s,
    );
    expect(modules['HwSignBlock.module.css']).toContain(
        'padding: var(--xc-space-1) var(--xc-space-2);',
    );
    expect(modules['LayoutModeToggle.module.css']).toContain('gap: var(--xc-space-2);');

    for (const [file, css] of Object.entries(modules)) {
        expect(withoutComments(css), file).not.toMatch(
            /(?:gap|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|border-radius|font-size)\s*:[^;}]*\d+(?:\.\d+)?(?:px|rem)/,
        );
    }
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

it('uses tokens for geometry in the requested component modules', () => {
    const violations = settingsGeometryModules.flatMap((file) => rawComponentGeometry(
        file,
        readFileSync(join(componentsRoot, file), 'utf8'),
    ));

    expect(violations).toEqual([]);

    const identity = readFileSync(join(componentsRoot, 'WalletIdentity.module.css'), 'utf8');
    expect(identity).toContain('flex: 0 0 var(--xc-icon-xl);');
    expect(identity).toContain('font-size: var(--xc-text-xs);');

    const watcher = readFileSync(join(componentsRoot, 'WatcherResultPanel.module.css'), 'utf8');
    const successRow = watcher.slice(watcher.indexOf('.successRow {'), watcher.indexOf('}', watcher.indexOf('.successRow {')));
    expect(successRow).toContain('gap: var(--xc-space-1);');
});

it('uses the shared padding and radius for explicit card modules', () => {
    const tokens = readFileSync(tokensPath, 'utf8');
    expect(tokens).toContain('--xc-card-pad: var(--xc-space-4);');
    expect(tokens).toContain('--xc-card-radius: var(--xc-radius-md);');

    // A card module either composes the shared card (ui/Card.module.css)
    // or, for a tone notice, draws its box from the same two tokens.
    for (const file of cardModules) {
        const css = readFileSync(join(componentsRoot, file), 'utf8');
        if (/composes: (card|flush) from '[^']*\/Card\.module\.css'/.test(css)) continue;
        expect(css, file).toContain('padding: var(--xc-card-pad);');
        expect(css, file).toContain('border-radius: var(--xc-card-radius);');
    }
});

it('tokenizes shared component dimensions except documented pixel exceptions', () => {
    const expectedPixelDeclarations = {
        'ActionIntentSummary.module.css': [],
        'AlertsOverlay.module.css': [
            'max-width: min(380px, 100%)',
            'border-bottom: 1px solid var(--xc-border)',
            'padding: 1px var(--xc-space-2)',
            'outline: 2px solid var(--xc-focus-ring)',
            'outline-offset: 2px',
        ],
        'AmountField.module.css': [],
        'BackupReminderCard.module.css': [
            'flex: 1 1 240px',
            'outline: 2px solid var(--xc-focus-ring)',
            'outline-offset: 2px',
        ],
        'BalanceChanges.module.css': [
            'border-bottom: 1px solid var(--xc-border-soft, var(--xc-border))',
            'border-top: 1px solid var(--xc-border-soft, var(--xc-border))',
        ],
        'CollectiblesView.module.css': [
            'outline: 2px solid var(--xc-focus-ring)',
            'outline-offset: -2px',
            'outline: 2px solid var(--xc-on-accent)',
            'outline-offset: 2px',
            'border-top: 1px solid var(--xc-border)',
        ],
    };


    for (const file of tokenCleanupModules) {
        const css = readFileSync(join(componentsRoot, file), 'utf8');
        expect(declarationsWithPixels(css), file).toEqual(expectedPixelDeclarations[file]);
    }

    const alerts = readFileSync(join(componentsRoot, 'AlertsOverlay.module.css'), 'utf8');
    expect(alerts).toContain('--xc-slide-in-offset: var(--xc-space-5)');
    expect(alerts).toContain('translateX(var(--xc-slide-in-offset))');
    expect(alerts).toMatch(/\.close\s*\{[^}]*width: var\(--xc-control-h-sm\);[^}]*height: var\(--xc-control-h-sm\)/s);
    expect(alerts).toContain('border-inline-start: var(--xc-space-1) solid');

    const collectibles = readFileSync(join(componentsRoot, 'CollectiblesView.module.css'), 'utf8');
    expect(collectibles).toContain('font-size: var(--xc-text-2xl);');
    expect(collectibles).toMatch(/\.chainOverlay\s*\{[^}]*width: var\(--xc-icon-lg\);[^}]*height: var\(--xc-icon-lg\)/s);
    expect(collectibles).toMatch(/\.pinBtn,[\s\S]*?\.hideBtn\s*\{[^}]*width: var\(--xc-control-h-sm\);[^}]*height: var\(--xc-control-h-sm\)/);
});

it('keeps the audited component geometry on shared design tokens', () => {
    const cssByFile = Object.fromEntries(statusModalModules.map((file) => [
        file,
        readFileSync(join(componentsRoot, file), 'utf8'),
    ]));

    expect(cssByFile['NetworkStatusIndicator.module.css']).toMatch(
        /\.trigger\s*\{[^}]*width:\s*var\(--xc-control-h-md\);[^}]*height:\s*var\(--xc-control-h-md\)/s,
    );
    expect(cssByFile['NetworkStatusIndicator.module.css']).toMatch(
        /\.dot\s*\{[^}]*width:\s*var\(--xc-icon-xs\);[^}]*height:\s*var\(--xc-icon-xs\)/s,
    );
    expect(cssByFile['NetworkStatusIndicator.module.css']).toContain(
        'calc(100vw - var(--xc-space-3) - var(--xc-space-3))',
    );
    expect(cssByFile['NoticeModal.module.css']).toContain(
        'calc(var(--xc-space-4) + env(safe-area-inset-right, 0))',
    );
    expect(cssByFile['NoticeModal.module.css']).toContain('padding: var(--xc-card-pad);');
    expect(cssByFile['PlatformSwitcher.module.css']).toMatch(
        /\.trigger\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\);[^}]*width:\s*var\(--xc-control-h-md\);[^}]*height:\s*var\(--xc-control-h-md\)/s,
    );
    expect(cssByFile['PlatformSwitcher.module.css']).not.toMatch(/padding:\s*var\(--xc-space-2\) 10px/);
    expect(cssByFile['PlatformSwitcher.module.css']).toContain(
        'calc(100vw - var(--xc-space-3) - var(--xc-space-3))',
    );
    expect(cssByFile['PortfolioChart.module.css']).toContain(
        'padding: var(--xc-space-1) var(--xc-control-pad-x);',
    );
    expect(cssByFile['PortfolioChart.module.css']).toContain(
        'border-radius: var(--xc-radius-pill);',
    );
    expect(statusModalModules.flatMap((file) => (
        undocumentedPixelGeometry(file, cssByFile[file])
    ))).toEqual([]);
});

it('uses dimension tokens or documents unmatched pixel values in cleanup modules', () => {
    const violations = pixelTokenModules.flatMap((file) => undocumentedPixelDimensions(
        file,
        readFileSync(join(componentsRoot, file), 'utf8'),
    ));

    expect(violations).toEqual([]);

    const queuedResult = readFileSync(join(componentsRoot, 'QueuedResultPanel.module.css'), 'utf8');
    expect(queuedResult).toContain('font-size: var(--xc-icon-xl);');
});
