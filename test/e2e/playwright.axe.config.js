// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Axe sweep: the layout sweep's walk with an axe-core audit of every screen,
// at the LG K51 size in Chromium. Not part of the default suite.
//
//     pnpm --dir test/e2e exec playwright test --config playwright.axe.config.js
//     LAYOUT_PORT=5442 ...   other port when 5441 is busy

import { defineConfig } from '@playwright/test';

// strictPort below: a busy port fails the run instead of silently measuring
// whichever tree's server already answers there.
const PORT = Number(process.env.LAYOUT_PORT) || 5441;
const BASE_URL = `http://localhost:${PORT}`;

const phone = (browserName, width, height, deviceScaleFactor) => ({
    browserName,
    viewport: { width, height },
    deviceScaleFactor,
    isMobile: browserName === 'chromium' ? true : undefined,
    hasTouch: true,
});

export default defineConfig({
    testDir: './layout',
    testMatch: /axe-sweep.spec\.js$/,
    outputDir: './test-results-axe',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'off',
        video: 'off',
        screenshot: 'off',
    },
    projects: [
        { name: 'android-lg-k51', use: phone('chromium', 411, 814, 1.75) },
    ],
    webServer: {
        command: `pnpm -C ../../packages/web dev --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, VITE_XCHAIN_REAL_SDK: '0' },
    },
});
