// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import {
    dismissIntroCarousel,
    gotoSection,
    unlockedShell,
} from '../../fixtures/wallet.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..', '..');
const DIST = join(repo, 'packages', 'extension', 'dist');
const WIDTH = 360;
const HEIGHT = 600;

async function enterDemo(page, origin) {
    await page.goto(`${origin}/popup.html`);

    const accept = page.getByRole('button', { name: 'Accept and continue' });
    const pastLicense = page.getByRole('button', { name: 'Try in demo mode' })
        .or(page.getByRole('button', { name: 'Skip' }))
        .or(unlockedShell(page));
    await accept.or(pastLicense).first().waitFor({ state: 'visible', timeout: 60_000 });
    if (await accept.isVisible()) {
        await page.getByRole('region', { name: 'License terms' })
            .or(page.getByLabel('License terms'))
            .first()
            .evaluate((element) => {
                element.scrollTop = element.scrollHeight;
                element.dispatchEvent(new Event('scroll'));
            });
        await page.getByRole('checkbox').first().check();
        await accept.click();
    }

    if (await unlockedShell(page).isVisible().catch(() => false)) return;
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Try in demo mode' }).click();
    await unlockedShell(page).waitFor({ state: 'visible', timeout: 120_000 });
}

async function expectPinnedPopupChrome(page, routeName) {
    const main = page.locator('#xc-main');
    const header = page.getByRole('region', { name: 'App header' });
    const bottomBar = page.getByRole('navigation', { name: 'Bottom navigation' });

    await expect(main, `${routeName} content pane`).toBeVisible();
    await expect(header, `${routeName} app header`).toBeVisible();
    await expect(bottomBar, `${routeName} bottom navigation`).toBeVisible();

    const before = await page.evaluate(() => ({
        documentHeight: document.scrollingElement.scrollHeight,
        windowHeight: window.innerHeight,
        headerTop: document.querySelector('[aria-label="App header"]').getBoundingClientRect().top,
    }));
    expect(before.windowHeight, `${routeName} popup height`).toBe(HEIGHT);
    expect(before.documentHeight, `${routeName} document must not scroll`).toBe(before.windowHeight);
    expect(before.headerTop, `${routeName} header starts at the top`).toBe(0);

    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(header, `${routeName} app header after content scroll`).toBeVisible();
    await expect(bottomBar, `${routeName} bottom navigation after content scroll`).toBeVisible();

    const after = await page.evaluate(() => {
        const content = document.getElementById('xc-main');
        const headerRect = document.querySelector('[aria-label="App header"]').getBoundingClientRect();
        const bottomRect = document.querySelector('[aria-label="Bottom navigation"]').getBoundingClientRect();
        return {
            contentScrollTop: content.scrollTop,
            contentScrollEnd: content.scrollHeight - content.clientHeight,
            documentHeight: document.scrollingElement.scrollHeight,
            windowHeight: window.innerHeight,
            headerTop: headerRect.top,
            bottomTop: bottomRect.top,
            bottomEdge: bottomRect.bottom,
        };
    });

    expect(after.contentScrollTop, `${routeName} content reaches its scroll end`)
        .toBe(after.contentScrollEnd);
    expect(after.documentHeight, `${routeName} document stays fixed after content scroll`)
        .toBe(after.windowHeight);
    expect(after.headerTop, `${routeName} header stays at the top`).toBe(0);
    expect(after.bottomTop, `${routeName} bottom navigation stays in the viewport`)
        .toBeGreaterThanOrEqual(0);
    expect(after.bottomEdge, `${routeName} bottom navigation stays in the viewport`)
        .toBeLessThanOrEqual(after.windowHeight);
}

test('popup keeps route scrolling between pinned header and tabs', async () => {
    test.setTimeout(5 * 60 * 1000);
    if (!existsSync(join(DIST, 'manifest.json'))) {
        throw new Error(`extension not built at ${DIST}; run: pnpm -C packages/extension build`);
    }

    const userDataDir = mkdtempSync(join(tmpdir(), 'xc-ext-popup-height-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
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
        await enterDemo(page, origin);

        for (const routeName of ['Home', 'Send', 'Receive', 'History', 'Settings']) {
            await test.step(routeName, async () => {
                await gotoSection(page, routeName);
                await page.getByRole('heading', { name: routeName, exact: true }).first()
                    .waitFor({ state: 'visible' });
                await expectPinnedPopupChrome(page, routeName);
            });
        }
    } finally {
        await context.close();
        rmSync(userDataDir, { recursive: true, force: true });
    }
});
