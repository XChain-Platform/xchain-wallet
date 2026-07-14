// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Send form UX (§29): form -> validation -> confirm stage.
//
// The destination MUST be checksum-valid for the chain : the
// wallet now decodes the address rather than pattern-matching it, so the
// old `bc1qtestrecipient000...` placeholders these specs used are (very
// correctly) rejected. Any fixture address here has to be a real one.
//
// ADS donation consent is declined by the fixture: an enabled donation
// appends an extra output, which would move the amounts asserted here.
//
// Broadcast is not reachable in this shell: the web dev server runs the
// dev-mock SDK, whose signing path throws by design. See the final test.

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';

const PASSWORD = 'sendpassword123';
// BIP173 test vector: a checksum-valid mainnet P2WPKH address.
const VALID_BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

/** The "To" field's accessible name is a substring of others ("Switch input to USD"). */
function toField(page) {
    return page.getByLabel('To', { exact: true });
}

function amountField(page) {
    return page.getByRole('textbox', { name: /^Amount/ });
}

/** Memo lives behind the collapsed "Advanced" disclosure. */
async function openAdvanced(page) {
    await page.locator('summary', { hasText: 'Advanced' }).first().click();
}

test.describe('send form', () => {
    test.beforeEach(async ({ page }) => {
        // Each browser context starts with an empty IDB, so seed a wallet.
        await createWallet(page, { password: PASSWORD });
        await gotoSection(page, 'Send');
    });

    test('an invalid destination is rejected', async ({ page }) => {
        // Checksum-invalid: right prefix, wrong everything else. Signing this
        // would burn the coin to an unspendable output.
        await toField(page).fill('bc1qtestrecipient00000000000000000000000000');
        await amountField(page).fill('0.01');
        await mainButton(page, 'Send').click();

        await expect(page.getByRole('alert').first()).toContainText(
            /not a valid Bitcoin address/i,
        );
    });

    test('zero amount is rejected', async ({ page }) => {
        await toField(page).fill(VALID_BTC);
        await amountField(page).fill('0');
        await mainButton(page, 'Send').click();

        await expect(page.getByRole('alert').first()).toContainText(/positive/i);
    });

    test('protocol-forbidden memo characters are rejected', async ({ page }) => {
        await toField(page).fill(VALID_BTC);
        await amountField(page).fill('0.01');
        await openAdvanced(page);
        await page.getByRole('textbox', { name: 'Memo' }).fill('a|b');
        await mainButton(page, 'Send').click();

        await expect(page.getByRole('alert').first()).toContainText(
            /cannot contain \| or ; characters/i,
        );
    });

    test('confirm stage summarizes the payment before signing', async ({ page }) => {
        await toField(page).fill(VALID_BTC);
        await amountField(page).fill('0.01');
        await mainButton(page, 'Send').click();

        // What the user is about to authorize: amount, chain, destination.
        await expect(page.getByRole('main')).toContainText(`Send 0.01 BTC on Bitcoin to ${VALID_BTC}`);
        // ...and what it costs them.
        await expect(page.getByRole('region', { name: 'Balance changes' })).toContainText(
            /Network fee/i,
        );
        await expect(page.getByRole('button', { name: /Sign on Bitcoin/ })).toBeVisible();
    });

    test('a failed signing attempt surfaces an error ', async ({ page }) => {
        // REGRESSION GUARD. A failing submit on an UNLOCKED software wallet used
        // to vanish: the error surface lived on the password Input, which is not
        // rendered once the session is unlocked, and the forms only showed their
        // own error banner for the watcher / hardware paths. So pressing "Sign"
        // left the confirm stage untouched with no alert, no busy state and no
        // console error -- indistinguishable from a dead button.
        //
        // Here the dev-mock SDK cannot sign and rejects by design, which is a
        // perfectly good failure to render. What matters is that the user is
        // TOLD something went wrong rather than left staring at a stuck screen.
        await toField(page).fill(VALID_BTC);
        await amountField(page).fill('0.001');
        await mainButton(page, 'Send').click();

        await page.getByRole('button', { name: /Sign on Bitcoin/ }).click();

        await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 20_000 });
    });
});
