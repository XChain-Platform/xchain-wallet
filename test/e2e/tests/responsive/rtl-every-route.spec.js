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

// Root destinations mirror the wallet-menu catalogue. `tab` marks the five
// bottom-bar tabs, whose headers show no Back control at this width.
const ROUTES = [
    { name: 'Home', id: 'home', tab: true },
    { name: 'History', id: 'history', tab: true },
    { name: 'Send', id: 'send', tab: true },
    { name: 'Receive', id: 'receive', tab: true },
    { name: 'Scan', id: 'scan', back: true },
    { name: 'DEX', id: 'markets', back: true },
    { name: 'Marketplace', id: 'market-activity', back: true },
    { name: 'Dispensers', id: 'dispensers-list', back: true },
    { name: 'Contracts', id: 'contracts-list', back: true },
    { name: 'Messaging', id: 'messaging', back: true },
    { name: 'Contacts', id: 'contacts', back: true },
    { name: 'Lists', id: 'lists', back: true },
    { name: 'Payments due', id: 'obligations', back: true },
    { name: 'Settings', id: 'settings', tab: true },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function enablePseudoRtl(page) {
    await gotoSection(page, 'Settings');
    await page.getByRole('main').getByRole('button', { name: /^Developer mode/ }).click();

    const developerMode = page.getByRole('switch', { name: 'Turn on developer mode', exact: true });
    if (!(await developerMode.isChecked())) {
        await developerMode.click();
        await expect(developerMode).toBeChecked();
    }

    await page.getByRole('button', { name: 'Back to settings' }).click();
    await page.getByLabel('Language', { exact: true }).selectOption('pseudo-rtl');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // The field's own label is localized too, so in the pseudo locale it reads
    // as the wrapped pseudo string rather than "Language".
    await expect(page.getByLabel(/^\u200F?⟦Language⟧$/)).toHaveValue('pseudo-rtl');
}

// The pseudo locale wraps every translated string, the navigation and the
// menu chrome and row titles included, as RLM + "⟦" + English + "⟧".
// Match that form, so the walk still proves each label went through translation.
function pseudoName(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\u200F?⟦${escaped}⟧`);
}

async function gotoPseudoSection(page, name, id) {
    const navItem = page.getByRole('navigation').getByRole('button', { name: pseudoName(name) }).first();
    if (await navItem.isVisible().catch(() => false)) {
        await navItem.click();
        return;
    }
    await page.getByRole('button', { name: pseudoName('Open menu') }).first().click();
    const menu = page.getByRole('dialog', { name: pseudoName('Wallet menu') });
    await expect(menu, `no wallet menu to find "${name}" in`).toBeVisible();
    await menu.locator(`[data-wallet-menu-row="${id}"]`).click();
}

async function gotoRoute(page, route) {
    await gotoPseudoSection(page, route.name, route.id);
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

    // A lazy route paints its loading skeleton first, and the first visible
    // directional button can belong to the screen being left. Poll until the
    // route's own header owns the first one.
    const readGeometry = () => back.evaluate((button) => {
        const buttonBox = button.getBoundingClientRect();
        const headerBox = button.parentElement.getBoundingClientRect();
        return {
            direction: getComputedStyle(button.parentElement).direction,
            startGap: Math.round(headerBox.right - buttonBox.right),
        };
    });
    await expect
        .poll(async () => Math.abs((await readGeometry()).startGap), {
            message: `${label}: the back control is not at the RTL start edge`,
        })
        .toBeLessThanOrEqual(1);
    const geometry = await readGeometry();
    expect(geometry.direction, `${label}: the route header is not RTL`).toBe('rtl');

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
