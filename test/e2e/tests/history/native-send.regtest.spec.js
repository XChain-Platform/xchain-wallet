// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Driven on a venue: a plain native-coin send leaves History's
// pending list once its block lands, even though the explorer never learns
// the transaction exists.
//
// The user report this answers: a testnet DOGE payment sat at "PENDING /
// not seen by network / 5 days ago" with ten thousand confirmations behind
// it, because every feed that retires the wallet's own record is action-only
// and a plain payment carries no action. The fix reads the chain's UTXO set
// through the encoder on History's own beat. What this spec proves is the
// SOURCE of each transition, not just that it happened: the explorer's
// decoded mempool and history are read as controls at each step and must
// stay empty for the txid throughout, so the sighting and the retirement
// can only have come from the UTXO set.
//
// Venue: the miner is parked before the send so the sighting can be
// observed, and released by mining ONE block explicitly. RBTC would work
// here in principle (no decoder involved), but the spec follows its
// siblings onto RLTC so the controls can read a live explorer.

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    approveAndGetTxid,
    blocksMined,
    historyRowFor,
    historyRows,
    mempoolRowFor,
    NATIVE_COIN as COIN,
    pendingRowFor,
    pickAssetByChainAndTick,
    readOwnAddress,
    searchForTx,
} from '../../fixtures/pendingHistory.js';
import {
    assertNoActionRecorded,
    encoderRpc,
    expectConfirmModal,
    fundAddress,
    minerRpc,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_DESTINATION,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Native coin funded, and the slice of it the payment moves. */
const FUNDING = 1;
const SEND_AMOUNT = '0.25';

/**
 * History polls its pending set every 20s (BALANCE_POLL_INTERVAL_MS) and on
 * focus. "Within one poll" is asserted against three beats: one that may
 * already be in flight when the block lands, one that reads the new view,
 * and one of slack for the tracker's own commit of that block.
 */
const ONE_POLL_MS = 70_000;
/**
 * The SIGHTING has a slower clock in front of it: the tracker re-reads its
 * node's mempool every 60s (MEMPOOL_INTERVAL in xchain-utxo-tracker), so a
 * broadcast lands in the UTXO view up to a minute later, and History reads
 * it on its next beat after that. Measured on RLTC: the first drive's 70s
 * budget expired at "awaiting network" with the transaction genuinely
 * seconds away from the view.
 */
const SIGHTING_MS = 130_000;

/**
 * Mines one block and waits until the tracker view of `address` carries
 * `txid` with at least one confirmation, returning that output.
 *
 * Not `waitForConfirmedUtxo`: that helper returns the FIRST output matching
 * the txid, and right after the block that is still the zero-confirmation
 * mempool entry (the tracker keeps a just-mined transaction in both stores
 * for a cleanup window), so it reports "confirmed" before the confirmed
 * store has the block. This spec is about the moment the count turns
 * positive, so it waits for exactly that.
 */
async function mineAndWaitForConfirmation(address, txid, timeoutMs = 90_000) {
    await minerRpc('generate_blocks', { count: 1 });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await encoderRpc('get_utxos', { address });
        const match = (result?.utxos || []).find((u) => u.txid === txid && Number(u.confirmations) >= 1);
        if (match) return match;
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`Transaction ${txid} never reached one confirmation in the tracker view of ${address}`);
}

test.describe(`Native-coin send lifecycle on ${REGTEST_CHAIN_LABEL} regtest`, () => {
    test.setTimeout(600_000);
    test.use({ actionTimeout: 30_000 });

    // UNCONDITIONAL: a failed run must never leave the SHARED miner parked.
    test.afterEach(async () => {
        await minerRpc('continue_mining', {}).catch(() => {});
    });

    test('a plain native send is seen by the UTXO set, then leaves the pending list within one poll of its block, with the explorer blind to it throughout', async ({ page }) => {
        /** This wallet's own address on the venue chain. */
        let own;
        /** The txid the wallet reported for the payment. */
        let txid;
        /** The miner's block counter when it was parked. */
        let heldBlocks;

        await test.step(`onboard onto ${REGTEST_CHAIN_LABEL} regtest and fund the address`, async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);
            own = await readOwnAddress(page);
            expect(own, 'the throwaway destination is this wallet\'s own address').not.toBe(REGTEST_DESTINATION);
            await fundAddress(own, FUNDING);
            await page.goto('/');
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('park the miner, so the sighting can be observed before the block', async () => {
            await minerRpc('pause_mining', {});
            const status = await minerRpc('status', {});
            expect(status?.mining_paused, 'the venue miner did not accept pause_mining').toBe(true);
            heldBlocks = await blocksMined();
        });

        await test.step(`send ${SEND_AMOUNT} ${COIN} with the chain held still`, async () => {
            await gotoSection(page, 'Send');
            await pickAssetByChainAndTick(page, REGTEST_CHAIN_LABEL, REGTEST_CHAIN_ID, COIN);
            await expect(page.getByRole('main').getByLabel('From', { exact: true })).toHaveValue(own);
            await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
            await page.getByRole('textbox', { name: `Amount (${COIN})` }).fill(SEND_AMOUNT);
            await mainButton(page, 'Send').click();
            await expectConfirmModal(page, 'this action', 30_000);
            txid = await approveAndGetTxid(page);
        });

        await test.step('CLAIM 1: the payment is a pending row, and the UTXO set (not the explorer) is what reports it seen', async () => {
            await page.getByRole('button', { name: 'View in history' }).click();
            const row = pendingRowFor(page, txid);
            await expect(row, 'no PENDING History row for the native send under the DEFAULT filters')
                .toBeVisible({ timeout: 60_000 });
            await expect(row.getByRole('button').first(), 'the pending row does not name the action')
                .toContainText('Send');

            // The sighting. Before the fix this row could only ever read
            // "awaiting-network" and then, at 180s, "not-seen": nothing on the
            // platform reported a plain payment. Now the tracker's mempool
            // view of the RECIPIENT holds the output at zero confirmations,
            // the host stamps the sighting, and the row reads "seen".
            const state = row.locator('[data-pending-state]');
            await expect(state, 'the native send was never reported seen. The recipient\'s output sits '
                + 'in the tracker\'s mempool view, so if this fails the host is not consulting the '
                + 'UTXO set for native sends')
                .toHaveAttribute('data-pending-state', 'seen', { timeout: SIGHTING_MS });

            // The CONTROLS: the sighting cannot have come from the explorer.
            expect(await mempoolRowFor(txid), 'the explorer\'s decoded mempool carries this txid, so '
                + 'this is not a plain payment and the spec is not measuring the native path')
                .toBeNull();
            expect(await blocksMined(), 'a block was mined while the miner was parked; the sighting '
                + 'above was not measured on a held chain').toBe(heldBlocks);
        });

        await test.step('CLAIM 2: one block retires the pending row within one poll, with the explorer still blind to the txid', async () => {
            // Mines exactly one block and returns once the recipient's output
            // is CONFIRMED in the tracker view: the chain's own word that the
            // payment landed, independent of anything the wallet says.
            const utxo = await mineAndWaitForConfirmation(REGTEST_DESTINATION, txid);
            expect(Number(utxo.confirmations), 'the recipient output confirmed with no confirmation count')
                .toBeGreaterThanOrEqual(1);

            await expect(pendingRowFor(page, txid), 'the native send is STILL pending after its block. '
                + 'The explorer never records a plain payment, so the only thing that can retire this '
                + 'row is the UTXO-set reconcile on History\'s poll')
                .toHaveCount(0, { timeout: ONE_POLL_MS });

            // The CONTROLS: nothing on the explorer retired it. A plain payment
            // is never an action, so its history stays empty for the txid.
            expect(await historyRowFor(own, txid), 'the explorer\'s address history carries this txid, '
                + 'so an action was recorded and the retirement may have come from the action feed')
                .toBeNull();
            await assertNoActionRecorded(txid);

            // And no confirmed row appeared in its place: there is no action
            // to show, so History simply no longer lists the payment.
            await searchForTx(page, txid);
            await expect(historyRows(page), 'History still lists a row for a plain payment the '
                + 'explorer knows nothing about').toHaveCount(0, { timeout: 30_000 });
        });

        await test.step('CLAIM 3: the retirement is on the RECORD, not just on the screen', async () => {
            // A reload rebuilds History from the vault. A row hidden by
            // renderer state alone would come back here as pending forever,
            // which is exactly the report this spec answers.
            //
            // Not `unlockAfterReload`: the web shell restores the last route,
            // so a reload taken from History lands on History (unlocked or
            // behind the unlock screen), and that helper waits for Home's
            // balance hero, which History never shows.
            await page.goto('/');
            const unlock = page.getByRole('button', { name: 'Unlock Wallet' });
            await unlock.or(page.getByRole('navigation', { name: 'Primary navigation' })).first()
                .waitFor({ state: 'visible', timeout: 150_000 });
            if (await unlock.count() > 0) {
                await page.getByLabel('Password').fill(PASSWORD);
                await unlock.click();
                await expect(page.getByRole('navigation', { name: 'Primary navigation' }))
                    .toBeVisible({ timeout: 150_000 });
            }
            await gotoSection(page, 'History');
            await searchForTx(page, txid);
            await expect(pendingRowFor(page, txid), 'after a reload the native send is pending again: the '
                + 'PendingTx record was never flipped to indexed').toHaveCount(0, { timeout: 60_000 });
        });
    });
});
