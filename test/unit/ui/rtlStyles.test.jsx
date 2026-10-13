// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
    BackIcon,
    ForwardIcon,
    MigrateIcon,
} from '../../../packages/core/src/ui/icons/index.jsx';

const uiRoot = join(process.cwd(), 'packages', 'core', 'src', 'ui');
const cssFiles = readdirSync(uiRoot)
    .filter((file) => file.endsWith('.module.css') || file === 'tokens.css')
    .sort();
const PHYSICAL_DECLARATION = /(?:^|[;{])\s*((?:(?:margin|padding|border)-(?:left|right)(?:-[\w-]+)?)|left|right|text-align)\s*:\s*([^;}]+)/gmi;

// Safe-area environment variables describe physical viewport cutouts, so
// body keeps physical padding properties for asymmetric landscape notches.
const ALLOWED_PHYSICAL_DECLARATIONS = new Set([
    'tokens.css:padding-left',
    'tokens.css:padding-right',
]);

function source(file) {
    return readFileSync(join(uiRoot, file), 'utf8');
}

function withoutComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function physicalDeclarations(file, css = source(file)) {
    return [...withoutComments(css).matchAll(PHYSICAL_DECLARATION)]
        .filter((match) => match[1] !== 'text-align' || /^(?:left|right)\s*$/i.test(match[2]))
        .map((match) => `${file}:${match[1].toLowerCase()}`);
}

describe('shared UI RTL styles', () => {
    it('detects physical inline declarations while ignoring comments and logical values', () => {
        const fixture = `
            /* left: 0; */
            .bad {
                margin-left: 1px;
                right: 0;
                text-align: right;
            }
            .good { text-align: start; }
        `;

        expect(physicalDeclarations('Fixture.module.css', fixture)).toEqual([
            'Fixture.module.css:margin-left',
            'Fixture.module.css:right',
            'Fixture.module.css:text-align',
        ]);
    });

    it('uses logical inline declarations except for physical safe-area cutouts', () => {
        const declarations = cssFiles.flatMap((file) => physicalDeclarations(file));
        const unexpected = declarations.filter((entry) => !ALLOWED_PHYSICAL_DECLARATIONS.has(entry));
        const allowed = declarations.filter((entry) => ALLOWED_PHYSICAL_DECLARATIONS.has(entry));

        expect(unexpected).toEqual([]);
        expect(allowed.sort()).toEqual([...ALLOWED_PHYSICAL_DECLARATIONS].sort());

        const pageHeader = source('PageHeader.module.css');
        expect(pageHeader).toMatch(/\.back\s*\{[^}]*padding-block:\s*var\(--xc-space-1\)/s);
        expect(pageHeader).toMatch(/\.back\s*\{[^}]*padding-inline-start:\s*0/s);
        expect(pageHeader).toMatch(/\.back\s*\{[^}]*padding-inline-end:\s*var\(--xc-space-2\)/s);
    });

    it('mirrors every marked horizontal icon from one shared RTL rule', () => {
        const { container } = render(
            <>
                <BackIcon />
                <ForwardIcon />
                <MigrateIcon />
            </>,
        );

        expect(container.querySelectorAll('svg[data-xc-directional-icon]')).toHaveLength(3);
        expect(source('tokens.css')).toMatch(
            /:where\(\[dir='rtl'\]\)\s+:where\(svg\[data-xc-directional-icon\]\)\s*\{[^}]*transform:\s*scaleX\(-1\)/s,
        );
    });

    it('keeps address, number, and amount fields left-to-right', () => {
        expect(source('AddressText.module.css')).toMatch(
            /\.addr\s*\{[^}]*direction:\s*ltr;[^}]*unicode-bidi:\s*isolate/s,
        );
        expect(source('Input.module.css')).toMatch(
            /\.input:is\(\[type='number'\],\s*\[inputmode='decimal'\],\s*\[inputmode='numeric'\]\)\s*\{[^}]*direction:\s*ltr/s,
        );
        expect(source('FeeSelector.module.css')).toMatch(
            /\.customInput\s*\{[^}]*direction:\s*ltr/s,
        );
        expect(readFileSync(join(uiRoot, 'AddressField.jsx'), 'utf8')).toContain('dir="ltr"');
        expect(readFileSync(join(uiRoot, 'AddressCombobox.jsx'), 'utf8')).toContain('dir="ltr"');
    });
});
