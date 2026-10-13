// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const coreSource = join(process.cwd(), 'packages', 'core', 'src');
const requireFromVite = createRequire(
    createRequire(join(process.cwd(), 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

const physicalProperties = new Set([
    'margin-left',
    'margin-right',
    'padding-left',
    'padding-right',
    'left',
    'right',
    'border-left',
    'border-left-color',
    'border-left-style',
    'border-left-width',
    'border-right',
    'border-right-color',
    'border-right-style',
    'border-right-width',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-left-radius',
    'border-bottom-right-radius',
]);

const intentionalPhysicalDeclarations = new Set([
    'packages/core/src/shared/components/MnemonicGrid.module.css|.cell|direction|ltr',
    'packages/core/src/shared/components/NetworkFilter.module.css|.itemTicker|direction|ltr',
    'packages/core/src/shared/components/OriginIdentity.module.css|.registrableDomain,.hostEnding,.fullOrigin|direction|ltr',
    'packages/core/src/shared/components/PsbtIntentPanel.module.css|.addr,.value,.totalsValue,.details code|direction|ltr',
    'packages/core/src/shared/components/RawPsbtViewer.module.css|.hex,.json|direction|ltr',
    'packages/core/src/shared/components/TotalBalanceHero.module.css|.amount|direction|ltr',
    'packages/core/src/shared/components/WatcherResultPanel.module.css|.successMono|direction|ltr',
    'packages/core/src/shared/components/WatcherResultPanel.module.css|.machineText|direction|ltr',
    'packages/core/src/shared/components/settings/BackupSection.module.css|.mnemonicInput|direction|ltr',
    'packages/core/src/shared/components/settings/BackupSection.module.css|.gapLimitInput|direction|ltr',
    'packages/core/src/shared/components/settings/DeveloperModeSection.module.css|.descriptor|direction|ltr',
    'packages/core/src/shared/components/settings/ThisWalletSection.module.css|.xpub|direction|ltr',
]);

function cssModules(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModules(path);
        return entry.name.endsWith('.module.css') ? [path] : [];
    });
}

function normalizedSelector(declaration) {
    if (declaration.parent?.type !== 'rule') return '';
    return declaration.parent.selector
        .split(',')
        .map((selector) => selector.trim().replace(/\s+/g, ' '))
        .join(',');
}

function declarationKey(declaration, from) {
    const file = from.startsWith(process.cwd())
        ? relative(process.cwd(), from)
        : from;
    return [
        file,
        normalizedSelector(declaration),
        declaration.prop.toLowerCase(),
        declaration.value.trim().toLowerCase(),
    ].join('|');
}

function physicalDeclarations(source, from = 'Fixture.module.css', allowlist = new Set()) {
    const findings = [];
    postcss.parse(source, { from }).walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        const value = declaration.value.trim().toLowerCase();
        if (physicalProperties.has(property)
            || (property === 'text-align' && /^(?:left|right)$/.test(value))
            || (property === 'direction' && /^(?:ltr|rtl)$/.test(value))) {
            if (allowlist.has(declarationKey(declaration, from))) return;
            findings.push({
                property,
                value,
                line: declaration.source.start.line,
            });
        }
    });
    return findings;
}

describe('core CSS module logical properties', () => {
    it('detects physical inline-axis declarations regardless of formatting', () => {
        const source = [
            '.a { margin-left: 1rem; right: 0; }',
            '.b { text-align: right; border-top-left-radius: 2px; }',
            '.c { direction: ltr; }',
        ].join('\n');

        expect(physicalDeclarations(source)).toEqual([
            { property: 'margin-left', value: '1rem', line: 1 },
            { property: 'right', value: '0', line: 1 },
            { property: 'text-align', value: 'right', line: 2 },
            { property: 'border-top-left-radius', value: '2px', line: 2 },
            { property: 'direction', value: 'ltr', line: 3 },
        ]);
    });

    it('permits only selector-specific physical declarations from the allowlist', () => {
        const source = '.machine { direction: ltr; }\n.prose { direction: ltr; }';
        const allowlist = new Set(['Fixture.module.css|.machine|direction|ltr']);

        expect(physicalDeclarations(source, 'Fixture.module.css', allowlist)).toEqual([
            { property: 'direction', value: 'ltr', line: 2 },
        ]);
    });

    it('uses logical inline-axis declarations throughout core CSS modules', () => {
        const modules = cssModules(coreSource);
        const findings = modules.flatMap((file) => (
            physicalDeclarations(
                readFileSync(file, 'utf8'),
                file,
                intentionalPhysicalDeclarations,
            ).map((finding) => ({
                file: relative(process.cwd(), file),
                ...finding,
            }))
        ));

        expect(modules.length).toBeGreaterThan(0);
        expect(findings).toEqual([]);
    });

    it('keeps every audited LTR island isolated from surrounding RTL prose', () => {
        const declarationKeys = new Set();
        for (const file of cssModules(coreSource)) {
            postcss.parse(readFileSync(file, 'utf8'), { from: file }).walkDecls((declaration) => {
                declarationKeys.add(declarationKey(declaration, file));
            });
        }

        expect(
            [...intentionalPhysicalDeclarations].filter((key) => !declarationKeys.has(key)),
        ).toEqual([]);

        for (const key of intentionalPhysicalDeclarations) {
            const [file, selector] = key.split('|');
            const source = readFileSync(join(process.cwd(), file), 'utf8');
            const rule = postcss.parse(source, { from: file }).nodes.find((node) => (
                node.type === 'rule'
                && node.selector.split(',').map((part) => part.trim().replace(/\s+/g, ' ')).join(',') === selector
            ));
            expect(rule?.nodes.some((node) => (
                node.type === 'decl'
                && node.prop === 'unicode-bidi'
                && node.value === 'isolate'
            ))).toBe(true);
        }
    });

    it('mirrors scoped directional icons only below an RTL root', () => {
        const learnNote = readFileSync(
            join(coreSource, 'shared/components/LearnNote.module.css'),
            'utf8',
        );
        const platformSwitcher = readFileSync(
            join(coreSource, 'shared/components/PlatformSwitcher.module.css'),
            'utf8',
        );

        expect(learnNote).toMatch(
            /:global\(\[dir='rtl'\]\)[^{]+\{[^}]*transform:\s*scaleX\(-1\)/s,
        );
        expect(platformSwitcher).toMatch(
            /:global\(\[dir='rtl'\]\) \.trigger svg,[^{]+\{[^}]*transform:\s*scaleX\(-1\)/s,
        );
    });
});
