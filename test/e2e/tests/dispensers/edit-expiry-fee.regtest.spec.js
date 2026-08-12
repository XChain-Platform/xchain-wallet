// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The third and last instance of the gap - an authoring
// surface that composes a quotable action and never threads the native-coin
// fee mode - and the only one of the three that could be driven on chain.
//
// THE DEFECT, EXACTLY. `DispenserDetail` submits DISPENSER updates from three
// places (refill v2, edit v2, close v1) and threaded `payFeeInNativeCoin`
// through none of them. Off Bitcoin that flag is not a preference: the
// native-coin output IS the protocol fee, so an action that owes one
// and carries none CONFIRMS on chain, costs a miner fee, and is then recorded
// `invalid: insufficient fee (native coin output required)` - while the screen
// says the edit was submitted. Same shape (SellOwnershipForm), which
// was proven that way on Litecoin minutes apart.
//
// WHICH EDIT ACTUALLY OWES A FEE, because the item was overstated twice before
// anyone read the handler. `utility.getUnifiedExpirationFee` charges a format-2
// DISPENSER only when BOTH `EXPIRATION > info.EXPIRATION` (the edit LENGTHENS
// the window) AND `edit_expire_days > UNIFIED_EXPIRATION_FEE_FREE_DAYS`
// (default 90), where both day counts are measured from the CREATE's block
// time. Within 90 days, or shortening, the fee stays 0. So the reachable defect
// is an owner pushing a dispenser's close date more than ~90 days past its
// creation - and nothing else on this screen. The v1 CLOSE owes nothing on any
// chain (`formats[1]` carries no EXPIRATION and is not format 0), and a refill
// sets GIVE_ESCROW with no EXPIRATION, so it never reaches the branch.
//
// WHAT THIS RUN ASSERTS, in the order that makes each mean something:
//   1. An extension that stays INSIDE the free window is free, and lands. That
//      is the control for the whole run: it proves the fee below is charged by
//      the rule rather than by the wallet stapling an output onto every edit,
//      and it proves `applyNativeFeePreflight` builds nothing for a zero quote
//      (the half of the fix that has to be correct on a free action).
//   2. An extension PAST the window is priced by the chain BEFORE it is signed,
//      at a figure this spec derives independently: additionalDays x 550 gas x
//      0.00001 GAS_PRICE. Predicting it is what makes the quote falsifiable.
//   3. That edit indexes `valid` with a `fee` object carrying `payment_mode 1`,
//      the coin amount, and the gas cost predicted above. Before the fix this
//      is the assertion that fails, and it fails as `invalid: insufficient
//      fee`, not as a missing screen.
//   4. The dispenser's expiration on chain really moved to the new date. An
//      edit can be valid and still be a no-op; the money question and the
//      effect question are asked separately.
//   5. The refill lane is quoted against the same rule and owes nothing, so the
//      flag threaded there is inert-by-design rather than untested.
//
// RUN IT ON LITECOIN (the fee lane this is about does not exist on Bitcoin,
// where the native-coin fee is opt-in):
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dispensers/edit-expiry-fee.regtest.spec.js

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
    unlockAfterReload,
    waitForTokenBalance,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** One create plus two edits, one of them paying a real coin fee. */
const FUNDING = 4;
const TICK = 'XCHAIN';
const MINT = 1000;
const GIVE_PER_FILL = 25;
const ESCROW = 100;
const TRIGGER = '0.001';

/** The consensus numbers this spec predicts against (xchain-indexer). */
const FREE_DAYS = 90;                 // UNIFIED_EXPIRATION_FEE_FREE_DAYS
const EXPIRATION_PER_DAY = 550;       // GAS_SCHEDULE, identical on BTC/LTC/DOGE
const GAS_PRICE = 0.00001;

/** Days past the CREATE's block time each stage of the run aims at. */
const CREATE_DAYS = 30;
const FREE_EDIT_DAYS = 60;            // still <= FREE_DAYS: an extension that owes nothing
const PAID_EDIT_DAYS = 150;           // > FREE_DAYS: the one edit on this screen that is priced

/**
 * Seconds added to every target so the minute-granular `datetime-local` input
 * cannot round the day count DOWN.
 *
 * The input truncates to the minute, and the chain floors `(EXPIRATION -
 * BLOCK_TIME) / 86400`, so a target landing exactly on a day boundary can come
 * back one day short - which would move `additionalDays` and quietly break the
 * arithmetic this run is built on rather than fail it.
 */
const MINUTE_MARGIN = 300;

/**
 * A target the form can actually submit: floored to the minute, because the
 * `datetime-local` field has no seconds and drops them silently.
 *
 * COST A RUN. The first draft asserted on the unfloored value, so the chain
 * stored a timestamp up to 59s BELOW what the spec was waiting for and
 * `waitForExpiration` could never match - a spec bug that presents as the edit
 * never taking effect. Flooring here makes what is submitted, what is asserted,
 * and what is quoted the same number, and MINUTE_MARGIN is what keeps the day
 * count intact after the floor.
 */
function toMinute(unix) {
    return Math.floor(unix / 60) * 60;
}

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

async function feequote(params, source) {
    const q = new URLSearchParams({ action: 'DISPENSER', params, source });
    return explorerJson(`feequote?${q.toString()}`);
}

/**
 * Mines a block while the decoder is keeping up (Session 40, campaign §3.5).
 *
 * NOT gated on the miner's own `mempool_size`: on this venue that counter has
 * been measured standing still through real blocks, which makes the usual
 * helper inert and kills a run on its own indexer wait with the pipeline
 * healthy. The decoder's lag is independently observable and was correct.
 */
async function mineIfBehind() {
    try {
        const status = await explorerJson('status');
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* best-effort; the waits below carry the timeout */ }
}

async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        // Details are fetched only for an index the LIST returned: a
        // speculative GET on an index that does not exist yet is memoized
        // blank for the life of the explorer process (D-127, §3.6).
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfBehind();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(`No XChain action recorded for ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s. Decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}.`);
}

/** The dispenser's live expiration, as the chain reports it. */
async function currentExpiration(index) {
    const row = await explorerJson(`action/${index}`);
    const v = row?.state?.expiration ?? row?.expiration;
    return v == null ? null : Number(v);
}

async function waitForExpiration(index, expected, timeoutMs = 240_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await currentExpiration(index).catch(() => last);
        if (last === expected) return last;
        await mineIfBehind();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`dispenser #${index} expiration never reached ${expected} (last=${last})`);
}

/**
 * Unix seconds -> the string a `datetime-local` input holds, in the LOCAL zone.
 *
 * The wallet parses that field with `Date.parse`, which reads a zone-less
 * string as local time, and this config sets no `timezoneId`, so the browser
 * and this process share one zone. Built by hand rather than via
 * `toISOString().slice(...)`, which would silently submit a UTC wall-clock.
 */
function unixToLocalInput(unix) {
    const d = new Date(unix * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
        + `T${p(d.getHours())}:${p(d.getMinutes())}`;
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
 * Opens the owner's dispenser detail page from My dispensers.
 *
 * Re-navigated per edit: the edit success screen bumps the page's reload key,
 * and re-entering is what an owner making a second change actually does.
 */
async function openDispenserDetail(page, index) {
    await gotoPalette(page, 'Dispensers');
    const main = page.getByRole('main');
    // The owner's list labels the row rather than printing the index in its
    // text ("Open XCHAIN dispenser #1699"), so filtering on visible text finds
    // nothing - campaign §"Dispensers", Session 31.
    const row = main.getByLabel(new RegExp(`dispenser #${index}$`)).first();
    await expect(row, `dispenser #${index} is not in the owner's own list`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();
    await expect(main.getByRole('button', { name: 'Edit' }),
        'the detail page has no enabled Edit control for the owner')
        .toBeEnabled({ timeout: 30_000 });
    return main;
}

/**
 * Drives one expiration edit to its own success screen and returns the txid.
 *
 * The edit is one of the wallet's remaining legacy sign paths: `handleEdit`
 * calls `dispenserAction` directly and lands on "Edit submitted", so there is
 * no confirm modal to approve and no prebuilt PSBT to inspect.
 */
async function submitExpirationEdit(page, index, targetUnix) {
    const main = await openDispenserDetail(page, index);
    await main.getByRole('button', { name: 'Edit' }).click();

    const field = main.getByLabel('New expiration');
    await expect(field, 'the edit form has no expiration field').toBeVisible({ timeout: 30_000 });
    await field.fill(unixToLocalInput(targetUnix));

    await main.getByRole('button', { name: /^Sign edit/ }).click();
    await expect(main.getByRole('heading', { name: 'Edit submitted' }),
        'the edit never reached its own success screen')
        .toBeVisible({ timeout: 180_000 });
    await expect(main).toContainText(/[0-9a-f]{64}/, { timeout: 60_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/** The fee the gas schedule says an edit from `fromDays` to `toDays` owes. */
function expectedGas(fromDays, toDays) {
    return toDays > FREE_DAYS ? (toDays - fromDays) * EXPIRATION_PER_DAY : 0;
}

test.describe(`dispenser expiration-edit fee on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(3_000_000);

    test('an edit past the free window pays the coin fee, and one inside it pays nothing', async ({ page }) => {
        let owner;
        let dispenserIndex;
        let createdAt;          // the CREATE's block time: the origin both day counts measure from
        const target = (days) => toMinute(createdAt + (days * 86_400) + MINUTE_MARGIN);

        await test.step(`open a dispenser expiring in ${CREATE_DAYS} days`, async () => {
            await createWallet(page, { password: PASSWORD, name: 'Expiry Owner' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Create dispenser');
            let main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            owner = await main.getByRole('textbox', { name: 'Source' }).inputValue();
            expect(owner, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(owner, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT);
            await waitForTokenBalance(owner, TICK, MINT);
            await seedPrices();

            await gotoPalette(page, 'Create dispenser');
            main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByRole('button', { name: /^Token/ }).click();
            await page.getByText(TICK, { exact: true }).first().click();
            await main.getByLabel('Give amount (per fill)').fill(String(GIVE_PER_FILL));
            await main.getByLabel('Escrow amount').fill(String(ESCROW));
            await main.getByLabel(/Trigger price/).fill(TRIGGER);

            // A custom expiration, deliberately SHORT of the free window. The
            // default window is exactly 90 days, which leaves no room for an
            // extension that is still free - and that extension is this run's
            // control.
            await main.getByRole('radio', { name: /Expire at a specific time/ }).check();
            const nowSec = Math.floor(Date.now() / 1000);
            await main.getByLabel('Expires').fill(
                unixToLocalInput(toMinute(nowSec + (CREATE_DAYS * 86_400) + MINUTE_MARGIN)),
            );

            await main.getByRole('button', { name: /^(Create|Preview)$/ }).click();
            await expectConfirmModal(page);
            const created = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(created.status), 'the chain rejected the dispenser create').toBe('valid');
            dispenserIndex = String(created.action_index);
            createdAt = Number(created.timestamp);
            expect(createdAt, 'the create action carries no block time to measure days from')
                .toBeGreaterThan(0);

            // The create itself must be free, or the fee measured later cannot
            // be attributed to the edit. A <=90-day window is inside the same
            // free allowance the edit rule uses (getUnifiedDurationFee).
            expect(String(created.fee?.payment_mode ?? '0'),
                'the create paid a protocol fee, so this run cannot attribute the edit fee below')
                .toBe('0');
        });

        await test.step(`extend it to ${FREE_EDIT_DAYS} days - inside the window, so free`, async () => {
            const to = target(FREE_EDIT_DAYS);
            const quote = await feequote(`2|${dispenserIndex}||${to}|||`, owner);
            expect(Number(quote.requiredFeeSats),
                `the chain prices an extension to ${FREE_EDIT_DAYS} days, which is inside the `
                + `${FREE_DAYS}-day free window: ${JSON.stringify(quote)}`)
                .toBe(0);

            const done = await waitForIndexedAction(await submitExpirationEdit(page, dispenserIndex, to));
            expect(String(done.status), 'the chain rejected a free, in-window extension').toBe('valid');
            // The fix must add NOTHING to a zero-quote action. A wallet that
            // stapled a fee output onto every edit would still read `valid`
            // here but would show a payment_mode, so this is asserted rather
            // than assumed.
            expect(String(done.fee?.payment_mode ?? '0'),
                'a free edit was composed with a protocol-fee payment mode')
                .toBe('0');
            expect(await waitForExpiration(dispenserIndex, to),
                'the free edit did not move the dispenser expiration').toBe(to);
        });

        await test.step(`extend it to ${PAID_EDIT_DAYS} days - past the window, so priced`, async () => {
            const to = target(PAID_EDIT_DAYS);
            const gas = expectedGas(FREE_EDIT_DAYS, PAID_EDIT_DAYS);
            const xchainFee = (gas * GAS_PRICE).toFixed(8);

            // Predicted from the gas schedule before the chain is asked, so a
            // quote that merely LOOKS non-zero cannot pass for the right one.
            const quote = await feequote(`2|${dispenserIndex}||${to}|||`, owner);
            expect(Number(quote.xchainFee).toFixed(8),
                `an extension from ${FREE_EDIT_DAYS} to ${PAID_EDIT_DAYS} days owes `
                + `${PAID_EDIT_DAYS - FREE_EDIT_DAYS} days x ${EXPIRATION_PER_DAY} gas: `
                + JSON.stringify(quote))
                .toBe(xchainFee);
            expect(Number(quote.requiredFeeSats),
                'the coin-denominated fee quotes at zero sats, so this venue cannot test the '
                + 'lane at all - check the seeded coin price (campaign §3.2)')
                .toBeGreaterThan(0);

            const done = await waitForIndexedAction(await submitExpirationEdit(page, dispenserIndex, to));

            // itself. Before the fix the wallet composed this edit with
            // no native-coin output, so it confirmed on chain and the indexer
            // recorded exactly this refusal while the screen said "Edit
            // submitted" - the transaction is real either way, only the verdict
            // differs.
            expect(String(done.status),
                'the chain refused the extension. `insufficient fee (native coin output '
                + 'required)` here IS: the edit carried no protocol-fee output, which'
                + 'off Bitcoin is mandatory')
                .toBe('valid');

            const fee = done.fee || {};
            expect(fee.payment_mode, 'the edit indexed valid but recorded no coin-fee payment mode')
                .toBe(1);
            expect(String(fee.gas_cost),
                'the fee charged is not the one the expiration rule prices')
                .toBe(String(gas));
            expect(Number(fee.xchain_amount).toFixed(8),
                'the XCHAIN-denominated fee does not match the gas schedule')
                .toBe(xchainFee);
            expect(Number(fee.native_coin_amount),
                'no native-coin amount was recorded against a payment_mode 1 fee')
                .toBeGreaterThan(0);

            expect(await waitForExpiration(dispenserIndex, to),
                'the paid edit was recorded valid but the expiration never moved')
                .toBe(to);
        });

        await test.step('and a refill owes nothing under the same rule', async () => {
            // The other v2 lane on this screen. It sets GIVE_ESCROW and no
            // EXPIRATION, so `getUnifiedExpirationFee` never reaches its branch
            // - which makes the flag threaded there inert BY THE RULE rather
            // than untested. Asked of the chain so the reading is checked.
            const quote = await feequote(`2|${dispenserIndex}|20`, owner);
            expect(Number(quote.requiredFeeSats),
                `a refill is priced on this venue: ${JSON.stringify(quote)}`)
                .toBe(0);
        });
    });
});
