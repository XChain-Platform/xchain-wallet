// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import config, { desktopUserAgentForHost } from '../../e2e/playwright.config.js';
import regtestConfig from '../../e2e/playwright.regtest.config.js';

const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

describe('Playwright desktop host platform', () => {
    it.each([
        ['darwin', 'Macintosh; Intel Mac OS X 10_15_7'],
        ['linux', 'X11; Linux x86_64'],
        ['win32', 'Windows NT 10.0; Win64; x64'],
    ])('uses a %s user agent', (platform, token) => {
        const userAgent = desktopUserAgentForHost(platform, DESKTOP_CHROME_UA);

        expect(userAgent).toContain(`(${token})`);
        expect(userAgent).toContain('Chrome/147.0.0.0');
    });

    it('configures the desktop project for the current host', () => {
        expect(config.projects[0].use.userAgent).toBe(desktopUserAgentForHost());
    });

    it('configures the regtest desktop project for the current host', () => {
        expect(regtestConfig.projects[0].use.userAgent).toBe(desktopUserAgentForHost());
    });
});
