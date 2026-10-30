// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The reachability notice's Details link lines up with the message text.
//
// On a phone the message fills the line and Details wraps below it. Any
// inline padding on the link would start its word to the right of the
// message's first letter, so it would read as indented. The device is
// taken offline in the page itself (navigator.onLine plus the offline event),
// which raises the notice at once without blocking the dev server.

import { createWallet, expect, gotoSection, test } from '../../fixtures/wallet.js';

async function goOffline(page) {
    await page.evaluate(() => {
        Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
        window.dispatchEvent(new Event('offline'));
    });
}

// Left edge of the first glyph of an element's text, not of its box.
async function textLeft(locator) {
    return locator.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && !node.textContent.trim()) node = walker.nextNode();
        const range = document.createRange();
        const start = node.textContent.search(/\S/);
        range.setStart(node, start);
        range.setEnd(node, start + 1);
        return range.getBoundingClientRect().left;
    });
}

test('the Details link starts where the message text starts on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await createWallet(page);
    await goOffline(page);
    // Receive reads the network but shows no balance, so the shell notice is
    // the page's only message and says its information may be out of date.
    await gotoSection(page, 'Receive');

    const message = page.getByRole('status').filter({ hasText: 'Some information may be out of date' });
    await expect(message).toBeVisible();
    const details = page.getByRole('button', { name: 'Details', exact: true });
    await expect(details).toBeVisible();

    const messageBox = await message.boundingBox();
    const detailsBox = await details.boundingBox();
    // The link wraps below the message at this width; the check is about
    // that second line.
    expect(detailsBox.y).toBeGreaterThanOrEqual(messageBox.y + messageBox.height - 1);
    const offset = (await textLeft(details)) - (await textLeft(message));
    expect(Math.abs(offset), `Details starts ${offset.toFixed(1)}px from the message text`)
        .toBeLessThanOrEqual(1);
});
