// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wrong-password message appears under the field and Unlock sits the form
// gap under it (U48: no idle space between the field and Unlock). The same line
// waits below the actions while no error shows, so the centred form keeps one
// height: the logo and the password field do not move when the error shows.
// Unlock moves down by the error line, which is the error taking its place.

const FORM_GAP_PX = 16;

import { createWallet, expect, test, lockButton, nav, unlockButton } from '../../fixtures/wallet.js';

async function lockWallet(page) {
    if (await lockButton(page).count()) {
        await lockButton(page).click();
    } else {
        await nav(page).getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('dialog', { name: 'More', exact: true })
            .getByRole('button', { name: 'Lock wallet', exact: true }).click();
    }
    await expect(unlockButton(page)).toBeVisible();
}

const SHOTS = process.env.XC_SHOT_DIR || '';

for (const size of [{ width: 360, height: 600 }, { width: 360, height: 800 }, { width: 1440, height: 900 }]) {
    test(`a wrong password does not move the locked form at ${size.width}x${size.height}`, async ({ page }) => {
        await page.setViewportSize(size);
        await createWallet(page);
        await lockWallet(page);
        const field = page.getByLabel('Password', { exact: true });
        const logo = page.locator('img[src*="xchain-color"]');
        const top = async () => (await field.boundingBox()).y;
        const logoTop = async () => (await logo.boundingBox()).y;
        const before = await top();
        const logoBefore = await logoTop();
        // U48 while idle: Unlock sits the form gap under the field.
        const fieldBox = await field.boundingBox();
        const idleUnlock = await unlockButton(page).boundingBox();
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/lock-before-error-${size.width}x${size.height}.png` });
        await field.fill('not-the-password-1');
        await unlockButton(page).click();
        const alert = page.getByRole('alert');
        await expect(alert).toHaveText('Incorrect password.', { timeout: 120_000 });
        const after = await top();
        const logoAfter = await logoTop();
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/lock-after-error-${size.width}x${size.height}.png` });
        expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
        expect(Math.abs(logoAfter - logoBefore)).toBeLessThanOrEqual(1);
        expect(idleUnlock.y - (fieldBox.y + fieldBox.height)).toBeGreaterThanOrEqual(FORM_GAP_PX - 1);
        expect(idleUnlock.y - (fieldBox.y + fieldBox.height)).toBeLessThanOrEqual(FORM_GAP_PX + 1);
        // U48 with the error: Unlock sits the form gap under the error line.
        const alertBox = await alert.boundingBox();
        const errorUnlock = await unlockButton(page).boundingBox();
        expect(Math.abs(errorUnlock.y - (alertBox.y + alertBox.height) - FORM_GAP_PX)).toBeLessThanOrEqual(1);
    });
}

// The logo has a width and an automatic height, so an image that has not decoded
// yet takes no height and the centred form shifts by half of it once it does.
// A request that never answers stands in for a slow decode.
test('the locked logo keeps its height before its file loads', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await createWallet(page);
    await lockWallet(page);
    await page.route('**/logo-probe-never.png', () => {});
    const heights = await page.evaluate(() => {
        const logo = document.querySelector('img[src*="xchain-color"]');
        const probe = logo.cloneNode();
        probe.src = '/logo-probe-never.png';
        logo.parentElement.append(probe);
        return { loaded: logo.getBoundingClientRect().height, pending: probe.getBoundingClientRect().height };
    });
    expect(heights.loaded).toBeGreaterThan(40);
    expect(Math.abs(heights.pending - heights.loaded)).toBeLessThanOrEqual(1);
});
