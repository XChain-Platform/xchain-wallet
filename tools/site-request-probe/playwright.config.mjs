// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: fileURLToPath(new URL('.', import.meta.url)),
    testMatch: 'live-recheck.spec.mjs',
    outputDir: fileURLToPath(new URL('../../tmp/site-request-probe-pw', import.meta.url)),
    fullyParallel: false,
    workers: 1,
    retries: 1,
    timeout: 60_000,
    reporter: [['list']],
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
});
