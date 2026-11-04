// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Chip toggles, the NetworkFilter trigger, ChainPicker and IconSelect carry
// Button's btn class (ruling U07: one shared sizing base), and each keeps its
// own 1px edge, surface and pressed fill on top of it. A cross-file
// `composes` from Button.module.css inlines a copy of Button's sheet that
// re-asserts `.btn { border: 1px solid transparent }` over every sheet loaded
// before it, which left the border 1px wide but invisible and gave the
// pressed chip the button's ring. A jsdom test blanks CSS modules and cannot
// see the cascade, so this reads computed styles in the real app: once on a
// cold load, and again after the cross-chain swap form, whose TokenField
// composes Button and so loads such a copy late.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

/** Alpha of a computed `rgb()` or `rgba()` colour; 0 when it is transparent. */
function alpha(colour) {
    if (colour === 'transparent') return 0;
    const parts = /rgba?\(([^)]+)\)/.exec(colour)?.[1].split(/[\s,/]+/).filter(Boolean) ?? [];
    return parts.length === 4 ? Number(parts[3]) : 1;
}

async function expectVisibleEdge(label, control, { pressed = false, surface = false } = {}) {
    await expect(control, `${label} is not visible`).toBeVisible();
    const style = await control.evaluate((element) => {
        const s = getComputedStyle(element);
        return {
            width: s.borderTopWidth,
            style: s.borderTopStyle,
            colour: s.borderTopColor,
            background: s.backgroundColor,
            boxShadow: s.boxShadow,
        };
    });
    const detail = `${label}: ${JSON.stringify(style)}`;
    expect(parseFloat(style.width), `${detail}\nborder is not at least 1px`).toBeGreaterThanOrEqual(1);
    expect(style.style, `${detail}\nborder has no style`).not.toBe('none');
    expect(alpha(style.colour), `${detail}\nborder colour is transparent`).toBeGreaterThan(0);
    if (surface) expect(alpha(style.background), `${detail}\nsurface is transparent`).toBeGreaterThan(0);
    // The pressed Chip shows its selected fill, never the shared button's ring.
    if (pressed) expect(style.boxShadow, `${detail}\npressed chip draws a ring`).toBe('none');
}

async function openPaletteRoute(page, query, option) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(query);
    await palette.getByRole('option', { name: option }).first().click();
    await expect(palette).toBeHidden();
}

async function checkControls(page, pass) {
    const main = page.getByRole('main');

    await test.step(`${pass} / History chips`, async () => {
        await gotoSection(page, 'History');
        const presets = main.getByRole('group', { name: 'Date range presets' });
        await expectVisibleEdge('7 days preset', presets.getByRole('button', { name: '7 days', exact: true }));
        const thirty = presets.getByRole('button', { name: '30 days', exact: true });
        await expect(thirty).toHaveAttribute('aria-pressed', 'true');
        await expectVisibleEdge('pressed 30 days preset', thirty, { pressed: true });
        await expectVisibleEdge('All dates preset', presets.getByRole('button', { name: 'All dates', exact: true }));
        await expectVisibleEdge('More filters chip', main.getByRole('button', { name: 'More filters' }));
        await expectVisibleEdge('fiat chip', main.getByRole('button', { name: /^Show fiat:/ }));
    });

    await test.step(`${pass} / NetworkFilter trigger on Contacts`, async () => {
        await gotoSection(page, 'Contacts');
        await expectVisibleEdge('Contacts network filter', main.getByRole('button', { name: /^Filter by network/ }), { surface: true });
    });

    await test.step(`${pass} / NetworkFilter trigger on Addresses`, async () => {
        await openPaletteRoute(page, 'Addresses', /^Addresses/);
        await expectVisibleEdge('Addresses network filter', main.getByRole('button', { name: /^Filter by network/ }), { surface: true });
    });

    await test.step(`${pass} / IconSelect triggers`, async () => {
        await gotoSection(page, 'Messaging');
        await main.getByRole('button', { name: 'New conversation' }).click();
        await expectVisibleEdge('encryption select', main.getByRole('button', { name: /^Encryption:/ }), { surface: true });
        await expectVisibleEdge('delivery network select', main.getByRole('button', { name: /^Delivery network:/ }), { surface: true });
    });

    await test.step(`${pass} / ChainPicker triggers`, async () => {
        await openPaletteRoute(page, 'Cross-chain swap', /^Cross-chain swap/);
        await expectVisibleEdge('give network picker', main.getByRole('button', { name: /^Give network:/ }), { surface: true });
        await expectVisibleEdge('get network picker', main.getByRole('button', { name: /^Get network:/ }), { surface: true });
        // The same form mounts TokenField, so its Button copy is loaded from here on.
        await expect(main.getByRole('button', { name: /^Give token:/ })).toBeVisible();
    });
}

test('chip and picker triggers keep a visible edge over the shared button base', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    await checkControls(page, 'cold');
    // The first pass ended on the cross-chain swap form, whose TokenField
    // composes Button and so has loaded a late Button.module.css copy.
    await checkControls(page, 'after TokenField');
});
