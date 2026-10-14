// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout sweep in the Electron desktop app. Not part of the default suite.
//
//     pnpm --filter @xchain-wallet/desktop build:renderer
//     pnpm --dir test/e2e exec playwright test --config playwright.layout-desktop.config.js

import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './layout',
    testMatch: /layout-sweep\.electron\.spec\.js$/,
    outputDir: './test-results-layout-desktop',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
});
