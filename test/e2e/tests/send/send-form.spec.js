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

    // : a native-coin send has no memo to reject. The field only ever
    // existed as part of an XChain SEND action, and the chain rejects that
    // action outright for a native tick (there is no BTC ledger), so the memo
    // was never recorded or queryable - an input that silently did nothing.
    // Native sends are now plain payments with no action, so the field is gone.
    // The delimiter rule still applies to token sends, where a memo is real;
    // that is covered by the validator's own unit tests.
    test('a native-coin send offers no memo field', async ({ page }) => {
        await toField(page).fill(VALID_BTC);
        await amountField(page).fill('0.01');
        await openAdvanced(page);

        await expect(page.getByRole('textbox', { name: 'Memo' })).toHaveCount(0);
        // The disclosure really did open, or this would pass on a collapsed
        // panel that simply renders nothing.
        await expect(page.getByText('Replace-by-fee')).toBeVisible();
    });

    // : with the `send` slice flag on (it now defaults true), Send goes
    // to the single-encode CONFIRM page rather than the legacy review stage.
    // This is the first coverage that drives that page in a real browser; the
    // unit suites mount it, but only here does the composed envelope, the
    // pre-flight round trip and the rendered copy meet each other.
    test('the confirm page states the action, the chain and the exact fee', async ({ page }) => {
        await toField(page).fill(VALID_BTC);
        await amountField(page).fill('0.01');
        await mainButton(page, 'Send').click();

        const confirm = page.getByTestId('confirm-modal');
        await expect(confirm).toBeVisible();
        // The intent line ("Send 0.01 BTC on Bitcoin to <addr>") is deliberately
        // NOT asserted here, and this venue cannot assert it . Since
        //  removed the caller-supplied intent fallback, that line comes
        // solely from sdk.decoder.describe(), which the dev-mock host does not
        // implement (packages/web/src/hostBridge.js exposes only
        // decodeActionFromPsbt). composeActionForConfirm swallows the resulting
        // TypeError, so decoded is null and the line never renders. Teaching the
        // mock to describe would put a SECOND describer in front of a signing
        // screen, which is the fidelity trap  warns about. The assertion
        // lives on the regtest venue instead, against the PROD build and the real
        // SDK: confirm-broadcast.regtest.spec.js:82 and :172, and
        // preflight-gate.regtest.spec.js:174. What this venue still owns is
        // everything the mock CAN answer for honestly, below.
        await expect(page.getByTestId('confirm-chain-badge')).toHaveText('Bitcoin');
        // §5.2.5: the fee comes from the composed PSBT, so it is an exact
        // amount, not the form's rate estimate.
        await expect(confirm).toContainText(/Network fee: [\d.]+ BTC/);
        // §5.2.6: the hardware note names this screen as the intent surface.
        await expect(confirm).toContainText(/hardware device verifies native outputs/i);
    });

    // §1.7 / wallet spec §21.7. The chain on the signing button is the last
    // place the user sees WHICH network is about to move their money, and the
    // confirm page is reached several screens after the chain was picked. This
    // shipped as a bare "Approve" and only a browser caught it: the copy was
    // internally consistent, so every unit test agreed with it.
    test('the signing button names the chain it will sign on', async ({ page }) => {
        await toField(page).fill(VALID_BTC);
        await amountField(page).fill('0.01');
        await mainButton(page, 'Send').click();

        await expect(page.getByTestId('confirm-approve')).toHaveText(/^Approve$/);
    });

    // §5.1: exactly two exits. Reject returns to the form with its values
    // intact - a confirmation the user backs out of must not cost them the
    // payment they just typed.
    test('Reject returns to the form with the entered values intact', async ({ page }) => {
        await toField(page).fill(VALID_BTC);
        await amountField(page).fill('0.01');
        await mainButton(page, 'Send').click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();

        await page.getByTestId('confirm-reject').click();

        await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
        await expect(toField(page)).toHaveValue(VALID_BTC);
        await expect(amountField(page)).toHaveValue('0.01');
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

        await page.getByTestId('confirm-approve').click();

        await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 20_000 });
    });
});
