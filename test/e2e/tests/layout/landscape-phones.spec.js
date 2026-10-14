// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Landscape phones: the shell at the three common short landscape sizes.
// These widths sit in the rail tier, so the sidebar navigation shows, and
// their heights trip the short-landscape rules in Screen.module.css. The
// spec holds the shell invariants there: nothing scrolls sideways, the page
// gutter stays 12px, the app header and navigation stay put while the
// route scrolls, a footer route fits without the screen itself scrolling,
// and a primary action stays reachable above a soft keyboard.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const LANDSCAPE_PHONES = [
    { width: 844, height: 390 },
    { width: 740, height: 360 },
    { width: 667, height: 375 },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

function chromeBoxes(page) {
    return page.evaluate(() => {
        const box = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        };
        return {
            appHeader: box(document.querySelector('[aria-label="App header"]')),
            nav: box(document.querySelector('nav[aria-label="Primary navigation"]')),
        };
    });
}

function shellGeometry(page) {
    return page.evaluate(() => {
        const doc = document.documentElement;
        const main = document.getElementById('xc-main');
        const screen = main.parentElement;
        const style = getComputedStyle(main);
        return {
            sideScroll: doc.scrollWidth - doc.clientWidth,
            gutterStart: parseFloat(style.paddingLeft),
            gutterEnd: parseFloat(style.paddingRight),
            screenOverflow: screen.scrollHeight - screen.clientHeight,
        };
    });
}

async function scrollRouteToEnd(page) {
    await page.getByRole('main').evaluate((main) => { main.scrollTop = main.scrollHeight; });
    await settle(page);
}

async function openSettingsRow(page, name) {
    await gotoSection(page, 'Settings');
    await page.getByRole('main').getByRole('button', { name }).first().click();
}

for (const phone of LANDSCAPE_PHONES) {
    test.describe(`${phone.width}x${phone.height} landscape phone`, () => {
        test.use({
            viewport: { width: phone.width, height: phone.height },
            isMobile: true,
            hasTouch: true,
        });

        test('keeps the shell fixed, the gutter even and footer routes unscrolled', async ({ page }) => {
            test.slow();
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
            await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();

            for (const route of ['Home', 'History', 'Send', 'Receive', 'Settings', 'Contacts']) {
                await test.step(route, async () => {
                    await gotoSection(page, route);
                    await expect(page.getByRole('main')).toBeVisible();
                    await settle(page);
                    const before = await chromeBoxes(page);
                    const geometry = await shellGeometry(page);
                    expect(geometry.sideScroll, 'nothing scrolls the page sideways').toBe(0);
                    expect(geometry.gutterStart, 'start gutter').toBe(12);
                    expect(geometry.gutterEnd, 'end gutter').toBe(12);
                    await scrollRouteToEnd(page);
                    expect(await chromeBoxes(page), 'app header and navigation stay put').toEqual(before);
                });
            }

            // Footer routes: header + body floor + footer must fit, or the
            // screen scrolls a sliver of the title row away.
            await test.step('Accounts', async () => {
                await openSettingsRow(page, /Accounts/);
                await expect(page.locator('footer').first()).toBeVisible();
                await settle(page);
                expect((await shellGeometry(page)).screenOverflow).toBe(0);
            });
            await test.step('Wallets', async () => {
                await openSettingsRow(page, /This wallet/);
                await page.getByRole('button', { name: /Switch/ }).first().click();
                await expect(page.getByRole('button', { name: /Add wallet/ })).toBeVisible();
                await settle(page);
                expect((await shellGeometry(page)).screenOverflow).toBe(0);
            });
        });

        test('docks the message composer inside the page gutter', async ({ page }) => {
            test.slow();
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
            await gotoSection(page, 'Messaging');
            await page.getByRole('main').getByRole('button').filter({ hasText: 'Got it, thanks!' }).first().click();
            const footer = page.locator('footer').first();
            await expect(footer.getByRole('textbox')).toBeVisible();
            await settle(page);
            const geometry = await footer.evaluate((el) => {
                const bar = el.firstElementChild.getBoundingClientRect();
                const box = el.getBoundingClientRect();
                return {
                    start: bar.left - box.left,
                    end: box.right - bar.right,
                    top: bar.top - box.top,
                    bottomGap: window.innerHeight - bar.bottom,
                };
            });
            expect(geometry.start, 'composer start gutter').toBe(12);
            expect(geometry.end, 'composer end gutter').toBe(12);
            expect(geometry.top, 'composer clears the footer border').toBeGreaterThan(1);
            expect(geometry.bottomGap, 'composer clears the bottom edge').toBeGreaterThan(0);
        });

        test('keeps Send reachable above a soft keyboard', async ({ page }) => {
            test.slow();
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
            await gotoSection(page, 'Send');
            const main = page.getByRole('main');
            await main.getByRole('combobox').or(main.getByRole('textbox')).first().focus();
            // An Android soft keyboard resizes the layout viewport to what is
            // left above it, a bit under half of a landscape phone.
            await page.setViewportSize({ width: phone.width, height: Math.round(phone.height * 0.45) });
            await settle(page);
            const send = main.getByRole('button', { name: 'Send', exact: true });
            await send.scrollIntoViewIfNeeded();
            await expect(send).toBeInViewport({ ratio: 1 });
        });
    });
}
