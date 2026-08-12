// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// responsive-first program, slice 2: prove the SCREENS fit.
//
// Slice 1 fixed the shell (one set of breakpoints, exactly one nav
// surface per width) and locked it down with source-text smokes and jsdom
// unit tests. Neither of those can see a layout: jsdom gives every element
// a 0x0 box, so "does the History row fit in a 360px popup" was a question
// the repo had no way to ask. It was answered by eye, per screen, per
// release, which is why the item's verify line asks a human to open the
// shell at representative breakpoints.
//
// This spec asks it mechanically, in a real browser, at seven widths
// covering all three tiers and both tier boundaries. A screen fails when
// something on it paints outside the viewport, and the failure names the
// element rather than the screen, so it is actionable without a bisect.
//
// Venue: the web SPA on the dev-mock SDK (the suite's default config).
// Nothing here signs or broadcasts, so the mock is the right venue and no
// chain is involved.

import {
    createWallet,
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import {
    TAP_MIN_PX,
    VIEWPORTS,
    WALK_VIEWPORTS,
    describeOffenders,
    describeTargets,
    documentOverflow,
    enterDemoWallet,
    overflowingElements,
    renderedTier,
    undersizedTargets,
} from '../../fixtures/responsive.js';

const PASSWORD = 'responsive-pass-1234';

// Every primary destination the nav offers, minus Scan: that one asks for
// the camera, and a permission prompt is not a layout.
const ROUTES = [
    'Home',
    'History',
    'Send',
    'Receive',
    'DEX',
    'Dispensers',
    'Contracts',
    'Messaging',
    'Contacts',
    'Lists',
    'Payments due',
    'Settings',
];

/**
 * Lets the layout settle after a resize or a route change.
 *
 * `useLayoutTier` re-measures through a ResizeObserver, which fires on the
 * frame after the resize; measuring in the same tick reads the old tier
 * and produces a phantom failure.
 */
async function settle(page) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function expectFits(page, label) {
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: ${offenders.length} element(s) paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: the document scrolls sideways (${scrollWidth}px of content in ${clientWidth}px)`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

async function expectTappable(page, label) {
    await settle(page);
    const small = await undersizedTargets(page);
    expect(
        small,
        `${label}: ${small.length} control(s) under the ${TAP_MIN_PX}px target floor\n${describeTargets(small)}`,
    ).toEqual([]);
}

test.describe('responsive: one interface at every width', () => {
    test('every primary screen fits, from the 360px popup to desktop', async ({ page }) => {
        test.slow();   // one wallet creation plus a full route walk per width

        // Demo mode, not an empty wallet: balances, tokens with long
        // display names, NFT tiles, history entries and seeded contacts
        // are the content that overflows. An empty wallet fits every
        // width by holding nothing.
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

        // The walk would pass trivially on an empty wallet, so refuse to
        // run against one: silence is not the same as a fitting layout.
        await expect(
            page.getByRole('main').getByText(/BTC|Bitcoin/).first(),
            'demo wallet rendered no holdings, so this walk would measure empty screens',
        ).toBeVisible({ timeout: 30_000 });

        for (const vp of WALK_VIEWPORTS) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await settle(page);

            for (const route of ROUTES) {
                await test.step(`${vp.name} / ${route}`, async () => {
                    await gotoSection(page, route);
                    await expectFits(page, `${route} at ${vp.width}px`);
                });
            }
        }
    });

    test('every control meets the 24px pointer-target floor', async ({ page }) => {
        test.slow();

        // Same walk, different question. It runs at the popup width because
        // that is where controls are most cramped, but the floor is not a
        // width-conditional rule: a 16px help dot is a poor target on a
        // desktop trackpad too, and one interface means one answer.
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await page.setViewportSize({ width: 360, height: 640 });
        await settle(page);

        for (const route of ROUTES) {
            await test.step(route, async () => {
                await gotoSection(page, route);
                await expectTappable(page, `${route} at 360px`);
            });
        }

        // Route roots are not where the small controls live. The chart's
        // range chips, the fee slider's stops, the palette's search field
        // and the watchlist stars are all one interaction deeper, and each
        // of them was under the floor before this slice.
        await test.step('Home tabs', async () => {
            await gotoSection(page, 'Home');
            for (const tab of ['Coins', 'Tokens', 'NFTs', 'DeFi', 'Activity']) {
                const t = page.getByRole('tab', { name: new RegExp(`^${tab}`) });
                if (await t.count() === 0) continue;
                await t.first().click();
                await expectTappable(page, `Home / ${tab} tab at 360px`);
            }
        });

        await test.step('More sheet', async () => {
            await page.getByRole('navigation', { name: 'Bottom navigation' })
                .getByRole('button', { name: 'More', exact: true }).click();
            await expect(page.getByRole('dialog', { name: 'More navigation' })).toBeVisible();
            await expectTappable(page, 'More sheet at 360px');
            await page.keyboard.press('Escape');
        });

        await test.step('command palette', async () => {
            await page.keyboard.press('ControlOrMeta+k');
            await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
            await expectTappable(page, 'command palette at 360px');
            await page.keyboard.press('Escape');
        });

        await test.step('send form with Advanced open', async () => {
            await gotoSection(page, 'Send');
            const advanced = page.locator('summary', { hasText: 'Advanced' }).first();
            if (await advanced.count() > 0) await advanced.click();
            await expectTappable(page, 'Send / Advanced at 360px');
        });
    });

    test('the shell resolves the intended tier and mounts one nav surface', async ({ page }) => {
        test.slow();

        await createWallet(page, { password: PASSWORD });

        const rail = page.getByRole('navigation', { name: 'Primary navigation' });
        const bottom = page.getByRole('navigation', { name: 'Bottom navigation' });

        for (const vp of VIEWPORTS) {
            await test.step(`${vp.name}`, async () => {
                await page.setViewportSize({ width: vp.width, height: vp.height });
                await settle(page);

                expect(await renderedTier(page), `${vp.width}px resolves the ${vp.tier} tier`)
                    .toBe(vp.tier);

                const surfaces = (await rail.count()) + (await bottom.count());
                expect(surfaces, `${vp.width}px mounts exactly one nav surface`).toBe(1);

                if (vp.tier === 'compact') {
                    await expect(bottom).toBeVisible();
                } else {
                    await expect(rail).toBeVisible();
                }
            });
        }
    });

    test('a wallet resized mid-session keeps its screen usable', async ({ page }) => {
        // The tier flip has to survive a live resize, not just an initial
        // render: a desktop user dragging the window narrow, and the
        // side-panel/popup pair, are the same component being re-measured.
        await createWallet(page, { password: PASSWORD });
        await gotoSection(page, 'History');

        for (const width of [1280, 360, 900, 360, 640]) {
            await page.setViewportSize({ width, height: 800 });
            await expectFits(page, `History after resize to ${width}px`);
        }

        // Still on History, still navigable, after all that.
        await gotoSection(page, 'Send');
        await expect(page.getByRole('main')).toBeVisible();
    });
});
