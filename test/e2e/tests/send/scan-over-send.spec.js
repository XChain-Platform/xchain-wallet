// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The scanner overlay opens over whatever screen is showing, Send included.
// A request scanned there must fill Send with that request, and a payment
// link that lands while the overlay is open must close it so the link's form
// is what the user sees and the camera is released.

import { test, expect, createWallet, DEFAULT_PASSWORD } from '../../fixtures/wallet.js';

const FIRST = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const SECOND = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const LITECOIN = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

async function unlockWithLinkStandIn(page) {
    // The native shell hands links over through the XChainLinks plugin; this
    // stand-in delivers one at a time after the app is running.
    await page.addInitScript(() => {
        if (window.localStorage.getItem('xc:test:links') !== '1') return;
        const listeners = [];
        globalThis.__deliverLink = (url) => listeners.forEach((fn) => fn({ url }));
        globalThis.Capacitor = {
            Plugins: {
                XChainLinks: {
                    takePendingLink: async () => ({ url: null }),
                    addListener: async (_name, fn) => { listeners.push(fn); return { remove() {} }; },
                },
            },
        };
    });
    await createWallet(page, { password: DEFAULT_PASSWORD });
    await page.evaluate(() => window.localStorage.setItem('xc:test:links', '1'));
    await page.goto('/');
    await page.getByLabel('Password', { exact: true }).fill(DEFAULT_PASSWORD);
    await page.getByRole('button', { name: 'Unlock Wallet' }).click();
    await expect(page.getByRole('region', { name: 'App header', exact: true })).toBeVisible({ timeout: 90_000 });
}

async function openScanner(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible({ timeout: 15_000 });
    await palette.getByRole('combobox').first().fill('Scan a QR');
    await page.getByRole('option', { name: /^Scan a QR code/ }).first().click();
    await expect(page.getByLabel('Or paste it here')).toBeVisible();
}

async function openSendFor(page, uri) {
    await page.evaluate((url) => globalThis.__deliverLink(url), uri);
    await expect(page.locator('#send-amount')).toHaveValue('0.001');
}

test('a request scanned over an open Send form fills that request', async ({ page }) => {
    await unlockWithLinkStandIn(page);
    await openSendFor(page, `bitcoin:${FIRST}?amount=0.001`);

    await openScanner(page);
    await page.getByLabel('Or paste it here').fill(`bitcoin:${SECOND}?amount=0.5&message=Invoice%2042`);
    await page.getByRole('button', { name: 'Use pasted text' }).click();

    await expect(page.locator('#send-destination')).toHaveValue(SECOND);
    await expect(page.locator('#send-amount')).toHaveValue('0.5');
    await expect(page.getByRole('main').getByText('Invoice 42')).toBeVisible();
});

test('a request for another coin scanned over Send never keeps the old payee or amount', async ({ page }) => {
    await unlockWithLinkStandIn(page);
    await openSendFor(page, `bitcoin:${FIRST}?amount=0.001`);

    await openScanner(page);
    await page.getByLabel('Or paste it here').fill(`litecoin:${LITECOIN}?amount=5`);
    await page.getByRole('button', { name: 'Use pasted text' }).click();

    await expect(page.locator('#send-destination')).toHaveValue(LITECOIN);
    await expect(page.locator('#send-amount')).toHaveValue('5');
    await expect(page.locator('label[for="send-amount"]')).toContainText('LTC');
});

test('a link that lands while the scanner is open closes it', async ({ page }) => {
    await unlockWithLinkStandIn(page);
    await openSendFor(page, `bitcoin:${FIRST}?amount=0.001`);

    await openScanner(page);
    await page.evaluate((url) => globalThis.__deliverLink(url), `bitcoin:${SECOND}?amount=0.002`);

    await expect(page.getByLabel('Or paste it here')).toBeHidden();
    await expect(page.locator('#send-destination')).toHaveValue(SECOND);
    await expect(page.locator('#send-amount')).toHaveValue('0.002');
});

test('a request scanned over an approved payment wins over a link waiting behind it', async ({ page }) => {
    const THIRD = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    await unlockWithLinkStandIn(page);
    await openSendFor(page, `bitcoin:${FIRST}?amount=0.001`);
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await page.getByTestId('confirm-approve').click();
    await page.evaluate((url) => globalThis.__deliverLink(url), `bitcoin:${SECOND}?amount=0.002`);
    // The dev SDK cannot broadcast, so the approved payment ends on its failure notice.
    await expect(main.getByText("Couldn't send.", { exact: false })).toBeVisible();

    await openScanner(page);
    await page.getByLabel('Or paste it here').fill(`bitcoin:${THIRD}?amount=0.3`);
    await page.getByRole('button', { name: 'Use pasted text' }).click();

    await expect(page.locator('#send-destination')).toHaveValue(THIRD);
    await expect(page.locator('#send-amount')).toHaveValue('0.3');
});
