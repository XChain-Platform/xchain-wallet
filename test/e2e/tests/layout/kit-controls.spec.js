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
    createWallet,
    dismissIntroCarousel,
    expect,
    gotoSection,
    mainButton,
    nav,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const VALID_BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

async function enterDemoWallet(page) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Try in demo mode' }).click();
    await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
}

async function openDisplaySettings(page) {
    await gotoSection(page, 'Settings');
    await page.getByRole('main').getByRole('button', { name: /^Display\b/ }).click();
    await expect(page.getByRole('heading', { name: 'Display', exact: true })).toBeVisible();
}

async function openPaletteRoute(page, name) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(name);
    await palette.getByRole('option', { name: new RegExp(`^${name}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

async function expectChecked(control, checked) {
    if (checked) await expect(control).toBeChecked();
    else await expect(control).not.toBeChecked();
}

test('kit navigation and filter controls work on populated routes', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page);

    await test.step('Home tabs select and focus the next tab with an arrow key', async () => {
        const tabs = page.getByRole('main').getByRole('tablist', { name: 'Wallet view' });
        const coins = tabs.getByRole('tab', { name: 'Coins' });
        const tokens = tabs.getByRole('tab', { name: 'Tokens' });

        await expect(coins).toHaveAttribute('aria-selected', 'true');
        await coins.focus();
        await coins.press('ArrowRight');
        await expect(tokens).toBeFocused();
        await expect(tokens).toHaveAttribute('aria-selected', 'true');
    });

    await test.step('History chips and the segmented view expose their selected state', async () => {
        await gotoSection(page, 'History');
        const datePresets = page.getByRole('group', { name: 'Date range presets' });
        const sevenDays = datePresets.getByRole('button', { name: '7 days' });
        await sevenDays.click();
        await expect(sevenDays).toHaveAttribute('aria-pressed', 'true');

        const grouping = page.getByRole('radiogroup', { name: 'Grouping mode' });
        const grouped = grouping.getByRole('radio', { name: 'Grouped' });
        const flat = grouping.getByRole('radio', { name: 'Flat' });
        const rows = page.locator('[data-history-key]');
        await expect(grouped).toHaveAttribute('aria-checked', 'true');
        const groupedRowCount = await rows.count();
        await flat.click();
        await expect(flat).toHaveAttribute('aria-checked', 'true');
        await expect.poll(() => rows.count()).toBeGreaterThan(groupedRowCount);
    });

    await test.step('Markets view tabs expose their selected state on the real list', async () => {
        await gotoSection(page, 'DEX');
        // The Markets view is the kit Tabs control, so selection is aria-selected.
        const views = page.getByRole('tablist', { name: 'Markets view' });
        const all = views.getByRole('tab', { name: 'All', exact: true });
        const popular = views.getByRole('tab', { name: 'Popular', exact: true });
        // The demo wallet may restore another view, so select All first.
        await all.click();
        await expect(all).toHaveAttribute('aria-selected', 'true');
        await popular.click();
        await expect(popular).toHaveAttribute('aria-selected', 'true');
        await expect(all).toHaveAttribute('aria-selected', 'false');
    });

    await test.step('Display switches retain their saved values after reload', async () => {
        await openDisplaySettings(page);
        const pin = page.getByRole('switch', { name: 'Show pin button on rows' });
        const hide = page.getByRole('switch', { name: 'Show hide button on rows' });
        const pinAfter = !(await pin.isChecked());
        const hideAfter = !(await hide.isChecked());

        await pin.click();
        await hide.click();
        await expectChecked(pin, pinAfter);
        await expectChecked(hide, hideAfter);

        await page.reload();
        await expect(nav(page)).toBeVisible({ timeout: kdfStepTimeout() });
        await openDisplaySettings(page);
        await expectChecked(page.getByRole('switch', { name: 'Show pin button on rows' }), pinAfter);
        await expectChecked(page.getByRole('switch', { name: 'Show hide button on rows' }), hideAfter);
    });
});

test('choice controls retain their values through order and Send review', async ({ page }) => {
    test.slow();
    await createWallet(page);

    await test.step('Markets order radios and checkbox survive a review round trip', async () => {
        await openPaletteRoute(page, 'Create order');
        const main = page.getByRole('main');
        const give = main.getByRole('region', { name: 'You give', exact: true })
            .getByRole('group', { name: 'Asset type', exact: true });
        const receive = main.getByRole('region', { name: 'You get', exact: true })
            .getByRole('group', { name: 'Asset type', exact: true });
        const receiveToken = receive.getByRole('radio', { name: 'A token' });

        await receiveToken.check();
        const tickers = main.getByLabel('Ticker', { exact: true });
        await tickers.first().fill('PEPECASH');
        await tickers.last().fill('XCP');
        const ownership = main.getByRole('checkbox', {
            name: 'Trade ownership of this ticker (not a balance)',
        }).first();
        await ownership.check();
        await main.getByLabel('Amount', { exact: true }).fill('2');

        await expect(give.getByRole('radio', { name: 'A token' })).toBeChecked();
        await main.getByRole('button', { name: 'Place order', exact: true }).click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();
        await page.getByTestId('confirm-reject').click();

        await expect(receiveToken).toBeChecked();
        await expect(ownership).toBeChecked();
        await expect(tickers.first()).toHaveValue('PEPECASH');
        await expect(tickers.last()).toHaveValue('XCP');
    });

    await test.step('Send switch state survives a review round trip', async () => {
        await gotoSection(page, 'Send');
        const main = page.getByRole('main');
        await main.getByLabel('To', { exact: true }).fill(VALID_BTC);
        await main.getByRole('textbox', { name: /^Amount/ }).fill('0.01');
        await main.locator('summary', { hasText: 'Advanced' }).click();

        const rbf = main.getByRole('switch', { name: 'Allow a higher network fee later' });
        const expected = !(await rbf.isChecked());
        await rbf.click();
        await expectChecked(rbf, expected);

        await mainButton(page, 'Send').click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();
        await page.getByTestId('confirm-reject').click();
        // The review replaces the form, so Advanced comes back collapsed; the
        // switch value itself is form state and must survive.
        const advanced = main.locator('details', { has: page.locator('summary', { hasText: 'Advanced' }) });
        if (!(await advanced.evaluate((element) => element.open))) {
            await main.locator('summary', { hasText: 'Advanced' }).click();
        }
        await expectChecked(rbf, expected);
    });
});
