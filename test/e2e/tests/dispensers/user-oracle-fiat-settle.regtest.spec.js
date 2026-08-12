// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Dispensers": the USER-ORACLE fiat mode (Mode B)
// SETTLEMENT leg - the last ⬜ on that lane, half-driven by Session 33 and left
// time-gated rather than undone.
//
// WHAT MODE B IS, and how it differs from the Mode A already pinned by
// `fiat-priced-fill.regtest.spec.js`. Mode A prices a fill in dollars and
// converts at settlement from the VALIDATOR's coin/fiat snapshot. Mode B names
// an ORACLE_ADDRESS instead: a user-published PRICE v1 quote prices the TOKEN in
// fiat, and settlement cross-converts through the validator snapshot
// (`utility.reverseOraclePriceMatch`):
//
//     units  = floor(coin_paid x coin_fiat_price / oracle_price)
//     tokens = units x GIVE_AMOUNT
//
// Two prices, two publishers, neither of them the buyer or the seller.
//
// WHY IT COULD NOT BE DRIVEN UNTIL NOW, and why it can only be driven inside a
// 24-hour window. Every PRICE v1 publish is inert for exactly 86,400 seconds
// (`effective_at = block_time + 86400`, PriceAggregator.js) and then usable for
// exactly 86,400 more: settlement reads `oracle_prices` with
// `effective_at BETWEEN blockTime - 86400 AND blockTime` (db.getOraclePricesInTimeRange).
// So one publish prices dispensers for ONE DAY, starting a day after it is made.
// Session 33 published the quote this spec settles against and recorded the
// address in the campaign doc for exactly this reason; a spec cannot both
// publish an oracle and use it without moving a shared chain's clock a day.
//
// WHAT THIS ASSERTS, in the order the money moves:
//
//   1. THE ORACLE IS PAID. A Mode B dispenser pays its oracle operator a usage
//      fee UP FRONT, as a real native-coin output inside the DISPENSER
// Transaction, scaled to the escrow being locked (
//      `utility.quoteOracleFee`). Nothing has ever measured that money. The
//      operator's spendable balance is read before and after and must rise by
//      exactly the quoted amount.
//   2. THE CREDIT IS THE ORACLE'S NUMBER. The buyer pays a bare coin payment
//      whose value in tokens is decided by a price neither side quoted, and the
//      credit must be exactly what the oracle's published price implies. The
//      count is what carries it: at any other price - the validator's, a flat
//      one, the venue's other snapshots - the same payment buys a different
//      number of tokens.
//   3. THE FLOOR, AND THAT THE REMAINDER IS NOT REFUNDED. The payment is sized
//      to buy 7.4 units deliberately, so 7 is only produced by flooring, and the
//      0.4 stays with the seller.
//
// THE PRICE ROW THIS SPEC HAS TO PLANT, and it is not the usual price seed.
// Mode B anchors the VALIDATOR half of the conversion at the ORACLE's
// effective_at, not at the block carrying the payment
// (`getPricesInTimeRange(pair, op.effectiveAt - window, op.effectiveAt)`), so
// the row it needs is one stamped in the PAST. `seedPrices()` cannot supply it:
// that fixture keeps its rounds fresh by re-stamping them forward, which walks
// them straight out of the oracle's window and leaves settlement with
// `invalid: no matching oracle price`. So this plants one extra row itself, on a
// round number that is NOT in the fixture's synthetic family (so the price
// fixture never moves it) and BELOW that family (so it can never win fee
// selection, which is `ORDER BY round_number DESC`, and never makes the fee lane
// look stale).
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js \
//       tests/dispensers/user-oracle-fiat-settle.regtest.spec.js

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
    runInIndexer,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
} from '../../fixtures/regtest.js';
import { writeRowsScript } from '../../fixtures/priceSeed.js';

const PASSWORD = 'regtestpassword123';
/** The create pays a coin protocol fee AND the oracle's usage fee. */
const FUNDING = 2;

/**
 * The oracle Session 33 published from the wallet, and everything the chain
 * stored about it.
 *
 * Kept as constants rather than discovered, because a spec that hunted for "any
 * effective oracle" would settle against another suite's feed and assert
 * arithmetic derived from it - which is self-consistent and proves nothing. If
 * this feed is outside its window the run fails naming the window, not the
 * dispenser.
 */
const ORACLE = {
    address: 'rltc1qguj32tkf0lx9dtr3pgega4rxjl980rjdh8h6la',
    tick: 'XCHAIN',
    fiat: 'USD',
    /** Dollars per XCHAIN, as published (PRICE|1|LTC|XCHAIN|USD|1.5|0.01). */
    price: 1.5,
    /** A fraction of the dispenser's projected proceeds, not a percentage. */
    feeFraction: 0.01,
};

/** The validator coin price this run pins into the oracle's own window. */
const COIN_USD = 30;
/** Not in `SYNTHETIC_ROUNDS`, and below the whole 8881000xx family. See above. */
const WINDOW_ROUND = 777100002;

const MINT = 500;
/**
 * Deliberately NOT 1. With one token per fill the `units x GIVE_AMOUNT`
 * multiplication is invisible, and it is the step where the oracle's per-TOKEN
 * price becomes a per-FILL price (see the semantics note in the settlement
 * step).
 */
const GIVE_PER_FILL = 5;
const ESCROW = 100;
/**
 * 0.37 LTC = $11.10 at $30, which is 7.4 oracle units.
 *
 * Every digit is load-bearing. 7 fills (35 XCHAIN) is produced ONLY by
 * flooring $11.10 / $1.50; per-fill-priced-per-token arithmetic would give 1
 * fill, the validator price alone would give a wildly different count, and a
 * venue still carrying LTC/USD at $100,000 would empty the escrow.
 */
const PAY_COIN = '0.37000000';
const EXPECTED_UNITS = 7;
const EXPECTED_TOKENS = EXPECTED_UNITS * GIVE_PER_FILL;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(`No XChain action recorded for ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s. Decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}.`);
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

async function waitForBalanceChange(address, tick, from, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = from;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last !== from) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance for ${address} never moved off ${from}`);
}

/**
 * The venue coin's spendable satoshis at `address`, from the encoder's UTXO
 * view - the same set the wallet spends from, so a before/after pair measures
 * what a transaction really paid out.
 */
async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
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

async function expectConfirmModal(page) {
    const modal = page.getByTestId('confirm-modal');
    const priceAlert = page.getByText(/fee price is temporarily unavailable/);
    await modal.or(priceAlert).first().waitFor({ state: 'visible', timeout: 60_000 });
    expect(await priceAlert.count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. Venue '
        + 'state, not a wallet defect - re-seed (campaign §3.2) and re-run')
        .toBe(0);
    await expect(modal).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
}

async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

test.describe(`user-oracle (Mode B) fiat dispensers on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('a dispenser priced by a user oracle pays that oracle, then settles at its quote', async ({ page }) => {
        let seller;
        let buyer;
        let dispenserIndex;
        /** The oracle's usage fee for this escrow, in satoshis, as the CHAIN quotes it. */
        let oracleFeeSats;
        /** The seller's spendable coin the moment before the buyer pays. */
        let sellerCoinBefore;

        await test.step('the oracle Session 33 published is inside its one-day window', async () => {
            const body = await explorerJson(`oracle_prices/${ORACLE.address}/address`);
            const row = (body?.data || []).find((r) => String(r.tick) === ORACLE.tick);
            expect(row, `the PRICE v1 quote this spec settles against is gone from the venue. It `
                + `was published by Session 33 from ${ORACLE.address} and the campaign doc records `
                + 'it; a venue reset would remove it. Republish (palette: "Publish oracle price", '
                + `${ORACLE.price} ${ORACLE.fiat} per ${ORACLE.tick}, usage fee `
                + `${ORACLE.feeFraction}) and re-run this spec 24 hours later.`)
                .toBeTruthy();

            const effectiveAt = Number(row.effective_at);
            const now = Math.floor(Date.now() / 1000);
            // The window is closed on BOTH sides and this is the only place the
            // spec can say so legibly. Past the far edge every assertion below
            // fails as "no matching oracle price", which reads like a settlement
            // defect and is a calendar.
            expect(now >= effectiveAt,
                `that quote is not effective yet: it matures at ${effectiveAt} `
                + `(${new Date(effectiveAt * 1000).toISOString()}), in `
                + `${Math.round((effectiveAt - now) / 60)} minutes. A PRICE v1 publish is inert `
                + 'for 24 hours; wait, do not re-publish.')
                .toBe(true);
            expect(now < effectiveAt + 86_400,
                `that quote EXPIRED at ${effectiveAt + 86_400} `
                + `(${new Date((effectiveAt + 86_400) * 1000).toISOString()}). A PRICE v1 publish `
                + 'prices dispensers for exactly one day: settlement reads oracle_prices with '
                + '`effective_at BETWEEN blockTime - 86400 AND blockTime`. Publish a fresh quote '
                + 'and re-run 24 hours later.')
                .toBe(true);

            expect(Number(row.value), 'the venue oracle publishes a different price than this '
                + 'spec computes its expectations from').toBe(ORACLE.price);
            expect(Number(row.fee), 'the venue oracle charges a different usage fee than this '
                + 'spec expects to see paid').toBe(ORACLE.feeFraction);

            // The validator half of the cross-conversion, pinned INSIDE the
            // oracle's window. See the header: seedPrices() cannot do this job
            // because keeping a row fresh means moving it out of the window.
            await runInIndexer(writeRowsScript([{
                roundNumber: WINDOW_ROUND,
                coinPair: `${REGTEST_COIN.slice(1)}/${ORACLE.fiat}`,
                price: COIN_USD.toFixed(8),
                blockTimestamp: effectiveAt - 300,
            }]));

            // Proof the plant is the row the CHAIN will reach for, taken from
            // the same public quote the wallet sizes its fee output from: the
            // oracle fee is `oracle_price x escrow x fraction / coin_price`, so
            // it only comes out at $30 if $30 is what got selected.
            const quote = await explorerJson(`oraclefeequote?${new URLSearchParams({
                oracleAddress: ORACLE.address,
                giveCoin: REGTEST_COIN.slice(1),
                giveTick: ORACLE.tick,
                fiatCode: ORACLE.fiat,
                getCoin: REGTEST_COIN.slice(1),
                giveEscrow: String(ESCROW),
                blockTime: String(now),
            })}`);
            expect(quote?.valid, `the venue will not quote an oracle fee for a live oracle: `
                + JSON.stringify(quote)).toBe(true);
            oracleFeeSats = Number(quote.requiredFeeSats);
            const expectedFeeSats = Math.round(
                (ORACLE.price * ESCROW * ORACLE.feeFraction / COIN_USD) * 1e8);
            expect(oracleFeeSats,
                'the chain quotes a different oracle usage fee than `oracle_price x escrow x '
                + 'fraction / coin_price`, so the coin price inside the oracle window is not the '
                + 'one this spec planted and every figure below is derived from the wrong number')
                .toBe(expectedFeeSats);
            expect(quote.belowDust,
                'the oracle fee is below the dust threshold, so no output is required and the '
                + 'payment leg cannot be measured at all')
                .toBe(false);
        });

        await test.step('the SELLER opens a dispenser priced by that oracle', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Oracle Seller' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Create dispenser');
            let main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            seller = await main.getByRole('textbox', { name: 'Source' }).inputValue();
            expect(seller, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(seller, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT);
            await waitForBalanceAtLeast(seller, ORACLE.tick, MINT);
            await seedPrices();

            const oracleCoinBefore = await coinBalanceSats(ORACLE.address);

            await gotoPalette(page, 'Create dispenser');
            main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            await main.getByRole('button', { name: /^Token/ }).click();
            await page.getByText(ORACLE.tick, { exact: true }).first().click();

            await main.getByLabel('Give amount (per fill)').fill(String(GIVE_PER_FILL));
            await main.getByLabel('Escrow amount').fill(String(ESCROW));

            // Mode B: a fiat CODE and an ORACLE, and no fiat AMOUNT. The empty
            // amount is the mode selector - with one it is Mode A and the
            // validator prices the fill; without one the oracle does.
            await main.getByRole('button', { name: /Advanced options/ }).click();
            await main.getByLabel('Priced in fiat (optional)').selectOption(ORACLE.fiat);
            await main.getByLabel(/^Oracle address/).fill(ORACLE.address);

            await main.getByRole('button', { name: /^(Create|Preview)$/ }).click();
            await expectConfirmModal(page);
            const created = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(created.action)).toBe('DISPENSER');
            expect(String(created.status),
                'the chain rejected the Mode B dispenser. `invalid: ORACLE_ADDRESS (missing oracle '
                + 'fee output)` means the wallet composed no usage-fee output at all; `(no '
                + 'effective oracle price)` means the tip is still behind the oracle\'s maturity')
                .toBe('valid');
            dispenserIndex = String(created.action_index);

            // The chain's own record of the pricing mode. Without these three
            // the fill below could be settling as an ordinary coin-priced
            // dispenser and nothing in the run would notice.
            expect(String(created.oracle_address),
                'the dispenser stored no oracle address, so it is not Mode B at all')
                .toBe(ORACLE.address);
            expect(String(created.fiat_code),
                'the dispenser was not stored as fiat-priced').toBe(ORACLE.fiat);
            expect(Number(created.get_amount),
                'a fiat dispenser stored a coin price, so it is not fiat-priced at all')
                .toBe(0);

            expect(await waitForBalanceChange(seller, ORACLE.tick, MINT),
                `opening the dispenser did not escrow ${ESCROW} ${ORACLE.tick}`)
                .toBe(MINT - ESCROW);

            // And this is the assertion nothing has ever made: the
            // oracle operator is a third party to this transaction who gets PAID
            // by it, up front, in coin. A create that quoted the fee and dropped
            // the output would be refused by consensus - so what this measures
            // is the AMOUNT, and that it reached the operator rather than a
            // change address.
            const deadline = Date.now() + 120_000;
            let oracleCoinAfter = oracleCoinBefore;
            while (Date.now() < deadline && oracleCoinAfter === oracleCoinBefore) {
                await new Promise((r) => setTimeout(r, 2_000));
                oracleCoinAfter = await coinBalanceSats(ORACLE.address).catch(() => oracleCoinAfter);
            }
            expect(oracleCoinAfter - oracleCoinBefore,
                `the oracle operator was not paid its usage fee: expected exactly ${oracleFeeSats} `
                + 'satoshis (1% of the escrow\'s value at the oracle\'s own price) to land at '
                + `${ORACLE.address} from the DISPENSER transaction`)
                .toBe(oracleFeeSats);
        });

        await test.step('a BUYER pays a bare coin payment sized to 7.4 oracle units', async () => {
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: 'Add Wallet' }).click();
            await createWallet(page, { password: PASSWORD, name: 'Oracle Buyer', navigate: false });
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: /Oracle Buyer/ }).first().click();
            await expect(page.getByRole('button', { name: /Oracle Buyer/ }).first(),
                'the app did not switch to the newly added wallet')
                .toBeVisible({ timeout: 30_000 });

            // Read the buyer's address off a form with a chain picker rather
            // than off Receive, which answers for the ACTIVE chain - Bitcoin,
            // for a wallet added mid-session on a Litecoin run.
            await gotoPalette(page, 'Issue token');
            const form = page.getByRole('main');
            await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(form);
            buyer = await form.getByLabel('From').inputValue();
            expect(buyer, `the buyer wallet has no ${REGTEST_CHAIN_LABEL} address`)
                .toMatch(REGTEST_ADDRESS_RE);
            expect(buyer, 'the buyer wallet derived the seller\'s address').not.toBe(seller);

            await fundAddress(buyer, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            sellerCoinBefore = await coinBalanceSats(seller);

            // A BARE native payment is what triggers a dispenser: two outputs,
            // no OP_RETURN, no XChain action of its own. The Send form composes
            // exactly that, so this is the buyer's real in-app path.
            await gotoPalette(page, 'Send');
            const main = page.getByRole('main');
            const coin = REGTEST_COIN.slice(1);
            await page.getByRole('button', { name: /Change asset/ }).click();
            await page.getByLabel('Search coins or tokens').fill(coin);
            // A native-coin row is named for its CHAIN, not for its ticker.
            await page.getByLabel(new RegExp(`Open ${REGTEST_CHAIN_LABEL} details`, 'i'))
                .first().click();
            await expect(main.getByRole('textbox', { name: new RegExp(`^Amount \\(${coin}\\)`) }),
                `the Send form is composing on the wrong chain: no ${coin} amount field`)
                .toBeVisible({ timeout: 30_000 });

            await page.getByLabel('To', { exact: true }).fill(seller);
            await page.getByRole('textbox', { name: /^Amount/ }).fill(PAY_COIN);
            await main.getByRole('button', { name: 'Send', exact: true }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await page.getByTestId('confirm-approve').click();
            await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
                .toBeVisible({ timeout: 180_000 });
        });

        await test.step('the chain converts through TWO prices and credits the oracle\'s number', async () => {
            const deadline = Date.now() + 300_000;
            let dispense = null;
            while (Date.now() < deadline && !dispense) {
                const list = await explorerJson('actions?limit=100');
                const row = (list?.data || []).find((r) => String(r.action) === 'DISPENSE'
                    && String(r.source) === buyer);
                if (row) dispense = await explorerJson(`action/${row.action_index}`);
                else { await mineIfPending(); await new Promise((r) => setTimeout(r, 2_000)); }
            }
            expect(dispense,
                `the buyer paid ${PAY_COIN} ${REGTEST_COIN.slice(1)} to a Mode B dispenser and no `
                + 'DISPENSE was ever recorded, so they paid and received nothing')
                .toBeTruthy();
            expect(String(dispense.status),
                'the chain rejected the dispense. `invalid: no matching oracle price` means the '
                + 'validator row inside the oracle\'s window is gone - see this file\'s header on '
                + 'why seedPrices() cannot supply it')
                .toBe('valid');

            // THE ASSERTION THIS SPEC EXISTS FOR. $11.10 of coin, an oracle
            // quoting $1.50, seven whole units, five tokens each. No other
            // price on this venue produces 35: the validator's $30 alone would
            // give 0 (a coin price is not a token price), a stale $100,000 row
            // would empty the escrow, and reading the oracle's per-token price
            // as a per-FILL price would give 1 unit and 5 tokens.
            expect(await waitForBalanceAtLeast(buyer, ORACLE.tick, EXPECTED_TOKENS),
                `the buyer paid ${PAY_COIN} ${REGTEST_COIN.slice(1)} (= $${(Number(PAY_COIN) * COIN_USD).toFixed(2)} `
                + `at the venue's $${COIN_USD}) against an oracle quoting $${ORACLE.price} per `
                + `${ORACLE.tick}, which is ${EXPECTED_UNITS} whole units of ${GIVE_PER_FILL}, and `
                + 'was credited something else - so the cross-conversion did not use both prices')
                .toBe(EXPECTED_TOKENS);

            const detail = await explorerJson(`action/${dispenserIndex}`);
            expect(Number(detail?.state?.give_remaining ?? detail?.give_remaining),
                `the escrow did not fall by exactly ${EXPECTED_TOKENS}, so the dispenser and the `
                + 'buyer disagree about what was sold')
                .toBe(ESCROW - EXPECTED_TOKENS);

            // The floor keeps the remainder, and that is a money fact rather
            // than a rounding note: 7.4 units were paid for and 7 delivered, so
            // 0.4 of a unit (0.02 LTC, $0.60) stays with the seller. The
            // seller's coin must therefore rise by the WHOLE payment - a
            // dispenser that returned the unspent fraction would show less.
            expect(await coinBalanceSats(seller) - sellerCoinBefore,
                `the seller did not receive the whole ${PAY_COIN} ${REGTEST_COIN.slice(1)}. `
                + `${EXPECTED_UNITS}.4 units were paid for and ${EXPECTED_UNITS} delivered; the `
                + 'remainder is kept, not refunded')
                .toBe(Math.round(Number(PAY_COIN) * 1e8));
        });

        await test.step('and what a BUYER is told a fill costs', async () => {
            // The Mode A sibling asserts two things about this panel: it must
            // never quote a price of ZERO (D-144, since GET_AMOUNT is 0 by
            // convention on every fiat dispenser), and a buyer must be able to
            // learn the price. Mode B is the harder half of the second one: the
            // price is not on the dispenser row at all, it is on the oracle's
            // published quote, which the explorer serves at
            // /oracle_prices/<address>/address.
            await gotoPalette(page, 'All actions');
            await page.getByRole('main').getByText('Browse dispensers', { exact: true })
                .first().click();
            const main = page.getByRole('main');
            await expect(main.getByLabel('Token ticker')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Token ticker').fill(ORACLE.tick);
            await main.getByRole('button', { name: 'Search', exact: true }).click();

            const row = main.getByRole('button').filter({ hasText: `#${dispenserIndex} ` });
            await expect(row, `the Mode B dispenser #${dispenserIndex} is on chain but a buyer `
                + 'searching the token it sells cannot find it')
                .toBeVisible({ timeout: 60_000 });
            await row.click();

            const coin = REGTEST_COIN.slice(1);
            const panel = page.getByRole('main');
            await expect(panel, 'no pay-to-buy panel rendered for a Mode B dispenser at all')
                .toContainText('Pay to buy', { timeout: 30_000 });

            const text = await panel.innerText();
            // D-144's guard, restated for Mode B.
            expect(/(send|pay)[^\n]*\b0(\.0+)?\s*(LTC|BTC|DOGE)\b/i.test(text),
                'the buy panel quotes a price of ZERO for an oracle-priced dispenser')
                .toBe(false);

            // The positive half. A buyer standing in front of this panel has to
            // be able to work out what to send: the panel knows the oracle's
            // address and the explorer publishes that oracle's price, so
            // "an oracle sets it" is a lookup the wallet can do and the buyer
            // cannot.
            expect(text,
                'the buy panel never states what a fill costs. It names no fiat figure at all for '
                + 'an oracle-priced dispenser, so a buyer cannot size a payment: too little buys '
                + 'nothing and is NOT returned, too much overpays with the remainder kept by the '
                + `seller. The price is published and readable - ${ORACLE.price} ${ORACLE.fiat} at `
                + `${ORACLE.address}`)
                .toMatch(new RegExp(`${ORACLE.price}\\s*${ORACLE.fiat}|${ORACLE.fiat}\\s*${ORACLE.price}|\\$${ORACLE.price}`));

            // ...and it is the PUBLISHED figure, not the published figure times
            // the fill size. That is the screen half of the semantics this run
            // measured on chain: the oracle publishes "one XCHAIN is $1.50" and
            // the indexer spends it as the price of one FILL, so this dispenser
            // sells five tokens for $1.50 rather than for $7.50. A panel that
            // quoted the intuitive reading would be wrong by GIVE_AMOUNT and
            // every buyer following it would overpay fivefold.
            expect(text,
                `the panel quotes ${ORACLE.price * GIVE_PER_FILL} ${ORACLE.fiat}, which is the `
                + 'oracle price multiplied by the fill size - the reading the DISPENSER docs imply '
                + 'and the chain does NOT implement. The measured settlement gave '
                + `${EXPECTED_TOKENS} ${ORACLE.tick} for ${PAY_COIN} coin, i.e. `
                + `${ORACLE.price} ${ORACLE.fiat} per fill of ${GIVE_PER_FILL}`)
                .not.toMatch(new RegExp(`${ORACLE.price * GIVE_PER_FILL}\\s*${ORACLE.fiat}`));
        });
    });
});
