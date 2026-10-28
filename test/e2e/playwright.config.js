// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Playwright config (§52.4).
//
// Drives the web SPA (`packages/web`) via Vite's dev server. Specs
// assume a fresh browser context per test (Playwright's default), so
// IndexedDB + localStorage state don't leak between cases.
//
// Each spec test runs serial by default via `workers: 1`. The harness
// talks to a single shared vault through the SPA's in-page host, and
// IDB state inside one browser context isn't easy to reset between
// tests without reloading the tab. One worker + one tab + one IDB =
// linear, easy-to-reason-about runs.
//
// The `webServer` spawns `pnpm -C packages/web dev` on a port this suite owns
// (E2E_DEV_PORT, default 5473) with --strictPort and never reuses a listener:
// a listener another session leaves on a shared port serves that session's
// tree, so a busy port fails the run loudly instead.
//
// The timeouts are NOT constants. This suite shares a machine with whatever
// else is on it, and a fixed budget on a busy one fails a different spec each
// run while every one of them passes in isolation. `timeout-budget.js` sizes
// the budget from the measured load; see its header for why a single number
// cannot be right for both an idle and a contended box. Pin
// `PW_TIMEOUT_SCALE=1` for the unscaled budget.

import { defineConfig, devices } from '@playwright/test';

import { describeBudget, timeoutBudget } from './timeout-budget.js';
import { desktopUserAgentForHost } from './host-user-agent.js';

export { desktopUserAgentForHost };

const CHROMIUM = {
    ...devices['Desktop Chrome'],
    // Playwright derives navigator.platform from this user agent,
    // keeping ControlOrMeta aligned with the app's host shortcut gate.
    userAgent: desktopUserAgentForHost(),
    // New headless: the full browser, which renders like the headed one users run.
    channel: 'chromium',
    launchOptions: {
        // The dev-mock suite reaches only loopback. Route handlers do not
        // cover WebSockets, so the resolver refuses every other host, which
        // keeps a spec from reaching a live explorer by any transport.
        args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
    },
};

// The dark-mode field-token gate under ./layout (field-tokens.spec.js),
// one project per size it walks; playwright.field-tokens.config.js runs the
// same spec on its own.
const LAYOUT_GATES = [
    {
        name: 'dark-1440',
        testDir: './layout',
        testMatch: /field-tokens\.spec\.js$/,
        use: { ...CHROMIUM, viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
        name: 'dark-360',
        testDir: './layout',
        testMatch: /field-tokens\.spec\.js$/,
        use: { ...CHROMIUM, viewport: { width: 360, height: 800 }, colorScheme: 'dark', isMobile: true, hasTouch: true },
    },
];

// Not 5173: that is the port every other dev server and sweep config defaults to.
const PORT = Number(process.env.E2E_DEV_PORT) || 5473;
const BASE_URL = `http://localhost:${PORT}`;

const budget = timeoutBudget();
// Named in the run's own output, so a red run is self-describing: the
// budget it had is the first thing you need to know when deciding whether
// a timeout was pressure or a genuine hang.
console.log(describeBudget(budget));

export default defineConfig({
    testDir: './tests',
    // `*.regtest.spec.js` belongs to `playwright.regtest.config.js`, which
    // serves a PRODUCTION build against a live chain. Those specs sign and
    // broadcast; this dev server serves the dev-mock SDK and cannot. Running
    // them here would fail for an unrelated reason and teach nothing.
    // `*.testnet.spec.js` belongs to `playwright.testnet.config.js`, where
    // live testnet credentials are supplied explicitly.
    testIgnore: [
        '**/*.regtest.spec.js',
        '**/*.testnet.spec.js',
        '**/*.extension.spec.js',
        // On demand through playwright.a11y-sweep.config.js: about a hundred
        // screens per theme and size is too long for the default run.
        '**/demo-axe-sweep.spec.js',
    ],
    outputDir: './test-results',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    // Argon2id KDF on CI runners can take several seconds, and an on-demand
    // Vite transform on a loaded box costs several more. Both scale with
    // contention, so both budgets do too.
    timeout: budget.timeout,
    expect: {
        timeout: budget.expectTimeout,
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixels: 100,
            maxDiffPixelRatio: 0.001,
        },
    },
    globalSetup: './global-setup.ci.js',
    reporter: process.env.CI
        ? [['github'], ['html', { open: 'never' }]]
        : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'chromium', use: CHROMIUM },
        ...LAYOUT_GATES,
    ],
    // The sweep runner owns and records its server process group, so Playwright
    // connects to that listener instead of starting an untracked second server.
    webServer: process.env.XCHAIN_SWEEP_EXTERNAL_SERVER === '1' ? undefined : {
        command: `pnpm -C ../../packages/web dev --port ${PORT} --strictPort --host 127.0.0.1`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        // Name the venue instead of inheriting it. This suite runs on
        // the dev-mock SDK; the real one talks to mainnet explorers no test
        // browser can reach, and when the dev server quietly started serving it
        // (Vite began pre-bundling the linked CJS SDK) every compose died on
        // "the network is unreachable" and five specs went red for a reason
        // that had nothing to do with their subject. Anything needing a real
        // compose belongs in playwright.regtest.config.js.
        env: { ...process.env, VITE_XCHAIN_REAL_SDK: '0' },
    },
});
