// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    overflowingElements,
} from '../../fixtures/responsive.js';

const PASSWORD = 'dispenser-flow-password';
const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectNoHorizontalOverflow(page, label) {
    await settle(page);
    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: content paints outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: the document scrolls horizontally (${scrollWidth}px in ${clientWidth}px)`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

async function expectControlRowAligned(controls, label) {
    const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
    for (const box of boxes) {
        expect(box, `${label}: a control has no rendered box`).not.toBeNull();
    }

    const [first, ...rest] = boxes;
    for (const box of rest) {
        // The confirm footer stacks its actions full width when the screen is
        // under 400px wide, by design; only side-by-side controls must align.
        const stacked = box.y >= first.y + first.height - 1 || first.y >= box.y + box.height - 1;
        if (stacked) continue;
        const firstCenter = first.y + (first.height / 2);
        const center = box.y + (box.height / 2);
        expect(Math.abs(center - firstCenter), `${label}: control centers do not align`)
            .toBeLessThanOrEqual(1);
    }
}

async function openPaletteCommand(page, title, subtitle) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible({ timeout: 15_000 });
    await palette.getByRole('combobox').fill(title);

    const option = palette.getByRole('option', {
        name: new RegExp(`^${title}\\b`),
    }).first();
    await expect(option).toBeVisible();
    await expect(option).toContainText(subtitle);
    await option.click();
    await expect(palette).toBeHidden({ timeout: 15_000 });
}

async function fillDispenserAndReject(page, label) {
    await openPaletteCommand(page, 'Create dispenser', 'Sell a token at a fixed rate');
    const main = page.getByRole('main');
    await expect(main.getByRole('form', { name: 'Create dispenser' })).toBeVisible();

    await main.getByRole('button', { name: /^Token/ }).click();
    // Picker rows are named "Select <token name> on <chain>, <balance>".
    await page.getByRole('button', { name: /^Select Pepe Cash on / }).first().click();
    await main.getByLabel('Give amount per fill').fill('25');
    await main.getByLabel('Escrow amount').fill('100');
    await main.getByLabel(/Trigger price/).fill('0.05');
    await expectNoHorizontalOverflow(page, `${label} create dispenser`);

    await main.getByRole('button', { name: 'Create', exact: true }).click();
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 30_000 });

    const reject = page.getByTestId('confirm-reject');
    const approve = page.getByTestId('confirm-approve');
    await expectControlRowAligned([reject, approve], `${label} review actions`);
    await expectNoHorizontalOverflow(page, `${label} dispenser review`);

    await reject.click();
    await expect(confirm).toHaveCount(0);
    await expect(main.getByLabel('Give amount per fill')).toHaveValue('25');
    await expect(main.getByLabel('Escrow amount')).toHaveValue('100');
}

async function exerciseOwnedDispensers(page, label) {
    await openPaletteCommand(page, 'Dispensers', 'Your dispensers');
    await expect(page.getByRole('heading', { name: 'My dispensers' })).toBeVisible();

    const search = page.getByLabel('Search dispensers');
    const network = page.getByRole('button', { name: 'Filter by network' });
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill('PEPECASH');
    await network.click();
    await page.getByRole('option', { name: 'Bitcoin', exact: true }).click();

    await expectControlRowAligned([search, network], `${label} owned dispenser filters`);
    await expectNoHorizontalOverflow(page, `${label} owned dispensers`);
}

async function exerciseDispenserExplorer(page, label) {
    await openPaletteCommand(
        page,
        'Browse dispensers',
        'Find open dispensers by token or address',
    );
    await expect(page.getByRole('heading', { name: 'Dispenser explorer' })).toBeVisible();

    const byToken = page.getByRole('radio', { name: 'By token' });
    const byAddress = page.getByRole('radio', { name: 'By address' });
    await byAddress.check();
    await expect(page.getByLabel('Address', { exact: true })).toBeVisible();
    await byToken.check();

    const chain = page.getByLabel('Chain', { exact: true });
    await chain.selectOption({ index: 1 });
    await page.getByLabel('Token ticker').fill('PEPECASH');
    await expectControlRowAligned([byToken, byAddress], `${label} explorer search modes`);
    await expectNoHorizontalOverflow(page, `${label} dispenser explorer filters`);

    await page.getByRole('button', { name: 'Search', exact: true }).click();
    // Each result is a button named "<token> @ <address> ...".
    await expect(page.getByRole('button', { name: /^PEPECASH @ / }).first()).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page, `${label} dispenser explorer results`);
}

for (const viewport of VIEWPORTS) {
    test.describe(`dispenser flow at ${viewport.width}x${viewport.height}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('keeps form, review and filtered list controls in bounds', async ({ page }) => {
            await createWallet(page, { password: PASSWORD });

            await fillDispenserAndReject(page, viewport.name);
            await exerciseOwnedDispensers(page, viewport.name);
            await exerciseDispenserExplorer(page, viewport.name);
        });
    });
}
