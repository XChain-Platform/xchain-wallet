// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every routed screen fits its viewport: no control sits off screen, no text
// is cut by a hidden-overflow box, no control sits below a page that cannot
// scroll, and the page never scrolls sideways. Lists and the terms text scroll
// vertically inside their own panels, and a box that opts into sideways
// scrolling inside its own width (a signature block, a tab strip) scrolls
// sideways, which the measurement allows as it allows a panel. The walk
// runs at 360x780, the LG K51 size and 1280x800 on the web dev server.

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import {
    dismissIntroCarousel, expect, test, unlockedShell,
} from '../../fixtures/wallet.js';
import { LG_K51 } from '../../fixtures/responsive.js';
import { createSweep, measureInPage } from '../../layout/sweep.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const VIEWPORTS = [
    { name: 'phone 360x780', viewport: { width: 360, height: 780 } },
    { name: 'K51 360x800', viewport: LG_K51.viewport },
    { name: 'desktop 1280x800', viewport: { width: 1280, height: 800 } },
];

/** One line per violation of the three fit keys, plus a page that scrolls sideways. */
export function fitFailures(label, result) {
    if (result.error) return [`${label}: measurement failed: ${result.error}`];
    const lines = [];
    for (const key of ['offscreen', 'clipped', 'unreachable']) {
        for (const item of result[key] || []) lines.push(`${label}: ${key} ${JSON.stringify(item)}`);
    }
    if (result.pageScrollX > 0) lines.push(`${label}: page scrolls sideways by ${result.pageScrollX}px`);
    return lines;
}

test('a control pushed off screen fails the fit check', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.setContent('<main id="xc-main"><button id="b" style="position: relative">Send</button></main>');
    expect(fitFailures('clean', await page.evaluate(measureInPage, {}))).toEqual([]);
    await page.addStyleTag({ content: '#b { position: relative; left: -200px; }' });
    const failures = fitFailures('pushed', await page.evaluate(measureInPage, {}));
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toContain('offscreen');
});

test('a box that scrolls sideways inside its own width passes and a page that scrolls sideways fails', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const longLine = 'iQEcBAEBCgAGBQJabcDEFGAAoJEHbpb1f0F0EXAMPLE/SIGNATURE/BLOCK/HERE/LONG/LINE';
    await page.setContent(`<main id="xc-main"><div style="width: 300px">
        <pre id="sig" tabindex="0" style="margin: 0; min-width: 0; max-width: 100%; box-sizing: border-box;
            overflow-x: auto; white-space: pre">${longLine}</pre></div></main>`);
    const inBox = await page.evaluate(measureInPage, {});
    expect(inBox.xScrollers.length, 'the fixture scrolls sideways inside its box').toBeGreaterThan(0);
    expect(fitFailures('in-box', inBox)).toEqual([]);
    await page.addStyleTag({ content: '#xc-main { width: 600px; }' });
    const failures = fitFailures('page', await page.evaluate(measureInPage, {}));
    expect(failures.join('\n')).toContain('page scrolls sideways');
});

for (const { name, viewport } of VIEWPORTS) {
    test(`every screen fits at ${name}`, async ({ page }) => {
        test.setTimeout(20 * 60 * 1000);
        await page.setViewportSize(viewport);
        const screens = [];
        const outDir = mkdtempSync(join(tmpdir(), 'screens-fit-'));
        const sweep = createSweep(page, {
            venue: name,
            outDir,
            screenshots: false,
            onResult: (result) => screens.push(result),
        });
        await page.goto('/');
        await sweep.measure('onboarding: intro carousel');
        await dismissIntroCarousel(page);
        await sweep.measure('onboarding: welcome');
        await page.getByRole('button', { name: 'Try in demo mode' }).click();
        await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
        await sweep.unlocked();
        expect(screens.length, 'the walk measured screens').toBeGreaterThan(10);
        const failures = screens.flatMap((s) => fitFailures(s.label, s));
        expect(failures, 'every screen fits').toEqual([]);
    });
}
