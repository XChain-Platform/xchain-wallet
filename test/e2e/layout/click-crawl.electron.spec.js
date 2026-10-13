// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Click crawl in the desktop app: the real Electron shell, in demo mode.
// One test per shard, each with its own app and its own throwaway
// --user-data-dir, plus Chromium's mock keychain so no run reads or writes
// the macOS Keychain item a real install keeps its session key in.
// Results land in tmp/click-crawl/macos-desktop-<w>x<h>/<run>/ and merge
// with crawl-summary.js like the browser venues. Needs a renderer build:
//
//     pnpm --filter @xchain-wallet/desktop build:renderer

import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, _electron as electron } from '@playwright/test';
import { createCrawl } from './crawl.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const desktopDir = join(repo, 'packages', 'desktop');
const OUT_ROOT = join(repo, 'tmp', 'click-crawl');
const SHARDS = Number(process.env.CRAWL_SHARDS || 4);
const ONLY = process.env.CRAWL_ONLY ? new RegExp(process.env.CRAWL_ONLY, 'i') : null;
const RUN = process.env.CRAWL_RUN || 'run';
const [WIDTH, HEIGHT] = (process.env.CRAWL_SIZE || '1280x800').split('x').map(Number);

for (let shard = 0; shard < SHARDS; shard += 1) {
    test(`desktop click crawl shard ${shard + 1} of ${SHARDS}`, async () => {
        test.setTimeout(3 * 60 * 60 * 1000);
        const venue = `macos-desktop-${WIDTH}x${HEIGHT}`;
        const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));
        const app = await electron.launch({
            executablePath: requireFromDesktop('electron'),
            args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'xc-click-crawl-'))}`, '--use-mock-keychain'],
            cwd: desktopDir,
        });
        try {
            const page = await app.firstWindow();
            await app.evaluate(({ BrowserWindow }, [w, h]) => {
                BrowserWindow.getAllWindows()[0].setContentSize(w, h);
            }, [WIDTH, HEIGHT]);
            const origin = new URL(page.url()).origin;
            // No fixture seeds the licence acceptance here, so take the gate
            // the way a user does whenever a reload brings it back.
            const start = async () => {
                await page.reload();
                const accept = page.getByRole('button', { name: 'Accept and continue' });
                const past = page.getByRole('button', { name: 'Try in demo mode' })
                    .or(page.getByRole('button', { name: 'Skip' }))
                    .or(page.getByRole('navigation').first());
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
            await app.close();
        }
    });
}
