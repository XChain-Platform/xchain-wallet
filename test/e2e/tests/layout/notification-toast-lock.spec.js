// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A payment notification toast names an amount. Locking the wallet takes
// every notification toast off the screen, queued ones included. The spec
// uses a password wallet because a demo wallet stays open on Lock.

import { createWallet, expect, test, unlockButton } from '../../fixtures/wallet.js';

const fire = (page, title) => page.evaluate((text) => {
    window.dispatchEvent(new CustomEvent('xchain:notification', {
        detail: { kind: 'incoming-receipt', title: text, body: 'Payment arrived.' },
    }));
}, title);

test('a lock removes the notification toasts from the screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await createWallet(page);
    for (let index = 1; index <= 6; index += 1) await fire(page, `${index}.25 LOCKAMT received`);
    await expect(page.getByText('1.25 LOCKAMT received', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Lock wallet' }).first().click();
    await expect(unlockButton(page)).toBeVisible();
    // One read, no retry: a retrying assertion would wait out the toast timers.
    expect(await page.locator('body').innerText()).not.toContain('LOCKAMT');
});
