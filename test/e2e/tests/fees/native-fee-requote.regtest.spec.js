// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §11.5's last leg: the  Approve-time re-quote, driven by
// actually moving the price out from under an open confirm screen.
//
// WHY THIS IS THE EXPENSIVE ONE. A native-coin protocol fee is a REAL output,
// sized at COMPOSE from the indexer's quote, and FORFEITED when the action is
// rejected. The size the chain requires moves INVERSELY with the coin's USD
// price, and consensus accepts an output only at or above `minAcceptable`
// (0.95x expected). So an adverse move of a little over 5% between composing
// and pressing Approve turns the attached output into a short one - the
// transaction is broadcast, the miner fee is paid, the action indexes invalid,
// and the protocol fee is kept. A confirm screen left open while the user
// checks something else is the ordinary way to get there.
//
// Before  the wallet re-ran its per-block pre-flight ("Checked at block
// N") but never re-checked the AMOUNT, so it broadcast the PSBT it had already
// built. This spec is the proof that it now refuses instead.
//
// THE MOVE IS ENGINEERED, NOT WAITED FOR, and the arithmetic is the whole test:
// at BTC/USD $100,000 an ISSUE's fee quotes 2,000 sats. Halving the price to
// $50,000 doubles the requirement to 4,000, whose `minAcceptable` is 3,800. The
// composed transaction pays 2,000, which is below it - verdict `short`, the one
// the money depends on.
//
// TWO VENUE FACTS THIS RUN DEPENDS ON, both learned the hard way elsewhere in
// this campaign:
//   - The indexer MEMOIZES its verdict per block height , so a re-quote
//     at the same height replays the old answer and reads exactly like "the
//     re-price did not work". Mine after writing.
//   - `seedPrices()` deliberately refuses to write over a venue that already
//     prices, which is right for setup and useless here, so this spec writes
//     the rows itself through the same credential-free `runInIndexer` path.
//
// The price is restored at the end. It is a shared venue.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    encoderRpc,
    runInIndexer,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';
import { VENUE_PRICE, SYNTHETIC_ROUNDS, writeRowsScript } from '../../fixtures/priceSeed.js';

const PASSWORD = 'regtestpassword123';
const SUPPLY = '1000';
const TICK = `RQT${Date.now().toString().slice(-6)}`;

// Half the fixture's price, so the fee requirement doubles. Chosen as a factor
// rather than an absolute so this keeps meaning the same thing if the fixture's
// price is ever retuned.
const HALVED = (base) => (Number(base) / 2).toFixed(8);

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

async function feeQuoteSats(params) {
    const q = new URLSearchParams({ action: 'ISSUE', params });
    const quote = await explorerJson(`feequote?${q.toString()}`);
    return { sats: Number(quote?.requiredFeeSats), valid: quote?.valid === true, status: quote?.status };
}

async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
}

async function mempoolSize() {
    const status = await minerRpc('status', {});
    return Number(status?.mempool_size ?? -1);
}

/**
 * Re-prices the venue's coin pair, then mines until the public read agrees.
 *
 * Every round the venue already carries for the pair is rewritten, not just the
 * highest: selection is `ORDER BY round_number DESC`, so leaving a higher row
 * behind would leave the old price winning and the spec would silently prove
 * nothing. Only rounds the tree mints synthetically are touched.
 */
async function reprice(coinPair, price, quoteParams) {
    const wallTime = Math.floor(Date.now() / 1000);
    const rows = SYNTHETIC_ROUNDS.map((roundNumber) => ({
        coinPair, price, roundNumber, blockTimestamp: wallTime,
    }));
    await runInIndexer(writeRowsScript(rows));

    // The verdict is memoized per block height, so a new block is what makes
    // the new price observable at all.
    for (let i = 0; i < 6; i++) {
        await minerRpc('generate_blocks', { count: 1 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 2_500));
        const q = await feeQuoteSats(quoteParams);
        if (q.valid) return q;
    }
    throw new Error(`re-pricing ${coinPair} to ${price} never became visible to /feequote`);
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

function feeToggle(scope) {
    const name = /^Pay protocol fee in BTC instead of XCHAIN/;
    return scope.getByRole('switch', { name }).or(scope.getByRole('checkbox', { name })).first();
}

test.describe('§11.5: the protocol fee moving while the confirm screen is open', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('a fee that went short between compose and Approve is refused, not broadcast', async ({ page }) => {
        const venue = VENUE_PRICE[REGTEST_COIN];
        test.skip(!venue, `no fixture price for ${REGTEST_COIN}`);
        const params = `${TICK}|${SUPPLY}|0|0|0`;
        let source;
        let composedSats;

        await test.step('onboard, fund, and record what the fee costs now', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Requote Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            source = await main.getByLabel('From').inputValue();
            expect(source, 'the form has no Bitcoin address to sign with').toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(source, 1);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            const q = await feeQuoteSats(params);
            expect(q.valid, `the venue cannot price this action (${q.status})`).toBe(true);
            composedSats = q.sats;
            expect(composedSats, 'the quoted fee is not a positive number of sats').toBeGreaterThan(0);
        });

        await test.step('compose with the coin fee attached and hold the confirm screen', async () => {
            // The funding step reloads to pick the balance up, which unmounts the
            // route back to Home - so the form has to be re-opened, not reused.
            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Ticker').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);
            const toggle = feeToggle(main);
            await expect(toggle, 'Bitcoin does not offer the fee choice this spec is about')
                .toBeVisible({ timeout: 30_000 });
            if (!(await toggle.isChecked())) await toggle.click();
            await expect(toggle).toBeChecked();

            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 120_000 });
            // Approve must be LIVE first: if it were already blocked, the refusal
            // below would prove nothing about the re-quote.
            await expect(page.getByTestId('confirm-approve'),
                'Approve was not enabled before the price moved, so this run cannot attribute the refusal')
                .toBeEnabled({ timeout: 120_000 });
        });

        await test.step('halve the coin price under the open screen', async () => {
            const halved = HALVED(venue.price);
            const after = await reprice(venue.coinPair, halved, params);
            // eslint-disable-next-line no-console
            console.log(`[§11.5 requote] ${venue.coinPair} ${venue.price} -> ${halved}: `
                + `fee ${composedSats} -> ${after.sats} sats (composed pays ${composedSats})`);
            expect(after.sats,
                'halving the coin price did not raise the required fee, so the band was never crossed '
                + 'and this run would pass for the wrong reason')
                .toBeGreaterThan(composedSats);
            // The refusal only bites BELOW minAcceptable (0.95x), so state the
            // margin rather than trusting "bigger is enough".
            expect(composedSats,
                'the composed fee is still inside the new acceptance band, so nothing should refuse')
                .toBeLessThan(Math.ceil(after.sats * 0.95));
        });

        await test.step('Approve is refused, and nothing reaches the chain', async () => {
            const before = await coinBalanceSats(source);
            await page.getByTestId('confirm-approve').click();

            await expect(page.getByText(/protocol fee changed while this was on screen/i),
                'the wallet did not say the fee moved; before  it would have broadcast the '
                + 'already-built transaction, forfeiting the short fee')
                .toBeVisible({ timeout: 120_000 });
            await expect(page.getByText(/nothing was signed or sent/i),
                'the refusal does not tell the user nothing was spent')
                .toBeVisible();

            expect(await mempoolSize(),
                'a transaction was broadcast despite the refusal - this is the forfeiture  exists '
                + 'to prevent').toBe(0);
            expect(await coinBalanceSats(source),
                'the payer\'s balance moved, so a miner fee was paid for an action the wallet refused')
                .toBe(before);
        });

        await test.step('put the venue price back', async () => {
            await reprice(venue.coinPair, Number(venue.price).toFixed(8), params);
        });
    });
});
