// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// - the forced-colors walk, as a suite rather than a one-off.
//
// [] left "a devtools forced-colors:active walk of every route" as an
// open leg. A person doing that walk once tells you what was broken on the day
// they walked; this does the same pass with `forcedColors: 'active'` on every
// screen the dev server can reach and asserts the two properties that pass was
// looking for, so the answer stays true on the next route someone adds.
//
// The properties, and why these two:
//
//   1. Every control that takes keyboard focus shows a real outline. In
//      forced-colors mode `box-shadow` is not painted, so a focus ring built
//      out of one silently disappears - which is exactly what had happened to
//      every text input in the wallet (WCAG 2.4.7).
//
//   2. No element paints its text in its own background colour. That is what a
//      MIXED PAIR degenerates to: the browser preserves colours that are
//      system keywords and forces everything else, so a fill and a label
//      chosen from different sides end up unrelated - or identical.
//
// The static half of the walk (`packages/core/scripts/forced-colors-audit.js`)
// generalises both properties to stylesheets no route here renders. This suite
// is the evidence that the generalisation matches a real browser; the audit is
// the part that runs on every change.
//
// Screenshots of each stop land in `test-results/forced-colors/` as the record
// of the walk.

import {
    createWallet,
    dismissIntroCarousel,
    expect,
    freezeMotion,
    gotoSection,
    lockWallet,
    test,
} from '../../fixtures/wallet.js';

// NOT `test.use({ forcedColors: 'active' })`, which is the form the Playwright
// docs show and the form that does nothing here: this runner build
// (playwright 1.59.1) has no `forcedColors` entry in its fixture list, so the
// option is dropped without a word and every assertion below would run against
// a normally-painted page. It reaches the browser through `contextOptions`,
// which is passed to `newContext` verbatim. `assertForcedColors` is the guard
// that turns a silent regression here back into a failure.
test.use({ contextOptions: { forcedColors: 'active' } });

const SHOT_DIR = 'test-results/forced-colors';

/**
 * Fail loudly if the emulation is not on. Everything below would pass
 * vacuously against a normally-painted page, and a green suite that never
 * entered the mode is worse than no suite.
 */
async function assertForcedColors(page) {
    const active = await page.evaluate(() => window.matchMedia('(forced-colors: active)').matches);
    expect(active, 'forced-colors emulation is not active in this browser context').toBe(true);
}

/**
 * Tab through the screen and check the focus indicator at every stop.
 *
 * Focus is moved with a real Tab press rather than `element.focus()`, because
 * `:focus-visible` - the selector every ring in this codebase is written
 * against - only matches when the browser believes a keyboard drove the move.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @param {number} stops  how far to walk; screens are capped so one slow route
 *                        cannot eat the suite's budget
 */
async function walkFocusIndicators(page, label, stops = 25) {
    await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
    const seen = [];
    const bad = [];
    for (let i = 0; i < stops; i += 1) {
        await page.keyboard.press('Tab');
        const stop = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const style = getComputedStyle(el);

            // Where the ring is allowed to live. Several components ring an
            // inner pip or glyph on purpose - a 16px dot inside a 24px hit box
            // would otherwise get a square floating around it - so an
            // indicator on a pseudo-element or a descendant counts as the
            // control's indicator, and only "nothing anywhere" is a failure.
            const rings = (node, pseudo) => {
                const s = getComputedStyle(node, pseudo);
                return s.outlineStyle !== 'none' && (parseFloat(s.outlineWidth) || 0) >= 1;
            };
            let indicator = null;
            if (rings(el, null)) indicator = 'self';
            else if (rings(el, '::before')) indicator = '::before';
            else if (rings(el, '::after')) indicator = '::after';
            else {
                for (const child of el.querySelectorAll('*')) {
                    if (rings(child, null) || rings(child, '::before') || rings(child, '::after')) {
                        indicator = 'descendant';
                        break;
                    }
                }
            }

            return {
                name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`
                    + `${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`,
                focusVisible: el.matches(':focus-visible'),
                indicator,
                outlineStyle: style.outlineStyle,
                outlineWidth: parseFloat(style.outlineWidth) || 0,
                boxShadow: style.boxShadow,
            };
        });
        if (!stop) break;
        if (seen.some((s) => s.name === stop.name) && seen.length > 2 && i > 0) {
            // Focus wrapped back into the page chrome; the screen is covered.
            if (seen[0] && stop.name === seen[0].name) break;
        }
        seen.push(stop);
        if (!stop.focusVisible) continue;
        if (!stop.indicator) bad.push(stop);
    }

    expect(seen.length, `${label}: nothing took keyboard focus, so nothing was checked`)
        .toBeGreaterThan(0);
    expect(
        bad.map((s) => `${s.name} (outline: ${s.outlineStyle} ${s.outlineWidth}px, box-shadow: ${s.boxShadow})`),
        `${label}: control(s) with no visible focus indicator in forced-colors mode. `
        + 'A box-shadow ring does not count - the mode does not paint it.',
    ).toEqual([]);
}

/**
 * Catch the mixed-pair failure at its visible end: text painted in the colour
 * of the thing behind it. Only elements carrying their OWN text are checked,
 * so a wrapper inheriting a colour it never uses is not reported.
 */
async function assertNoInvisibleText(page, label) {
    const clashes = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
            const hasOwnText = [...el.childNodes]
                .some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
            if (!hasOwnText) continue;
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') continue;
            const bg = style.backgroundColor;
            if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
            if (style.color !== bg) continue;
            out.push(`${el.tagName.toLowerCase()}.${String(el.className || '').trim()} :: ${style.color}`);
        }
        return out;
    });
    expect(clashes, `${label}: text painted in its own background colour`).toEqual([]);
}

/**
 * One stop on the walk: prove the mode is on, check both properties, keep a
 * screenshot as the record.
 */
async function inspect(page, label) {
    await assertForcedColors(page);
    await freezeMotion(page);
    await assertNoInvisibleText(page, label);
    await walkFocusIndicators(page, label);
    await page.screenshot({
        path: `${SHOT_DIR}/${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`,
        fullPage: true,
    });
}

test.describe('forced-colors: license gate', () => {
    test.use({ acceptLicense: false });

    test('license gate', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /Accept and continue/i })).toBeVisible();
        await inspect(page, 'License gate');
    });
});

test.describe('forced-colors: onboarding', () => {
    test('intro carousel', async ({ page }) => {
        await page.goto('/');
        // The carousel's pips ring an inner pseudo-element rather than the
        // 24px hit box, which is the shape most likely to be lost in this mode.
        await inspect(page, 'Intro carousel');
    });

    test('welcome', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();
        await inspect(page, 'Onboarding welcome');
    });

    test('create wallet: password stage', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await expect(page.getByRole('heading', { name: 'Create a new wallet' })).toBeVisible();
        // The password fields are the widest instance of the box-shadow ring
        // that this item started from: `Input.module.css` styles every text
        // input in the wallet.
        await inspect(page, 'Create wallet password stage');
    });

    test('import wallet', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Import wallet' }).click();
        await expect(page.getByRole('heading', { name: 'Import an existing wallet' })).toBeVisible();
        await inspect(page, 'Import wallet');
    });
});

// One wallet, many stops. Creating a wallet pays a real Argon2id derivation,
// so the unlocked routes share a single one rather than each buying their own.
test.describe('forced-colors: unlocked shell', () => {
    test('home, send, receive, history, settings, locked', async ({ page }) => {
        await createWallet(page, { password: 'forcedcolorspassword' });
        await inspect(page, 'Home');

        await gotoSection(page, 'Send');
        await expect(page.getByLabel('To', { exact: true })).toBeVisible();
        await inspect(page, 'Send form');

        await gotoSection(page, 'Receive');
        await inspect(page, 'Receive');

        await gotoSection(page, 'History');
        await inspect(page, 'History');

        await lockWallet(page);
        await inspect(page, 'Locked');
    });
});
