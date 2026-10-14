// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    enterDemoWallet,
    overflowingElements,
} from '../../fixtures/responsive.js';

const ORIGINAL_WALLET = 'Demo Wallet';
const RENAMED_WALLET = 'Travel wallet';
const RENAMED_ACCOUNT = 'Daily spending';
const VIEWPORTS = [
    { width: 412, height: 869 },
    { width: 1280, height: 800 },
];

const privateKeyCode = (page) => page.getByRole('main')
    .locator('code')
    .filter({ hasText: /^[5KLc9]/ });

async function expectScreen(page, title, label, { atTop = false } = {}) {
    await expect(page.getByRole('heading', { name: title, level: 1 }), `${label}: missing heading`)
        .toBeVisible();

    const documentSize = await documentOverflow(page);
    expect(
        documentSize.scrollWidth,
        `${label}: document is ${documentSize.scrollWidth}px wide in a ${documentSize.clientWidth}px viewport`,
    ).toBeLessThanOrEqual(documentSize.clientWidth + 1);

    const offenders = await overflowingElements(page);
    expect(offenders, `${label}: content crosses the viewport\n${describeOffenders(offenders)}`)
        .toEqual([]);

    if (atTop) {
        const scrollTop = await page.getByRole('main').evaluate((main) => main.scrollTop);
        expect(scrollTop, `${label}: newly opened screen did not start at the top`)
            .toBeLessThanOrEqual(1);
    }
}

async function expectSameLineHeight(controls, label, { matchHeights = true } = {}) {
    const boxes = [];
    for (const control of controls) {
        await expect(control, `${label}: control is missing`).toBeVisible();
        const box = await control.boundingBox();
        expect(box, `${label}: control has no rendered box`).not.toBeNull();
        boxes.push(box);
    }

    const centerSpread = Math.max(...boxes.map((box) => box.y + box.height / 2))
        - Math.min(...boxes.map((box) => box.y + box.height / 2));
    expect(centerSpread, `${label}: controls do not share a line`).toBeLessThanOrEqual(2);

    if (!matchHeights) return;
    const heightSpread = Math.max(...boxes.map((box) => box.height))
        - Math.min(...boxes.map((box) => box.height));
    expect(heightSpread, `${label}: same-line control heights differ by more than 2px`)
        .toBeLessThanOrEqual(2);
}

// PageHeader draws Back as a bare chevron and trailing actions as 38px
// circles by design, so a header pair shares a centre line, not a height.
const HEADER_PAIR = { matchHeights: false };

async function expectGroupedControlHeights(group, label) {
    const boxes = await group.getByRole('button').evaluateAll((buttons) => buttons
        .filter((button) => {
            const style = getComputedStyle(button);
            const box = button.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
                && box.width > 0 && box.height > 0;
        })
        .map((button) => {
            const box = button.getBoundingClientRect();
            return {
                center: box.top + box.height / 2,
                height: box.height,
                name: button.textContent.trim(),
            };
        }));

    const rows = [];
    for (const box of boxes) {
        const row = rows.find((candidate) => Math.abs(candidate[0].center - box.center) <= 2);
        if (row) row.push(box);
        else rows.push([box]);
    }
    const sharedRows = rows.filter((row) => row.length > 1);
    expect(sharedRows.length, `${label}: no shared control row rendered`).toBeGreaterThan(0);
    for (const row of sharedRows) {
        const heights = row.map((box) => box.height);
        const spread = Math.max(...heights) - Math.min(...heights);
        expect(
            spread,
            `${label}: ${row.map((box) => box.name).join(', ')} differ in height`,
        ).toBeLessThanOrEqual(2);
    }
}

async function openPaletteRoute(page, route) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(route);
    await palette.getByRole('option', { name: new RegExp(`^${route}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

for (const viewport of VIEWPORTS) {
    test(`wallet management renders and preserves values at ${viewport.width}x${viewport.height}`,
        async ({ page }) => {
            const size = `${viewport.width}x${viewport.height}`;
            await page.setViewportSize(viewport);
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
            const password = await page.evaluate(() => (
                window.localStorage.getItem('xc:demoWalletPassword')
            ));
            expect(Boolean(password), 'demo mode did not retain its throwaway password')
                .toBe(true);

            await test.step('view details and rename the wallet', async () => {
                await openSettings(page);
                await expectScreen(page, 'Settings', `${size} settings`, { atTop: true });

                await page.getByRole('main').getByRole('button', { name: /^This wallet/ }).click();
                await expectScreen(page, 'This wallet', `${size} this wallet`, { atTop: true });
                await expect(page.getByRole('main').getByText(ORIGINAL_WALLET, { exact: true })).toBeVisible();

                await page.getByRole('button', { name: 'Switch / rename…' }).click();
                await expectScreen(page, 'Wallets', `${size} wallet picker`, { atTop: true });
                await expectSameLineHeight([
                    page.getByRole('button', { name: 'Add wallet' }),
                    page.getByRole('button', { name: 'Manage wallet' }),
                ], `${size} wallet picker footer`);

                await page.getByRole('button', {
                    name: `Wallet details for ${ORIGINAL_WALLET}`,
                }).click();
                await expectScreen(page, 'Wallet details', `${size} wallet details`, { atTop: true });
                const details = page.getByRole('main').locator('dl');
                await expect(details, 'wallet details do not show the selected wallet name')
                    .toContainText(`Name${ORIGINAL_WALLET}`);
                await expect(details, 'wallet details do not show the wallet format')
                    .toContainText('TypeBIP39');
                await expect(details, 'wallet details do not show the wallet origin')
                    .toContainText('Origindemo');

                await page.getByRole('button', { name: 'Rename wallet' }).click();
                await expectScreen(page, 'Rename wallet', `${size} rename wallet`, { atTop: true });
                const walletName = page.getByLabel('Wallet name');
                await expect(walletName).toHaveValue(ORIGINAL_WALLET);
                await expectSameLineHeight([
                    page.getByRole('button', { name: 'Back to previous screen' }),
                    page.getByRole('button', { name: 'Save' }),
                ], `${size} rename wallet header`, HEADER_PAIR);
                await walletName.fill(RENAMED_WALLET);
                await page.getByRole('button', { name: 'Save' }).click();

                await expectScreen(page, 'Wallet details', `${size} renamed wallet details`, {
                    atTop: true,
                });
                await expect(page.getByRole('main').locator('dl'))
                    .toContainText(`Name${RENAMED_WALLET}`);
            });

            await test.step('rename the active account', async () => {
                await page.getByRole('button', { name: 'Back to previous screen' }).click();
                await expectScreen(page, 'Wallets', `${size} wallet picker after rename`, {
                    atTop: true,
                });
                await expect(page.getByRole('main').getByText(RENAMED_WALLET, { exact: true })).toBeVisible();
                await page.getByRole('button', { name: 'Back to previous screen' }).click();
                // The picker was opened from This wallet, so Back returns there first.
                await expectScreen(page, 'This wallet', `${size} this wallet after rename`);
                await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
                await expectScreen(page, 'Settings', `${size} settings after wallet rename`, {
                    atTop: true,
                });

                await page.getByRole('main').getByRole('button', { name: /^Accounts & addresses/ }).click();
                await expectScreen(page, 'Accounts', `${size} account picker`, { atTop: true });
                await expectSameLineHeight([
                    page.getByRole('button', { name: 'Add account' }),
                    // The footer action reads "Manage" so the pair stays on one line.
                    page.getByRole('button', { name: 'Manage', exact: true }),
                ], `${size} account picker footer`);

                await page.getByRole('button', { name: /^Rename / }).first().click();
                await expectScreen(page, 'Rename account', `${size} rename account`, { atTop: true });
                await expectSameLineHeight([
                    page.getByRole('button', { name: 'Back to previous screen' }),
                    page.getByRole('button', { name: 'Save' }),
                ], `${size} rename account header`, HEADER_PAIR);
                await page.getByLabel('Account name').fill(RENAMED_ACCOUNT);
                await page.getByRole('button', { name: 'Save' }).click();

                await expectScreen(page, 'Accounts', `${size} renamed account picker`, {
                    atTop: true,
                });
                await expect(page.getByRole('main').getByText(RENAMED_ACCOUNT, { exact: true })).toBeVisible();
            });

            await test.step('reveal a private key and clear it on leave', async () => {
                await openPaletteRoute(page, 'Addresses');
                await expectScreen(page, 'Addresses', `${size} addresses`, { atTop: true });

                const addressRow = page.getByRole('button', { name: /^View address / }).first();
                await expect(addressRow).toBeVisible();
                const rowName = await addressRow.getAttribute('aria-label');
                const address = rowName?.replace(/^View address /, '') || '';
                expect(address.length, 'the selected address row has no address in its name')
                    .toBeGreaterThan(20);
                await addressRow.click();

                await expectScreen(page, 'View address', `${size} address details`, { atTop: true });
                await expect(page.getByRole('main')).toContainText(address);
                const addressActions = page.getByRole('group', { name: 'Address actions' });
                await expectGroupedControlHeights(addressActions, `${size} address actions`);
                await addressActions.getByRole('button', { name: 'Secret' }).click();

                await expectScreen(page, 'Show private key', `${size} private key warning`, {
                    atTop: true,
                });
                await expect(page.getByRole('heading', { name: 'Before you continue' })).toBeVisible();
                await expect(privateKeyCode(page), 'a private key exists before password confirmation')
                    .toHaveCount(0);
                await page.getByRole('button', { name: 'I understand, continue' }).click();

                await expectScreen(page, 'Show private key', `${size} private key password`);
                await expect(page.getByLabel('Wallet password')).toBeVisible();
                await page.getByLabel('Wallet password').fill(password);
                await page.getByRole('button', { name: 'Confirm password' }).click();

                const reveal = page.getByRole('button', { name: 'Tap to reveal private key' });
                await expect(reveal).toBeVisible();
                await expect(privateKeyCode(page), 'password confirmation exposed the key without a reveal tap')
                    .toHaveCount(0);
                await expectSameLineHeight([
                    reveal,
                    page.getByRole('button', { name: 'Hide', exact: true }),
                ], `${size} private key reveal row`);
                await reveal.click();
                await expect(privateKeyCode(page), 'the requested private key did not render')
                    .toHaveCount(1);
                await expectScreen(page, 'Show private key', `${size} revealed private key`);
                await page.getByRole('button', { name: 'Done' }).click();

                await expectScreen(page, 'Addresses', `${size} addresses after private key leave`, {
                    atTop: true,
                });
                await expect(privateKeyCode(page), 'private key remains in the DOM after leaving')
                    .toHaveCount(0);

                await page.getByRole('button', { name: /^View address / }).first().click();
                await page.getByRole('group', { name: 'Address actions' })
                    .getByRole('button', { name: 'Secret' }).click();
                await expectScreen(page, 'Show private key', `${size} reopened private key warning`, {
                    atTop: true,
                });
                await expect(page.getByRole('heading', { name: 'Before you continue' })).toBeVisible();
                await expect(privateKeyCode(page), 'private key returns after reopening the screen')
                    .toHaveCount(0);
            });

            await test.step('reach wallet removal confirmation without removing it', async () => {
                await openSettings(page);
                // Settings reopens on the sub-page it was last left on, which is
                // This wallet after the rename above; open it from the list only
                // when the list is what shows.
                const title = page.getByRole('heading', { level: 1, name: /^(Settings|This wallet)$/ });
                await expect(title).toBeVisible();
                if ((await title.textContent())?.trim() === 'Settings') {
                    await expectScreen(page, 'Settings', `${size} settings before removal`, { atTop: true });
                    await page.getByRole('main').getByRole('button', { name: /^This wallet/ }).click();
                }
                await expectScreen(page, 'This wallet', `${size} removal settings`, { atTop: true });

                await page.getByRole('button', { name: 'Remove…' }).click();
                await expectScreen(page, 'This wallet', `${size} removal confirmation`);
                const confirmation = page.getByRole('heading', {
                    name: `Remove ${RENAMED_WALLET}?`,
                });
                await expect(confirmation, 'removal confirmation names the wrong wallet').toBeVisible();
                const confirmName = page.getByLabel('Confirm wallet name');
                await expect(confirmName).toHaveAttribute('placeholder', RENAMED_WALLET);
                const remove = page.getByRole('button', { name: 'Remove wallet', exact: true });
                await expect(remove).toBeDisabled();
                await expectSameLineHeight([
                    page.getByRole('button', { name: 'Cancel', exact: true }),
                    remove,
                ], `${size} removal confirmation actions`);
                await confirmName.fill(RENAMED_WALLET);
                await expect(remove, 'exact wallet name did not arm removal').toBeEnabled();
                await expectScreen(page, 'This wallet', `${size} armed removal confirmation`);
            });
        });
}
