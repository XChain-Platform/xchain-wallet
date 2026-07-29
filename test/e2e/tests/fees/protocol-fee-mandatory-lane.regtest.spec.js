// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §11.1 + §11.2's owed browser half, OFF BITCOIN - the sibling of
// `protocol-fee-disclosure.regtest.spec.js` and the half that chain cannot run.
//
// WHY A SECOND FILE RATHER THAN A FLAG. Off Bitcoin,  makes the
// native-coin output the ONLY way to pay a protocol fee, so `useNativeFee`
// forces the flag on and the fee row is a statement instead of a choice. That
// makes this venue the wrong place to test a fee LANE (there is one) and the
// right place to test the fee AMOUNT end to end, because every fee-bearing
// action here pays real coin whether the user chose to or not. The two files
// therefore assert different things and neither is a parameterisation of the
// other.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/fees/protocol-fee-mandatory-lane.regtest.spec.js
//
// It refuses to run on Bitcoin rather than passing vacuously there (§11.4's
// lesson: a spec that would be true whatever the code did is a claim, not a
// test).
//
//   LEG 1, THE PRICED ACTION. An ISSUE on Litecoin quotes a real coin fee -
//     6,666,667 sats at this venue's seeded $30/LTC, which is three orders of
//     magnitude above the 5,460-sat dust floor that makes small fees unpayable
//     here ((b)). The confirm screen must project it as a Protocol fee row
//     ALONGSIDE the network fee and NOT as an XCHAIN line (the fee is a coin
//     debit on this chain, and a second XCHAIN figure would read as a second
//     charge). Then the payer's satoshis must fall by exactly
//     `network fee + protocol fee`. That last measurement is what §11.1 owes and
//     what Bitcoin cannot currently supply: its indexer is wedged (§3.7).
//
//   LEG 2, THE UNPRICED ACTION, which is §11.2's owed browser half. The fee row
//     on this chain used to state that a fee would be paid and forfeited on
//     actions that carry NO fee at all (D-114/) - MINT, BROADCAST,
//     DESTROY, SLEEP, LIST, LINK, PUBLISH, ATTACH, and the ordinary
//     under-90-day ORDER/SWAP/DISPENSER. This drives the CONFIRM screen for one
//     of them and asks the chain what it cost: no fee stated, no fee projected,
//     and no coin output beyond the miner's. Deliberately scoped to the confirm
//     screen and NOT to the authoring row's wording, which a concurrent session
//     was still editing for  while this was written; asserting on
//     half-written copy would report on their draft rather than on the product.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    encoderRpc,
    fundAddress,
    minerRpc,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
// The fee is 6,666,667 sats here, so 1 coin is a comfortable multiple of it
// without being so large that a wrong-by-an-output balance reads as noise.
const FUNDING = 1;
const SUPPLY = '1000';
const STAMP = Date.now().toString().slice(-6);
const TICK = `MLF${STAMP}`;
/** The chain's own ticker, which is what the fee rows are denominated in. */
const COIN = REGTEST_COIN.replace(/^R/, '');

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

async function feeQuote(action, params) {
    const q = new URLSearchParams({ action, params });
    return explorerJson(`feequote?${q.toString()}`);
}

/** Total confirmed satoshis the chain says this address controls. */
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

/**
 * The indexed action for a txid. Looked up in the LIST, never by probing an
 * index: a speculative `GET /api/action/<index>` before the indexer writes its
 * row poisons that index permanently (§3.6 / ).
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

/** The exact network fee of the composed PSBT, in satoshis, off the screen. */
async function screenNetworkFeeSats(page) {
    const text = await page.getByTestId('confirm-fee').innerText();
    const coin = Number(text.match(new RegExp(`([\\d.]+)\\s*${COIN}`))?.[1]);
    expect(Number.isFinite(coin), `unparseable network fee line: ${text}`).toBe(true);
    return Math.round(coin * 1e8);
}

/** The protocol-fee row in the balance projection, in satoshis, or null. */
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

/** Approves the open confirm screen and returns the broadcast txid. */
async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    // No \b anchors: this screen renders the id with no separators around it.
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'success screen showed no transaction id').toBeTruthy();
    return txid;
}

test.describe(`the mandatory native-fee lane on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test.beforeAll(() => {
        // Bitcoin has an XCHAIN lane, so `mandatory` is false there and every
        // assertion below would be about a different screen. Skipped loudly:
        // a silent skip on the wrong venue is how a suite reports coverage it
        // does not have.
        test.skip(REGTEST_COIN === 'RBTC',
            'this spec is about the chain where the coin fee is MANDATORY ; '
            + 'run it with XC_REGTEST_COIN=RLTC or RDOGE');
    });

    test('a priced action costs exactly what the screen projects, and an unpriced one costs only the miner fee', async ({ page }) => {
        let source;
        let quotedSats;

        await test.step('onboard and fund on the venue chain', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Mandatory Lane Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            // Every form has its OWN chain picker and they all default to
            // Bitcoin (§3.5): without this the run would compose on the wrong
            // chain and the address funded below would never be the payer.
            await selectVenueChain(main);
            source = await main.getByLabel('From').inputValue();
            expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            const quote = await feeQuote('ISSUE', `${TICK}|${SUPPLY}|0|0|0`);
            expect(quote?.valid,
                `the venue cannot price this action (${quote?.status}); this is venue state, not a `
                + 'wallet defect - see campaign §3.2 / ')
                .toBe(true);
            quotedSats = Number(quote.requiredFeeSats);
            // Above the dust floor by a wide margin, which is the condition
            // that makes this chain testable at all ((b)): a fee below
            // the floor can neither be paid nor skipped, and the wallet
            // correctly refuses before anything can be measured.
            expect(quotedSats, 'the venue quotes a dust-level coin fee, so re-seed the price per §3.2')
                .toBeGreaterThan(5_460);
        });

        await test.step('LEG 1: the priced action, screen against chain', async () => {
            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Ticker').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);

            // There is nothing to opt into on this chain, and that is the
            // premise of the whole file:  forces the coin lane, so the
            // row is a statement and no switch exists to flip.
            await expect(
                main.getByRole('switch', { name: /^Pay protocol fee in/ })
                    .or(main.getByRole('checkbox', { name: /^Pay protocol fee in/ })),
                `${COIN} offers a fee-lane choice, so 's mandatory rule is not in force here`)
                .toHaveCount(0);

            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });

            // No XCHAIN line: the fee is already a coin debit here, and stating
            // it a second time in XCHAIN would read as a second charge.
            await expect(page.getByTestId('confirm-protocol-fee'),
                'the coin-fee lane also states an XCHAIN protocol fee, which reads as being charged twice')
                .toHaveCount(0);

            const minerSats = await screenNetworkFeeSats(page);
            const projectedFeeSats = await projectedProtocolFeeSats(page);
            expect(projectedFeeSats,
                'the balance projection carries no protocol-fee row, so the screen shows the miner fee '
                + 'as the whole cost -  in the lane where the fee is a real output that '
                + 'inputs-minus-outputs cannot see')
                .toBe(quotedSats);

            const satsBefore = await coinBalanceSats(source);
            const txid = await approveAndGetTxid(page);
            const action = await waitForIndexedAction(txid);
            expect(String(action.action)).toBe('ISSUE');
            expect(String(action.status), 'the chain rejected the ISSUE this leg was measuring')
                .toBe('valid');
            expect(Number(action.fee?.payment_mode),
                'the action recorded an XCHAIN fee on a chain that has no XCHAIN fee lane')
                .toBe(1);
            expect(Math.round(Number(action.fee?.native_coin_amount) * 1e8),
                `the coin fee on chain is not the ${quotedSats} sats the screen projected`)
                .toBe(quotedSats);
            expect(String(action.fee?.native_coin)).toBe(COIN);

            // THE MEASUREMENT §11.1 OWES: what the screen said this costs
            // against what it cost. Before  these differed silently by
            // the whole protocol fee.
            const satsAfter = await coinBalanceSats(source);
            expect(satsBefore - satsAfter,
                `the screen projected ${minerSats + projectedFeeSats} sats (network ${minerSats} + `
                + `protocol ${projectedFeeSats}); the chain charged ${satsBefore - satsAfter}`)
                .toBe(minerSats + projectedFeeSats);

            // And no XCHAIN moved: this wallet holds none, so a fee debited
            // there as well would have failed on chain rather than silently,
            // but the assertion costs nothing and names the intent.
            expect(await tokenBalance(source, 'XCHAIN'),
                'the mandatory coin lane also touched an XCHAIN balance')
                .toBe(0);
        });

        await test.step('LEG 2 (§11.2): the unpriced action states nothing and pays nothing extra', async () => {
            const zero = await feeQuote('BROADCAST', '1|mandatory lane zero check');
            expect(Number(zero?.requiredFeeSats),
                'BROADCAST is priced on this venue, so it cannot serve as the zero-fee case')
                .toBe(0);

            await gotoPalette(page, 'Broadcast a message');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Message')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Message').fill(`mandatory lane zero check ${STAMP}`);
            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await main.getByRole('button', { name: 'Broadcast', exact: true }).click();

            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });

            await expect(page.getByTestId('confirm-protocol-fee'),
                'the confirm screen states a protocol fee on an action this venue prices at zero, which '
                + 'is D-114/ reaching the screen the user signs from')
                .toHaveCount(0);
            expect(await projectedProtocolFeeSats(page),
                'the projection carries a protocol-fee row for a fee of zero')
                .toBeNull();

            const minerSats = await screenNetworkFeeSats(page);
            const satsBefore = await coinBalanceSats(source);
            const txid = await approveAndGetTxid(page);
            const action = await waitForIndexedAction(txid);
            expect(String(action.action)).toBe('BROADCAST');
            expect(String(action.status), 'the chain rejected the unpriced action').toBe('valid');

            // The screen's silence has to hold on chain: a zero quote must
            // attach no FEE_DESTINATION output at all, and on this chain that
            // is the one thing `mandatory` could plausibly have got wrong -
            // `applyNativeFeePreflight` guards both branches on `feeSats > 0`,
            // so a zero fee must neither trip the dust refusal nor attach a
            // zero-value output.
            const satsAfter = await coinBalanceSats(source);
            expect(satsBefore - satsAfter,
                `an unpriced action cost ${satsBefore - satsAfter} sats against a network fee of `
                + `${minerSats}, so it paid a protocol fee nothing quoted`)
                .toBe(minerSats);
        });
    });
});
