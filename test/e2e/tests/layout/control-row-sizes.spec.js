// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    FROM_ADDRESS_LABEL,
    gotoSection,
    openFormSection,
    openFromSection,
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
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(query);
    await palette.getByRole('option', { name: option }).first().click();
    await expect(palette).toBeHidden();
}

async function showHomeFilters(page) {
    await gotoSection(page, 'Home');
    // Token search and the network filter live in the list header's Filter
    // and sort menu (U72), a panel outside main.
    const panel = page.getByRole('dialog').filter({ has: page.getByRole('searchbox', { name: /^Search coins/ }) });
    if (await panel.count() === 0) {
        await page.getByRole('button', { name: 'Filter and sort' }).click();
    }
    return panel;
}

/** Opens a list page's title bar filter button and returns its panel (G95). */
async function openFilterPanel(page, name) {
    await page.getByRole('button', { name, exact: true }).click();
    const panel = page.getByRole('dialog', { name, exact: true });
    await expect(panel).toBeVisible();
    return panel;
}

/** Opens a Settings group, then its rows in order, from the Settings list. */
async function openSettingsPath(page, ...rows) {
    await openSettings(page);
    // Settings reopens on the last page it showed; step back until the list's Wallets row shows.
    const listRow = page.getByRole('main').getByRole('button', { name: /^Wallets/ });
    for (let step = 0; step < 4 && !(await listRow.first().isVisible()); step += 1) {
        await page.getByRole('button', { name: /^Back/ }).filter({ visible: true }).first().click();
    }
    for (const row of rows) {
        await page.getByRole('main').getByRole('button', { name: new RegExp(`^${row}`, 'i') }).first().click();
    }
}

async function openStaking(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
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

        await test.step(`${width}px / Home filter menu`, async () => {
            const panel = await showHomeFilters(page);
            // The menu stacks the token search over the network filter Chip;
            // the two controls keep one height, radius and type size.
            await expectMatchingControlSizes(`Home filter menu at ${width}px`, [
                ['token search', panel.getByRole('searchbox', { name: /^Search coins/ })],
                ['network filter', panel.getByRole('button', { name: /^Filter by network/ })],
            ]);
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
        });

        await test.step(`${width}px / Encrypted inbox`, async () => {
            await gotoSection(page, 'Messaging');
            // The title bar's two actions (the filter icon and the More menu holding New message) are the matched pair.
            await expectMatchingControlSizes(`Encrypted inbox at ${width}px`, [
                ['title bar action', page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'New message', exact: true }))],
                ['filter icon', page.getByRole('button', { name: /^Filter (?:messaging|conversations)$/ })],
            ]);
        });

        await test.step(`${width}px / Your dispensers`, async () => {
            await gotoSection(page, 'Dispensers');
            const panel = await openFilterPanel(page, 'Filter dispensers');
            await expectMatchingControlSizes(`Your dispensers at ${width}px`, [
                ['dispenser search', panel.getByRole('searchbox', { name: 'Search dispensers' })],
                ['network filter', panel.getByRole('button', { name: /^Filter by network/ })],
            ]);
            await page.keyboard.press('Escape');
        });

        await test.step(`${width}px / Address lists`, async () => {
            await gotoSection(page, 'Lists');
            // Search, Network and Show sit in the title bar filter panel (G95).
            const panel = await openFilterPanel(page, 'Filter lists');
            await expectMatchingControlSizes(`Address lists at ${width}px`, [
                ['list search', panel.getByRole('searchbox', { name: 'Search lists' })],
                ['network filter', panel.getByRole('button', { name: /^Filter by network/ })],
                ['show', panel.locator('[aria-label="Show lists"]')],
            ]);
            await page.keyboard.press('Escape');
        });

        await test.step(`${width}px / Staking`, async () => {
            await openStaking(page);
            const panel = await openFilterPanel(page, 'Filter staking');
            await expectMatchingControlSizes(`Staking at ${width}px`, [
                ['position search', panel.getByRole('searchbox', { name: 'Search staking positions' })],
                ['network filter', panel.getByRole('button', { name: /^Filter by network/ })],
            ]);
            await page.keyboard.press('Escape');
        });

        await test.step(`${width}px / Contacts`, async () => {
            await gotoSection(page, 'Contacts');
            // Search, Network and Sort sit in the title bar filter panel (G95).
            const panel = await openFilterPanel(page, 'Filter contacts');
            await expectMatchingControlSizes(`Contacts at ${width}px`, [
                ['contact search', panel.getByRole('searchbox', { name: 'Search contacts' })],
                ['network filter', panel.getByRole('button', { name: /^Filter by network/ })],
                ['sort', panel.locator('[aria-label="Sort contacts"]')],
            ]);
            await page.keyboard.press('Escape');
        });

        await test.step(`${width}px / Smart contracts`, async () => {
            await gotoSection(page, 'Contracts');
            // The title bar holds the filter icon and Publish contract; the filter panel holds the search.
            await expectMatchingControlSizes(`Smart contracts at ${width}px`, [
                ['filter icon', page.getByRole('button', { name: 'Filter contracts', exact: true })],
                // Empty chain sections carry their own smaller Publish buttons; the
                // toolbar action is the first one.
                ['publish contract', page.getByRole('button', { name: 'Publish contract' }).first()],
            ]);
            const panel = await openFilterPanel(page, 'Filter contracts');
            await expectMatchingControlSizes(`Smart contracts filter at ${width}px`, [
                ['contract search', panel.getByRole('searchbox', { name: 'Search contracts' })],
            ]);
            await page.keyboard.press('Escape');
        });

        await test.step(`${width}px / Settings price alerts`, async () => {
            await openSettingsPath(page, 'Notifications', 'Your price alerts');
            await page.getByRole('button', { name: 'Add Price Alert', exact: true }).click();
            await expectMatchingControlSizes(`Settings price alerts at ${width}px`, [
                ['asset', main.getByRole('button', { name: /^Asset:/ })],
                ['direction', main.getByRole('button', { name: /^When the price:/ })],
                ['target price', main.locator('#price-alert-target')],
                ['add alert', main.getByRole('button', { name: 'Add Alert' })],
            ]);
        });

        await test.step(`${width}px / Settings dApp permissions`, async () => {
            await openSettingsPath(page, 'Privacy and Sites', 'Connected sites');
            // The header plus opens the Block Site form.
            await page.getByRole('button', { name: 'Block a site', exact: true }).click();
            const origin = main.locator('#block-site-origin');
            await expectMatchingControlSizes(`Settings dApp permissions at ${width}px`, [
                ['blocked origin', origin],
                ['block', main.getByRole('button', { name: 'Block Site', exact: true })],
            ]);
        });

        await test.step(`${width}px / History date presets`, async () => {
            await gotoSection(page, 'History');
            // The date inputs and presets sit in the History filters panel.
            await page.getByRole('button', { name: 'History filters' }).click();
            const panel = page.getByRole('dialog', { name: 'History filters' });
            const fromDate = panel.getByLabel('From date');
            await expect(fromDate).toBeVisible();
            const presets = panel.getByRole('group', { name: 'Date range presets' });
            // The preset Chips sit under the date inputs, so both hold the field control height.
            await expectMatchingHeights(`History date presets at ${width}px`, [
                ['from date', fromDate],
                ['to date', panel.getByLabel('To date')],
                ['7 days preset', presets.getByRole('button', { name: '7 days', exact: true })],
                ['30 days preset', presets.getByRole('button', { name: '30 days', exact: true })],
                ['all dates preset', presets.getByRole('button', { name: 'All dates', exact: true })],
            ], await tokenPx(page, '--xc-control-h-md'));
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
            await openPaletteRoute(page, 'Move across chains', /^Move across chains/);
            // The ChainPicker trigger and the TokenField button stack in one
            // column with the address field, so all three share one height.
            // The chain picker and the address sit in the closed From section.
            await openFromSection(main);
            await expectMatchingHeights(`Bridge move pickers at ${width}px`, [
                ['chain picker trigger', main.getByRole('button', { name: /^Network:/ })],
                ['source address', main.getByRole('textbox', { name: FROM_ADDRESS_LABEL })],
                ['token field', main.getByRole('button', { name: /^Token:/ })],
            ]);
        });

        await test.step(`${width}px / Fee selector ticks and help tip`, async () => {
            await gotoSection(page, 'Messaging');
            // New message is a title bar button on a phone and a row of the More menu on a wide screen.
            const newMessage = page.getByRole('button', { name: 'New message', exact: true });
            await newMessage.or(page.getByRole('button', { name: 'More', exact: true })).first().waitFor();
            if (await newMessage.count() === 0) await page.getByRole('button', { name: 'More', exact: true }).click();
            await page.getByRole('button', { name: 'New message', exact: true }).or(page.getByRole('menuitem', { name: 'New message' })).first().click();
            // The slider sits in the Fees section, closed until opened.
            await openFormSection(main, 'Speed and Fees');
            // The tier ticks are pointer-only labels under the slider; each
            // tick in the row keeps one height.
            const ticks = main.locator('button[class*="_sliderTick_"]');
            await expect(ticks).toHaveCount(4);
            await expectMatchingHeights(`Fee ticks at ${width}px`, [0, 1, 2, 3].map((i) => [`tick ${i}`, ticks.nth(i)]));
            // The InfoTip trigger beside the Network fee label holds the tap target floor.
            await expectMatchingHeights(`Fee help tip at ${width}px`, [
                ['info tip trigger', main.getByRole('button', { name: 'Network fee help' })],
            ], await tokenPx(page, '--xc-tap-min'));
        });

        await test.step(`${width}px / Fee readout edit`, async () => {
            const amount = main.getByRole('button', { name: 'Edit exact fee amount' });
            // The click-to-edit fee is as tall as the input that replaces it,
            // so the Network fee line keeps its height when editing starts.
            await expectMatchingHeights(`Fee readout at ${width}px`, [
                ['fee amount edit', amount],
            ], await tokenPx(page, '--xc-control-h-sm'));
            // Custom, the slider's last stop, opens that same line's editor in
            // place (G113): one input, as tall as the figure it replaced.
            await main.getByRole('slider', { name: 'Network fee' }).press('End');
            await expect(main.getByRole('textbox', { name: /^Custom fee rate/ })).toHaveCount(0);
            await expectMatchingHeights(`Fee readout while editing the fee at ${width}px`, [
                ['network fee editor', main.getByRole('textbox', { name: /^Network fee amount/ })],
            ], await tokenPx(page, '--xc-control-h-sm'));
        });
    });
}
