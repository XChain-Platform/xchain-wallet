// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §11.5's last leg: the Approve-time re-quote, driven by a price
// that differs between compose and Approve under an open confirm screen.
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
// This spec is the proof that the wallet re-checks the AMOUNT at Approve and
// refuses, instead of broadcasting the PSBT it already built.
//
// THE MOVE IS ENGINEERED AT COMPOSE, AND APPROVE READS THE VENUE AS IT IS. The
// venue's hub prices the coin from its own oracle, and the e2e price seed
// stands aside for a live oracle (priceSeed.js), so the venue's price cannot be
// moved from here. Instead the wallet composes while every native-fee quote it
// fetches is the venue's own answer valued at TWICE the coin price: half the
// sats, half the band. Once Approve is live the rewrite is removed, so the
// Approve-time re-quote reaches the venue's real oracle, which asks for about
// double what the composed transaction pays - the `short` verdict the money
// depends on, judged against the fee the hub actually quotes. Nothing is
// written to the venue, so there is nothing to restore.

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import {
    encoderRpc,
    expectConfirmModal,
    EXPLORER_URL,
    fundAddress,
    minerRpc,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    REGTEST_TICKER,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
} from '../../fixtures/regtest.js';
import { feeQuoteAtCoinPriceFactor } from '../../fixtures/feeQuoteAtPrice.js';
import { EXPLORER_RATE_LIMIT_DEFAULTS } from '../../../../packages/core/src/sdk/explorerRateLimit.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 100;
const SUPPLY = '1000';
const TICK = `RQT${Date.now().toString().slice(-6)}`;

// The coin price the compose-time quotes are valued at, as a multiple of the
// venue's own. Doubling it halves the fee, so the venue's real quote at Approve
// asks for twice what the composed transaction pays.
const COMPOSE_PRICE_FACTOR = 2;

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
 * Serves the venue's own native-fee quotes valued at COMPOSE_PRICE_FACTOR times
 * its coin price until the returned `release` is called.
 *
 * Identity fields pass through untouched (feeQuoteAtCoinPriceFactor), so the
 * composed transaction and the Approve-time re-quote stay comparable.
 *
 * `release` also outlasts the wallet's read reuse window: a GET answered that
 * recently is served again instead of re-sent, so an Approve inside it would
 * re-quote against the answer this route served rather than the venue.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ served: () => number | null, release: () => Promise<void> }>}
 */
async function holdComposeQuotesAtHigherPrice(page) {
    const pattern = `${EXPLORER_URL}/${REGTEST_COIN}/api/feequote**`;
    let lastServedSats = null;
    let lastServedAt = 0;
    const handler = async (route) => {
        const response = await route.fetch();
        const revalued = feeQuoteAtCoinPriceFactor(
            await response.json().catch(() => null), COMPOSE_PRICE_FACTOR);
        if (!revalued) {
            await route.fulfill({ response });
            return;
        }
        lastServedSats = Number(revalued.requiredFeeSats);
        lastServedAt = Date.now();
        await route.fulfill({ response, json: revalued });
    };
    await page.route(pattern, handler);
    return {
        served: () => lastServedSats,
        release: async () => {
            await page.unroute(pattern, handler);
            await expect.poll(() => Date.now() - lastServedAt, {
                message: 'the compose-time quote is still inside the wallet\'s read reuse window',
                timeout: EXPLORER_RATE_LIMIT_DEFAULTS.reuseMs * 5,
            }).toBeGreaterThan(EXPLORER_RATE_LIMIT_DEFAULTS.reuseMs * 2);
        },
    };
}

function feeToggle(scope) {
    const name = /^Pay protocol fee in .* instead of XCHAIN/;
    return scope.getByRole('switch', { name }).or(scope.getByRole('checkbox', { name })).first();
}

async function enableNativeFee(scope) {
    const toggle = feeToggle(scope);
    if (REGTEST_COIN === 'RBTC') {
        await expect(toggle, 'Bitcoin did not offer its native-fee choice')
            .toBeVisible({ timeout: 30_000 });
        if (!(await toggle.isChecked())) await toggle.click();
        await expect(toggle).toBeChecked();
        return;
    }
    await expect(toggle,
        `${REGTEST_TICKER} exposed an opt-in even though its native-fee lane is mandatory`)
        .toHaveCount(0);
}

test.describe(`§11.5: the protocol fee moving on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('a fee that went short between compose and Approve is refused, not broadcast', async ({ page }) => {
        const params = `${TICK}|${SUPPLY}|0|0|0`;
        let source;
        let composedSats;
        let composeQuotes;

        await test.step('onboard, fund, and record what the fee costs now', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Requote Wallet' });
            await switchToRegtest(page, PASSWORD);

            await openPaletteCommand(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            source = await main.getByLabel('From').inputValue();
            expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, 10);
            await waitForTokenBalance(source, 'XCHAIN', 10, 1_200_000);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            const q = await feeQuoteSats(params);
            expect(q.valid, `the venue cannot price this action (${q.status})`).toBe(true);
            expect(q.sats, 'the quoted fee is not a positive number of sats').toBeGreaterThan(0);
        });

        await test.step('compose at the higher coin price and hold the confirm screen', async () => {
            composeQuotes = await holdComposeQuotesAtHigherPrice(page);
            // The funding step reloads to pick the balance up, which unmounts the
            // route back to Home - so the form has to be re-opened, not reused.
            await openPaletteCommand(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Ticker').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);
            await enableNativeFee(main);

            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmModal(page, 'this action', 120_000);
            // Approve must be LIVE first: if it were already blocked, the refusal
            // below would prove nothing about the re-quote.
            await expect(page.getByTestId('confirm-approve'),
                'Approve was not enabled before the price moved, so this run cannot attribute the refusal')
                .toBeEnabled({ timeout: 120_000 });
            composedSats = composeQuotes.served();
            expect(composedSats, 'the compose never fetched a native-fee quote, so nothing was priced')
                .toBeGreaterThan(0);
        });

        await test.step('the coin price falls back to the venue\'s own under the open screen', async () => {
            await composeQuotes.release();
            const after = await feeQuoteSats(params);
            expect(after.valid, `the venue cannot price this action at Approve (${after.status})`).toBe(true);
            // eslint-disable-next-line no-console
            console.log(`[§11.5 requote] fee ${composedSats} -> ${after.sats} sats `
                + `(composed pays ${composedSats}, the venue quotes ${after.sats})`);
            expect(after.sats,
                'the venue does not ask for more than the composed fee, so the band was never crossed '
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
                'the wallet did not say the fee moved; before it would have broadcast the'
                + 'already-built transaction, forfeiting the short fee')
                .toBeVisible({ timeout: 120_000 });
            await expect(page.getByText(/nothing was signed or sent/i),
                'the refusal does not tell the user nothing was spent')
                .toBeVisible();

            expect(await mempoolSize(),
                'a transaction was broadcast despite the refusal - this is the forfeiture exists'
                + 'to prevent').toBe(0);
            expect(await coinBalanceSats(source),
                'the payer\'s balance moved, so a miner fee was paid for an action the wallet refused')
                .toBe(before);
        });
    });
});
