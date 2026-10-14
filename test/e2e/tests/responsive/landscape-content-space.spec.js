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
    { name: 'large phone landscape', width: 844, height: 390 },
    { name: 'small phone landscape', width: 667, height: 375 },
];
const ROUTES = ['Home', 'Send', 'Receive', 'History', 'Settings'];
const MIN_CONTENT_HEIGHT = 200;
const MAX_TITLE_INSET = 16;

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function measureLandscapeLayout(page) {
    const header = page.getByRole('region', { name: 'App header' });
    const content = page.getByRole('main');
    const headerGeometry = await header.evaluate((element) => {
        const visibleRect = (child) => {
            const style = getComputedStyle(child);
            const rect = child.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && rect.width > 0
                && rect.height > 0
                ? rect
                : null;
        };
        const spread = (rects) => {
            const centers = rects.map((rect) => rect.top + (rect.height / 2));
            return centers.length > 1 ? Math.max(...centers) - Math.min(...centers) : 0;
        };
        const columns = [...element.children]
            .map(visibleRect)
            .filter(Boolean);
        const controls = [...element.querySelectorAll('button')]
            .map(visibleRect)
            .filter(Boolean);
        return {
            columnCount: columns.length,
            controlCount: controls.length,
            columnLineSpread: spread(columns),
            controlLineSpread: spread(controls),
        };
    });
    const contentGeometry = await content.evaluate((element) => {
        const screen = element.parentElement;
        const routeHeader = screen?.querySelector(':scope > header');
        // Home carries its accessible title in the content pane; routed
        // screens carry theirs in the PageHeader row.
        const titleRow = routeHeader?.firstElementChild || element;
        const contentRect = element.getBoundingClientRect();
        const screenRect = screen?.getBoundingClientRect();
        const titleRect = titleRow.getBoundingClientRect();
        return {
            height: contentRect.height,
            overflowY: getComputedStyle(element).overflowY,
            titleInset: titleRect.top - (screenRect?.top ?? titleRect.top),
        };
    });
    return { header: headerGeometry, content: contentGeometry };
}

for (const viewport of VIEWPORTS) {
    test.describe(`responsive: ${viewport.name} content space`, () => {
        test.use({
            userAgent: IPHONE_LANDSCAPE.userAgent,
            deviceScaleFactor: IPHONE_LANDSCAPE.deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
            viewport: { width: viewport.width, height: viewport.height },
            screen: { width: viewport.width, height: viewport.height },
        });

        test('preserves route content below one-row chrome in demo mode', async ({ page }) => {
            test.slow();

            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
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
                    const content = page.getByRole('main');
                    await expect(content).toBeVisible();
                    await expect(
                        content.getByRole('heading', { level: 1, name: route, exact: true }),
                    ).toBeAttached();
                    await settle(page);

                    const layout = await measureLandscapeLayout(page);
                    const label = `${viewport.name} / ${route}`;
                    expect(layout.header.columnCount, `${label}: app header column count`).toBe(2);
                    expect(layout.header.controlCount, `${label}: app header control count`)
                        .toBeGreaterThan(0);
                    expect(layout.header.columnLineSpread, `${label}: app header columns wrap`)
                        .toBeLessThanOrEqual(1);
                    expect(layout.header.controlLineSpread, `${label}: app header controls wrap`)
                        .toBeLessThanOrEqual(1);
                    expect(['auto', 'scroll'], `${label}: content pane is not scrollable`)
                        .toContain(layout.content.overflowY);
                    expect(layout.content.height, `${label}: scrollable content pane height`)
                        .toBeGreaterThanOrEqual(MIN_CONTENT_HEIGHT);
                    expect(layout.content.titleInset, `${label}: title row starts above the route`)
                        .toBeGreaterThanOrEqual(-1);
                    expect(layout.content.titleInset, `${label}: title row is detached from the header`)
                        .toBeLessThan(MAX_TITLE_INSET);
                });
            }
        });
    });
}
