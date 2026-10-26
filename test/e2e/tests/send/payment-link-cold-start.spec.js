// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A payment link opened in a fresh tab reaches a locked wallet. The prefill
// must survive the boot and the unlock, and land on the Send form.

import { test, expect, createWallet, unlockWallet, DEFAULT_PASSWORD } from '../../fixtures/wallet.js';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

test('a payment link opened while locked lands on a prefilled Send after unlock', async ({ page }) => {
    await createWallet(page, { password: DEFAULT_PASSWORD });
    await page.goto(`/?uri=${encodeURIComponent(`bitcoin:${ADDRESS}?amount=0.001`)}`);
    await unlockWallet(page);
    await expect(page.locator('#send-destination')).toHaveValue(ADDRESS);
    await expect(page.locator('#send-amount')).toHaveValue('0.001');
});

const OTHER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

test('a second link delivered while Send is open replaces the form', async ({ page }) => {
    // The native shell hands links over through the XChainLinks plugin; this
    // stand-in lets the test deliver one at a time after the app is running.
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

    await page.evaluate((url) => globalThis.__deliverLink(url), `bitcoin:${ADDRESS}?amount=1`);
    await expect(page.locator('#send-amount')).toHaveValue('1');
    await page.locator('#send-amount').fill('0.7');

    await page.evaluate((url) => globalThis.__deliverLink(url), `bitcoin:${OTHER}?amount=2`);
    await expect(page.locator('#send-destination')).toHaveValue(OTHER);
    await expect(page.locator('#send-amount')).toHaveValue('2');
});
