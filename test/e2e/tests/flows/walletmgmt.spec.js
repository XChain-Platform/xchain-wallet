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

// The read-only Private key field the simplified View Private Key page shows
// once the password and I Understand are given.
const privateKeyCode = (page) => page.getByRole('main')
    .getByRole('textbox', { name: 'Private key', exact: true });

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

async function openPaletteRoute(page, route) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(route);
    await palette.getByRole('option', { name: new RegExp(`^${route}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

// Settings groups its rows: the Wallets group page lists My Wallets and
// My Accounts. Settings may reopen on the last sub-page, so step back to the
// landing first.
async function openWalletsGroup(page, size) {
    await openSettings(page);
    const landing = page.getByRole('heading', { level: 1, name: 'Settings', exact: true });
    for (let i = 0; i < 5 && !(await landing.isVisible().catch(() => false)); i += 1) {
        await page.getByRole('banner').getByRole('button', { name: /^Back\b/ }).first().click();
    }
    await expectScreen(page, 'Settings', `${size} settings`, { atTop: true });
    await page.getByRole('main').getByRole('button', { name: /^Wallets\b/ }).click();
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
                await openWalletsGroup(page, size);
                await page.getByRole('main').getByRole('button', { name: /^My Wallets\b/ }).click();
                await expectScreen(page, /^My Wallets$/, `${size} wallet picker`, { atTop: true });
                // The list page's create action is the title bar's plus (G95).
                await expect(page.getByRole('banner').getByRole('button', { name: /^Add Wallet$/i })).toBeVisible();

                // A wallet row opens that wallet's details page.
                await page.getByRole('main').getByRole('list', { name: /Wallets$/ })
                    .getByRole('button', { name: new RegExp(`^${ORIGINAL_WALLET}`) }).click();
                await expectScreen(page, /^Wallet Details$/i, `${size} wallet details`, { atTop: true });
                await page.getByRole('main').getByRole('tab', { name: 'Details' }).click();
                const details = page.getByRole('main').locator('dl');
                await expect(details, 'wallet details do not show the selected wallet name')
                    .toContainText(`Name${ORIGINAL_WALLET}`);
                await expect(details, 'wallet details do not show the wallet format')
                    .toContainText('TypeBIP39');
                await expect(details, 'wallet details do not show the wallet origin')
                    .toContainText('OriginCreated for demo mode');

                await page.getByRole('main').getByRole('tab', { name: 'Actions' }).click();
                await page.getByRole('main').getByRole('button', { name: /^Edit wallet\b/ }).click();
                await expectScreen(page, /^Edit Wallet$/i, `${size} edit wallet`, { atTop: true });
                const walletName = page.getByLabel('Wallet name', { exact: true });
                await expect(walletName).toHaveValue(ORIGINAL_WALLET);
                // The page header holds only the title and Back; the form's main
                // action saves and closes the form.
                const save = page.getByRole('main').getByRole('button', { name: 'Save Changes', exact: true });
                await expect(save).toBeVisible();
                await walletName.fill(RENAMED_WALLET);
                await save.click();

                await expectScreen(page, /^Wallet Details$/i, `${size} renamed wallet details`);
                await expect(page.getByRole('main').getByText(RENAMED_WALLET, { exact: true }).first()).toBeVisible();
            });

            await test.step('rename the active account', async () => {
                await page.getByRole('banner').getByRole('button', { name: 'Back to previous screen' }).click();
                await expectScreen(page, /^My Wallets$/, `${size} wallet picker after rename`);
                await expect(page.getByRole('main').getByText(RENAMED_WALLET, { exact: true })).toBeVisible();

                await openWalletsGroup(page, size);
                await page.getByRole('main').getByRole('button', { name: /^My Accounts\b/ }).click();
                await expectScreen(page, /^(My )?Accounts$/, `${size} account picker`, { atTop: true });
                // An account row opens its details, which offer Edit account.
                await page.getByRole('main').getByRole('list').getByRole('button').first().click();
                await expectScreen(page, /^Account Details$/i, `${size} account details`, { atTop: true });
                await page.getByRole('main').getByRole('button', { name: /^Edit account\b/ }).click();
                await expectScreen(page, /^Edit Account$/i, `${size} edit account`, { atTop: true });
                const save = page.getByRole('main').getByRole('button', { name: 'Save Changes', exact: true });
                await expect(save).toBeVisible();
                // Exact or by role: each field's 'About ...' help tip (U57) carries its label too.
                await page.getByLabel('Account name', { exact: true }).fill(RENAMED_ACCOUNT);
                await save.click();

                await expect(page.getByRole('heading', { level: 1, name: /^Edit Account$/i })).toBeHidden();
                await expect(page.getByRole('main').getByText(RENAMED_ACCOUNT, { exact: true }).first()).toBeVisible();
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
                // The actions are one ActionList (G101): a row per action, all
                // one height.
                const addressActions = page.getByRole('list', { name: 'Actions', exact: true });
                const rowHeights = await addressActions.getByRole('button').evaluateAll((rows) => rows
                    .map((row) => Math.round(row.getBoundingClientRect().height))
                    .filter((height) => height > 0));
                expect(rowHeights.length, `${size} address actions: no action rows`).toBeGreaterThan(1);
                expect(Math.max(...rowHeights) - Math.min(...rowHeights), `${size} address action rows differ in height`)
                    .toBeLessThanOrEqual(2);
                await addressActions.getByRole('button', { name: /^Secret key\b/ }).click();

                await expectScreen(page, 'Show private key', `${size} private key warning`, {
                    atTop: true,
                });
                // One form: the address, the never-share notice, the wallet
                // password and I Understand (operator ruling, simplified page).
                await expect(page.getByRole('form', { name: 'Before you continue' })).toBeVisible();
                await expect(page.getByRole('main'), 'the private key page has no never-share notice')
                    .toContainText(/never share this private key/i);
                await expect(privateKeyCode(page), 'a private key exists before password confirmation')
                    .toHaveCount(0);

                // The label carries a help tip button named after it (U57), so the
                // field is found by its textbox role.
                const passwordField = page.getByRole('textbox', { name: 'Wallet password', exact: true });
                await expect(passwordField).toBeVisible();
                await passwordField.fill(password);
                await page.getByRole('button', { name: 'I Understand' }).click();

                // The key shows at once after the password; there is no
                // second reveal tap, no Hide and no Done.
                await expect(privateKeyCode(page), 'the requested private key did not render')
                    .toHaveCount(1);
                await expectScreen(page, 'Show private key', `${size} revealed private key`);
                // The back arrow leaves the page and wipes the key; Back returns
                // to the address the key was opened from (G06).
                await page.getByRole('button', { name: 'Back to previous screen' }).click();

                await expectScreen(page, 'View address', `${size} address after private key leave`);
                await expect(privateKeyCode(page), 'private key remains in the DOM after leaving')
                    .toHaveCount(0);

                await page.getByRole('list', { name: 'Actions', exact: true })
                    .getByRole('button', { name: /^Secret key\b/ }).click();
                await expectScreen(page, 'Show private key', `${size} reopened private key warning`, {
                    atTop: true,
                });
                await expect(page.getByRole('form', { name: 'Before you continue' })).toBeVisible();
                await expect(privateKeyCode(page), 'private key returns after reopening the screen')
                    .toHaveCount(0);
            });

            await test.step('reach the demo wipe confirmation without wiping', async () => {
                // A demo wallet is removed by Exit demo & wipe on its details
                // page; the confirmation names everything it destroys.
                await openWalletsGroup(page, size);
                await page.getByRole('main').getByRole('button', { name: /^My Wallets\b/ }).click();
                await page.getByRole('main').getByRole('list', { name: /Wallets$/ })
                    .getByRole('button', { name: new RegExp(`^${RENAMED_WALLET}`) }).click();
                await expectScreen(page, /^Wallet Details$/i, `${size} wallet details before wipe`, { atTop: true });

                await page.getByRole('main').getByRole('button', { name: /^Exit demo & wipe\b/i }).click();
                const dialog = page.getByRole('dialog', { name: /exit demo and delete its data/i });
                await expect(dialog, 'the demo wipe confirmation did not open').toBeVisible();
                await expect(dialog).toContainText(/permanently deletes the demo wallet/i);
                await expect(dialog).toContainText(/cannot be undone/i);
                const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
                const wipe = dialog.getByRole('button', { name: /^Exit Demo & Wipe$/i });
                await expectSameLineHeight([cancel, wipe], `${size} demo wipe actions`);
                await cancel.click();
                await expect(dialog).toBeHidden();
                await expectScreen(page, /^Wallet Details$/i, `${size} wallet details after cancel`);
                await expect(page.getByRole('main').getByText(RENAMED_WALLET, { exact: true }).first()).toBeVisible();
            });
        });
}
