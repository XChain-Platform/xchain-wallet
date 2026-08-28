// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Mode B (USER-ORACLE) dispenser lane, the half of oracle pricing
// that fiat-priced-fill.regtest.spec.js does not reach.
//
// MODE A vs MODE B. Mode A prices a fill in dollars and lets the VALIDATOR price
// snapshot convert it to coin at settlement; there is no oracle address and no
// one is paid for the quote. Mode B (§40.7.1 Mode 2) names an ORACLE_ADDRESS: a
// third party who published a PRICE v1 row, is paid a usage fee for it, and
// whose row decides what a fill costs. The seller pays that fee ONCE, out of the
// dispenser-create transaction, and the wallet sizes the output itself from
// `/oraclefeequote` (packages/core/src/sdk/oracleFeePreflight.js).
//
// WHY THIS COULD NOT BE RUN THE DAY IT WAS WRITTEN. Every PRICE v1 publish is
// inert for 24h (`PriceAggregator.js`, `effective_at = block_time + 86400`,
// unconditional), and moving a shared venue's clock forward is forbidden by the
// campaign venue contract §3.5. The feeds this spec uses were planted 2026-07-30
// and matured 2026-07-31.
//
// THE DUST TRAP THIS SPEC IS BUILT AROUND, and the reason the guard below is not
// decoration. The usage fee is a FRACTION OF THE ESCROW (`fee` 0.01 = 1%), so
// its coin value depends entirely on what the venue thinks the coin is worth. At
// the $100,000 LTC/USD another suite has left behind here, a 100 XCHAIN escrow
// quotes `requiredFeeSats: 1500, belowDust: true`, and `applyOracleFeePreflight`
// appends NO OUTPUT in that branch (oracleFeePreflight.js:138). A run that
// skipped the price seed would therefore go green having never attached the
// output this whole item exists to prove. So the guard asserts
// `belowDust === false` BEFORE anything is composed, and the payoff assertion
// measures the oracle's own address rather than trusting the wallet's preview.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dispensers/oracle-priced-fill.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal as sharedConfirmModal,
    EXPLORER_URL,
    fundAddress,
    minerRpc,
    mintXchain,
    plantedOracleFeedRefusal,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Covers the coin protocol fee, the oracle usage fee, and network fees. */
const FUNDING = 3;
/** What the dispenser sells: XCHAIN, free-mintable on regtest. */
const MINT = 1000;
/**
 * ONE XCHAIN per fill, deliberately.
 *
 * The oracle publishes a price for the TICK ($1.50 per XCHAIN), so the dollar
 * price of a fill is `GIVE_PER_FILL x oracle.value`. At 1 per fill the fill
 * price IS the published price, which is what makes the closing assertion
 * readable as the ledger states it: fills = floor((coin_paid x LTC/USD) / 1.50).
 */
const GIVE_PER_FILL = 1;
const ESCROW = 100;
const FIAT_CODE = 'USD';

/**
 * Feed id 11 of the ten planted for this item, and the EARLIEST to mature
 * (effective 1785515253, 16:27:33Z) where the id-20 address named in the ledger
 * entry matures 27 minutes later. Nine spares exist if a run burns one; the
 * quote is address-scoped, so a spare needs this constant changed and nothing
 * else.
 */
const ORACLE_ADDRESS = 'rltc1q5zsmfgvjezspgv5qjz4zlmk95y3hf4dnaznr7v';

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

/** Native coin ever RECEIVED by an address, in satoshis. */
async function nativeReceivedSats(address) {
    const body = await explorerJson(`address/${address}`);
    const received = body?.balances?.received;
    expect(received, `the explorer served no native balance for ${address}`).toBeTruthy();
    return Math.round(Number(received) * 1e8);
}

async function waitForNativeReceivedAbove(address, from, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = from;
    while (Date.now() < deadline) {
        last = await nativeReceivedSats(address).catch(() => last);
        if (last > from) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    return last;
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

/**
 * The shared reader, plus this lane's own checks.
 *
 * A narrower wait races the modal against the stale-price alert and nothing
 * else, so every OTHER refusal the screen carried read as the modal simply
 * not being there - which is how the shared explorer's 429 was reported as a
 * locator timeout for four runs. `expectConfirmModal` reads every alert on
 * the screen instead. The price check stays because it names one venue state
 * early and by itself.
 */
async function expectConfirmModal(page) {
    const modal = await sharedConfirmModal(page, 'this action', 60_000);
    expect(await page.getByText(/fee price is temporarily unavailable/).count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. '
        + 'Venue state, not a wallet defect - re-seed (campaign §3.2) and re-run')
        .toBe(0);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
}

async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/** The coin/USD price the INDEXER will price this fill from. */
async function venueCoinUsdPrice() {
    const q = new URLSearchParams({
        action: 'ISSUE',
        params: `0|PRB${Date.now().toString().slice(-6)}`,
        source: 'rltc1qmr46t4ca5wh35k6mczdzrkepqw2d8ne956f48f',
    });
    const body = await explorerJson(`feequote?${q.toString()}`);
    const price = Number(body?.coinUsdPrice);
    expect(Number.isFinite(price) && price > 0,
        `the venue quotes no coin/USD price, so an oracle dispenser cannot settle here at all: `
        + `${JSON.stringify(body)}`)
        .toBe(true);
    return price;
}

/** The oracle's own published row, read rather than hard-coded. */
async function oracleRow() {
    const body = await explorerJson('oracle_prices');
    const row = (body?.data || []).find((r) => String(r.source_address) === ORACLE_ADDRESS);
    expect(row, `the oracle feed for ${ORACLE_ADDRESS} is gone from this venue: the ten feeds `
        + 'planted for on 2026-07-30 may have been reset away, in which case this lane'
        + 'needs a fresh publish plus another 24h maturation wait')
        .toBeTruthy();
    return row;
}

/** The wallet's own fee quote, the number oracleFeePreflight sizes its output from. */
async function oracleFeeQuote(escrow) {
    const q = new URLSearchParams({
        oracleAddress: ORACLE_ADDRESS,
        giveCoin: REGTEST_COIN.slice(1),
        giveTick: 'XCHAIN',
        fiatCode: FIAT_CODE,
        getCoin: REGTEST_COIN.slice(1),
        giveEscrow: String(escrow),
    });
    return explorerJson(`oraclefeequote?${q.toString()}`);
}

test.describe(`user-oracle dispensers on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('a dispenser priced by a user oracle pays the usage fee and fills at the published price', async ({ page }) => {
        // This lane settles against the PRICE v1 feed ORACLE_ADDRESS
        // published, and the 2026-08-24 re-genesis removed it. Ask the venue
        // BEFORE any UI work: without the feed there is nothing here to measure,
        // and the failure would otherwise arrive many screens later reading like
        // a wallet defect. It heals itself the day somebody re-plants a feed.
        const feedGap = await plantedOracleFeedRefusal(ORACLE_ADDRESS);
        test.skip(!!feedGap, `the venue has no planted oracle feed: ${feedGap}`);

        let seller;
        let buyer;
        let dispenserIndex;
        let coinUsd;
        let oracleValue;
        let feeSats;
        let oracleReceivedBefore;
        /** Coin the buyer must pay for exactly one fill, at the published price. */
        let payPerFill;

        await test.step('the feed has matured and its fee is ABOVE dust, or nothing below proves anything', async () => {
            // Order matters: seed first, then quote. The quote's coin value is a
            // function of the venue's LTC/USD, and it is the seeded price that
            // lifts the fee over the dust floor.
            await seedPrices();
            coinUsd = await venueCoinUsdPrice();

            const row = await oracleRow();
            oracleValue = Number(row.value);
            expect(oracleValue > 0, `the oracle publishes a nonsense price: ${row.value}`).toBe(true);

            const chainNow = Number((await explorerJson('status').catch(() => ({})))?.block_time ?? 0);
            const quote = await oracleFeeQuote(ESCROW);

            // The 24h wall, named explicitly. Without this the failure below
            // reads as a broken dispenser rather than "come back later".
            expect(quote?.valid,
                `the oracle feed has not matured on CHAIN time yet (effective_at ${row.effective_at}, `
                + `chain block_time ${chainNow || 'unknown'}): every PRICE v1 publish is inert for 24h `
                + `and the venue clock runs behind the wall clock, so this lane is not runnable yet. `
                + `Quote said: ${JSON.stringify(quote)}`)
                .toBe(true);

            // THE GUARD. Below dust the wallet attaches no output at all and the
            // closing assertion would be measuring nothing.
            expect(quote.belowDust,
                `the oracle usage fee quotes BELOW DUST (${quote.requiredFeeSats} sats) at the `
                + `venue's current $${coinUsd} ${REGTEST_COIN.slice(1)}/USD. applyOracleFeePreflight `
                + 'appends no output in that branch, so this run would go green without ever paying '
                + 'the oracle. The price seed is what lifts it over the floor: re-seed (campaign '
                + '§3.2) and re-run rather than trusting this pass')
                .toBe(false);

            feeSats = Number(quote.requiredFeeSats);
            expect(feeSats > 0, 'the oracle quote carries no fee to pay').toBe(true);
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
            await waitForBalanceAtLeast(seller, 'XCHAIN', MINT);

            // Read the oracle's takings immediately before composing, so the
            // delta below cannot be inflated by anything that happened earlier
            // in this venue's life.
            oracleReceivedBefore = await nativeReceivedSats(ORACLE_ADDRESS);

            await gotoPalette(page, 'Create dispenser');
            main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            await main.getByRole('button', { name: /^Token/ }).click();
            await page.getByText('XCHAIN', { exact: true }).first().click();

            await main.getByLabel('Give amount (per fill)').fill(String(GIVE_PER_FILL));
            await main.getByLabel('Escrow amount').fill(String(ESCROW));

            // The lane under test. Fiat code AND an oracle address, with the
            // fiat amount left EMPTY: that combination is what selects the
            // user-oracle path over the validator one (DispenserForm.jsx:493).
            await main.getByRole('button', { name: /Advanced options/ }).click();
            await main.getByLabel('Priced in fiat (optional)').selectOption(FIAT_CODE);
            await main.getByLabel(/^Oracle address/).fill(ORACLE_ADDRESS);
            await expect(main.getByLabel(/^Fiat amount/),
                'the fiat amount must stay empty, or this composes the Mode A validator path')
                .toHaveValue('');

            await main.getByRole('button', { name: /^(Create|Preview)$/ }).click();
            await expectConfirmModal(page);
            const created = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(created.action)).toBe('DISPENSER');
            expect(String(created.status), 'the chain rejected the user-oracle dispenser')
                .toBe('valid');
            dispenserIndex = String(created.action_index);

            expect(String(created.oracle_address),
                'the dispenser was not stored against the oracle, so the wallet dropped '
                + 'ORACLE_ADDRESS and this is an ordinary validator-priced dispenser')
                .toBe(ORACLE_ADDRESS);
            expect(String(created.fiat_code)).toBe(FIAT_CODE);
            // Same convention as Mode A: no coin price is stored, because it
            // does not exist until settlement.
            expect(Number(created.get_amount),
                'an oracle-priced dispenser stored a coin price, so it is not oracle-priced')
                .toBe(0);

            expect(await waitForBalanceChange(seller, 'XCHAIN', MINT),
                `opening the dispenser did not escrow ${ESCROW} XCHAIN`)
                .toBe(MINT - ESCROW);
        });

        await test.step('THE ORACLE WAS ACTUALLY PAID, measured at its own address', async () => {
            // The payoff. Not the wallet's preview text and not the quote: the
            // oracle's own on-chain receipts, which is the only place an
            // unattached output cannot hide.
            const after = await waitForNativeReceivedAbove(ORACLE_ADDRESS, oracleReceivedBefore);
            const delta = after - oracleReceivedBefore;
            expect(delta,
                `the oracle address received ${delta} sats from the dispenser-create transaction `
                + `but quoted ${feeSats}. A zero here means applyOracleFeePreflight attached no `
                + 'usage-fee output at all, which is the exact silent failure this item exists to '
                + 'catch; a mismatch means it attached one of the wrong size')
                .toBe(feeSats);
        });

        await test.step('the BUYER pays, and the ORACLE\'s price decides the fill count', async () => {
            // fills = floor((coin_paid x coin/USD) / (GIVE_PER_FILL x oracle.value)).
            // Round the coin amount UP to the chain's 8 places: rounding down
            // buys zero fills and reads as a dispenser that ignored payment.
            const usdPerFill = GIVE_PER_FILL * oracleValue;
            payPerFill = (Math.ceil((usdPerFill / coinUsd) * 1e8) / 1e8).toFixed(8);
            expect(Math.floor((Number(payPerFill) * coinUsd) / usdPerFill),
                'the payment this spec sized does not buy exactly one fill, so the assertion '
                + 'below would not mean what it says')
                .toBe(1);

            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: 'Add Wallet' }).click();
            await createWallet(page, { password: PASSWORD, name: 'Oracle Buyer', navigate: false });
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: /Oracle Buyer/ }).first().click();
            await expect(page.getByRole('button', { name: /Oracle Buyer/ }).first(),
                'the app did not switch to the newly added wallet')
                .toBeVisible({ timeout: 30_000 });

            // Chain-scoped address reader: Receive answers for the ACTIVE chain,
            // and a wallet added mid-session sits on whichever chain the app
            // lists first, which is Bitcoin on a Litecoin run.
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

            await gotoPalette(page, 'Send');
            const main = page.getByRole('main');
            const coin = REGTEST_COIN.slice(1);
            await page.getByRole('button', { name: /Change asset/ }).click();
            await page.getByLabel('Search coins or tokens').fill(coin);
            await page.getByLabel(new RegExp(`Open ${REGTEST_CHAIN_LABEL} details`, 'i'))
                .first().click();
            await expect(main.getByRole('textbox', { name: new RegExp(`^Amount \\(${coin}\\)`) }),
                `the Send form is composing on the wrong chain: no ${coin} amount field`)
                .toBeVisible({ timeout: 30_000 });

            await page.getByLabel('To', { exact: true }).fill(seller);
            await page.getByRole('textbox', { name: /^Amount/ }).fill(payPerFill);
            await main.getByRole('button', { name: 'Send', exact: true }).click();
            await expectConfirmModal(page, 'this action', 60_000);
            await page.getByTestId('confirm-approve').click();
            await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
                .toBeVisible({ timeout: 180_000 });
        });

        await test.step('the chain settles at the ORACLE price, not the validator one', async () => {
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
                `the buyer paid ${payPerFill} ${REGTEST_COIN.slice(1)} to a user-oracle dispenser `
                + 'and no DISPENSE was ever recorded, so they paid and received nothing')
                .toBeTruthy();
            expect(String(dispense.status), 'the chain rejected the dispense').toBe('valid');

            expect(await waitForBalanceAtLeast(buyer, 'XCHAIN', GIVE_PER_FILL),
                `the buyer paid the price of ONE fill at the ORACLE's published $${oracleValue} `
                + 'and was credited a different number, so the chain settled this from a price '
                + 'other than the oracle row the dispenser names')
                .toBe(GIVE_PER_FILL);

            const detail = await explorerJson(`action/${dispenserIndex}`);
            expect(Number(detail?.state?.give_remaining ?? detail?.give_remaining),
                'the dispenser escrow did not fall by exactly one fill')
                .toBe(ESCROW - GIVE_PER_FILL);
        });
    });
});
