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
// gutter stays at the 16px rail tier, the app header and navigation stay put while the
// route scrolls, compact action routes fit without the screen itself scrolling,
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
            frameScrollbar: parseFloat(style.getPropertyValue('--xc-frame-scrollbar')) || 0,
            screenOverflow: screen.scrollHeight - screen.clientHeight,
        };
    });
}

async function scrollRouteToEnd(page) {
    await page.getByRole('main').evaluate((main) => { main.scrollTop = main.scrollHeight; });
    await settle(page);
}

// Settings groups its rows; the Wallets group page lists My Wallets and My
// Accounts. Settings may reopen on the last sub-page, so step back to the
// landing first.
async function openWalletsGroupRow(page, name) {
    await gotoSection(page, 'Settings');
    const landing = page.getByRole('heading', { level: 1, name: 'Settings', exact: true });
    for (let i = 0; i < 5 && !(await landing.isVisible().catch(() => false)); i += 1) {
        await page.getByRole('banner').getByRole('button', { name: /^Back\b/ }).first().click();
    }
    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Wallets\b/ }).click();
    await main.getByRole('button', { name }).click();
}

for (const phone of LANDSCAPE_PHONES) {
    test.describe(`${phone.width}x${phone.height} landscape phone`, () => {
        test.use({
            viewport: { width: phone.width, height: phone.height },
            isMobile: true,
            hasTouch: true,
        });

        test('keeps the shell fixed, the gutter even and action routes unscrolled', async ({ page }) => {
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
                    expect(geometry.gutterStart, 'start gutter').toBe(8);
                    // Screen.module.css ends the padding two optical pixels early and
                    // gives a classic scrollbar lane back, so rows end on the header buttons' line.
                    expect(geometry.gutterEnd, 'end gutter').toBe(Math.max(0, 8 - 2 - geometry.frameScrollbar));
                    await scrollRouteToEnd(page);
                    expect(await chromeBoxes(page), 'app header and navigation stay put').toEqual(before);
                });
            }

            // Compact action routes: header + body floor + actions must fit, or
            // the screen scrolls a sliver of the title row away.
            await test.step('Accounts', async () => {
                // My Accounts lists the accounts; its create action is the title bar plus.
                await openWalletsGroupRow(page, /^My Accounts\b/);
                await expect(page.getByRole('banner').getByRole('button', { name: /^Add Account$/ })).toBeVisible();
                // U48 keeps page actions directly under their content, never in a pinned footer.
                await expect(page.locator('footer')).toHaveCount(0);
                await settle(page);
                expect((await shellGeometry(page)).screenOverflow).toBe(0);
            });
            await test.step('Wallets', async () => {
                await openWalletsGroupRow(page, /^My Wallets\b/);
                await expect(page.getByRole('banner').getByRole('button', { name: /^Add Wallet$/ })).toBeVisible();
                await settle(page);
                expect((await shellGeometry(page)).screenOverflow).toBe(0);
            });
        });

        test('docks the message composer inside the page gutter', async ({ page }) => {
            test.slow();
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
            await gotoSection(page, 'Messaging');
            await page.getByRole('main').getByRole('button').filter({ hasText: 'Got it, thanks!' }).first().click();
            // Narrow shells dock the reply bar in the Screen footer; a two-panel
            // split (G128) docks it at the bottom of the conversation panel.
            const reply = page.getByRole('textbox', { name: /^Reply/ });
            await expect(reply).toBeVisible();
            const footer = reply.locator('xpath=ancestor::form/..');
            await settle(page);
            const geometry = await footer.evaluate((el) => {
                const bar = el.firstElementChild.getBoundingClientRect();
                const box = el.getBoundingClientRect();
                return {
                    inFooter: el.tagName === 'FOOTER',
                    start: bar.left - box.left,
                    end: box.right - bar.right,
                    top: bar.top - box.top,
                    bottomGap: window.innerHeight - bar.bottom,
                };
            });
            // The page gutter in the Screen footer; the conversation panel of a
            // two-panel split insets the bar by one space-1 step (MessagingInbox.module.css).
            const gutter = geometry.inFooter ? 8 : 4;
            expect(geometry.start, 'composer start gutter').toBe(gutter);
            expect(geometry.end, 'composer end gutter').toBe(gutter);
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
