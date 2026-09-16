// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Playwright config for the TESTNET venue: the wallet's production build
// against the public Bitcoin testnet through the platform's public explorer
// and encoder (testnet-validator-network.md, rows 16 and 20).
//
// THE PRODUCTION BUILD IS THE POINT, for the same reason the regtest config
// gives: these specs sign and broadcast, the dev server serves a mock SDK that
// cannot, and a stale `dist/` would report on yesterday's wallet. `vite build`
// runs on every launch.
//
// NO `--disable-web-security` HERE, and that is a difference from regtest, not
// an omission. The regtest explorer sends no CORS headers for a local preview
// origin, so that venue relaxes the browser. The public explorer sends them,
// and a testnet pass is the one run whose value is that the wallet reached a
// real service under real browser origin rules; relaxing them would test a
// browser nobody ships.
//
// Every spec on this venue waits for real blocks (ten minutes apart on a good
// day, longer on a quiet one), which is what the timeouts below are sized to.
// A spec that needs an activation delay sets its own budget on top.

import { defineConfig, devices } from '@playwright/test';

// Distinct from the regtest venue's 4183 and vite preview's 4173, so a testnet
// pass can run beside either without either being mistaken for it.
const PREVIEW_PORT = Number(process.env.XC_PREVIEW_PORT) || 4193;

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.testnet.spec.js',
    outputDir: './test-results-testnet',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    // No retries: a retry on a public chain spends the treasury twice and
    // hides whatever the first run was telling you.
    retries: 0,
    // One worker: the specs share one treasury and one chain, and two of them
    // racing for the same UTXO set is a double spend, not parallelism.
    workers: 1,
    timeout: 3_600_000,
    expect: { timeout: 60_000 },
    globalSetup: './global-setup.testnet.js',
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://localhost:${PREVIEW_PORT}`,
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: `pnpm -C ../../packages/web build && pnpm -C ../../packages/web preview --port ${PREVIEW_PORT} --strictPort`,
        url: `http://localhost:${PREVIEW_PORT}`,
        // Never reuse: a preview already running serves whatever build it
        // started with, which is the stale-dist trap the build step closes.
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
