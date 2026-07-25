// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  / spec §8.6 scenario 1: the confirm surface, all the way to a
// real broadcast on a real chain.
//
// This is the only automated coverage that exercises the single-encode
// pipeline end to end - `composeForConfirm`, the §5.3.2 output-set
// tamper check, byte-identical `prebuiltPsbt` signing, and broadcast -
// together. The unit suites mount every one of these pieces, and the
// dev-server e2e specs drive the confirm page's copy, but neither can
// sign: only here do the composed envelope, the pre-flight round trip
// and an actual chain meet.
//
// It exists because driving this by hand found, immediately, a §1.7
// violation that the whole mounted-component suite agreed with (the
// signing button read a bare "Approve" and never named the chain). The
// lesson generalised: assertions written against the same model that
// produced the copy cannot see when the model is wrong. So the numbers
// asserted below are checked for SHAPE against the chain's own values
// rather than against constants the app also computes.

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    REGTEST_DESTINATION,
    assertNoActionRecorded,
    fundAddress,
    readReceiveAddress,
    switchToRegtest,
    unlockAfterReload,
    waitForConfirmedUtxo,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
const SEND_BTC = '0.01';

function toField(page) {
    return page.getByLabel('To', { exact: true });
}

function amountField(page) {
    return page.getByRole('textbox', { name: /^Amount/ });
}

test.describe('confirm -> broadcast on regtest', () => {
    let ownAddress;

    test.beforeEach(async ({ page }) => {
        await createWallet(page, { password: PASSWORD });
        await switchToRegtest(page, PASSWORD);

        ownAddress = await readReceiveAddress(page);
        await fundAddress(ownAddress, FUNDING_BTC);

        // Balances are fetched per chain on mount; a reload is the cheapest
        // way to make the freshly-confirmed UTXO visible to the send form
        // without reaching into app internals.
        await page.reload();
        await unlockAfterReload(page, PASSWORD);
        await gotoSection(page, 'Send');
    });

    test('the confirm page states real composed values, then Approve broadcasts', async ({ page }) => {
        await toField(page).fill(REGTEST_DESTINATION);
        await amountField(page).fill(SEND_BTC);
        await mainButton(page, 'Send').click();

        const confirm = page.getByTestId('confirm-modal');
        await expect(confirm).toBeVisible();

        // §5.2.1-2: what the user is authorizing, from the PARSED composed
        // action string rather than from form state.
        await expect(confirm).toContainText(`Send ${SEND_BTC} BTC on Bitcoin to ${REGTEST_DESTINATION}`);
        await expect(page.getByTestId('confirm-chain-badge')).toHaveText('Bitcoin');

        // §5.2.5: an EXACT fee off the composed PSBT, not the form's rate
        // estimate. Asserted as a bounded real number: a broken decomposition
        // returns null (section absent) or a nonsense total, and "some digits
        // are present" would pass on both.
        const feeText = await page.getByTestId('confirm-fee').innerText();
        const fee = Number(feeText.match(/([\d.]+)\s*BTC/)?.[1]);
        expect(Number.isFinite(fee), `unparseable fee: ${feeText}`).toBe(true);
        expect(fee).toBeGreaterThan(0);
        expect(fee).toBeLessThan(0.01);

        // §5.2.3: real balance deltas. These were dead everywhere (every
        // caller passed simulation={null}) until 49cc7be, and a null renders
        // as an absent section - so assert the numbers, and that they move by
        // the amount sent plus the fee shown above.
        const deltas = page.getByTestId('action-intent-deltas');
        await expect(deltas).toBeVisible();
        const [, from, to] = (await deltas.innerText()).match(/([\d.]+)\s*→\s*([\d.]+)/) || [];
        expect(from, 'deltas rendered no before/after pair').toBeTruthy();
        expect(Number(from) - Number(to)).toBeCloseTo(Number(SEND_BTC) + fee, 8);

        // : there is NO pre-flight panel here, and its absence is the
        // point. A plain native payment carries no XChain action, so there is
        // nothing to dry-run; the panel used to render "Will likely fail"
        // because the wallet was asking the indexer to validate a SEND for a
        // tick it has no ledger for.
        await expect(page.getByTestId('preflight-panel')).toHaveCount(0);

        // §1.7 / wallet spec §21.7: the last place the user sees which network
        // is about to move their money.
        await expect(page.getByTestId('confirm-approve')).toHaveText(/Approve & Sign on Bitcoin/);

        // Approvable outright: no "Sign anyway" override, because there is no
        // failure to override. This is what regressed users' most common
        // operation before .
        await expect(page.getByTestId('ack-DRYRUN_INVALID')).toHaveCount(0);
        await expect(page.getByTestId('confirm-approve')).toBeEnabled();
        await page.getByTestId('confirm-approve').click();

        // The terminal state. `Broadcast pending` means the node ACCEPTED the
        // transaction; "Signed. Broadcast will retry." is the queued path and
        // would mean the broadcast failed, so exclude it explicitly rather
        // than matching any success-ish screen.
        await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
            .toBeVisible({ timeout: 120_000 });
        await expect(page.getByText('Signed. Broadcast will retry.')).toHaveCount(0);

        // Everything above is still the wallet reporting on itself. Ask the
        // CHAIN: mine a block and require the destination to hold a UTXO from
        // this exact txid for this exact amount. A transaction that was signed
        // over a tampered or mis-composed output set reaches "Broadcast
        // pending" just fine and fails right here.
        const txid = (await page.getByRole('main').innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
        expect(txid, 'success screen showed no transaction id').toBeTruthy();

        const utxo = await waitForConfirmedUtxo(REGTEST_DESTINATION, txid);
        expect(Number(utxo.amount)).toBeCloseTo(Number(SEND_BTC), 8);

        // : and it went out as an ORDINARY payment. Checking only that
        // the money arrived would pass just as happily on the old behaviour,
        // which also delivered the coin - alongside an action the chain
        // recorded as invalid.
        await assertNoActionRecorded(txid);
    });

    // §5.1: exactly two exits, and Reject must cost the user nothing. Covered
    // against the dev server too, but repeated here because on a real chain
    // Reject also has to release the §4.7 reservation and abort the in-flight
    // pre-flight - a leak shows up as the NEXT compose behaving oddly.
    test('Reject leaves the wallet able to compose again', async ({ page }) => {
        await toField(page).fill(REGTEST_DESTINATION);
        await amountField(page).fill(SEND_BTC);
        await mainButton(page, 'Send').click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();

        await page.getByTestId('confirm-reject').click();
        await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
        await expect(amountField(page)).toHaveValue(SEND_BTC);

        // Re-composing the same payment must still work: if Reject stranded a
        // reservation or left an in-flight report attached, the second attempt
        // would not reach a clean, approvable confirm page.
        // A fresh compose really ran: the intent is rebuilt from the newly
        // composed action string, and the pre-flight round trip completed
        // again. (Approve's enabled-ness is NOT the probe here -  leaves
        // it gated behind the override for native sends.)
        await mainButton(page, 'Send').click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();
        await expect(page.getByTestId('action-intent'))
            .toContainText(`Send ${SEND_BTC} BTC on Bitcoin to ${REGTEST_DESTINATION}`);
        await expect(page.getByTestId('confirm-approve')).toBeEnabled();
    });

    // Was a pinned known-defect (test.fail) until  landed; now a plain
    // regression guard. Kept as its own case because the failure it watches for
    // is silent: the payment still works, so only the verdict reveals it.
    //
    // A native-coin send composes a real SEND OP_RETURN (`SEND|0|BTC|...`)
    // alongside the payment output, but the indexer has no BTC ledger and its
    // handler rejects any TICK absent from the ticks table, so the dry-run
    // correctly returns `invalid: TICK (unknown)`. Tier 1 is not wrong here -
    // it is faithfully reporting that the action the wallet is about to write
    // is invalid. The defect is upstream: the wallet broadcasts an action the
    // chain can only ever reject, and with Tier 1 reachable the confirm
    // surface now tells the user that their perfectly good payment "Will
    // likely fail" - on the most common operation in the wallet, which is
    // exactly the training-users-to-click-through failure mode §4.2's
    // false-block invariant exists to prevent.
    //
    // This went unseen because no venue had Tier 1 configured until .
    test('a valid native-coin send is never reported as likely to fail', async ({ page }) => {
        await toField(page).fill(REGTEST_DESTINATION);
        await amountField(page).fill(SEND_BTC);
        await mainButton(page, 'Send').click();

        await expect(page.getByTestId('confirm-modal')).toBeVisible();
        await expect(page.getByTestId('confirm-approve')).toBeEnabled();
        await expect(page.getByText(/Will likely fail/i)).toHaveCount(0);
    });
});
