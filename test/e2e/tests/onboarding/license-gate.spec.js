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

import { LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, expect, test } from '../../fixtures/wallet.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';

test.use({ acceptLicense: false });

const ACCEPT = /Accept and continue/i;

test.describe('license gate', () => {
    test('blocks onboarding until the terms are acknowledged', async ({ page }) => {
        await page.goto('/');

        // The gate stands in front of the Welcome screen.
        await expect(page.getByRole('button', { name: ACCEPT })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toHaveCount(0);

        await page.getByRole('checkbox').check();
        await expect(page.getByRole('button', { name: ACCEPT })).toBeEnabled();
        await page.getByRole('button', { name: ACCEPT }).click();

        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();
    });

    test('acceptance persists across a reload', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: ACCEPT }).click();
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();

        await page.reload();

        // Straight to Welcome; no second acceptance demanded.
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();
        await expect(page.getByRole('button', { name: ACCEPT })).toHaveCount(0);
    });

    test('acceptance records the current license version', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: ACCEPT }).click();
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
