// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2 acceptance test 3, driven: a transaction whose mempool row NEVER appears
// within the window shows the "not seen by network" warning state, visibly
// distinct from healthy pending, and the warning clears the moment the
// network does report it.
//
// WHY THIS NEEDS A VENUE LEVER. On a regtest stack every node accepts
// everything the wallet broadcasts, so "the network never reported it" is not
// a state a correct send can reach by itself. The decoder is the platform's
// ONLY mempool store (spec I-47): freeze it (`docker pause`) before the
// broadcast and nothing can ever publish a sighting, which is exactly the
// world M2.2's 180s `NETWORK_SEEN_WINDOW_MS` was written for. The miner is
// parked too, so the transaction is genuinely unconfirmed the whole time and
// the row is measured as a pending entry, not a confirmed one the wallet has
// not caught up with. `afterEach` thaws and releases both unconditionally: a
// paused decoder stalls the chain's whole pipeline for every neighbour.
//
// WHY THE CLAIMS ARE SHAPED THIS WAY.
//   - CLAIM 1 pins the HEALTHY look first (state `awaiting-network`, no
//     warning glyph), so CLAIM 3's "distinct" is measured against a real
//     rendering of the other state on the same row, not against the copy.
//   - CLAIM 2 is the control that keeps this from passing for the wrong
//     reason: the explorer's own mempool must carry NOTHING for the txid, and
//     the explorer must not know the transaction at all. Before the SDK repin
//     every healthy send reached `not-seen` after 180s (frontier row 26), and
//     a test without this control would have certified that defect as the
//     feature.
//   - CLAIM 3 is the acceptance test: the same row flips to `not-seen`, wears
//     the warning, and the detail page names it.
//   - CLAIM 4 thaws the decoder and proves the warning is a report, not a
//     verdict: once the network catches up, the SAME entry confirms and no
//     pending row is left behind.
//
// WHAT IS DELIBERATELY NOT ASSERTED: that the chain stayed still. The venue's
// price keeper (global setup) re-seeds the oracle price when it nears its
// 1800s staleness limit, and its settle step mines one block, which the
// miner hold does not prevent (`pause_mining` stops IDLE mining, not
// `generate_blocks`). A window this long (180s plus polls) will sometimes
// contain that block, and it was on the first run: the not-seen state, the
// label, the glyph and the empty mempool all held, and the run went red on
// the block counter alone. With the decoder frozen that block changes
// nothing the wallet can observe (nothing decodes it), so the block count is
// RECORDED as an annotation for whoever reads the report, not asserted. The
// mempool-and-history control above is the one that carries the claim.
//
// RUN IT (the venue is workers:1 and SHARED; check for a neighbour first):
//   cd test/e2e && XC_REGTEST_COIN=RLTC XC_REGTEST_SSH_HOST=<regtest host> \
//       npx playwright test --config=playwright.regtest.config.js \
//       tests/history/not-seen.regtest.spec.js

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    approveAndGetTxid,
    blocksMined,
    chainHistoryRow,
    confirmedRowFor,
    decoderControl,
    historyRowFor,
    historyRows,
    mempoolRowFor,
    pendingRowFor,
    pickAssetByChainAndTick,
    PINNED_SDK,
    readOwnAddress,
    SDK_HAS_UNCONFIRMED,
    searchForTx,
} from '../../fixtures/pendingHistory.js';
import {
    expectConfirmModal,
    fundAddress,
    minerRpc,
    mintXchain,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_DESTINATION,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Native coin, to pay miner fees for the mint and the send. */
const FUNDING = 1;
const MINT_AMOUNT = 500;
const SEND_AMOUNT = '25';
const TICK = 'XCHAIN';

/**
 * M2.2's window, as shipped (`NETWORK_SEEN_WINDOW_MS`), plus one History poll
 * (20s) for the re-render that notices it expired, plus slack. Deliberately
 * NOT read from the source: the acceptance test is about the constant the
 * user experiences, and importing it would let a change to the constant
 * silently re-tune the test that is supposed to notice.
 */
const NOT_SEEN_BUDGET_MS = 240_000;

/** What the row says in each state, from the en table; asserted as text the user reads. */
const HEALTHY_LABEL = 'awaiting network';
const WARNING_LABEL = 'not seen by network';
const WARNING_GLYPH = '⚠';

async function reloadToHome(page) {
    await page.goto('/');
    await unlockAfterReload(page, PASSWORD);
}

test.describe(`A send the network never reports, on ${REGTEST_CHAIN_LABEL} regtest`, () => {
    // Fund + mint (mined), then a 180s window held deliberately still, then a
    // decoder poll (60s) and a confirmation. The long pole is the window.
    test.setTimeout(900_000);
    test.use({ actionTimeout: 30_000 });

    // The most important lines in the file: a frozen decoder or a parked
    // miner left behind by a failed run breaks every neighbour on the venue
    // with nothing in their logs naming this spec.
    test.afterEach(async () => {
        await decoderControl('unpause').catch(() => {});
        await minerRpc('continue_mining', {}).catch(() => {});
    });

    test('shows the "not seen by network" warning, distinct from healthy pending, and clears it once the network catches up', async ({ page }) => {
        // Without the network half of the merge this row can never be `seen`,
        // so CLAIM 4 would be red for a reason that is not the wallet's (rows
        // 26/27). Skip by name rather than fail deep in the recovery.
        test.skip(!SDK_HAS_UNCONFIRMED, `the web shell pins xchain-sdk@${PINNED_SDK}, which has no `
            + 'getUnconfirmed; the row could never leave "awaiting network" on its own and the '
            + 'not-seen state would be reached for the wrong reason.');

        let own;
        let sendTxid;
        let heldBlocks;

        await test.step(`onboard onto ${REGTEST_CHAIN_LABEL} regtest, fund, and mint ${TICK}`, async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);
            own = await readOwnAddress(page);
            expect(own, 'the throwaway destination is this wallet\'s own address')
                .not.toBe(REGTEST_DESTINATION);
            await fundAddress(own, FUNDING);
            await reloadToHome(page);
            // Mined BEFORE anything is held: the send spends the mint's change.
            await mintXchain(page, MINT_AMOUNT);
            await waitForTokenBalance(own, TICK, MINT_AMOUNT);
            await reloadToHome(page);
        });

        await test.step('park the miner and freeze the decoder, so nothing can report or confirm the send', async () => {
            await minerRpc('pause_mining', {});
            const status = await minerRpc('status', {});
            expect(status?.mining_paused, 'the venue miner did not accept pause_mining').toBe(true);
            heldBlocks = await blocksMined();
            await decoderControl('pause');
        });

        await test.step(`send ${SEND_AMOUNT} ${TICK} into a network that cannot report it`, async () => {
            await gotoSection(page, 'Send');
            await pickAssetByChainAndTick(page, TICK, REGTEST_CHAIN_ID, TICK);
            await expect(page.getByRole('main').getByLabel('From', { exact: true })).toHaveValue(own);
            await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
            await page.getByRole('textbox', { name: `Amount (${TICK})` }).fill(SEND_AMOUNT);
            await mainButton(page, 'Send').click();
            await expectConfirmModal(page, 'this action', 30_000);
            sendTxid = await approveAndGetTxid(page);
            await page.getByRole('button', { name: 'View in history' }).click();
        });

        await test.step('CLAIM 1: right after broadcast the row is HEALTHY pending: "awaiting network", no warning', async () => {
            const row = pendingRowFor(page, sendTxid);
            await expect(row, 'no pending History row for the send under the DEFAULT filters')
                .toBeVisible({ timeout: 60_000 });
            const state = row.locator('[data-pending-state]');
            await expect(state, 'a freshly broadcast send is not in the awaiting-network state')
                .toHaveAttribute('data-pending-state', 'awaiting-network');
            await expect(state, 'the healthy pending label does not read as awaiting the network')
                .toContainText(HEALTHY_LABEL);
            await expect(state, 'a healthy pending row is wearing the warning glyph, so the '
                + 'warning state would not be distinct from it')
                .not.toContainText(WARNING_GLYPH);
        });

        await test.step('CLAIM 2 (control): the network really has not reported it', async () => {
            // The venue's half of "never appears". If a row IS here, the
            // decoder was not actually frozen and CLAIM 3 would be measuring
            // the wallet's clock against a sighting it should have consumed.
            expect(await mempoolRowFor(sendTxid), 'the explorer\'s mempool carries the send, so the '
                + 'decoder was not frozen and this run cannot produce a transaction the network never '
                + 'reported').toBeNull();
            expect(await historyRowFor(own, sendTxid), 'the explorer\'s history already carries the '
                + 'send, so it was decoded and indexed under a decoder that was supposed to be frozen')
                .toBeNull();
        });

        await test.step('CLAIM 3: after the window, the SAME row shows the "not seen by network" warning, and the detail page names it', async () => {
            const row = pendingRowFor(page, sendTxid);
            const state = row.locator('[data-pending-state]');
            await expect(state, 'the row never reached the not-seen state after the 180s window: '
                + 'either the window is not timed from the broadcast, or the state never re-renders '
                + 'without a network event')
                .toHaveAttribute('data-pending-state', 'not-seen', { timeout: NOT_SEEN_BUDGET_MS });

            // Distinct in what the user reads, not only in a data attribute.
            await expect(state, 'the not-seen row does not say so').toContainText(WARNING_LABEL);
            await expect(state, 'the not-seen row does not wear the warning glyph, so it cannot be '
                + 'picked out of a list without reading it').toContainText(WARNING_GLYPH);
            await expect(state, 'the not-seen row still reads as healthy pending')
                .not.toContainText(HEALTHY_LABEL);

            // Still nothing reported: the state was reached by the clock, which
            // is the only honest way to reach it.
            expect(await mempoolRowFor(sendTxid), 'a mempool row appeared during the window, so the '
                + 'not-seen state was not reached on a transaction the network never reported')
                .toBeNull();
            expect(await historyRowFor(own, sendTxid), 'the explorer indexed the send during the '
                + 'window, so the decoder was not frozen for the whole of it').toBeNull();
            // Recorded, not asserted: see the file header. A block here is the
            // price keeper's, and with the decoder frozen it is invisible to
            // every reader the claims above consult.
            const strayBlocks = (await blocksMined()) - heldBlocks;
            test.info().annotations.push({
                type: 'chain-during-window',
                description: strayBlocks === 0
                    ? 'the chain stayed still for the whole window'
                    : `${strayBlocks} block(s) were generated during the window (price keeper); `
                        + 'the frozen decoder saw none of them',
            });

            // Exactly one row for the transaction: a warning state that
            // duplicated the entry would also be "visible".
            await searchForTx(page, sendTxid);
            await expect(historyRows(page), 'the not-seen transaction has more than one History row')
                .toHaveCount(1, { timeout: 30_000 });

            // Drill in: the standalone page carries the same verdict.
            await pendingRowFor(page, sendTxid).getByRole('button').first().click();
            const panel = page.getByRole('region', { name: 'Pending transaction' });
            await expect(panel, 'the pending panel is missing from the detail view')
                .toBeVisible({ timeout: 30_000 });
            // Both readers of the state on this page say the same thing: the
            // pending panel's headline, and the status timeline M2.2 demoted so
            // it could no longer claim "in mempool" off zero evidence.
            await expect(panel.getByText('Not seen by the network'),
                'the detail page does not headline the not-seen state').toBeVisible();
            await expect(page.getByLabel('Transaction status').getByText('Not seen by the network'),
                'the status timeline disagrees with the pending panel about the not-seen state')
                .toBeVisible();
            await expect(page.getByText('Pending, not yet validated by the service.'),
                'the not-seen detail lost its pre-validation line').toBeVisible();
            await page.getByRole('button', { name: 'Back to history' }).click();
        });

        await test.step('CLAIM 4: once the network catches up, the warning clears and the SAME entry confirms', async () => {
            // Thaw the decoder and release the chain. Whether the decoder's
            // next poll reports the transaction from the node's mempool first
            // or decodes it straight out of a block (a stray keeper block may
            // already hold it), the wallet's row must end up as the one
            // confirmed entry with no warning left behind. The intermediate
            // `seen` state is the lifecycle spec's claim, not this one's.
            await decoderControl('unpause');
            await minerRpc('continue_mining', {});
            await waitForValidAction(sendTxid);
            const chainRow = await chainHistoryRow(own, sendTxid);
            expect(Number(chainRow.block_index)).toBeGreaterThan(0);

            await searchForTx(page, sendTxid);
            await expect(pendingRowFor(page, sendTxid),
                'the pending entry is STILL in the list after its transaction confirmed')
                .toHaveCount(0, { timeout: 120_000 });
            await expect(confirmedRowFor(page, chainRow.action_index, own),
                `no confirmed History row for action ${chainRow.action_index}`)
                .toBeVisible({ timeout: 60_000 });
            await expect(historyRows(page), 'more than one row for the transaction after confirming')
                .toHaveCount(1);
        });
    });
});
