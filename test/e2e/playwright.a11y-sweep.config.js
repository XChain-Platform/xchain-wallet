// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Demo-mode axe sweep over every route, Settings page, popover and palette
// destination, in light and dark at phone and desktop widths. Not part of
// the default suite (it walks about a hundred screens per combination).
//
//     pnpm --dir test/e2e exec playwright test --config playwright.a11y-sweep.config.js
//     LAYOUT_PORT=5580 ...   other port when 5441 is busy

import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.LAYOUT_PORT) || 5441;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './tests/a11y',
    testMatch: /demo-axe-sweep\.spec\.js$/,
    outputDir: './test-results-a11y-sweep',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 30 * 60 * 1000,
    reporter: 'list',
    use: { baseURL: BASE_URL, trace: 'off', video: 'off', screenshot: 'off' },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
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
