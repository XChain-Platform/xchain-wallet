// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Locked.module.css'),
    'utf8',
);

describe('Locked compact-height layout', () => {
    it('removes decorative height and tightens secondary content on landscape phones', () => {
        expect(css).toMatch(
            /@media \(max-height: 480px\) \{[\s\S]*?@media not all and \(min-width: 600px\) \{[\s\S]*?\.hero\s*\{\s*display: none;[\s\S]*?\.lockoutBanner\s*\{[\s\S]*?padding: var\(--xc-space-2\);[\s\S]*?\.forgotBlock\s*\{[\s\S]*?margin-top: var\(--xc-space-2\);[\s\S]*?\n\}/,
        );
        expect(css).not.toMatch(
            /@media \(max-height: 480px\) \{[\s\S]*?@media not all and \(min-width: 600px\) \{[\s\S]*?\.unlockingNote\s*\{[\s\S]*?display: none;/,
        );
    });

    it('keeps keyboard-open space for the password feedback and unlock action', () => {
        expect(css).toMatch(
            /:global\(html\[data-xc-keyboard='open'\]\) \.hero,[\s\S]*\.forgotBlock\s*\{\s*display: none;/,
        );
        expect(css).toMatch(
            /:global\(html\[data-xc-keyboard='open'\]\) \.lockoutBanner\s*\{[\s\S]*padding: var\(--xc-space-2\);/,
        );
    });
});
