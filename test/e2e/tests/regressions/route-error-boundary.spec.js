// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A render throw on Home, History, Settings and the Send review shows the
// route error screen in a real browser: no stack, no error text and no
// wallet data on screen, "Go to Home" and "Try again" recover, and a throw
// during the Send review leaves no reservation behind. The throw is injected
// by rewriting the served route module, so the app code under test is
// unmodified.

import { createWallet, expect, gotoSection, nav, test, unlockedShell } from '../../fixtures/wallet.js';

const PASSWORD = 'boundary-password-1';
const WALLET_NAME = 'Boundary Wallet 7F3A';
const SECRET = 'SECRET-THROW-TEXT-91c2';
const VALID_BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const TARGETS = [
    { name: 'Home', file: /\/routes\/Home\.jsx/, symbol: 'Home' },
    { name: 'History', file: /\/routes\/History\.jsx/, symbol: 'History' },
    { name: 'Settings', file: /\/routes\/Settings\.jsx/, symbol: 'Settings' },
    { name: 'Send review', file: /\/components\/ConfirmActionModal\.jsx/, symbol: 'ConfirmActionModal' },
];

async function installThrowHooks(page) {
    await page.addInitScript(() => {
        window.__xcThrow = { symbol: null, afterReserve: false };
        window.__xcMessages = [];
    });
    for (const target of TARGETS) {
        await page.route(target.file, async (route) => {
            const response = await route.fetch();
            const source = await response.text();
            const head = `export function ${target.symbol}(`;
            if (!source.includes(head)) {
                await route.fulfill({ response, body: source });
                return;
            }
            const body = source.replace(head, `export function ${target.symbol}(...args) {
    const gate = globalThis.__xcThrow;
    const reserved = (globalThis.__xcMessages || []).some((m) => m.type === 'action.reserve');
    if (gate && gate.symbol === '${target.symbol}' && (!gate.afterReserve || reserved)) {
        throw new Error('${SECRET} abandon ability able');
    }
    return ${target.symbol}__real(...args);
}
function ${target.symbol}__real(`);
            await route.fulfill({ response, body });
        });
    }
    await page.route('**/src/messaging.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = '    return sendToHost(type, request);';
        if (!source.includes(original)) {
            await route.fulfill({ response, body: source });
            return;
        }
        await route.fulfill({
            response,
            body: source.replace(original, `    globalThis.__xcMessages?.push({ type, request });
    return sendToHost(type, request);`),
        });
    });
}

const setGate = (page, symbol, afterReserve = false) => page.evaluate(
    ([s, a]) => { window.__xcThrow = { symbol: s, afterReserve: a }; },
    [symbol, afterReserve],
);

async function expectBoundary(page) {
    const alert = page.getByRole('alert').filter({ hasText: "This screen couldn't be shown" });
    await expect(alert).toBeVisible();
    // The boundary's own text. The shell header outside it names the wallet by design.
    const text = await alert.innerText();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(WALLET_NAME);
    expect(text).not.toContain(VALID_BTC);
    expect(text).not.toMatch(/\bat\s+\S+\s+\(|\.jsx?:\d+|Error:/);
    await expect(alert.getByRole('button', { name: 'Go to Home' })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
    return alert;
}

const messages = (page, type) => page.evaluate((t) => window.__xcMessages.filter((m) => m.type === t), type);

test.describe('route error boundary in a real browser', () => {
    test.beforeEach(async ({ page }) => {
        await installThrowHooks(page);
        await createWallet(page, { password: PASSWORD, name: WALLET_NAME });
        await expect(unlockedShell(page)).toBeVisible();
    });

    for (const target of TARGETS.filter((t) => t.name !== 'Send review')) {
        test(`${target.name}: a render throw shows the recovery screen and Go to Home and Try again recover`, async ({ page }) => {
            // Settle on another screen first so the target renders fresh.
            if (target.name === 'Home') await gotoSection(page, 'History');
            await setGate(page, target.symbol);
            if (target.name === 'Home') await gotoSection(page, 'Home');
            else if (target.name === 'Settings') await page.getByRole('button', { name: /settings/i }).first().click();
            else await gotoSection(page, target.name);
            const alert = await expectBoundary(page);

            // The shell around it stays usable: the navigation is still there.
            await expect(nav(page)).toBeVisible();

            // Try again with the fault cleared brings the screen back.
            await setGate(page, null);
            await alert.getByRole('button', { name: 'Try again' }).click();
            await expect(page.getByRole('alert').filter({ hasText: "This screen couldn't be shown" })).toHaveCount(0);
        });
    }

    test('Go to Home leaves a failing screen for Home', async ({ page }) => {
        await setGate(page, 'History');
        await gotoSection(page, 'History');
        const alert = await expectBoundary(page);
        await alert.getByRole('button', { name: 'Go to Home' }).click();
        await expect(unlockedShell(page)).toBeVisible();
        await expect(page.getByRole('alert').filter({ hasText: "This screen couldn't be shown" })).toHaveCount(0);
    });

    test('Send review: a throw while the review renders reserves nothing', async ({ page }) => {
        await gotoSection(page, 'Send');
        const main = page.getByRole('main');
        await main.getByLabel('To', { exact: true }).fill(VALID_BTC);
        await main.getByRole('textbox', { name: /^Amount/ }).fill('0.01');
        await setGate(page, 'ConfirmActionModal');
        await main.locator('summary', { hasText: 'Advanced' }).click();
        await main.getByRole('button', { name: 'Send', exact: true }).click();
        await expectBoundary(page);
        expect(await messages(page, 'action.reserve')).toEqual([]);
        // Nothing to release either, and Home still opens.
        await setGate(page, null);
        await page.getByRole('alert').getByRole('button', { name: 'Go to Home' }).click();
        await expect(unlockedShell(page)).toBeVisible();
        expect(await messages(page, 'action.reserve')).toEqual([]);
    });

    test('Send review: a throw after Approve releases the reservation it took', async ({ page }) => {
        await gotoSection(page, 'Send');
        const main = page.getByRole('main');
        await main.getByLabel('To', { exact: true }).fill(VALID_BTC);
        await main.getByRole('textbox', { name: /^Amount/ }).fill('0.01');
        await main.locator('summary', { hasText: 'Advanced' }).click();
        await main.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Confirm' })).toBeVisible();
        await setGate(page, 'ConfirmActionModal', true);
        await page.getByRole('button', { name: 'Approve' }).click();
        await expectBoundary(page);
        const reserved = await messages(page, 'action.reserve');
        const released = await messages(page, 'action.releaseReservation');
        expect(reserved.length, 'the Approve took a reservation before the throw').toBeGreaterThan(0);
        expect(released.map((m) => m.request.id)).toEqual(reserved.map((m) => m.request.id));
    });
});
