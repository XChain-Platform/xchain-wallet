// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "DEX / Markets + SWAP": the MATCH half of the ORDER
// lane, and the CoinPay obligation a get-native order creates when it fills.
// `order-lifecycle.regtest.spec.js` proved one wallet's own order end to end
// (escrow, list, cancel, edit); this proves the part that needs a counterparty
// and settles real coin in both directions.
//
// WHY IT IS A SEPARATE FILE AND WHY IT IS WORTH THE RUNTIME. A same-chain
// match where ONE side is native coin does not settle instantly: the indexer
// writes an ORDER_MATCH with `settlement_type: coinpay`, leaves the seller's
// tokens escrowed, and creates a COINPay OBLIGATION naming the coin-giver as
// payer with a deadline (`order_match.js`). Nothing moves until that payment
// is made - so this is the one lane in the wallet where a user owes money to a
// stranger on a clock, and until now nothing had ever driven it. Three wallet
// surfaces meet here that no other spec touches: the counter-order's
// native-GIVE authoring (with its auto-pay arming), "Payments due"
// (ObligationsView), and CoinpayForm.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dex/order-match-coinpay.regtest.spec.js
//
// AUTO-PAY IS DELIBERATELY TURNED OFF on the counter-order. The PC-16 auto-pay
// path would settle the obligation for us, which is a different feature and
// would also race this spec's own assertions; the manual queue is the lane a
// user actually walks when their wallet was closed. Auto-pay's own arming is
// left to a spec that can watch it in isolation.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    encoderRpc,
    fundAddress,
    minerRpc,
    mintXchain,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Wallet A needs miner fees only; wallet B also has to pay the ask. */
const FUNDING = 2;
const MINT = 1000;
/** The escrowed token side. */
const GIVE_TOKENS = 100;
/** The ask, in native coin, and the exact amount the obligation will demand. */
const ASK = '0.5';
const ASK_SATS = 50_000_000;
const COIN = REGTEST_COIN.replace(/^R/, '');

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * Asks the venue to quote the order wallet B is about to place.
 *
 * VENUE PRECONDITION, not a wallet assertion. An ORDER that fills on arrival
 * against a native-coin counterparty used to be quoted
 * `valid:false, error:"pending_coinpay", xchainFee:null` - the verdict of the
 * MATCH it triggers rather than of the order itself - because the matcher is
 * handed the originating action's record and overwrites its STATUS and
 * ACTION_INDEX (xchain-indexer order.js:560 / order_match.js:292,:312, whose only
 * consumer is the fee-quote dry run). Every wallet pre-flight then refused an
 * action the chain accepts, which made the taker side of this whole lane
 * unreachable. Fixed in xchain-indexer (actions.js: the quoted action's own
 * verdict is captured before the matcher takes the record over) and pinned by
 * test/unit/feeQuotePrimaryVerdict.test.js, but a REGTEST VENUE runs a built
 * image, so this spec stays skipped until that image is rebuilt. Skipped LOUDLY
 * with the cause named, because a silent skip is how a suite reports coverage it
 * does not have.
 */
async function quoteMirrorOrder(source) {
    const params = `0|${COIN}||${ASK}||${COIN}|XCHAIN|${GIVE_TOKENS}`;
    const q = new URLSearchParams({ action: 'ORDER', params, source });
    return explorerJson(`feequote?${q.toString()}`);
}

/** Total confirmed satoshis the chain says this address controls. */
async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
}

/** Mines only when something is actually waiting for a block (§3.5). */
async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

/** The indexed action for a txid, found in the list rather than by index (§3.6). */
async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100');
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(
        `No XChain action recorded for ${txid} within ${Math.round(timeoutMs / 1000)}s. `
        + `Decoder lag ${status?.decoder_lag_blocks?.[REGTEST_COIN]}.`);
}

/**
 * The match between two specific orders.
 *
 * A match is not an action anyone broadcasts - the indexer writes it while
 * processing the block that carried the second order - so it is waited for,
 * not looked up by txid. Both orders are named so a stranger's match on this
 * shared venue cannot be mistaken for this run's.
 */
async function waitForMatch(indexA, indexB, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('order_matches?limit=50');
        const row = (list?.data || []).find((m) => {
            const legs = [String(m.give_action_index), String(m.get_action_index)];
            return legs.includes(String(indexA)) && legs.includes(String(indexB));
        });
        if (row) return row;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`orders #${indexA} and #${indexB} never matched within `
        + `${Math.round(timeoutMs / 1000)}s`);
}

/** The obligation this address owes, in whatever status it currently holds. */
async function waitForObligation(address, wantStatus, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const list = await explorerJson(`coinpay_obligations/${address}/address`);
        const rows = list?.data || [];
        last = rows[0] || last;
        const row = rows.find((r) => String(r.coinpay_status) === wantStatus);
        if (row) return row;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`no obligation for ${address} reached "${wantStatus}" within `
        + `${Math.round(timeoutMs / 1000)}s (last seen: ${JSON.stringify(last)})`);
}

async function waitForBalanceAtLeast(address, tick, min, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = 0;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last >= min) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/** Opens Create order on the venue chain and returns the form scope + source. */
async function openCreateOrder(page) {
    await gotoPalette(page, 'Create order');
    const main = page.getByRole('main');
    await expect(main.getByLabel('From address')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    const source = await main.getByLabel('From address').inputValue();
    expect(source, `the Create order form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
        .toMatch(REGTEST_ADDRESS_RE);
    return { main, source };
}

test.describe(`ORDER match + CoinPay on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('two crossing orders match, and the coin side owes a payment it can make from the wallet', async ({ page }) => {
        let maker;
        let taker;
        let makerOrder;
        let takerOrder;

        await test.step('wallet A sells tokens for coin', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Maker Wallet' });
            await switchToRegtest(page, PASSWORD);

            ({ source: maker } = await openCreateOrder(page));
            await fundAddress(maker, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT);
            await waitForBalanceAtLeast(maker, 'XCHAIN', MINT);

            const { main } = await openCreateOrder(page);
            // Defaults are give-a-token / get-native, which is this side exactly.
            await main.getByLabel('Ticker', { exact: true }).fill('XCHAIN');
            await main.getByLabel('Amount', { exact: true }).fill(String(GIVE_TOKENS));
            await main.getByLabel(`Amount (${COIN})`).fill(ASK);
            await main.getByRole('button', { name: /^Place order/ }).click();

            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status), 'the chain rejected the maker order').toBe('valid');
            makerOrder = String(action.action_index);
        });

        await test.step('wallet B is a second wallet and offers the coin', async () => {
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: 'Add Wallet' }).click();
            // navigate:false - this add-wallet flow starts at the onboarding
            // welcome INSIDE the unlocked shell, and a goto would throw the
            // session away and land back on wallet A.
            await createWallet(page, { password: PASSWORD, name: 'Taker Wallet', navigate: false });
            // Adding a wallet does not switch to it (the sibling bet spec paid
            // for this lesson); switch explicitly or B's address reads as A's.
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: /Taker Wallet/ }).first().click();
            await expect(page.getByRole('button', { name: /Taker Wallet/ }).first(),
                'the app did not switch to the newly added wallet')
                .toBeVisible({ timeout: 30_000 });

            ({ source: taker } = await openCreateOrder(page));
            expect(taker, 'wallet B derived the same address as wallet A').not.toBe(maker);

            await fundAddress(taker, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('wallet B places the mirror order, with auto-pay off', async () => {
            // The venue gate (see quoteMirrorOrder): on a venue whose indexer
            // predates the fix, the wallet is about to be told the network would
            // refuse an order the chain accepts, and no amount of wallet code can
            // get past that. Checked here, where a real open order exists to
            // match against, so the probe means what it says.
            const quote = await quoteMirrorOrder(taker);
            test.skip(quote?.valid === false && String(quote?.error).includes('pending_coinpay'),
                'this venue\'s indexer still quotes an instantly-filling ORDER as its MATCH\'s '
                + '"pending_coinpay" (valid:false, xchainFee:null), so the wallet cannot place the '
                + 'taker side at all. Fixed in xchain-indexer/src/actions.js and pinned by '
                + 'test/unit/feeQuotePrimaryVerdict.test.js; rebuild the regtest indexer image to '
                + 'run this lane. Wallet A\'s order is left open on the venue by this skip.');

            const { main } = await openCreateOrder(page);

            // Mirror of wallet A: give native coin, get the token. The radios
            // come in DOM order (give side first, then get side), so first/last
            // is what distinguishes the two groups.
            await main.getByRole('radio', { name: `Native ${COIN}` }).first().check();
            await main.getByRole('radio', { name: 'A token' }).last().check();

            await main.getByLabel(`Amount (${COIN})`).fill(ASK);
            await main.getByLabel('Ticker', { exact: true }).fill('XCHAIN');
            await main.getByLabel('Amount', { exact: true }).fill(String(GIVE_TOKENS));

            // A native GIVE is the only shape that can arm auto-pay, and this
            // spec wants the MANUAL queue. Turning it off also removes the
            // web-shell acknowledgement the armed path would demand.
            const autopay = main.getByRole('checkbox', { name: /Enable CoinPay auto-pay/ });
            await expect(autopay,
                'the native-coin GIVE side offers no auto-pay control, so PC-16 never armed')
                .toBeVisible();
            await autopay.uncheck();

            await main.getByRole('button', { name: /^Place order/ }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status), 'the chain rejected the taker order').toBe('valid');
            takerOrder = String(action.action_index);

            // A native-coin GIVE escrows NOTHING (the obligation is the
            // commitment instead), which is the whole reason this settles in
            // two phases. Asserted so a future change that starts escrowing
            // coin here cannot pass quietly.
            expect(action.escrows,
                'the native-coin side escrowed something; that side commits through the '
                + 'CoinPay obligation, not through escrow')
                .toBeFalsy();
        });

        await test.step('the chain matches them and bills the coin side', async () => {
            const match = await waitForMatch(makerOrder, takerOrder);
            expect(String(match.settlement_type),
                'a match with a native-coin leg settled instantly, so no obligation was ever created')
                .toBe('coinpay');
            expect(String(match.status)).toBe('pending_coinpay');

            const obligation = await waitForObligation(taker, 'pending_coinpay');
            expect(String(obligation.payer_address),
                'the obligation bills the wrong side: the coin-giver owes the payment')
                .toBe(taker);
            expect(String(obligation.payee_address),
                'the payment is owed to the token seller')
                .toBe(maker);
            expect(Math.round(Number(obligation.coin_amount) * 1e8),
                'the obligation is not for the ask the two orders agreed on')
                .toBe(ASK_SATS);

            // Until it is paid, nothing has moved: the seller still has no coin
            // and the buyer still has no tokens.
            expect(await tokenBalance(taker, 'XCHAIN'),
                'the tokens were released before the coin was paid')
                .toBe(0);
        });

        await test.step('wallet B pays it from Payments due', async () => {
            const makerSatsBefore = await coinBalanceSats(maker);

            await page.getByRole('button', { name: 'Payments due' }).first().click();
            const main = page.getByRole('main');
            const pending = main.getByRole('list', { name: 'Pending payments' });
            await expect(pending, 'the obligation this wallet owes is not in Payments due')
                .toBeVisible({ timeout: 60_000 });
            // The debt must be named in COIN units. Reading it as base units is
            // D-137/: the explorer serves a decimal here, and a wallet that
            // demanded all digits labelled a 0.5 LTC debt "0.5 base units".
            await expect(pending, 'the queue does not name the amount owed in coin units')
                .toContainText(new RegExp(`0\\.5\\s*${COIN}`));
            await expect(pending, 'the queue labels the debt in the wrong unit (D-137)')
                .not.toContainText(/base units/);

            await main.getByRole('button', { name: 'Pay now' }).first().click();
            await main.getByRole('button', { name: 'Review' }).click();
            const password = page.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await page.getByRole('button', { name: 'Sign payment' }).click();
            await expect(page.getByText('Payment broadcast'),
                'the payment never reported being broadcast')
                .toBeVisible({ timeout: 180_000 });

            // The settlement, asked of the chain in both directions. This is
            // the point of the whole lane: the escrowed tokens move only
            // because the coin did.
            const settled = await waitForObligation(taker, 'fulfilled');
            expect(Math.round(Number(settled.coin_amount) * 1e8)).toBe(ASK_SATS);

            const takerTokens = await waitForBalanceAtLeast(taker, 'XCHAIN', GIVE_TOKENS);
            expect(takerTokens,
                'the buyer was credited something other than the tokens the order escrowed')
                .toBe(GIVE_TOKENS);

            const makerSatsAfter = await coinBalanceSats(maker);
            expect(makerSatsAfter - makerSatsBefore,
                `the seller received ${makerSatsAfter - makerSatsBefore} sats for tokens sold at `
                + `${ASK_SATS}`)
                .toBe(ASK_SATS);
        });
    });

    // The PAYING half of PC-16. `order-autopay-arming.regtest.spec.js` proves the
    // wallet takes the consent and can withdraw it; this proves the consent is
    // ACTED ON - that a match against an armed order is paid with no user action
    // at all. It is the only place in this campaign where the wallet spends coin
    // while nobody is driving it, so the assertion that matters is the one about
    // what was NOT done: Payments due is never opened and nothing is clicked
    // after the order is placed.
    //
    // Two gates decide how long this takes and both are the product's, not the
    // harness's: the watcher polls once a minute (CoinpayAutopayWatcher's
    // DEFAULT_INTERVAL_MS) and `autopayPolicy` refuses to pay a match shallower
    // than two confirmations (DEFAULT_CONFIRM_DEPTH), so the spec mines past that
    // depth and then simply waits.
    // KNOWN FAILING, and it is the product that fails, not the spec: see
    // D-139/. Measured twice, ~10 minutes each, on a venue where the
    // MANUAL queue settles the identical obligation in seconds (COINPAY 1524,
    // 1551). Left as fixme rather than deleted because it is the executable
    // statement of the promise the order form makes, and it will pass the
    // moment that promise is kept.
    //
    // Two mechanisms have been ruled OUT already, so do not start there:
    //   - the web-shell acknowledgement gate (the run ticks it and the success
    //     screen confirms "Auto-pay is armed");
    //   - a missing signer for the payer wallet: `wallet.create` did not adopt
    //     the created wallet into the signer pool while `wallet.add.import`
    //     did, which is fixed and pinned (test/smoke/core/
    //     wallet-create-signer-adoption.smoke.js) - and the lane still did not
    //     pay, so that was a real gap but not this one.
    // NEXT PROBE, cheapest first: CoinpayAutopayWatcher is constructed with
    // `logger: console`, so run this spec with a console listener attached and
    // read its own verdict - `evaluateObligation` returns a NAMED reason
    // (amounts-unavailable / amount-mismatch / terms-unparseable / depth), and
    // whichever it is names the next fix.
    test.fixme('an armed order pays its own match, with nobody driving the wallet', async ({ page }) => {
        let maker;
        let taker;
        let makerOrder;
        let takerOrder;

        await test.step('wallet A sells tokens for coin', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Maker Wallet' });
            await switchToRegtest(page, PASSWORD);

            ({ source: maker } = await openCreateOrder(page));
            await fundAddress(maker, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT);
            await waitForBalanceAtLeast(maker, 'XCHAIN', MINT);

            const { main } = await openCreateOrder(page);
            await main.getByLabel('Ticker', { exact: true }).fill('XCHAIN');
            await main.getByLabel('Amount', { exact: true }).fill(String(GIVE_TOKENS));
            await main.getByLabel(`Amount (${COIN})`).fill(ASK);
            await main.getByRole('button', { name: /^Place order/ }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status), 'the chain rejected the maker order').toBe('valid');
            makerOrder = String(action.action_index);
        });

        await test.step('wallet B mirrors it with auto-pay ARMED', async () => {
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: 'Add Wallet' }).click();
            await createWallet(page, { password: PASSWORD, name: 'Autopay Taker', navigate: false });
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: /Autopay Taker/ }).first().click();
            await expect(page.getByRole('button', { name: /Autopay Taker/ }).first())
                .toBeVisible({ timeout: 30_000 });

            ({ source: taker } = await openCreateOrder(page));
            expect(taker, 'wallet B derived the same address as wallet A').not.toBe(maker);
            await fundAddress(taker, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            const { main } = await openCreateOrder(page);
            await main.getByRole('radio', { name: `Native ${COIN}` }).first().check();
            await main.getByRole('radio', { name: 'A token' }).last().check();
            await main.getByLabel(`Amount (${COIN})`).fill(ASK);
            await main.getByLabel('Ticker', { exact: true }).fill('XCHAIN');
            await main.getByLabel('Amount', { exact: true }).fill(String(GIVE_TOKENS));

            // Left ON this time, and the web shell's acknowledgement taken: this
            // is the arming the rest of the test depends on.
            await expect(main.getByRole('checkbox', { name: /Enable CoinPay auto-pay/ })).toBeChecked();
            await main.getByRole('checkbox', { name: /only auto-pays while it is open/ }).check();

            await main.getByRole('button', { name: /^Place order/ }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status), 'the chain rejected the taker order').toBe('valid');
            takerOrder = String(action.action_index);
            await expect(page.getByRole('main'), 'the wallet did not report the order as armed')
                .toContainText(/Auto-pay is armed/, { timeout: 30_000 });
        });

        await test.step('nobody touches the wallet, and the payment happens anyway', async () => {
            const match = await waitForMatch(makerOrder, takerOrder);
            expect(String(match.settlement_type)).toBe('coinpay');
            const obligation = await waitForObligation(taker, 'pending_coinpay');
            expect(String(obligation.payer_address)).toBe(taker);

            // Past the policy's two-confirmation floor. Mined here rather than
            // waited for, because the venue only makes blocks when something
            // asks: this is the harness supplying chain time, not user input.
            await minerRpc('generate_blocks', { count: 3 });

            // From here the spec does NOTHING to the page: no navigation, no
            // clicks. If a COINPAY appears, the wallet decided to send it.
            const deadline = Date.now() + 600_000;
            let coinpay = null;
            while (Date.now() < deadline && !coinpay) {
                const list = await explorerJson('actions?limit=100');
                const row = (list?.data || []).find((r) => String(r.action) === 'COINPAY'
                    && String(r.source) === taker);
                if (row) coinpay = await explorerJson(`action/${row.action_index}`);
                else { await mineIfPending(); await new Promise((r) => setTimeout(r, 5_000)); }
            }
            expect(coinpay,
                'an armed order matched and no COINPAY was ever sent, so PC-16 consent buys nothing: '
                + 'the obligation sits on its deadline waiting for a user who was told they need not act')
                .toBeTruthy();
            expect(String(coinpay.status), 'the chain rejected the auto-payment').toBe('valid');
            expect(Math.round(Number(coinpay.coin_amount) * 1e8),
                'auto-pay sent an amount other than the one the obligation owed')
                .toBe(ASK_SATS);

            const settled = await waitForObligation(taker, 'fulfilled');
            expect(Math.round(Number(settled.coin_amount) * 1e8)).toBe(ASK_SATS);
            expect(await waitForBalanceAtLeast(taker, 'XCHAIN', GIVE_TOKENS),
                'the escrowed tokens did not reach the payer after their own auto-payment')
                .toBe(GIVE_TOKENS);
        });
    });
});
