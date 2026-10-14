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
