// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the web wallet must use the page width on a desktop browser.
//
// Measured against the live wallet at a 1489px viewport: the unlock screen
// rendered inside a narrow column pinned to the right edge, leaving most of
// the page empty, and it survived a hard reload. That is the `sidebar`
// dev-preview frame (a fixed 375px column docked right,
// packages/web/src/DevVariantShell.module.css), applied because the shell
// used to read a `localStorage` copy of a variant somebody pinned once. The
// web wallet is the public download page's primary call to action, so the
// stranger who lands on it is exactly the reader who cannot be told to open
// devtools and delete a key.
//
// The unit test (test/unit/web/devVariant.test.js) asserts the resolution
// rule. This one asserts the thing the item's verify line actually names,
// in a real browser: at a desktop width the shell fills the page. jsdom
// cannot answer it, because jsdom performs no layout.
//
// Venue: the web SPA on the dev-mock SDK (this config's default). Nothing
// here signs or broadcasts.

import { expect, test } from '../../fixtures/wallet.js';

const DESKTOP = { width: 1489, height: 900 };
const STORAGE_KEY = 'xc.devVariant';

/** The widest box the shell paints, and how far its left edge sits from the page's. */
async function shellGeometry(page) {
    return page.evaluate(() => {
        const root = document.getElementById('xchain-web-root');
        const frame = root?.firstElementChild?.firstElementChild;
        const box = frame?.getBoundingClientRect();
        return {
            innerWidth: window.innerWidth,
            left: Math.round(box?.left ?? -1),
            width: Math.round(box?.width ?? -1),
            stored: window.localStorage.getItem('xc.devVariant'),
        };
    });
}

test.describe('web shell at desktop width ', () => {
    test('a stale stored variant cannot pin the shell to popup width', async ({ page }) => {
        // Exactly the state the live wallet was found in: the preview
        // override left behind, and no `?variant=` in the URL asking for it.
        await page.addInitScript(([key]) => {
            try { window.localStorage.setItem(key, 'sidebar'); } catch { /* storage off; the gate below still holds */ }
        }, [STORAGE_KEY]);

        await page.setViewportSize(DESKTOP);
        await page.goto('/');
        await page.getByRole('main').waitFor({ state: 'visible', timeout: 60_000 });

        const geom = await shellGeometry(page);
        expect(geom.innerWidth).toBe(DESKTOP.width);
        expect(
            geom.width,
            `the shell renders in a ${geom.width}px column on a ${geom.innerWidth}px page`,
        ).toBeGreaterThan(DESKTOP.width - 40);
        expect(geom.left, 'the shell is pinned away from the left edge').toBeLessThan(40);

        // Swept, not merely ignored: the next load starts clean whether or
        // not this code path runs again.
        expect(geom.stored, 'the stale override survived the load').toBeNull();
    });

    test('a variant asked for in this navigation still previews', async ({ page }) => {
        // The dev tool keeps working; the URL is what carries it, so it is
        // visible in the address bar and gone at the bare origin.
        await page.setViewportSize(DESKTOP);
        await page.goto('/?variant=sidebar');
        await page.getByRole('main').waitFor({ state: 'visible', timeout: 60_000 });

        const pinned = await shellGeometry(page);
        expect(pinned.width, 'the sidebar preview frame is a narrow column').toBeLessThan(500);
        expect(pinned.left, 'the sidebar preview docks to the right edge')
            .toBeGreaterThan(DESKTOP.width / 2);

        // And opening the bare origin is the whole escape route.
        await page.goto('/');
        await page.getByRole('main').waitFor({ state: 'visible', timeout: 60_000 });
        const released = await shellGeometry(page);
        expect(released.width).toBeGreaterThan(DESKTOP.width - 40);
    });
});
