// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout sweep venues. Not part of the default suite: the sweep reports
// findings for a person to judge rather than passing or failing.
//
//     pnpm --dir test/e2e exec playwright test --config playwright.layout.config.js
//     ... --project=iphone-17-pro          one venue only
//     LAYOUT_VENUES=android-lg-k51-large-text ...   Android 1.3 font scale
//     LAYOUT_PORT=5342 ...                  own dev server, when another tree holds 5173
//
// Sizes are the CSS viewports of real devices. The Android ones are what the
// app's WebView gets, measured on an LG K51 (720 px at density 1.75, below a
// 54 px status bar).

import { defineConfig, devices } from '@playwright/test';

// strictPort below: a busy port fails the run instead of silently measuring
// whichever tree's server already answers there.
const PORT = Number(process.env.LAYOUT_PORT) || 5173;
const BASE_URL = `http://localhost:${PORT}`;

const phone = (browserName, width, height, deviceScaleFactor) => ({
    browserName,
    viewport: { width, height },
    deviceScaleFactor,
    isMobile: browserName === 'chromium' ? true : undefined,
    hasTouch: true,
});

const VENUES = [
    { name: 'android-lg-k51', use: phone('chromium', 411, 814, 1.75) },
    {
        name: 'android-lg-k51-large-text',
        metadata: { rootFontSize: '130%' },
        use: phone('chromium', 411, 814, 1.75),
    },
    { name: 'android-small-360', use: phone('chromium', 360, 640, 2) },
    { name: 'iphone-17-pro', use: { ...devices['iPhone 15 Pro'], viewport: { width: 402, height: 874 } } },
    { name: 'iphone-se-375', use: { ...devices['iPhone SE'] } },
    { name: 'ipad-11', use: { ...devices['iPad Pro 11'] } },
];
const DEFAULT_VENUES = VENUES.filter((venue) => venue.name !== 'android-lg-k51-large-text');

export function selectVenues(value) {
    if (!value) return DEFAULT_VENUES;
    const wanted = value.split(',').map((venue) => venue.trim()).filter(Boolean);
    const selected = wanted.includes('all') ? VENUES : VENUES.filter((venue) => wanted.includes(venue.name));
    if (selected.length === 0) throw new Error(`LAYOUT_VENUES names no known venue: ${wanted.join(', ')}`);
    return selected;
}

const projects = selectVenues(process.env.LAYOUT_VENUES);

export default defineConfig({
    testDir: './layout',
    testMatch: /layout-sweep\.spec\.js$/,
    outputDir: './test-results-layout',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'off',
        video: 'off',
        screenshot: 'off',
    },
    projects,
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
