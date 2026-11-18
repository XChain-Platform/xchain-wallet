// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wallet mode is a property of each wallet: chosen once when the wallet is
// paired, then shown read-only on Wallet Details. There is no Settings page
// for it, and create no longer offers one, so this spec adds a Signer wallet
// through the two-phone pairing page instead of switching a wallet after the
// fact.
//
// THE CLAIM IS THE MODE'S OWN PROMISE, as the create form states it: Signer
// says "Sign transactions from a watcher wallet **without showing
// send or receive screens or broadcasting from this device.**" That
// is not a description of a preference, it is a statement about what the wallet
// will no longer do - the same shape as the Tor toggle in, which offered
// a protection the wallet could not provide. So this spec asserts the promise
// rather than the setting: a mode that persists perfectly while Send stays one
// click away has not been applied, it has been recorded.
//
// That distinction is this area's documented failure mode, twice over: D-70
// (theme / reduced motion / hide-small-balances persist and apply nothing) and
// D-91 (endpoint overrides persist and nothing reads them). The method
// that separates the two cases is the one used here - change it, RELOAD, then
// check both that the control kept the value and that the behaviour changed.
// Either check alone is ambiguous.
//
// Signer mode is also the safest of the three to assert on, because it is the
// one whose promise is a REMOVAL. Watcher mode's promise (builds unsigned
// PSBTs) needs a second device to be meaningful; this one is checkable on one.
//
// HISTORY: this spec shipped RED ON PURPOSE on 2026-08-04, marked `test.fixme`
// so a directory of green specs would not learn to ignore it. **It found the
// defect it was written to look for.** As measured on the Litecoin
// venue that day:
//   - step 1 PASSED: Signer is chosen, and it survives a full reload.
//   - step 2 PASSED: Home really does become the signer surface (Sign a
//     transaction / Sign a message, no balance hero), so the mode is applied,
//     not merely recorded - this is NOT the D-70 shape.
//   - step 3 FAILED: `LeftNav` had no wallet-mode gating at all, so **Send and
//     Receive were still one click away** while the Wallet Mode screen told the
//     user "Send / receive screens are hidden; this wallet does not broadcast."
// The fix gates both nav surfaces, the wallet menu and the Send / Receive
// routes themselves on `useWalletMode().isSignerMode`, so the `.fixme` is gone
// and step 3 is now the regression guard on the promise. The assertions have
// not been touched: they were the specification, and they were correct as
// written. `test/unit/components/signerModeHidesSpendSurfaces.test.jsx` covers
// the same promise on all four reachability paths without a chain.
//
// RUN IT:
//   cd test/e2e && npx playwright test \
//       --config=playwright.regtest.config.js tests/settings/wallet-mode.regtest.spec.js

import {
    createWallet, expect, fillPairAnotherPhone, openSettings, openWalletPicker, switchToWallet, test,
} from '../../fixtures/wallet.js';
import { fieldByLabel } from '../../fixtures/fields.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const PASSWORD = 'regtestpassword123';

/**
 * The Signer wallet's phrase: a BIP39 test vector, so its checksum is valid and
 * it is nobody's live phrase. It must differ from the device's own Normal
 * wallet, because the app refuses a phrase it already holds ("This recovery
 * phrase is already in this app as ..."), which is why this spec does not use
 * `createWallet({ walletMode })`: that mirrors the Normal wallet's phrase.
 */
const SIGNER_MNEMONIC =
    'legal winner thank year wave sausage worth useful legal winner thank yellow';

/**
 * Makes the Signer wallet the way a user does since create stopped offering a
 * mode (2026-11-15): an unlocked device adds the phrase through Settings,
 * Advanced, "Use another phone as a signer", picking the signer role. The page
 * fixes the mode when it adds the wallet, before any code exchange, so this
 * leaves once this phone's pairing code is shown and switches to the wallet.
 */
async function createSignerWallet(page, walletName) {
    // A Normal wallet first: the pairing page needs an open vault. Its Home
    // waits on no balance, since the venue's mainnet default is unreachable.
    await createWallet(page, { password: PASSWORD, name: 'Device Wallet', waitForBalances: false });
    await fillPairAnotherPhone(page, {
        words: SIGNER_MNEMONIC, name: walletName, password: PASSWORD, walletMode: 'signer',
    });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copy Pairing Code' }),
        `the pairing page did not add "${walletName}" in signer mode`)
        .toBeVisible({ timeout: kdfStepTimeout() });
    await page.getByRole('button', { name: 'Back to previous screen' }).first().click();
    await switchToWallet(page, walletName);
}

test.describe('Wallet mode', () => {
    test.setTimeout(300_000);

    test('a wallet created as Signer is applied - the send/receive promise is kept',
        async ({ page }) => {
            const walletName = 'Signer Wallet';
            await createSignerWallet(page, walletName);

            await test.step('Settings no longer offers a wallet-mode page', async () => {
                await openSettings(page);
                await expect(page.getByRole('main').getByRole('button', { name: /^Wallet mode\b/ }),
                    'Settings still carries a Wallet Mode row, so the mode is not a per-wallet property')
                    .toHaveCount(0);
            });

            await test.step('the choice survives a reload', async () => {
                // A RELOAD, not a re-render: the whole point is to separate a
                // value the component is holding from one the vault kept.
                //
                // Unlocked BY HAND rather than through `unlockAfterReload`,
                // and this is a fixture limitation worth knowing before writing
                // any other signer-mode spec: that helper waits for
                // `unlockedShell`, which is the "Active address balance" region - and a
                // signer-mode Home deliberately renders no balance at all. The
                // helper therefore cannot return on the very mode whose whole
                // point is that the balance surface is gone.
                await page.reload();
                const unlock = page.getByRole('button', { name: 'Unlock Wallet' });
                await unlock.waitFor({ state: 'visible', timeout: 60_000 });
                await fieldByLabel(page, 'Password').fill(PASSWORD);
                await unlock.click();
                await expect(page.getByRole('button', { name: 'Sign a transaction' }),
                    'the wallet did not come back unlocked into the signer surface')
                    .toBeVisible({ timeout: 90_000 });

                // Wallet Details shows the mode read-only: a row, no radio.
                await openWalletPicker(page);
                await page.getByRole('button', { name: `Wallet details for ${walletName}` }).click();
                await expect(page.getByRole('main').locator('dl'),
                    'Wallet Details does not show the mode the wallet was created with, so it was never persisted')
                    .toContainText('Wallet modeSigner for another phone', { timeout: 30_000 });
                await expect(page.getByRole('radio', { name: /^Signer for another phone/ }),
                    'Wallet Details offers a mode switch, but a wallet\'s mode is final once chosen')
                    .toHaveCount(0);
            });

            await test.step('Home becomes the signer surface', async () => {
                await page.getByRole('button', { name: 'Home', exact: true }).first().click();
                // The signer Home offers signing, not balances. Asserted on the
                // CTA rather than on the absence of a balance, because an empty
                // wallet has no balance to miss.
                await expect(page.getByRole('button', { name: 'Sign a transaction' }),
                    'signer mode did not change Home at all, so the mode is recorded rather than '
                    + 'applied - the D-70 / D-91 shape this area keeps producing')
                    .toBeVisible({ timeout: 30_000 });
            });

            await test.step('and the screens the hint says are hidden ARE hidden', async () => {
                // The exact promise, quoted: "without showing send or receive
                // screens or broadcasting from this device." A wallet that still
                // offers Send in signer mode is telling the user something
                // untrue on the screen where they chose to be safe.
                await expect(page.getByRole('navigation', { name: 'Primary navigation' })
                    .getByRole('button', { name: 'Send', exact: true }),
                    'signer mode still offers SEND in the primary navigation, while the Wallet Mode '
                    + 'screen told the user it would sign "without showing send or receive screens or '
                    + 'broadcasting from this device" - a promise of REMOVED capability that was not kept')
                    .toHaveCount(0);
                await expect(page.getByRole('navigation', { name: 'Primary navigation' })
                    .getByRole('button', { name: 'Receive', exact: true }),
                    'signer mode still offers RECEIVE in the primary navigation, against the same '
                    + 'promise')
                    .toHaveCount(0);
            });
        });
});
