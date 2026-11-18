// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (a): the PC-52 multi-recipient SEND, driven through the real Send
// form against a real chain, with the chain asked what happened.
//
// PC-52 met the §14 rule-1 gate with `tools/regtest/multiSendRoundtrip.cjs`,
// which composes through `flows/sendLegs.js` and broadcasts for real. That
// drill proves the FLOW. It cannot prove the FORM: it never clicks "+ Add
// recipient", never resolves the extra rows' state into legs, and never sees
// what the confirm surface tells the user they are authorizing. Everything
// between the recipient rows and `buildSendParams` - the row state, the
// per-token totals line, the multi-leg confirm summary, the reservation of the
// SUM rather than the first row - was covered only by mounted-component tests
// asserting against the same model that produces the copy.
//
// So this is the gold-standard leg for that row: a browser fills three
// recipient rows, signs once, and the EXPLORER is asked whether three legs
// landed, at the right addresses, for the right amounts, exactly once each.
//
// THREE THINGS ARE ASSERTED THAT A SINGLE-LEG SPEC CANNOT REACH
//
// 1. THE WIRE FORMAT. A same-tick multi-recipient send must go out as SEND v1
//    (one action, one tick, repeated amount/destination pairs). If the form
//    ever degrades to N single sends, or picks v2 when every leg carries the
//    same tick, the money still arrives and only `tx_data` says so.
// 2. EACH LEG CREDITED EXACTLY ONCE. The amounts are deliberately UNEQUAL
//    (7 / 3 / 1), and the read-back asserts an exact delta per address. Equal
//    amounts would make a doubled leg and a mis-ordered leg indistinguishable
// from success, which is precisely the double-pay shape.
// 3. THE SENDER PAID THE SUM, ONCE. 11 XCHAIN leaves, not 7 and not 33.
//
// The recipient addresses are PINNED, so on a shared chain they accumulate
// across runs. That is deliberate: every assertion here is a DELTA against a
// balance read just before the send, so a leg that credits twice, or a
// neighbouring session crediting the same address mid-run, fails loudly
// instead of passing on a threshold.

import { readShownTxid } from '../../fixtures/pendingHistory.js';
import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    REGTEST_CHAIN_LABEL,
    fundAddress,
    mintXchain,
    nudgeChain,
    readReceiveAddress,
    selectVenueSendAsset,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    approveConfirm,
} from '../../fixtures/regtest.js';
import { fieldByLabel } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
/** Comfortably above the 11 spent, so no leg can fail on funds. */
const MINT_XCHAIN = 1000;

/**
 * Three deterministic, checksum-valid regtest destinations, pinned as literals
 * so a failure names a stable address. Nothing holds their keys, which is what
 * a throwaway e2e destination should be.
 *
 * THESE WERE `bcrt1…` P2WPKH LITERALS UNTIL 2026-08-27, and that quietly made
 * this spec Bitcoin-only: a Bitcoin regtest bech32 address is not an address on
 * Litecoin or Dogecoin, so the moment the campaign moved off Bitcoin the send
 * had nowhere to go. They are now the P2PKH encodings of the SAME three
 * hash160s (`4b6eaaa7…`, `a1c678ac…`, `2cd31678…`) under the regtest version
 * byte 0x6f, which every one of the three regtest chains shares. So the keys
 * are unchanged, the addresses are stable, and the spec runs on whichever chain
 * `XC_REGTEST_COIN` names. Address TYPE is not what this spec is about: it is
 * about three legs crediting exactly once each.
 *
 * Unequal amounts, on purpose: see (2) in the header.
 */
const RECIPIENTS = [
    { address: 'mnPoYh8DCRVHz6HuTFm3G66fpU9a9BTBpz', amount: '7' },
    { address: 'mvGLqyJjP6BjFYHtbgxibVZGRtsD8JSwAH', amount: '3' },
    { address: 'mjbxu8VMhfNRgazS2FCkR3qsEA3JV8bWAD', amount: '1' },
];
const TOTAL_SENT = 11;

function toField(page) {
    return fieldByLabel(page, 'To');
}

/**
 * The one amount field on screen: Single's, or the open Multi add-recipient
 * form's. Only one is ever drawn, so a second match trips strict mode, which
 * is the good outcome; asserting on the wrong field silently would not be.
 */
function amountField(page) {
    return page.getByRole('textbox', { name: /^Amount/ });
}

/**
 * Multi's add-recipient form: Add Recipient opens it with the last row's
 * asset, To and Amount are filled, and Add collapses it into a row.
 */
async function addMultiRecipient(page, { address, amount }) {
    await page.getByRole('button', { name: 'Add Recipient' }).click();
    await toField(page).fill(address);
    await amountField(page).fill(amount);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
}

/**
 * Waits until `address` holds exactly `expected` of XCHAIN.
 *
 * Exact rather than at-least because "did this leg credit ONCE" is the whole
 * question. A threshold wait would return happily on a doubled credit, and
 * then the assertion after it would be checking a number the wait had already
 * accepted.
 */
async function waitForExactBalance(address, expected, what, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        // A read failure is transient (the explorer blips while a block
        // lands); a read that SUCCEEDS and disagrees is a finding, so the two
        // are kept apart rather than both swallowed by one catch.
        let read = null;
        try {
            read = await tokenBalance(address, 'XCHAIN');
        } catch { /* transient */ }
        if (read !== null) {
            last = read;
            if (last === expected) return last;
            // Overshoot can never resolve by waiting longer, and waiting out
            // the whole budget would report it as a timeout rather than as
            // the double-credit it is.
            if (last > expected) {
                throw new Error(`${what}: expected ${expected} XCHAIN, found ${last} (credited more than once?)`);
            }
        }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${what}: XCHAIN balance never reached ${expected} for ${address} (last=${last})`);
}

test.describe('multi-recipient SEND on regtest', () => {
    // The regtest config bounds `expect` but leaves actions unbounded, so a
    // click on a locator that never appears hangs until the whole test times
    // out and reports nothing useful. Spec-local, so no other suite changes.
    test.use({ actionTimeout: 30_000 });

    // Onboarding, funding, a mint and a three-leg send, each waiting on real
    // blocks on a venue that is shared with other suites and other sessions.
    test.setTimeout(1_800_000);

    test('three recipients in one signature land as three credited legs', async ({ page }) => {
        let sender;
        /** @type {number[]} */
        let before = [];
        let senderBefore = 0;
        let txid;

        await test.step('onboard onto regtest, fund it, and mint the token to send', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            // A fresh wallet holds exactly one address per chain, so the
            // Receive address IS the active address the Send form will source
            // from. (On a wallet with rotated addresses those diverge; the BET
            // spec reads the source off the form for that reason.) The mint
            // below lands on the active address, and the balance wait right
            // after it is what would catch a divergence here.
            sender = await readReceiveAddress(page);

            // BTC pays the miner fee; XCHAIN is what the send actually moves.
            await fundAddress(sender, FUNDING_BTC);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(sender, 'XCHAIN', MINT_XCHAIN);

            // The mint left the shell on its terminal screen; come back to a
            // clean unlocked Home before composing.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('read the recipients balances BEFORE the send', async () => {
            // The addresses are pinned and the chain is shared, so an absolute
            // assertion afterwards would be asserting on this run plus every
            // previous one. Deltas are the only honest form.
            before = [];
            for (const r of RECIPIENTS) before.push(await tokenBalance(r.address, 'XCHAIN'));
            senderBefore = await tokenBalance(sender, 'XCHAIN');
            expect(senderBefore, 'the mint did not land on the address the form will spend from')
                .toBe(MINT_XCHAIN);
        });

        await test.step('fill three recipient rows on the real Send form', async () => {
            await gotoSection(page, 'Send');

            // The Single tab sends to one recipient; several are the Multi
            // tab's list, so Single draws no add-recipient control at all.
            await expect(page.getByRole('button', { name: 'Add Recipient' })).toHaveCount(0);

            // Was three lines that searched for XCHAIN and clicked the first
            // "Open XCHAIN details" row - which is CHAIN-BLIND: every chain
            // lists an XCHAIN, so on Litecoin it picked Bitcoin's.
            await selectVenueSendAsset(page, 'XCHAIN');

            await toField(page).fill(RECIPIENTS[0].address);
            await amountField(page).fill(RECIPIENTS[0].amount);

            // Single's complete recipient opens as Multi's first row; each
            // further one is added through the add-recipient form.
            await page.getByRole('tab', { name: 'Multi' }).click();
            await expect(page.getByTestId('send-multi-row')).toHaveCount(1);
            for (let i = 1; i < RECIPIENTS.length; i++) {
                await addMultiRecipient(page, RECIPIENTS[i]);
            }
            await expect(page.getByTestId('send-multi-row')).toHaveCount(RECIPIENTS.length);

            // The form's own arithmetic, before anything is composed: one
            // network fee for the whole list is the claim the multi-recipient
            // path is FOR, and it is the number the user decides on.
            await expect(page.getByRole('main'))
                .toContainText(`Total: ${TOTAL_SENT} XCHAIN to 3 recipients, in one transaction with one network fee.`);
        });

        await test.step('the confirm surface names every leg, then signs once', async () => {
            await mainButton(page, 'Send').click();

            const confirm = page.getByTestId('confirm-modal');
            await expect(confirm).toBeVisible({ timeout: 60_000 });

            // §5.2.1-2 for a list, and the reason this step is asserted at all:
            // the intent is described from the COMPOSED action, and describing
            // a repeated-field SEND as if it were a single one named the first
            // recipient while paying two more people. The summary now
            // states the total and count, and every leg is
            // itemised below it.
            await expect(page.getByTestId('confirm-sentence'))
                .toContainText(`Send ${TOTAL_SENT} XCHAIN to 3 recipients`);
            // Each leg is its own fact row: the amount is the label and the
            // full address is the value, so
            // a mis-ordered or missing leg fails on its own row.
            const facts = page.getByTestId('confirm-facts');
            const recipients = page.getByTestId('confirm-recipient');
            await expect(recipients).toHaveCount(RECIPIENTS.length);
            for (let i = 0; i < RECIPIENTS.length; i++) {
                await expect(facts.locator('dt').nth(i)).toHaveText(`${RECIPIENTS[i].amount} XCHAIN`);
                await expect(recipients.nth(i)).toHaveAttribute('title', RECIPIENTS[i].address);
            }

            // A real dry-run against the indexer, on a three-leg action. The
            // §4.7 reservation covers the SUM of the primary tick; reserving
            // only the first row would leave this affordable-looking and fail
            // later, so a "Will likely fail" here is a real finding. A token SEND always
            // carries the transfer rules the network judges at settlement, so an approval
            // reads as the blue settle-time note (operator 2026-11-18).
            await expect(page.getByTestId('confirm-status')).toHaveAttribute('data-state', 'settleChecks');

            // The footer action names what it signs: one verb over the SUM of
            // the legs, so a leg dropped from the composed action shows here too.
            const approve = page.getByTestId('confirm-approve');
            await expect(approve).toHaveText(`Send ${TOTAL_SENT} XCHAIN`);
            await approveConfirm(page);

            await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
                .toBeVisible({ timeout: 180_000 });
            // The queued path would mean the node refused the transaction; it
            // must not be reported as the same outcome.
            await expect(page.getByText('Signed. Not broadcast yet.')).toHaveCount(0);

            txid = await readShownTxid(page.getByRole('main'));
            expect(txid, 'success screen showed no transaction id').toBeTruthy();
        });

        await test.step('the chain recorded ONE action, in the v1 multi-leg format', async () => {
            // waitForValidAction asserts the status of EVERY leg in `sends[]`,
            // which is the only place a partial rejection shows up: one bad
            // destination leaves the action recorded, the other legs valid,
            // and the wallet none the wiser.
            const action = await waitForValidAction(txid);
            expect(action.action).toBe('SEND');
            expect(action.sends).toHaveLength(RECIPIENTS.length);

            // The wire format the form chose. Every leg carries the same tick,
            // so this must be v1 (one TICK, repeated amount/destination pairs)
            // and not v2, whose per-leg tick field would be pure waste here.
            // The tick is written in its compacted `^id` form on chain, so the
            // assertion is on the version and the pairs rather than on the
            // literal "XCHAIN".
            expect(action.tx_data, `unexpected wire format: ${action.tx_data}`)
                .toMatch(/^SEND\|1\|/);
            for (const r of RECIPIENTS) {
                expect(action.tx_data).toContain(`${r.amount}|${r.address}`);
            }

            // Per-leg, from the chain's own decomposition rather than from the
            // string above.
            const byDestination = new Map(action.sends.map((s) => [s.destination, s]));
            for (const r of RECIPIENTS) {
                const leg = byDestination.get(r.address);
                expect(leg, `no leg for ${r.address}`).toBeTruthy();
                expect(leg.tick).toBe('XCHAIN');
                expect(Number(leg.amount)).toBe(Number(r.amount));
            }
        });

        await test.step('every recipient was credited exactly once, and the sender paid the sum', async () => {
            for (let i = 0; i < RECIPIENTS.length; i++) {
                const expected = before[i] + Number(RECIPIENTS[i].amount);
                await waitForExactBalance(RECIPIENTS[i].address, expected, `recipient ${i + 1}`);
            }

            // The other half of the same question. Three credits could also be
            // paid for by three debits (three sends), and every assertion above
            // would still hold; only the sender's balance distinguishes one
            // signature moving 11 from three signatures moving 11.
            await waitForExactBalance(sender, senderBefore - TOTAL_SENT, 'sender');
        });
    });
});
