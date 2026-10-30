// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [360, 1280];

async function expectMatchingControlSizes(label, controls) {
    const metrics = [];
    for (const [name, control] of controls) {
        await expect(control, `${label}: ${name} is not visible`).toBeVisible();
        metrics.push({
            name,
            ...await control.evaluate((element) => {
                const style = getComputedStyle(element);
                return {
                    height: element.getBoundingClientRect().height,
                    borderRadius: style.borderRadius,
                    fontSize: style.fontSize,
                };
            }),
        });
    }

    const heights = metrics.map(({ height }) => height);
    const diagnostic = JSON.stringify(metrics, null, 2);
    expect(
        Math.max(...heights) - Math.min(...heights),
        `${label}: control heights differ by more than 2px\n${diagnostic}`,
    ).toBeLessThanOrEqual(2);
    expect(
        new Set(metrics.map(({ borderRadius }) => borderRadius)).size,
        `${label}: control border radii differ\n${diagnostic}`,
    ).toBe(1);
    expect(
        new Set(metrics.map(({ fontSize }) => fontSize)).size,
        `${label}: control font sizes differ\n${diagnostic}`,
    ).toBe(1);
}

async function expectMatchingHeights(label, controls, expected) {
    const metrics = [];
    for (const [name, control] of controls) {
        await expect(control, `${label}: ${name} is not visible`).toBeVisible();
        metrics.push({ name, height: await control.evaluate((element) => element.getBoundingClientRect().height) });
    }
    const heights = metrics.map(({ height }) => height);
    const diagnostic = JSON.stringify(metrics, null, 2);
    expect(
        Math.max(...heights) - Math.min(...heights),
        `${label}: control heights differ by more than 2px\n${diagnostic}`,
    ).toBeLessThanOrEqual(2);
    if (expected !== undefined) {
        expect(Math.abs(heights[0] - expected), `${label}: controls are not ${expected}px tall\n${diagnostic}`).toBeLessThanOrEqual(2);
    }
}

/** Reads a size token from the root, e.g. --xc-tap-min, as pixels. */
async function tokenPx(page, name) {
    return page.evaluate((token) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)), name);
}

async function openPaletteRoute(page, query, option) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(query);
    await palette.getByRole('option', { name: option }).first().click();
    await expect(palette).toBeHidden();
}

async function showHomeFilters(page) {
    await gotoSection(page, 'Home');
    const search = page.getByRole('main').getByRole('searchbox', { name: 'Search tokens by name' });
    if (await search.count() === 0) {
        // Phone widths fold the hero actions into the Balance actions menu.
        const main = page.getByRole('main');
        const direct = main.getByRole('button', { name: 'Show filters' });
        if (await direct.count() > 0) {
            await direct.click();
        } else {
            await main.getByRole('button', { name: 'Balance actions' }).click();
            await page.getByRole('menuitemcheckbox', { name: 'Show filters' }).click();
        }
    }
    return search;
}

async function openSettingsSearch(page, query) {
    await openSettings(page);
    const search = page.getByRole('main').getByRole('searchbox', { name: 'Search settings' });
    await search.fill(query);
}

async function openStaking(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('staking');
    await palette.getByRole('option', { name: /^Staking\b/ }).first().click();
}

test('controls sharing a row match at phone and desktop widths', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const width of VIEWPORTS) {
        await page.setViewportSize({ width, height: 900 });
        const main = page.getByRole('main');

        await test.step(`${width}px / Home filter bar`, async () => {
            const search = await showHomeFilters(page);
            // The network filter is the Chip toggle, so this row holds the Chip to the search field.
            await expectMatchingControlSizes(`Home filter bar at ${width}px`, [
                ['token search', search],
                ['network filter', main.getByRole('button', { name: 'Filter by network' })],
            ]);
        });

        await test.step(`${width}px / Encrypted inbox`, async () => {
            await gotoSection(page, 'Messaging');
            await expectMatchingControlSizes(`Encrypted inbox at ${width}px`, [
                ['conversation search', main.getByRole('searchbox', { name: 'Search conversations' })],
                ['network filter', main.getByRole('button', { name: 'Filter by network' })],
            ]);
        });

        await test.step(`${width}px / Your dispensers`, async () => {
            await gotoSection(page, 'Dispensers');
            await expectMatchingControlSizes(`Your dispensers at ${width}px`, [
                ['dispenser search', main.getByRole('searchbox', { name: 'Search dispensers' })],
                ['network filter', main.getByRole('button', { name: 'Filter by network' })],
            ]);
        });

        await test.step(`${width}px / Address lists`, async () => {
            await gotoSection(page, 'Lists');
            await expectMatchingControlSizes(`Address lists at ${width}px`, [
                ['list search', main.getByRole('searchbox', { name: 'Search lists' })],
                ['network filter', main.getByRole('button', { name: 'Filter by network' })],
            ]);
        });

        await test.step(`${width}px / Staking`, async () => {
            await openStaking(page);
            await expectMatchingControlSizes(`Staking at ${width}px`, [
                ['position search', main.getByRole('searchbox', { name: 'Search staking positions' })],
                ['network filter', main.getByRole('button', { name: 'Filter by network' })],
            ]);
        });

        await test.step(`${width}px / Contacts`, async () => {
            await gotoSection(page, 'Contacts');
            await expectMatchingControlSizes(`Contacts at ${width}px`, [
                ['contact search', main.getByRole('searchbox', { name: 'Search contacts' })],
                ['network filter', main.getByRole('button', { name: 'Filter by network' })],
                ['sort', main.getByRole('combobox', { name: 'Sort contacts' })],
            ]);
        });

        await test.step(`${width}px / Smart contracts`, async () => {
            await gotoSection(page, 'Contracts');
            await expectMatchingControlSizes(`Smart contracts at ${width}px`, [
                ['contract filter', main.getByRole('searchbox', { name: 'Filter contracts' })],
                ['all chains', main.getByRole('tab', { name: 'All', exact: true })],
                // Empty chain sections carry their own smaller Publish buttons; the
                // toolbar action is the first one.
                ['publish contract', main.getByRole('button', { name: 'Publish contract' }).first()],
            ]);
        });

        await test.step(`${width}px / Settings price alerts`, async () => {
            await openSettingsSearch(page, 'price alerts');
            await expectMatchingControlSizes(`Settings price alerts at ${width}px`, [
                ['coin', main.getByRole('combobox', { name: 'Coin' })],
                ['direction', main.getByRole('combobox', { name: 'Direction' })],
                ['target price', main.getByRole('textbox', { name: 'Target price' })],
                ['add alert', main.getByRole('button', { name: 'Add alert' })],
            ]);
        });

        await test.step(`${width}px / Settings dApp permissions`, async () => {
            await openSettingsSearch(page, 'dApp permissions');
            await main.getByRole('button', { name: /^Connected sites/ }).click();
            const origin = main.getByRole('textbox', { name: 'Origin or wildcard to block' });
            // A filter `has` locator resolves inside the form, so it cannot start at main.
            const blockForm = main.locator('form').filter({
                has: page.getByRole('textbox', { name: 'Origin or wildcard to block' }),
            });
            await expectMatchingControlSizes(`Settings dApp permissions at ${width}px`, [
                ['blocked origin', origin],
                ['block', blockForm.getByRole('button', { name: 'Block', exact: true })],
            ]);
        });
    }
});

// Each width starts a fresh demo wallet, since editing the fee rate leaves
// the compose form on the Custom tier.
for (const width of VIEWPORTS) {
    test(`kit pickers, fee controls and help tips match the controls beside them at ${width}px`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width, height: 900 });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        const main = page.getByRole('main');

        await test.step(`${width}px / Bridge move pickers`, async () => {
            await openPaletteRoute(page, 'Move a token', /^Move a token/);
            // The ChainPicker trigger and the TokenField button stack in one
            // column with the address field, so all three share one height.
            await expectMatchingHeights(`Bridge move pickers at ${width}px`, [
                ['chain picker trigger', main.getByRole('button', { name: /^Move from:/ })],
                ['source address', main.getByRole('textbox', { name: 'From', exact: true })],
                ['token field', main.getByRole('button', { name: /^Token:/ })],
            ]);
        });

        await test.step(`${width}px / Fee selector ticks and help tip`, async () => {
            await gotoSection(page, 'Messaging');
            await main.getByRole('button', { name: 'New conversation' }).click();
            // The tier ticks are pointer-only labels under the slider; each
            // tick in the row keeps one height.
            const ticks = main.locator('button[class*="_sliderTick_"]');
            await expect(ticks).toHaveCount(4);
            await expectMatchingHeights(`Fee ticks at ${width}px`, [0, 1, 2, 3].map((i) => [`tick ${i}`, ticks.nth(i)]));
            // The InfoTip trigger beside the fee label holds the tap target floor.
            await expectMatchingHeights(`Fee help tip at ${width}px`, [
                ['info tip trigger', main.getByRole('button', { name: 'Fee priority help' })],
            ], await tokenPx(page, '--xc-tap-min'));
        });

        await test.step(`${width}px / Fee readout edit`, async () => {
            const amount = main.getByRole('button', { name: 'Edit exact fee amount' });
            const rateButton = main.getByRole('button', { name: /^Edit fee rate/ });
            // Each click-to-edit figure is as tall as the input that replaces
            // it, so the readout row keeps its height when editing starts.
            await expectMatchingHeights(`Fee readout at ${width}px`, [
                ['fee amount edit', amount],
                ['fee rate edit', rateButton],
            ], await tokenPx(page, '--xc-control-h-sm'));
            await rateButton.click();
            await expectMatchingHeights(`Fee readout while editing the rate at ${width}px`, [
                ['fee amount edit', amount],
                ['custom fee rate', main.getByRole('textbox', { name: /^Custom fee rate/ })],
            ]);
        });
    });
}
