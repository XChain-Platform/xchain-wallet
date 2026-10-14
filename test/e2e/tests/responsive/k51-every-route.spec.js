// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const K51 = {
    viewport: { width: 360, height: 800 },
    screen: { width: 360, height: 800 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
};

const MIN_CONTROL_HEIGHT = 44;
const LAYOUT_SLACK = 1;

const INTERACTIVE_SELECTOR = [
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'a[href]',
    'summary',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="textbox"]',
].join(', ');

const TOP_LEVEL_ROUTES = [
    'Home',
    'History',
    'Send',
    'Receive',
    'Scan',
    'DEX',
    'Marketplace',
    'Dispensers',
    'Contracts',
    'Messaging',
    'Contacts',
    'Lists',
    'Payments due',
    'Settings',
];

const SETTINGS_SUBPAGES = [
    'This wallet',
    'Display',
    'Keyboard',
    'Privacy',
    'Safety',
    'Wallet mode',
    'Backup',
    'Fees',
    'Network & endpoints',
    'Connected sites',
    'Automatic donation system',
    'Developer mode',
    'About',
];

test.use(K51);

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function settle(page) {
    await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
}

async function openPaletteDestination(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    await palette.getByRole('option', { name: new RegExp(`^${escapeRegExp(title)}\\b`) })
        .first().click();
}

async function openTopLevelRoute(page, route) {
    // Marketplace is a rail destination at larger tiers and a palette
    // destination on compact screens, where the More sheet has no row for it.
    if (route === 'Marketplace') {
        await openPaletteDestination(page, route);
    } else {
        await gotoSection(page, route);
    }
    await expect(page.getByRole('main')).toBeVisible();
}

function describeControl(control) {
    const role = control.role ? ` role="${control.role}"` : '';
    const name = control.name ? ` ${JSON.stringify(control.name)}` : '';
    return `<${control.tag}${role}>${name}`;
}

function describeOutside(controls) {
    return controls.map((control) => (
        `${describeControl(control)} [${control.left}..${control.right}]`
    )).join('\n');
}

function describeShort(controls) {
    return controls.map((control) => (
        `${describeControl(control)} ${control.height}px tall`
    )).join('\n');
}

function describeOverlaps(overlaps) {
    return overlaps.map(({ first, second }) => (
        `${describeControl(first)} overlaps ${describeControl(second)}`
    )).join('\n');
}

async function layoutAudit(page) {
    return page.evaluate(({ interactiveSelector, minHeight, slack }) => {
        const viewportWidth = document.documentElement.clientWidth;

        const isRendered = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && element.getAttribute('aria-hidden') !== 'true'
                && rect.width > 0
                && rect.height > 0;
        };

        const targetRect = (element) => {
            const rect = element.getBoundingClientRect();
            const label = element.closest('label');
            if (!label) return rect;
            const labelRect = label.getBoundingClientRect();
            if (labelRect.width < rect.width || labelRect.height < rect.height) return rect;
            return labelRect;
        };

        const identify = (element, rect) => ({
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role') || '',
            name: (
                element.getAttribute('aria-label')
                || element.getAttribute('title')
                || element.textContent
                || element.getAttribute('placeholder')
                || ''
            ).trim().replace(/\s+/g, ' ').slice(0, 80),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            height: Math.round(rect.height),
        });

        const controls = [...new Set(document.querySelectorAll(interactiveSelector))]
            .filter(isRendered)
            .map((element) => ({ element, rect: targetRect(element) }));

        const outside = controls
            .filter(({ rect }) => rect.left < -slack || rect.right > viewportWidth + slack)
            .map(({ element, rect }) => identify(element, rect));

        const short = controls
            .filter(({ rect }) => rect.height + slack < minHeight)
            .map(({ element, rect }) => identify(element, rect));

        const overlaps = [];
        for (let i = 0; i < controls.length; i += 1) {
            const first = controls[i];
            for (let j = i + 1; j < controls.length; j += 1) {
                const second = controls[j];
                if (first.element.contains(second.element) || second.element.contains(first.element)) continue;
                const overlapWidth = Math.min(first.rect.right, second.rect.right)
                    - Math.max(first.rect.left, second.rect.left);
                const overlapHeight = Math.min(first.rect.bottom, second.rect.bottom)
                    - Math.max(first.rect.top, second.rect.top);
                if (overlapWidth <= slack || overlapHeight <= slack) continue;
                overlaps.push({
                    first: identify(first.element, first.rect),
                    second: identify(second.element, second.rect),
                });
            }
        }

        return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth,
            outside,
            short,
            overlaps,
        };
    }, {
        interactiveSelector: INTERACTIVE_SELECTOR,
        minHeight: MIN_CONTROL_HEIGHT,
        slack: LAYOUT_SLACK,
    });
}

async function bottomClearance(page) {
    return page.evaluate(async ({ interactiveSelector, slack }) => {
        const main = document.querySelector('main');
        const bottomNav = document.querySelector('nav[aria-label="Bottom navigation"]');
        if (!main || !bottomNav) return { error: 'main or bottom navigation is missing' };

        main.scrollTop = main.scrollHeight;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const focusable = [...new Set(main.querySelectorAll(interactiveSelector))].filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            if (rect.width === 0 || rect.height === 0 || element.disabled) return false;
            if (element.getAttribute('aria-hidden') === 'true') return false;
            if (element.getAttribute('tabindex') === '-1') return false;
            return element.matches(
                'button, input:not([type="hidden"]), select, textarea, a[href], summary, '
                + '[contenteditable="true"], [tabindex]',
            );
        });
        const last = focusable.at(-1);
        if (!last) return { error: null, clear: true, control: null };

        const controlRect = last.closest('label')?.getBoundingClientRect()
            || last.getBoundingClientRect();
        const mainRect = main.getBoundingClientRect();
        const navRect = bottomNav.getBoundingClientRect();
        const name = (
            last.getAttribute('aria-label')
            || last.getAttribute('title')
            || last.textContent
            || last.getAttribute('placeholder')
            || ''
        ).trim().replace(/\s+/g, ' ').slice(0, 80);

        return {
            error: null,
            control: { tag: last.tagName.toLowerCase(), name },
            controlTop: Math.round(controlRect.top),
            controlBottom: Math.round(controlRect.bottom),
            visibleTop: Math.round(mainRect.top),
            navTop: Math.round(navRect.top),
            clear: controlRect.top >= mainRect.top - slack
                && controlRect.bottom <= navRect.top + slack,
        };
    }, { interactiveSelector: INTERACTIVE_SELECTOR, slack: LAYOUT_SLACK });
}

async function expectK51Layout(page, label) {
    await expect(page.getByRole('main').getByText('Loading…', { exact: true })).toHaveCount(0);
    await settle(page);
    const audit = await layoutAudit(page);

    expect(
        audit.documentWidth,
        `${label}: the page is ${audit.documentWidth}px wide in a ${audit.viewportWidth}px viewport`,
    ).toBeLessThanOrEqual(audit.viewportWidth + LAYOUT_SLACK);
    expect(
        audit.outside,
        `${label}: ${audit.outside.length} control(s) extend beyond the horizontal viewport\n`
            + describeOutside(audit.outside),
    ).toEqual([]);
    expect(
        audit.short,
        `${label}: ${audit.short.length} control(s) are under ${MIN_CONTROL_HEIGHT}px tall\n`
            + describeShort(audit.short),
    ).toEqual([]);
    expect(
        audit.overlaps,
        `${label}: ${audit.overlaps.length} pair(s) of interactive controls overlap\n`
            + describeOverlaps(audit.overlaps),
    ).toEqual([]);

    const clearance = await bottomClearance(page);
    expect(clearance.error, `${label}: ${clearance.error}`).toBeNull();
    expect(
        clearance.clear,
        `${label}: last focusable ${JSON.stringify(clearance.control)} occupies `
            + `[${clearance.controlTop}..${clearance.controlBottom}], but the visible main area is `
            + `[${clearance.visibleTop}..${clearance.navTop}], ending at the bottom navigation`,
    ).toBe(true);
}

test.describe('LG K51 responsive route sweep', () => {
    test('every top-level route and Settings sub-page keeps touch controls usable', async ({ page }) => {
        test.slow();

        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await expect(
            page.getByRole('main').getByText(/BTC|Bitcoin/).first(),
            'the route sweep requires the populated demo wallet',
        ).toBeVisible({ timeout: 30_000 });

        for (const route of TOP_LEVEL_ROUTES) {
            await test.step(route, async () => {
                await openTopLevelRoute(page, route);
                await expectK51Layout(page, route);
            });
        }

        for (const subpage of SETTINGS_SUBPAGES) {
            await test.step(`Settings / ${subpage}`, async () => {
                const row = page.getByRole('main').getByRole('button', {
                    name: new RegExp(`^${escapeRegExp(subpage)}\\b`, 'i'),
                });
                await expect(row, `Settings has no ${JSON.stringify(subpage)} row`).toBeVisible();
                await row.click();
                await expect(page.getByRole('heading', { name: subpage, exact: true })).toBeVisible();

                await expectK51Layout(page, `Settings / ${subpage}`);

                await page.getByRole('button', { name: 'Back to settings' }).click();
                await expect(page.getByRole('searchbox', { name: 'Search settings' })).toBeVisible();
            });
        }
    });
});
