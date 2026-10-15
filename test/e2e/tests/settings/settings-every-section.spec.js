// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, openSettings, test, unlockedShell } from '../../fixtures/wallet.js';

const PASSWORD = 'settings-sections-password';
const VIEWPORT = { width: 412, height: 869 };

// Phone layouts leave Keyboard out of Settings (shortcut bindings need a
// hardware keyboard), and Network & endpoints shows only in Developer Mode;
// this walk runs at a phone width on an ordinary wallet.
const SUBPAGES = [
    'This wallet',
    'Display',
    'Privacy',
    'Safety',
    'Wallet mode',
    'Backup',
    'Fees',
    'Connected sites',
    'Automatic donation system',
    'Developer mode',
    'About',
];

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function settingsRow(page, title) {
    return page.getByRole('main').getByRole('button', {
        name: new RegExp(`^${escapeRegExp(title)}\\b`, 'i'),
    }).first();
}

async function settleLayout(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectNoHorizontalOverflow(page, title) {
    await settleLayout(page);
    const widths = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: Math.max(
            document.documentElement.scrollWidth,
            document.body?.scrollWidth || 0,
        ),
    }));
    expect(
        widths.scroll,
        `${title} scrolls horizontally at ${VIEWPORT.width} by ${VIEWPORT.height}`,
    ).toBeLessThanOrEqual(widths.client + 1);
}

async function flipSwitch(control) {
    const initial = await control.isChecked();
    await control.click();
    if (initial) await expect(control).not.toBeChecked();
    else await expect(control).toBeChecked();
    return !initial;
}

test.describe('Settings: every section', () => {
    test('every sub-page fits a phone and Display and Notifications persist through lock', async ({ page }) => {
        test.slow();
        // Notification toggles stay disabled until the browser grants the
        // permission, as a user does from the permission row. Headless
        // Chromium reports "denied" even after a grant, so model a browser
        // that has granted it.
        await page.context().grantPermissions(['notifications']);
        await page.addInitScript(() => {
            if (typeof Notification !== 'undefined') {
                Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
            }
        });
        await page.setViewportSize(VIEWPORT);
        await createWallet(page, { password: PASSWORD, name: 'Settings Sections Wallet' });
        await openSettings(page);
        await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

        for (const title of SUBPAGES) {
            const row = settingsRow(page, title);
            await expect(row, `Settings has no ${title} sub-page row`).toBeVisible();
            await row.click();

            const back = page.getByRole('button', { name: 'Back to settings', exact: true });
            await expect(back, `${title} has no back-to-settings control`).toBeVisible();
            await expect(page.getByRole('heading', { level: 1, name: title, exact: true }),
                `${title} has no matching page heading`).toBeVisible();
            await expectNoHorizontalOverflow(page, title);

            await back.click();
            await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
        }

        await settingsRow(page, 'Display').click();
        const displaySwitch = page.getByRole('switch', { name: 'Show pin button on rows', exact: true });
        await expect(displaySwitch).toBeVisible();
        const expectedDisplay = await flipSwitch(displaySwitch);
        await page.getByRole('button', { name: 'Back to settings', exact: true }).click();

        const notificationSwitch = page.getByRole('switch', {
            name: 'Transaction confirmations',
            exact: true,
        });
        await expect(notificationSwitch).toBeVisible();
        const expectedNotification = await flipSwitch(notificationSwitch);

        // Wide layouts lock from the side navigation ('Lock'); the phone header carries 'Lock wallet'.
        await page.getByRole('button', { name: 'Lock', exact: true })
            .or(page.getByRole('button', { name: 'Lock wallet', exact: true }))
            .first().click();
        const unlock = page.getByRole('button', { name: 'Unlock Wallet', exact: true });
        await expect(unlock, 'the wallet did not lock').toBeVisible();
        await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
        await unlock.click();
        await expect(unlockedShell(page), 'the wallet did not unlock').toBeVisible();

        await openSettings(page);
        await expect(page.getByRole('switch', {
            name: 'Transaction confirmations',
            exact: true,
        })).toBeChecked({ checked: expectedNotification });

        await settingsRow(page, 'Display').click();
        await expect(page.getByRole('switch', {
            name: 'Show pin button on rows',
            exact: true,
        })).toBeChecked({ checked: expectedDisplay });
    });
});
