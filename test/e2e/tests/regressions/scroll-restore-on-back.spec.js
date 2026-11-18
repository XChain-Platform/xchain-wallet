// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Back returns a list to where the user left it. The shell restored the
// saved offset before the list had loaded, so the browser clamped it to the
// height rendered so far: scrolled to 1820, History came back at 822, and
// Back from a Settings section at 360x800 landed at 213 instead of 586.
// Each walk scrolls a list with the wheel, opens a row, goes Back, and
// checks the offset, that it stays put once reached, and that focus is on
// the row the user opened.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 360, height: 800 },
    { name: 'desktop', width: 1290, height: 850 },
];

// Enough extra contacts that the list scrolls at both sizes.
const EXTRA_CONTACTS = 40;
// Contacts answer late, as a slow vault read would, so the list is short
// when the screen first mounts.
const CONTACTS_DELAY_MS = 600;

const main = (page) => page.locator('#xc-main');
const scrollTop = (page, panel = main(page)) => panel.evaluate((el) => Math.round(el.scrollTop));

// At desktop width History and Contacts are two-panel: the list scrolls in its
// own region and a row opens its detail beside it, so there is no Back.
const isWide = (viewport) => viewport.width >= 1000;

/** Pads the contact list and delays its answer through the web messaging seam. */
async function installLongContactList(page) {
    await page.addInitScript(({ extra, delayMs }) => {
        globalThis.__xchainScrollRestoreE2E = { extra, delayMs };
    }, { extra: EXTRA_CONTACTS, delayMs: CONTACTS_DELAY_MS });

    await page.route('**/src/messaging.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = `    const { sendMessage: sendToHost } = await loadHostBridge();
    return sendToHost(type, request);`;
        const replacement = `    const { sendMessage: sendToHost } = await loadHostBridge();
    const fixture = globalThis.__xchainScrollRestoreE2E;
    if (fixture && type === 'contacts.list') {
        const rows = await sendToHost(type, request);
        await new Promise((resolve) => setTimeout(resolve, fixture.delayMs));
        const list = Array.isArray(rows) ? rows : [];
        const base = list[0];
        if (!base) return list;
        const padded = Array.from({ length: fixture.extra }, (_, i) => ({
            ...base,
            id: 'e2e-scroll-' + i,
            name: 'Scroll Contact ' + String(i + 1).padStart(2, '0'),
        }));
        return [...list, ...padded];
    }
    return sendToHost(type, request);`;
        if (!source.includes(original)) {
            throw new Error('The web messaging seam changed; update the contact list fixture.');
        }
        await route.fulfill({ response, body: source.replace(original, replacement) });
    });
}

/** Scrolls the route body with the mouse wheel, the way a user does, and waits for it to settle. */
async function wheelScroll(page, deltaY, panel = main(page)) {
    const box = await panel.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
    const start = await scrollTop(page, panel);
    await page.mouse.wheel(0, deltaY);
    // The wheel scroll lands a frame or more later: wait for it to move, then
    // for two equal readings in a row.
    let last = -1;
    await expect.poll(async () => {
        const now = await scrollTop(page, panel);
        const settled = now !== start && now === last;
        last = now;
        return settled;
    }, { intervals: [150] }).toBe(true);
    return scrollTop(page, panel);
}

/**
 * Picks the element matching `selector` whose middle sits closest to the
 * middle of the visible route body, so the opened row is one the user saw.
 */
async function nearestVisible(page, selector, panel = main(page)) {
    const index = await panel.evaluate((body, sel) => {
        const view = body.getBoundingClientRect();
        const middle = (view.top + view.bottom) / 2;
        let best = -1;
        let bestDistance = Infinity;
        [...body.querySelectorAll(sel)].forEach((el, i) => {
            const box = el.getBoundingClientRect();
            if (box.top < view.top || box.bottom > view.bottom) return;
            const distance = Math.abs((box.top + box.bottom) / 2 - middle);
            if (distance < bestDistance) {
                best = i;
                bestDistance = distance;
            }
        });
        return best;
    }, selector);
    expect(index, `no ${selector} fully inside the scrolled body`).toBeGreaterThanOrEqual(0);
    return panel.locator(selector).nth(index);
}

/** Back lands on the saved offset, stays there, and focuses the opened row. */
async function expectRestored(page, saved, row, label, panel = main(page)) {
    await expect.poll(() => scrollTop(page, panel), { message: `${label}: offset after Back` })
        .toBeGreaterThanOrEqual(saved - 2);
    expect(Math.abs(await scrollTop(page, panel) - saved), `${label}: offset after Back`).toBeLessThanOrEqual(2);
    // The late half of the bug: no jump once the content finishes loading.
    await page.waitForTimeout(800);
    expect(Math.abs(await scrollTop(page, panel) - saved), `${label}: offset moved after it was restored`)
        .toBeLessThanOrEqual(2);
    await expect(row, `${label}: focus did not return to the opened row`).toBeFocused();
}

for (const viewport of VIEWPORTS) {
    test.describe(`scroll restore on Back at ${viewport.width}x${viewport.height}`, () => {
        test.beforeEach(async ({ page }) => {
            test.slow();
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
        });

        test('History returns from a transaction to the scrolled row', async ({ page }) => {
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
            await gotoSection(page, 'History');
            await expect(page.locator('[data-history-row]')).toHaveCount(27);

            const panel = isWide(viewport)
                ? page.getByRole('region', { name: 'History entries' })
                : main(page);
            const saved = await wheelScroll(page, 1000, panel);
            expect(saved, 'History did not scroll').toBeGreaterThan(300);
            const row = await nearestVisible(page, '[data-history-key] button[data-history-row]', panel);
            const key = await row.evaluate((el) => el.closest('[data-history-key]').getAttribute('data-history-key'));
            await row.click();
            if (isWide(viewport)) {
                // The detail opens beside the list, which keeps its place and the row.
                await expect(row, 'History: the opened row is not selected').toBeFocused();
                await page.waitForTimeout(800);
                expect(Math.abs(await scrollTop(page, panel) - saved), 'History: the list moved when a row opened')
                    .toBeLessThanOrEqual(2);
                return;
            }
            const back = page.getByRole('button', { name: 'Back to history', exact: true });
            await expect(back).toBeVisible();
            await back.click();

            const returned = main(page).locator(`[data-history-key="${key}"] button[data-history-row]`);
            await expectRestored(page, saved, returned, `${viewport.name} History`, panel);
        });

        test('a Settings section returns to the list row, and Settings still opens at the top', async ({ page }) => {
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
            // The grouped Settings list is only a little taller than a tall phone, so
            // a short window makes it scroll the way a small screen does.
            await page.setViewportSize({ width: viewport.width, height: Math.min(viewport.height, 400) });
            await openSettings(page);
            // About moved to the top of Settings (2026-11-15), so the row at the
            // end of the list, Advanced, is the one a scrolled list returns to.
            const about = main(page).getByRole('button', { name: /^Advanced\b/ });
            await expect(about).toBeVisible();

            const saved = await wheelScroll(page, 5000);
            expect(saved, 'Settings did not scroll').toBeGreaterThan(300);
            await about.click();
            const back = page.getByRole('button', { name: 'Back to settings', exact: true });
            await expect(back).toBeVisible();
            expect(await scrollTop(page), 'a Settings section opens at the top').toBe(0);
            await back.click();

            await expectRestored(page, saved, about, `${viewport.name} Settings`);

            // Leaving Settings and opening it again starts at the first row.
            await gotoSection(page, 'History');
            await expect(page.locator('[data-history-row]').first()).toBeVisible();
            await openSettings(page);
            await expect(main(page).getByRole('button', { name: /^About\b/ })).toBeAttached();
            await page.waitForTimeout(500);
            expect(await scrollTop(page), 'Settings reopened part way down').toBe(0);
        });

        test('a long Contacts list returns from a contact to the scrolled row', async ({ page }) => {
            await installLongContactList(page);
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
            await gotoSection(page, 'Contacts');
            const list = page.getByRole('list', { name: 'Contacts' });
            await expect(list.getByRole('button')).toHaveCount(5 + EXTRA_CONTACTS);

            const panel = isWide(viewport)
                ? page.getByRole('region', { name: 'Contacts' }).first()
                : main(page);
            const saved = await wheelScroll(page, 1400, panel);
            expect(saved, 'Contacts did not scroll').toBeGreaterThan(300);
            const row = await nearestVisible(page, 'ul[aria-label="Contacts"] button', panel);
            const name = await row.getAttribute('aria-label');
            await row.click();
            if (isWide(viewport)) {
                // The contact opens beside the list, which keeps its place.
                await expect(page.getByRole('button', { name: 'Send', exact: false }).first()).toBeVisible();
                await page.waitForTimeout(800);
                expect(Math.abs(await scrollTop(page, panel) - saved), 'Contacts: the list moved when a contact opened')
                    .toBeLessThanOrEqual(2);
                return;
            }
            await expect(page.getByRole('heading', { name: 'View Contact' })).toBeVisible();
            await page.getByRole('button', { name: 'Back to previous screen', exact: true }).click();

            const returned = list.getByRole('button', { name, exact: true });
            await expectRestored(page, saved, returned, `${viewport.name} Contacts`, panel);
        });
    });
}
