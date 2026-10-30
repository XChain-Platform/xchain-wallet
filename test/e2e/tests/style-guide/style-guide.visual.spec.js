// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Visual guard for the component style guide. The page is about 155,000 px
// tall with a couple of hundred iframes, so one full-page shot is blank,
// unstable and times out. Each section (`section.sg-section`, id from the
// SECTIONS list) is screenshotted on its own instead, so a visual change
// fails the one section it touches and names it in the report.
//
// Baselines are per platform (generate them on Linux). A theme and width with
// no baseline on this platform skips, because Playwright would write the
// actual image and fail, which checks nothing. `--update-snapshots=all` is how
// a baseline set is made.

import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';

const VIEWPORTS = [360, 1280];
const THEMES = ['light', 'dark'];

// The guide's own preview-width bar is sticky and would cover the top of a
// section shot; it is not part of any section.
const STABILIZE_CSS = `
    .sg-sticky { visibility: hidden !important; }
    *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
    }
`;

function hasBaselines(testInfo, theme, width) {
    const dir = dirname(testInfo.snapshotPath('probe.png'));
    if (!existsSync(dir)) return false;
    const pattern = new RegExp(`-${theme}-${width}(-[^/]*)?-${process.platform}\\.png$`);
    return readdirSync(dir).some((name) => pattern.test(name));
}

// Resolves once every frame inside the section has mounted its content, the
// fonts of the page and of each frame are loaded, images are decoded, and the
// section's height has stopped moving for several polls in a row. Polls use
// timers, never animation frames, and every wait is bounded, so a stalled
// renderer fails with the section's name instead of hanging the test.
async function settleSection(section) {
    await section.evaluate(async (el) => {
        el.scrollIntoView({ block: 'start', behavior: 'instant' });
        const frames = () => [...el.querySelectorAll('iframe')];
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const bounded = (promise, ms = 20_000) => Promise.race([promise, sleep(ms)]);
        const deadline = Date.now() + 60_000;
        const ready = () => frames().every((frame) => frame.contentDocument?.body?.dataset.sgReady === '1');
        while (!ready()) {
            if (Date.now() > deadline) throw new Error(`frames never became ready in #${el.id}`);
            await sleep(50);
        }
        await bounded(Promise.all([
            document.fonts?.ready,
            ...frames().map((frame) => frame.contentDocument?.fonts?.ready),
        ]));
        await bounded(Promise.all([
            ...el.querySelectorAll('img'),
            ...frames().flatMap((frame) => [...(frame.contentDocument?.images || [])]),
        ].map((image) => image.decode().catch(() => {}))));
        let last = -1;
        let steady = 0;
        while (steady < 15) {
            if (Date.now() > deadline) throw new Error(`#${el.id} height never settled`);
            await sleep(40);
            const height = el.getBoundingClientRect().height;
            steady = height === last ? steady + 1 : 0;
            last = height;
        }
    });
}

for (const theme of THEMES) {
    for (const width of VIEWPORTS) {
        test.describe(`${theme} theme at ${width}px`, () => {
            test.use({
                colorScheme: theme,
                // Playwright 1.59.1 has no reducedMotion fixture, so the media
                // emulation goes through the browser context options.
                contextOptions: { reducedMotion: 'reduce' },
                viewport: { width, height: 900 },
            });

            test('every section matches its snapshot', async ({ page }, testInfo) => {
                test.skip(
                    !hasBaselines(testInfo, theme, width) && testInfo.config.updateSnapshots !== 'all',
                    `no committed ${process.platform} baselines for ${theme} at ${width}px`,
                );
                // About sixty sections, each settled and shot twice by Playwright's
                // own stability check.
                test.setTimeout(45 * 60_000);

                await page.goto('/style-guide/');
                await expect(page.getByRole('heading', {
                    level: 1,
                    name: /XChain Wallet Component Style Guide/,
                })).toBeVisible();
                await page.addStyleTag({ content: STABILIZE_CSS });
                expect(await page.evaluate((scheme) => (
                    window.matchMedia(`(prefers-color-scheme: ${scheme})`).matches
                ), theme)).toBe(true);
                expect(await page.evaluate(() => (
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ))).toBe(true);

                const ids = await page.locator('section.sg-section').evaluateAll(
                    (nodes) => nodes.map((node) => node.id),
                );
                expect(ids.length).toBeGreaterThan(40);

                for (const id of ids) {
                    const section = page.locator(`section.sg-section#${id}`);
                    await settleSection(section);
                    await expect.soft(section, `section ${id}`).toHaveScreenshot(
                        `section-${id}-${theme}-${width}.png`,
                    );
                }
            });
        });
    }
}
