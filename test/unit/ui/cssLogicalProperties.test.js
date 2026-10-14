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

const physicalDeclarationAllowlist = new Map([
    [
        'packages/core/src/shared/components/AlertsOverlay.module.css|.overlay|padding',
        'env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)',
    ],
    [
        'packages/core/src/shared/components/BottomTabBar.module.css|.sheet|padding',
        'var(--xc-space-2) env(safe-area-inset-right, 0px) calc(var(--xc-space-3) + env(safe-area-inset-bottom, var(--xc-space-3))) env(safe-area-inset-left, 0px)',
    ],
    [
        'packages/core/src/shared/components/GatedFileViewer.module.css|.overlay|padding',
        'calc(var(--xc-space-4) + env(safe-area-inset-top, 0px)) calc(var(--xc-space-4) + env(safe-area-inset-right, 0px)) calc(var(--xc-space-4) + env(safe-area-inset-bottom, 0px)) calc(var(--xc-space-4) + env(safe-area-inset-left, 0px))',
    ],
]);

function cssModules(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModules(path);
        return entry.name.endsWith('.module.css') ? [path] : [];
    });
}

function normalizedValue(value) {
    return postcss.list.space(value).join(' ');
}

function physicalDeclarations(source, from = 'Fixture.module.css', allowlist = null) {
    const findings = [];
    postcss.parse(source, { from }).walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        const value = declaration.value.trim().toLowerCase();
        const shorthandValues = postcss.list.space(value);
        const asymmetricInlineShorthand = allowlist !== null
            && (property === 'margin' || property === 'padding')
            && shorthandValues.length === 4
            && shorthandValues[1] !== shorthandValues[3];
        if (physicalProperties.has(property)
            || (property === 'text-align' && /^(?:left|right)$/.test(value))
            || asymmetricInlineShorthand) {
            const file = relative(process.cwd(), from);
            const selector = declaration.parent.type === 'rule' ? declaration.parent.selector : '';
            const allowlistKey = `${file}|${selector}|${property}`;
            if (allowlist?.get(allowlistKey) === normalizedValue(value)) return;
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
            '.c { padding: 1px 2px 3px 4px; }',
        ].join('\n');

        expect(physicalDeclarations(source, 'Fixture.module.css', new Map())).toEqual([
            { property: 'margin-left', value: '1rem', line: 1 },
            { property: 'right', value: '0', line: 1 },
            { property: 'text-align', value: 'right', line: 2 },
            { property: 'border-top-left-radius', value: '2px', line: 2 },
            { property: 'padding', value: '1px 2px 3px 4px', line: 3 },
        ]);
    });

    it('allows only exact physical safe-area shorthands', () => {
        const file = join(coreSource, 'shared', 'components', 'AlertsOverlay.module.css');
        const source = readFileSync(file, 'utf8');

        expect(physicalDeclarations(source, file, new Map())).toContainEqual({
            property: 'padding',
            value: [
                'env(safe-area-inset-top, 0px)',
                'env(safe-area-inset-right, 0px)',
                'env(safe-area-inset-bottom, 0px)',
                'env(safe-area-inset-left, 0px)',
            ].join('\n        '),
            line: 8,
        });
        expect(physicalDeclarations(source, file, physicalDeclarationAllowlist)).toEqual([]);
        expect(physicalDeclarations(
            source.replace('env(safe-area-inset-left, 0px)', '1px'),
            file,
            physicalDeclarationAllowlist,
        )).toHaveLength(1);
    });

    it('uses logical inline-axis shorthands throughout A-H component CSS modules', () => {
        const directory = join(coreSource, 'shared', 'components');
        const modules = readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isFile()
                && /^[A-H].*\.module\.css$/.test(entry.name))
            .map((entry) => join(directory, entry.name));
        const findings = modules.flatMap((file) => (
            physicalDeclarations(
                readFileSync(file, 'utf8'),
                file,
                physicalDeclarationAllowlist,
            ).map((finding) => ({
                file: relative(process.cwd(), file),
                ...finding,
            }))
        ));

        expect(modules.length).toBeGreaterThan(0);
        expect(findings).toEqual([]);
    });

    it('mirrors directional chrome and isolates LTR data in the A-H component pass', () => {
        const component = (name) => readFileSync(
            join(coreSource, 'shared', 'components', name),
            'utf8',
        );

        expect(component('AlertsOverlay.module.css')).toMatch(
            /:global\(html\[dir='rtl'\]\) \.panel\s*\{[^}]*--xc-slide-in-offset:\s*-20px/s,
        );
        expect(component('HeaderActionMenu.module.css')).toMatch(
            /:global\(html\[dir='rtl'\]\) \.rowChevron\s*\{[^}]*transform:\s*scaleX\(-1\)/s,
        );
        expect(component('HeaderSettingsButton.module.css')).toMatch(
            /:global\(html\[dir='rtl'\]\) \.summaryChevron\s*\{[^}]*transform:\s*scaleX\(-1\)/s,
        );

        for (const name of [
            'ActionIntentSummary.module.css',
            'AmountField.module.css',
            'BalanceChanges.module.css',
            'BalanceList.module.css',
            'ConfirmActionModal.module.css',
            'ContactsPickerScreen.module.css',
            'DataTable.module.css',
            'DerivationPathCrossCheck.module.css',
        ]) {
            expect(component(name), name).toMatch(/direction:\s*ltr;/);
            expect(component(name), name).toMatch(/unicode-bidi:\s*isolate;/);
        }
    });

    it('uses logical inline-axis declarations throughout core CSS modules', () => {
        const modules = cssModules(coreSource);
        const findings = modules.flatMap((file) => (
            physicalDeclarations(readFileSync(file, 'utf8'), file).map((finding) => ({
                file: relative(process.cwd(), file),
                ...finding,
            }))
        ));

        expect(modules.length).toBeGreaterThan(0);
        expect(findings).toEqual([]);
    });
});
