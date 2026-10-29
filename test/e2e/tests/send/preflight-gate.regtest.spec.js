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
// WHY AN ISSUE. A token amount above its balance never reaches this page: the
// Send form catches it first, which is better UX and leaves the gate
// unexercised. SEND also carries no protocol gas on this venue, so even a
// whole-balance send is valid. ISSUE is the in-form action whose 1 XCHAIN fee
// can exceed the payer's 0.5 XCHAIN balance while the transaction itself
// remains buildable. The real dry-run alone refuses that action, which is the
// situation this gate exists for.
//
// WHAT IT COSTS TO GET THAT VERDICT, and why every walk below warms it
// first: a COLD dry-run on this shared venue was measured between 1.2s and
// 5.0s, and the SDK gives Tier 1 4000ms before degrading to the client tier.
// Past that line the panel renders a Tier-2-only report - right by the spec,
// identical on screen to a clean network answer, and a red that reads
// exactly like the wallet having stopped relaying the dry-run. See
// `warmPreflight` in fixtures/regtest.js.

import { readShownTxid } from '../../fixtures/pendingHistory.js';
import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    REGTEST_CHAIN_LABEL,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    warmPreflight,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
const XCHAIN_BALANCE = 0.5;
const ISSUE_SUPPLY = '100';
const ISSUE_TICK = `PFG${Date.now().toString().slice(-6)}`;
const ISSUE_PARAMS = `0|${ISSUE_TICK}|${ISSUE_SUPPLY}||0||${ISSUE_SUPPLY}`;

/**
 * Warms the indexer's dry-run for the ISSUE this spec is about to compose, and
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
async function warmIssue(source, expected, feeMode = 'xchain') {
    const quote = await warmPreflight({
        action: 'ISSUE',
        params: ISSUE_PARAMS,
        source,
        ...(feeMode === 'native' ? { feeMode } : {}),
    });
    if (feeMode === 'xchain') {
        test.skip(Number(quote.xchainFee) === 0,
            'this venue charges no XCHAIN fee for ISSUE, so the fee shortfall cannot be driven: '
            + JSON.stringify(quote));
    }
    expect(quote.valid, `the venue's own ${feeMode}-fee dry-run for ISSUE ${ISSUE_TICK} disagrees `
        + `with this spec's premise: ${JSON.stringify(quote)}`).toBe(expected);
    return quote;
}

function feeToggle(scope) {
    const name = /^Pay protocol fee in BTC instead of XCHAIN/;
    return scope.getByRole('switch', { name }).or(scope.getByRole('checkbox', { name })).first();
}

async function setFeeLane(scope, nativeFee) {
    const toggle = feeToggle(scope);
    await expect(toggle, 'Bitcoin does not offer the fee choice this walk needs')
        .toBeVisible({ timeout: 30_000 });
    if (nativeFee !== (await toggle.isChecked())) await toggle.click();
    await expect(toggle).toBeChecked({ checked: nativeFee });
}

/** Fills a fresh Issue form and opens its confirm modal in the requested fee lane. */
async function composeIssue(page, { nativeFee, reuseForm = false }) {
    if (!reuseForm) await openPaletteCommand(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    if (!reuseForm) {
        await main.getByLabel('Ticker').fill(ISSUE_TICK);
        await main.getByLabel('Supply', { exact: true }).fill(ISSUE_SUPPLY);
    }
    await setFeeLane(main, nativeFee);
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();
    await expectConfirmModal(page, `the ISSUE of ${ISSUE_TICK}`, 30_000);
}

/** Creates the funded token wallet used by one pre-flight scenario. */
async function openFundedTokenWallet(page) {
    await createWallet(page, { password: PASSWORD });
    await switchToRegtest(page, PASSWORD);

    const own = await readReceiveAddress(page);
    // BTC pays the miner fee; the small XCHAIN balance drives the ISSUE fee shortfall.
    await fundAddress(own, FUNDING_BTC);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);

    await mintXchain(page, XCHAIN_BALANCE);
    await waitForTokenBalance(own, 'XCHAIN', XCHAIN_BALANCE);

    // The mint leaves the shell on its terminal screen, so remount Home.
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    return own;
}

test.describe('pre-flight gate on regtest', () => {
    test('an unaffordable token issue fails pre-flight, blocks Approve, and can be overridden', async ({ page }) => {
        const own = await openFundedTokenWallet(page);
        const quote = await warmIssue(own, false);
        expect(Number(quote.feeTokenBalance), `the venue measured a different XCHAIN balance: ${JSON.stringify(quote)}`)
            .toBe(XCHAIN_BALANCE);
        expect(quote.feeAffordable, `the venue considers the ISSUE fee affordable: ${JSON.stringify(quote)}`)
            .toBe(false);
        await composeIssue(page, { nativeFee: false });

        // §5.2.4: the verdict chip, from a REAL dry-run. Tier 1 was
        // unreachable on every venue until, so this had never once
        // been observed rendering a fail.
        const chip = page.getByTestId('preflight-chip');
        await expect(chip).toHaveText('Will likely fail');
        await expect(page.getByTestId('preflight-panel')).toHaveAttribute('data-verdict', 'fail');

        // §4.2: the finding carries the network's own reason rather than a
        // paraphrase of it. The panel frames the indexer's status as a pre-send
        // check ("This action would be refused because <reason>."), and the
        // reason after "because" is the indexer's text verbatim; a wallet that
        // reworded it would be hiding which party said what.
        const panel = page.getByTestId('preflight-panel');
        await expect(panel).toContainText(/would be refused because/i);

        // ISSUE spends no token amount, so Tier 2's balance check stays quiet
        // and the venue's fee refusal is the only error to acknowledge.
        const dryRunAck = page.getByTestId('ack-DRYRUN_INVALID');
        await expect(dryRunAck).toBeVisible();
        await expect(page.getByTestId('ack-BALANCE_INSUFFICIENT')).toHaveCount(0);

        // Blocking BY DEFAULT.
        const approve = page.getByTestId('confirm-approve');
        await expect(approve).toBeDisabled();

        // With the error acknowledged, signing is permitted. This is the
        // anti-censorship half of §4.2: a gate the explorer could hold shut
        // would let a hostile or broken one stop the user signing at all.
        await dryRunAck.check();
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

    test('switching an unaffordable issue to the native fee lane clears the verdict and broadcasts', async ({ page }) => {
        const own = await openFundedTokenWallet(page);
        // The scripted §8.6 walk: fail -> fix -> approve -> broadcast. The
        // point is that a rejected pre-flight is not a dead end and leaves
        // nothing behind - the second compose has to produce a clean report,
        // not a stale one.
        await warmIssue(own, false);
        await composeIssue(page, { nativeFee: false });
        await expect(page.getByTestId('preflight-chip')).toHaveText('Will likely fail');
        await page.getByTestId('confirm-reject').click();
        await expect(page.getByTestId('confirm-modal')).toHaveCount(0);

        // The action string stays byte-for-byte the same. Only its fee lane changes,
        // which gives the venue a different dry-run cache key and makes the
        // funded native-coin balance cover the protocol fee.
        await warmIssue(own, true, 'native');
        await composeIssue(page, { nativeFee: true, reuseForm: true });

        await expect(page.getByTestId('preflight-chip')).toHaveText('Looks good');

        // §1.1 / §5.2.2: the intent describes the COMPOSED action string, not
        // the form fields that requested it.
        await expect(page.getByTestId('action-intent').locator('p').first())
            .toContainText(`Create token ${ISSUE_TICK} with max supply ${ISSUE_SUPPLY} on ${REGTEST_CHAIN_LABEL}`);

        // No override control at all, because there is nothing to override.
        // Its presence would mean the previous report leaked into this one.
        await expect(page.getByTestId('ack-DRYRUN_INVALID')).toHaveCount(0);
        await expect(page.getByTestId('ack-BALANCE_INSUFFICIENT')).toHaveCount(0);

        // The footer action names what it signs: the action and the new token.
        const approve = page.getByTestId('confirm-approve');
        await expect(approve).toHaveText(`Create token ${ISSUE_TICK}`);
        await expect(approve).toBeEnabled();
        await approve.click();

        await expect(page.getByRole('heading', { name: 'Token issued' }))
            .toBeVisible({ timeout: 120_000 });

        // And the chain's own verdict on the action, which is the only thing
        // that closes the loop: pre-flight PREDICTED `valid`, so the handler
        // has to agree. A `pass` the indexer then rejects is the false-allow
        // the §8.2 harness bounds, and it is invisible from inside the wallet.
        // The success screen draws the id truncated; read it from its accessible name.
        const txid = await readShownTxid(page.getByRole('main'));
        expect(txid, 'success screen showed no transaction id').toBeTruthy();
        const action = await waitForValidAction(txid);
        expect(action.action).toBe('ISSUE');
        expect(action.tick).toBe(ISSUE_TICK);
    });
});
