// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    enterDemoWallet,
    overflowingElements,
} from '../../fixtures/responsive.js';

const VIEWPORT = { width: 360, height: 800 };

// Root destinations mirror ROUTE_NAV_GROUPS. Marketplace uses the command
// palette because compact navigation intentionally keeps it out of More.
// `tab` marks the bottom-bar tabs: the tab bar already links to them, so
// their header shows no Back control at this width.
const ROUTES = [
    { name: 'Home' },
    { name: 'History', tab: true },
    { name: 'Send', tab: true },
    { name: 'Receive', back: true },
    { name: 'Scan', tab: true },
    { name: 'DEX', back: true },
    { name: 'Marketplace', back: true, palette: true },
    { name: 'Dispensers', back: true },
    { name: 'Contracts', back: true },
    { name: 'Messaging', back: true },
    { name: 'Contacts', back: true },
    { name: 'Lists', back: true },
    { name: 'Payments due', back: true },
    { name: 'Settings', back: true },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function enablePseudoRtl(page) {
    await gotoSection(page, 'Settings');
    await page.getByRole('main').getByRole('button', { name: /^Developer mode/ }).click();

    const developerMode = page.getByRole('switch', { name: 'Developer Mode', exact: true });
    if (!(await developerMode.isChecked())) {
        await developerMode.click();
        await expect(developerMode).toBeChecked();
    }

    await page.getByRole('button', { name: 'Back to settings' }).click();
    await page.getByLabel('Language', { exact: true }).selectOption('pseudo-rtl');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByLabel('Language', { exact: true })).toHaveValue('pseudo-rtl');
}

async function gotoRoute(page, route) {
    if (!route.palette) {
        await gotoSection(page, route.name);
        return;
    }

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(route.name);
    await palette.getByRole('option', { name: new RegExp(`^${route.name}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

async function expectNoHorizontalOverflow(page, label) {
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: ${offenders.length} element(s) paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: the document scrolls sideways (${scrollWidth}px of content in ${clientWidth}px)`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

async function expectBackAtStartWithMirroredChevrons(page, label) {
    // The pseudo locale wraps translated labels, so identify the shared
    // PageHeader control by its directional icon (the kit Button wraps it in
    // an icon span) instead of English.
    const back = page.locator('button:has(svg[data-xc-directional]):visible').first();
    await expect(back, `${label}: the route has no visible back control`).toBeVisible();

    const geometry = await back.evaluate((button) => {
        const buttonBox = button.getBoundingClientRect();
        const headerBox = button.parentElement.getBoundingClientRect();
        return {
            direction: getComputedStyle(button.parentElement).direction,
            startGap: Math.round(headerBox.right - buttonBox.right),
        };
    });
    expect(geometry.direction, `${label}: the route header is not RTL`).toBe('rtl');
    expect(
        Math.abs(geometry.startGap),
        `${label}: the back control is ${geometry.startGap}px from the RTL start edge`,
    ).toBeLessThanOrEqual(1);

    const chevrons = page.locator('svg[data-xc-directional]:visible');
    const transforms = await chevrons.evaluateAll((icons) => icons.map((icon) => {
        const transform = getComputedStyle(icon).transform;
        return {
            transform,
            mirrored: transform !== 'none' && new DOMMatrixReadOnly(transform).a < 0,
        };
    }));
    expect(transforms.length, `${label}: no visible directional chevron rendered`).toBeGreaterThan(0);
    expect(
        transforms.filter(({ mirrored }) => !mirrored),
        `${label}: one or more chevrons are not mirrored in RTL`,
    ).toEqual([]);
}

test.describe('responsive RTL route sweep', () => {
    test('every top-level route fits and mirrors its navigation at 360 by 800', async ({ page }) => {
        test.slow();

        await page.setViewportSize(VIEWPORT);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await enablePseudoRtl(page);

        for (const route of ROUTES) {
            await test.step(route.name, async () => {
                await gotoRoute(page, route);
                await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

                if (route.back) {
                    await expectBackAtStartWithMirroredChevrons(page, route.name);
                } else if (route.tab) {
                    const heading = page.getByRole('heading', { level: 1 }).first();
                    await expect(heading).toBeVisible();
                    // h1 > title group > PageHeader row
                    await expect(
                        heading.locator('xpath=../..').locator('button:has(svg[data-xc-directional])'),
                        `${route.name}: a bottom-bar tab shows a redundant back control`,
                    ).toHaveCount(0);
                } else {
                    await expect(unlockedShell(page)).toBeVisible();
                }

                await expectNoHorizontalOverflow(page, `${route.name} at ${VIEWPORT.width}px RTL`);
            });
        }
    });
});
