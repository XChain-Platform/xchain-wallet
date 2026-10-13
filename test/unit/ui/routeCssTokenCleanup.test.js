// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeFiles = [
    'Onboarding.module.css',
    'OnboardingCarousel.module.css',
    'OperatorDashboard.module.css',
    'OracleConsole.module.css',
    'PairSignerForm.module.css',
];

const routeCss = Object.fromEntries(routeFiles.map((file) => [
    file,
    readFileSync(`packages/core/src/shared/routes/${file}`, 'utf8'),
]));

function withoutComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function rawPixelDeclarations(css) {
    return [...withoutComments(css).matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;}]*\b\d+(?:\.\d+)?px\b[^;}]*);/gm)]
        .map(([, property, value]) => `${property}: ${value.trim()}`);
}

describe('route CSS token cleanup', () => {
    it('uses tokens for spacing, radii, and type sizes', () => {
        const violations = [];
        const tokenizedProperties = /^(?:margin|padding|gap|row-gap|column-gap|border-radius|font-size)(?:-|$)/;

        for (const [file, css] of Object.entries(routeCss)) {
            for (const declaration of rawPixelDeclarations(css)) {
                const property = declaration.slice(0, declaration.indexOf(':'));
                if (tokenizedProperties.test(property)) violations.push(`${file}: ${declaration}`);
            }
        }

        expect(violations).toEqual([]);
    });

    it('tokenizes the remaining exact carousel and onboarding offsets', () => {
        const onboarding = routeCss['Onboarding.module.css'];
        const carousel = routeCss['OnboardingCarousel.module.css'];
        const signer = routeCss['PairSignerForm.module.css'];

        // The hero entrance and the native checkbox offset left with the FormPage header and kit
        // Checkbox; the remaining action entrance keeps its tokenized offset.
        expect(onboarding).toContain('transform: translateY(var(--xc-space-2));');
        expect(onboarding).not.toMatch(/translateY\(\d+px\)/);
        expect(carousel).toMatch(/\.frameIcon\s*\{[^}]*width: calc\(var\(--xc-space-8\) \* 2\);[^}]*height: calc\(var\(--xc-space-8\) \* 2\);/s);
        expect(carousel).toMatch(/\.dot::before,[^}]*width: var\(--xc-space-2\);[^}]*height: var\(--xc-space-2\);/s);
        expect(signer).toContain('border-radius: var(--xc-radius-pill);');
    });
});
