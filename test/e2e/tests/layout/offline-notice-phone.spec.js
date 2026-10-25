// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Offline on a phone: the plain-text confirmation's safe button reads at 4.5:1
// on whatever notice it sits in, and a wallet with no saved balance is told
// only that sending needs a connection (the cached-balance line is for a
// wallet that has one).

import { createWallet, expect, gotoSection, test } from '../../fixtures/wallet.js';

async function goOffline(page) {
    await page.evaluate(() => {
        Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
        window.dispatchEvent(new Event('offline'));
    });
}

test.use({ viewport: { width: 360, height: 800 } });

test('the plain-text confirmation keeps its safe button readable offline', async ({ page }, info) => {
    await createWallet(page);
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await dialog.getByRole('combobox').first().fill('Messaging');
    await page.getByRole('option', { name: /^Messaging\b/ }).first().click();
    await page.getByRole('main').getByRole('button', { name: /^(New conversation|New message)$/ }).first().click();
    await goOffline(page);
    await page.getByRole('button', { name: /^Encryption:/ }).click();
    await page.getByRole('option', { name: /^Plain text/ }).click();
    const keep = page.getByRole('button', { name: 'Keep encrypted', exact: true });
    await expect(keep).toBeVisible();
    await page.screenshot({ path: info.outputPath('keep-encrypted.png') });

    const ratio = await keep.evaluate((el) => {
        const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
        const over = (f, b) => [0, 1, 2].map((i) => f[i] * (f[3] ?? 1) + b[i] * (1 - (f[3] ?? 1)));
        let bg = [255, 255, 255];
        const chain = [];
        for (let n = el; n; n = n.parentElement) chain.unshift(n);
        for (const n of chain) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c.length >= 3 && (c[3] ?? 1) > 0) bg = over(c, bg);
        }
        const fg = over(parse(getComputedStyle(el).color), bg);
        const lum = (c) => {
            const [r, g, b] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
        return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio, `Keep encrypted reads at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
});

test('a wallet with no saved balance offline sees one message on Send', async ({ page }) => {
    await createWallet(page);
    await goOffline(page);
    // A fresh wallet has no saved balance: drop the copy Home wrote.
    await page.evaluate(() => {
        for (const k of Object.keys(localStorage)) if (k.startsWith('xc:balanceCache:')) localStorage.removeItem(k);
    });
    await gotoSection(page, 'Send');
    await expect(page.getByText('Sending needs a network connection.', { exact: true })).toBeVisible();
    await expect(page.getByText(/cached balance remains available/i)).toHaveCount(0);
});
