// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Buttons and controls audit venues (demo mode, no network).
//
//     BUTTONS_PORT=6400 BUTTONS_SCHEME=dark pnpm --dir test/e2e exec playwright test \
//         --config playwright.buttons-audit.config.js
//
// BUTTONS_PORT picks the dev server port, BUTTONS_SCHEME light (default) or dark.

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.BUTTONS_PORT) || 5173;
const COLOR_SCHEME = process.env.BUTTONS_SCHEME === 'dark' ? 'dark' : 'light';

export default defineConfig({
    testDir: './layout',
    testMatch: /buttons-audit\.spec\.js$/,
    outputDir: './test-results-buttons-audit',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: { baseURL: `http://localhost:${PORT}`, trace: 'off', video: 'off', screenshot: 'off', colorScheme: COLOR_SCHEME },
    projects: [
        {
            name: 'phone-360',
            use: { browserName: 'chromium', channel: 'chromium', viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
        },
        { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1440, height: 900 } } },
    ],
    webServer: {
        command: `pnpm -C ../../packages/web dev --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, VITE_XCHAIN_REAL_SDK: '0' },
    },
});
