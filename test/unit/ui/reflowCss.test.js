// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tierForWidth } from '../../../packages/core/src/shared/styles/breakpoints.js';

function readCss(relativePath) {
    return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('zoom reflow CSS', () => {
    it('uses collapsed navigation tiers at the 200 and 400 percent equivalents', () => {
        expect(tierForWidth(640)).toBe('rail');
        expect(tierForWidth(320)).toBe('compact');
    });

    it('wraps the compact app header instead of widening the shell', () => {
        const css = readCss('packages/core/src/shared/components/AppHeader.module.css');

        expect(css).toMatch(/:global\(\[data-xc-tier='compact'\]\) \.bar\s*\{[^}]*flex-wrap:\s*wrap/s);
        expect(css).toMatch(/:global\(\[data-xc-tier='compact'\]\) \.right\s*\{[^}]*flex:\s*1 1 100%[^}]*flex-wrap:\s*wrap/s);
    });

    it('lets route headings and short onboarding viewports grow or scroll', () => {
        const pageHeader = readCss('packages/core/src/ui/PageHeader.module.css');
        const onboarding = readCss('packages/core/src/shared/routes/OnboardingCarousel.module.css');

        expect(pageHeader).toMatch(/\.title\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/s);
        expect(pageHeader).not.toMatch(/\.title\s*\{[^}]*text-overflow:\s*ellipsis/s);
        expect(onboarding).toMatch(/\.frameViewport\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
    });
});
