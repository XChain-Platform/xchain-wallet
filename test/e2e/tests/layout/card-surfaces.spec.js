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
// phone, a tablet and a desktop size, with the Settings inline forms opened,
// and the Locked screen with its lockout notice and forgot-password panel,
// and measure each bordered card in the page content. All of them share one
// solid 1px border in the border colour, the card radius and the card
// padding (or none, for a flush list whose rows carry their own), no card or
// other bordered or filled box sits inside a card (a notice uses the shared
// StatusMessage instead), and nothing in the content draws a dashed or
// dotted line.

import {
    createWallet,
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
    { label: 'Home activity', rows: true, open: async (page) => { await gotoSection(page, 'Home'); await homeTab(page, 'Activity'); } },
    { label: 'History', rows: true, open: (page) => gotoSection(page, 'History') },
    { label: 'Send', open: (page) => gotoSection(page, 'Send') },
    { label: 'Receive', open: (page) => gotoSection(page, 'Receive') },
    { label: 'Staking positions', open: (page) => palette(page, 'Your staking positions') },
    { label: 'Saved addresses', open: (page) => palette(page, 'Your saved addresses') },
    { label: 'Issue a token', open: (page) => palette(page, 'Issue a token directly') },
    { label: 'DEX market detail', open: (page) => openFirst(page, 'DEX', page.getByRole('main').getByRole('button').filter({ hasText: /\// })) },
    { label: 'Dispenser detail', open: (page) => openFirst(page, 'Dispensers', page.getByRole('main').locator('li').getByRole('button')) },
    { label: 'My orders', open: (page) => palette(page, 'My orders') },
    { label: 'Settings', open: (page) => openSettings(page) },
    { label: 'Settings This wallet', open: (page) => settingsSection(page, 'This wallet') },
    { label: 'Settings This wallet Export', form: true, open: (page) => settingsForm(page, 'This wallet', 'Export…') },
    { label: 'Settings This wallet Change password', form: true, open: (page) => settingsForm(page, 'This wallet', 'Change…') },
    { label: 'Settings This wallet Remove', form: true, open: (page) => settingsForm(page, 'This wallet', 'Remove…') },
    { label: 'Settings Backup Export', form: true, open: (page) => settingsForm(page, 'Backup', 'Export…') },
    { label: 'Settings Backup Show phrase', form: true, open: (page) => settingsForm(page, 'Backup', 'Show…') },
    { label: 'Settings Backup Test', form: true, open: (page) => settingsForm(page, 'Backup', 'Test…') },
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

/** Opens a section and then the first item its list offers. */
async function openFirst(page, section, items) {
    await gotoSection(page, section);
    await items.first().click();
    await expect(page.getByRole('button', { name: /^Back/ }).first()).toBeVisible();
    await page.waitForTimeout(1000);
}

async function settingsSection(page, name) {
    await openSettings(page);
    // Settings reopens on the last section; step back to the list first.
    const back = page.getByRole('button', { name: 'Back to settings' }).filter({ visible: true }).first();
    if (await back.count()) await back.click();
    await page.getByRole('main').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
    await expect(page.getByRole('button', { name: 'Back to settings' }).first()).toBeVisible();
}

/** Opens a Settings section and then one of its inline forms by the row's action. */
async function settingsForm(page, section, action) {
    await settingsSection(page, section);
    await page.getByRole('main').getByRole('button', { name: action, exact: true }).first().click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).first()).toBeVisible();
}

/** Locks from whichever lock control this width shows. */
async function lock(page) {
    await page.getByRole('button', { name: /^Lock( wallet)?$/ }).filter({ visible: true }).first().click();
    await expect(page.getByRole('button', { name: 'Unlock Wallet' })).toBeVisible();
}

/** Reopens the Locked screen with a stored lockout that has minutes left. */
async function showLockout(page) {
    await page.evaluate(() => localStorage.setItem(
        'xchain-wallet:lockout',
        JSON.stringify({ failedAttempts: 6, lockedUntilMs: Date.now() + 5 * 60 * 1000 }),
    ));
    // The dev server keeps a request open, so the load event never fires.
    await page.reload({ waitUntil: 'commit' });
    await expect(page.getByText(/Too many incorrect passwords/)).toBeVisible({ timeout: 60_000 });
}

/**
 * Runs in the page. Home's Activity tab and History draw one list the same
 * way: the rows of a list sit in one flush card with dividers between them,
 * never a bordered card per row.
 */
function rowListFaults() {
    const main = document.querySelector('main');
    const probe = document.createElement('div');
    probe.style.border = '1px solid var(--xc-border)';
    document.body.append(probe);
    const borderColor = getComputedStyle(probe).borderTopColor;
    probe.remove();
    const isCard = (el) => {
        const cs = getComputedStyle(el);
        return ['Top', 'Right', 'Bottom', 'Left'].every((side) => cs[`border${side}Style`] === 'solid'
            && cs[`border${side}Width`] === '1px' && cs[`border${side}Color`] === borderColor);
    };
    const rows = [...main.querySelectorAll('ul > li > button')].filter((el) => el.getBoundingClientRect().height > 40);
    const pad = getComputedStyle(document.documentElement).getPropertyValue('--xc-card-pad').trim();
    const faults = [];
    for (const row of rows) {
        const cs = getComputedStyle(row);
        const label = (row.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 32);
        if (['Right', 'Bottom', 'Left'].some((side) => parseFloat(cs[`border${side}Width`]) > 0)) {
            faults.push(`row "${label}" draws its own border`);
        }
        let card = row.parentElement;
        while (card && card !== main && !isCard(card)) card = card.parentElement;
        if (!card || card === main) faults.push(`row "${label}" is not inside a list card`);
        // The row keeps the card inset, and every row after the first in its
        // list sits under a divider.
        if (cs.paddingLeft !== pad) faults.push(`row "${label}" inset ${cs.paddingLeft}, card padding ${pad}`);
        const item = row.parentElement;
        if (item.previousElementSibling && getComputedStyle(item).borderTopWidth === '0px' && cs.borderTopWidth === '0px') {
            faults.push(`row "${label}" has no divider above it`);
        }
    }
    return { rows: rows.length, faults };
}

async function measure(page, label, faults) {
    await settle(page, { escape: false });
    const result = await page.evaluate(cardFaults);
    faults.push(...result.faults.map((fault) => `${label}: ${fault}`));
    return result.cards;
}

// Escape closes a stray popover; an opened inline form or panel would close
// with it, so those are measured without it.
async function settle(page, { escape = true } = {}) {
    if (escape) for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape').catch(() => {});
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
    // A dialog is an overlay only when it floats; an in-page panel with a
    // dialog role (the Locked forgot-password panel) is page content.
    const overlay = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"]';
    const inOverlay = (el) => {
        for (let node = el.closest(overlay); node; node = node.parentElement?.closest(overlay)) {
            const position = getComputedStyle(node).position;
            if (!node.matches('[role="dialog"], [role="alertdialog"]')) return true;
            if (node.getAttribute('aria-modal') === 'true' || position === 'fixed' || position === 'absolute') return true;
        }
        return false;
    };
    const opaque = (color) => color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color);
    const behind = (el) => {
        for (let node = el.parentElement; node; node = node.parentElement) {
            const color = getComputedStyle(node).backgroundColor;
            if (opaque(color)) return color;
        }
        return null;
    };
    const interactive = 'button, input, select, textarea, a, summary, label, [role="button"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="radiogroup"], [role="tablist"], [role="toolbar"]';
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
    const boxes = [];
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
        if (el.matches(interactive) || inOverlay(el)) continue;
        if (cs.position === 'absolute' || cs.position === 'fixed') continue;
        const r = el.getBoundingClientRect();
        const rad = parseFloat(cs.borderTopLeftRadius);
        if (!(rad > 0) || rad >= Math.min(r.width, r.height) / 2) continue;
        if (/monospace|ui-monospace|Menlo|Consolas/i.test(cs.fontFamily.split(',')[0])) continue;
        // A QR or media frame holds its artwork directly; it is not a card.
        if (el.querySelector(':scope > canvas, :scope > video, :scope > svg[role="img"], :scope > img, :scope > * > img[alt*="QR" i]')) continue;
        // The shared notice (StatusMessage) is the one box allowed in a card.
        if (el.hasAttribute('data-variant')) continue;
        // Known exception, tracked to move onto StatusMessage: the authoring
        // forms' hand-drawn warning lists (the .warnings class, about a
        // hundred call sites). Take this line out when they move.
        if (el.matches('[role="alert"]') && [...el.classList].some((c) => /(^|_)warnings(_|$)/.test(c))) continue;
        const bordered = sides.every((s) => cs[`border${s}Style`] !== 'none' && parseFloat(cs[`border${s}Width`]) > 0);
        // Any other bordered box, or a filled one set off from what is
        // behind it, is a box of its own; inside a card it is a box in a box.
        if (r.height >= 28 && (bordered || (opaque(cs.backgroundColor) && cs.backgroundColor !== behind(el)))) boxes.push(el);
        if (!bordered || r.height < 40) continue;
        // A card shape with a tinted border (a red remove confirm) is a
        // second card look; tone belongs to the shared notice.
        const neutral = sides.every((s) => cs[`border${s}Color`] === borderColor);
        if (!neutral && cs.borderTopLeftRadius.startsWith(radius) && sides.every((s) => cs[`padding${s}`] === pad)) {
            faults.push(`${describe(el)}: card with a tinted border ${cs.borderTopColor}`);
        }
        if (!neutral) continue;
        cards.push(el);

        const style = new Set(sides.map((s) => `${cs[`border${s}Style`]} ${cs[`border${s}Width`]}`));
        if (style.size !== 1 || ![...style][0].startsWith('solid 1px')) faults.push(`${describe(el)}: border ${[...style].join(' / ')}`);
        const radii = new Set(corners.map((c) => cs[`border${c}Radius`]));
        if (radii.size !== 1 || ![...radii][0].startsWith(radius)) faults.push(`${describe(el)}: radius ${[...radii].join(' ')}, card radius ${radius}`);
        const pads = new Set(sides.map((s) => cs[`padding${s}`]));
        const padding = [...pads].join(' ');
        if (pads.size !== 1 || (padding !== pad && padding !== '0px')) faults.push(`${describe(el)}: padding ${padding}, card padding ${pad}`);
    }
    for (const box of boxes) {
        const outer = cards.find((card) => card !== box && card.contains(box));
        if (outer) faults.push(`${describe(box)}: ${cards.includes(box) ? 'card' : 'box'} inside ${describe(outer)}`);
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
            await settle(page, { escape: !route.form });
            const result = await page.evaluate(cardFaults);
            measured += result.cards;
            faults.push(...result.faults.map((fault) => `${route.label}: ${fault}`));
            if (route.rows) {
                const list = await page.evaluate(rowListFaults);
                expect(list.rows, `${route.label} shows activity rows to measure`).toBeGreaterThan(1);
                faults.push(...list.faults.map((fault) => `${route.label}: ${fault}`));
            }
        }

        // The locked demo wallet: its exit block, then a lockout notice.
        // Without the stored demo password it stays on the Locked screen.
        await page.evaluate(() => localStorage.removeItem('xc:demoWalletPassword'));
        await lock(page);
        measured += await measure(page, 'Locked demo', faults);
        await showLockout(page);
        measured += await measure(page, 'Locked lockout', faults);

        // The walk must have found cards to measure, or it proved nothing.
        expect(measured).toBeGreaterThan(5);
        expect(faults).toEqual([]);
    });
}

test('the Locked screen and its forgot-password panel share the card rules at every size', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);
    await createWallet(page);
    await lock(page);
    const faults = [];
    let measured = 0;
    for (const viewport of VIEWPORTS) {
        const size = `${viewport.width}x${viewport.height}`;
        await page.setViewportSize(viewport);
        measured += await measure(page, `Locked ${size}`, faults);
        await page.getByRole('button', { name: 'Forgot password?' }).click();
        measured += await measure(page, `Locked forgot ${size}`, faults);
        await page.getByRole('button', { name: 'Use recovery phrase' }).click();
        await expect(page.getByText(/This permanently deletes every wallet/)).toBeVisible();
        measured += await measure(page, `Locked forgot phrase ${size}`, faults);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
    }
    // Wide sizes draw the form card, so the walk measured at least those.
    expect(measured).toBeGreaterThan(1);
    expect(faults).toEqual([]);
});

test('every card in the confirm stack is the same width at every size', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);
    await createWallet(page);
    await palette(page, 'Prove address ownership');
    await page.getByLabel(/^Message/).first().fill('Card width check');
    await page.getByRole('button', { name: /^(Review|Sign|Continue)/ }).filter({ visible: true }).first().click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await settle(page, { escape: false });
        const widths = await page.getByTestId('confirm-modal').evaluate((root) => {
            const probe = document.createElement('div');
            probe.style.border = '1px solid var(--xc-border)';
            document.body.append(probe);
            const borderColor = getComputedStyle(probe).borderTopColor;
            probe.remove();
            const body = root.querySelector('[data-testid="confirm-modal"] > div:nth-child(2)') || root;
            return [...body.children]
                .filter((el) => {
                    const cs = getComputedStyle(el);
                    return cs.borderTopStyle === 'solid' && cs.borderTopWidth === '1px' && cs.borderTopColor === borderColor
                        && cs.borderLeftWidth === '1px';
                })
                .map((el) => Math.round(el.getBoundingClientRect().width));
        });
        const size = `${viewport.width}x${viewport.height}`;
        expect(widths.length, `${size}: the confirm stack shows its Signing with card`).toBeGreaterThan(0);
        expect(new Set(widths).size, `${size}: card widths ${widths.join(', ')}`).toBe(1);
        const stack = await page.getByTestId('confirm-modal').evaluate((root) => Math.round(root.getBoundingClientRect().width));
        expect(widths[0], `${size}: cards fill the stack`).toBe(stack);
    }
});
