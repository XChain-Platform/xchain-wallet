// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Click crawl in a demo wallet (see crawl.js). One test per shard; every
// shard discovers the same screen list and crawls every CRAWL_SHARDS-th
// screen of it. Results land in tmp/click-crawl/<project>/<run>/, and
// `node test/e2e/layout/crawl-summary.js <that dir>` merges the shards
// into findings.json and summary.md.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '../fixtures/wallet.js';
import { createCrawl } from './crawl.js';

const OUT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'tmp', 'click-crawl');
const SHARDS = Number(process.env.CRAWL_SHARDS || 4);
const ONLY = process.env.CRAWL_ONLY ? new RegExp(process.env.CRAWL_ONLY, 'i') : null;
const RUN = process.env.CRAWL_RUN || 'run';

for (let shard = 0; shard < SHARDS; shard += 1) {
    test(`click crawl shard ${shard + 1} of ${SHARDS}`, async ({ page, baseURL }, testInfo) => {
        test.setTimeout(3 * 60 * 60 * 1000);
        const venue = testInfo.project.name;
        const crawl = createCrawl(page, { venue, outDir: join(OUT_ROOT, venue, RUN), origin: baseURL });
        await crawl.enterDemo();
        let screens = await crawl.discover();
        if (ONLY) screens = screens.filter((s) => ONLY.test(s.label));
        const mine = screens.filter((_, i) => i % SHARDS === shard);
        try {
            for (const screen of mine) {
                await crawl.crawlScreen(screen);
                crawl.write(`shard-${shard + 1}`);
            }
        } finally {
            crawl.write(`shard-${shard + 1}`);
        }
    });
}
