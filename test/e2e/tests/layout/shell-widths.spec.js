// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shell rulings at the widths between the device venues: every route the
// sidebar, bottom bar and wallet menu reach, at phone, tablet and desktop
// sizes and just either side of the 640px and 900px tier edges. Per route:
//   1. the app header is one row, nothing clipped;
//   2. the app header holds only the logo, Notifications and menu, the page header
//      only the screen title, Back and trailing controls;
//   3. Back is hidden on every root opened from a navigation surface;
//   4. header and navigation stay put while the route scrolls;
//   5. nothing scrolls the page sideways;
//   6. content reaches the page gutter on both sides.

import {
    dismissIntroCarousel,
    expect,
    freezeMotion,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { duoWidths, enterDemoWallet, overflowingElements } from '../../fixtures/responsive.js';

const BASE_VIEWPORTS = [
    { width: 320, height: 640 },
    { width: 375, height: 667 },
    { width: 600, height: 900 },
    { width: 639, height: 900 },
    { width: 640, height: 900 },
    { width: 768, height: 1024 },
    { width: 899, height: 700 },
    { width: 900, height: 700 },
    { width: 1100, height: 800 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
];

// Duo widths join the sweep unless a base width already covers the size.
const DUO = duoWidths().filter(
    (d) => !BASE_VIEWPORTS.some((b) => b.width === d.width && b.height === d.height),
);
const VIEWPORTS = [...BASE_VIEWPORTS, ...DUO.map(({ width, height }) => ({ width, height }))];

// Navigation labels as the sidebar and wallet menu show them, with the route id
// the registry lists them under. gotoSection opens each one as a history root.
const ROUTES = [
    { name: 'Home', id: 'home' },
    { name: 'History', id: 'history' },
    { name: 'Send', id: 'send' },
    { name: 'Scan', id: 'scan' },
    { name: 'Receive', id: 'receive' },
    { name: 'DEX', id: 'markets' },
    { name: 'Marketplace', id: 'market-activity' },
    { name: 'Dispensers', id: 'dispensers-list' },
    { name: 'Contracts', id: 'contracts-list', optional: true },
    { name: 'Messaging', id: 'messaging' },
    { name: 'Contacts', id: 'contacts' },
    { name: 'Lists', id: 'lists' },
    { name: 'Payments due', id: 'obligations' },
    { name: 'Settings', id: 'settings' },
];

// G80: --xc-page-gutter is the 8px spacing unit at every width.
const PAGE_GUTTER = 8;

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

function measure(page) {
    return page.evaluate(() => {
        const box = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const doc = document.documentElement;
        const layout = document.querySelector('[data-xc-tier]');
        const appHeader = document.querySelector('[aria-label="App header"]');
        const main = document.getElementById('xc-main');
        const h1 = document.querySelector('h1');
        const pageHeader = h1?.closest('header') ?? null;
        const sidebar = document.querySelector('nav[aria-label="Primary navigation"]');
        const bottom = document.querySelector('nav[aria-label="Bottom navigation"]');
        const visible = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        };

        // Header controls: every visible leaf-ish child of the bar.
        const headerKids = appHeader
            ? Array.from(appHeader.querySelectorAll('img, button, a, [role="button"], h1, h2, [data-wallet-name]'))
                .filter(visible)
            : [];
        const hb = box(appHeader);
        const centres = headerKids.map((el) => {
            const r = el.getBoundingClientRect();
            return (r.top + r.bottom) / 2;
        });
        const clippedKids = headerKids.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.left < hb.left - 0.5 || r.right > hb.right + 0.5
                || r.top < hb.top - 0.5 || r.bottom > hb.bottom + 0.5;
        }).map((el) => `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}`);

        const mainStyle = main ? getComputedStyle(main) : null;
        const mainBox = box(main);
        const contentLeft = main ? mainBox.left + main.clientLeft + parseFloat(mainStyle.paddingLeft) : 0;
        const contentRight = main
            ? mainBox.left + main.clientLeft + main.clientWidth - parseFloat(mainStyle.paddingRight)
            : 0;
        // Extent of what the route paints inside the scroller.
        let minLeftEl = null;
        let maxRightEl = null;
        const describe = (el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}[${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}]`;
        let minLeft = Infinity;
        let maxRight = -Infinity;
        if (main) {
            for (const el of main.querySelectorAll('*')) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                const s = getComputedStyle(el);
                if (s.position === 'fixed' || s.visibility === 'hidden') continue;
                // Screen-reader-only text is a 1px clipped box, not painted content.
                if (el.closest('.sr-only')) continue;
                // Text an ancestor clips (an ellipsised row) is not painted past it.
                let clipped = false;
                for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
                    if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; }
                }
                if (clipped) continue;
                // A decorative full-bleed line (wide Home's section divider: no
                // text, not a control or image) is judged on what paints: its box
                // clipped by #xc-main's overflow-x clip. Its layout box ends 6px past
                // #xc-main by design (operator-approved look), and the clip hides
                // that. Elements with text, and controls and images, keep their raw
                // box, so real content that overflows, or text that is cut, fails.
                let left = r.left;
                let right = r.right;
                const decorative = !el.textContent.trim() && !el.getAttribute('aria-label') && !/^(img|svg|canvas|input|button|a|video)$/i.test(el.tagName);
                if (decorative && mainStyle.overflowX !== 'visible') {
                    left = Math.max(left, mainBox.left + main.clientLeft);
                    right = Math.min(right, mainBox.left + main.clientLeft + main.clientWidth);
                    if (right <= left) continue;
                }
                if (left < minLeft) { minLeft = left; minLeftEl = describe(el); }
                if (right > maxRight) { maxRight = right; maxRightEl = describe(el); }
            }
        }

        return {
            vw: window.innerWidth,
            vh: window.innerHeight,
            tier: layout?.getAttribute('data-xc-tier') ?? null,
            sidebarShown: visible(sidebar),
            bottomShown: visible(bottom),
            appHeader: hb,
            headerHasHeading: Boolean(appHeader?.querySelector('h1, h2, h3')),
            headerHasBack: Boolean(appHeader?.querySelector('[aria-label^="Back"]')),
            headerRowSpread: centres.length ? Math.max(...centres) - Math.min(...centres) : 0,
            headerKidCount: headerKids.length,
            clippedKids,
            title: h1?.textContent?.trim() ?? null,
            pageHeaderHasLogo: Boolean(pageHeader?.querySelector('img')),
            backCount: Array.from(pageHeader?.querySelectorAll('button[aria-label^="Back"]') ?? []).filter(visible).length,
            docScrollWidth: doc.scrollWidth,
            docClientWidth: doc.clientWidth,
            mainScrollWidth: main?.scrollWidth ?? 0,
            mainClientWidth: main?.clientWidth ?? 0,
            mainScrollHeight: main?.scrollHeight ?? 0,
            mainClientHeight: main?.clientHeight ?? 0,
            // Screen takes a classic scrollbar lane out of its end padding
            // (Screen.module.css), so the end gutter reads that formula.
            frameScrollbar: main ? (parseFloat(mainStyle.getPropertyValue('--xc-frame-scrollbar')) || 0) : 0,
            // A visible G128 list-and-detail split, whose panels bleed past
            // the gutter by design (PanelSplit.module.css, operator 2026-11-16).
            twoPanel: Boolean(main && Array.from(main.querySelectorAll('[class*="_twoPanel_"]')).some(visible)),
            // A mouse keeps no scrollbar lane in a split body (PanelSplit.module.css:
            // scrollbar-gutter auto, no end padding), so its end padding is 0.
            pointerFine: matchMedia("(hover: hover) and (pointer: fine)").matches,
            mainRight: mainBox ? mainBox.right : 0,
            padLeft: main ? parseFloat(mainStyle.paddingLeft) : null,
            padRight: main ? parseFloat(mainStyle.paddingRight) : null,
            contentLeft,
            contentRight,
            minLeft,
            minLeftEl,
            maxRightEl,
            maxRight,
            sidebarBox: box(sidebar),
            bottomBox: box(bottom),
            pageHeaderBox: box(pageHeader),
        };
    });
}

async function openRoute(page, route) {
    await gotoSection(page, route.name);
    const main = page.getByRole('main');
    await expect(main.locator(':scope > *:visible').first()).toBeVisible();
    await main.evaluate((el) => { el.scrollTop = 0; });
    await settle(page);
}

test('the shell keeps its rulings at every width and route', async ({ page }) => {
    test.slow();
    test.setTimeout(30 * 60_000);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    // Freeze the menu sheet transition before measuring compact routes.
    await freezeMotion(page);

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await settle(page);
        const wide = viewport.width >= 640;

        for (const route of ROUTES) {
            const label = `${viewport.width}x${viewport.height} ${route.name}`;
            await test.step(label, async () => {
                try {
                    await openRoute(page, route);
                } catch (error) {
                    if (route.optional) {
                        test.info().annotations.push({ type: 'skip', description: `${label}: ${route.name} not reachable` });
                        return;
                    }
                    throw error;
                }
                const m = await measure(page);
                const at = (what) => `${label}: ${what}`;

                // Tier edges.
                expect.soft(m.tier, at('tier')).toBe(viewport.width >= 900 ? 'full' : (wide ? 'rail' : 'compact'));
                expect.soft(m.sidebarShown, at('sidebar shown iff rail/full')).toBe(wide);
                expect.soft(m.bottomShown, at('bottom bar shown iff compact')).toBe(!wide);

                // 1. one row, nothing clipped.
                expect.soft(m.appHeader.height, at('app header single row height')).toBeLessThan(72);
                expect.soft(m.headerRowSpread, at('app header controls share a row')).toBeLessThanOrEqual(2);
                expect.soft(m.clippedKids, at('app header children clipped')).toEqual([]);
                expect.soft(m.appHeader.width, at('app header spans the main column')).toBeGreaterThan(0);

                // 2. header contents.
                expect.soft(m.headerHasHeading, at('app header carries no title')).toBe(false);
                expect.soft(m.headerHasBack, at('app header carries no Back')).toBe(false);
                expect.soft(m.pageHeaderHasLogo, at('page header carries no logo')).toBe(false);
                expect.soft(m.title, at('screen title present')).toBeTruthy();

                // 3. Back.
                // gotoSection uses the visible navigation or wallet menu. Both
                // open a history root, so G06 leaves Back out at every width.
                expect.soft(m.backCount > 0, at('Back shown on navigation root')).toBe(false);

                // 5. no sideways page scroll.
                expect.soft(m.docScrollWidth, at('document scrolls sideways')).toBeLessThanOrEqual(m.docClientWidth);
                // #xc-main clips sideways overflow; a two-panel split may reach
                // one gutter into it, never more.
                const bleed = m.twoPanel ? PAGE_GUTTER : 0;
                expect.soft(m.mainScrollWidth, at('main scrolls sideways')).toBeLessThanOrEqual(m.mainClientWidth + 1 + bleed);
                expect.soft(await overflowingElements(page), at('elements past the viewport')).toEqual([]);

                // 6. gutter.
                expect.soft(m.padLeft, at('start gutter')).toBe(PAGE_GUTTER);
                // The end padding is the gutter less the 2px optical step and any
                // classic scrollbar lane, so rows end on the header buttons' line.
                // A two-panel split on a pointer-fine device is the approved
                // exception (operator 2026-11-16): no reserved lane and no end
                // padding, the panels carry their own 8px end gap.
                const expectedPadRight = m.twoPanel && m.pointerFine
                    ? 0
                    : Math.max(0, PAGE_GUTTER - 2 - m.frameScrollbar);
                expect.soft(m.padRight, at('end gutter')).toBe(expectedPadRight);
                expect.soft(m.minLeft, at(`content not past start gutter (${m.minLeftEl})`)).toBeGreaterThanOrEqual(m.contentLeft - 0.5 - bleed);
                const endEdge = m.twoPanel ? m.mainRight : m.contentRight;
                expect.soft(m.maxRight, at(`content not past end gutter (${m.maxRightEl})`)).toBeLessThanOrEqual(endEdge + 0.5);

                // 4. chrome stays while the route scrolls (and the page cannot).
                await page.evaluate(() => {
                    const main = document.getElementById('xc-main');
                    main.scrollTop = main.scrollHeight;
                    window.scrollTo(0, 5000);
                    document.scrollingElement.scrollTop = 5000;
                });
                await settle(page);
                const after = await measure(page);
                expect.soft(await page.evaluate(() => document.scrollingElement.scrollTop), at('document scrolled')).toBe(0);
                expect.soft(after.appHeader.top, at('app header stays at the top')).toBe(0);
                expect.soft(after.appHeader.bottom, at('app header does not move')).toBeCloseTo(m.appHeader.bottom, 0);
                if (after.sidebarBox) {
                    expect.soft(after.sidebarBox.top, at('sidebar top fixed')).toBeCloseTo(m.sidebarBox.top, 0);
                    expect.soft(after.sidebarBox.bottom, at('sidebar bottom fixed')).toBeCloseTo(m.sidebarBox.bottom, 0);
                }
                if (after.bottomBox) {
                    expect.soft(after.bottomBox.bottom, at('bottom bar on the viewport edge')).toBeCloseTo(after.vh, 0);
                }
                await page.getByRole('main').evaluate((el) => { el.scrollTop = 0; });
            });
        }
    }
});

test('the app header keeps only its logo and controls in one row at every width', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await freezeMotion(page);

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await settle(page);
        const result = await page.evaluate(() => {
            const bar = document.querySelector('[aria-label="App header"]');
            const logo = bar.querySelector('img');
            const controls = Array.from(bar.querySelectorAll('[data-header-control]'));
            const barBox = bar.getBoundingClientRect();
            const logoBox = logo.getBoundingClientRect();
            const controlBoxes = controls.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
            return {
                barHeight: barBox.height,
                logoWidth: logoBox.width,
                logoWithin: logoBox.left >= barBox.left && logoBox.right <= barBox.right,
                controlCount: controlBoxes.length,
                controlsWithin: controlBoxes.every((r) => r.left >= barBox.left - 0.5 && r.right <= barBox.right + 0.5),
                controlTops: controlBoxes.map((r) => Math.round(r.top)),
                docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        });
        const at = (what) => `${viewport.width}x${viewport.height}: ${what}`;
        expect.soft(result.barHeight, at('header stays one row')).toBeLessThan(72);
        expect.soft(result.logoWidth, at('logo keeps its approved width')).toBeCloseTo(58, 0);
        expect.soft(result.logoWithin, at('logo stays inside the header')).toBe(true);
        expect.soft(result.controlCount, at('only Notifications and menu controls show')).toBe(2);
        expect.soft(result.controlsWithin, at('buttons stay inside the header')).toBe(true);
        expect.soft(new Set(result.controlTops).size, at('buttons share a row')).toBe(1);
        expect.soft(result.docOverflow, at('page does not scroll sideways')).toBeLessThanOrEqual(0);
    }
});

test("the measured Duo widths are part of the sweep", () => {
    const all = duoWidths();
    expect(all.length, "at least one reachable Duo state").toBeGreaterThan(0);
    for (const d of all) {
        expect(VIEWPORTS.some((v) => v.width === d.width && v.height === d.height), d.name).toBe(true);
    }
});
