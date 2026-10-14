// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { width: 360, height: 800 },
    { width: 1280, height: 800 },
];

async function openAccounts(page) {
    await openSettings(page);
    const row = page.getByRole('main').getByRole('button', { name: /^Accounts & addresses\b/ });
    await expect(row, 'Settings has no Accounts & addresses row').toBeVisible();
    await row.click();
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
}

async function expectRowControls(main, viewport) {
    const add = main.getByRole('button', { name: 'Add account', exact: true });
    await expect(add).toBeVisible();
    const rows = add.locator('xpath=../preceding-sibling::*[./button]');

    const count = await rows.count();
    expect(count, `${viewport}: demo mode rendered no account rows`).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
        const buttons = rows.nth(index).locator(':scope > button');
        expect(await buttons.count(), `${viewport}: account row ${index + 1} has no end control`)
            .toBe(2);
        const control = buttons.nth(1);
        await expect(control, `${viewport}: account row ${index + 1} has no accessible name`)
            .toHaveAccessibleName(/\S/);

        const icon = control.locator('svg').first();
        await expect(icon, `${viewport}: account row ${index + 1} has no visible icon`).toBeVisible();
        const box = await icon.boundingBox();
        expect(box, `${viewport}: account row ${index + 1} icon has no layout box`).not.toBeNull();
        expect(box.width, `${viewport}: account row ${index + 1} icon has zero width`).toBeGreaterThan(0);
        expect(box.height, `${viewport}: account row ${index + 1} icon has zero height`).toBeGreaterThan(0);
    }
}

async function expectCompactActions(main, viewport) {
    const add = main.getByRole('button', { name: 'Add account', exact: true });
    const manage = main.getByRole('button', { name: 'Manage', exact: true });
    await expect(add).toBeVisible();
    await expect(manage).toBeVisible();

    const metrics = await Promise.all([add, manage].map((button) => button.evaluate((element) => {
        const label = element.querySelector('span:last-child');
        const rect = element.getBoundingClientRect();
        if (!label) return { top: rect.top, lineCount: 0, overflows: true };
        const range = document.createRange();
        range.selectNodeContents(label);
        const lineRects = [...range.getClientRects()].filter((line) => line.width > 0 && line.height > 0);
        return {
            top: rect.top,
            lineCount: lineRects.length,
            overflows: element.scrollWidth > element.clientWidth + 1,
        };
    })));

    expect(
        Math.abs(metrics[0].top - metrics[1].top),
        `${viewport}: Add account and Manage do not share one action row`,
    ).toBeLessThanOrEqual(1);
    expect(metrics.map(({ lineCount }) => lineCount), `${viewport}: an action label wraps`)
        .toEqual([1, 1]);
    expect(metrics.some(({ overflows }) => overflows), `${viewport}: an action overflows its button`)
        .toBe(false);

    const placement = await add.evaluate((button) => {
        const footer = button.parentElement;
        const lastRow = footer?.previousElementSibling;
        const parent = footer?.parentElement;
        const footerRect = footer?.getBoundingClientRect();
        const rowRect = lastRow?.getBoundingClientRect();
        return {
            followsLastRow: lastRow?.nextElementSibling === footer,
            previousIsAccountRow: lastRow?.querySelectorAll(':scope > button').length === 2,
            actualGap: footerRect && rowRect ? footerRect.top - rowRect.bottom : null,
            expectedGap: parent ? Number.parseFloat(getComputedStyle(parent).rowGap) : null,
        };
    });

    expect(placement.followsLastRow, `${viewport}: action footer does not follow the last list row`)
        .toBe(true);
    expect(placement.previousIsAccountRow, `${viewport}: action footer is detached from the account list`)
        .toBe(true);
    expect(Number.isFinite(placement.actualGap), `${viewport}: account list gap is not measurable`)
        .toBe(true);
    expect(Number.isFinite(placement.expectedGap), `${viewport}: account list has no resolved row gap`)
        .toBe(true);
    expect(
        Math.abs(placement.actualGap - placement.expectedGap),
        `${viewport}: action footer has extra space after the account list`,
    ).toBeLessThanOrEqual(1);
}

test('account row controls and actions fit at phone and desktop widths', async ({ page }) => {
    test.slow();
    await page.setViewportSize(VIEWPORTS[0]);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        const label = `${viewport.width}x${viewport.height}`;
        await test.step(label, async () => {
            await page.setViewportSize(viewport);
            await openAccounts(page);
            const main = page.getByRole('main');
            await expectRowControls(main, label);
            await expectCompactActions(main, label);
        });
    }
});
