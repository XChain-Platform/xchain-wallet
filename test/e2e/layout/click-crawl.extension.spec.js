// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Click crawl in the MV3 extension: the built popup (or side panel) page,
// served by the extension's own service worker, in demo mode. One test per
// shard, each with its own throwaway Chromium profile, so shards never share
// a service worker or a demo wallet. Results land in
// tmp/click-crawl/extension-<surface>-<w>x<h>/<run>/ and merge with
// crawl-summary.js like the other venues. Needs a build:
//
//     pnpm -C packages/extension build

import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test } from '@playwright/test';
import { createCrawl } from './crawl.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const DIST = join(repo, 'packages', 'extension', 'dist');
const OUT_ROOT = join(repo, 'tmp', 'click-crawl');
const SHARDS = Number(process.env.CRAWL_SHARDS || 4);
const ONLY = process.env.CRAWL_ONLY ? new RegExp(process.env.CRAWL_ONLY, 'i') : null;
const RUN = process.env.CRAWL_RUN || 'run';

// The popup is the size Chrome opens it at; the side panel is a typical
// docked width at a laptop's height.
const SURFACES = {
    popup: { page: 'popup.html', size: '360x600' },
    sidepanel: { page: 'sidepanel.html', size: '400x800' },
};
const SURFACE = process.env.CRAWL_SURFACE || 'popup';
if (!SURFACES[SURFACE]) throw new Error(`CRAWL_SURFACE names no extension surface: ${SURFACE}`);
const [WIDTH, HEIGHT] = (process.env.CRAWL_SIZE || SURFACES[SURFACE].size).split('x').map(Number);

for (let shard = 0; shard < SHARDS; shard += 1) {
    test(`extension click crawl shard ${shard + 1} of ${SHARDS}`, async () => {
        test.setTimeout(3 * 60 * 60 * 1000);
        if (!existsSync(join(DIST, 'manifest.json'))) {
            throw new Error(`extension not built at ${DIST}; run: pnpm -C packages/extension build`);
        }
        const venue = `extension-${SURFACE}-${WIDTH}x${HEIGHT}`;
        // The new headless mode loads extensions, so no window opens.
        const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'xc-ext-crawl-')), {
            channel: 'chromium',
            headless: true,
            viewport: { width: WIDTH, height: HEIGHT },
            args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
        });
        try {
            let [worker] = context.serviceWorkers();
            if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
            const origin = `chrome-extension://${new URL(worker.url()).host}`;
            const page = await context.newPage();
            // The popup has no nav to go Home by, and it reopens on the last
            // view it showed, so every restart forgets that view first and
            // the reload lands on Home. The licence gate is taken the way a
            // user takes it.
            const start = async () => {
                if (page.url().startsWith(origin)) {
                    await page.evaluate(() => {
                        for (const key of Object.keys(localStorage)) {
                            if (key.startsWith('xc:lastView:')) localStorage.removeItem(key);
                        }
                    }).catch(() => {});
                }
                await page.goto(`${origin}/${SURFACES[SURFACE].page}`);
                const accept = page.getByRole('button', { name: 'Accept and continue' });
                const past = page.getByRole('button', { name: 'Try in demo mode' })
                    .or(page.getByRole('button', { name: 'Skip' }))
                    .or(page.getByRole('region', { name: 'Active address balance' }));
                await accept.or(past).first().waitFor({ state: 'visible', timeout: 60_000 });
                if (await accept.isVisible()) {
                    await page.getByRole('region', { name: 'License terms' }).or(page.getByLabel('License terms')).first()
                        .evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
                    await page.getByRole('checkbox').first().check();
                    await accept.click();
                }
            };
            const crawl = createCrawl(page, { venue, outDir: join(OUT_ROOT, venue, RUN), origin, start });
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
        } finally {
            await context.close();
        }
    });
}
