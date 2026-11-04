// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Lists, cards and tables fill the full width of the content area up to the
// scrollbar, never under it; forms keep their own sizing. Every outermost
// list, row and card on a list screen starts on the content left edge, ends
// on the content right edge (the edge before the scrollbar) and never
// reaches past the document client width.

import {
    createWallet,
    dismissIntroCarousel,
    expect,
    gotoSection,
    openPaletteCommand,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { width: 360, height: 640 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
];

const ROUTES = ['Home', 'History', 'Settings', 'Addresses'];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function measure(page) {
    return page.getByRole('main').evaluate((main) => {
        // CSS module class names are hashed, so the list, row and card
        // classes are read from the module stylesheets themselves.
        const classesOf = (file, locals) => {
            const found = [];
            for (const sheet of document.querySelectorAll('style[data-vite-dev-id]')) {
                if (!sheet.getAttribute('data-vite-dev-id').endsWith(file)) continue;
                for (const local of locals) {
                    const match = sheet.textContent.match(new RegExp(`\\.(_${local}_[\\w-]+)`));
                    if (match) found.push(match[1]);
                }
            }
            return found;
        };
        const listClasses = classesOf('/ListPage.module.css', ['page']);
        const rowClasses = classesOf('/ListRow.module.css', ['row']);
        const cardClasses = classesOf('/Card.module.css', ['card', 'flush']);
        const all = [...listClasses, ...rowClasses, ...cardClasses];
        if (listClasses.length === 0 || rowClasses.length === 0 || cardClasses.length === 0) {
            return { error: `module classes not found: ${JSON.stringify({ listClasses, rowClasses, cardClasses })}` };
        }
        const selector = all.map((name) => `.${name}`).join(',');

        const mainBox = main.getBoundingClientRect();
        const style = getComputedStyle(main);
        const contentLeft = mainBox.left + main.clientLeft + parseFloat(style.paddingLeft);
        const contentRight = mainBox.left + main.clientLeft + main.clientWidth
            - parseFloat(style.paddingRight);
        const clientWidth = document.documentElement.clientWidth;

        const items = [];
        for (const el of main.querySelectorAll(selector)) {
            const box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            // Nested surfaces sit inside their outer list or card.
            if (el.parentElement.closest(selector) && main.contains(el.parentElement.closest(selector))) continue;
            // Forms and overlays keep their own sizing.
            if (el.closest('form, [role="dialog"], [role="menu"], [data-xc-menu-list]')) continue;
            const kind = listClasses.some((name) => el.classList.contains(name)) ? 'list'
                : rowClasses.some((name) => el.classList.contains(name)) ? 'row' : 'card';
            items.push({
                kind,
                label: `${el.tagName.toLowerCase()}.${kind}:${(el.textContent || '').trim().slice(0, 30)}`,
                left: box.left,
                right: box.right,
            });
        }
        return {
            contentLeft, contentRight, clientWidth, items,
        };
    });
}

test('lists, rows and cards fill the content width up to the scrollbar', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    const violations = [];
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await settle(page);

        for (const name of ROUTES) {
            // The bottom bar does not list Addresses, so it opens by palette.
            if (name === 'Addresses') await openPaletteCommand(page, name);
            else await gotoSection(page, name);
            const main = page.getByRole('main');
            await expect(main.locator(':scope > *:visible').first()).toBeVisible();
            await main.evaluate((element) => { element.scrollTop = 0; });
            await settle(page);

            const m = await measure(page);
            const where = `${viewport.width}px / ${name}`;
            if (m.error) {
                violations.push(`${where}: ${m.error}`);
                continue;
            }
            if (m.items.length === 0) violations.push(`${where}: no list, row or card found`);
            if (m.contentRight > m.clientWidth + 1) {
                violations.push(`${where}: content right ${m.contentRight} is past client width ${m.clientWidth}`);
            }
            for (const item of m.items) {
                if (Math.abs(item.left - m.contentLeft) > 1) {
                    violations.push(`${where}: ${item.label} left ${item.left} != ${m.contentLeft}`);
                }
                if (Math.abs(item.right - m.contentRight) > 1) {
                    violations.push(`${where}: ${item.label} right ${item.right} != ${m.contentRight}`);
                }
                if (item.right > m.clientWidth + 1) {
                    violations.push(`${where}: ${item.label} right ${item.right} is past client width ${m.clientWidth}`);
                }
            }
        }
    }
    expect(violations, violations.join('\n')).toEqual([]);
});

// First block of a screen. A list, card or table first block starts on the
// page gutter and ends on the gutter before the scrollbar, within 2px. A form
// (a form element or a group) keeps its own sizing and must stay centred, so
// the two gaps match. The measure reads the main scroller the way the layout
// harness does.
const FIRST_BLOCK_VIEWPORTS = [
    { width: 820, height: 1100 },
    { width: 1440, height: 900 },
];
const GAP_TOLERANCE_PX = 2;

async function measureFirstBlock(page) {
    return page.locator('#xc-main').evaluate((main) => {
        const style = getComputedStyle(main);
        const frameLeft = main.getBoundingClientRect().left + main.clientLeft;
        const frameRight = frameLeft + main.clientWidth;
        const gutter = parseFloat(style.paddingLeft) || 0;
        const first = [...main.children].find((el) => {
            const cs = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            return cs.display !== 'none' && cs.visibility !== 'hidden'
                && cs.position !== 'absolute' && cs.position !== 'fixed'
                && box.width >= 1 && box.height >= 1;
        });
        if (!first) return { error: 'no first content block' };
        const box = first.getBoundingClientRect();
        const isForm = first.tagName === 'FORM' || first.getAttribute('role') === 'group';
        return {
            kind: isForm ? 'form' : 'list',
            label: `${first.tagName.toLowerCase()}:${(first.textContent || '').trim().slice(0, 30)}`,
            gutter,
            left: Math.round((box.left - frameLeft) * 100) / 100,
            rightGap: Math.round((frameRight - box.right) * 100) / 100,
        };
    });
}

// A resize or a route change can still be laying out; the measure is taken
// once two reads 150ms apart agree.
async function settledFirstBlock(page) {
    let previous = await measureFirstBlock(page);
    for (let attempt = 0; attempt < 20; attempt += 1) {
        await page.waitForTimeout(150);
        const next = await measureFirstBlock(page);
        if (JSON.stringify(next) === JSON.stringify(previous)) return next;
        previous = next;
    }
    return previous;
}

function judgeFirstBlock(where, m) {
    if (m.error) return [`${where}: ${m.error}`];
    const out = [];
    if (m.kind === 'list') {
        if (Math.abs(m.left - m.gutter) > GAP_TOLERANCE_PX) {
            out.push(`${where}: ${m.label} left ${m.left} is not the gutter ${m.gutter}`);
        }
        if (Math.abs(m.rightGap - m.gutter) > GAP_TOLERANCE_PX) {
            out.push(`${where}: ${m.label} right gap ${m.rightGap} is not the gutter ${m.gutter}`);
        }
    } else if (Math.abs(m.left - m.rightGap) > GAP_TOLERANCE_PX) {
        out.push(`${where}: form ${m.label} is off centre, left ${m.left} and right gap ${m.rightGap}`);
    }
    return out;
}

test('the first block of the intro carousel and the issuance wizard fills the gutter or centres as a form', async ({ page }) => {
    test.slow();
    const violations = [];

    for (const viewport of FIRST_BLOCK_VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto('/');
        await page.getByRole('button', { name: 'Skip' }).waitFor({ state: 'visible', timeout: 60_000 });
        await settle(page);
        // The intro carousel is an explainer, not a form: its first block
        // fills the gutter and centres its column inside it.
        const intro = await settledFirstBlock(page);
        const where = `${viewport.width}px / intro carousel`;
        if (!intro.error && intro.kind !== 'list') {
            violations.push(`${where}: ${intro.label} is classed ${intro.kind}, expected a gutter-filling block`);
        }
        violations.push(...judgeFirstBlock(where, intro));
    }

    // A demo wallet disables every submit button, so the wizard walk uses a
    // real wallet to reach the details and review steps.
    await createWallet(page);
    for (const viewport of FIRST_BLOCK_VIEWPORTS) {
        await page.setViewportSize(viewport);
        await settle(page);
        await openPaletteCommand(page, 'Create a token');
        await expect(page.getByText('Step 1 of 4: Template', { exact: true })).toBeVisible();
        await settle(page);
        violations.push(...judgeFirstBlock(`${viewport.width}px / token wizard template`, await settledFirstBlock(page)));

        await page.getByRole('button', { name: /Meme token/ }).click();
        await expect(page.getByText('Step 2 of 4: Network', { exact: true })).toBeVisible();
        await settle(page);
        violations.push(...judgeFirstBlock(`${viewport.width}px / token wizard network`, await settledFirstBlock(page)));

        const chainForm = page.getByRole('form', { name: 'Choose token network' });
        await chainForm.getByRole('button', { name: 'Next' }).click();
        await expect(page.getByText('Step 3 of 4: Details', { exact: true })).toBeVisible();
        await settle(page);
        violations.push(...judgeFirstBlock(`${viewport.width}px / token wizard details`, await settledFirstBlock(page)));

        const details = page.getByRole('form', { name: 'Token details' });
        await details.getByRole('textbox', { name: 'Token name (ticker)' }).fill('WIDTHCHECK');
        await details.getByRole('textbox', { name: 'Supply' }).fill('1000');
        await details.getByRole('button', { name: 'Review token' }).click();
        await expect(page.getByText('Step 4 of 4: Review', { exact: true })).toBeVisible({ timeout: 30_000 });
        await settle(page);
        violations.push(...judgeFirstBlock(`${viewport.width}px / token wizard review`, await settledFirstBlock(page)));
        await gotoSection(page, 'Home');
    }
    expect(violations, violations.join('\n')).toEqual([]);
});
