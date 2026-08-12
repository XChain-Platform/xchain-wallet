// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Settings sub-pages" -> the Wallet-Mode sub-page,
// third of the four surfaces the 2026-08-03 re-scope found undriven.
//
// THE CLAIM IS THE SCREEN'S OWN PROMISE, quoted from `WalletModeSection.jsx`:
// picking Signer says "Sign transactions pasted in from a watcher wallet.
// **Send / receive screens are hidden; this wallet does not broadcast.**" That
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
// The fix gates both nav surfaces, the command palette and the Send / Receive
// routes themselves on `useWalletMode().isSignerMode`, so the `.fixme` is gone
// and step 3 is now the regression guard on the promise. The assertions have
// not been touched: they were the specification, and they were correct as
// written. `test/unit/components/signerModeHidesSpendSurfaces.test.jsx` covers
// the same promise on all four reachability paths without a chain.
//
// RUN IT:
//   cd test/e2e && npx playwright test \
//       --config=playwright.regtest.config.js tests/settings/wallet-mode.regtest.spec.js

import { createWallet, expect, openSettings, test } from '../../fixtures/wallet.js';
import { unlockAfterReload } from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

/** Opens Settings and walks into the Wallet Mode sub-page. */
async function openWalletMode(page) {
    await openSettings(page);
    // Scoped to `main`: the primary navigation is full of buttons and an
    // unmatched or mis-matched click HANGS for the whole test budget rather
    // than failing (Playwright has no default action timeout).
    const row = page.getByRole('main').getByRole('button', { name: /^Wallet Mode/ });
    await expect(row, 'Settings has no Wallet Mode row').toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.getByRole('radio', { name: /^Signer/ }),
        'the Wallet Mode sub-page did not open').toBeVisible({ timeout: 30_000 });
}

test.describe('Settings: wallet mode', () => {
    test.setTimeout(300_000);

    test('choosing Signer persists AND is applied - the send/receive promise is kept',
        async ({ page }) => {
            await createWallet(page, { password: PASSWORD });

            await test.step('Signer can be chosen and the choice sticks', async () => {
                await openWalletMode(page);
                // `.check()` cannot be used, for the reason the regtest fixture
                // already records about the Developer Mode switch: the input is
                // controlled by PERSISTED settings, so `checked` does not flip
                // until the vault write resolves, and check()'s post-click
                // assertion is synchronous ("Clicking the checkbox did not
                // change its state"). Click, then wait for the state the write
                // produces.
                await page.getByRole('radio', { name: /^Signer/ }).click();
                await expect(page.getByRole('radio', { name: /^Signer/ }),
                    'the Signer radio did not take the selection').toBeChecked({ timeout: 30_000 });

                // A RELOAD, not a re-render: the whole point is to separate a
                // value the component is holding from one the vault kept.
                //
                // Unlocked BY HAND rather than through `unlockAfterReload`,
                // and this is a fixture limitation worth knowing before writing
                // any other signer-mode spec: that helper waits for
                // `unlockedShell`, which is the "Total balance" region - and a
                // signer-mode Home deliberately renders no balance at all. The
                // helper therefore cannot return on the very mode whose whole
                // point is that the balance surface is gone.
                await page.reload();
                const unlock = page.getByRole('button', { name: 'Unlock Wallet' });
                await unlock.waitFor({ state: 'visible', timeout: 60_000 });
                await page.getByLabel('Password').fill(PASSWORD);
                await unlock.click();
                await expect(page.getByRole('button', { name: 'Sign a transaction' }),
                    'the wallet did not come back unlocked into the signer surface')
                    .toBeVisible({ timeout: 90_000 });

                await openWalletMode(page);
                await expect(page.getByRole('radio', { name: /^Signer/ }),
                    'the wallet mode did not survive a reload, so it was never persisted')
                    .toBeChecked({ timeout: 30_000 });
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
                // The exact promise, quoted: "Send / receive screens are
                // hidden; this wallet does not broadcast." A wallet that still
                // offers Send in signer mode is telling the user something
                // untrue on the screen where they chose to be safe.
                await expect(page.getByRole('navigation', { name: 'Primary navigation' })
                    .getByRole('button', { name: 'Send', exact: true }),
                    'signer mode still offers SEND in the primary navigation, while the Wallet Mode '
                    + 'screen told the user "Send / receive screens are hidden; this wallet does not '
                    + 'broadcast" - a promise of REMOVED capability that was not kept')
                    .toHaveCount(0);
                await expect(page.getByRole('navigation', { name: 'Primary navigation' })
                    .getByRole('button', { name: 'Receive', exact: true }),
                    'signer mode still offers RECEIVE in the primary navigation, against the same '
                    + 'promise')
                    .toHaveCount(0);
            });
        });
});
