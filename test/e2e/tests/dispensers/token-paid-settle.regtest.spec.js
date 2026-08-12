// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Dispensers": the SETTLED token-paid buy - a buyer
// paying a dispenser in a TOKEN and being credited the goods on chain.
//
// THIS HAS BEEN ⬜ SINCE SESSION 12, and for a reason that has since gone away.
// That session got the whole surface reachable and broadcast a real buy, but the
// fill indexed `invalid: insufficient funds`: the venue could not mint a second
// token for the buyer to pay with, because ISSUE needs a BTC/USD oracle price the
// Bitcoin regtest feed did not have. Litecoin regtest IS priced (§3.2 sentinel),
// so the buyer can now issue their own payment token and the lane can finally be
// settled rather than merely attempted.
//
// WHAT MAKES IT WORTH THE RUNTIME. Every other dispenser leg proven so far moves
// value in ONE direction: the owner escrows (create/refill), or the owner takes it
// back (close). A settled token-paid fill is the only one where value crosses in
// BOTH directions in a single action - the buyer's payment token to the seller,
// the seller's escrowed token to the buyer - and neither side is a fee. It is also
// the only dispenser lane that exercises a SECOND wallet as the counterparty.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dispensers/token-paid-settle.regtest.spec.js

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
/** ISSUE pays a real coin fee on this chain. */
const FUNDING = 2;
const STAMP = Date.now().toString().slice(-6);
/** What the buyer pays WITH: their own token, issued in this run. */
const PAY_TICK = `PAY${STAMP}`;
const PAY_SUPPLY = 1000;
/** What the dispenser sells: XCHAIN, free-mintable on regtest. */
const MINT = 1000;
const GIVE_PER_FILL = 25;
const ESCROW = 100;
const PRICE_PER_FILL = 5;

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
        const list = await explorerJson('actions?limit=100');
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

/**
 * Waits for a token balance to STOP being `from` and returns what it became.
 * The explorer serves an action's row before that action's effect on the
 * balance view, so a single read at index time can still show the old figure
 * (the lesson `order-lifecycle.regtest.spec.js` paid for).
 */
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

/**
 * Waits for the confirm screen, naming a stale price sentinel for what it is.
 *
 * This spec is long (two wallets, two ISSUEs, a dispenser and a buy), and a
 * seed lasts about 1800s of real time on a venue whose chain clock tracks wall
 * clock (campaign 3.2, Session 19 addendum). Without this an aged-out sentinel
 * presents as a confirm screen that never opens, which reads exactly like a
 * wallet regression and cost this spec its first run.
 */
async function expectConfirmModal(page) {
    const modal = page.getByTestId('confirm-modal');
    const priceAlert = page.getByText(/fee price is temporarily unavailable/);
    await modal.or(priceAlert).first().waitFor({ state: 'visible', timeout: 60_000 });
    expect(await priceAlert.count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. Venue '
        + 'state, not a wallet defect - re-seed (campaign 3.2) and re-run')
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

/** Issues `tick` with `supply` from the wallet currently active. */
async function issueToken(page, tick, supply) {
    await seedPrices();
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    await main.getByLabel('Ticker').fill(tick);
    await main.getByLabel('Supply', { exact: true }).fill(String(supply));
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();
    await expectConfirmModal(page);
    const issued = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(issued.status),
        `the venue rejected the ISSUE of ${tick} (${issued.status}); on this chain that is usually the `
        + 'price sentinel going stale mid-run (campaign §3.2), not a wallet defect')
        .toBe('valid');
    return issued;
}

test.describe(`the token-paid dispenser lane on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('a buyer pays a dispenser in a token and the chain credits both sides', async ({ page }) => {
        let seller;
        let buyer;
        let dispenserIndex;

        await test.step('the BUYER exists first and issues the token they will pay with', async () => {
            // Order matters: the dispenser names its payment ticker, and a
            // dispenser priced in a token nobody has issued yet is refused.
            await createWallet(page, { password: PASSWORD, name: 'Buyer Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            buyer = await main.getByLabel('From').inputValue();
            expect(buyer, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(buyer, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await issueToken(page, PAY_TICK, PAY_SUPPLY);
            await waitForBalanceAtLeast(buyer, PAY_TICK, PAY_SUPPLY);
        });

        await test.step('the SELLER is a second wallet, and opens a token-priced dispenser', async () => {
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: 'Add Wallet' }).click();
            // navigate:false - the add-wallet flow starts at the onboarding
            // welcome INSIDE the unlocked shell.
            await createWallet(page, { password: PASSWORD, name: 'Seller Wallet', navigate: false });
            // Adding a wallet does not switch to it.
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: /Seller Wallet/ }).first().click();
            await expect(page.getByRole('button', { name: /Seller Wallet/ }).first(),
                'the app did not switch to the newly added wallet')
                .toBeVisible({ timeout: 30_000 });

            await gotoPalette(page, 'Create dispenser');
            let main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            seller = await main.getByRole('textbox', { name: 'Source' }).inputValue();
            expect(seller, 'the seller wallet derived the buyer\'s address').not.toBe(buyer);

            await fundAddress(seller, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT);
            await waitForBalanceAtLeast(seller, 'XCHAIN', MINT);

            await seedPrices();
            await gotoPalette(page, 'Create dispenser');
            main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            // The token being SOLD comes from a picker over real balances.
            await main.getByRole('button', { name: /^Token/ }).click();
            await page.getByText('XCHAIN', { exact: true }).first().click();

            await main.getByLabel('Give amount (per fill)').fill(String(GIVE_PER_FILL));
            await main.getByLabel('Escrow amount').fill(String(ESCROW));

            // The lane under test: buyers pay in a TOKEN, not the native coin.
            await main.getByRole('radio', { name: 'A token' }).check();
            await main.getByLabel('Payment token').fill(PAY_TICK);
            await main.getByLabel('Payment amount (per fill)').fill(String(PRICE_PER_FILL));

            await main.getByRole('button', { name: /^(Create|Preview)$/ }).click();
            await expectConfirmModal(page);
            const created = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(created.action)).toBe('DISPENSER');
            expect(String(created.status), 'the chain rejected the dispenser').toBe('valid');
            dispenserIndex = String(created.action_index);

            // The escrow left the seller: that is what the buyer will be paid from.
            expect(await waitForBalanceChange(seller, 'XCHAIN', MINT),
                `opening the dispenser did not escrow ${ESCROW} XCHAIN`)
                .toBe(MINT - ESCROW);
        });

        await test.step('the buyer finds the dispenser and pays a fill in tokens', async () => {
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: /Buyer Wallet/ }).first().click();
            await expect(page.getByRole('button', { name: /Buyer Wallet/ }).first())
                .toBeVisible({ timeout: 30_000 });

            await seedPrices();
            // "Browse dispensers" is how a buyer reaches a dispenser they do not
            // own; My dispensers only ever lists their own. It lives on the
            // All actions screen rather than in the palette itself.
            await gotoPalette(page, 'All actions');
            await page.getByRole('main').getByText('Browse dispensers', { exact: true })
                .first().click();
            const main = page.getByRole('main');
            await expect(main.getByLabel('Token ticker')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Token ticker').fill('XCHAIN');
            await main.getByRole('button', { name: 'Search', exact: true }).click();

            // An explorer result row reads "<TICK> @ <addr> · <rate>" with
            // "#<index> · status open" underneath - not the "Open … dispenser
            // #N" aria-label the OWNER's list uses.
            const row = main.getByRole('button').filter({ hasText: `#${dispenserIndex} ` });
            await expect(row,
                `the seller's dispenser #${dispenserIndex} is on chain but the buyer cannot find it by `
                + 'searching the token it sells')
                .toBeVisible({ timeout: 60_000 });
            await row.click();

            const buySection = page.getByRole('main');
            await expect(buySection.getByLabel('Fills'),
                'the buy panel never rendered for a dispenser this wallet does not own')
                .toBeVisible({ timeout: 30_000 });
            // The panel must know what the buyer holds of the PAYMENT token;
            // a wrong read here is what disables the button.
            await expect(page.getByTestId('buy-balance'))
                .toContainText(new RegExp(`1,?000\\s*${PAY_TICK}`), { timeout: 60_000 });

            await buySection.getByLabel('Fills').fill('1');
            const buyButton = buySection.getByRole('button', { name: /^Buy 1 fill$/ });
            await expect(buyButton, 'the Buy button is disabled for a funded buyer').toBeEnabled();
            await buyButton.click();

            const password = page.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await page.getByRole('button', { name: /^Sign buy/ }).click();
            await expect(page.getByText('Buy submitted'), 'the buy never reported being submitted')
                .toBeVisible({ timeout: 180_000 });
        });

        await test.step('the chain settles it in BOTH directions', async () => {
            // The dispense is a protocol-generated action off the buyer's
            // payment, so it is waited for rather than looked up by txid.
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
                'the payment was broadcast and no DISPENSE was ever recorded, so the buyer paid and '
                + 'received nothing - the D-32 failure shape')
                .toBeTruthy();
            expect(String(dispense.status), 'the chain rejected the dispense').toBe('valid');

            // The goods reached the buyer...
            expect(await waitForBalanceAtLeast(buyer, 'XCHAIN', GIVE_PER_FILL),
                'the buyer was credited something other than one fill')
                .toBe(GIVE_PER_FILL);
            // ...the payment reached the seller...
            expect(await waitForBalanceAtLeast(seller, PAY_TICK, PRICE_PER_FILL),
                'the seller was paid something other than the fill price')
                .toBe(PRICE_PER_FILL);
            // ...and it came out of the buyer's own balance.
            expect(await tokenBalance(buyer, PAY_TICK),
                `the buyer's ${PAY_TICK} did not fall by exactly one fill price`)
                .toBe(PAY_SUPPLY - PRICE_PER_FILL);

            // The escrow paid for it: one fill out of the locked amount.
            const detail = await explorerJson(`action/${dispenserIndex}`);
            expect(Number(detail?.state?.give_remaining ?? detail?.give_remaining),
                'the dispenser escrow did not fall by exactly one fill')
                .toBe(ESCROW - GIVE_PER_FILL);
        });
    });
});
