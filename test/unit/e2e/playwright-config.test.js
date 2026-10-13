// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';

import config from '../../e2e/playwright.config.js';

describe('default Playwright projects', () => {
    it('runs smoke-tagged and LG K51 tagged specs with LG K51 Chrome 102 emulation', () => {
        const project = config.projects.find(({ name }) => name === 'android-lg-k51-smoke');

        expect(project).toBeDefined();
        expect(project.grep.test('@smoke')).toBe(true);
        expect(project.grep.test('@lg-k51')).toBe(true);
        expect(config.projects.find(({ name }) => name === 'chromium').grepInvert.test('@lg-k51')).toBe(true);
        expect(project.use).toMatchObject({
            browserName: 'chromium',
            viewport: { width: 412, height: 869 },
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
        });
        expect(project.use.userAgent).toContain('Android 10; LM-K500');
        expect(project.use.userAgent).toContain('Chrome/102.0.5005.125');
    });
});
