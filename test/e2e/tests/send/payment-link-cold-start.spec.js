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

test('a link delivered after Approve waits and is dropped when the user leaves by another route', async ({ page }) => {
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

    await page.evaluate((url) => globalThis.__deliverLink(url), `bitcoin:${ADDRESS}?amount=0.001`);
    await expect(page.locator('#send-amount')).toHaveValue('0.001');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await page.getByTestId('confirm-approve').click();
    await page.evaluate((url) => globalThis.__deliverLink(url), `bitcoin:${OTHER}?amount=2`);

    // The dev SDK cannot sign, so the approved payment ends on its refusal
    // notice. The second link must not replace it.
    await expect(main.getByText('This development build cannot sign.', { exact: false })).toBeVisible();
    await expect(page.locator('#send-destination')).toHaveValue(ADDRESS);
    await expect(page.locator('#send-amount')).toHaveValue('0.001');

    // Leaving by the navigation is not Back or Done on a result, so the waiting
    // link is dropped and the screen the user chose says so.
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Home' }).click();
    const dropped = page.getByTestId('waiting-link-dropped');
    await expect(dropped).toHaveText(/The waiting payment link was dropped\./);
    // The notice is page content on the screen the user chose, ahead of the
    // screen's own content, and never a toast.
    const firstInBody = await dropped.evaluate((node) => {
        const body = node.closest('main') ?? document.body;
        const first = [...body.querySelectorAll('*')].find((el) => el.textContent.trim() !== '' && el.children.length === 0);
        return node.contains(first);
    });
    expect(firstInBody).toBe(true);
    await expect(page.getByText('The waiting payment link was dropped.')).toHaveCount(1);
    await dropped.getByRole('button', { name: 'Dismiss notice' }).click();
    await expect(dropped).toHaveCount(0);
    await expect(page.locator('#send-destination')).toHaveCount(0);
});

// The dev SDK cannot sign or broadcast, so no approved payment reaches a
// result there. This stands in for the shell's own send call only: the module
// the app imports for it is served by the loopback dev server, and the route
// handler rewrites that one function to resolve with a txid. Nothing the
// production bundle ships changes.
const SEND_CALL = 'export function sendToken(opts) {';
const STUB_TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';

async function stubBroadcast(page) {
    await page.route(/\/src\/messaging\.js(\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        if (!body.includes(SEND_CALL)) throw new Error('the web messaging module does not export sendToken');
        const stubbed = body.replace(
            SEND_CALL,
            `export function sendToken(opts) {\n    return Promise.resolve({ txid: '${STUB_TXID}' });\n}\nfunction unusedSendToken(opts) {`,
        );
        await route.fulfill({ response, body: stubbed });
    });
}

test('Done on a Send result opens the payment link that waited behind the approved payment', async ({ page }) => {
    await stubBroadcast(page);
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

    await page.evaluate((url) => globalThis.__deliverLink(url), `bitcoin:${ADDRESS}?amount=0.001`);
    await expect(page.locator('#send-amount')).toHaveValue('0.001');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await page.getByTestId('confirm-approve').click();
    await expect(page.getByRole('heading', { name: 'Broadcast pending' })).toBeVisible();

    // The link arrives while the result shows; the result stays and says so.
    await page.evaluate((url) => globalThis.__deliverLink(url), `bitcoin:${OTHER}?amount=2`);
    await expect(page.getByText('A payment link is waiting and opens when you leave this screen.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Broadcast pending' })).toBeVisible();

    // Done is a leave from the result, so the waiting link opens its form.
    await main.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator('#send-destination')).toHaveValue(OTHER);
    await expect(page.locator('#send-amount')).toHaveValue('2');
    await expect(page.getByTestId('waiting-link-dropped')).toHaveCount(0);
});
