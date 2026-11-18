// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What "Add Wallet" actually leaves you looking at.
//
// After walking the whole add-wallet flow - name, password, recovery phrase,
// the verification challenge - the app switches to the wallet just added, so
// the user sees the result of what they created rather than the wallet they
// started from.
//
// This test pins that, for two reasons. First, the switch is the only on-screen
// evidence that the add worked: nothing else says "created". Second, a silent
// change here is exactly the kind that breaks a multi-wallet flow somewhere far
// away.
//
// No chain, no funds, no signing: this is a shell-state question, so it runs on
// the dev-server venue.

import { createWallet, expect, gotoSection, openWalletPicker, test, unlockedShell } from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

// Every wait below sits on the far side of an Argon2id derivation (a create or
// an unlock), so it takes the shared budget rather than a hand-picked number.
// These three carried a bare 90_000, which is HALF what CI allows: one of them
// was in the flaky set of run 30930194072. See.
const KDF_STEP_MS = kdfStepTimeout();

const PASSWORD = 'add-wallet-activation';

// Home's balance card is a region named for the active wallet; the header no
// longer carries the name.
async function expectActiveWallet(page, name, message) {
    await gotoSection(page, 'Home');
    await expect(page.getByRole('main').getByRole('region', { name, exact: true }), message || `the app did not switch to ${name}`)
        .toBeVisible({ timeout: 30_000 });
}

// A wallet row opens that wallet's page, where Set as active wallet is its
// own action (absent when the wallet is already active).
async function switchToWallet(page, name) {
    await openWalletPicker(page);
    await page.getByRole('main')
        .getByRole('button', { name: new RegExp(`^(?!Wallet details for).*${name}`) })
        .first()
        .click();
    const setActive = page.getByRole('button', { name: /^Set as active wallet/ });
    await expect(page.getByRole('button', { name: /^Remove wallet/ }).or(setActive).first()).toBeVisible({ timeout: 30_000 });
    if (await setActive.count() > 0) await setActive.click();
    await expectActiveWallet(page, name);
}

test.describe('adding a second wallet', () => {
    test('creates the wallet and makes it the active one', async ({ page }) => {
        await createWallet(page, { password: PASSWORD, name: 'First Wallet' });
        await expect(unlockedShell(page)).toBeVisible();

        await openWalletPicker(page);
        await page.getByRole('button', { name: 'Add wallet' }).click();
        await createWallet(page, {
            password: PASSWORD, name: 'Second Wallet', navigate: false,
        });
        await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });

        // THE FACT: the app is now on the wallet it just added.
        await expectActiveWallet(page, 'Second Wallet', 'after adding a wallet the app should show the new one as active');

        // ...and the first wallet is still there to switch back to.
        await switchToWallet(page, 'First Wallet');
    });

    test('the active wallet survives a page reload', async ({ page }) => {
        // Found the expensive way: a regtest spec switched to the second wallet,
        // reloaded (the cheapest way to make a freshly-confirmed UTXO visible),
        // and then minted - and the mint composed from the FIRST wallet's
        // address. On chain that looked like the first wallet minting twice
        // while the second stayed empty, which reads as a funding failure rather
        // than as the wallet having changed identity under the user.
        //
        // The money consequence is the point: with two wallets, anything
        // composed after a refresh goes from whichever wallet the app fell back
        // to, not the one whose name was last on screen.
        await createWallet(page, { password: PASSWORD, name: 'First Wallet' });

        await openWalletPicker(page);
        await page.getByRole('button', { name: 'Add wallet' }).click();
        await createWallet(page, {
            password: PASSWORD, name: 'Second Wallet', navigate: false,
        });
        await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });

        await switchToWallet(page, 'Second Wallet');

        await page.reload();
        // Unlock again: a reload drops the in-memory session key on the web
        // shell. This is the ordinary path, not a contrived one.
        const unlock = page.getByRole('button', { name: 'Unlock Wallet' });
        await unlock.or(unlockedShell(page)).first().waitFor({ state: 'visible', timeout: KDF_STEP_MS });
        if (await unlock.count() > 0) {
            await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
            await unlock.click();
            await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });
        }

        await expectActiveWallet(page, 'Second Wallet', 'after a reload the app is no longer on the wallet the user switched to');
    });
});
