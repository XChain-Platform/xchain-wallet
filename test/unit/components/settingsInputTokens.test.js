// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');

describe('settings field styling', () => {
    it('leaves field and dropdown skin to the shared Input and Select', () => {
        const primitives = read('packages/core/src/shared/components/settings/_settingsPrimitives.jsx');
        expect(primitives).not.toMatch(/export const (?:INPUT|INPUT_DISABLED|SELECT)\b/);
        for (const file of ['AppearanceSection', 'NetworkSection', 'SafetySection', 'FeesSection', 'LanguageRegionSection', 'PrivacySection']) {
            const source = read(`packages/core/src/shared/components/settings/${file}.jsx`);
            expect(source, file).toMatch(/<Select\b/);
            expect(source, file).not.toMatch(/<select\b/);
        }
    });

    it('sizes the shared fields from the control tokens', () => {
        const css = read('packages/core/src/ui/Input.module.css');
        expect(css).toMatch(/--xc-control-height:\s*var\(--xc-control-h-md\)/);
        expect(css).toMatch(/border:\s*1px solid var\(--xc-control-border\)/);
    });
});
