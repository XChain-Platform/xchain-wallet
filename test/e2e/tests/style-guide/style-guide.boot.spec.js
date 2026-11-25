// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from '@playwright/test';

const VIEWS = ['mobile', 'extension', 'desktop'];

// Tracing injects Playwright's snapshot script into every frame, and Chrome
// blocks it in the guide's script-free sandboxed previews and logs each block
// as a console error, so a recorded run would fail on the harness, not the page.
test.use({ trace: 'off' });

for (const view of VIEWS) {
    test(`${view} style guide boots without errors or remote requests`, async ({ page }, testInfo) => {
        const errors = [];
        const remoteRequests = [];
        const localOrigin = new URL('/', testInfo.project.use.baseURL).origin;

        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
        });
        page.on('pageerror', (error) => errors.push(String(error)));
        page.on('request', (request) => {
            const url = new URL(request.url());
            if (url.origin !== localOrigin) remoteRequests.push(url.href);
        });

        await page.goto(`/style-guide/?view=${view}`);
        await expect(page.getByRole('heading', {
            level: 1,
            name: /XChain Wallet Component Style Guide/,
        })).toBeVisible();
        await expect.poll(async () => page.locator('iframe').evaluateAll(
            (frames) => frames.length > 0 && frames.every(
                (frame) => frame.contentDocument?.body?.dataset.sgReady === '1',
            ),
        )).toBe(true);
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));

        expect(errors).toEqual([]);
        expect(remoteRequests).toEqual([]);
    });
}
