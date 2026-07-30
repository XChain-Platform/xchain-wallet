// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §11.1, 's browser half: does the confirm screen state what a
// fee-bearing action actually COSTS, in both payment lanes, and does the
// number it prints match what the chain then charges?
//
//  was measured twice by hand and fixed in code ( added the
// XCHAIN-lane line, composeActionForConfirm folds the native-lane quote into
// the projection). What was never driven is the whole claim end to end, and
// the campaign's own rule for this lane is "measure, do not read": every fee
// finding in it that came from reading a screen was wrong.
//
// So each lane is asked of the CHAIN as well as the screen, on the SAME action
// (ISSUE, which is what  was measured on) and on BITCOIN, the only chain
// where the lane is a choice at all - off Bitcoin  makes the coin output
// mandatory and the XCHAIN half has nowhere to run.
//
//   LANE 1, the DEFAULT XCHAIN lane. The screen must print the protocol fee as
//     an XCHAIN charge (it was silent about it entirely: the larger of the two
//     costs, missing, under a miner fee quoted to eight decimals). Measured
//     against the payer's XCHAIN balance before and after: the amount the
//     screen printed is the amount the chain debits.
//
//   LANE 2, the opt-in NATIVE lane. Here the fee is a real output to
//     FEE_DESTINATION, so it belongs in the coin projection - and
//     `networkFeeSats` is inputs-minus-outputs, which cannot see it by
//     construction. Measured against the payer's satoshis: what the screen
//     projected (network fee + protocol fee) is what the address actually lost.
//     Before the fix that difference was exactly the fee, silently.
//
// THE NEGATIVE IS THE SECOND TEST, and it is not decoration: the cheap way to
// "fix"  is to print a fee on everything, which trades a silent
// understatement for a confident lie on the many actions that charge nothing
// (BROADCAST, MINT, DESTROY, SLEEP, ... - see ). BROADCAST is priced at
// exactly zero by this venue's own schedule, so it is driven in BOTH lanes and
// must stay silent in both, and its coin cost on chain must be the miner fee
// alone - a stray fee output would show up there even if no screen mentioned it.
//
// PRE-FLIGHT: ISSUE is priced, so the venue needs a usable BTC/USD snapshot;
// global setup's `seedPrices()`  guarantees one or fails naming the
// venue. The quote is read here anyway BEFORE composing, so a stale oracle
// fails with that named instead of looking like a wallet defect three steps
// later (§3.2).

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    REGTEST_DESTINATION,
    encoderRpc,
    fundAddress,
    minerRpc,
    mintXchain,
    tokenBalance,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const SUPPLY = '1000';
const STAMP = Date.now().toString().slice(-6);
const TICK_XCHAIN_LANE = `PFX${STAMP}`;
const TICK_NATIVE_LANE = `PFN${STAMP}`;
// Covers a 1 XCHAIN ISSUE fee twice over with room to see a wrong debit as
// wrong rather than as an empty balance.
const XCHAIN_MINT = 10;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/** The venue's own price for this action, in both denominations. */
async function feeQuote(action, params) {
    const q = new URLSearchParams({ action, params });
    return explorerJson(`feequote?${q.toString()}`);
}

/** Total confirmed satoshis the chain says this address controls. */
async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
}

/**
 * Mines only when something is actually waiting for a block (§3.5, session 29).
 *
 * A block is never needed to make an already-mined action visible, so a loop
 * that mines on every pass just outruns the decoder - and that is a feedback
 * loop, because a lagging decoder makes the next wait longer, which mines more.
 * The fixture's `waitForValidAction` does exactly that and cost this spec a run:
 * it drove the chain 161 blocks forward and left the decoder 149 behind, so a
 * broadcast ISSUE that was sitting in a block never indexed inside its budget.
 */
async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

/**
 * The indexed action for a txid, waited for without flooding the venue.
 *
 * Looks it up in the LIST rather than probing an action index: the list only
 * ever contains indexed actions, while a speculative
 * `GET /api/action/<index>` before the indexer writes its row poisons that
 * index permanently (§3.6 / , unfixed on this venue). Status is asserted
 * by the caller, since "an action was recorded" includes `invalid`.
 */
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
    throw new Error(
        `No XChain action recorded for ${txid} within ${Math.round(timeoutMs / 1000)}s. `
        + `Chain tip ${status?.chain_tip?.[REGTEST_COIN]}, decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}. A non-zero decoder lag means the venue is `
        + 'behind, not that the wallet sent something wrong.');
}

/**
 * The XCHAIN balance once a debit has settled.
 *
 * Polled rather than read once: the fee is charged as the block INDEXES, and
 * the balances endpoint can still be answering from the moment before that even
 * though the action row is already there. Bounded, and it returns the last
 * figure it saw when the budget runs out - so a fee that was never charged at
 * all fails the caller's assertion, with both numbers named, rather than
 * failing in here.
 */
async function settledXchainBalance(address, before, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let last = before;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, 'XCHAIN');
        if (last !== before) return last;
        await new Promise((r) => setTimeout(r, 2_000));
    }
    return last;
}

/**
 * The exact network fee the composed PSBT pays, in satoshis, off the confirm
 * screen's own line (§5.2.5 - the composed value, never a rate estimate).
 */
async function screenNetworkFeeSats(page) {
    const text = await page.getByTestId('confirm-fee').innerText();
    const coin = Number(text.match(/([\d.]+)\s*BTC/)?.[1]);
    expect(Number.isFinite(coin), `unparseable network fee line: ${text}`).toBe(true);
    return Math.round(coin * 1e8);
}

/**
 * The protocol-fee row inside the balance projection, in satoshis, or null
 * when the projection does not carry one.
 *
 * Read out of the deltas panel rather than off a dedicated testid because that
 * is where the fix put it: the row rides beside the coin balance row it was
 * folded into, so a fee that is claimed in words but missing from the
 * projection is exactly the failure this reads for.
 */
async function projectedProtocolFeeSats(page) {
    const deltas = page.getByTestId('action-intent-deltas');
    if (await deltas.count() === 0) return null;
    const text = await deltas.innerText();
    // Tolerant on the separator: the label and the amount are sibling spans in
    // a flex row, so whether innerText puts a newline, a space or nothing
    // between them is a layout detail this assertion must not depend on.
    const coin = text.match(/Protocol fee\s*BTC\s*([\d.]+)/)?.[1];
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

/** The native-fee opt-in, which on Bitcoin is a real control. */
function feeToggle(scope) {
    const name = /^Pay protocol fee in BTC instead of XCHAIN/;
    return scope.getByRole('switch', { name }).or(scope.getByRole('checkbox', { name })).first();
}

async function setFeeLane(scope, nativeFee) {
    const toggle = feeToggle(scope);
    await expect(toggle, 'Bitcoin does not offer the fee choice this spec is about')
        .toBeVisible({ timeout: 30_000 });
    if (nativeFee !== (await toggle.isChecked())) await toggle.click();
    await expect(toggle).toBeChecked({ checked: nativeFee });
}

/** Fills the Issue form in the requested fee lane and opens the confirm screen. */
async function composeIssue(page, tick, { nativeFee }) {
    // HOME FIRST, and it is not tidiness. This test composes TWICE, and after
    // the first broadcast the shell is sitting on the Issue form's own "Token
    // issued" terminal screen. Asking the palette for "Issue token" from there
    // routes to a screen already active, so nothing remounts and the form stays
    // done: the second lane then waits 30s for a Ticker field that is not on
    // screen. Bouncing through Home forces the remount. (Session 32; the same
    // shape the multi-recipient spec records as "the mint left the shell on its
    // terminal screen".)
    await gotoPalette(page, 'Home');
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await main.getByLabel('Ticker').fill(tick);
    await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);
    await setFeeLane(main, nativeFee);

    const password = main.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    // Full mode is SINGLE-ENCODE : this button composes and opens the
    // confirm screen directly, with no review stage in between.
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();

    await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    return main;
}

/** Approves the open confirm screen and returns the broadcast txid. */
async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    // No \b anchors: this screen renders the id with no separator around it
    // ("Transaction IDae0d…Done"), so a word-boundary pattern never matches
    // even though the id is right there. Cost a run.
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'success screen showed no transaction id').toBeTruthy();
    return txid;
}

test.describe('what a fee-bearing action costs: the confirm screen against the chain', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('both lanes state the protocol fee, and each one matches what the chain charges', async ({ page }) => {
        let source;
        let quotedXchain;
        let quotedSats;

        await test.step('onboard, fund, and mint the gas token', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Fee Disclosure Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            source = await main.getByLabel('From').inputValue();
            expect(source, 'the form has no Bitcoin address to sign with').toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // The XCHAIN lane debits a real balance, so it needs one: without
            // it the pre-flight would refuse the action for insufficient FEE
            // and the screen under test would never open (that refusal is
            // §11.5's subject, driven there).
            await mintXchain(page, XCHAIN_MINT);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_MINT);

            const quote = await feeQuote('ISSUE', `${TICK_XCHAIN_LANE}|${SUPPLY}|0|0|0`);
            expect(quote?.valid,
                `the venue cannot price this action (${quote?.status}); this is venue state, not a `
                + 'wallet defect - see campaign §3.2 / ')
                .toBe(true);
            quotedXchain = Number(quote.xchainFee);
            quotedSats = Number(quote.requiredFeeSats);
            expect(quotedXchain, 'the venue quotes no XCHAIN fee for a priced action').toBeGreaterThan(0);
            expect(quotedSats, 'the venue quotes no coin fee for a priced action').toBeGreaterThan(0);
        });

        await test.step('LANE 1: the XCHAIN lane names the fee, and the chain debits that amount', async () => {
            await composeIssue(page, TICK_XCHAIN_LANE, { nativeFee: false });

            // The line / exists for. Its absence IS the defect:
            // the screen priced the miner fee to eight decimals and said
            // nothing about the larger charge beside it.
            const line = page.getByTestId('confirm-protocol-fee');
            await expect(line,
                'the confirm screen says nothing about the protocol fee in the XCHAIN lane, which is '
                + ' exactly: the larger of the two costs, missing')
                .toBeVisible();
            const said = await line.innerText();
            const shown = Number(said.match(/([\d.]+)\s*XCHAIN/)?.[1]);
            expect(shown, `unparseable protocol-fee line: ${said}`).toBe(quotedXchain);
            // Which balance it comes out of, and that it is contingent: a bare
            // number cannot say either, and both are things the user needs.
            expect(said).toMatch(/from your XCHAIN balance/i);
            expect(said).toMatch(/only if the action is accepted/i);

            // And it is NOT the miner-fee line wearing a different label: the
            // two costs are stated separately, in their own denominations.
            const minerSats = await screenNetworkFeeSats(page);
            expect(minerSats, 'the composed PSBT pays no network fee at all').toBeGreaterThan(0);

            const xchainBefore = await tokenBalance(source, 'XCHAIN');
            const satsBefore = await coinBalanceSats(source);

            const txid = await approveAndGetTxid(page);
            const action = await waitForIndexedAction(txid);
            expect(String(action.action)).toBe('ISSUE');
            expect(String(action.status), 'the chain rejected the ISSUE this lane was measuring')
                .toBe('valid');
            // The fee record is the chain's own statement of which lane paid:
            // mode 2 is the XCHAIN debit. Read under `fee`, since the
            // top-level `payment_mode` is null on every action.
            expect(Number(action.fee?.payment_mode),
                'the action paid its fee in coin, so this is not the lane the screen described')
                .toBe(2);

            // MEASURED, not read: the amount the screen printed is the amount
            // the payer lost.
            const xchainAfter = await settledXchainBalance(source, xchainBefore);
            expect(Number((xchainBefore - xchainAfter).toFixed(8)),
                `the screen said ${shown} XCHAIN; the chain debited `
                + `${(xchainBefore - xchainAfter).toFixed(8)}`)
                .toBe(shown);

            // And the coin side of this lane pays the miner and nobody else -
            // an XCHAIN-lane action that also attached a coin fee output would
            // be charging twice for one fee.
            const satsAfter = await coinBalanceSats(source);
            expect(satsBefore - satsAfter,
                'the XCHAIN lane spent more coin than the network fee on screen, so something '
                + 'attached a coin fee output as well as debiting XCHAIN (a figure far larger than '
                + 'either fee would instead mean the change left this address, which the wallet '
                + 'does not do: buildActionPsbt sets change = source)')
                .toBe(minerSats);
        });

        await test.step('LANE 2: the native lane projects the coin cost the chain then takes', async () => {
            await composeIssue(page, TICK_NATIVE_LANE, { nativeFee: true });

            // No XCHAIN line here, deliberately: the fee is already disclosed
            // as a coin debit below, and a second line in XCHAIN would read as
            // a second, separate charge.
            await expect(page.getByTestId('confirm-protocol-fee'),
                'the native lane shows an XCHAIN protocol-fee line as well as the coin debit, which '
                + 'reads as being charged twice')
                .toHaveCount(0);

            const minerSats = await screenNetworkFeeSats(page);
            const projectedFeeSats = await projectedProtocolFeeSats(page);
            expect(projectedFeeSats,
                'the balance projection carries no protocol-fee row, so the screen is showing the '
                + 'miner fee as the whole cost -  in the native lane, where the fee is a real '
                + 'output the miner-fee arithmetic cannot see')
                .toBe(quotedSats);

            const satsBefore = await coinBalanceSats(source);
            const xchainBefore = await tokenBalance(source, 'XCHAIN');

            const txid = await approveAndGetTxid(page);
            const action = await waitForIndexedAction(txid);
            expect(String(action.status), 'the chain rejected the ISSUE this lane was measuring')
                .toBe('valid');
            expect(Number(action.fee?.payment_mode),
                'the action recorded an XCHAIN fee, so the coin lane the screen described never '
                + 'reached the wire')
                .toBe(1);
            expect(Math.round(Number(action.fee?.native_coin_amount) * 1e8),
                `the coin fee on chain is not the ${quotedSats} sats the screen projected`)
                .toBe(quotedSats);

            // THE MEASUREMENT THIS SECTION EXISTS FOR: what the screen said
            // the action costs, against what it cost. Before the fix these
            // differed by exactly the protocol fee, silently.
            const satsAfter = await coinBalanceSats(source);
            expect(satsBefore - satsAfter,
                `the screen projected ${minerSats + projectedFeeSats} sats (network ${minerSats} + `
                + `protocol ${projectedFeeSats}); the chain charged ${satsBefore - satsAfter}`)
                .toBe(minerSats + projectedFeeSats);

            // The other half of "not charged twice", from the balance side.
            const xchainAfter = await tokenBalance(source, 'XCHAIN');
            expect(Number((xchainBefore - xchainAfter).toFixed(8)),
                'the native lane also debited XCHAIN, so the fee was paid twice')
                .toBe(0);
        });

    });

    // FOUND BY THIS SPEC, on its second run, and kept as its OWN test because
    // it needs nothing from the chain but a utxo: no XCHAIN, no broadcast, no
    // indexing. That independence is worth having - the run that found the
    // defect also wedged this venue's indexer on an unrelated one , and
    // a guard that only runs when the whole pipeline is healthy is a guard that
    // will be skipped exactly when it matters.
    test('the protocol fee is still stated when the dry run does not answer ', async ({ page }) => {
        // The XCHAIN-lane fee line read ONLY the pre-flight report, and that
        // report is best-effort: the SDK's Tier-1 dry run has a 4000ms budget
        // and the wallet drops the verdict when the indexer misses it. So on a
        // merely busy venue the screen went back to quoting the miner fee alone
        // with the larger charge unmentioned - 's screen, silently. It
        // happened spontaneously, twice in one hour, on the same action.
        //
        // Engineered here rather than waited for: the dry run is aborted at the
        // network, which from the wallet's point of view is what a timeout is.
        // `/feequote` is deliberately NOT blocked - it is the source the fix
        // falls back to, and it is a different endpoint from the one that is
        // allowed to be slow.
        let quotedXchain;

        await test.step('onboard and fund', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Dry Run Down Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            const source = await main.getByLabel('From').inputValue();
            expect(source).toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            const quote = await feeQuote('ISSUE', `PFB${STAMP}|${SUPPLY}|0|0|0`);
            expect(quote?.valid, `the venue cannot price this action (${quote?.status})`).toBe(true);
            quotedXchain = Number(quote.xchainFee);
        });

        await page.route('**/api/preflight*', (route) => route.abort());
        try {
            await composeIssue(page, `PFB${STAMP}`, { nativeFee: false });

            // The dry run really is unavailable, so this test is measuring what
            // it thinks it is: without this the assertion below could pass on a
            // report that arrived after all.
            await expect(page.getByTestId('preflight-panel'),
                'the dry run answered after all, so this proves nothing')
                .toContainText(/dry-run was unavailable/i);

            const line = page.getByTestId('confirm-protocol-fee');
            await expect(line,
                'with the dry run unavailable the screen states no protocol fee at all, so the '
                + 'disclosure is only as reliable as a 4-second budget on a shared venue ')
                .toBeVisible();
            expect(Number((await line.innerText()).match(/([\d.]+)\s*XCHAIN/)?.[1]),
                'the fallback quote does not agree with the venue')
                .toBe(quotedXchain);

            // Nothing is signed or sent: this is a screen, and the fee it names
            // is contingent on an acceptance that never happens here.
            await page.getByTestId('confirm-reject').click();
            await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
        } finally {
            await page.unroute('**/api/preflight*');
        }
    });

    test('an action that charges no protocol fee says nothing about one, in either lane', async ({ page }) => {
        let source;

        await test.step('onboard and fund', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Zero Fee Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Broadcast a message');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Message')).toBeVisible({ timeout: 30_000 });
            source = await main.getByLabel('From').inputValue();
            expect(source, 'the form has no Bitcoin address to sign with').toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // The venue's own answer, so this test knows it is driving a
            // genuinely unpriced action rather than assuming one.
            // VERSION leads the param list, and without it the quote comes
            // back `invalid: VERSION (unknown)` with a null fee - which reads
            // as "this venue prices BROADCAST" and is really a malformed ask.
            const quote = await feeQuote('BROADCAST', '1|zero fee check');
            expect(Number(quote?.requiredFeeSats),
                'BROADCAST is priced on this venue, so it cannot serve as the zero-fee case')
                .toBe(0);
            expect(Number(quote?.xchainFee)).toBe(0);
        });

        const composeBroadcast = async (message, nativeFee) => {
            await gotoPalette(page, 'Broadcast a message');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Message')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Message').fill(message);
            await setFeeLane(main, nativeFee);
            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await main.getByRole('button', { name: 'Broadcast', exact: true }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
        };

        await test.step('the XCHAIN lane claims no charge on an unpriced action', async () => {
            await composeBroadcast(`no fee here ${STAMP}`, false);
            await expect(page.getByTestId('confirm-protocol-fee'),
                'the screen states a protocol fee on an action this venue prices at zero, which is '
                + 'the opposite failure to  and just as wrong')
                .toHaveCount(0);
            expect(await projectedProtocolFeeSats(page),
                'the balance projection carries a protocol-fee row for a fee of zero')
                .toBeNull();
            await page.getByTestId('confirm-reject').click();
            await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
        });

        await test.step('the native lane attaches nothing, on screen or on chain', async () => {
            await composeBroadcast(`no fee here either ${STAMP}`, true);
            await expect(page.getByTestId('confirm-protocol-fee')).toHaveCount(0);
            expect(await projectedProtocolFeeSats(page),
                'the native lane projects a coin protocol fee for an action that charges none')
                .toBeNull();

            const minerSats = await screenNetworkFeeSats(page);
            const satsBefore = await coinBalanceSats(source);

            const txid = await approveAndGetTxid(page);
            const action = await waitForIndexedAction(txid);
            expect(String(action.action)).toBe('BROADCAST');
            expect(String(action.status), 'the chain rejected the unpriced action').toBe('valid');

            // The screen's silence has to be true on chain too: a zero quote
            // must attach no fee output at all, and that is visible in the
            // payer's balance whether or not any screen mentioned it.
            const satsAfter = await coinBalanceSats(source);
            expect(satsBefore - satsAfter,
                `an unpriced action cost ${satsBefore - satsAfter} sats against a network fee of `
                + `${minerSats}, so it paid a protocol fee nothing quoted`)
                .toBe(minerSats);
        });

        await test.step('a plain payment has no protocol fee to state', async () => {
            await gotoSection(page, 'Send');
            await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
            await page.getByRole('textbox', { name: /^Amount/ }).fill('0.01');
            await mainButton(page, 'Send').click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            // A bare native payment carries no XChain action at all ,
            // so there is no fee to disclose and nothing to project.
            await expect(page.getByTestId('confirm-protocol-fee'),
                'a plain coin payment claims a protocol fee')
                .toHaveCount(0);
            expect(await projectedProtocolFeeSats(page)).toBeNull();
            await page.getByTestId('confirm-reject').click();
        });
    });
});
