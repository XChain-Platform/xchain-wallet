// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Field-token sweep in dark mode at two sizes (demo wallet, web shell).
//
//     FIELD_PORT=6660 pnpm --dir test/e2e exec playwright test \
//         --config playwright.field-tokens.config.js

import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.FIELD_PORT) || 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './layout',
    testMatch: /field-tokens\.spec\.js$/,
    outputDir: './test-results-field-tokens',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: { baseURL: BASE_URL, actionTimeout: 20_000, navigationTimeout: 60_000, trace: 'off', video: 'off', screenshot: 'off' },
    projects: [
        { name: 'dark-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
        { name: 'dark-360', use: { browserName: 'chromium', viewport: { width: 360, height: 800 }, colorScheme: 'dark', isMobile: true, hasTouch: true } },
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
