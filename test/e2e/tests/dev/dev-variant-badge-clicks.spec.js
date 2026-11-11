// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The developer variant badge floats over the shell, so it must never take
// the clicks meant for the navigation under it. With Developer Mode and the
// variant popover on, every bottom tab at the small, extension and sidebar
// widths and Lock at the full width take their own click, both at the
// badge's default corner and after a saved position left off screen is
// pulled back at mount, and the badge stays inside the viewport each time.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';
import { POS_KEY } from '../../../../packages/web/src/devVariantBadgeKey.js';

test.use({ viewport: { width: 1280, height: 800 } });

/** One window per layout variant: phone, extension popup, side panel, desktop. */
const WIDTHS = [
    { name: 'small', width: 320, height: 700, nav: 'bottom' },
    { name: 'extension', width: 360, height: 600, nav: 'bottom' },
    { name: 'sidebar', width: 375, height: 800, nav: 'bottom' },
    { name: 'full', width: 1280, height: 800, nav: 'rail' },
];

/** Saved positions past every edge a stale or hand-edited seed can name. */
const OFF_SCREEN_SEEDS = [
    { x: 99999, y: 99999 },
    { x: -99999, y: 99999 },
];

function badge(page) {
    return page.getByRole('status', { name: /^Dev variant:/ });
}

function popoverSwitch(page) {
    return page.getByRole('switch', { name: /Show variant popover/ });
}

async function showBadge(page) {
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await gotoSection(page, 'Settings');
    await page.getByRole('main').getByRole('button', { name: /^Developer mode/ }).click();
    const developerMode = page.getByRole('switch', { name: 'Turn on developer mode', exact: true });
    if (!(await developerMode.isChecked())) await developerMode.click();
    const popover = popoverSwitch(page);
    if (!(await popover.isChecked())) await popover.click();
    await expect(popover).toBeChecked();
    await expect(badge(page)).toBeVisible();
}

/** Writes a saved position and remounts the badge so it reads the seed at mount. */
async function remountWithSeed(page, seed) {
    await page.evaluate(([key, value]) => {
        if (value) window.localStorage.setItem(key, JSON.stringify(value));
        else window.localStorage.removeItem(key);
    }, [POS_KEY, seed]);
    const popover = popoverSwitch(page);
    await popover.click();
    await expect(badge(page)).toHaveCount(0);
    await popover.click();
    await expect(badge(page)).toBeVisible();
}

/** True when the element itself is the top hit at its own center. */
function takesItsOwnClick(locator) {
    return locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el.contains(top);
    });
}

async function badgeFits(page) {
    return badge(page).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.top >= 0
            && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
    });
}

/** The controls the badge must leave clickable at this width. */
function navTargets(page, nav) {
    if (nav === 'rail') {
        return page.getByRole('navigation', { name: 'Primary navigation' })
            .getByRole('button', { name: 'Lock wallet', exact: true });
    }
    return page.getByRole('navigation', { name: 'Bottom navigation' }).getByRole('button');
}

/**
 * Proves every nav target at this width is the top hit at its center and
 * passes Playwright's click hit test, and that the badge fits the viewport.
 */
async function expectNavClickable(page, { name, width, height, nav }, label) {
    await page.setViewportSize({ width, height });
    const targets = navTargets(page, nav);
    await expect(targets.first()).toBeVisible();
    const count = await targets.count();
    expect(count, `${label}: nav targets at ${name}`).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
        const target = targets.nth(i);
        await expect.poll(() => takesItsOwnClick(target), `${label}: ${nav} target ${i} at ${name}`).toBe(true);
        await target.click({ trial: true, timeout: 5_000 });
    }
    await expect.poll(() => badgeFits(page), `${label}: badge inside ${name}`).toBe(true);
}

test('Lock and every bottom tab take their own click under the badge at every width and seed', async ({ page }) => {
    await showBadge(page);

    for (const seed of [null, ...OFF_SCREEN_SEEDS]) {
        const label = seed ? `seed ${seed.x},${seed.y}` : 'default corner';
        for (const size of WIDTHS) {
            await page.setViewportSize({ width: size.width, height: size.height });
            await remountWithSeed(page, seed);
            await expectNavClickable(page, size, label);
        }
    }

    await page.setViewportSize({ width: 320, height: 700 });
    await page.getByRole('navigation', { name: 'Bottom navigation' })
        .getByRole('button', { name: 'Home', exact: true }).click({ timeout: 5_000 });

    await page.setViewportSize({ width: 1280, height: 800 });
    const lock = navTargets(page, 'rail');
    await expect(lock).toBeVisible();
    await lock.click({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /^Unlock/i }).first()).toBeVisible();
});

test('the badge stays inside 320 and 360 in both directions and clamps an off-screen seed', async ({ page }) => {
    await showBadge(page);

    for (const width of [320, 360]) {
        await page.setViewportSize({ width, height: 700 });
        for (const dir of ['ltr', 'rtl']) {
            await page.evaluate((d) => { document.documentElement.dir = d; }, dir);
            await expect.poll(() => badgeFits(page), `badge inside ${width} ${dir}`).toBe(true);
        }
        await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate((key) => {
        window.localStorage.setItem(key, JSON.stringify({ x: 99999, y: 99999 }));
    }, POS_KEY);
    await page.reload();
    await expect(badge(page)).toBeVisible();
    expect(await badgeFits(page)).toBe(true);
});
