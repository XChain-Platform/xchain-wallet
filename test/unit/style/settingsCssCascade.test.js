// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/routes/Settings.module.css', 'utf8');

describe('Settings CSS cascade safeguards', () => {
    it('keeps field label rows out of the phone-wide wrapping fallback', () => {
        expect(css).toMatch(
            /\.page div:not\(\[class\*=['"]labelRow['"]\]\)\s*\{[^}]*flex-wrap:\s*wrap !important;/s,
        );
        expect(css).not.toMatch(/\.page div\s*\{[^}]*flex-wrap:\s*wrap !important;/s);
    });

    it('keeps Settings row padding and dividers ahead of nested card resets', () => {
        expect(css).toMatch(
            /\.settingsSurface\.settingsSurface \[data-settings-row\]\s*\{[^}]*padding:\s*var\(--xc-settings-row-pad\);[^}]*box-shadow:\s*inset 0 -1px var\(--xc-settings-row-divider\);/s,
        );
        expect(css).not.toMatch(/^\s*\.settingsSurface \[data-settings-row\]\s*\{/m);
    });
});
