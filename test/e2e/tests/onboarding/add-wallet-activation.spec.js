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
// Written because a regtest spec assumed the obvious thing and was wrong: after
// walking the whole add-wallet flow - name, password, recovery phrase, the
// verification challenge - the app comes back on the wallet you STARTED from,
// with the new one merely present in the picker. `CreateWallet mode="add"`
// finishes by calling App's `refresh`, which resets the view to home and
// re-reads the session but never touches `activeWalletId`.
//
// This test does not judge that. It pins it, for two reasons. First, the
// behaviour was invisible: nothing on screen says "created", and the only
// evidence is a wallet name in the nav that most users are not watching.
// Second, whichever way it should behave, a silent change of mind here is
// exactly the kind that breaks a multi-wallet flow somewhere far away - which
// is how it was found.
//
// No chain, no funds, no signing: this is a shell-state question, so it runs on
// the dev-server venue.

import { createWallet, expect, test, unlockedShell } from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

// Every wait below sits on the far side of an Argon2id derivation (a create or
// an unlock), so it takes the shared budget rather than a hand-picked number.
// These three carried a bare 90_000, which is HALF what CI allows: one of them
// was in the flaky set of run 30930194072. See.
const KDF_STEP_MS = kdfStepTimeout();

const PASSWORD = 'add-wallet-activation';

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test.describe('adding a second wallet', () => {
    test('creates the wallet but leaves the first one active', async ({ page }) => {
        await createWallet(page, { password: PASSWORD, name: 'First Wallet' });
        await expect(unlockedShell(page)).toBeVisible();

        await gotoPalette(page, 'Switch wallet');
        await page.getByRole('button', { name: 'Add Wallet' }).click();
        await createWallet(page, {
            password: PASSWORD, name: 'Second Wallet', navigate: false,
        });
        await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });

        // THE FACT: the app is back on the wallet it started from.
        await expect(page.getByRole('button', { name: /First Wallet/ }).first(),
            'after adding a wallet the app should still show the first one as active')
            .toBeVisible({ timeout: 30_000 });

        // ...and the new wallet does exist, which is the half that makes the
        // above merely surprising rather than broken. Without this assertion a
        // silently-failed creation would look identical.
        await gotoPalette(page, 'Switch wallet');
        await expect(page.getByRole('button', { name: /Second Wallet/ }).first(),
            'the newly added wallet is not in the picker, so it was never created')
            .toBeVisible({ timeout: 30_000 });

        // And it can be switched to, which is the user's actual path forward.
        await page.getByRole('button', { name: /Second Wallet/ }).first().click();
        await expect(page.getByRole('button', { name: /Second Wallet/ }).first(),
            'switching to the newly added wallet did not take')
            .toBeVisible({ timeout: 30_000 });
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

        await gotoPalette(page, 'Switch wallet');
        await page.getByRole('button', { name: 'Add Wallet' }).click();
        await createWallet(page, {
            password: PASSWORD, name: 'Second Wallet', navigate: false,
        });
        await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });

        await gotoPalette(page, 'Switch wallet');
        await page.getByRole('button', { name: /Second Wallet/ }).first().click();
        await expect(page.getByRole('button', { name: /Second Wallet/ }).first())
            .toBeVisible({ timeout: 30_000 });

        await page.reload();
        // Unlock again: a reload drops the in-memory session key on the web
        // shell. This is the ordinary path, not a contrived one.
        const unlock = page.getByRole('button', { name: 'Unlock Wallet' });
        await unlock.or(unlockedShell(page)).first().waitFor({ state: 'visible', timeout: KDF_STEP_MS });
        if (await unlock.count() > 0) {
            await page.getByLabel('Password').fill(PASSWORD);
            await unlock.click();
            await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });
        }

        await expect(page.getByRole('button', { name: /Second Wallet/ }).first(),
            'after a reload the app is no longer on the wallet the user switched to')
            .toBeVisible({ timeout: 30_000 });
    });
});
