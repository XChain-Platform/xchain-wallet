// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every card looks the same: walk the key routes of the demo wallet at a
// phone, a tablet and a desktop size and measure each bordered card in the
// page content. All of them share one solid 1px border in the border colour,
// the card radius and the card padding (or none, for a flush list whose rows
// carry their own), no card sits inside another, and nothing in the content
// draws a dashed or dotted line.

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
    { width: 360, height: 800 },
    { width: 768, height: 1024 },
    { width: 1290, height: 850 },
];

const ROUTES = [
    { label: 'Home coins', open: (page) => gotoSection(page, 'Home') },
    { label: 'Home tokens', open: async (page) => { await gotoSection(page, 'Home'); await homeTab(page, 'Tokens'); } },
    { label: 'Home NFTs', open: async (page) => { await gotoSection(page, 'Home'); await homeTab(page, 'NFTs'); } },
    { label: 'History', open: (page) => gotoSection(page, 'History') },
    { label: 'Send', open: (page) => gotoSection(page, 'Send') },
    { label: 'Receive', open: (page) => gotoSection(page, 'Receive') },
    { label: 'Staking positions', open: (page) => palette(page, 'Your staking positions') },
    { label: 'Saved addresses', open: (page) => palette(page, 'Your saved addresses') },
    { label: 'Issue a token', open: (page) => palette(page, 'Issue a token directly') },
    { label: 'Settings', open: (page) => openSettings(page) },
    { label: 'Settings This wallet', open: (page) => settingsSection(page, 'This wallet') },
    { label: 'Settings Fees', open: (page) => settingsSection(page, 'Fees') },
    { label: 'Settings About', open: (page) => settingsSection(page, 'About') },
];

async function homeTab(page, name) {
    const tab = page.getByRole('tab', { name }).or(page.getByRole('button', { name, exact: true })).first();
    await tab.click();
}

async function palette(page, destination) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill(destination);
    await dialog.getByRole('option').filter({ hasText: destination }).first().click();
    await expect(dialog).toBeHidden();
}

async function settingsSection(page, name) {
    await openSettings(page);
    await page.getByRole('main').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
    await expect(page.getByRole('button', { name: 'Back to settings' }).first()).toBeVisible();
}

async function settle(page) {
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await page.waitForTimeout(300);
}

/**
 * Runs in the page. Returns each card that breaks the shared look, each card
 * inside a card, and each dashed or dotted line in the page content.
 */
function cardFaults() {
    const main = document.querySelector('main');
    if (!main) return { cards: 0, faults: ['no main landmark'] };
    const rootStyle = getComputedStyle(document.documentElement);
    const pad = rootStyle.getPropertyValue('--xc-card-pad').trim();
    const radius = rootStyle.getPropertyValue('--xc-card-radius').trim();
    const probe = document.createElement('div');
    probe.style.border = '1px solid var(--xc-border)';
    document.body.append(probe);
    const borderColor = getComputedStyle(probe).borderTopColor;
    probe.remove();

    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const corners = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];
    const overlay = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"]';
    const interactive = 'button, input, select, textarea, a, summary, label, [role="button"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"]';
    const describe = (el) => {
        const cls = [...el.classList].map((c) => c.replace(/^_|_[a-z0-9]{5}(_\d+)?$/gi, '')).slice(0, 3).join('.');
        const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 32);
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${text}"`;
    };
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };

    const faults = [];
    const cards = [];
    for (const el of main.querySelectorAll('*')) {
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        for (const side of sides) {
            if (/dashed|dotted/.test(cs[`border${side}Style`]) && parseFloat(cs[`border${side}Width`]) > 0) {
                faults.push(`${describe(el)}: ${cs[`border${side}Style`]} border`);
                break;
            }
        }
        if (/dashed|dotted/.test(cs.outlineStyle) && parseFloat(cs.outlineWidth) > 0) {
            faults.push(`${describe(el)}: ${cs.outlineStyle} outline`);
        }

        // A card: a neutral-bordered, rounded, non-interactive box in the
        // page flow. Tone notices (coloured borders), controls, overlays,
        // monospace value boxes and media frames are other surfaces.
        if (el.matches(interactive) || el.closest(overlay)) continue;
        if (cs.position === 'absolute' || cs.position === 'fixed') continue;
        if (!sides.every((s) => cs[`border${s}Style`] !== 'none' && parseFloat(cs[`border${s}Width`]) > 0)) continue;
        if (!sides.every((s) => cs[`border${s}Color`] === borderColor)) continue;
        const r = el.getBoundingClientRect();
        const rad = parseFloat(cs.borderTopLeftRadius);
        if (!(rad > 0) || rad >= Math.min(r.width, r.height) / 2 || r.height < 40) continue;
        if (/monospace|ui-monospace|Menlo|Consolas/i.test(cs.fontFamily.split(',')[0])) continue;
        // A QR or media frame holds its artwork directly; it is not a card.
        if (el.querySelector(':scope > canvas, :scope > video, :scope > svg[role="img"], :scope > img, :scope > * > img[alt*="QR" i]')) continue;
        cards.push(el);

        const style = new Set(sides.map((s) => `${cs[`border${s}Style`]} ${cs[`border${s}Width`]}`));
        if (style.size !== 1 || ![...style][0].startsWith('solid 1px')) faults.push(`${describe(el)}: border ${[...style].join(' / ')}`);
        const radii = new Set(corners.map((c) => cs[`border${c}Radius`]));
        if (radii.size !== 1 || ![...radii][0].startsWith(radius)) faults.push(`${describe(el)}: radius ${[...radii].join(' ')}, card radius ${radius}`);
        const pads = new Set(sides.map((s) => cs[`padding${s}`]));
        const padding = [...pads].join(' ');
        if (pads.size !== 1 || (padding !== pad && padding !== '0px')) faults.push(`${describe(el)}: padding ${padding}, card padding ${pad}`);
    }
    for (const card of cards) {
        const outer = cards.find((other) => other !== card && other.contains(card));
        if (outer) faults.push(`${describe(card)}: card inside ${describe(outer)}`);
    }
    return { cards: cards.length, faults };
}

for (const viewport of VIEWPORTS) {
    test(`every card shares one border, radius and padding at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.setTimeout(10 * 60 * 1000);
        await page.setViewportSize(viewport);
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

        const faults = [];
        let measured = 0;
        for (const route of ROUTES) {
            await route.open(page);
            await settle(page);
            const result = await page.evaluate(cardFaults);
            measured += result.cards;
            faults.push(...result.faults.map((fault) => `${route.label}: ${fault}`));
        }

        // The walk must have found cards to measure, or it proved nothing.
        expect(measured).toBeGreaterThan(5);
        expect(faults).toEqual([]);
    });
}
