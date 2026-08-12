// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Playwright config for the MV3 EXTENSION venue (spec §8.6
// scenarios 2 and 5).
//
// These two scenarios are here rather than in the regtest web config
// because they cannot exist in the web shell: it builds one host per
// PAGE, so its reservation ledger cannot span windows, and it has no
// service worker to kill. See fixtures/extension.js.
//
// No `webServer`: the extension is the artifact, loaded unpacked. The
// build is not run here either, because a persistent context loads the
// directory at launch and a mid-run rebuild would swap it underneath a
// live profile; `global-setup.extension.js` builds ONCE, up front, and
// fails loudly if the output is missing.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.extension.spec.js',
    outputDir: './test-results-extension',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    // A race that only passes on retry is telling you the protection is
    // timing-dependent, which is exactly what these specs exist to detect.
    retries: 0,
    workers: 1,
    // Onboarding (Argon2id) happens per test in a fresh profile, and the
    // chain round trips are real.
    timeout: 300_000,
    expect: { timeout: 30_000 },
    globalSetup: './global-setup.extension.js',
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
        ...devices['Desktop Chrome'],
    },
    projects: [{ name: 'chromium-extension' }],
});
