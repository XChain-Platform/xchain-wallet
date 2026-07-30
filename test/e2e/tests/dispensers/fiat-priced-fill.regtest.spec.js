// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Dispensers": FIAT/ORACLE PRICING, the oldest ⬜ left
// on that lane, listed there since Session 3 and never driven.
//
// WHAT THIS LANE IS. A dispenser can name its price in a CURRENCY rather than in
// coin: "each fill costs 3 USD". Nothing on chain holds dollars, so the fill
// price is resolved at SETTLEMENT time from the validator price snapshot for the
// coin the buyer pays in (`dispense.js` -> `utility.reversePriceMatch`, the Mode
// A / no-oracle path):
//
//     coin_per_fill = FIAT_AMOUNT / snapshot_price          ($3 / $30 = 0.1 LTC)
//     fills         = floor(coin_paid / coin_per_fill)
//
// So the number of fills a payment buys is decided by a price the seller never
// saw and the buyer never quoted, at a moment neither of them chose. That is
// what makes it worth a real run rather than a form walk: a coin-priced
// dispenser can only be wrong about arithmetic the wallet performed, and this
// one can be wrong about which price row the CHAIN reached for.
//
// THE ASSERTION THAT CARRIES IT is "exactly one fill". The venue has carried
// LTC/USD at both 30 and 100000 within this campaign's memory (the second left
// behind by another suite, campaign §3.5), and the difference is not subtle: at
// $30 a 0.1 LTC payment buys ONE fill, at $100,000 the same payment buys 3,333
// and would empty the escrow. A spec that only checked "the buyer got some
// tokens" passes on both. This one pays an amount derived from the venue's OWN
// quoted price and then requires the credit to be exactly one fill.
//
// SECOND SUBJECT, and it is the buyer's half: a fiat dispenser has GET_AMOUNT 0
// by protocol convention (DISPENSER.md examples 4/5), because the coin price is
// derived rather than stored. `DispenserDetail` models a dispenser as either
// token-paid or coin-paid off exactly that field, and reads no `fiat`,
// `fiat_amount` or `oracle_address` at all, though the explorer serves all three.
// So the last step asks what a buyer is actually shown, and requires the one
// thing no buy surface may do: quote a price of zero.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dispensers/fiat-priced-fill.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    mintXchain,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** The dispenser create pays a real coin protocol fee on this chain . */
const FUNDING = 2;
const STAMP = Date.now().toString().slice(-6);
/** What the dispenser sells: XCHAIN, free-mintable on regtest. */
const MINT = 1000;
const GIVE_PER_FILL = 25;
const ESCROW = 100;
/** The price, in dollars, of ONE fill. Never stored as coin anywhere. */
const FIAT_AMOUNT = 3;
const FIAT_CODE = 'USD';

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

/**
 * The coin/USD price the INDEXER will price this fill from, taken from the same
 * public quote the wallet uses.
 *
 * Read at runtime rather than hard-coded to the fixture's $30, for the reason
 * this whole spec exists: the payment and the expected fill count must be
 * derived from ONE price, and it has to be the venue's. A spec that pays a
 * hard-coded 0.1 LTC against a venue priced differently would either buy nothing
 * (and read as a broken dispenser) or buy thousands of fills.
 */
async function venueCoinUsdPrice() {
    const q = new URLSearchParams({
        action: 'ISSUE',
        params: `0|PRB${STAMP}`,
        source: 'rltc1qmr46t4ca5wh35k6mczdzrkepqw2d8ne956f48f',
    });
    const body = await explorerJson(`feequote?${q.toString()}`);
    const price = Number(body?.coinUsdPrice);
    expect(Number.isFinite(price) && price > 0,
        `the venue quotes no coin/USD price, so a fiat dispenser cannot settle here at all: `
        + `${JSON.stringify(body)}`)
        .toBe(true);
    return price;
}

test.describe(`fiat-priced dispensers on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('a dispenser priced in USD settles one fill at the validator price', async ({ page }) => {
        let seller;
        let buyer;
        let dispenserIndex;
        let coinUsd;
        /** Coin the buyer must pay for exactly one fill, at the venue's own price. */
        let payPerFill;

        await test.step('the SELLER opens a dispenser priced in dollars, not in coin', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Fiat Seller' });
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
            await waitForBalanceAtLeast(seller, 'XCHAIN', MINT);

            await seedPrices();
            coinUsd = await venueCoinUsdPrice();
            // floor(coin_paid / (FIAT_AMOUNT / price)) must be exactly 1, so pay
            // the fill price rounded UP to the chain's 8 decimal places: rounding
            // down would buy zero fills and read as a dispenser that ignores
            // payment.
            payPerFill = (Math.ceil((FIAT_AMOUNT / coinUsd) * 1e8) / 1e8).toFixed(8);

            await gotoPalette(page, 'Create dispenser');
            main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            await main.getByRole('button', { name: /^Token/ }).click();
            await page.getByText('XCHAIN', { exact: true }).first().click();

            await main.getByLabel('Give amount (per fill)').fill(String(GIVE_PER_FILL));
            await main.getByLabel('Escrow amount').fill(String(ESCROW));

            // The lane under test. The trigger price is left EMPTY on purpose:
            // a fiat dispenser carries GET_AMOUNT 0 and derives the coin price
            // at settlement, which is exactly what makes the buyer-side model
            // below interesting.
            await main.getByRole('button', { name: /Advanced options/ }).click();
            await main.getByLabel('Priced in fiat (optional)').selectOption(FIAT_CODE);
            await main.getByLabel(/^Fiat amount/).fill(String(FIAT_AMOUNT));

            await main.getByRole('button', { name: /^(Create|Preview)$/ }).click();
            await expectConfirmModal(page);
            const created = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(created.action)).toBe('DISPENSER');
            expect(String(created.status), 'the chain rejected the fiat dispenser').toBe('valid');
            dispenserIndex = String(created.action_index);

            // The chain's own record of the pricing mode. Without this the fill
            // below could be settling as an ordinary coin-priced dispenser and
            // nothing in the run would notice.
            expect(String(created.fiat_code),
                'the dispenser was not stored as fiat-priced, so the wallet dropped FIAT_CODE')
                .toBe(FIAT_CODE);
            expect(Number(created.fiat_amount),
                'the dispenser stored a different fiat price than the form was given')
                .toBe(FIAT_AMOUNT);
            // The zero the SDK validator used to refuse (D-143), on chain and
            // accepted. It is the whole convention: no coin price is stored,
            // because the coin price does not exist until settlement.
            expect(Number(created.get_amount),
                'a fiat dispenser stored a coin price, so it is not fiat-priced at all')
                .toBe(0);

            // The escrow left the seller: that is what the buyer is paid from.
            expect(await waitForBalanceChange(seller, 'XCHAIN', MINT),
                `opening the dispenser did not escrow ${ESCROW} XCHAIN`)
                .toBe(MINT - ESCROW);
        });

        await test.step('the BUYER pays the dollar price, in coin, from the Send form', async () => {
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: 'Add Wallet' }).click();
            await createWallet(page, { password: PASSWORD, name: 'Fiat Buyer', navigate: false });
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: /Fiat Buyer/ }).first().click();
            await expect(page.getByRole('button', { name: /Fiat Buyer/ }).first(),
                'the app did not switch to the newly added wallet')
                .toBeVisible({ timeout: 30_000 });

            // Read the buyer's address off a form that carries a chain picker,
            // not off Receive: Receive shows the ACTIVE chain's address and a
            // wallet added mid-session is on whichever chain the app lists
            // first, so it answers for Bitcoin on a Litecoin run. The Issue
            // form is used purely as a chain-scoped address reader here and
            // nothing is composed from it (the same trick token-paid-settle
            // uses with the dispenser form's Source).
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

            // A BARE native payment is what triggers a dispenser (Session 12):
            // two outputs, no OP_RETURN, no XChain action of its own. The Send
            // form composes exactly that for a coin send, so this is the buyer's
            // real in-app path and not a harness shortcut.
            await gotoPalette(page, 'Send');
            const main = page.getByRole('main');
            // The Send form carries no chain picker of its own: it follows the
            // SELECTED ASSET's chain (and otherwise the wallet's active chain,
            // which for a wallet added mid-session is Bitcoin). Picking this
            // venue's native coin is therefore how the chain gets chosen, and
            // skipping it composes a Bitcoin send with an "Amount (BTC)" field
            // and "This looks like a Litecoin address, not a Bitcoin address."
            // under the destination.
            const coin = REGTEST_COIN.slice(1);
            await page.getByRole('button', { name: /Change asset/ }).click();
            await page.getByLabel('Search coins or tokens').fill(coin);
            // A NATIVE coin row is named for its CHAIN ("Open Litecoin
            // details"), not for its ticker the way a token row is ("Open
            // XCHAIN details"). Searching by ticker finds it; addressing it by
            // ticker does not.
            await page.getByLabel(new RegExp(`Open ${REGTEST_CHAIN_LABEL} details`, 'i'))
                .first().click();
            await expect(main.getByRole('textbox', { name: new RegExp(`^Amount \\(${coin}\\)`) }),
                `the Send form is composing on the wrong chain: no ${coin} amount field`)
                .toBeVisible({ timeout: 30_000 });

            await page.getByLabel('To', { exact: true }).fill(seller);
            await page.getByRole('textbox', { name: /^Amount/ }).fill(payPerFill);
            await main.getByRole('button', { name: 'Send', exact: true }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await page.getByTestId('confirm-approve').click();
            await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
                .toBeVisible({ timeout: 180_000 });
        });

        await test.step('the chain prices the fill from its own snapshot, and gives exactly one', async () => {
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
                `the buyer paid ${payPerFill} ${REGTEST_COIN.slice(1)} to a fiat dispenser and no `
                + 'DISPENSE was ever recorded, so they paid and received nothing')
                .toBeTruthy();
            expect(String(dispense.status), 'the chain rejected the dispense').toBe('valid');

            // THE ASSERTION THIS SPEC EXISTS FOR. One fill, not zero and not
            // thousands: the venue has carried this pair at both $30 and
            // $100,000 within the campaign's memory, and at the wrong one the
            // same payment empties the escrow instead of buying a fill.
            expect(await waitForBalanceAtLeast(buyer, 'XCHAIN', GIVE_PER_FILL),
                `the buyer paid the price of ONE fill at the venue's own $${coinUsd} and was `
                + 'credited a different number of fills, so the chain priced this from a snapshot '
                + 'other than the one the payment was sized against')
                .toBe(GIVE_PER_FILL);

            const detail = await explorerJson(`action/${dispenserIndex}`);
            expect(Number(detail?.state?.give_remaining ?? detail?.give_remaining),
                'the dispenser escrow did not fall by exactly one fill')
                .toBe(ESCROW - GIVE_PER_FILL);
        });

        await test.step('and what the BUYER is shown for a fiat dispenser', async () => {
            // The dispenser is coin-paid in the buyer's eyes but carries
            // GET_AMOUNT 0, and DispenserDetail decides between its token-paid
            // and coin-paid models off exactly that field while reading none of
            // `fiat`, `fiat_amount` or `oracle_address`, all of which the
            // explorer serves. Whatever it renders, one thing is not allowed: a
            // buy surface must never quote a price of zero, because a buyer who
            // pays it gets nothing and a buyer who trusts it thinks the goods
            // are free.
            await gotoPalette(page, 'All actions');
            await page.getByRole('main').getByText('Browse dispensers', { exact: true })
                .first().click();
            const main = page.getByRole('main');
            await expect(main.getByLabel('Token ticker')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Token ticker').fill('XCHAIN');
            await main.getByRole('button', { name: 'Search', exact: true }).click();

            const row = main.getByRole('button').filter({ hasText: `#${dispenserIndex} ` });
            await expect(row, `the fiat dispenser #${dispenserIndex} is on chain but a buyer `
                + 'searching the token it sells cannot find it')
                .toBeVisible({ timeout: 60_000 });
            await row.click();

            const coin = REGTEST_COIN.slice(1);
            const panel = page.getByRole('main');
            // The panel has to actually be there, or the two assertions under
            // this would pass on a screen that says nothing at all.
            await expect(panel, 'no pay-to-buy panel rendered for a fiat dispenser at all')
                .toContainText('Pay to buy', { timeout: 30_000 });

            const text = await panel.innerText();
            // D-144. The exact string this used to print was "Send exactly 0 LTC
            // per fill", so the pattern is anchored on how the panel words a
            // price rather than on one phrasing of it. A buyer who follows a
            // zero quote pays a network fee and buys nothing.
            expect(/(send|pay)[^\n]*\b0(\.0+)?\s*(LTC|BTC|DOGE)\b/i.test(text),
                'the buy panel quotes a price of ZERO for a fiat-priced dispenser: its real price '
                + `is ${FIAT_AMOUNT} ${FIAT_CODE} a fill, which at the venue's own rate is `
                + `${payPerFill} ${coin}. GET_AMOUNT is 0 by protocol convention here and the panel `
                + 'used to price straight off it, reading none of the fiat fields the explorer '
                + 'serves on the same row')
                .toBe(false);

            // ...and the positive half: a buyer must be able to learn the price.
            // Saying nothing is not a fix for saying zero.
            expect(text,
                'the buy panel does not tell a buyer what a fill costs, in any currency')
                .toContain(`${FIAT_AMOUNT} ${FIAT_CODE}`);
        });
    });
});
