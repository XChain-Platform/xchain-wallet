// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Click crawl venue. Not part of the default suite: like the layout sweep,
// the crawl reports findings for a person to judge rather than failing.
//
//     pnpm --dir test/e2e exec playwright test --config playwright.crawl.config.js
//     CRAWL_SHARDS=1 ... --workers=1        one shard, for a quick look
//     CRAWL_ONLY="Settings|Send" ...        only screens whose label matches
//     CRAWL_VENUES=iphone-17-pro,iphone-se-375 ...   WebKit iPhone venues (or all)
//
// The screen list is split across CRAWL_SHARDS tests (default 4) that run in
// parallel, each in its own browser context with its own demo wallet.
//
// The dev server gets its own port, so a crawl never reuses a server another
// worktree started on Vite's default port and silently tests that tree.

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.CRAWL_PORT || 5191);
const SHARDS = Number(process.env.CRAWL_SHARDS || 4);

// Venues. The K51 in Chromium is the default; the WebKit iPhone venues are
// opt-in through CRAWL_VENUES (comma-separated names, or "all"), sized as the
// layout sweep sizes them. WebKit takes neither the Chromium fake-camera flags
// nor the clipboard permissions, so those stay on the Chromium venue only.
const VENUES = [
    {
        name: 'android-lg-k51',
        use: {
            browserName: 'chromium',
            viewport: { width: 411, height: 814 },
            deviceScaleFactor: 1.75,
            isMobile: true,
            hasTouch: true,
            permissions: ['clipboard-read', 'clipboard-write'],
            launchOptions: {
                // A camera that exists and is granted, so scanner buttons are
                // judged on what they do rather than on a missing device.
                args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
            },
        },
    },
    { name: 'iphone-17-pro', use: { ...devices['iPhone 15 Pro'], viewport: { width: 402, height: 874 } } },
    { name: 'iphone-se-375', use: { ...devices['iPhone SE'] } },
];
const WANTED = (process.env.CRAWL_VENUES || 'android-lg-k51').split(',').map((v) => v.trim()).filter(Boolean);
const projects = WANTED.includes('all') ? VENUES : VENUES.filter((v) => WANTED.includes(v.name));
if (projects.length === 0) throw new Error(`CRAWL_VENUES names no known venue: ${WANTED.join(', ')}`);

// One output folder per run, shared by every shard: workers inherit the
// runner's environment, so the stamp is set once here and read there.
if (!process.env.CRAWL_RUN) process.env.CRAWL_RUN = new Date().toISOString().replace(/[:.]/g, '-');

export default defineConfig({
    testDir: './layout',
    testMatch: /click-crawl\.spec\.js$/,
    outputDir: './test-results-crawl',
    fullyParallel: true,
    workers: SHARDS,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'off',
        video: 'off',
        screenshot: 'off',
        acceptDownloads: true,
    },
    projects,
    webServer: {
        command: `pnpm -C ../../packages/web exec vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, VITE_XCHAIN_REAL_SDK: '0' },
    },
});
