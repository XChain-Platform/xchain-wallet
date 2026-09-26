// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §11.3's browser half: does the native-fee flag actually reach the
// WIRE on each submit lane, or only on the one somebody drove?
//
// THE RISK THIS EXISTS FOR, in the campaign's own words: each form threads the
// same flag through up to three submit paths, and before `useNativeFee` (PC-51)
// centralized the state, a form that forgot one silently dropped the fee mode
// on that lane. Silently: the action composes, broadcasts, and then indexes
// invalid, having paid a real miner fee. The grep half is already a structural
// guard (`nativeFeeHookAdoption.test.js`); what a grep cannot see is whether
// the flag survives the trip to the encoder, which is what this drives.
//
// ISSUE covers the priced path on every venue. Bitcoin exercises the opt-in;
// Litecoin and Dogecoin exercise the mandatory native lane. SEND and MINT add
// the two fee-free action shapes, where selecting native mode must still
// compose, broadcast, and index without inventing a fee.
//
// LANE 1, the confirm path: compose with the toggle ON, approve, and
//     read the RESULT OFF THE CHAIN - the action must index valid AND pay the
//     protocol fee in coin. An action that dropped the flag indexes `invalid:
//     insufficient fee` or silently pays from the XCHAIN balance instead.
//
//   LANE 2, the watcher encode-only path: build the same action twice in
//     watcher mode, once with the toggle OFF and once ON, and compare the
//     unsigned transactions. This is a DIFFERENTIAL check on purpose - it needs
//     no transaction parsing, no address decoding and no broadcast, and it
//     answers exactly the question asked: does setting the flag change the
//     bytes the user is about to sign? A dropped flag makes the two builds
//     identical.
//
// LANE 3, the legacy submit path, is NOT covered here and the reason is worth
// recording rather than leaving as a silent gap: on this form the non-watcher
// path IS the confirm path, and the forms that still carry a distinct legacy
// submit are DeployContractForm / ExecuteContractForm, which need a deployed
// contract and the VM. That is a separate venue, not a separate assertion.
//
// PRE-FLIGHT: ISSUE is priced, so the venue needs a usable BTC/USD snapshot
// (§3.2). This stack's BTC chain clock is ~10h behind wall time, and staleness
// is judged against WALL clock, so the sentinels must be seeded at wall clock -
// the §3.2 recipe for a clock-frozen chain, measured safe on Bitcoin in
// session 22. for why the spec cannot do this itself yet.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    fundAddress,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    REGTEST_DESTINATION,
    REGTEST_TICKER,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    warmFeeQuote,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 100;
const STAMP = Date.now().toString().slice(-7);
const ISSUE_TICK = `FEE${STAMP}`;
const SEND_TICK = `SND${STAMP}`;
const MINT_TICK = `MNF${STAMP}`;
const SUPPLY = '1000';
const INITIAL_MINT = '500';
const MINT_AMOUNT = 100;
const SEND_AMOUNT = 25;

/** The venue's own answer for what this action's protocol fee costs in coin. */
async function feeQuote(action, params, source) {
    // Retried, not read once. This venue's fee-quote path stalls past the
    // explorer's 5s indexer-hop timeout often enough to redden this spec on a
    // perfectly healthy stack  , and reading it cold at the top of a
    // run is the likeliest moment to hit it. The failure then reads as a
    // price-seed problem that is not there.
    return warmFeeQuote({ action, params, source });
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

async function setWalletMode(page, mode) {
    const label = mode === 'watcher' ? /^Watcher/ : /^Full/;
    await gotoPalette(page, 'Settings');
    await page.getByRole('button', { name: /^Wallet Mode/ }).click();
    const radio = page.getByRole('radio', { name: label });
    await expect(radio).toBeVisible({ timeout: 30_000 });
    await radio.click();
    await expect(radio, `the wallet did not switch to ${mode} mode`).toBeChecked({ timeout: 30_000 });
}

/** The native-fee opt-in, which on Bitcoin is a real control. */
function feeToggle(scope) {
    const name = /^Pay protocol fee in .* instead of XCHAIN/;
    return scope.getByRole('switch', { name }).or(scope.getByRole('checkbox', { name })).first();
}

async function setNativeFee(scope, enabled = true) {
    const toggle = feeToggle(scope);
    if (REGTEST_COIN === 'RBTC') {
        await expect(toggle, 'Bitcoin did not offer its native-fee choice')
            .toBeVisible({ timeout: 30_000 });
        if (enabled !== (await toggle.isChecked())) await toggle.click();
        await expect(toggle).toBeChecked({ checked: enabled });
        return;
    }
    expect(enabled, `${REGTEST_TICKER} cannot disable its mandatory native-fee lane`).toBe(true);
    await expect(toggle,
        `${REGTEST_TICKER} exposed an opt-in even though its native-fee lane is mandatory`)
        .toHaveCount(0);
}

/**
 * Fills the issue form and returns it, leaving the caller to submit.
 *
 * `tick` varies per call because a tick is claimed once on chain: reusing one
 * would make the second build fail for a reason that has nothing to do with
 * fees.
 */
async function fillIssueForm(page, tick, { nativeFee, initialMint = null }) {
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    await main.getByLabel('Ticker').fill(tick);
    await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);
    if (initialMint !== null) {
        await main.getByLabel('Initial mint (optional)').fill(String(initialMint));
    }
    await setNativeFee(main, nativeFee);
    return main;
}

async function approveAndGetTxid(page) {
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled({ timeout: 120_000 });
    await approve.click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'success screen showed no transaction id').toBeTruthy();
    return txid;
}

async function assertNativeFeeRecord(action, quote) {
    const quotedSats = Number(quote?.requiredFeeSats || 0);
    if (quotedSats === 0) {
        expect(Number(action.fee?.native_coin_amount || 0),
            'a fee-free action unexpectedly paid a native protocol fee').toBe(0);
        return;
    }
    expect(Number(action.fee?.payment_mode), 'the indexed action did not use the native fee lane')
        .toBe(1);
    expect(Math.round(Number(action.fee?.native_coin_amount) * 1e8),
        'the indexed native fee differs from the venue quote').toBe(quotedSats);
    expect(String(action.fee?.native_coin)).toBe(REGTEST_TICKER);
}

async function setupFundedWallet(page, name) {
    await createWallet(page, { password: PASSWORD, name });
    await switchToRegtest(page, PASSWORD);
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    const source = await main.getByLabel('From').inputValue();
    expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
        .toMatch(REGTEST_ADDRESS_RE);

    await fundAddress(source, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    await mintXchain(page, 20);
    await waitForTokenBalance(source, 'XCHAIN', 20, 1_200_000);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    return source;
}

async function issueToken(page, tick, { initialMint = null } = {}) {
    const main = await fillIssueForm(page, tick, { nativeFee: true, initialMint });
    const submit = main.getByRole('button', { name: 'Issue token', exact: true });
    await submit.click();
    await expectConfirmModal(page, `the ISSUE of ${tick}`, 120_000);
    const action = await waitForValidAction(await approveAndGetTxid(page), 1_200_000);
    expect(String(action.action)).toBe('ISSUE');
    expect(String(action.tick)).toBe(tick);
    return action;
}

async function pickMintToken(page, tick) {
    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Token:/ }).click();
    const search = page.getByLabel('Search coins or tokens');
    await expect(search, 'the Mint token picker did not open').toBeVisible({ timeout: 30_000 });
    await search.fill(tick);
    const row = page.locator(`[data-balance-key="${REGTEST_CHAIN_ID}:${tick}"]`).first();
    await expect(row, `the Mint picker does not list ${tick} on ${REGTEST_CHAIN_LABEL}`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();
}

async function waitForExactTokenBalance(address, tick, expected) {
    const deadline = Date.now() + 1_200_000;
    let last = null;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last === expected) return last;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`${tick} balance for ${address} never reached ${expected} (last=${last})`);
}

test.describe(`the native-fee flag on each submit lane on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(3_600_000);

    test('the flag reaches the wire on the confirm path and on the watcher build', async ({ page }) => {
        let source;
        let quotedSats;

        await test.step(`onboard and fund on ${REGTEST_CHAIN_LABEL}`, async () => {
            await createWallet(page, { password: PASSWORD, name: 'Fee Lane Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            source = await main.getByLabel('From').inputValue();
            expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, 20);
            await waitForTokenBalance(source, 'XCHAIN', 20, 1_200_000);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // The venue's own price of this action, read BEFORE composing so the
            // spec fails on a stale oracle with that named rather than blaming
            // the wallet several steps later (§3.2).
            const quote = await feeQuote('ISSUE', `${ISSUE_TICK}|${SUPPLY}|0|0|0`, source);
            expect(quote?.valid,
                `the venue cannot price this action (${quote?.status}); seed the sentinels at wall `
                + 'clock per campaign §3.2 before re-running - this is a venue state, not a wallet bug')
                .toBe(true);
            quotedSats = Number(quote.requiredFeeSats);
            expect(quotedSats, 'the quoted protocol fee is not a positive number of sats')
                .toBeGreaterThan(0);
        });

        await test.step('LANE 1: the confirm path pays the fee in coin, on chain', async () => {
            const main = await fillIssueForm(page, ISSUE_TICK, { nativeFee: true });
            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            // In full mode this form is SINGLE-ENCODE: the form button
            // composes and opens the confirm screen directly, with no review
            // stage in between. Watcher mode is the one that gets "Preview".
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            const action = await waitForValidAction(await approveAndGetTxid(page), 1_200_000);
            expect(String(action.tick), 'the indexed ISSUE used a different ticker').toBe(ISSUE_TICK);
            expect(String(action.status),
                'the action indexed invalid, which is what a DROPPED fee flag looks like: the wallet '
                + 'signed and paid a miner fee for something the chain would never accept')
                .toBe('valid');
            // The fee record lives UNDER `fee`, not at the top level, and the
            // top-level `payment_mode` is null on every action - reading it
            // there reports a correct coin payment as an XCHAIN one.
            expect(Number(action.fee?.payment_mode),
                'the action was accepted but recorded as paying its fee in XCHAIN, so the coin lane '
                + 'the user chose never reached the wire')
                .toBe(1);
            // And the amount is the one the venue quoted before composing, in
            // the chain's own coin: the flag did not merely survive, it bought
            // what it said it would.
            expect(Math.round(Number(action.fee?.native_coin_amount) * 1e8),
                `the coin fee on chain is not the ${quotedSats} sats quoted`)
                .toBe(quotedSats);
            expect(String(action.fee?.native_coin)).toBe(REGTEST_TICKER);
        });

        await test.step('LANE 2: the watcher build changes when the flag is set', async () => {
            await setWalletMode(page, 'watcher');

            const build = async (tick, nativeFee) => {
                const main = await fillIssueForm(page, tick, { nativeFee });
                await main.getByRole('button', { name: 'Preview', exact: true }).click();
                await main.getByRole('button', { name: 'Create unsigned transaction', exact: true }).click();
                // By ROLE: the panel also carries a "Copy unsigned transaction
                // hex" button, so the label alone matches two elements.
                const hex = page.getByRole('textbox', { name: 'Unsigned transaction hex' });
                await expect(hex, 'the watcher build produced no unsigned transaction')
                    .toBeVisible({ timeout: 120_000 });
                const value = await hex.inputValue();
                expect(value, 'the unsigned transaction is empty').toMatch(/^[0-9a-f]{40,}$/i);
                return value;
            };

            if (REGTEST_COIN !== 'RBTC') {
                const mandatory = await build(`${ISSUE_TICK}M`, true);
                expect(mandatory, 'the mandatory watcher build is empty')
                    .toMatch(/^[0-9a-f]{40,}$/i);
                return;
            }

            const off = await build(`${ISSUE_TICK}A`, false);
            // BACK VIA THE SCREEN'S OWN CONTROL, not the palette: re-selecting
            // "Issue token" while the route is already mounted changes no state,
            // so the form stays on its result screen and the second build never
            // starts. Same shape as D-117 on the betting hub - a command for the
            // route you are already on is a no-op - and here the wallet offers
            // "Build another" precisely for this.
            await page.getByRole('button', { name: 'Build another', exact: true }).click();
            const on = await build(`${ISSUE_TICK}B`, true);

            // Differential, so no transaction parsing is needed: a dropped flag
            // makes these two builds the same shape, and the coin fee is one
            // extra output - roughly 34 bytes, i.e. ~68 hex characters.
            expect(on,
                'the watcher build is byte-identical with the fee flag on and off, so the encode-only '
                + 'lane never carried it (the PC-51 failure this sweep exists for)')
                .not.toBe(off);
            expect(on.length - off.length,
                `the flagged build is not longer by an output (off=${off.length}, on=${on.length} hex chars)`)
                .toBeGreaterThan(50);
        });
    });

    test('the Advanced SEND lane submits with native mode and settles on chain', async ({ page }) => {
        const source = await setupFundedWallet(page, 'Native SEND Wallet');
        await issueToken(page, SEND_TICK);
        await waitForTokenBalance(source, SEND_TICK, Number(SUPPLY), 1_200_000);
        await page.reload();
        await unlockAfterReload(page, PASSWORD);

        const params = `0|${SEND_TICK}|${SEND_AMOUNT}|${REGTEST_DESTINATION}`;
        const quote = await feeQuote('SEND', params, source);
        expect(quote?.valid, `the venue refused the SEND before the wallet composed it: ${quote?.status}`)
            .toBe(true);

        await gotoPalette(page, 'Advanced action');
        const main = page.getByRole('main');
        await expect(main.getByLabel('Action')).toBeVisible({ timeout: 30_000 });
        await selectVenueChain(main);
        await main.getByLabel('Action').selectOption('SEND');
        await main.getByRole('textbox', { name: 'TICK', exact: true }).fill(SEND_TICK);
        await main.getByRole('textbox', { name: 'AMOUNT', exact: true })
            .fill(String(SEND_AMOUNT));
        await main.getByRole('textbox', { name: 'DESTINATION', exact: true })
            .fill(REGTEST_DESTINATION);
        await setNativeFee(main, true);
        await main.getByRole('button', { name: 'Sign action', exact: true }).click();

        await expectConfirmModal(page, 'the SEND', 120_000);
        const action = await waitForValidAction(await approveAndGetTxid(page), 1_200_000);
        expect(String(action.action)).toBe('SEND');
        const sent = (action.sends || []).find((row) => (
            String(row.tick) === SEND_TICK && String(row.destination) === REGTEST_DESTINATION
        ));
        expect(sent, 'the indexed SEND does not contain the form destination and ticker').toBeTruthy();
        expect(Number(sent.amount)).toBe(SEND_AMOUNT);
        expect(String(sent.status)).toBe('valid');
        await assertNativeFeeRecord(action, quote);
        await waitForTokenBalance(REGTEST_DESTINATION, SEND_TICK, SEND_AMOUNT, 1_200_000);
        await waitForExactTokenBalance(source, SEND_TICK, Number(SUPPLY) - SEND_AMOUNT);
    });

    test('the Mint form submits native mode and increases the indexed supply', async ({ page }) => {
        const source = await setupFundedWallet(page, 'Native MINT Wallet');
        await issueToken(page, MINT_TICK, { initialMint: INITIAL_MINT });
        await waitForTokenBalance(source, MINT_TICK, Number(INITIAL_MINT), 1_200_000);
        await page.reload();
        await unlockAfterReload(page, PASSWORD);

        const params = `0|${MINT_TICK}|${MINT_AMOUNT}`;
        const quote = await feeQuote('MINT', params, source);
        expect(quote?.valid, `the venue refused the MINT before the wallet composed it: ${quote?.status}`)
            .toBe(true);

        await gotoPalette(page, 'Mint supply');
        const main = page.getByRole('main');
        await expect(main.getByRole('textbox', { name: /^Amount/ }))
            .toBeVisible({ timeout: 30_000 });
        await selectVenueChain(main);
        await pickMintToken(page, MINT_TICK);
        await main.getByRole('textbox', { name: /^Amount/ }).fill(String(MINT_AMOUNT));
        await setNativeFee(main, true);
        await main.getByRole('button', { name: 'Mint', exact: true }).click();

        await expectConfirmModal(page, 'the MINT', 120_000);
        const action = await waitForValidAction(await approveAndGetTxid(page), 1_200_000);
        expect(String(action.action)).toBe('MINT');
        expect(String(action.tick)).toBe(MINT_TICK);
        expect(Number(action.amount)).toBe(MINT_AMOUNT);
        await assertNativeFeeRecord(action, quote);
        await waitForTokenBalance(
            source,
            MINT_TICK,
            Number(INITIAL_MINT) + MINT_AMOUNT,
            1_200_000,
        );
    });
});
