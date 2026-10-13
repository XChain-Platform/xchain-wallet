// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from '@playwright/test';

const VIEWPORTS = [360, 768, 1280];
const THEMES = ['light', 'dark'];

async function settleStyleGuide(page) {
    await expect(page.getByRole('heading', {
        level: 1,
        name: /XChain Wallet Component Style Guide/,
    })).toBeVisible();

    await page.waitForFunction(() => {
        const frames = [...document.querySelectorAll('iframe')];
        return frames.length > 0
            && frames.every((frame) => frame.contentDocument?.body?.dataset.sgReady === '1');
    });

    await page.evaluate(async () => {
        const documents = [
            document,
            ...[...document.querySelectorAll('iframe')]
                .map((frame) => frame.contentDocument)
                .filter(Boolean),
        ];
        await Promise.all(documents.map((doc) => doc.fonts?.ready));
        await Promise.all(documents.flatMap((doc) => (
            [...doc.images].map((image) => image.decode().catch(() => {}))
        )));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
}

for (const theme of THEMES) {
    for (const width of VIEWPORTS) {
        test.describe(`${theme} theme at ${width}px`, () => {
            test.use({
                colorScheme: theme,
                reducedMotion: 'reduce',
                viewport: { width, height: 900 },
            });

            test('matches the style guide snapshot', async ({ page }) => {
                await page.goto('/style-guide/');
                await settleStyleGuide(page);
                expect(await page.evaluate((scheme) => (
                    window.matchMedia(`(prefers-color-scheme: ${scheme})`).matches
                ), theme)).toBe(true);
                expect(await page.evaluate(() => (
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ))).toBe(true);

                await expect(page).toHaveScreenshot(`style-guide-${theme}-${width}.png`, {
                    fullPage: true,
                });
            });
        });
    }
}
