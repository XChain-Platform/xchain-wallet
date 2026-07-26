// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Playwright config for the REGTEST venue (, spec §8.6).
//
// Everything here differs from `playwright.config.js` for one reason:
// these specs sign and broadcast, and the default config cannot. See
// the header of `fixtures/regtest.js` for the full root cause - in
// short, the Vite DEV server silently serves the dev-mock SDK, whose
// signing path throws by design.
//
// THE PRODUCTION BUILD IS THE POINT. `webServer` runs `vite build`
// before `vite preview` on every run, deliberately: a stale `dist/`
// would serve yesterday's wallet while the spec reported on today's
// source, and that failure is invisible - green tests over code that
// isn't running. 13s of build is cheap next to a false green.
//
// `--disable-web-security` is a property of the LOCAL VENUE, not of the
// wallet: the regtest explorer sends no CORS headers for the preview
// origin. Production explorers do. It is scoped to this config so it
// can never relax the dev-server suite, which must keep testing real
// browser origin rules.

import { defineConfig, devices } from '@playwright/test';

// Deliberately NOT vite preview's default 4173: a hand-run preview (this
// venue is also driven manually while debugging, and a second coder shares
// this machine) would otherwise collide with the run and, worse, could be
// reused as if it were ours - serving a build we did not make.
const PREVIEW_PORT = 4183;

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.regtest.spec.js',
    outputDir: './test-results-regtest',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    // No retries: a broadcast spec that passes on retry is telling you
    // something (a race, a stale utxo view) that a retry would hide.
    retries: 0,
    workers: 1,
    // Onboarding (Argon2id) + a network switch + funding + a real round trip
    // to the chain. The long pole is the chain, not the app - and on a SHARED
    // venue it is specifically the INDEXER, which can run minutes behind the
    // tip while another session loads it. 240s failed a healthy send that way:
    // the action was on chain the whole time, just not indexed yet. Must stay
    // above the longest fixture budget (waitForValidAction, 300s) or the test
    // times out before the fixture can report the lag that explains it.
    timeout: 420_000,
    expect: { timeout: 30_000 },
    globalSetup: './global-setup.regtest.js',
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
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: {
                    args: [
                        '--disable-web-security',
                        // Without this, cross-origin requests still get blocked
                        // in out-of-process iframes/site-isolated renderers, so
                        // --disable-web-security alone is not enough.
                        '--disable-features=IsolateOrigins,site-per-process',
                    ],
                },
            },
        },
    ],
    webServer: {
        command: `pnpm -C ../../packages/web build && pnpm -C ../../packages/web preview --port ${PREVIEW_PORT} --strictPort`,
        url: `http://localhost:${PREVIEW_PORT}`,
        // Always false, even locally: reusing a preview server means
        // reusing whatever build it was started with, which reintroduces
        // exactly the stale-dist trap the build step above closes.
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
