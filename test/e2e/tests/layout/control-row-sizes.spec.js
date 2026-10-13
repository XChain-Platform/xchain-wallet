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

async function showHomeFilters(page) {
    await gotoSection(page, 'Home');
    const search = page.getByRole('main').getByRole('searchbox', { name: 'Search tokens by name' });
    if (await search.count() === 0) {
        await page.getByRole('main').getByRole('button', { name: 'Show filters' }).click();
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
                ['publish contract', main.getByRole('button', { name: 'Publish contract' })],
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
            const blockForm = main.locator('form').filter({ has: origin });
            await expectMatchingControlSizes(`Settings dApp permissions at ${width}px`, [
                ['blocked origin', origin],
                ['block', blockForm.getByRole('button', { name: 'Block', exact: true })],
            ]);
        });
    }
});
