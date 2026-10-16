// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout sweep in the browser venues: one run per project in
// playwright.layout.config.js (Chromium at Android phone sizes, WebKit at
// iPhone and iPad sizes). Results land in tmp/layout-sweep/<project>/.
// LAYOUT_SCHEME=dark (see the config) runs the same walk in the dark palette,
// adds the contrast and light-surface measurements, and writes to
// tmp/dark-sweep/<project>/ instead.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../fixtures/wallet.js';
import { createSweep, layoutSweepFailures, measureInPage } from './sweep.js';

const DARK = process.env.LAYOUT_SCHEME === 'dark';
const OUT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'tmp', DARK ? 'dark-sweep' : 'layout-sweep');

test('layout gutter assertion contract', () => {
    const layout = (gutter, kind = 'list', topGap = 16) => ({
        contentLeft: gutter,
        contentRightGap: gutter,
        headerLeft: gutter,
        first: { kind, left: gutter, rightGap: gutter, topGap },
    });
    expect(layoutSweepFailures([
        { label: 'scaled', vw: 411, layout: layout(12), rootFontPx: 24, expectedRootFontPx: 24 },
        { label: 'lost scale', vw: 411, layout: layout(12), rootFontPx: 16, expectedRootFontPx: 24 },
        { label: 'unread', vw: 411, layout: layout(12), expectedRootFontPx: 20.8 },
    ])).toEqual([
        'lost scale: root font size 16px, expected 24px',
        'unread: root font size unread, expected 20.8px',
    ]);
    // One 12px page gutter at every width.
    expect(layoutSweepFailures([
        { label: 'compact', vw: 639, layout: layout(12) },
        { label: 'rail', vw: 834, layout: layout(12) },
        { label: 'full', vw: 1280, layout: layout(12) },
    ])).toEqual([]);
    expect(layoutSweepFailures([
        { label: 'old rail gutter', vw: 834, layout: layout(16) },
    ])).toEqual([
        'old rail gutter: content left 16px, expected 12px',
        'old rail gutter: header left 16px, expected 12px',
        'old rail gutter: first content left 16px, expected 12px',
    ]);
    // A wide step that centres its column passes; one pushed off-centre does not.
    const column = (left, rightGap) => ({
        contentLeft: 12, contentRightGap: 12, headerLeft: null, first: { kind: 'list', left, rightGap, topGap: 12 },
    });
    expect(layoutSweepFailures([
        { label: 'centred', vw: 834, layout: column(177, 177) },
        { label: 'off centre', vw: 834, layout: column(177, 60) },
        { label: 'narrow centred', vw: 411, layout: column(40, 40) },
    ])).toEqual([
        'off centre: first content left 177px, expected 12px',
        'narrow centred: first content left 40px, expected 12px',
    ]);
    expect(layoutSweepFailures([
        {
            label: 'activity',
            vw: 768,
            layout: {
                contentLeft: 12,
                contentRightGap: 9,
                headerLeft: 18,
                first: { kind: 'list', left: 9, rightGap: 8, topGap: 12 },
            },
        },
        {
            label: 'send',
            vw: 768,
            layout: {
                contentLeft: 12,
                contentRightGap: 12,
                headerLeft: 12,
                first: { kind: 'form', left: 104, rightGap: 104, topGap: 16 },
            },
        },
    ])).toEqual([
        'activity: content right gap 9px, expected at least 12px',
        'activity: header left 18px, expected 12px',
        'activity: first content left 9px, expected 12px',
        'activity: first content right gap 8px, expected at least 12px',
        'form top gaps [16] do not match list top gaps [12]',
    ]);
});

test('top gaps compare form and list only inside one shell', () => {
    const layout = (kind, topGap, tier) => ({
        contentLeft: 12,
        contentRightGap: 12,
        headerLeft: 12,
        tier,
        first: { kind, left: 12, rightGap: 12, topGap },
    });
    // Onboarding sits outside the sidebar layout, which adds its own top gap.
    expect(layoutSweepFailures([
        { label: 'onboarding', vw: 834, layout: layout('form', 12, null) },
        { label: 'nav', vw: 834, layout: layout('list', 16, 'full') },
    ])).toEqual([]);
    expect(layoutSweepFailures([
        { label: 'form', vw: 834, layout: layout('form', 12, 'full') },
        { label: 'nav', vw: 834, layout: layout('list', 16, 'full') },
    ])).toEqual(['form top gaps [12] do not match list top gaps [16]']);
});

test('clip measurement skips text nobody can see', async ({ page, browserName }) => {
    await page.setContent(`
        <style>
            .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
            input { width: 120px; font: 16px monospace; }
            .cut { display: block; width: 60px; overflow: hidden; white-space: nowrap; }
        </style>
        <span class="sr-only">Screen reader text far wider than one pixel</span>
        <input aria-label="hidden address" readonly style="color: transparent" value="bc1qhiddenvaluefarwiderthanitsfield0000000">
        <input aria-label="shown address" readonly value="bc1qshownvaluefarwiderthanitsfield00000000">
        <span class="cut">Visible text cut by its own box</span>
    `);
    const { clipped } = await page.evaluate(measureInPage, {});
    // WebKit does not report an input's text overflow, so only Chromium
    // can show the visible address being caught.
    expect(clipped.map(({ el }) => el)).toEqual([
        ...(browserName === 'chromium' ? ['input "shown address"'] : []),
        'span.cut "Visible text cut by its own box"',
    ]);
});

test('overlap measurement reports controls drawn over each other, not overlays', async ({ page }) => {
    await page.setContent(`
        <style>
            body { margin: 0; }
            button { position: absolute; top: 10px; height: 40px; width: 80px; }
            .sheet { position: fixed; inset: 100px 0 0 0; background: white; }
            .scroller { position: fixed; top: 60px; left: 300px; width: 200px; height: 300px; overflow-y: auto; }
            .scroller > div { position: relative; height: 900px; }
            .bar { position: fixed; top: 330px; left: 300px; width: 200px; height: 40px; background: white; }
        </style>
        <button style="left: 10px">Contacts</button>
        <button style="left: 60px">Paste</button>
        <button style="left: 200px">Apart</button>
        <button style="left: 10px; top: 60px; width: 200px; height: 30px">Row</button>
        <button style="left: 170px; top: 63px; width: 24px; height: 24px">Row action</button>
        <button style="left: 10px; top: 150px">Under the sheet</button>
        <div class="sheet"><button style="left: 20px; top: 40px">On the sheet</button></div>
        <div class="scroller"><div><button style="left: 10px; top: 240px">Row passing under the bar</button></div></div>
        <div class="bar"><button style="left: 10px; top: 0">Nav</button></div>
    `);
    const { overlaps } = await page.evaluate(measureInPage, {});
    expect(overlaps).toEqual([{ el: 'button "Contacts"', with: 'button "Paste"', w: 30, h: 40 }]);
});

test('layout sweep', async ({ page }, testInfo) => {
    test.setTimeout(45 * 60 * 1000);
    const venue = testInfo.project.name;
    const screens = [];
    const sweep = createSweep(page, {
        venue,
        outDir: join(OUT_ROOT, venue),
        fontScale: testInfo.project.metadata?.fontScale,
        contrast: DARK,
        onResult: (result) => screens.push(result),
    });
    await sweep.onboarding();
    await sweep.unlocked();
    expect(layoutSweepFailures(screens), 'every measured route follows the page gutter contract').toEqual([]);
});
