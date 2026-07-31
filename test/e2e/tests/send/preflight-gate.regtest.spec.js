// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §8.6's last unrun leg: the pre-flight GATE itself (spec §4.2), driven
// against a real dry-run.
//
// The trust model is the most consequential decision in this spec - a
// network-sourced `fail` blocks Approve by DEFAULT but must always be
// overridable, because the explorer is trusted for liveness and NOT for
// censorship: a hostile or broken one that could hard-block signing could
// censor the user outright. Every part of that had been asserted only
// against mounted components until now, which is assertion against the same
// model that produced the behaviour.
//
// WHY A TOKEN SEND. The scenario was originally scripted as an excess-amount
// NATIVE send, and driving it found that it never reaches the confirm page
// at all: the form catches it first ("You don't have enough funds"), which
// is better UX and leaves the gate unexercised. A TOKEN send is the case the
// wallet CANNOT pre-empt - the token ledger lives in the indexer, the
// transaction itself only moves dust plus a miner fee, so an unaffordable
// token send composes perfectly well and only the dry-run knows better.
// That is precisely the situation pre-flight exists for.
//
// Verified against the venue before this was written: an over-balance SEND
// returns `valid:false, status:"invalid: insufficient funds"` from
// /RBTC/api/preflight, and an affordable one returns `valid:true`.
//
// WHAT IT COSTS TO GET THAT VERDICT, and why every walk below warms it
// first: a COLD dry-run on this shared venue was measured between 1.2s and
// 5.0s, and the SDK gives Tier 1 4000ms before degrading to the client tier.
// Past that line the panel renders a Tier-2-only report - right by the spec,
// identical on screen to a clean network answer, and a red that reads
// exactly like the wallet having stopped relaying the dry-run. See
// `warmPreflight` in fixtures/regtest.js.

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    REGTEST_DESTINATION,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    warmPreflight,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
const MINT_XCHAIN = 500;
/** Comfortably beyond the minted balance, so the dry-run must reject it. */
const UNAFFORDABLE = '999999';
/** Well inside it, so the same walk can then succeed unchanged. */
const AFFORDABLE = '25';

function toField(page) {
    return page.getByLabel('To', { exact: true });
}

function amountField(page) {
    return page.getByRole('textbox', { name: /^Amount/ });
}

/**
 * Warms the indexer's dry-run for the SEND this spec is about to compose, and
 * asserts the venue's own verdict matches what the walk assumes.
 *
 * Tier 1 is the whole point of this spec, and it is the one part of the report
 * that can silently go missing: a cold dry-run on this shared venue has been
 * measured anywhere from 1.2s to 5.0s, and the SDK abandons it at 4000ms. When
 * that happens the panel renders a Tier-2-only report - correct behaviour per
 * §8.4, indistinguishable on screen from a clean network answer, and a red
 * that reads exactly like a wallet defect. See `warmPreflight`.
 *
 * The `expected` check is not ceremony: the assertions below are only
 * meaningful if the network actually holds the opinion the walk is scripted
 * around, and this says so in one line at the venue instead of leaving it to
 * be inferred from missing text on a page.
 */
async function warmSend(source, amount, expected) {
    const quote = await warmPreflight({
        action: 'SEND',
        params: `0|XCHAIN|${amount}|${REGTEST_DESTINATION}`,
        source,
    });
    expect(quote.valid, `the venue's own dry-run for a ${amount} XCHAIN send disagrees `
        + `with this spec's premise: ${JSON.stringify(quote)}`).toBe(expected);
    return quote;
}

/** Picks XCHAIN in the Send asset picker, fills the form, opens the modal. */
async function composeTokenSend(page, amount) {
    await gotoSection(page, 'Send');
    await page.getByRole('button', { name: /Change asset/ }).click();
    await page.getByLabel('Search coins or tokens').fill('XCHAIN');
    await page.getByLabel(/Open XCHAIN details/i).click();
    await toField(page).fill(REGTEST_DESTINATION);
    await amountField(page).fill(amount);
    await mainButton(page, 'Send').click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
}

test.describe('pre-flight gate on regtest', () => {
    /** This wallet's own address, and the `source` every dry-run is asked about. */
    let own;

    test.beforeEach(async ({ page }) => {
        await createWallet(page, { password: PASSWORD });
        await switchToRegtest(page, PASSWORD);

        own = await readReceiveAddress(page);
        // BTC pays the miner fee; XCHAIN is what the send actually spends.
        await fundAddress(own, FUNDING_BTC);
        await page.reload();
        await unlockAfterReload(page, PASSWORD);

        await mintXchain(page, MINT_XCHAIN);
        await waitForTokenBalance(own, 'XCHAIN', MINT_XCHAIN);

        // The mint left the shell on its terminal screen; come back to a
        // clean unlocked Home before composing.
        await page.reload();
        await unlockAfterReload(page, PASSWORD);
    });

    test('an unaffordable token send fails pre-flight, blocks Approve, and can be overridden', async ({ page }) => {
        await warmSend(own, UNAFFORDABLE, false);
        await composeTokenSend(page, UNAFFORDABLE);

        // §5.2.4: the verdict chip, from a REAL dry-run. Tier 1 was
        // unreachable on every venue until , so this had never once
        // been observed rendering a fail.
        const chip = page.getByTestId('preflight-chip');
        await expect(chip).toHaveText('Will likely fail');
        await expect(page.getByTestId('preflight-panel')).toHaveAttribute('data-verdict', 'fail');

        // §4.2: the finding quotes the network's own words rather than
        // paraphrasing them. The indexer's status string is the evidence, and
        // a wallet that reworded it would be hiding which party said what.
        const panel = page.getByTestId('preflight-panel');
        await expect(panel).toContainText(/The network reports this will fail: .*insufficient funds/i);

        // Both tiers speak, independently, and BOTH are network-sourced: Tier 1
        // relays the handler's verdict, and Tier 2's balance check is only as
        // trustworthy as the explorer balance it read. `constants.js` registers
        // BALANCE_INSUFFICIENT as `network` for exactly that reason, so it too
        // is overridable. Tier-1 precedence downgrades a contradicting Tier-2
        // error only when the dry-run says VALID; here they agree.
        const dryRunAck = page.getByTestId('ack-DRYRUN_INVALID');
        const balanceAck = page.getByTestId('ack-BALANCE_INSUFFICIENT');
        await expect(panel).toContainText(/Balance of XCHAIN .* does not cover/i);
        await expect(dryRunAck).toBeVisible();
        await expect(balanceAck).toBeVisible();

        // Blocking BY DEFAULT.
        const approve = page.getByTestId('confirm-approve');
        await expect(approve).toBeDisabled();

        // Acknowledging ONE error is not enough. The override is per finding,
        // not a single "I accept whatever is wrong" switch - a user who has
        // read one warning has not thereby consented to the others.
        await dryRunAck.check();
        await expect(approve).toBeDisabled();

        // With every error acknowledged, signing is permitted. This is the
        // anti-censorship half of §4.2: a gate the explorer could hold shut
        // would let a hostile or broken one stop the user signing at all.
        await balanceAck.check();
        await expect(approve).toBeEnabled();

        // The acknowledgment is a live gate, not a one-way latch: withdrawing
        // it must re-block. A latch would mean a mis-click cannot be undone on
        // the screen whose entire job is deliberate authorization.
        await dryRunAck.uncheck();
        await expect(approve).toBeDisabled();

        // Nothing is signed here. This case proves the gate; the walk below
        // proves the fix. Reject is §5.1's always-available exit and must work
        // from a blocked state too.
        await page.getByTestId('confirm-reject').click();
        await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
    });

    test('fixing the amount clears the verdict and the send broadcasts', async ({ page }) => {
        // The scripted §8.6 walk: fail -> fix -> approve -> broadcast. The
        // point is that a rejected pre-flight is not a dead end and leaves
        // nothing behind - the second compose has to produce a clean report,
        // not a stale one.
        await warmSend(own, UNAFFORDABLE, false);
        await composeTokenSend(page, UNAFFORDABLE);
        await expect(page.getByTestId('preflight-chip')).toHaveText('Will likely fail');
        await page.getByTestId('confirm-reject').click();
        await expect(page.getByTestId('confirm-modal')).toHaveCount(0);

        // The second dry-run is a DIFFERENT action string, so it is cold
        // again. Warming it is also the only thing that makes "Looks good"
        // below mean anything: a Tier-1 verdict that never arrived produces
        // the same chip as one that came back valid, so without this the
        // clean report could be clean by omission.
        await warmSend(own, AFFORDABLE, true);

        // Fix in place: the form kept its values (§5.1), so only the amount
        // changes.
        await amountField(page).fill(AFFORDABLE);
        await mainButton(page, 'Send').click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();

        await expect(page.getByTestId('preflight-chip')).toHaveText('Looks good');

        // §1.1 / §5.2.2: the intent describes the COMPOSED action string. This
        // is the token path, so it goes through a real `decoder.parse()` of
        // what the encoder built - not the native-payment shortcut, and not
        // the form params the surface used to describe.
        await expect(page.getByTestId('action-intent'))
            .toContainText(`Send ${AFFORDABLE} XCHAIN on Bitcoin to ${REGTEST_DESTINATION}`);

        // No override control at all, because there is nothing to override.
        // Its presence would mean the previous report leaked into this one.
        await expect(page.getByTestId('ack-DRYRUN_INVALID')).toHaveCount(0);
        await expect(page.getByTestId('ack-BALANCE_INSUFFICIENT')).toHaveCount(0);

        const approve = page.getByTestId('confirm-approve');
        await expect(approve).toHaveText(/^Approve$/);
        await expect(approve).toBeEnabled();
        await approve.click();

        await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
            .toBeVisible({ timeout: 120_000 });

        // And the chain's own verdict on the action, which is the only thing
        // that closes the loop: pre-flight PREDICTED `valid`, so the handler
        // has to agree. A `pass` the indexer then rejects is the false-allow
        // the §8.2 harness bounds, and it is invisible from inside the wallet.
        const txid = (await page.getByRole('main').innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
        expect(txid, 'success screen showed no transaction id').toBeTruthy();
        const action = await waitForValidAction(txid);
        expect(action.action).toBe('SEND');
    });
});
