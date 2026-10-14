// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Click crawl in the Electron desktop app. Not part of the default suite.
//
//     pnpm --filter @xchain-wallet/desktop build:renderer
//     CRAWL_SHARDS=4 CRAWL_SIZE=1280x800 pnpm --dir test/e2e exec playwright test --config playwright.crawl-desktop.config.js
//     node test/e2e/layout/crawl-summary.js tmp/click-crawl/macos-desktop-1280x800/<run>

import { defineConfig } from '@playwright/test';

const SHARDS = Number(process.env.CRAWL_SHARDS || 4);

// One output folder per run, shared by every shard (see playwright.crawl.config.js).
if (!process.env.CRAWL_RUN) process.env.CRAWL_RUN = new Date().toISOString().replace(/[:.]/g, '-');

export default defineConfig({
    testDir: './layout',
    testMatch: /click-crawl\.electron\.spec\.js$/,
    outputDir: './test-results-crawl-desktop',
    fullyParallel: true,
    workers: SHARDS,
    retries: 0,
    reporter: 'list',
});
