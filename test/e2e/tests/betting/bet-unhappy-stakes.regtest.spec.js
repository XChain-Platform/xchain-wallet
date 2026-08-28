// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §10.3's unhappy paths: the stakes a user should not be allowed to
// place, and what it costs them to try.
//
// THE PROPERTY UNDER TEST IS MONETARY, not cosmetic. A refusal that happens
// AFTER a broadcast still charges a miner fee and (off Bitcoin) a
// non-refundable protocol fee, for an action the chain was always going to
// reject. That is the exact shape D-103 and D-112 charged real money for, so
// every case here ends with two reads: the address balance is untouched, and
// the chain carries no BET from this address.
//
// THREE CASES, and the predictions were written before the run:
//   1. BLANK stake - the form's own Review button is disabled on `!amount`, so
//      this should never reach compose at all.
//   2. ZERO stake - `'0'` is a non-empty string, so the button is NOT disabled;
//      the refusal comes from the SDK's `placeBetParams`, which rejects any
//      amount that is not a positive number. The prediction is that it refuses
//      correctly and that the user sees the builder's own context string
// (`betting.placeBetParams:...`), which is the D-100 error-mapping
//      family rather than a new defect class.
//   3. A stake LARGER THAN THE BALANCE - nothing in the form checks the
//      balance (the Send form's equivalent gap is D-3), so this composes. The
//      question is whether the confirm screen's pre-flight catches it, i.e.
//      whether the dry run models the stake escrow. If it says "Looks good"
//      the user's only warning is the one nobody reads, and that IS a finding.
//      This case deliberately never approves: the point is what the wallet
//      says before the money moves.
//
// Runs on Litecoin (XC_REGTEST_COIN=RLTC) for the reasons §3.5 records.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    EXPLORER_URL,
    fundAddress,
    minerRpc,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const MINT_XCHAIN = 100;
/** Ten times what the wallet holds: unmistakably unaffordable, not a rounding case. */
const OVER_STAKE = '1000';
/** Long enough that no case here races the deadline. */
const DEADLINE_LEAD_SEC = 3_600;

const RUN_TAG = `unhappy-${Date.now()}`;

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

/**
 * Waits until the indexer has PARSED the block at the chain's current tip.
 *
 * The honest close of an observation window. `status.chain_tip` is the NODE's
 * height and the indexer runs behind it, so `block/{tip}` is absent until the
 * parse lands; its arrival is the venue saying it has judged everything up to
 * that height. Pinned to the height read ONCE at entry, deliberately: a target
 * that chases a shared venue's tip never arrives while another spec is mining.
 */
async function waitForParsedTip(timeoutMs = 180_000) {
    const status = await explorerJson('status');
    const tip = Number(status?.chain_tip?.[REGTEST_COIN]);
    if (!Number.isFinite(tip)) throw new Error(`explorer reports no ${REGTEST_COIN} tip`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const block = await explorerJson(`block/${tip}`).catch(() => null);
        if (Number(block?.timestamp) > 0) return tip;
        await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(
        `the indexer never parsed ${REGTEST_COIN} block ${tip} within `
        + `${Math.round(timeoutMs / 1000)}s, so "nothing reached the chain" cannot be read off `
        + `it. That is a lagging venue, not a wallet defect.`,
    );
}

async function xchainBalance(address) {
    const body = await explorerJson(`balances/${address}`);
    const row = (body?.data || []).find((b) => b.tick === 'XCHAIN');
    return row ? Number(row.amount) : 0;
}

async function waitForToken(address, min, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await xchainBalance(address).catch(() => null);
        if (last !== null && last >= min) return last;
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`XCHAIN balance never reached ${min} for ${address} (last=${last})`);
}

/**
 * Every bet the chain has recorded against this market, in any state.
 *
 * Read per FEED rather than per address deliberately: a bet the chain rejected
 * still appears here (that is how D-112's rejected stake was found), so an
 * empty list is a real statement that nothing was broadcast - not merely that
 * nothing succeeded.
 */
async function betsOnFeed(feedIndex) {
    const body = await explorerJson(`bets/${feedIndex}/feed`);
    return (body?.data || []).map((b) => `${b.action_index}:${b.bet_status}`);
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

/** Makes `address` the one the forms sign with (see the deadline-race spec). */
async function useAddress(page, address) {
    await gotoPalette(page, 'Addresses');
    await page.getByRole('button', { name: `View address ${address}` }).click();
    await page.getByRole('group', { name: 'Address actions' })
        .getByRole('button', { name: 'Use' }).click();
}

/** The address the create-market form would sign with on the venue chain. */
async function signingAddress(page) {
    await gotoBettingHub(page);
    await page.getByRole('button', { name: 'Create market', exact: true }).click();
    const main = page.getByRole('main');
    await selectVenueChain(main);
    return main.getByLabel('Your oracle address').inputValue();
}

/**
 * Generates one address on the venue chain and returns it.
 *
 * Identified by DIFFERENCE against a snapshot rather than by prefix: BTC and
 * LTC regtest share the legacy m/n/2 version bytes and DOGE has no bech32 form,
 * so "the one that looks like this chain's" is ambiguous on exactly these
 * venues (§3.5). The modal has its OWN picker, labelled "Coin", which defaults
 * to Bitcoin.
 */
async function generateVenueAddress(page) {
    await gotoPalette(page, 'Addresses');
    const listed = async () => {
        const rows = page.getByRole('button', { name: /^View address / });
        await expect(rows.first()).toBeVisible({ timeout: 30_000 });
        return (await Promise.all((await rows.all()).map((r) => r.getAttribute('aria-label'))))
            .map((l) => String(l).replace('View address ', ''))
            .filter(Boolean);
    };
    const before = new Set(await listed());

    await page.getByRole('button', { name: 'Add or import address' }).click();
    await page.getByRole('menuitem', { name: 'Add address' }).click();
    await selectVenueChain(page, 'Coin');
    await page.getByRole('button', { name: /^Generate/ }).click();

    const generated = (await listed()).filter((a) => !before.has(a));
    expect(generated.length, 'generating added exactly one address to the list').toBe(1);
    return generated[0];
}

test.describe('BET unhappy stakes', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('a stake the user cannot make must cost them nothing', async ({ page }) => {
        let oracle;
        let bettor;
        let feedIndex;

        await test.step('onboard, fund, and hold a SMALL XCHAIN balance', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Unhappy Wallet' });
            await switchToRegtest(page, PASSWORD);

            oracle = await signingAddress(page);
            expect(oracle, `this wallet has no ${REGTEST_COIN} address`).toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(oracle, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(oracle, MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        // THE ORACLE MAY NOT BET ITS OWN MARKET (§6 format 2), and the wallet
        // honours that by not rendering the place-bet block at all - which is
        // correct, and which cost this spec its first run: written with one
        // address, it opened its own market and then looked for a form that was
        // never going to be there. Everything expensive (a second address,
        // funding it, minting to it) happens BEFORE the market is created.
        await test.step('a second address, funded, is the bettor', async () => {
            bettor = await generateVenueAddress(page);
            expect(bettor, 'the generated address is the oracle again').not.toBe(oracle);

            await useAddress(page, bettor);
            expect(await signingAddress(page),
                'the wallet still signs as the oracle after switching address').toBe(bettor);

            await fundAddress(bettor, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(bettor, MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('open a market to bet into, as the oracle', async () => {
            await useAddress(page, oracle);
            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            const main = page.getByRole('main');
            await selectVenueChain(main);

            const tokenField = main.getByRole('button', { name: /^Token bets are placed in:/ });
            await expect(tokenField).toBeVisible({ timeout: 30_000 });
            await tokenField.click();
            await page.locator('[data-balance-key$=":XCHAIN"]').first().click();

            await main.getByLabel('What is being bet on').fill(`Unhappy stakes ${RUN_TAG}`);
            await main.getByLabel('Outcome 0').fill('Yes');
            await main.getByLabel('Outcome 1').fill('No');
            await main.getByLabel('Betting closes')
                .fill(toLocalDateTimeInput((await chainTime()) + DEADLINE_LEAD_SEC));
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review market', exact: true }).click();
            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
            await page.getByTestId('confirm-approve').click();

            const until = Date.now() + 180_000;
            let feed = null;
            while (Date.now() < until && !feed) {
                const list = await explorerJson(`bet_feeds/${oracle}/source`);
                feed = (list?.data || []).find((f) => String(f.label).includes(RUN_TAG)) || null;
                if (!feed) { await nudgeChain(); await new Promise((r) => setTimeout(r, 2_000)); }
            }
            expect(feed, `no market labelled ${RUN_TAG} landed for ${oracle}`).toBeTruthy();
            feedIndex = String(feed.action_index);
        });

        // Back to the bettor for every case below: a refusal read from the
        // oracle's own view would prove nothing, since the place-bet block is
        // absent there by design.
        await useAddress(page, bettor);
        expect(await signingAddress(page), 'the cases below must run as the bettor').toBe(bettor);

        const openMarket = async () => {
            await gotoBettingHub(page);
            const row = page.getByRole('main').getByRole('button', { name: new RegExp(`^#${feedIndex}\\s`) });
            await expect(row).toBeVisible({ timeout: 30_000 });
            await row.click();
            const main = page.getByRole('main');
            await expect(main.getByRole('heading', { name: 'Place a bet' })).toBeVisible({ timeout: 30_000 });
            return main;
        };

        const balanceBefore = await xchainBalance(bettor);
        expect(await betsOnFeed(feedIndex),
            'the market already carries a bet before the unhappy paths ran').toEqual([]);

        await test.step('a BLANK stake never reaches compose', async () => {
            const main = await openMarket();
            await main.getByRole('button', { name: 'Yes', exact: true }).click();
            await expect(main.getByRole('button', { name: 'Review bet', exact: true }),
                'an empty stake can be submitted')
                .toBeDisabled();
        });

        await test.step('a ZERO stake is refused in words, and nothing is broadcast', async () => {
            const main = await openMarket();
            await main.getByRole('button', { name: 'Yes', exact: true }).click();
            await main.getByLabel(/^Stake/).fill('0');
            await fillPasswordIfPresent(main);

            const review = main.getByRole('button', { name: 'Review bet', exact: true });
            await expect(review,
                'a zero stake is blocked by the same disabled-button rule as a blank one, so this '
                + 'case is not testing what it claims to (update the spec, not the wallet)')
                .toBeEnabled();
            await review.click();

            const alert = page.getByRole('alert');
            await expect(alert, 'a zero stake produced no visible refusal at all')
                .toBeVisible({ timeout: 60_000 });
            const text = (await alert.first().innerText()) || '';
            expect(text,
                'the refusal is the SDK builder talking to itself: a user is shown a function '
                + 'name and a context string (the D-100 error-mapping family)')
                .not.toMatch(/placeBetParams|betting\./);
            await expect(page.getByTestId('confirm-modal'),
                'a zero stake reached the confirm screen, which is one Approve away from paying '
                + 'two fees for an action the chain cannot accept')
                .toBeHidden();
        });

        await test.step('a stake larger than the balance is not called "Looks good"', async () => {
            const main = await openMarket();
            await main.getByRole('button', { name: 'Yes', exact: true }).click();
            await main.getByLabel(/^Stake/).fill(OVER_STAKE);
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review bet', exact: true }).click();

            // Either outcome is defensible - refused at the form, or carried to
            // a confirm screen that says it will fail. What is NOT defensible is
            // a confirm screen that calls an unaffordable stake fine.
            const modal = page.getByTestId('confirm-modal');
            const appeared = await modal.waitFor({ state: 'visible', timeout: 45_000 })
                .then(() => true).catch(() => false);
            if (appeared) {
                const body = (await modal.innerText()) || '';
                expect(body,
                    `the confirm screen calls a ${OVER_STAKE} XCHAIN stake "Looks good" against a `
                    + `balance of ${balanceBefore}: the pre-flight does not model the stake escrow, so `
                    + `the only thing between the user and two spent fees is their own arithmetic`)
                    .not.toContain('Looks good');
                // Never approve: the point is what the wallet says beforehand.
                await page.keyboard.press('Escape');
            }
        });

        await test.step('the chain and the balance are exactly where they started', async () => {
            // Both reads below are NEGATIVE, so what makes them true statements
            // rather than merely early ones is the indexer having parsed the
            // block that closes the window: anything the cases above broadcast
            // is in the mempool by now, the nudge confirms it, and a parsed tip
            // means the venue has already judged it. The fixed 4s this replaces
            // was shorter than one BTC-regtest block parse on a loaded venue
            // (54ms to 1m 12.8s measured), so it could report "no bet reached
            // the chain" from an indexer that had not looked yet.
            await nudgeChain();
            await waitForParsedTip();
            expect(await xchainBalance(bettor),
                'a refused stake still moved the balance').toBe(balanceBefore);
            expect(await betsOnFeed(feedIndex),
                'a refused stake still reached the chain')
                .toEqual([]);
        });
    });
});
