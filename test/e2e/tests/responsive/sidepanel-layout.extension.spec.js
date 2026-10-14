// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import {
    dismissIntroCarousel,
    gotoSection,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { EXTENSION_DIST } from '../../fixtures/extension.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const VIEWPORTS = [
    { width: 400, height: 800 },
    { width: 360, height: 600 },
];
const ROUTES = ['Home', 'Receive', 'Send', 'History', 'Settings'];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectRoute(page, route) {
    if (route === 'Home') {
        await expect(unlockedShell(page)).toBeVisible();
        return;
    }
    // The title lives in the app header, not in the main region.
    await expect(page.getByRole('heading', { name: route, exact: true }).first())
        .toBeVisible();
}

async function expectNoHorizontalOverflow(page, label) {
    const width = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll, `${label} scrolls horizontally: ${width.scroll}px in ${width.client}px`)
        .toBeLessThanOrEqual(width.client + 1);
}

async function rowGeometry(locator) {
    return locator.evaluate((element) => {
        const children = [...element.children].filter((child) => {
            const rect = child.getBoundingClientRect();
            const style = getComputedStyle(child);
            return rect.width > 0 && rect.height > 0
                && style.display !== 'none' && style.visibility !== 'hidden';
        });
        const rects = children.map((child) => child.getBoundingClientRect());
        return {
            childCount: rects.length,
            commonTop: Math.max(...rects.map((rect) => rect.top)),
            commonBottom: Math.min(...rects.map((rect) => rect.bottom)),
        };
    });
}

async function expectSingleRowHeader(page, label) {
    const header = page.getByRole('region', { name: 'App header' });
    await expect(header).toBeVisible();
    const row = await rowGeometry(header);
    expect(row.childCount, `${label} header has no visible columns`).toBeGreaterThan(1);
    expect(row.commonTop, `${label} header columns wrap onto separate rows`)
        .toBeLessThan(row.commonBottom);
}

async function expectReachabilityNoticePlacement(page, label) {
    const notice = page.getByRole('status').filter({
        hasText: /Wallet is offline|Some wallet information is unavailable/,
    }).first();
    if (!await notice.isVisible().catch(() => false)) return;

    const header = page.getByRole('region', { name: 'App header' });
    const [headerBox, noticeBox, row] = await Promise.all([
        header.boundingBox(),
        notice.boundingBox(),
        rowGeometry(notice),
    ]);
    expect(headerBox, `${label} header has no layout box`).not.toBeNull();
    expect(noticeBox, `${label} reachability notice has no layout box`).not.toBeNull();
    expect(noticeBox.y, `${label} reachability notice must sit below the header`)
        .toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
    expect(row.childCount, `${label} reachability notice has no visible content`)
        .toBeGreaterThan(1);
    expect(row.commonTop, `${label} reachability notice wraps onto separate rows`)
        .toBeLessThan(row.commonBottom);
}

async function expectInsideViewport(locator, label) {
    const box = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: document.documentElement.clientWidth,
            height: document.documentElement.clientHeight,
        };
    });
    expect(box.left, `${label} extends past the left edge`).toBeGreaterThanOrEqual(-1);
    expect(box.top, `${label} extends past the top edge`).toBeGreaterThanOrEqual(-1);
    expect(box.right, `${label} extends past the right edge`).toBeLessThanOrEqual(box.width + 1);
    expect(box.bottom, `${label} extends past the bottom edge`).toBeLessThanOrEqual(box.height + 1);
}

async function expectReceiveContentFits(page, label) {
    const qr = page.locator('img[alt^="QR code for "]').first();
    await expect(qr).toBeVisible();
    const addressValue = (await qr.getAttribute('alt')).slice('QR code for '.length);
    const address = page.getByRole('main').locator('input[readonly][title]').first();
    await expect(address).toBeVisible();
    await expect(address).toHaveValue(addressValue);
    await address.scrollIntoViewIfNeeded();
    await settle(page);
    await expectInsideViewport(qr, `${label} Receive QR`);
    await expectInsideViewport(address, `${label} Receive address`);
}

test('side panel fits primary routes at narrow extension sizes', async () => {
    test.setTimeout(300_000);
    if (!existsSync(join(EXTENSION_DIST, 'manifest.json'))) {
        throw new Error(`Extension not built at ${EXTENSION_DIST}. Run: pnpm -C packages/extension build`);
    }

    const userDataDir = mkdtempSync(join(tmpdir(), 'xc-ext-sidepanel-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        viewport: VIEWPORTS[0],
        args: [
            `--disable-extensions-except=${EXTENSION_DIST}`,
            `--load-extension=${EXTENSION_DIST}`,
        ],
    });

    try {
        let [worker] = context.serviceWorkers();
        if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
        const origin = `chrome-extension://${new URL(worker.url()).host}`;
        const page = await context.newPage();
        // The panel renders only when its active tab answers the content
        // probe, and here that tab is the panel itself.
        await page.addInitScript(() => {
            const tabs = globalThis.chrome?.tabs;
            if (tabs) tabs.sendMessage = (_id, _msg, cb) => { if (typeof cb === 'function') cb({ available: true }); };
        });
        await page.goto(`${origin}/sidepanel.html`);

        const accept = page.getByRole('button', { name: 'Accept and continue' });
        const ready = page.getByRole('button', { name: 'Try in demo mode' })
            .or(page.getByRole('button', { name: 'Skip' }))
            .or(unlockedShell(page));
        await accept.or(ready).first().waitFor({ state: 'visible', timeout: 60_000 });
        if (await accept.isVisible()) {
            await page.getByRole('region', { name: 'License terms' })
                .or(page.getByLabel('License terms')).first()
                .evaluate((element) => {
                    element.scrollTop = element.scrollHeight;
                    element.dispatchEvent(new Event('scroll'));
                });
            await page.getByRole('checkbox').first().check();
            await accept.click();
        }

        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Try in demo mode' }).click();
        await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });

        for (const viewport of VIEWPORTS) {
            const viewportLabel = `${viewport.width}x${viewport.height}`;
            await page.setViewportSize(viewport);
            await settle(page);

            for (const route of ROUTES) {
                await test.step(`${viewportLabel} ${route}`, async () => {
                    await gotoSection(page, route);
                    await expectRoute(page, route);
                    await settle(page);
                    await expectNoHorizontalOverflow(page, `${viewportLabel} ${route}`);
                    await expectSingleRowHeader(page, viewportLabel);
                    await expectReachabilityNoticePlacement(page, viewportLabel);
                    if (route === 'Receive') {
                        await expectReceiveContentFits(page, viewportLabel);
                    }
                });
            }
        }
    } finally {
        await context.close();
        rmSync(userDataDir, { recursive: true, force: true });
    }
});
