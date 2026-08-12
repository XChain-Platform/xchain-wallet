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
// short, the Vite DEV server serves the dev-mock SDK (deliberately, as
// of ), whose signing path throws by design.
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
// Overridable because two people (or two sessions) do share this machine, and
// `strictPort` turns that into an immediate hard failure: whoever starts second
// gets "port already used" and no run at all. Default unchanged, so nothing has
// to know about this; set XC_PREVIEW_PORT to run a second suite alongside one
// already in flight. Note the CHAIN is still shared even when the ports are not,
// so a spec that moves the node's clock still needs to take its turn.
const PREVIEW_PORT = Number(process.env.XC_PREVIEW_PORT) || 4183;

// XC_REUSE_BUILD serves the `dist/` that is already there instead of making a
// new one, and it exists for exactly one shape of work: several sessions
// driving DIFFERENT CHAINS of the same venue at the same time, on different
// ports, over wallet source nobody is editing. Two concurrent runs otherwise
// each `vite build` into the one shared `dist/`, and a half-written bundle is a
// worse failure than a stale one.
//
// It is opt-in and loud because it re-opens the trap the build step above
// closes: whoever sets it owns the freshness of that build, and setting it
// after touching wallet source will test yesterday's wallet and report on
// today's. The output dir moves with the port too, so parallel runs cannot
// overwrite each other's traces.
const REUSE_BUILD = process.env.XC_REUSE_BUILD === '1';
if (REUSE_BUILD) {
    console.warn(`[regtest] XC_REUSE_BUILD=1: serving the EXISTING packages/web/dist on :${PREVIEW_PORT} `
        + 'without rebuilding. Any wallet source change made since that build is NOT under test.');
}

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.regtest.spec.js',
    outputDir: REUSE_BUILD ? `./test-results-regtest-${PREVIEW_PORT}` : './test-results-regtest',
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
        command: REUSE_BUILD
            ? `pnpm -C ../../packages/web preview --port ${PREVIEW_PORT} --strictPort`
            : `pnpm -C ../../packages/web build && pnpm -C ../../packages/web preview --port ${PREVIEW_PORT} --strictPort`,
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
