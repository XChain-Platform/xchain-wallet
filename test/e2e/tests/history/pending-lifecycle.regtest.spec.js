// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2 acceptance test 5, Playwright half (spec
// the unconfirmed-transaction spec, row 22): one real
// send driven send -> pending-visible -> confirmed, on a venue whose miner is
// HELD between the broadcast and the pending assertion.
//
// WHY THE MINER HAS TO BE HELD, and why that is the whole difficulty. On
// regtest a transaction can be broadcast AND mined between two of the decoder's
// 60s mempool polls, in which case no mempool row is ever written and there is
// nothing pending for the wallet to show - a red spec with no product defect
// behind it (spec I-40). This venue's miner exposes `pause_mining` /
// `continue_mining` (the same lever `send/reservation-race.extension.spec.js`
// uses for the same reason), and explicit `generate_blocks` still works while
// paused, so funding and the mint are unaffected. Everything between the
// broadcast and CLAIM 4 runs with the miner parked, and `afterEach` releases it
// unconditionally - a spec that leaves the SHARED regtest miner stopped breaks
// every run after it, including another session's.
//
// WHAT WOULD BE FALSE IF THIS PASSED VACUOUSLY. Three things, and each one is
// a separate claim below rather than a step in one long walk:
//
//   - "A pending row is on screen" is not the claim. The claim is that the row
//     for THIS txid survives History's DEFAULT filters. The default date window
//     is [today-30d, today] and `applyHistoryFilters` DROPS any entry with a
//     null timestamp while a date filter is active, so a merged pending entry
//     that forgot to carry a timestamp is invisible to every real user while
//     being perfectly present in the DOM of a spec that widened the window
//     first. `history-coverage.regtest.spec.js` widens (it predates the fix in
//     I-54 and is about something else); this spec must NOT, and the absence of
//     `widenDateWindow` here is load-bearing rather than an omission.
//
//   - "A confirmed row appears afterwards" is not the claim either. That would
//     pass just as happily on a build that leaves the pending row behind and
//     adds a second one beside it, which is the exact failure the tx-hash merge
//     exists to prevent. So CLAIM 4 asserts the count: searching this txid
//     yields exactly ONE row before the block and exactly ONE after it, and the
//     `pending:` key is GONE rather than merely outnumbered.
//
//   - The mempool sighting is asserted against the EXPLORER'S OWN record
//     first (`/{COIN}/api/mempool`), not against the screen. If the screen and
//     the venue agree that this txid is in a mempool, they agree about
//     something neither of them made up; a screen-only assertion would pass on
//     a wallet that renders "pending" off its own optimism.
//
//   - "Speed up and Cancel are offered" (CLAIM 3B) is a claim about a REAL
//     pending entry and cannot be made anywhere else. The offer was once gated
//     on the entry having an explorer link, so it was withdrawn from precisely
//     the transactions it serves: a pending regtest send has no action index
//     for the XChain link and regtest has no third-party explorer. A fixture
//     that hands the component an entry with links attached never sees that.
//     What the buttons DO is deliberately not asserted - no shell registers a
//     `replaceTx` handler, so there is no replacement engine in any build.
//
// A DEFECT THIS FILE PINS RATHER THAN HIDES, stated here because it explains
// the shape of everything below. The wallet builds against the PUBLISHED
// `@dankest-llc/xchain-sdk@0.10.0`, which predates M1.2 and therefore has no
// `getUnconfirmed`; `addressMempool` guards on exactly that and returns `[]`,
// so the NETWORK half of the M2.1 merge is a silent no-op on every wallet
// build today and a pending row never leaves "awaiting network". The venue
// half works and is asserted in the passing test (CLAIM 2); the wallet half is
// the `test.fixme` at the bottom, which carries the measurement and the fix.
//
// THE TWO PENDING SOURCES ARE DIFFERENT CLAIMS, which is why CLAIM 1 and
// CLAIM 2 are separate. History merges TWO things (spec M2.1): this wallet's
// own in-flight PendingTx records, available the instant the send is broadcast,
// and the explorer's mempool rows, which lag broadcast by up to ~85s (decoder
// poll 60s + its getmempool TTL 5s + the explorer's snapshot cache 15s + the
// change detector's 5s). So the row appears IMMEDIATELY reading
// "awaiting network" (CLAIM 1, local record) and only later upgrades to
// "pending" (CLAIM 2, network sighting). A spec that asserted the seen state
// straight away would be red for ~80s on a healthy venue, and one that only
// asserted the local half would never touch the explorer at all.
//
// SCREEN FACTS worth more than the time they cost to find:
//   - A pending entry's `data-history-key` is `pending:<chainId>:<txHashLower>`
//     (`pendingKeyFor`), NOT the `<chainId>:<actionIndex>:<address>` a confirmed
//     row carries. The key CHANGING is what confirmation looks like from the
//     DOM, and it is why CLAIM 4 can assert the swap positively.
//   - The row's state word lives on a `[data-pending-state]` span inside the
//     row button, values `awaiting-network | seen | not-seen | dropped |
//     replaced` (`pendingDisplayState`). The visible text is i18n'd
//     ("awaiting network" / "pending" / "not seen by network"), so assert the
//     attribute and let the text be the copy's business.
//   - The standalone pending ActionDetail is titled with the bare action label
//     ("Send"), never "Send #N": a pending action has no index, and `#0` would
//     name a real action on every chain. That is a usable negative assertion.
//   - History's search box is `<input type="search">`, so its role is SEARCHBOX
//     and `getByRole('textbox', ...)` matches nothing. Address it by label.
//   - `entryMatchesSearch` matches a pending entry on `txHash`, which is the
//     only field that is populated identically before and after confirmation -
//     which is exactly why the count claim searches by txid.
//
// RUN IT (the venue is workers:1 and SHARED; check for a neighbour first):
//   cd test/e2e && XC_REGTEST_COIN=RLTC XC_REGTEST_SSH_HOST=<regtest host> \
//       npx playwright test --config=playwright.regtest.config.js \
//       tests/history/pending-lifecycle.regtest.spec.js
//
// RBTC CANNOT RUN THIS AT ALL and says so by skipping rather than failing
// deep in CLAIM 2: the Bitcoin regtest decoder is dead in a restart loop
// (a tracked defect) and the decoder is the platform's ONLY mempool store (spec
// I-47), so no mempool row can ever exist for it. RLTC and RDOGE are healthy.

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    approveAndGetTxid,
    blocksMined,
    chainHistoryRow,
    confirmedRowFor,
    historyRows,
    NATIVE_COIN as COIN,
    pendingRowFor,
    pickAssetByChainAndTick,
    readOwnAddress,
    searchForTx,
    waitForMempoolRow,
} from '../../fixtures/pendingHistory.js';
import {
    expectConfirmModal,
    fundAddress,
    minerRpc,
    mintXchain,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    REGTEST_DESTINATION,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Native coin, to pay miner fees for the mint and the send. */
const FUNDING = 1;
/** XCHAIN minted, then the slice of it the SEND actually moves. */
const MINT_AMOUNT = 500;
const SEND_AMOUNT = '25';
const TICK = 'XCHAIN';

/**
 * The Bitcoin regtest decoder is in a restart loop, and the decoder is the only
 * mempool store, so RBTC can produce a pending SIGHTING for nothing. Skipping
 * by name beats CLAIM 2 timing out on a venue nobody expected it to run on.
 */
const VENUE_HAS_NO_MEMPOOL = REGTEST_COIN === 'RBTC';

/* ───── venue reads ────────────────────────────────────────────────── */

/* ───── wallet walks ───────────────────────────────────────────────── */

/** Reloads onto a clean, unlocked Home so the next form opens with fresh state. */
async function reloadToHome(page) {
    await page.goto('/');
    await unlockAfterReload(page, PASSWORD);
}

/* ───── History screen ─────────────────────────────────────────────── */

test.describe(`Pending transaction lifecycle on ${REGTEST_CHAIN_LABEL} regtest`, () => {
    // Two real broadcasts, one indexing wait, and up to 210s of deliberately
    // holding the chain still while the decoder catches up. The long pole here
    // is the decoder's own 60s cadence, not the app.
    test.setTimeout(900_000);
    // Without this, actions inherit the TEST budget, so one unmatched locator
    // costs fifteen minutes instead of thirty seconds.
    test.use({ actionTimeout: 30_000 });
    test.skip(VENUE_HAS_NO_MEMPOOL, `${REGTEST_COIN} has no mempool store this spec can read: its `
        + 'regtest decoder is in a restart loop and the decoder is the only mempool '
        + 'store on the platform, so a pending SIGHTING can never exist here. Run with '
        + 'XC_REGTEST_COIN=RLTC (or RDOGE).');

    // UNCONDITIONAL, and the most important four lines in the file. A failed or
    // timed-out run must never leave the SHARED regtest miner parked: the next
    // spec, and another session's whole suite, would then hang on funding that
    // never confirms with nothing in their logs naming this run.
    test.afterEach(async () => {
        await minerRpc('continue_mining', {}).catch(() => {});
    });

    test('a send is visible as pending under the default filters, drills into the pending detail, and becomes the SAME entry once mined', async ({ page }) => {
        /** This wallet's own address; the source of the send and the History subject. */
        let own;
        /** The txid the wallet reported for the SEND. */
        let sendTxid;
        /** The miner's block counter at the moment it was parked. */
        let heldBlocks;
        /** The explorer's own history row for the send, once it confirms. */
        let chainRow;

        await test.step(`onboard onto ${REGTEST_CHAIN_LABEL} regtest and fund the address`, async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            own = await readOwnAddress(page);
            // The destination must not be this wallet's own address, or the
            // merge would be reconciling a self-send and the direction the
            // pending row reports would be true by accident.
            expect(own, 'the throwaway destination is this wallet\'s own address, so the pending '
                + 'entry would prove nothing about direction').not.toBe(REGTEST_DESTINATION);

            await fundAddress(own, FUNDING);
            await reloadToHome(page);
        });

        await test.step(`mint ${TICK}, the one action a fresh wallet can afford to write`, async () => {
            // XCHAIN is free-mintable on regtest by any address, so this needs
            // no ISSUE and no issuance fee quote. Done BEFORE the miner is
            // parked: the wallet spends only CONFIRMED utxos, so the send below
            // needs the mint's change output already in a block.
            await mintXchain(page, MINT_AMOUNT);
            await waitForTokenBalance(own, TICK, MINT_AMOUNT);
            await reloadToHome(page);
        });

        await test.step('park the miner, so nothing can confirm under the pending assertions', async () => {
            await minerRpc('pause_mining', {});
            const status = await minerRpc('status', {});
            // Asserted rather than assumed: if the lever silently no-ops, every
            // claim below becomes a coin flip against the 60s decoder poll, and
            // that flake would be blamed on the wallet.
            expect(status?.mining_paused, 'the venue miner did not accept pause_mining, so a block '
                + 'could land between the broadcast and the pending assertion and there would be '
                + 'nothing pending left to assert on').toBe(true);

            heldBlocks = await blocksMined();
        });

        await test.step(`send ${SEND_AMOUNT} ${TICK} with the chain held still`, async () => {
            await gotoSection(page, 'Send');
            await pickAssetByChainAndTick(page, TICK, REGTEST_CHAIN_ID, TICK);
            await expect(page.getByRole('main').getByLabel('From', { exact: true }))
                .toHaveValue(own);
            await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
            await page.getByRole('textbox', { name: `Amount (${TICK})` }).fill(SEND_AMOUNT);
            await mainButton(page, 'Send').click();

            await expectConfirmModal(page, 'this action', 30_000);
            sendTxid = await approveAndGetTxid(page);
        });

        await test.step('CLAIM 1: the success card leads to a PENDING row that survives the DEFAULT filters', async () => {
            // M2.4's jump, not a nav walk: the card's own "View in history" is
            // the path a user takes here, and it hands History an `initialFocus`
            // keyed on the TX HASH (there is no action index yet, which is the
            // whole reason the card offers it).
            await page.getByRole('button', { name: 'View in history' }).click();

            const row = pendingRowFor(page, sendTxid);
            // No date widening above. If this fails while the row is present
            // under a widened window, the defect is the default filter hiding
            // recent pending entries (I-54), not the merge.
            await expect(row, 'no PENDING History row for the send under the DEFAULT filters. If '
                + 'widening the date window makes it appear, the defect is the default 30-day '
                + 'filter dropping the merged entry, not the merge itself')
                .toBeVisible({ timeout: 60_000 });

            const button = row.getByRole('button').first();
            await expect(button, 'the pending row does not name the action').toContainText('Send');
            await expect(button, 'a blockless row is not classified as Pending').toContainText('Pending');

            // The state machine, not the copy: right after broadcast nothing has
            // reported the transaction yet, so the only honest states are
            // "awaiting network" or (if the decoder was already quick) "seen".
            // "not-seen" here would mean the 180s window expired, which cannot
            // have happened this soon.
            const state = row.locator('[data-pending-state]');
            await expect(state, 'the pending row carries no state attribute at all')
                .toBeVisible();
            await expect(state, 'a freshly broadcast transaction is reporting a state it cannot be in')
                .toHaveAttribute('data-pending-state', /^(awaiting-network|seen)$/);

            // Exactly one row for this transaction, before anything confirms.
            // The baseline half of CLAIM 4: a count that starts at 1 and ends at
            // 1 is the only way to distinguish an upgrade from a duplicate.
            await searchForTx(page, sendTxid);
            await expect(historyRows(page), 'searching the send\'s own txid did not narrow History '
                + 'to exactly one pending row').toHaveCount(1, { timeout: 30_000 });
            await expect(pendingRowFor(page, sendTxid),
                'the one surviving row is not the pending entry for this txid').toBeVisible();

            // The chain has not moved. Without this, a row that read "pending"
            // for some other reason would still pass everything above.
            expect(await blocksMined(), 'a block was mined while the miner was supposed to be '
                + 'parked, so nothing above was actually measured against an unconfirmed '
                + 'transaction. Something else on this machine is driving the same chain')
                .toBe(heldBlocks);
        });

        await test.step('CLAIM 2: with the miner held, the venue really does publish a mempool row for this send', async () => {
            // This is what the miner hold BUYS, and the reason the hold is in
            // the acceptance test's own wording. With the miner running, a
            // regtest transaction is routinely mined between two of the
            // decoder's 60s polls and no mempool row is ever written (I-40);
            // held, the decoder observes it and the explorer publishes it.
            // Measured on this venue: the row appeared well inside the budget.
            //
            // Asserted here even though the WALLET cannot currently consume it
            // (see the second test in this file, which pins that as a defect):
            // if this ever stops passing, the second test is unfixable and the
            // problem is the venue, not the wallet. Keeping the two apart is
            // what makes each failure legible on its own.
            const mempoolRow = await waitForMempoolRow(sendTxid);
            expect(String(mempoolRow.source), 'the explorer\'s mempool row names a different sender')
                .toBe(own);
            expect(String(mempoolRow.action).toUpperCase(),
                'the explorer decoded this mempool transaction as something other than a SEND')
                .toBe('SEND');

            expect(await blocksMined(), 'a block was mined while the miner was parked, so the '
                + 'sighting above was not measured on a held chain').toBe(heldBlocks);
        });

        await test.step('CLAIM 3: drilling into the pending entry renders the pending detail branch', async () => {
            // Worth knowing before reading the locators: arriving through the
            // success card leaves this row auto-SELECTED (History's
            // `initialFocus` sets `selectedKey`), so an inline DetailCard is
            // already open inside the <li>. Clicking the row button is still a
            // route change on the web shell - `onSelectEntry` is wired, so
            // `onRowClick` navigates rather than toggling - which is why the
            // assertions below are about the STANDALONE page.
            //
            // Nothing here asserts WHICH pending state the row is in, on
            // purpose. CLAIM 2 spends up to a couple of minutes waiting on the
            // decoder, so by now the 180s awaiting-network window may well have
            // expired; the pre-validation line renders in every pending state
            // and that is the claim.
            await pendingRowFor(page, sendTxid).getByRole('button').first().click();

            // The standalone detail page, which is where every real shell sends
            // a row click. Its title is the bare action label: a pending action
            // has no index, and "#0" would name a real action on every chain.
            const banner = page.getByRole('banner').filter({ hasText: 'Send' }).first();
            await expect(banner, 'the pending detail page did not open')
                .toBeVisible({ timeout: 30_000 });
            // Not a bare '#': the banner carries the app chrome as well, and a
            // stray hash anywhere in it would fail a correct screen. The claim
            // is specifically that the TITLE is not "Send #N".
            await expect(banner, 'the pending detail page is titled with an action index it cannot have')
                .not.toContainText('Send #');

            await expect(page.getByText('Pending, not yet validated by the indexer.'),
                'the pending detail branch did not render its pre-validation line, which is the one '
                + 'thing the user has to be told about an entry the indexer has not judged yet')
                .toBeVisible({ timeout: 30_000 });

            await expect(page.getByRole('region', { name: 'Pending transaction' }),
                'the pending panel is missing from the detail view').toBeVisible();
        });

        await test.step('CLAIM 3B: the pending entry still OFFERS Speed up and Cancel', async () => {
            // M2 acceptance test 4's list-side half, driven here because this
            // is the surface a real user reaches: every shell wires
            // `onSelectEntry` to navigate, and the standalone page renders the
            // SAME `DetailCard`, so the offer proven here is the offer proven
            // for both surfaces.
            //
            // Why a venue test and not a unit test: gating the offer
            // on the entry having an explorer link, which withdrew it from
            // exactly the transactions it exists for - a pending regtest send
            // has no action index for the XChain link, and regtest has no
            // third-party explorer, so the gate closed on every row this
            // feature serves. That gate is fixed, and nothing until now had
            // driven the fixed path against a REAL pending entry.
            //
            // Nothing here asserts what the buttons DO. There is no
            // replacement engine in any build: no shell registers a
            // `replaceTx` handler, so pressing Speed up raises
            // `RbfNotSupportedError` by design. The offer is the claim.
            const options = page.getByRole('group', { name: 'Action options' });
            await expect(options, 'the pending entry renders no action options at all, which is '
                + 'the exact shape the explorer-link gate used to produce on a regtest send')
                .toBeVisible({ timeout: 30_000 });

            await options.getByRole('button', { name: 'More' }).click();
            const menu = options.getByRole('menu');
            await expect(menu.getByRole('menuitem', { name: 'Speed up' }),
                'Speed up is not offered on a pending, replaceable SEND')
                .toBeVisible({ timeout: 15_000 });
            await expect(menu.getByRole('menuitem', { name: 'Cancel transaction' }),
                'Cancel is not offered on a pending, replaceable SEND').toBeVisible();

            // Closed again on purpose: an open menu carries a click-outside
            // handler that would eat CLAIM 4's first interaction.
            await options.getByRole('button', { name: 'More' }).click();
            await expect(menu, 'the More menu stayed open').toHaveCount(0);

            expect(await blocksMined(), 'a block was mined while the miner was supposed to be '
                + 'parked, so the offer above was not measured against an unconfirmed transaction')
                .toBe(heldBlocks);
        });

        await test.step('CLAIM 4: mining confirms the SAME entry rather than adding a second one', async () => {
            await page.getByRole('button', { name: 'Back to history' }).click();

            // Release the chain and let the action index. `waitForValidAction`
            // mines through `nudgeChain` (never unconditionally), and asserts
            // the indexer ACCEPTED the action - a confirmed transaction says
            // nothing about whether the action inside it was valid.
            await minerRpc('continue_mining', {});
            await waitForValidAction(sendTxid);
            chainRow = await chainHistoryRow(own, sendTxid);
            expect(Number(chainRow.block_index), 'the explorer carries no block for a confirmed action')
                .toBeGreaterThan(0);

            // Back to the LIST: the filter bar does not exist on the detail
            // page, and History re-mounts with its default window when we return.
            await searchForTx(page, sendTxid);

            // The pending key is GONE, not merely outnumbered. This is the
            // assertion a duplicated row would fail: an "the confirmed row is
            // visible" check passes with the pending one still sitting above it.
            await expect(pendingRowFor(page, sendTxid),
                'the pending entry is STILL in the list after its transaction confirmed, so the '
                + 'tx-hash merge is adding the confirmed row beside it instead of replacing it')
                .toHaveCount(0, { timeout: 120_000 });

            const confirmed = confirmedRowFor(page, chainRow.action_index, own);
            await expect(confirmed, `no confirmed History row for action ${chainRow.action_index}, `
                + `which the explorer records at ${own} for txid ${sendTxid}`)
                .toBeVisible({ timeout: 60_000 });
            await expect(confirmed.getByRole('button').first(),
                'the row shows a different block than the explorer recorded')
                .toContainText(`Block ${Number(chainRow.block_index).toLocaleString('en-US')}`);

            // And the count that makes the whole transition meaningful: ONE row
            // for this transaction before the block, ONE after it.
            await expect(historyRows(page), 'this transaction has more than one row in History after '
                + 'confirming, which is the duplicate the tx-hash merge exists to prevent')
                .toHaveCount(1);
            await expect(historyRows(page).locator('[data-pending-state]'),
                'the surviving row still carries a pending state after confirming')
                .toHaveCount(0);
        });
    });

    // RED, AND `test.fixme` FOR THAT REASON - it pins a defect that is real,
    // measured, and NOT fixable from this file.
    //
    // WHAT WAS MEASURED (run of 2026-08-28 06:19Z, RLTC, miner held):
    //   - the send broadcast as tx f09033c0…a33f;
    //   - the EXPLORER'S OWN `/RLTC/api/mempool` carried that txid, with
    //     `source` equal to this wallet's address and `action` SEND, i.e. the
    //     decoder observed it and the explorer published it, exactly as the
    //     miner hold is supposed to make possible;
    //   - and for 120 seconds the wallet row never moved: 105 consecutive
    //     resolutions of `<span data-pending-state="awaiting-network">awaiting
    //     network</span>`. Not a slow upgrade. No upgrade at all.
    //
    // ROOT CAUSE, verified in the tree rather than guessed. The wallet builds
    // against the PUBLISHED SDK: `packages/web/package.json` pins
    // `"xchain-sdk": "npm:@dankest-llc/xchain-sdk@0.10.0"`, and that installed
    // package contains ZERO occurrences of `getUnconfirmed` and no
    // `MEMPOOL_ACTION` in its `ADDRESS_EVENT_TYPES`. M1.2 added both, but in
    // the xchain-sdk REPO, and it has not been published. So on every wallet
    // build `addressMempool` (packages/core/src/flows/balances.js) takes its
    // own guard:
    //
    //     if (!sdk || typeof sdk.getUnconfirmed !== 'function') return [];
    //
    // and the network half of the M2.1 merge is a SILENT no-op. History shows
    // only the wallet's own PendingTx record, which is why the row is correct,
    // present and permanently "awaiting network".
    //
    // WHY IT MATTERS BEYOND THIS TEST. `pendingDisplayState` times the
    // awaiting-network state out at `NETWORK_SEEN_WINDOW_MS` (180s), so on the
    // current build every healthy send flips to the ALARMING "not seen by
    // network" state three minutes after broadcast. That also means M2
    // acceptance test 3 can pass for entirely the wrong reason: it would be
    // observing this defect rather than the warning path it is meant to prove.
    //
    // WHAT TURNS IT GREEN: publish the SDK carrying M1.2 and repin
    // `packages/web/package.json` (plus the desktop/extension twins) at it.
    // Nothing in the wallet needs to change - the call site, the channel, the
    // merge and the display state are all already correct and already unit
    // tested; they are calling a method that does not exist in the artifact
    // they are built against.
    //
    // Do NOT un-fixme this while it is red: a knowingly-red spec in a green
    // directory teaches the suite to ignore reds.
    test.fixme('a mempool sighting upgrades the pending row from "awaiting network" to "pending"', async ({ page }) => {
        let own;
        let sendTxid;

        await test.step('onboard, fund, mint, and park the miner', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);
            own = await readOwnAddress(page);
            await fundAddress(own, FUNDING);
            await reloadToHome(page);
            await mintXchain(page, MINT_AMOUNT);
            await waitForTokenBalance(own, TICK, MINT_AMOUNT);
            await reloadToHome(page);
            await minerRpc('pause_mining', {});
        });

        await test.step(`send ${SEND_AMOUNT} ${TICK} with the chain held still`, async () => {
            await gotoSection(page, 'Send');
            await pickAssetByChainAndTick(page, TICK, REGTEST_CHAIN_ID, TICK);
            await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
            await page.getByRole('textbox', { name: `Amount (${TICK})` }).fill(SEND_AMOUNT);
            await mainButton(page, 'Send').click();
            await expectConfirmModal(page, 'this action', 30_000);
            sendTxid = await approveAndGetTxid(page);
            await page.getByRole('button', { name: 'View in history' }).click();
        });

        await test.step('the sighting the venue published reaches the row', async () => {
            // The venue's half first, so a failure here can never be read as
            // the wallet's. This half PASSES today.
            await waitForMempoolRow(sendTxid);

            // The wallet's half. This is the assertion that is red, and the
            // one the SDK repin fixes.
            await expect(pendingRowFor(page, sendTxid).locator('[data-pending-state]'),
                'the explorer\'s own mempool carries this transaction, but the wallet row never '
                + 'left "awaiting network". The sighting is not reaching History. Check whether the '
                + 'INSTALLED @dankest-llc/xchain-sdk actually has getUnconfirmed before looking at '
                + 'the wallet: addressMempool returns [] without it, silently')
                .toHaveAttribute('data-pending-state', 'seen', { timeout: 120_000 });
        });
    });
});
