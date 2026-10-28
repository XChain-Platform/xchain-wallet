// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Dark palette and pseudo-RTL sweeps at the three reference sizes.
//
//     SWEEP_PORT=6160 SWEEP_OUT=<dir> pnpm --dir test/e2e exec playwright test \
//         --config playwright.darkrtl.config.js --project=dark-360
//
// Each project writes screenshots and results.jsonl under SWEEP_OUT/<project>.

import { defineConfig } from '@playwright/test';
import { withHostBlock } from './host-block.js';

const PORT = Number(process.env.SWEEP_PORT) || 5173;
const BASE_URL = `http://localhost:${PORT}`;
const SIZES = { 360: [360, 800], 820: [820, 1180], 1440: [1440, 900] };

const projects = [];
for (const mode of ['dark', 'rtl', 'darkset']) {
    for (const [width, height] of Object.values(SIZES)) {
        projects.push(withHostBlock({
            name: `${mode}-${width}`,
            metadata: { mode },
            use: {
                browserName: 'chromium',
                channel: 'chromium',
                viewport: { width, height },
                // darkset keeps the OS light and turns dark on through the app's setting.
                colorScheme: mode === 'dark' ? 'dark' : 'light',
                isMobile: width < 500,
                hasTouch: width < 500,
                deviceScaleFactor: 1,
            },
        }));
    }
}

export default defineConfig({
    testDir: './layout',
    testMatch: /darkrtl-(sweep|extra)\.spec\.js$/,
    outputDir: './test-results-darkrtl',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: { baseURL: BASE_URL, actionTimeout: 20_000, navigationTimeout: 60_000, trace: 'off', video: 'off', screenshot: 'off' },
    projects,
    webServer: {
        command: `pnpm -C ../../packages/web dev --port ${PORT} --strictPort --host 127.0.0.1`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, VITE_XCHAIN_REAL_SDK: '0' },
    },
});
