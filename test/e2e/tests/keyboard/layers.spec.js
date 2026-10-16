// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Keyboard-only use of the layers and the main screens in demo mode: every
// popup closes on Escape and hands focus back, a dialog neither leaks focus
// nor traps it past Escape, and Send, Receive and Settings are reachable by
// Tab with a visible focus indicator on every stop.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const SIZES = [
    { name: 'phone', width: 360, height: 800 },
    { name: 'desktop', width: 1280, height: 800 },
];

// Where focus is, and whether it shows an outline or a ring.
const focusState = () => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const shadowed = Boolean(style.boxShadow) && style.boxShadow !== 'none';
    const box = el.getBoundingClientRect();
    return {
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().slice(0, 40),
        ringed: outlined || shadowed,
        visible: box.width > 0 && box.height > 0,
        inDialog: Boolean(el.closest('[role="dialog"]')),
    };
};

for (const size of SIZES) {
    test.describe(`keyboard layers at ${size.width}x${size.height}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.setViewportSize({ width: size.width, height: size.height });
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        });

        test('header menu opens by keyboard, closes on Escape and returns focus', async ({ page }) => {
            const trigger = page.getByRole('button', { name: 'Open menu' });
            await trigger.focus();
            await page.keyboard.press('Enter');
            const menu = page.getByRole('menu', { name: 'Header actions' });
            await expect(menu).toBeVisible();
            await expect(menu.getByRole('menuitem').first()).toBeFocused();
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('menuitem');
            await page.keyboard.press('Escape');
            await expect(menu).toBeHidden();
            await expect(trigger).toBeFocused();
        });

        test('command palette keeps focus inside, closes on Escape and returns focus', async ({ page }) => {
            const opener = page.getByRole('button', { name: 'Open menu' });
            await opener.focus();
            await page.keyboard.press('ControlOrMeta+k');
            const palette = page.getByRole('dialog', { name: 'Command palette' });
            await expect(palette).toBeVisible();
            for (let i = 0; i < 8; i += 1) {
                await page.keyboard.press('Tab');
                const state = await page.evaluate(focusState);
                expect(state?.inDialog, `Tab ${i + 1} stays in the palette (${state?.name})`).toBe(true);
            }
            await page.keyboard.press('Escape');
            await expect(palette).toBeHidden();
            await expect(opener, 'focus returns to the control it came from').toBeFocused();
        });

        test('shortcut help closes on Escape', async ({ page }) => {
            await page.keyboard.press('Shift+Slash');
            const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
            await expect(help).toBeVisible();
            for (let i = 0; i < 6; i += 1) {
                await page.keyboard.press('Tab');
                expect((await page.evaluate(focusState))?.inDialog, `Tab ${i + 1} stays in the help`).toBe(true);
            }
            await page.keyboard.press('Escape');
            await expect(help).toBeHidden();
        });

        test('balance actions menu closes when Tab leaves it', async ({ page }) => {
            const trigger = page.getByRole('button', { name: 'Balance actions' });
            test.skip(await trigger.count() === 0, 'Home shows its actions inline at this width');
            await trigger.focus();
            await page.keyboard.press('Enter');
            const menu = page.getByRole('menu', { name: 'Balance actions' });
            await expect(menu).toBeVisible();
            for (let i = 0; i < 12 && await menu.isVisible(); i += 1) await page.keyboard.press('Tab');
            await expect(menu, 'Tab past the last item closes the menu instead of leaving it open behind focus').toBeHidden();
        });

        test('wallet settings popover closes at its last control and returns focus to the opener', async ({ page }) => {
            await page.getByRole('button', { name: 'Open menu' }).focus();
            await page.keyboard.press('Enter');
            const opener = page.getByRole('menuitem', { name: 'Settings' });
            await opener.focus();
            await page.keyboard.press('Enter');
            const popover = page.getByRole('dialog', { name: 'Wallet settings' });
            await expect(popover).toBeVisible();
            // The popover is visible a frame before it moves focus to its first
            // control; a Tab in between lands on the menu row and closes the menu.
            await expect(popover.locator(':focus'), 'focus has moved into the popover').toHaveCount(1);
            const stops = [];
            for (let i = 0; i < 12 && await popover.isVisible(); i += 1) {
                await page.keyboard.press('Tab');
                if (await popover.isVisible()) stops.push(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))));
            }
            await expect(popover, 'Tab off the last control closes the popover').toBeHidden();
            expect(stops.every(Boolean), 'focus stays inside the popover until it closes').toBe(true);
            await expect(opener, 'focus returns to the control that opened it').toBeFocused();
        });

        test('opening a detail screen by keyboard puts focus on its heading', async ({ page }) => {
            await gotoSection(page, 'Dispensers');
            const row = page.getByRole('button', { name: /^Open .* dispenser #/ }).first();
            await row.focus();
            await page.keyboard.press('Enter');
            const heading = page.getByRole('heading', { level: 1, name: 'Dispenser detail' });
            await expect(heading).toBeVisible();
            await expect(heading, 'focus does not fall to the page body').toBeFocused();
        });

        for (const route of ['Send', 'Receive', 'Settings']) {
            test(`${route} is fully reachable by Tab with visible focus`, async ({ page }) => {
                await gotoSection(page, route);
                await expect(page.getByRole('heading', { level: 1, name: route, exact: true })).toHaveCount(1);
                await page.evaluate(() => document.activeElement?.blur());
                const stops = [];
                for (let i = 0; i < 60; i += 1) {
                    await page.keyboard.press('Tab');
                    const state = await page.evaluate(focusState);
                    if (!state) {
                        // The first Tab can land on the page itself; a later one
                        // means focus left for the browser, which ends the walk.
                        if (stops.length === 0 && i === 0) continue;
                        break;
                    }
                    stops.push(state);
                }
                expect(stops.length, 'Tab reaches controls').toBeGreaterThan(3);
                expect(stops.length, 'Tab leaves the page instead of looping inside it').toBeLessThan(60);
                expect(stops.filter((s) => !s.ringed).map((s) => s.name), 'stops without a focus indicator').toEqual([]);
                expect(stops.filter((s) => !s.visible).map((s) => s.name), 'focus on a hidden control').toEqual([]);
                expect(stops.filter((s) => s.tag === 'span').map((s) => s.name), 'text spans in the tab order').toEqual([]);
            });
        }
    });
}

// A sidebar-linked screen has no Back button, and a screen opened from a
// control that unmounts must still take focus on its heading, never the page body.
test.describe('keyboard focus on wide layouts at 1440x900', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    });

    test('a sidebar-linked screen without Back keeps focus off the page body', async ({ page }) => {
        const sidebarButton = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'History', exact: true });
        await sidebarButton.focus();
        await page.keyboard.press('Enter');
        const heading = page.getByRole('heading', { level: 1, name: 'History', exact: true });
        await expect(heading).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to previous screen' }), 'no Back beside the sidebar').toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement === document.body), 'focus is on a control').toBe(false);
    });

    test('the Receive address picker opened by keyboard puts focus on its heading', async ({ page }) => {
        await gotoSection(page, 'Receive');
        const opener = page.getByRole('button', { name: /address/i }).first();
        await opener.focus();
        await page.keyboard.press('Enter');
        const heading = page.getByRole('heading', { level: 1, name: 'Choose a receive address' });
        await expect(heading).toBeVisible();
        await expect(heading, 'focus does not fall to the page body').toBeFocused();
    });

    test('the command palette finds Receive by name and opens it', async ({ page }) => {
        await page.keyboard.press('ControlOrMeta+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await expect(palette).toBeVisible();
        await page.keyboard.type('Receive');
        await expect(palette.getByText('No matches')).toHaveCount(0);
        await expect(palette.getByRole('option', { name: /Receive/ }).first()).toBeVisible();
        await page.keyboard.press('Enter');
        const heading = page.getByRole('heading', { level: 1, name: 'Receive', exact: true });
        await expect(heading).toBeVisible();
        expect(await page.evaluate(() => document.activeElement === document.body), 'focus is not lost to the page body').toBe(false);
    });
});
