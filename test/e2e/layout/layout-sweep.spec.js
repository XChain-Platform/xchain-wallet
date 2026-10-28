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
import {
    GUTTER_CONTRACT_KEYS, createSweep, layoutSweepFailures, layoutSweepFindings, measureHeaderPinned, measureInPage,
    measureRulings, pageGutterForWidth,
} from './sweep.js';

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
    // The tiered page gutter: 12px below 640px, 16px from 640px, 24px from 900px.
    expect(layoutSweepFailures([
        { label: 'compact', vw: 639, layout: layout(12) },
        { label: 'rail', vw: 834, layout: layout(16) },
        { label: 'full', vw: 1280, layout: layout(24) },
    ])).toEqual([]);
    expect(layoutSweepFailures([
        { label: 'compact gutter on rail', vw: 834, layout: layout(12) },
    ])).toEqual([
        'compact gutter on rail: content left 12px, expected 16px',
        'compact gutter on rail: content right gap 12px, expected at least 16px',
        'compact gutter on rail: header left 12px, expected 16px',
        'compact gutter on rail: first content left 12px, expected 16px',
        'compact gutter on rail: first content right gap 12px, expected at least 16px',
    ]);
    // A wide step that centres its column passes; one pushed off-centre does not.
    const column = (left, rightGap, gutter = 16) => ({
        contentLeft: gutter, contentRightGap: gutter, headerLeft: null, first: { kind: 'list', left, rightGap, topGap: 12 },
    });
    expect(layoutSweepFailures([
        { label: 'centred', vw: 834, layout: column(177, 177) },
        { label: 'off centre', vw: 834, layout: column(177, 60) },
        { label: 'narrow centred', vw: 411, layout: column(40, 40, 12) },
    ])).toEqual([
        'off centre: first content left 177px, expected 16px',
        'narrow centred: first content left 40px, expected 12px',
    ]);
    expect(layoutSweepFailures([
        {
            label: 'activity',
            vw: 768,
            layout: {
                contentLeft: 16,
                contentRightGap: 13,
                headerLeft: 22,
                first: { kind: 'list', left: 13, rightGap: 12, topGap: 12 },
            },
        },
        {
            label: 'send',
            vw: 768,
            layout: {
                contentLeft: 16,
                contentRightGap: 16,
                headerLeft: 16,
                first: { kind: 'form', left: 104, rightGap: 104, topGap: 16 },
            },
        },
    ])).toEqual([
        'activity: content right gap 13px, expected at least 16px',
        'activity: header left 22px, expected 16px',
        'activity: first content left 13px, expected 16px',
        'activity: first content right gap 12px, expected at least 16px',
        'form top gaps [16] do not match list top gaps [12]',
    ]);
});

test('in-page expected gutter matches pageGutterForWidth at each tier boundary', async ({ page }) => {
    // measureInPage runs in the page and carries its own copy of the gutter
    // tiers; this keeps that copy and pageGutterForWidth in step.
    expect([639, 640, 899, 900].map(pageGutterForWidth)).toEqual([12, 16, 16, 24]);
    await page.setContent(`
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>html, body { margin: 0; overflow: hidden; }</style>
        <main id="xc-main"><p>content</p></main>
    `);
    for (const width of [639, 640, 899, 900]) {
        await page.setViewportSize({ width, height: 700 });
        const { vw, layout } = await page.evaluate(measureInPage, {});
        expect(vw, `viewport ${width}`).toBe(width);
        expect(layout?.expectedGutter, `viewport ${width}`).toBe(pageGutterForWidth(width));
    }
});

test('top gaps compare form and list only inside one shell', () => {
    const layout = (kind, topGap, tier) => ({
        contentLeft: 16,
        contentRightGap: 16,
        headerLeft: 16,
        tier,
        first: { kind, left: 16, rightGap: 16, topGap },
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

test('layout findings key the scrolled-away header and short content apart from the gutter contract', () => {
    const layout = { contentLeft: 12, contentRightGap: 12, headerLeft: 12, first: { kind: 'list', left: 12, rightGap: 12, topGap: 12 } };
    const screens = [
        {
            label: 'history',
            vw: 360,
            layout,
            headerScrolledAway: [{ el: 'header.appHeader', top: -56, bottom: 0 }],
            narrow: [{ el: 'ul.list', w: 300, usable: 336, short: 36, offset: 0 }],
        },
        { label: 'home', vw: 360, layout },
    ];
    expect(layoutSweepFindings(screens)).toEqual([
        { key: 'headerScrolledAway', screen: 'history', detail: 'history: header.appHeader scrolled out of view (top -56px, bottom 0px)' },
        { key: 'contentEdge', screen: 'history', detail: 'history: ul.list is 36px short of the 336px content width' },
    ]);
    expect(layoutSweepFailures(screens, { keys: GUTTER_CONTRACT_KEYS })).toEqual([]);
    expect(layoutSweepFailures(screens)).toHaveLength(2);
});

test('header pin measurement finds a header that scrolls away and puts the scroll back', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 400 });
    await page.setContent(`
        <style>body { margin: 0; } .tall { height: 2000px; }</style>
        <header aria-label="App header" style="height: 48px">Wallet</header>
        <nav aria-label="Primary navigation" style="position: fixed; bottom: 0; height: 48px; width: 100%">Tabs</nav>
        <main id="xc-main"><div class="tall"></div></main>
    `);
    await page.evaluate(() => window.scrollTo(0, 30));
    const away = await page.evaluate(measureHeaderPinned);
    expect(away.map(({ el }) => el)).toEqual(['header "App header"']);
    expect(away[0].bottom).toBeLessThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(30);
    await page.setContent(`
        <style>body { margin: 0; } .tall { height: 2000px; }</style>
        <div style="display: flex; flex-direction: column; height: 100vh">
            <header aria-label="App header" style="height: 48px; flex: none">Wallet</header>
            <main id="xc-main" style="overflow-y: auto; flex: 1"><div class="tall"></div></main>
        </div>
    `);
    expect(await page.evaluate(measureHeaderPinned)).toEqual([]);
});

test('rulings measurement flags any Paste button and a Max outside its field', async ({ page }) => {
    await page.setContent(`
        <style>.frame { display: flex; border: 1px solid #888; width: 300px; } input { border: 0; flex: 1; }</style>
        <div class="frame"><input aria-label="Amount"><button>Max</button></div>
        <div class="frame"><input aria-label="To"><button>Paste</button></div>
        <div><input aria-label="Fee" style="border: 1px solid #888"></div><button>Max fee</button>
    `);
    const { fieldButtonsOutside } = await page.evaluate(measureRulings);
    expect(fieldButtonsOutside.map(({ button }) => button)).toEqual(['Paste', 'Max fee']);
    expect(fieldButtonsOutside[0].paste).toBe(true);
});

test('rulings measurement counts header rows of bars with controls, not a stacked title block', async ({ page }) => {
    await page.setContent(`
        <style>header { width: 300px; } .stack > * { display: block; margin: 0; }</style>
        <header aria-label="Title block" class="stack"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"><h1>Wallet</h1><p>Tagline</p></header>
        <header aria-label="Wrapped bar" class="stack"><h1>Home</h1><button>Search</button><button>Menu</button></header>
        <header aria-label="One-row bar" style="display: flex"><h1>Home</h1><button>Menu</button></header>
    `);
    const { headerRows } = await page.evaluate(measureRulings);
    expect(headerRows.map(({ header }) => header)).toEqual(['header.stack "Wrapped bar"']);
});

test('rulings measurement reads repeated text inside an open modal only', async ({ page }) => {
    await page.setContent(`
        <h1>Settings</h1>
        <p>Pick a section</p>
        <div role="dialog" aria-modal="true" aria-labelledby="t">
            <h2 id="t">Commands</h2>
            <ul>
                <li><span class="rowTitle">Settings</span><span class="rowSubtitle">Open this section</span></li>
                <li><span class="rowTitle">Backup</span><span class="rowSubtitle">Open this section</span></li>
            </ul>
        </div>
    `);
    const { repeatedText } = await page.evaluate(measureRulings);
    expect(repeatedText.map(({ text, count }) => `${text} x${count}`)).toEqual(['open this section x2']);
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
        <button style="left: 60px">Adjacent</button>
        <button style="left: 200px">Apart</button>
        <button style="left: 10px; top: 60px; width: 200px; height: 30px">Row</button>
        <button style="left: 170px; top: 63px; width: 24px; height: 24px">Row action</button>
        <button style="left: 10px; top: 150px">Under the sheet</button>
        <div class="sheet"><button style="left: 20px; top: 40px">On the sheet</button></div>
        <div class="scroller"><div><button style="left: 10px; top: 240px">Row passing under the bar</button></div></div>
        <div class="bar"><button style="left: 10px; top: 0">Nav</button></div>
    `);
    const { overlaps } = await page.evaluate(measureInPage, {});
    expect(overlaps).toEqual([{ el: 'button "Contacts"', with: 'button "Adjacent"', w: 30, h: 40 }]);
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
        rulings: true,
        onResult: (result) => screens.push(result),
    });
    await sweep.onboarding();
    await sweep.unlocked();
    // The rulings keys (headerScrolledAway, contentEdge and measureRulings)
    // are written to results.jsonl and gated by rulings-gate.spec.js.
    expect(layoutSweepFailures(screens, { keys: GUTTER_CONTRACT_KEYS }), 'every measured route follows the page gutter contract').toEqual([]);
});
