// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Playwright config — §52.4.
//
// Drives the web SPA (`packages/web`) via Vite's dev server. Specs
// assume a fresh browser context per test (Playwright's default), so
// IndexedDB + localStorage state don't leak between cases.
//
// Each spec test runs serial by default via `workers: 1` — the harness
// talks to a single shared vault through the SPA's in-page host, and
// IDB state inside one browser context isn't easy to reset between
// tests without reloading the tab. One worker + one tab + one IDB =
// linear, easy-to-reason-about runs.
//
// The `webServer` spawns `pnpm -C packages/web dev`. On CI this gets
// the `CI=1` + `reuseExistingServer: false` path so each job starts
// from a clean port. Locally we reuse if already running.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    outputDir: './test-results',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    timeout: 120_000,       // Argon2id KDF on CI runners can take several seconds
    expect: { timeout: 15_000 },
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
        // Path is relative to this config file. test/e2e/ → wallet root
        // is two up; from there cd into packages/web for the dev server.
        command: 'pnpm -C ../../packages/web dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
