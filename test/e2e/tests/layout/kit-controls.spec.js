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
import { fieldByLabel, searchTokenPicker } from '../../fixtures/fields.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const VALID_BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

async function enterDemoWallet(page) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Try Demo' }).click();
    await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
}

async function openAppearanceSettings(page) {
    await gotoSection(page, 'Settings');
    await page.getByRole('main').getByRole('button', { name: /^Appearance\b/ }).click();
    await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
}

async function openPaletteRoute(page, name) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
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
        const balances = tabs.getByRole('tab', { name: 'Balances' });
        const nfts = tabs.getByRole('tab', { name: 'NFTs' });

        await expect(balances).toHaveAttribute('aria-selected', 'true');
        await balances.focus();
        await balances.press('ArrowRight');
        await expect(nfts).toBeFocused();
        await expect(nfts).toHaveAttribute('aria-selected', 'true');
    });

    await test.step('History chips and the segmented view expose their selected state', async () => {
        await gotoSection(page, 'History');
        await page.getByRole('button', { name: 'History filters', exact: true }).click();
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

    await test.step('Markets view select exposes its selected option on the real list', async () => {
        await gotoSection(page, 'DEX');
        // The view choice is the Show markets select inside the Filter markets menu.
        await page.getByRole('button', { name: 'Filter markets', exact: true }).click();
        const show = page.getByRole('combobox', { name: 'Show markets' });
        // The demo wallet may restore another view, so select All first.
        await show.click();
        await page.getByRole('option', { name: 'Show all' }).click();
        await show.click();
        await expect(page.getByRole('option', { name: 'Show all' })).toHaveAttribute('aria-selected', 'true');
        await page.getByRole('option', { name: 'Show popular' }).click();
        await show.click();
        await expect(page.getByRole('option', { name: 'Show popular' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('option', { name: 'Show all' })).toHaveAttribute('aria-selected', 'false');
        await page.keyboard.press('Escape');
    });

    await test.step('Appearance switches retain their saved values after reload', async () => {
        await openAppearanceSettings(page);
        const pin = page.getByRole('switch', { name: 'Pin button on rows' });
        const hide = page.getByRole('switch', { name: 'Hide button on rows' });
        const pinAfter = !(await pin.isChecked());
        const hideAfter = !(await hide.isChecked());

        await pin.click();
        await hide.click();
        await expectChecked(pin, pinAfter);
        await expectChecked(hide, hideAfter);

        await page.reload();
        await expect(nav(page)).toBeVisible({ timeout: kdfStepTimeout() });
        await openAppearanceSettings(page);
        await expectChecked(page.getByRole('switch', { name: 'Pin button on rows' }), pinAfter);
        await expectChecked(page.getByRole('switch', { name: 'Hide button on rows' }), hideAfter);
    });
});

test('choice controls retain their values through order and Send review', async ({ page }) => {
    test.slow();
    await createWallet(page);

    await test.step('Markets order assets and ownership checkbox survive a review round trip', async () => {
        await openPaletteRoute(page, 'Create order');
        const main = page.getByRole('main');
        const pickAsset = async (side, tick, rowName) => {
            await main.getByRole('button', { name: new RegExp(`^${side} asset:`) }).click();
            await searchTokenPicker(page, tick);
            // The open filter panel covers the first result row, so collapse it.
            await page.getByRole('button', { name: 'Filter coins and tokens', exact: true }).click();
            await page.getByRole('button', { name: rowName }).first().click();
        };
        await pickAsset('Give', 'XCHAINGOV', /^Select XChain Governance on Bitcoin\b/);
        await pickAsset('Get', 'XCP', /^Select Counterparty on Bitcoin\b/);
        const give = main.getByRole('button', { name: /^Give asset: XCHAINGOV on / });
        const receive = main.getByRole('button', { name: /^Get asset: XCP on Bitcoin/ });
        await expect(give).toBeVisible();
        await expect(receive).toBeVisible();

        await main.getByRole('button', { name: /^Ownership\b/ }).click();
        const ownership = main.getByRole('switch', { name: 'Trade ownership of XCHAINGOV (not a balance)' });
        await ownership.click();
        await fieldByLabel(main, 'Get amount').fill('2');

        await main.getByRole('button', { name: 'Place Order', exact: true }).click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();
        await page.getByTestId('confirm-reject').click();

        await expect(give).toBeVisible();
        await expect(receive).toBeVisible();
        await expect(ownership).toBeChecked();
    });

    await test.step('Send switch state survives a review round trip', async () => {
        await gotoSection(page, 'Send');
        const main = page.getByRole('main');
        await main.getByLabel('To', { exact: true }).fill(VALID_BTC);
        await main.getByRole('textbox', { name: /^Amount/ }).fill('0.01');
        await main.getByRole('button', { name: /^Advanced\b/ }).click();

        const rbf = main.getByRole('switch', { name: 'Allow a higher network fee later' });
        const expected = !(await rbf.isChecked());
        await rbf.click();
        await expectChecked(rbf, expected);

        await mainButton(page, 'Send').click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();
        await page.getByTestId('confirm-reject').click();
        // The review replaces the form, so Advanced comes back collapsed; the
        // switch value itself is form state and must survive.
        const advanced = main.getByRole('button', { name: /^Advanced\b/ });
        if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
        await expectChecked(rbf, expected);
    });
});
