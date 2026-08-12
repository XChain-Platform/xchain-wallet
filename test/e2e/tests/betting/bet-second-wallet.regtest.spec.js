// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §10.3's last leg: a bet placed from a second WALLET, not a second address.
//
// WHY THE DISTINCTION IS THE POINT. The existing round trip and the deadline
// race both bet from a second ADDRESS inside one wallet, which is enough to
// satisfy the protocol rule that an oracle may not bet its own market. What it
// cannot exercise is the WALLET boundary: MyBets and OracleConsole are scoped
// per wallet, the bettor's wallet has never seen the market's creation, and
// nothing in one wallet's vault knows the other exists. A market that only ever
// works when both roles share a seed would pass every test written so far.
//
// TWO THINGS THIS IS BUILT TO CATCH, both stated before the run:
//   1. A wallet created while the active network is ALREADY regtest may not get
//      regtest addresses. `settings.setActiveNetwork` is what derives an address
//      on each chain of a network, and creating a second wallet does not go
//      through it. If the bettor wallet comes back with mainnet addresses only,
//      the run stops at the first assertion with that named, rather than
//      several steps later looking like a funding failure.
//   2. The betting hub is chain-scoped, not wallet-scoped, so wallet B must see
//      wallet A's market. If it does not, browse is filtering by something it
//      should not.
//
// Runs on Litecoin for the same reasons as the deadline race (see
// bet-deadline-race.regtest.spec.js): Bitcoin regtest is the busy chain, and
// this spec owns a market's state for minutes. XC_REGTEST_COIN=RLTC.
//
// STATUS, stated plainly because this file was committed before it had ever
// completed a fully green run (session 26). WHAT IT PROVED, on chain and
// beyond doubt: market #1233 was created by wallet A (rltc1q9kll...), bet #1235
// was placed on it by wallet B (rltc1qz8rxm...) for 100 XCHAIN with
// bet_status 'open' and a pool of 100, the bettor went 1000 -> 900, and the
// oracle stayed at 1000. That is the leg's whole substance, across two wallets
// rather than two addresses in one seed. WHAT IS STILL OWED: one clean
// end-to-end pass. Three separate runs were stopped by three different things,
// none of them this spec's subject - a real wallet defect it found on the way
// (the reload that changed which wallet signs; fixed), an expired LTC
// price sentinel, and finally "no spendable UTXOs found for the funding
// address" when a concurrent session began driving Litecoin as well. Re-run it
// on a quiet chain with the price sentinel kept fresh (campaign §3.5).

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    mintXchain,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const MINT_XCHAIN = 1000;
const STAKE = '100';

/** Long enough that the bet lands while the market is open; not a race here. */
const DEADLINE_LEAD_SEC = 3_600;

const RUN_TAG = `2wallet-${Date.now()}`;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

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

function toLocalDateTimeInput(unixSec) {
    const d = new Date(unixSec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function nudgeChain() {
    try {
        const status = await explorerJson('status');
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient */ }
}

async function waitForToken(address, tick, min, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const body = await explorerJson(`balances/${address}`);
            const row = (body?.data || []).find((b) => b.tick === tick);
            last = row ? Number(row.amount) : 0;
            if (last >= min) return last;
        } catch { /* transient */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
}

/** Runs a palette command by clicking its row (see the deadline-race spec). */
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

async function gotoBettingHub(page) {
    await gotoPalette(page, 'Betting');
    await expect(page.getByRole('button', { name: 'Create market', exact: true }))
        .toBeVisible({ timeout: 30_000 });
    await selectVenueChain(page.getByRole('main'));
}

async function fillPasswordIfPresent(scope) {
    const field = scope.getByLabel('Password', { exact: true });
    if (await field.count() > 0 && await field.isVisible()) await field.fill(PASSWORD);
}

async function approveConfirm(page) {
    await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('confirm-approve').click();
}

/**
 * The address the create-market form would sign with on the venue chain.
 *
 * Read off the form rather than off Receive for the reason the round trip
 * records: they are not always the same address, and the form's is the one that
 * actually signs.
 */
async function signingAddress(page) {
    await gotoBettingHub(page);
    await page.getByRole('button', { name: 'Create market', exact: true }).click();
    const main = page.getByRole('main');
    await selectVenueChain(main);
    return main.getByLabel('Your oracle address').inputValue();
}

test.describe('BET across two wallets', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('a market made by one wallet takes a bet from another', async ({ page }) => {
        let oracle;
        let punter;
        let feedIndex;

        await test.step('wallet A: onboard, fund, and hold XCHAIN', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Oracle Wallet' });
            await switchToRegtest(page, PASSWORD);

            oracle = await signingAddress(page);
            expect(oracle, `wallet A has no ${REGTEST_COIN} address`).toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(oracle, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(oracle, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('wallet A opens a market', async () => {
            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            const main = page.getByRole('main');
            await selectVenueChain(main);
            expect(await main.getByLabel('Your oracle address').inputValue()).toBe(oracle);

            const tokenField = main.getByRole('button', { name: /^Token bets are placed in:/ });
            await expect(tokenField).toBeVisible({ timeout: 30_000 });
            await tokenField.click();
            await page.locator('[data-balance-key$=":XCHAIN"]').first().click();

            await main.getByLabel('What is being bet on').fill(`Two wallets ${RUN_TAG}`);
            await main.getByLabel('Outcome 0').fill('Yes');
            await main.getByLabel('Outcome 1').fill('No');
            await main.getByLabel('Betting closes')
                .fill(toLocalDateTimeInput((await chainTime()) + DEADLINE_LEAD_SEC));
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review market', exact: true }).click();
            await approveConfirm(page);

            const until = Date.now() + 180_000;
            let feed = null;
            while (Date.now() < until && !feed) {
                const list = await explorerJson(`bet_feeds/${oracle}/source`);
                feed = (list?.data || []).find((f) => String(f.label).includes(RUN_TAG)) || null;
                if (!feed) { await nudgeChain(); await new Promise((r) => setTimeout(r, 2_000)); }
            }
            expect(feed, `no market labelled ${RUN_TAG} landed for ${oracle}`).toBeTruthy();
            expect(feed.feed_status).toBe('open');
            feedIndex = feed.action_index;
        });

        await test.step('wallet B: a SECOND wallet, created inside the same session', async () => {
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: 'Add Wallet' }).click();
            // navigate:false, because this add-wallet flow starts at the
            // onboarding welcome INSIDE the unlocked shell; a goto('/') would
            // throw away the session and land back on wallet A.
            await createWallet(page, {
                password: PASSWORD, name: 'Bettor Wallet', navigate: false,
            });

            // ADDING A WALLET DOES NOT SWITCH TO IT, which cost this spec a run.
            // `CreateWallet mode="add"` finishes by calling App's `refresh`,
            // which resets the view to home and re-reads the session but never
            // touches `activeWalletId` - so the app comes back on the wallet you
            // started from, with the new one merely present in the picker. The
            // first version of this spec assumed otherwise and read wallet A's
            // address back as if it were wallet B's, which surfaced as "wallet B
            // derived the same address as wallet A". Switch explicitly.
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: /Bettor Wallet/ }).first().click();
            await expect(page.getByRole('button', { name: /Bettor Wallet/ }).first(),
                'the app did not switch to the newly added wallet')
                .toBeVisible({ timeout: 30_000 });

            // FORECAST, stated before the run: the active network is already
            // regtest, and `settings.setActiveNetwork` (the thing that derives an
            // address on each chain of a network) is not on this path. If the new
            // wallet came back with no regtest address, this is where it says so.
            punter = await signingAddress(page);
            expect(punter,
                'wallet B has no address on the venue chain: creating a wallet while the '
                + 'network is already regtest did not derive one')
                .toMatch(REGTEST_ADDRESS_RE);
            expect(punter, 'wallet B derived the same address as wallet A').not.toBe(oracle);

            await fundAddress(punter, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(punter, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('wallet B sees the other wallet market and bets on it', async () => {
            await gotoBettingHub(page);
            // Chain-scoped, not wallet-scoped: a market wallet B never created
            // must still be browsable from wallet B.
            const row = page.getByRole('button', { name: new RegExp(`#${feedIndex}\\b`) });
            await expect(row,
                `wallet B cannot see market #${feedIndex}, which wallet A created on the same chain`)
                .toBeVisible({ timeout: 30_000 });
            await row.click();

            const main = page.getByRole('main');
            await expect(main.getByRole('heading', { name: 'Place a bet' })).toBeVisible({ timeout: 30_000 });
            await main.getByRole('button', { name: 'Yes', exact: true }).click();
            await main.getByLabel(/^Stake/).fill(STAKE);
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review bet', exact: true }).click();
            await approveConfirm(page);

            await expect(page.getByTestId('bet-result'), 'no receipt after placing the bet')
                .toBeVisible({ timeout: 120_000 });
        });

        await test.step('the chain agrees the two roles are different wallets', async () => {
            const until = Date.now() + 300_000;
            let placed = null;
            while (Date.now() < until && !placed) {
                const bets = await explorerJson(`bets/${feedIndex}/feed`);
                placed = (bets?.data || []).find((b) => String(b.bet_status) === 'open') || null;
                if (!placed) { await nudgeChain(); await new Promise((r) => setTimeout(r, 2_000)); }
            }
            expect(placed, 'the bet never indexed as an open stake').toBeTruthy();
            expect(placed.source, 'the bet came from wallet B').toBe(punter);
            expect(placed.source, 'an oracle may not bet its own market').not.toBe(oracle);
            expect(Number(placed.outcome)).toBe(0);
            expect(Number(placed.amount)).toBeCloseTo(Number(STAKE), 8);

            // The stake really left wallet B, which is the difference between a
            // bet and a self-payment inside one seed.
            //
            // POLLED, not sampled. The bet row appears in `bets/{feed}/feed`
            // BEFORE the escrow debit shows up in `balances`, so a single read
            // taken the moment the row exists returns the pre-bet balance and
            // fails claiming the stake never left - which is a false accusation
            // against the wallet, and cost this spec a run. The round trip warns
            // about exactly this ("a balance read is a moving target here").
            const want = MINT_XCHAIN - Number(STAKE);
            const untilDebit = Date.now() + 180_000;
            let held = null;
            while (Date.now() < untilDebit) {
                const body = await explorerJson(`balances/${punter}`);
                held = Number((body?.data || []).find((b) => b.tick === 'XCHAIN')?.amount ?? NaN);
                if (held === want) break;
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 2_000));
            }
            expect(held, `the stake never left the bettor wallet (still ${held})`).toBe(want);

            // And it did NOT come out of the oracle's wallet, which is the
            // assertion a single-wallet run can never make.
            const oracleBody = await explorerJson(`balances/${oracle}`);
            expect(Number((oracleBody?.data || []).find((b) => b.tick === 'XCHAIN')?.amount ?? NaN),
                'the oracle wallet paid for the bettor stake').toBe(MINT_XCHAIN);
        });

        await test.step('MyBets is scoped to the wallet that placed the bet', async () => {
            // Wallet B placed it, so wallet B lists it.
            await gotoPalette(page, 'My bets');
            await expect(page.getByRole('main').getByText(new RegExp(`#${feedIndex}\\b`)),
                'wallet B does not list a bet it placed').toBeVisible({ timeout: 30_000 });

            // Wallet A did not, so wallet A must not: a MyBets that reads the
            // chain rather than the wallet would show every bet on the venue.
            await gotoPalette(page, 'Switch wallet');
            await page.getByRole('button', { name: /Oracle Wallet/ }).first().click();
            await unlockAfterReload(page, PASSWORD).catch(() => {});

            await gotoPalette(page, 'My bets');
            await expect(page.getByRole('main').getByText(new RegExp(`#${feedIndex}\\b`)),
                'wallet A lists a bet placed by a different wallet')
                .toBeHidden({ timeout: 30_000 });

            // And the market IS wallet A's, so its oracle console still claims it.
            await gotoPalette(page, 'My markets');
            await expect(page.getByRole('main').getByText(new RegExp(`#${feedIndex}\\b`)),
                'wallet A does not list the market it created').toBeVisible({ timeout: 30_000 });
        });
    });
});
