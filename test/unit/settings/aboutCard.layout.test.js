// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync('packages/core/src/shared/routes/Settings.jsx', 'utf8');
const settingsCss = readFileSync('packages/core/src/shared/routes/Settings.module.css', 'utf8');
const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

describe('About responsive card (G126)', () => {
    it('routes About through the shared form frame instead of the always-flat frame', () => {
        const flatPages = settingsSource.match(/const FLAT_GROUP_PAGES = new Set\(\[([\s\S]*?)\]\);/)?.[1];
        const formPages = settingsSource.match(/const FORM_FRAME_PAGES = new Set\(\[([\s\S]*?)\]\);/)?.[1];

        expect(flatPages).toBeDefined();
        expect(formPages).toBeDefined();
        expect(flatPages).not.toMatch(/['"]about['"]/);
        expect(formPages).toMatch(/['"]about['"]/);
    });

    it('removes the outer card below 600px', () => {
        const narrow = settingsCss.match(
            /@media not all and \(min-width: 600px\) \{\s*\.settingsSurface\.formFrame \{([^}]*)\}/,
        )?.[1];

        expect(narrow).toBeDefined();
        expect(narrow).toMatch(/padding:\s*0;/);
        expect(narrow).toMatch(/background:\s*transparent;/);
        expect(narrow).toMatch(/border:\s*0;/);
        expect(narrow).toMatch(/border-radius:\s*0;/);
        expect(narrow).toMatch(/box-shadow:\s*none;/);
    });

    it('uses the centered 560px form card from 600px', () => {
        const wide = settingsCss.match(
            /@media \(min-width: 600px\) \{\s*\.settingsSurface\.formFrame \{([^}]*)\}/,
        )?.[1];

        expect(wide).toBeDefined();
        expect(wide).toMatch(/width:\s*100%;/);
        expect(wide).toMatch(/max-width:\s*var\(--xc-form-card-max-width\);/);
        expect(wide).toMatch(/margin-inline:\s*auto;/);
        expect(tokensCss).toMatch(/--xc-form-card-max-width:\s*560px;/);
    });
});
