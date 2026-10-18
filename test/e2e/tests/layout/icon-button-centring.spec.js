// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, gotoSection, test } from '../../fixtures/wallet.js';

const VIEWPORTS = [
    { width: 412, height: 732 },
    { width: 1280, height: 800 },
];
const ROUTES = ['Home', 'History', 'Send', 'Settings'];
const MAX_OFFSET_PX = 1;

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function iconButtonCentres(page) {
    return page.locator('button:visible').evaluateAll((buttons) => {
        const isVisible = (element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && box.width > 0
                && box.height > 0;
        };

        return buttons.flatMap((button, index) => {
            const visibleChildren = [...button.children].filter(isVisible);
            if (visibleChildren.length !== 1
                || visibleChildren[0].tagName.toLowerCase() !== 'svg'
                || button.innerText.trim() !== '') {
                return [];
            }

            const svg = visibleChildren[0];
            const buttonBox = button.getBoundingClientRect();
            const svgBox = svg.getBoundingClientRect();
            return [{
                label: button.getAttribute('aria-label')
                    || button.getAttribute('title')
                    || `button ${index + 1}`,
                xOffset: Math.abs(
                    (buttonBox.left + buttonBox.width / 2) - (svgBox.left + svgBox.width / 2),
                ),
                yOffset: Math.abs(
                    (buttonBox.top + buttonBox.height / 2) - (svgBox.top + svgBox.height / 2),
                ),
            }];
        });
    });
}

test('icon-only buttons keep their SVG centred on primary screens', async ({ page }) => {
    await createWallet(page, { password: 'icon-centre-password' });
    let measuredButtons = 0;

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await settle(page);

        for (const route of ROUTES) {
            await test.step(`${route} at ${viewport.width}px`, async () => {
                await gotoSection(page, route);
                await settle(page);

                const centres = await iconButtonCentres(page);
                measuredButtons += centres.length;

                for (const centre of centres) {
                    expect(
                        centre.xOffset,
                        `${route} at ${viewport.width}px: ${centre.label} SVG is ${centre.xOffset}px off-centre horizontally`,
                    ).toBeLessThanOrEqual(MAX_OFFSET_PX);
                    expect(
                        centre.yOffset,
                        `${route} at ${viewport.width}px: ${centre.label} SVG is ${centre.yOffset}px off-centre vertically`,
                    ).toBeLessThanOrEqual(MAX_OFFSET_PX);
                }
            });
        }
    }

    expect(measuredButtons, 'the route walk found no visible icon-only buttons')
        .toBeGreaterThan(0);
});
