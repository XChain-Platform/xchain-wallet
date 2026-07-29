// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §10.2's fee check, which §10.2 states in its own words: "Two
// independent projections are on trial here, and Session 19 has already shown
// one of them wrong for ISSUE."
//
// THREE NUMBERS, AND THE CHAIN DECIDES. Opening a market is the one authoring
// flow whose fee the wallet computes CLIENT-SIDE as well as quoting: the form
// prints "Opening this market costs about N XCHAIN" from
// `projectBetFeedCreateFee` (a duration price over the market's whole
// pass-eligible life, `deadline + refundWindow - blockTime`, half-up days, the
// first 90 free at 550 gas/day), while the confirm screen projects the coin fee
// from `/feequote`, and the chain then charges what it charges. Any two of
// those three agreeing while the third differs is a defect, and only the third
// is authoritative.
//
// DRIVEN OFF BITCOIN on purpose, and it is not the usual reason. Here 
// makes the coin output the only way to pay, so the create fee is a REAL
// on-chain payment that shows up in the payer's balance to the satoshi; on
// Bitcoin the default lane debits an XCHAIN balance, which is a different (and
// currently unmeasurable - §3.7) measurement.
//
//   LEG 1, THE FREE MARKET, which is the ordinary case and the one  was
//     about: a market whose whole life fits inside the 90 free days costs
//     nothing. The form must say so, the confirm screen must state no protocol
//     fee and project no fee row, and the chain must charge only the miner. A
//     zero fee is not a small fee: `applyNativeFeePreflight` guards on
//     `feeSats > 0`, so a zero quote must attach NO output at all - and on this
//     chain a zero-value output or a spurious dust refusal (5,460 sats here)
//     would both show up in that balance.
//
//   LEG 2, THE PRICED MARKET, which nothing had ever driven: push the deadline
//     past the free window and the same form charges. The form's XCHAIN figure,
//     converted at the venue's own oracle prices, must agree with the coin fee
//     the confirm screen projects; the chain's fee record must carry exactly
//     that coin amount; and the payer's satoshis must fall by exactly
//     `network fee + protocol fee`.
//
// The refund window is left at its default in BOTH legs, so the deadline is the
// only variable between free and priced - a market's life includes that window,
// which is a real cost hiding in a field users read as a safety margin.

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
    unlockAfterReload,
    waitForTokenBalance,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const MINT_XCHAIN = 1000;
const RUN_TAG = `FEEQ${Date.now().toString().slice(-6)}`;
const COIN = REGTEST_COIN.replace(/^R/, '');
/** Comfortably inside the 90 free days, including the 14-day default window. */
const FREE_DAYS_OUT = 2;
/** Past the free window by enough that a one-day rounding argument cannot explain the fee. */
const PRICED_DAYS_OUT = 120;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * The chain's own clock, which is what DEADLINE is compared against - never
 * wall clock, since a regtest chain's clock can sit hours away from it (§3.2).
 *
 * Walks back from the tip rather than reading one field: `/api/status` carries
 * no timestamp, and the newest block is not always parsed yet. Borrowed
 * verbatim from `bet-roundtrip.regtest.spec.js`, which already paid for it.
 */
async function chainTime() {
    const status = await explorerJson('status');
    const tip = Number(status?.chain_tip?.[REGTEST_COIN]);
    if (!Number.isFinite(tip)) throw new Error(`explorer reports no ${REGTEST_COIN} tip`);
    for (let h = tip; h > tip - 10 && h > 0; h--) {
        const block = await explorerJson(`block/${h}`);
        const ts = Number(block?.timestamp);
        if (Number.isFinite(ts) && ts > 0) return ts;
    }
    throw new Error(`no parsed block with a timestamp within 10 blocks of tip ${tip}`);
}

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

/** The market this run created, read off the chain rather than the screen. */
async function waitForFeed(oracle, labelPart, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson(`bet_feeds/${oracle}/source`);
        const feed = (list?.data || []).find((f) => String(f.label).includes(labelPart));
        if (feed) return feed;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(
        `no market labelled *${labelPart}* landed for ${oracle} within `
        + `${Math.round(timeoutMs / 1000)}s. Decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}: a non-zero lag means the venue is behind, `
        + 'not that the wallet sent something wrong.');
}

/** The fee record the chain wrote for an action index, or null. */
async function actionFee(actionIndex) {
    const detail = await explorerJson(`action/${actionIndex}`);
    expect(String(detail?.status), `action ${actionIndex} did not index valid`).toBe('valid');
    return detail.fee || null;
}

async function screenNetworkFeeSats(page) {
    const text = await page.getByTestId('confirm-fee').innerText();
    const coin = Number(text.match(new RegExp(`([\\d.]+)\\s*${COIN}`))?.[1]);
    expect(Number.isFinite(coin), `unparseable network fee line: ${text}`).toBe(true);
    return Math.round(coin * 1e8);
}

async function projectedProtocolFeeSats(page) {
    const deltas = page.getByTestId('action-intent-deltas');
    if (await deltas.count() === 0) return null;
    const text = await deltas.innerText();
    const coin = text.match(new RegExp(`Protocol fee\\s*${COIN}\\s*([\\d.]+)`))?.[1];
    return coin === undefined ? null : Math.round(Number(coin) * 1e8);
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

function toLocalDateTimeInput(unixSec) {
    const d = new Date(unixSec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Fills the create-market form for a market closing `daysOut` from the CHAIN's
 * clock and opens the confirm screen. Returns the form's own cost sentence.
 *
 * The refund window is left at its default deliberately (see the header): the
 * deadline is the only thing that differs between the two legs.
 */
async function composeMarket(page, { label, daysOut }) {
    await gotoPalette(page, 'Betting');
    await page.getByRole('button', { name: 'Create market', exact: true }).click();
    const main = page.getByRole('main');

    // Every surface has its own chain picker and they default to Bitcoin
    // (§3.5): the hub's, the form's, and the add-address modal's are three
    // different controls.
    await selectVenueChain(main);

    // The wager tick is a picker, not free text, so it can only offer something
    // this address holds. Rows declare role="listitem", hence the data key.
    const tokenField = main.getByRole('button', { name: /^Token bets are placed in:/ });
    await expect(tokenField).toBeVisible({ timeout: 30_000 });
    await tokenField.click();
    await page.locator('[data-balance-key$=":XCHAIN"]').first().click();

    await main.getByLabel('What is being bet on').fill(label);
    await main.getByLabel('Outcome 0').fill('Yes');
    await main.getByLabel('Outcome 1').fill('No');

    const now = await chainTime();
    await main.getByLabel('Betting closes').fill(toLocalDateTimeInput(now + daysOut * 86_400));

    // The form's OWN projection, the first of the three numbers. Read before
    // submitting, because it is a property of the form rather than of the
    // composed transaction.
    const quoteText = await main.getByText(/Opening this market (is free|costs about)/)
        .first().innerText();

    const password = main.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    await main.getByRole('button', { name: 'Review market', exact: true }).click();

    await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    return quoteText;
}

async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

test.describe(`what opening a market costs on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test.beforeAll(() => {
        test.skip(REGTEST_COIN === 'RBTC',
            'the create fee is measured where  forces the coin lane, so it lands in the payer '
            + 'balance; run with XC_REGTEST_COIN=RLTC or RDOGE');
    });

    test('a free market charges nothing and a long one charges exactly what all three projections say', async ({ page }) => {
        let oracle;
        let xchainUsd;
        let coinUsd;

        await test.step('onboard, fund, and hold the wager token', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Market Fee Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Betting');
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            const main = page.getByRole('main');
            await selectVenueChain(main);
            oracle = await main.getByLabel('Your oracle address').inputValue();
            expect(oracle, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(oracle, FUNDING);

            // LEAVE THIS FORM FIRST. `mintXchain` opens the command palette
            // with `getByRole('combobox').first()`, and the create-market form
            // carries its own <select> ("Time to publish the result"), which is
            // the first combobox on the page - so the fixture tries to type
            // into that instead and fails with "Element is not an <input>".
            // Cost a run.
            await gotoPalette(page, 'Home');

            // XCHAIN is the WAGER tick here, not the fee: on this chain the fee
            // is paid in coin whatever the market is denominated in. It is
            // free-mintable on regtest, so it saves issuing a throwaway token.
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(oracle, 'XCHAIN', MINT_XCHAIN);
            // The chain holding the balance is not the wallet knowing it:
            // balances are fetched per chain on mount, and the token picker
            // only offers what it knows about.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // The venue's own prices, used below to convert the form's XCHAIN
            // figure into coin. Taken from a quote rather than assumed, because
            // §3.2 means a venue can be re-priced between sessions.
            const q = await explorerJson('feequote?action=ISSUE&params=FEEQPROBE|1000|0|0|0');
            expect(q?.valid, `the venue cannot price anything right now (${q?.status}); see §3.2`)
                .toBe(true);
            xchainUsd = Number(q.xchainUsdPrice);
            coinUsd = Number(q.coinUsdPrice);
            expect(xchainUsd, 'no XCHAIN/USD price on the venue').toBeGreaterThan(0);
            expect(coinUsd, `no ${COIN}/USD price on the venue`).toBeGreaterThan(0);
        });

        await test.step('LEG 1: a short market is free, on the screen and on the chain', async () => {
            const label = `${RUN_TAG} free`;
            const quoteText = await composeMarket(page, { label, daysOut: FREE_DAYS_OUT });
            // The form's own arithmetic: inside the free window, so it must say
            // free outright rather than hedge.
            expect(quoteText,
                'the form does not say a short market is free, so its client-side day count disagrees '
                + 'with the 90-free-days rule')
                .toMatch(/Opening this market is free/);

            await expect(page.getByTestId('confirm-protocol-fee'),
                'the confirm screen states a protocol fee for a market that costs nothing')
                .toHaveCount(0);
            expect(await projectedProtocolFeeSats(page),
                'the projection carries a protocol-fee row for a fee of zero')
                .toBeNull();

            const minerSats = await screenNetworkFeeSats(page);
            const satsBefore = await coinBalanceSats(oracle);
            const txid = await approveAndGetTxid(page);
            expect(txid, 'the free market never broadcast').toBeTruthy();

            const feed = await waitForFeed(oracle, label);
            expect(feed.source, 'the market is owned by the funded oracle address').toBe(oracle);
            const fee = await actionFee(feed.action_index);
            expect(Number(fee?.native_coin_amount || 0),
                'the chain recorded a coin fee for a market inside the free window')
                .toBe(0);

            // A zero quote must attach NO output, which is visible here whether
            // or not any screen mentioned it.
            const satsAfter = await coinBalanceSats(oracle);
            expect(satsBefore - satsAfter,
                `the free market cost ${satsBefore - satsAfter} sats against a network fee of `
                + `${minerSats}, so it paid a protocol fee nothing quoted`)
                .toBe(minerSats);
        });

        await test.step('LEG 2: a long market charges, and all three numbers agree', async () => {
            const label = `${RUN_TAG} priced`;
            const quoteText = await composeMarket(page, { label, daysOut: PRICED_DAYS_OUT });

            // NUMBER 1, the form's client-side projection.
            const formXchain = Number(quoteText.match(/costs about ([\d.]+) XCHAIN/)?.[1]);
            expect(Number.isFinite(formXchain) && formXchain > 0,
                `the form says a ${PRICED_DAYS_OUT}-day market is free or unpriced: "${quoteText}"`)
                .toBe(true);

            // NUMBER 2, the coin fee the confirm screen projects, which is what
            // the composed transaction actually carries.
            await expect(page.getByTestId('confirm-protocol-fee'),
                'the coin-fee lane also states an XCHAIN protocol fee, which reads as a second charge')
                .toHaveCount(0);
            const minerSats = await screenNetworkFeeSats(page);
            const projectedFeeSats = await projectedProtocolFeeSats(page);
            expect(projectedFeeSats,
                'the balance projection carries no protocol-fee row, so the screen shows the miner fee '
                + 'as the whole cost of opening a priced market')
                .toBeGreaterThan(0);

            // 1 against 2, converted through the venue's own oracle prices. A
            // few sats of slack for the 8dp rounding on each side, and no more:
            // this is the check that would catch a form quoting a different
            // duration from the one the transaction was priced for.
            const expectedFromForm = Math.round((formXchain * xchainUsd / coinUsd) * 1e8);
            expect(Math.abs(projectedFeeSats - expectedFromForm),
                `the form's ${formXchain} XCHAIN converts to ${expectedFromForm} sats at the venue's `
                + `prices (XCHAIN $${xchainUsd} / ${COIN} $${coinUsd}), but the transaction carries `
                + `${projectedFeeSats}`)
                .toBeLessThanOrEqual(2);

            // NUMBER 3, the chain, which is the only authoritative one.
            const satsBefore = await coinBalanceSats(oracle);
            const txid = await approveAndGetTxid(page);
            expect(txid, 'the priced market never broadcast').toBeTruthy();

            const feed = await waitForFeed(oracle, label);
            expect(feed.source).toBe(oracle);
            const fee = await actionFee(feed.action_index);
            expect(Number(fee?.payment_mode),
                'the market recorded an XCHAIN fee on a chain with no XCHAIN fee lane')
                .toBe(1);
            expect(Math.round(Number(fee?.native_coin_amount) * 1e8),
                `the chain charged a different coin fee from the ${projectedFeeSats} sats projected`)
                .toBe(projectedFeeSats);

            const satsAfter = await coinBalanceSats(oracle);
            expect(satsBefore - satsAfter,
                `the screen projected ${minerSats + projectedFeeSats} sats (network ${minerSats} + `
                + `protocol ${projectedFeeSats}); the chain charged ${satsBefore - satsAfter}`)
                .toBe(minerSats + projectedFeeSats);
        });
    });
});
