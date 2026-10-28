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
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { width: 360, height: 640, gutter: 12 },
    { width: 639, height: 900, gutter: 12 },
    { width: 640, height: 900, gutter: 16 },
    { width: 768, height: 1024, gutter: 16 },
    { width: 899, height: 900, gutter: 16 },
    { width: 900, height: 900, gutter: 24 },
    { width: 1440, height: 900, gutter: 24 },
];

const ROUTES = [
    { name: 'Home', template: 'list' },
    { name: 'History', template: 'list' },
    { name: 'Send', template: 'form', formName: 'Send' },
    { name: 'Receive', template: 'form', formName: 'Receive payment' },
    { name: 'Settings', template: 'list' },
    {
        name: 'Verify signature',
        template: 'form',
        formName: 'Verify signature',
        paletteName: 'Verify a signature',
    },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function openRoute(page, route) {
    if (!route.paletteName) {
        await gotoSection(page, route.name);
    } else {
        await page.keyboard.press('ControlOrMeta+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await expect(palette).toBeVisible();
        await palette.getByRole('combobox').fill(route.paletteName);
        await palette.getByRole('option', {
            name: new RegExp(`^${route.paletteName}\\b`),
        }).first().click();
        await expect(palette).toBeHidden();
    }

    const main = page.getByRole('main');
    // The notices slot is main's first child and stays empty and hidden when
    // there is nothing to say, so wait for the first visible child instead.
    await expect(main.locator(':scope > *:visible').first()).toBeVisible();
    if (route.formName) {
        await expect(main.getByRole('form', { name: route.formName, exact: true }))
            .toBeVisible();
    }
    await main.evaluate((element) => { element.scrollTop = 0; });
    await settle(page);
}

async function geometry(page, isFormRoute) {
    return page.getByRole('main').evaluate((main, formRoute) => {
        // Skip the empty notices slot, which renders no box or a zero-height one.
        const block = Array.from(main.children).find((el) => el.getBoundingClientRect().height > 0);
        // A plain form sits in a page wrapper beside its notices, so the form
        // is the block itself or a direct child of that block.
        const isForm = (el) => el.matches('form, [role="group"]');
        const formEl = formRoute && block && (isForm(block)
            ? block
            : Array.from(block.children).find(isForm));
        const first = formEl || block;
        const screenHeader = main.parentElement?.querySelector(':scope > header');
        const pageHeader = screenHeader?.firstElementChild;
        if (!first) throw new Error('Screen body has no first content block');

        const mainBox = main.getBoundingClientRect();
        const firstBox = first.getBoundingClientRect();
        const mainStyle = getComputedStyle(main);
        const firstStyle = getComputedStyle(first);
        const paddingLeft = parseFloat(mainStyle.paddingLeft);
        const paddingRight = parseFloat(mainStyle.paddingRight);
        const borderWidth = main.offsetWidth - main.clientWidth;
        const contentLeft = mainBox.left + main.clientLeft + paddingLeft;
        const contentRight = mainBox.left + main.clientLeft + main.clientWidth - paddingRight;

        return {
            gutter: paddingLeft,
            contentLeft,
            contentRight,
            firstLeft: firstBox.left,
            firstRight: firstBox.right,
            firstWidth: firstBox.width,
            pageHeaderLeft: pageHeader?.getBoundingClientRect().left ?? null,
            // The scrollbar lane sits on the end edge only, so the start edge
            // carries just the scroller border.
            startGutter: main.clientLeft,
            scrollbarGutter: borderWidth - main.clientLeft,
            directForms: Array.from(main.children)
                .flatMap((element) => (isForm(element)
                    ? [element]
                    : Array.from(element.children).filter(isForm)))
                .length,
            firstStyle: {
                backgroundColor: firstStyle.backgroundColor,
                borderLeftWidth: parseFloat(firstStyle.borderLeftWidth),
                boxShadow: firstStyle.boxShadow,
                paddingLeft: parseFloat(firstStyle.paddingLeft),
            },
        };
    }, isFormRoute);
}

test('page templates keep one responsive gutter and the intended wide-screen shape', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await settle(page);

        for (const route of ROUTES) {
            await test.step(`${viewport.width}px / ${route.name}`, async () => {
                await openRoute(page, route);
                const measured = await geometry(page, route.template === 'form');

                expect(measured.gutter, 'Screen owns the tier gutter')
                    .toBeCloseTo(viewport.gutter, 5);

                if (measured.pageHeaderLeft !== null) {
                    expect(measured.pageHeaderLeft, 'PageHeader starts on the Screen content edge')
                        .toBeCloseTo(measured.contentLeft - measured.startGutter, 5);
                }

                if (route.template === 'list') {
                    expect(measured.firstLeft, 'ListPage starts on the same x as PageHeader')
                        .toBeCloseTo(measured.contentLeft, 5);
                    if (viewport.width === 1440) {
                        expect(measured.scrollbarGutter, 'Screen reserves a stable scrollbar gutter')
                            .toBeGreaterThan(0);
                        expect(measured.firstRight, 'ListPage reaches the scrollbar-side content edge')
                            .toBeCloseTo(measured.contentRight, 5);
                    }
                }

                if (route.template === 'form' && viewport.width === 360) {
                    expect(measured.directForms, 'the Screen contains one form template').toBe(1);
                    expect(measured.firstLeft, 'the narrow form starts at the page gutter')
                        .toBeCloseTo(measured.contentLeft, 5);
                    expect(measured.firstStyle).toMatchObject({
                        backgroundColor: 'rgba(0, 0, 0, 0)',
                        borderLeftWidth: 0,
                        boxShadow: 'none',
                        paddingLeft: 0,
                    });
                }

                if (route.template === 'form' && viewport.width === 1440) {
                    expect(measured.directForms, 'the Screen contains one form card').toBe(1);
                    expect(measured.firstWidth, 'the wide form card uses the shared maximum width')
                        .toBeCloseTo(560, 5);
                    expect(measured.firstLeft - measured.contentLeft, 'the form card is horizontally centred')
                        .toBeCloseTo(measured.contentRight - measured.firstRight, 5);
                    expect(measured.firstStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
                    expect(measured.firstStyle.borderLeftWidth).toBeGreaterThan(0);
                    expect(measured.firstStyle.boxShadow).not.toBe('none');
                    // The wide form card uses the one shared card padding (--xc-card-pad, 16px).
                    expect(measured.firstStyle.paddingLeft).toBeCloseTo(16, 5);
                }
            });
        }
    }
});
