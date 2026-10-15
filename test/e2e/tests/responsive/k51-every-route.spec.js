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

// The wallet's pointer-target floor is 24px at every width (--xc-tap-min in
// packages/core/src/ui/tokens.css, WCAG 2.2 2.5.8); kit controls add their own
// 44px touch hit area on coarse pointers, which hitHeight below reads.
const MIN_CONTROL_HEIGHT = 24;
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

// Phone layouts leave Keyboard out of Settings (shortcut bindings need a
// hardware keyboard), and Network & endpoints shows only in Developer Mode.
const SETTINGS_SUBPAGES = [
    'This wallet',
    'Display',
    'Privacy',
    'Safety',
    'Wallet mode',
    'Backup',
    'Fees',
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

        // Recent Chromium still reports a box for the contents of a closed
        // <details>, though nothing is drawn or reachable there: a control in
        // Send's collapsed Advanced section would "overlap" the Send button.
        const inClosedDetails = (element) => {
            for (let node = element.parentElement; node; node = node.parentElement) {
                if (node.tagName === 'DETAILS' && !node.open && !element.closest('summary')) return true;
            }
            return false;
        };

        const isRendered = (element) => {
            if (inClosedDetails(element)) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && element.getAttribute('aria-hidden') !== 'true'
                && rect.width > 0
                && rect.height > 0
                // A 1px clipped box is the visually hidden pattern (the skip
                // link): it becomes a target only once it takes focus.
                && !(rect.width <= 1 && rect.height <= 1);
        };

        const targetRect = (element) => {
            const rect = element.getBoundingClientRect();
            const label = element.closest('label');
            if (!label) return rect;
            const labelRect = label.getBoundingClientRect();
            if (labelRect.width < rect.width || labelRect.height < rect.height) return rect;
            return labelRect;
        };

        // Kit sm buttons extend their touch target with an absolutely
        // positioned ::before (Button.module.css); that box is the hit area.
        const hitHeight = (element, rect) => {
            const before = getComputedStyle(element, '::before');
            if (before.content !== 'none' && before.position === 'absolute') {
                const height = Number.parseFloat(before.height);
                if (height > rect.height) return height;
            }
            return rect.height;
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

        // A control scrolled partly out of the route scroller is clipped at
        // its edge (above the bottom bar, for example); overlaps count only
        // the part that is on screen.
        const scroller = document.querySelector('main');
        const visibleRect = (element, rect) => {
            if (!scroller || !scroller.contains(element)) return rect;
            const box = scroller.getBoundingClientRect();
            const top = Math.max(rect.top, box.top);
            const bottom = Math.min(rect.bottom, box.bottom);
            return { left: rect.left, right: rect.right, top, bottom: Math.max(top, bottom) };
        };

        const controls = [...new Set(document.querySelectorAll(interactiveSelector))]
            .filter(isRendered)
            .map((element) => {
                const rect = targetRect(element);
                return { element, rect, visible: visibleRect(element, rect) };
            });

        const outside = controls
            .filter(({ rect }) => rect.left < -slack || rect.right > viewportWidth + slack)
            .map(({ element, rect }) => identify(element, rect));

        const short = controls
            .filter(({ element, rect }) => hitHeight(element, rect) + slack < minHeight)
            .map(({ element, rect }) => identify(element, rect));

        const overlaps = [];
        for (let i = 0; i < controls.length; i += 1) {
            const first = controls[i];
            for (let j = i + 1; j < controls.length; j += 1) {
                const second = controls[j];
                if (first.element.contains(second.element) || second.element.contains(first.element)) continue;
                // Field actions (Paste, Max, pickers) sit inset inside their
                // input's border by design; one wholly inside a text field is
                // part of that field, not a collision.
                const isField = (el) => el.matches('input, textarea');
                const inside = (inner, outer) => inner.left >= outer.left - slack
                    && inner.right <= outer.right + slack
                    && inner.top >= outer.top - slack
                    && inner.bottom <= outer.bottom + slack;
                if ((isField(first.element) && inside(second.rect, first.rect))
                    || (isField(second.element) && inside(first.rect, second.rect))) continue;
                const overlapWidth = Math.min(first.visible.right, second.visible.right)
                    - Math.max(first.visible.left, second.visible.left);
                const overlapHeight = Math.min(first.visible.bottom, second.visible.bottom)
                    - Math.max(first.visible.top, second.visible.top);
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
            for (let node = element.parentElement; node; node = node.parentElement) {
                if (node.tagName === 'DETAILS' && !node.open && !element.closest('summary')) return false;
            }
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
            // A last control already scrolled above the area means the route
            // ends in plain rows (Marketplace activity), which clear the bar.
            clear: controlRect.bottom <= mainRect.top + slack
                || (controlRect.top >= mainRect.top - slack
                    && controlRect.bottom <= navRect.top + slack),
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
                await expect(page.getByRole('heading', { level: 1, name: subpage, exact: true })).toBeVisible();

                await expectK51Layout(page, `Settings / ${subpage}`);

                await page.getByRole('button', { name: 'Back to settings' }).click();
                await expect(page.getByRole('searchbox', { name: 'Search settings' })).toBeVisible();
            });
        }
    });
});
