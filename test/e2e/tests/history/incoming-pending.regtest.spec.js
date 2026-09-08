// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2 acceptance test 2 (the unconfirmed-transaction spec):
// "an incoming pending payment to a wallet address appears in history as
// pending-in UNDER THE DEFAULT DATE FILTER, and spendable balance does NOT
// include it."
//
// WHY THIS NEEDS A SECOND WALLET, and why nothing cheaper is honest. Every
// other pending drive on the platform sends FROM the wallet under test, so the
// pending row it asserts on comes from that wallet's OWN local PendingTx
// record - a record an incoming payment never has. A payment from someone else
// can reach History by exactly one route: the explorer's mempool, fetched with
// `sdk.getUnconfirmed` and merged in by M2.1. So a self-send, a fixture, or a
// second address inside the same wallet would all pass while the actual
// incoming path was dead. The payer here is a genuinely independent wallet in
// its own browser context, and the subject wallet never learns about the
// payment from anything it did itself.
//
// THE TWO CLAIMS ARE SPLIT ACROSS TWO TESTS ON PURPOSE, because exactly one of
// them can pass on the currently pinned build:
//
//   - The BALANCE clause ("spendable balance does not include it") is testable
//     today and is the half with real money behind it. A wallet that credited
//     an unconfirmed incoming payment would be handing the user a spendable
//     balance the network has not accepted, and if the payer replaced or
//     dropped that transaction the balance would simply be wrong.
//
//   - The VISIBILITY clause needs `sdk.getUnconfirmed`, which the pinned
//     `@dankest-llc/xchain-sdk@0.10.0` does not have. `addressMempool` guards
//     on `typeof sdk.getUnconfirmed !== 'function'` and returns `[]`, so the
//     network half of the merge is a SILENT no-op and an incoming pending
//     payment cannot appear at all. That is not a wallet defect - the call
//     site, channel, merge and display state are all correct and unit-driven -
//     it is a published-package gap, tracked as spec frontier rows 26/27.
//
// The visibility test is therefore `test.fixme` GATED ON THE PIN rather than
// on a hand-flipped constant: it reads the version the web shell actually
// depends on and enables itself the moment the repin lands. A hand-flipped
// flag is the thing that gets left in the wrong position.
//
// WHY THE MINER IS HELD: on regtest a transaction can be broadcast AND mined
// between two of the decoder's 60s mempool polls, in which case no mempool row
// is ever written and there is nothing pending for anyone to see (spec I-40).
// `afterEach` releases the miner unconditionally - the regtest miner is SHARED,
// and a spec that leaves it parked hangs every run after it, including another
// session's, on funding that never confirms.
//
// RUN IT (the venue is workers:1 and SHARED; check for a neighbour first):
//   cd test/e2e && XC_REGTEST_COIN=RLTC XC_REGTEST_SSH_HOST=<regtest host> \
//       npx playwright test --config=playwright.regtest.config.js \
//       tests/history/incoming-pending.regtest.spec.js
//
// RBTC cannot run this at all: its regtest decoder is dead in a restart loop
// (a tracked defect) and the decoder is the platform's ONLY mempool store (spec
// I-47), so no mempool row can ever exist for it.

import {
    LICENSE_ACCEPTED_AT_KEY,
    LICENSE_ACCEPTED_VERSION_KEY,
    createWallet,
    expect,
    gotoSection,
    mainButton,
    openSettings,
    test,
} from '../../fixtures/wallet.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import {
    approveAndGetTxid,
    blocksMined,
    historyRows,
    pendingRowFor,
    pickAssetByChainAndTick,
    PINNED_SDK,
    readOwnAddress,
    SDK_HAS_UNCONFIRMED,
    searchForTx,
    waitForMempoolRow,
} from '../../fixtures/pendingHistory.js';
import {
    expectConfirmModal,
    explorerJson,
    fundAddress,
    minerRpc,
    mintXchain,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Native coin for the payer, to pay miner fees for its mint and its send. */
const FUNDING = 1;
/** XCHAIN the payer mints, then the slice of it that it actually pays over. */
const MINT_AMOUNT = 500;
const PAY_AMOUNT = '25';
const TICK = 'XCHAIN';

/**
 * The Bitcoin regtest decoder is in a restart loop, and the decoder is the
 * only mempool store, so RBTC can produce a pending sighting for nothing.
 */
const VENUE_HAS_NO_MEMPOOL = REGTEST_COIN === 'RBTC';

/**
 * A second, fully independent wallet in its own browser context: the PAYER.
 *
 * The license gate has to be seeded by hand here. The `page` fixture in
 * wallet.js does it through an init script, and that only covers the page the
 * fixture hands out; a context made directly would open onto the legal gate
 * and the onboarding walk would fail on a missing button.
 */
async function openPayerWallet(browser) {
    const context = await browser.newContext();
    await context.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch {
                // Storage unavailable: the gate renders and onboarding fails
                // loudly rather than silently testing the gate.
            }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
    return { context, page: await context.newPage() };
}

/** The subject wallet's XCHAIN row on Home, which is its SPENDABLE balance. */
function ownTokenRow(page) {
    return page.locator(`[data-balance-key="${REGTEST_CHAIN_ID}:${TICK}"]`);
}

/**
 * Puts Home on the TOKENS tab, where a token balance actually lives.
 *
 * Home opens on Coins, which lists native rows only, so a token row is not in
 * the DOM there whatever the balance is. Asserting `toHaveCount(0)` against the
 * default tab is therefore vacuous - it passes on a wallet that is wrongly
 * crediting an unconfirmed payment just as happily as on a correct one. This
 * was not theory: the first run of this spec did exactly that, and only the
 * post-confirmation control caught it.
 *
 * The tab itself is asserted before it is used, so a renamed or removed tab
 * fails here by name rather than silently restoring the vacuum downstream.
 */
async function gotoTokensTab(page) {
    const tab = page.getByRole('tab', { name: /^Tokens/ });
    await expect(tab, 'Home has no Tokens tab, so the balance claims below would be asserting '
        + 'against the Coins tab, where a token row never appears at any balance')
        .toBeVisible({ timeout: 60_000 });
    await tab.first().click();
}

/**
 * Drives the whole two-wallet choreography up to "the payment is in the
 * mempool and the chain is held still", and hands back what both tests assert
 * on. Everything here is setup: the claims live in the tests.
 *
 * @returns {Promise<{ subject: string, txid: string, heldBlocks: number }>}
 */
async function payTheSubject(browser, page, { beforePayment } = {}) {
    /** The subject wallet's address: the RECIPIENT, and History's subject. */
    let subject;
    /** The txid of the payment made TO it by someone else. */
    let txid;
    /** The miner's block counter at the moment it was parked. */
    let heldBlocks;

    await test.step('onboard the SUBJECT wallet, which will only ever receive', async () => {
        await createWallet(page, { password: PASSWORD });
        await switchToRegtest(page, PASSWORD);
        subject = await readOwnAddress(page);
        expect(subject, 'the subject wallet named no address to be paid at').toBeTruthy();
        // The notification specs change a setting on the subject BEFORE anyone
        // pays it, so the rail is measured against the setting the user had,
        // not one flipped after the frame was already in flight.
        if (beforePayment) await beforePayment(page);
    });

    const payer = await openPayerWallet(browser);
    await test.step('onboard the PAYER wallet in its own context, and give it something to pay with', async () => {
        await payer.page.goto('/');
        await createWallet(payer.page, { password: PASSWORD });
        await switchToRegtest(payer.page, PASSWORD);

        const payerAddress = await readOwnAddress(payer.page);
        // Two wallets that turned out to be one wallet would make every claim
        // below true by accident, and the failure would read as a pass.
        expect(payerAddress, 'the payer and the subject are the same address, so nothing below '
            + 'would be testing an INCOMING payment at all').not.toBe(subject);

        await fundAddress(payerAddress, FUNDING);
        await payer.page.goto('/');
        await unlockAfterReload(payer.page, PASSWORD);

        // Before the miner is parked: the payer spends only CONFIRMED utxos,
        // so the mint's change output has to be in a block already.
        await mintXchain(payer.page, MINT_AMOUNT);
        await waitForTokenBalance(payerAddress, TICK, MINT_AMOUNT);
        await payer.page.goto('/');
        await unlockAfterReload(payer.page, PASSWORD);
    });

    await test.step('park the miner, so the payment cannot confirm under the assertions', async () => {
        await minerRpc('pause_mining', {});
        const status = await minerRpc('status', {});
        expect(status?.mining_paused, 'the venue miner did not accept pause_mining, so the payment '
            + 'could confirm between the broadcast and the pending assertions and there would be '
            + 'nothing pending left to assert on').toBe(true);
        heldBlocks = await blocksMined();
    });

    await test.step(`the payer sends ${PAY_AMOUNT} ${TICK} to the subject`, async () => {
        await gotoSection(payer.page, 'Send');
        await pickAssetByChainAndTick(payer.page, TICK, REGTEST_CHAIN_ID, TICK);
        await payer.page.getByLabel('To', { exact: true }).fill(subject);
        await payer.page.getByRole('textbox', { name: `Amount (${TICK})` }).fill(PAY_AMOUNT);
        await mainButton(payer.page, 'Send').click();

        await expectConfirmModal(payer.page, 'this action', 30_000);
        txid = await approveAndGetTxid(payer.page);
    });

    // The payer has done its whole job. Closing it here matters: everything
    // after this point must be true of the SUBJECT's wallet alone, and a live
    // second context is an easy way to accidentally assert on the wrong page.
    await payer.context.close();

    return { subject, txid, heldBlocks };
}

test.describe(`Incoming pending payment on ${REGTEST_CHAIN_LABEL} regtest`, () => {
    // Two onboardings, a mint, a real broadcast, and up to 210s of holding the
    // chain still while the decoder catches up.
    test.setTimeout(900_000);
    test.use({ actionTimeout: 30_000 });
    test.skip(VENUE_HAS_NO_MEMPOOL, `${REGTEST_COIN} has no mempool store this spec can read: its `
        + 'regtest decoder is in a restart loop and the decoder is the only mempool '
        + 'store on the platform, so an incoming PENDING payment can never exist here. Run with '
        + 'XC_REGTEST_COIN=RLTC (or RDOGE).');

    // UNCONDITIONAL. A failed or timed-out run must never leave the SHARED
    // regtest miner parked: the next spec, and another session's whole suite,
    // would hang on funding that never confirms with nothing naming this run.
    test.afterEach(async () => {
        await minerRpc('continue_mining', {}).catch(() => {});
    });

    test('is visible to the venue and is NOT spendable until it confirms', async ({ browser, page }) => {
        const { subject, txid, heldBlocks } = await payTheSubject(browser, page);

        await test.step('CLAIM 1: the venue really is holding an unconfirmed payment TO the subject', async () => {
            // Asserted against the explorer's own record before anything about
            // the screen, so that a later wallet-side failure can be read as a
            // wallet failure. If this ever goes red the venue is the problem.
            const row = await waitForMempoolRow(txid);
            expect(String(row.action).toUpperCase(),
                'the explorer decoded this mempool transaction as something other than a SEND')
                .toBe('SEND');
            expect(String(row.source), 'the mempool row names the subject as the SENDER, so this '
                + 'is not an incoming payment at all').not.toBe(subject);

            // And the half M1.1 exists for: the explorer can find this row BY
            // THE RECIPIENT. This is the exact server-side query
            // `sdk.getUnconfirmed(subject)` will make once the SDK carries it,
            // so proving it here separates "the explorer cannot match the
            // recipient" from "the wallet cannot ask".
            const byRecipient = await explorerJson(`mempool/${subject}/address`);
            const rows = Array.isArray(byRecipient?.data) ? byRecipient.data : [];
            expect(rows.some((r) => String(r.tx_hash).toLowerCase() === txid.toLowerCase()),
                `the explorer's address-filtered mempool did not return the payment to ${subject}, `
                + 'so the destination matching M1.1 added is not working on this venue')
                .toBe(true);

            expect(await blocksMined(), 'a block was mined while the miner was supposed to be '
                + 'parked, so nothing here was measured against an unconfirmed payment')
                .toBe(heldBlocks);
        });

        await test.step('CLAIM 2: the pending payment is NOT in spendable balance', async () => {
            // The clause with money behind it. An unconfirmed incoming payment
            // must never be spendable: the payer can still replace or drop it,
            // and a wallet that credited it would be offering the user a
            // balance the network never accepted.
            await page.goto('/');
            await unlockAfterReload(page, PASSWORD);
            await gotoTokensTab(page);

            const row = ownTokenRow(page);
            // The subject has never held this token, so the honest rendering is
            // no row at all. `toHaveCount(0)` also fails loudly (rather than
            // silently passing on a mis-typed key) if the row IS present.
            await expect(row, `the subject's spendable balance already shows ${TICK} while the `
                + 'payment is still unconfirmed, so an incoming pending amount is being credited')
                .toHaveCount(0, { timeout: 30_000 });

            expect(await blocksMined(), 'a block was mined while the miner was parked, so the '
                + 'balance above was not measured against an unconfirmed payment').toBe(heldBlocks);
        });

        await test.step('CLAIM 3: once it confirms, the payment becomes spendable', async () => {
            // The control for CLAIM 2. Without this, a wallet that never
            // credited the payment at ALL would pass CLAIM 2 perfectly.
            await minerRpc('continue_mining', {});
            await waitForValidAction(txid);
            await waitForTokenBalance(subject, TICK, Number(PAY_AMOUNT));

            await page.goto('/');
            await unlockAfterReload(page, PASSWORD);
            await gotoTokensTab(page);
            await expect(ownTokenRow(page), 'the payment confirmed and the explorer credits the '
                + 'subject, but the wallet still shows no balance for it')
                .toBeVisible({ timeout: 120_000 });
        });
    });

    // GATED ON THE PIN, not hand-flipped. `getUnconfirmed` shipped in SDK
    // 0.11.1; below that the wallet's `addressMempool` guard returns `[]` and
    // an incoming pending payment is invisible by construction, so running
    // this would pin a published-package gap as a wallet failure.
    test('appears in history as pending under the DEFAULT date filter', async ({ browser, page }) => {
        // Inside the body on purpose: at suite level this same call would gate
        // the WHOLE describe, taking the balance test down with it and leaving
        // the money claim unrun on every build.
        test.fixme(!SDK_HAS_UNCONFIRMED, `the web shell pins xchain-sdk@${PINNED_SDK}, which has `
            + 'no getUnconfirmed, so the network half of the History merge is a silent no-op and '
            + 'an incoming pending payment cannot reach the screen. Enables itself on the repin '
            + 'to 0.11.1 or later (spec frontier rows 26/27).');

        const { txid, heldBlocks } = await payTheSubject(browser, page);

        // The venue precondition, kept short here because CLAIM 1 of the test
        // above is the full version: if there is no mempool row there is
        // nothing for the wallet to have missed.
        await waitForMempoolRow(txid);

        await test.step('the incoming payment is on screen, under the filters a real user has', async () => {
            await page.goto('/');
            await unlockAfterReload(page, PASSWORD);
            await gotoSection(page, 'History');

            // NO date widening, and that is the claim. The default window is
            // [today-30d, today] and `applyHistoryFilters` drops any entry with
            // a null timestamp while a date filter is active, so a merged
            // pending entry that forgot to carry `first_seen * 1000` is
            // invisible to every real user while sitting perfectly in the DOM
            // of a spec that widened first (spec I-21, I-54).
            const row = pendingRowFor(page, txid);
            await expect(row, 'no pending History row for the incoming payment under the DEFAULT '
                + 'filters. If widening the date window makes it appear, the defect is the date '
                + 'filter dropping the merged entry, not the merge itself')
                .toBeVisible({ timeout: 120_000 });

            const button = row.getByRole('button').first();
            await expect(button, 'the incoming pending row does not name the action')
                .toContainText('Send');
            await expect(button, 'a blockless row is not classified as Pending')
                .toContainText('Pending');

            // It arrived from the network, not from a local record: the subject
            // wallet has no PendingTx for a payment it did not make, so the
            // only route to this row is getUnconfirmed. A `seen` state is the
            // positive evidence of that; `awaiting-network` would mean the row
            // came from somewhere it cannot have come from.
            await expect(row.locator('[data-pending-state]'),
                'the incoming pending row is in the local-record state, which an incoming payment '
                + 'can never legitimately be in')
                .toHaveAttribute('data-pending-state', 'seen');

            // Exactly one row for it, so a duplicate cannot hide behind a
            // "the row is visible" assertion.
            await searchForTx(page, txid);
            await expect(historyRows(page), 'the incoming payment has more than one History row')
                .toHaveCount(1, { timeout: 30_000 });

            expect(await blocksMined(), 'a block was mined while the miner was parked, so the row '
                + 'above was not measured against an unconfirmed payment').toBe(heldBlocks);
        });
    });

    /* ───── M3: the notification rail ─────────────────────────────── */

    // The web shell's notify adapter dispatches every notification as a
    // window CustomEvent BEFORE the React layer decides whether to toast it
    // (see webNotifyAdapter.js), so a collector on that event is the exact
    // record of what the NotificationService delivered, toast or not. It is
    // installed as an init script so it survives the reloads the onboarding
    // walk makes, and it is the thing the negative claims below count on: a
    // toast that auto-dismisses could come and go between two polls of the
    // DOM, but an event cannot un-happen.
    const NOTIFICATION_EVENT = 'xchain:notification';
    const collectNotifications = (page) => page.addInitScript((eventName) => {
        window.__xcNotifications = [];
        window.addEventListener(eventName, (e) => {
            window.__xcNotifications.push({ kind: e.detail?.kind, title: e.detail?.title, body: e.detail?.body });
        });
    }, NOTIFICATION_EVENT);
    const collected = (page) => page.evaluate(() => window.__xcNotifications || []);
    const receivedKinds = (list) => list.filter((n) => n.kind === 'incoming-pending' || n.kind === 'incoming-receipt');

    /** The window in which a frame must have reached the wallet: ~85s worst case (spec §1) plus slack. */
    const FRAME_BUDGET_MS = 120_000;
    /** How long a negative claim listens before calling the rail silent. */
    const SILENCE_MS = 100_000;

    /** Toggles the named notification switch on the Settings screen and returns to Home. */
    async function setNotificationSwitch(page, name, on) {
        await openSettings(page);
        const sw = page.getByRole('switch', { name, exact: true });
        await expect(sw, `Settings has no "${name}" switch`).toBeVisible({ timeout: 30_000 });
        if ((await sw.isChecked()) !== on) await sw.click();
        await expect(sw).toBeChecked({ checked: on });
        await gotoSection(page, 'Home');
    }

    test('raises exactly one in-app toast for the pending payment, and none again when it confirms', async ({ browser, page }) => {
        test.fixme(!SDK_HAS_UNCONFIRMED, `the web shell pins xchain-sdk@${PINNED_SDK}, whose onAddress `
            + 'drops MEMPOOL_ACTION frames, so no pending sighting can reach the notification rail.');
        await collectNotifications(page);
        const { subject, txid, heldBlocks } = await payTheSubject(browser, page);
        await waitForMempoolRow(txid);

        await test.step('CLAIM 1: one "incoming pending" toast, naming the chain and "pending" and nothing more', async () => {
            // The user-facing surface first: the toast the operator would see.
            const toast = page.getByRole('status').filter({ hasText: /Incoming on/ });
            await expect(toast, 'no "Incoming on ..." toast appeared for a payment the explorer\'s own '
                + 'mempool already carries. Check the subject\'s NotificationService subscribed to its '
                + 'regtest address (Settings -> Network filter) before blaming the explorer fan-out')
                .toBeVisible({ timeout: FRAME_BUDGET_MS });
            await expect(toast).toContainText(/pending/i);
            // Privacy (§46.4): no amount, no counterparty.
            await expect(toast).not.toContainText(PAY_AMOUNT);

            // The record behind the surface: exactly one delivery of that kind.
            await expect.poll(async () => receivedKinds(await collected(page)).length,
                { timeout: 30_000, message: 'the rail delivered a different number of "received" '
                    + 'notifications than the one toast on screen' }).toBe(1);
            const [n] = receivedKinds(await collected(page));
            expect(n.kind).toBe('incoming-pending');
            expect(`${n.title} ${n.body}`).not.toContain(subject);

            expect(await blocksMined(), 'a block was mined while the miner was parked, so the toast '
                + 'above may have been the confirmation, not the pending sighting').toBe(heldBlocks);
        });

        await test.step('CLAIM 2: the confirmation of the same transaction raises no second "received" notification', async () => {
            await minerRpc('continue_mining', {});
            await waitForValidAction(txid);
            // The explorer's NEW_ACTION for this action has had every chance to
            // arrive: the change detector polls at 5s and the frame is live, so
            // 30s after the action is known indexed is a generous window. The
            // positive control that the confirmed-side frame DOES reach this
            // wallet is the toggle-off test below, where the receipt fires.
            await page.waitForTimeout(30_000);
            const kinds = receivedKinds(await collected(page)).map((n) => n.kind);
            expect(kinds, 'the confirmation was announced on top of the pending notice: one transaction, '
                + 'two "received" notifications').toEqual(['incoming-pending']);
        });
    });

    test('toggle off: the same payment raises nothing while History still shows it pending, and its confirmation still raises a receipt', async ({ browser, page }) => {
        test.fixme(!SDK_HAS_UNCONFIRMED, `the web shell pins xchain-sdk@${PINNED_SDK}, whose onAddress `
            + 'drops MEMPOOL_ACTION frames, so this would pass for the wrong reason.');
        await collectNotifications(page);
        const { txid } = await payTheSubject(browser, page, {
            beforePayment: (p) => setNotificationSwitch(p, 'Incoming pending payments', false),
        });
        await waitForMempoolRow(txid);

        await test.step('CLAIM 3: silent for the whole frame window, with the pending row on screen as the control', async () => {
            await page.waitForTimeout(SILENCE_MS);
            expect(receivedKinds(await collected(page)), 'the rail announced a pending payment with '
                + 'its toggle OFF').toEqual([]);
            // The rail is silent, not broken: the same sighting reached History.
            await gotoSection(page, 'History');
            await expect(pendingRowFor(page, txid), 'the pending row is missing too, so the silence '
                + 'above proves nothing about the toggle').toBeVisible({ timeout: 60_000 });
        });

        await test.step('CLAIM 4 (positive control for CLAIM 2): a payment never announced as pending IS announced when it confirms', async () => {
            await minerRpc('continue_mining', {});
            await waitForValidAction(txid);
            await expect.poll(async () => receivedKinds(await collected(page)).map((n) => n.kind),
                { timeout: FRAME_BUDGET_MS, message: 'no incoming-receipt arrived for the confirmed '
                    + 'payment. This is the confirmed-side branch that reads the explorer\'s '
                    + 'destinations[] (M1.4 / M3.3); before this work it had never fired' })
                .toEqual(['incoming-receipt']);
        });
    });

    test('quiet hours covering now: the same payment raises nothing', async ({ browser, page }) => {
        test.fixme(!SDK_HAS_UNCONFIRMED, `the web shell pins xchain-sdk@${PINNED_SDK}, whose onAddress `
            + 'drops MEMPOOL_ACTION frames, so this would pass for the wrong reason.');
        await collectNotifications(page);
        const { txid } = await payTheSubject(browser, page, {
            beforePayment: async (p) => {
                // A window from an hour ago to two hours from now, in the
                // browser's local time (the wallet reads the quiet-hours
                // clock off the machine it runs on).
                const { start, end } = await p.evaluate(() => {
                    const h = new Date().getHours();
                    const hh = (n) => String(((n % 24) + 24) % 24).padStart(2, '0');
                    return { start: `${hh(h - 1)}:00`, end: `${hh(h + 2)}:00` };
                });
                await openSettings(p);
                const sw = p.getByRole('switch', { name: 'Quiet hours', exact: true });
                await expect(sw).toBeVisible({ timeout: 30_000 });
                if (!(await sw.isChecked())) await sw.click();
                await expect(sw).toBeChecked();
                await p.locator('#quiet-hours-start').fill(start);
                await p.locator('#quiet-hours-end').fill(end);
                await expect(p.locator('#quiet-hours-start')).toHaveValue(start);
                await expect(p.locator('#quiet-hours-end')).toHaveValue(end);
                await gotoSection(p, 'Home');
            },
        });
        await waitForMempoolRow(txid);

        await test.step('CLAIM 5: silent for the whole frame window', async () => {
            await page.waitForTimeout(SILENCE_MS);
            expect(receivedKinds(await collected(page)), 'the rail announced a pending payment inside '
                + 'quiet hours').toEqual([]);
            await gotoSection(page, 'History');
            await expect(pendingRowFor(page, txid), 'the pending row is missing too, so the silence '
                + 'above proves nothing about quiet hours').toBeVisible({ timeout: 60_000 });
        });
    });
});
