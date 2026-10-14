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

    it('keeps the compact app header on one row while identity text shrinks', () => {
        const css = readCss('packages/core/src/shared/components/AppHeader.module.css');

        expect(css).toMatch(/\.bar\s*\{[^}]*flex-wrap:\s*nowrap/s);
        expect(css).toMatch(/\.left\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0/s);
        expect(css).toMatch(/\.right\s*\{[^}]*flex:\s*0 0 auto[^}]*flex-wrap:\s*nowrap/s);
        expect(css).not.toMatch(/data-xc-tier='compact'[\s\S]*?\.bar\s*\{/);
    });

    it('lets route headings and short onboarding viewports grow or scroll', () => {
        const pageHeader = readCss('packages/core/src/ui/PageHeader.module.css');
        const onboarding = readCss('packages/core/src/shared/routes/OnboardingCarousel.module.css');

        expect(pageHeader).toMatch(/\.title\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/s);
        expect(pageHeader).not.toMatch(/\.title\s*\{[^}]*text-overflow:\s*ellipsis/s);
        expect(onboarding).toMatch(/\.frameViewport\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
    });
});
