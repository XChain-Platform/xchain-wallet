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
