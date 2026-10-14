// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));
const extensionDist = resolve(here, '..', '..', '..', '..', 'packages', 'extension', 'dist');
const popupViewport = { width: 360, height: 600 };

async function expectFullyInsideViewport(control, name) {
    await expect(control).toBeVisible();
    const bounds = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        };
    });

    expect(bounds.left, `${name} extends past the left viewport edge`).toBeGreaterThanOrEqual(0);
    expect(bounds.top, `${name} extends past the top viewport edge`).toBeGreaterThanOrEqual(0);
    expect(bounds.right, `${name} extends past the right viewport edge`)
        .toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.bottom, `${name} extends past the bottom viewport edge`)
        .toBeLessThanOrEqual(bounds.viewportHeight);
}

test('popup keeps onboarding actions and bottom navigation labels visible', async () => {
    test.setTimeout(300_000);
    if (!existsSync(join(extensionDist, 'manifest.json'))) {
        throw new Error(
            `Extension not built at ${extensionDist}. Run: pnpm -C packages/extension build`,
        );
    }

    const userDataDir = mkdtempSync(join(tmpdir(), 'xc-ext-popup-actions-'));
    let context;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            channel: 'chromium',
            headless: true,
            viewport: popupViewport,
            args: [
                `--disable-extensions-except=${extensionDist}`,
                `--load-extension=${extensionDist}`,
            ],
        });

        let [worker] = context.serviceWorkers();
        if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
        const extensionId = new URL(worker.url()).host;
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/popup.html`);

        const accept = page.getByRole('button', { name: 'Accept and continue' });
        await expectFullyInsideViewport(accept, 'Accept and continue');

        const terms = page.getByLabel('License terms');
        await terms.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            element.dispatchEvent(new Event('scroll'));
        });
        await page.getByRole('checkbox').check();
        await expect(accept).toBeEnabled();
        await accept.click();

        const getStarted = page.getByRole('button', { name: 'Get started' });
        for (let step = 0; step < 10 && !(await getStarted.isVisible()); step += 1) {
            await page.getByRole('button', { name: 'Next' }).click();
        }
        await expectFullyInsideViewport(getStarted, 'Get started');
        await getStarted.click();

        await page.getByRole('button', { name: 'Try in demo mode' }).click();
        const bottomNavigation = page.getByRole('navigation', { name: 'Bottom navigation' });
        await expect(bottomNavigation).toBeVisible({ timeout: 120_000 });

        const expectedLabels = ['Home', 'History', 'Send', 'Scan', 'More'];
        const items = bottomNavigation.locator('[data-bottom-tab]');
        await expect(items).toHaveCount(expectedLabels.length);
        await expect(items).toHaveText(expectedLabels);
        for (const label of expectedLabels) {
            await expect(bottomNavigation.getByText(label, { exact: true })).toBeVisible();
        }
    } finally {
        await context?.close();
        rmSync(userDataDir, { recursive: true, force: true });
    }
});
