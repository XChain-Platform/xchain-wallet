// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §33 Command Palette under a failing network. The palette builds its
// catalogue from local state (routes, contacts, sites, Home's balance rows),
// so a price feed that answers 500, answers late, answers garbage, or a
// browser that drops offline mid-session must leave it working: it opens
// from the shortcut and from the header menu, filters, keeps keyboard focus
// in its search field, and a routed money command lands on the right form
// with only the amount the user typed (never a figure carried over from a
// failed read). Each case runs at a phone width and at a desktop width.
//
// The dev server runs the in-process mock SDK, so balance reads never leave
// the page; the network this spec can break is the price feed, the hub
// registry, and the browser's own connectivity.

import {
    test, expect, createWallet, nav, commandPalette, openPaletteSearch,
} from '../../fixtures/wallet.js';

const PRICE_GLOB = 'https://api.coingecko.com/api/v3/**';
const REGISTRY_GLOB = 'https://hub.xchain.io/api/v1/chain-registry**';
// fetchWithRetry gives up on a request after 8 s; a reply held this long
// arrives after the app has already timed it out.
const PAST_FETCH_TIMEOUT_MS = 9_000;

const VIEWPORTS = [
    { label: '360px', use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
    { label: '1440px', use: { viewport: { width: 1440, height: 900 } } },
];

const navItem = (page, name) => nav(page).getByRole('button', { name, exact: true });

/**
 * Breaks the price feed and the hub registry the way `mode` says. A page
 * route takes precedence over the fixture's context-level stubs, so the
 * healthy answers come back the moment the route is removed.
 */
async function breakOracle(page, mode) {
    const handler = async (route) => {
        if (mode === '500') {
            await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"internal"}' });
            return;
        }
        if (mode === 'malformed') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"bitcoin": {"usd": 65' });
            return;
        }
        if (mode === 'wrong-shape') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ price: 'NaN' }, null, 'x']) });
            return;
        }
        if (mode === 'slow') {
            await new Promise((resolve) => { setTimeout(resolve, PAST_FETCH_TIMEOUT_MS); });
            await route.fallback().catch(() => { /* page closed while the reply was held */ });
        }
    };
    await page.route(PRICE_GLOB, handler);
    await page.route(REGISTRY_GLOB, handler);
    return async () => {
        await page.unroute(PRICE_GLOB, handler);
        await page.unroute(REGISTRY_GLOB, handler);
    };
}

/** Opens the palette from the header's action menu, wherever the layout keeps it. */
async function openFromHeader(page) {
    const dialog = commandPalette(page);
    await expect(async () => {
        if (await dialog.isVisible()) return;
        const direct = page.getByRole('button', { name: /^Search/ }).first();
        if (await direct.isVisible().catch(() => false)) {
            await direct.click({ timeout: 3_000 });
        } else {
            await page.getByRole('button', { name: 'Open menu' }).click({ timeout: 3_000 });
            await page.getByRole('menuitem', { name: /^Search/ }).click({ timeout: 3_000 });
        }
        await expect(dialog).toBeVisible({ timeout: 3_000 });
    }, 'the header menu never opened the command palette').toPass({ timeout: 30_000 });
    return dialog;
}

/** The palette opens, filters, and keeps focus in its search field. */
async function expectPaletteWorks(page, dialog) {
    const search = dialog.getByRole('combobox', { name: 'Search commands' });
    await expect(search).toBeFocused();
    await search.fill('receive');
    await expect(dialog.getByRole('option', { name: /^Receive/ }).first()).toBeVisible();
    await expect(search).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(search).toBeFocused();
    // Token rows carry no amount, and every listed one opens its detail page.
    await search.fill('pepecash');
    const tokenRows = dialog.getByRole('option', { name: /Pepe Cash/ });
    const count = await tokenRows.count();
    for (let i = 0; i < count; i += 1) {
        await expect(tokenRows.nth(i)).not.toContainText(/\b(?:NaN|undefined|null)\b/);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
}

/** A routed money action lands on its form with only the typed amount. */
async function expectMoneyRoutes(page) {
    const dialog = await openPaletteSearch(page, 'send 7 XCP');
    await expect(dialog.getByRole('option').first()).toContainText('Send 7 XCP');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(navItem(page, 'Send')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('textbox', { name: /^Amount/ })).toHaveValue('7');
    await expect(page.getByRole('main')).not.toContainText(/\bNaN\b|\bundefined\b/);

    await openPaletteSearch(page, 'receive');
    await page.keyboard.press('Enter');
    await expect(commandPalette(page)).toBeHidden();
    await expect(page.getByRole('heading', { name: /Receive/ }).first()).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(/\bNaN\b|\bundefined\b/);
}

/** Runs the plain Send command (not a free-form intent) from the palette. */
async function runPlainSend(page) {
    const sendDialog = await openPaletteSearch(page, 'send');
    await sendDialog.getByRole('option', { name: /^Send\b/ }).filter({ hasNotText: /Send \d/ }).first().click();
    await expect(sendDialog).toBeHidden();
    await expect(navItem(page, 'Send')).toHaveAttribute('aria-current', 'page');
}

for (const vp of VIEWPORTS) {
    test.describe(`command palette on a failing network at ${vp.label}`, () => {
        test.use(vp.use);

        for (const mode of ['500', 'malformed', 'wrong-shape', 'slow']) {
            test(`price feed and registry answer ${mode}: palette and money routes hold, then recover`, async ({ page }) => {
                // Broken from boot, so every price and registry read the
                // page makes fails the same way.
                const restore = await breakOracle(page, mode);
                await createWallet(page);

                // While the failing reads are in flight.
                const dialogKeys = await openPaletteSearch(page, '');
                await expectPaletteWorks(page, dialogKeys);
                await expectPaletteWorks(page, await openFromHeader(page));
                await expectMoneyRoutes(page);

                // After the feed recovers.
                await restore();
                await expectPaletteWorks(page, await openFromHeader(page));
                await expectMoneyRoutes(page);
            });
        }

        test('an abandoned free-form send leaves no amount in a later plain Send', async ({ page }) => {
            await createWallet(page);
            const dialog = await openPaletteSearch(page, 'send 5 XCP');
            await expect(dialog.getByRole('option').first()).toContainText('Send 5 XCP');
            await page.keyboard.press('Enter');
            await expect(dialog).toBeHidden();
            await expect(navItem(page, 'Send')).toHaveAttribute('aria-current', 'page');
            await expect(page.getByRole('textbox', { name: /^Amount/ })).toHaveValue('5');
            await expect(page.getByRole('button', { name: 'Change asset (currently XCP)' })).toBeVisible();

            // Abandoned without submitting: the plain Send command opens a
            // blank form, carrying neither the typed amount nor the token.
            await runPlainSend(page);
            await expect(page.getByRole('textbox', { name: /^Amount/ })).toHaveValue('');
            await expect(page.getByRole('button', { name: 'Change asset (currently XCP)' })).toHaveCount(0);
        });

        test('the browser drops offline mid-session: palette and money routes hold, then recover', async ({ page, context }) => {
            await createWallet(page);
            // Each route chunk loads once online, so the offline pass tests
            // the screens and not the dev server reaching the browser.
            await expectMoneyRoutes(page);
            await context.setOffline(true);
            await expectPaletteWorks(page, await openPaletteSearch(page, ''));
            await expectPaletteWorks(page, await openFromHeader(page));
            await expectMoneyRoutes(page);

            await context.setOffline(false);
            await expectPaletteWorks(page, await openFromHeader(page));
            await expectMoneyRoutes(page);
        });
    });
}
