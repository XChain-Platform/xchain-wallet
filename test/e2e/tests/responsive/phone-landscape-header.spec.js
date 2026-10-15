// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { devices } from '@playwright/test';

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const IPHONE_LANDSCAPE = devices['iPhone SE (3rd gen) landscape'];
const VIEWPORTS = [
    { name: 'large iPhone landscape', width: 844, height: 390 },
    { name: 'small iPhone landscape', width: 667, height: 375 },
];
const ROUTES = ['Home', 'Send', 'Receive', 'History', 'Settings'];
const INTERACTIVE_SELECTOR = [
    'button:not(:disabled)',
    'a[href]',
    'input:not(:disabled):not([type="hidden"])',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function measureHeader(page) {
    return page.getByRole('region', { name: 'App header' }).evaluate((
        header,
        interactiveSelector,
    ) => {
        const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0;
        };
        const rectOf = (element) => {
            const rect = element.getBoundingClientRect();
            return {
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left,
                centerY: rect.top + (rect.height / 2),
            };
        };
        const spread = (values) => values.length > 1
            ? Math.max(...values) - Math.min(...values)
            : 0;

        const headerRect = rectOf(header);
        const columns = [...header.children].filter(visible).map(rectOf);
        const controls = [...header.querySelectorAll(interactiveSelector)]
            .filter(visible)
            .map(rectOf);
        const overflowing = [...header.querySelectorAll('*')]
            .filter(visible)
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.left < headerRect.left - 1
                    || rect.right > headerRect.right + 1
                    || rect.top < headerRect.top - 1
                    || rect.bottom > headerRect.bottom + 1;
            })
            .map((element) => element.getAttribute('aria-label')
                || element.getAttribute('title')
                || element.tagName.toLowerCase());
        const main = document.querySelector('main');
        const mainRect = main?.getBoundingClientRect();

        return {
            controlCount: controls.length,
            controlLineSpread: spread(controls.map((rect) => rect.centerY)),
            columnLineSpread: spread(columns.map((rect) => rect.centerY)),
            overflowing,
            scrollWidth: header.scrollWidth,
            clientWidth: header.clientWidth,
            scrollHeight: header.scrollHeight,
            clientHeight: header.clientHeight,
            headerTop: headerRect.top,
            headerRight: headerRect.right,
            headerBottom: headerRect.bottom,
            headerLeft: headerRect.left,
            viewportWidth: document.documentElement.clientWidth,
            viewportHeight: document.documentElement.clientHeight,
            mainTop: mainRect?.top ?? -1,
        };
    }, INTERACTIVE_SELECTOR);
}

for (const viewport of VIEWPORTS) {
    test.describe(`responsive: ${viewport.name} header`, () => {
        test.use({
            userAgent: IPHONE_LANDSCAPE.userAgent,
            deviceScaleFactor: IPHONE_LANDSCAPE.deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
            viewport: { width: viewport.width, height: viewport.height },
            screen: { width: viewport.width, height: viewport.height },
        });

        test('keeps the app header above each primary screen', async ({ page }) => {
            test.slow();

            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
            await expect(unlockedShell(page)).toBeVisible();
            const environment = await page.evaluate(() => ({
                width: window.innerWidth,
                height: window.innerHeight,
                touchPoints: navigator.maxTouchPoints,
            }));
            expect(environment.width).toBe(viewport.width);
            expect(environment.height).toBe(viewport.height);
            expect(
                environment.touchPoints,
                `${viewport.name}: the browser context must expose touch input`,
            ).toBeGreaterThan(0);

            for (const route of ROUTES) {
                await test.step(route, async () => {
                    await gotoSection(page, route);
                    await expect(page.getByRole('main')).toBeVisible();
                    await settle(page);

                    const layout = await measureHeader(page);
                    const label = `${viewport.name} / ${route}`;

                    expect(layout.controlCount, `${label}: the header must expose a control`)
                        .toBeGreaterThan(0);
                    expect(
                        layout.controlCount,
                        `${label}: the header exposes more than three controls`,
                    )
                        .toBeLessThanOrEqual(3);
                    expect(layout.overflowing, `${label}: header descendants overflow the header`)
                        .toEqual([]);
                    expect(layout.scrollWidth, `${label}: the header scrolls horizontally`)
                        .toBeLessThanOrEqual(layout.clientWidth + 1);
                    expect(layout.scrollHeight, `${label}: the header scrolls vertically`)
                        .toBeLessThanOrEqual(layout.clientHeight + 1);
                    expect(layout.headerLeft, `${label}: the header crosses the left viewport edge`)
                        .toBeGreaterThanOrEqual(-1);
                    expect(layout.headerRight, `${label}: the header crosses the right viewport edge`)
                        .toBeLessThanOrEqual(layout.viewportWidth + 1);
                    expect(layout.headerTop, `${label}: the header crosses the top viewport edge`)
                        .toBeGreaterThanOrEqual(-1);
                    expect(layout.headerBottom, `${label}: the header crosses the bottom viewport edge`)
                        .toBeLessThanOrEqual(layout.viewportHeight + 1);
                    expect(layout.columnLineSpread, `${label}: header columns wrap onto separate lines`)
                        .toBeLessThanOrEqual(1);
                    expect(layout.controlLineSpread, `${label}: header controls wrap onto separate lines`)
                        .toBeLessThanOrEqual(1);
                    expect(layout.mainTop, `${label}: page content overlaps the app header`)
                        .toBeGreaterThanOrEqual(layout.headerBottom - 1);
                });
            }
        });
    });
}
