// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// License-acceptance gate (§25.1 / G061, Cluster J FOLLOWUP 4).
//
// Every other spec bypasses this gate through the shared fixture. This
// is the one spec that opts out and drives it for real, so the gate has
// exactly one owner instead of being re-asserted (and re-broken) in
// fifteen places.
//
// The version-mismatch case is the important one: acceptance is bound to
// LICENSE_VERSION, and a bump re-fires the gate for everyone. That is by
// design (new binding terms must be re-collected), and it is also what
// silently broke the entire E2E suite once already, so it is pinned here.

import { LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, dismissIntroCarousel, expect, test } from '../../fixtures/wallet.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';

test.use({ acceptLicense: false });

const ACCEPT = /Accept and continue/i;

// The gate does not enable the acknowledgement until the terms have actually
// been read to the end (`disabled={!scrolledToEnd}` in Onboarding.jsx), and a
// panel short enough to need no scrolling counts as read. This spec used to
// click the checkbox straight away, which only ever worked on a machine where
// the terms happened to fit the viewport. They do not fit on a CI runner, so
// the box stayed disabled and Playwright retried it for the whole 240s budget
// (488 attempts, three specs, every push). Scrolling first is both what a user
// does and what the gate asks for, and it makes the spec independent of
// viewport size and font metrics.
async function acknowledgeTerms(page) {
    const terms = page.getByLabel('License terms');
    await expect(terms).toBeVisible();
    await terms.evaluate((el) => { el.scrollTop = el.scrollHeight; });

    const ack = page.getByRole('checkbox');
    await expect(ack).toBeEnabled();
    await ack.check();
}

test.describe('license gate', () => {
    test('blocks onboarding until the terms are acknowledged', async ({ page }) => {
        await page.goto('/');

        // The gate stands in front of the Welcome screen.
        await expect(page.getByRole('button', { name: ACCEPT })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toHaveCount(0);

        await acknowledgeTerms(page);
        await expect(page.getByRole('button', { name: ACCEPT })).toBeEnabled();
        await page.getByRole('button', { name: ACCEPT }).click();
        await dismissIntroCarousel(page);

        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();
    });

    test('acceptance persists across a reload', async ({ page }) => {
        await page.goto('/');
        await acknowledgeTerms(page);
        // Wait for the button the acknowledgement ENABLES, not just for the
        // checkbox click to return. The gate derives its enabled state from a
        // state write, so a click fired in that window lands on a disabled
        // button and Playwright retries until the test times out: seen once
        // under full-suite load, green in isolation, which is the signature of
        // a race rather than a break.
        await expect(page.getByRole('button', { name: ACCEPT })).toBeEnabled();
        await page.getByRole('button', { name: ACCEPT }).click();
        await dismissIntroCarousel(page);
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();

        await page.reload();

        // Straight to Welcome; no second acceptance demanded.
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();
        await expect(page.getByRole('button', { name: ACCEPT })).toHaveCount(0);
    });

    test('acceptance records the current license version', async ({ page }) => {
        await page.goto('/');
        await acknowledgeTerms(page);
        // Wait for the button the acknowledgement ENABLES, not just for the
        // checkbox click to return. The gate derives its enabled state from a
        // state write, so a click fired in that window lands on a disabled
        // button and Playwright retries until the test times out: seen once
        // under full-suite load, green in isolation, which is the signature of
        // a race rather than a break.
        await expect(page.getByRole('button', { name: ACCEPT })).toBeEnabled();
        await page.getByRole('button', { name: ACCEPT }).click();
        await dismissIntroCarousel(page);
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();

        const stored = await page.evaluate(
            ([atKey, versionKey]) => ({
                at: window.localStorage.getItem(atKey),
                version: window.localStorage.getItem(versionKey),
            }),
            [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY],
        );

        expect(stored.version).toBe(LICENSE_VERSION);
        expect(stored.at).toBeTruthy();
    });

    // The regression guard for the bug above. Every other test in this file
    // passes at the default 1280x720 viewport whether or not the scroll
    // happens, because the terms fit there and a panel that fits counts as
    // read. That is exactly why the break reached CI unseen. This case forces a
    // viewport short enough that the terms MUST be scrolled, so the
    // acknowledgement path is proved on every machine instead of only on tall
    // ones. Reverting acknowledgeTerms to a bare checkbox.check() reddens this
    // test while the rest stay green.
    test.describe('with terms too long for the viewport', () => {
        test.use({ viewport: { width: 1280, height: 500 } });

        test('the gate opens, and only once the terms are scrolled', async ({ page }) => {
            await page.goto('/');

            // Not merely unchecked: the box cannot be ticked at all yet.
            await expect(page.getByRole('checkbox')).toBeDisabled();

            await acknowledgeTerms(page);

            await expect(page.getByRole('button', { name: ACCEPT })).toBeEnabled();
            await page.getByRole('button', { name: ACCEPT }).click();
            await dismissIntroCarousel(page);
            await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();
        });
    });

    test('a stale acceptance version re-fires the gate', async ({ page }) => {
        // Someone accepted the PREVIOUS terms. New binding terms must be
        // re-collected, so the gate has to come back.
        await page.addInitScript(
            ([atKey, versionKey]) => {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, 'stale-version');
            },
            [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY],
        );

        await page.goto('/');

        await expect(page.getByRole('button', { name: ACCEPT })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toHaveCount(0);
    });
});
