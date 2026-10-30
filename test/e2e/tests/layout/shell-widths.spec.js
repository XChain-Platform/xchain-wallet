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
// sidebar, bottom bar and More sheet reach, at phone, tablet and desktop
// sizes and just either side of the 640px and 900px tier edges. Per route:
//   1. the app header is one row, nothing clipped;
//   2. the app header holds only logo, wallet and buttons, the page header
//      only the screen title, Back and trailing controls;
//   3. Back is hidden on screens the visible navigation links to and shown
//      everywhere else;
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
import { enterDemoWallet, overflowingElements } from '../../fixtures/responsive.js';

const VIEWPORTS = [
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

// Nav labels as the sidebar and More sheet show them, with the route id the
// registry lists them under, so the Back ruling can be derived per surface.
const ROUTES = [
    { name: 'Home', id: 'home', tab: true },
    { name: 'History', id: 'history', tab: true },
    { name: 'Send', id: 'send', tab: true },
    { name: 'Scan', id: 'scan', tab: true },
    { name: 'Receive', id: 'receive' },
    { name: 'DEX', id: 'markets' },
    { name: 'Marketplace', id: 'market-activity', sidebarOnly: true, noSheetRow: true },
    { name: 'Dispensers', id: 'dispensers-list' },
    { name: 'Contracts', id: 'contracts-list', optional: true },
    { name: 'Messaging', id: 'messaging' },
    { name: 'Contacts', id: 'contacts' },
    { name: 'Lists', id: 'lists' },
    { name: 'Payments due', id: 'obligations' },
    { name: 'Settings', id: 'settings', sidebarOnly: true },
];

// The tiered --xc-page-gutter: 12px below 640px, 16px from 640px, 24px from 900px.
const gutterFor = (width) => (width >= 900 ? 24 : (width >= 640 ? 16 : 12));

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
                if (r.left < minLeft) { minLeft = r.left; minLeftEl = describe(el); }
                if (r.right > maxRight) { maxRight = r.right; maxRightEl = describe(el); }
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

async function openRoute(page, route, wide) {
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
    // The More sheet slides in; a row measured mid-slide reads as off screen.
    await freezeMotion(page);

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await settle(page);
        const wide = viewport.width >= 640;

        for (const route of ROUTES) {
            const label = `${viewport.width}x${viewport.height} ${route.name}`;
            await test.step(label, async () => {
                // Marketplace is a sidebar row only; the More sheet has no row for it.
                if (route.noSheetRow && !wide) return;
                try {
                    await openRoute(page, route, wide);
                } catch (error) {
                    if (route.optional || route.sidebarOnly) {
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
                const backExpected = wide ? false : !route.tab;
                if (!route.sidebarOnly || wide) {
                    expect.soft(m.backCount > 0, at('Back shown')).toBe(backExpected);
                }

                // 5. no sideways page scroll.
                expect.soft(m.docScrollWidth, at('document scrolls sideways')).toBeLessThanOrEqual(m.docClientWidth);
                expect.soft(m.mainScrollWidth, at('main scrolls sideways')).toBeLessThanOrEqual(m.mainClientWidth + 1);
                expect.soft(await overflowingElements(page), at('elements past the viewport')).toEqual([]);

                // 6. gutter.
                expect.soft(m.padLeft, at('start gutter')).toBe(gutterFor(viewport.width));
                expect.soft(m.padRight, at('end gutter')).toBe(gutterFor(viewport.width));
                expect.soft(m.minLeft, at(`content not past start gutter (${m.minLeftEl})`)).toBeGreaterThanOrEqual(m.contentLeft - 0.5);
                expect.soft(m.maxRight, at(`content not past end gutter (${m.maxRightEl})`)).toBeLessThanOrEqual(m.contentRight + 0.5);

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

test('a long wallet name ellipsises inside a one-row app header at every width', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await freezeMotion(page);

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await settle(page);
        const result = await page.evaluate(() => {
            const bar = document.querySelector('[aria-label="App header"]');
            const name = bar.querySelector('[class*="identity"] [class*="name"]');
            const original = name.textContent;
            name.textContent = 'An extremely long wallet name that no phone header could ever hold in one row';
            const barBox = bar.getBoundingClientRect();
            const nameBox = name.getBoundingClientRect();
            const controls = Array.from(bar.querySelectorAll('button')).map((el) => el.getBoundingClientRect());
            const out = {
                barHeight: barBox.height,
                nameEllipsised: name.scrollWidth > name.clientWidth,
                nameWithin: nameBox.left >= barBox.left && nameBox.right <= barBox.right,
                controlsWithin: controls.every((r) => r.left >= barBox.left - 0.5 && r.right <= barBox.right + 0.5),
                controlTops: controls.map((r) => Math.round(r.top)),
                docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
            name.textContent = original;
            return out;
        });
        const at = (what) => `${viewport.width}x${viewport.height}: ${what}`;
        expect.soft(result.barHeight, at('header stays one row')).toBeLessThan(72);
        expect.soft(result.nameWithin, at('name stays inside the header')).toBe(true);
        expect.soft(result.controlsWithin, at('buttons stay inside the header')).toBe(true);
        expect.soft(new Set(result.controlTops).size, at('buttons share a row')).toBe(1);
        expect.soft(result.docOverflow, at('page does not scroll sideways')).toBeLessThanOrEqual(0);
    }
});
