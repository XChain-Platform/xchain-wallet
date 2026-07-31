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
// The `webServer` spawns `pnpm -C packages/web dev`. On CI this gets
// the `CI=1` + `reuseExistingServer: false` path so each job starts
// from a clean port. Locally we reuse if already running.
//
// : the timeouts are NOT constants. This suite shares a machine
// with whatever else is on it, and on a busy one it used to fail a
// different spec each run while every one of them passed in isolation.
// `timeout-budget.js` sizes the budget from the measured load; see its
// header for why a single number could not be right for both an idle and
// a contended box. Pin `PW_TIMEOUT_SCALE=1` to reproduce the old numbers.

import { defineConfig, devices } from '@playwright/test';

import { describeBudget, timeoutBudget } from './timeout-budget.js';

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
    testIgnore: ['**/*.regtest.spec.js', '**/*.extension.spec.js'],
    outputDir: './test-results',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    // Argon2id KDF on CI runners can take several seconds, and an on-demand
    // Vite transform on a loaded box costs several more. Both scale with
    // contention, so both budgets do too.
    timeout: budget.timeout,
    expect: { timeout: budget.expectTimeout },
    reporter: process.env.CI
        ? [['github'], ['html', { open: 'never' }]]
        : 'list',
    use: {
        baseURL: 'http://localhost:5173',
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
        command: 'pnpm -C ../../packages/web dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        // : name the venue instead of inheriting it. This suite runs on
        // the dev-mock SDK; the real one talks to mainnet explorers no test
        // browser can reach, and when the dev server quietly started serving it
        // (Vite began pre-bundling the linked CJS SDK) every compose died on
        // "the network is unreachable" and five specs went red for a reason
        // that had nothing to do with their subject. Anything needing a real
        // compose belongs in playwright.regtest.config.js.
        env: { ...process.env, VITE_XCHAIN_REAL_SDK: '0' },
    },
});
