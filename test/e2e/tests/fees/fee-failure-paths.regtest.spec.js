// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §11.5, the two balance-shaped fee failure paths: the payer cannot
// afford the protocol fee, in each of the two lanes that fee can be settled in.
//
// THE EXPENSIVE FAILURE MODE THIS EXISTS FOR, in the campaign's own words: an
// action that fails consensus AFTER paying a real miner fee. That is what the
// bug did on LTC/DOGE, and it is why every step below ends by asking the
// CHAIN whether anything moved rather than asking the screen. A refusal that
// broadcasts nothing costs the user nothing; a refusal that broadcasts first is
// the same defect wearing a polite sentence.
//
// BITCOIN, deliberately. Bitcoin is the only chain with two lanes: the protocol
// fee is debited from an XCHAIN balance by default and paid as a coin output
// only when the user opts in. Off Bitcoin a later change makes the coin output
// mandatory, so the XCHAIN-lane half of this spec has nowhere to run.
//
//   LANE 1 (XCHAIN mode, no XCHAIN): the wallet must not treat "I hold no
//     XCHAIN" as a compose-time surprise. The dry run knows - the indexer
//     answers `invalid: insufficient funds (FEE)` for exactly this - so the
//     confirm screen must say the network expects this to fail and put Approve
//     behind an explicit override, not silently sign it.
//
//   LANE 2 (native mode, not enough coin): the fee is a real output, so a payer
//     that cannot fund it cannot build the transaction at all. This must fail
//     at COMPOSE, with a sentence rather than an encoder's developer wording
//, and nothing may reach the mempool.
//
// The two lanes are driven from ONE address in a deliberate order - lane 2 while
// it is nearly empty, lane 1 after it is funded - because that is what makes
// each shortfall the only variable. A wallet with a second funded address would
// let a lane pass for the wrong reason.
//
// PRE-FLIGHT: ISSUE is priced, so the venue needs a usable BTC/USD snapshot
// (§3.2). The step below asks the venue for the quote FIRST and fails
// naming the seed, so a stale oracle can never be mistaken for the refusal this
// spec is about - which on this spec would be a false PASS, since both lanes
// assert that something was refused.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    encoderRpc,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const SUPPLY = '1000';
const STAMP = Date.now().toString().slice(-6);
const TICK_NATIVE = `FEB${STAMP}`;
const TICK_XCHAIN = `FEX${STAMP}`;

// Enough to hold utxos and pay a miner fee, and nowhere near the ~2,000 sats a
// priced action's coin fee costs at this venue's seeded prices. Deliberately not
// zero: an EMPTY address takes the NO_UTXOS path, which already words,
// and this lane is about the payer who has SOME coin and still cannot cover the
// fee - the case that path never sees.
const DUST_FUNDING = 0.00001;
const FULL_FUNDING = 1;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/** Total confirmed satoshis the chain says this address controls. */
async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
}

/** How many transactions are waiting to be mined, per the venue's own miner. */
async function mempoolSize() {
    const status = await minerRpc('status', {});
    return Number(status?.mempool_size ?? -1);
}

/**
 * Asserts that a refusal really was free: nothing queued, nothing spent.
 *
 * Both halves are needed. An empty mempool alone would also be true one block
 * AFTER a broadcast, and an unchanged balance alone would be true while a
 * transaction sat unconfirmed. Together they say the wallet never signed.
 */
async function expectNothingSpent(address, sats, label) {
    expect(await mempoolSize(), `${label}: something was broadcast before the refusal`).toBe(0);
    expect(await coinBalanceSats(address),
        `${label}: the payer's coin balance moved, so a miner fee was paid for an action that failed`)
        .toBe(sats);
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

/** Fills the issue form and submits it, leaving the caller to judge the outcome. */
async function submitIssue(page, tick, { nativeFee }) {
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await main.getByLabel('Ticker').fill(tick);
    await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);

    const toggle = feeToggle(main);
    await expect(toggle, 'Bitcoin does not offer the fee choice this spec is about')
        .toBeVisible({ timeout: 30_000 });
    if (nativeFee !== (await toggle.isChecked())) await toggle.click();
    await expect(toggle).toBeChecked({ checked: nativeFee });

    const password = main.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();
    return main;
}

test.describe('§11.5 fee failure paths: the payer cannot afford the protocol fee', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_200_000);

    test('neither fee lane broadcasts when the payer cannot cover the fee', async ({ page }) => {
        let source;
        let quotedSats;

        await test.step('onboard on Bitcoin and price the action', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Fee Failure Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            source = await main.getByLabel('From').inputValue();
            expect(source, 'the form has no Bitcoin address to sign with').toMatch(REGTEST_ADDRESS_RE);

            const q = new URLSearchParams({ action: 'ISSUE', params: `0|${TICK_NATIVE}|${SUPPLY}|0|8` });
            const quote = await explorerJson(`feequote?${q.toString()}`);
            expect(quote?.valid,
                `the venue cannot price this action (${quote?.status}); seed the sentinels per campaign `
                + '§3.2 before re-running - this is a venue state, not a wallet bug, and on THIS spec an '
                + 'unpriced action would refuse for the wrong reason and look like a pass')
                .toBe(true);
            quotedSats = Number(quote.requiredFeeSats);
            expect(quotedSats, 'the quoted protocol fee is not a positive number of sats')
                .toBeGreaterThan(0);

            // A fresh wallet holds no XCHAIN, which is lane 1's whole premise.
            // Asserted rather than assumed: an address that somehow held some
            // would make lane 1 pass by composing successfully.
            const balances = await explorerJson(`balances/${source}`);
            const xchain = (balances?.data || []).find((b) => b.tick === 'XCHAIN');
            expect(Number(xchain?.amount || 0),
                'this address already holds XCHAIN, so the XCHAIN-lane shortfall cannot be driven from it')
                .toBe(0);
        });

        await test.step('LANE 2: native mode with too little coin refuses at compose', async () => {
            await fundAddress(source, DUST_FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            const funded = await coinBalanceSats(source);
            expect(funded,
                `this lane needs a balance under the ${quotedSats}-sat fee to mean anything`)
                .toBeLessThan(quotedSats);

            const main = await submitIssue(page, TICK_NATIVE, { nativeFee: true });

            // A compose that cannot fund the fee output must never reach the
            // confirm screen: there is no transaction to confirm.
            const alert = main.getByRole('alert').filter({ hasText: /\S/ }).last();
            await expect(alert, 'the form neither refused nor explained itself')
                .toBeVisible({ timeout: 120_000 });
            const said = (await alert.textContent() || '').trim();
            // eslint-disable-next-line no-console
            console.log(`[§11.5 lane 2] native mode, ${funded} sats held, ${quotedSats} sats owed:\n  ${said}`);

            expect(page.getByTestId('confirm-modal'),
                'the wallet opened a confirm screen for a transaction it could not build')
                .toBeHidden();
            await expectNothingSpent(source, funded, 'lane 2');

            // The wording is the assertion, not decoration: this sentence is what
            // exists to guarantee. It must not be the SDK's developer
            // wording, and it must name the coin shortfall rather than blaming
            // the price feed (the D-111 mistake, in the opposite direction).
            expect(said, 'the refusal is the encoder\'s developer wording, not a sentence')
                .not.toMatch(/UTXO|utxo-tracker|create_tx|RPC|SDKEncoderError/i);
            expect(said, 'the refusal blames the price feed for a balance the user could top up')
                .not.toMatch(/temporarily unavailable/i);
            // The one thing the user cannot check for themselves, and the thing
            // the two assertions above have just PROVEN against the chain: no
            // money moved. A refusal that is silent about this reads as "it
            // might have half-happened", which is what makes people submit twice.
            expect(said, 'the refusal never tells the user nothing was spent')
                .toMatch(/[Nn]othing was signed or sent/);
        });

        await test.step('LANE 1: XCHAIN mode with no XCHAIN warns and gates Approve', async () => {
            await fundAddress(source, FULL_FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            const funded = await coinBalanceSats(source);

            await submitIssue(page, TICK_XCHAIN, { nativeFee: false });

            // This lane DOES compose: the transaction is buildable, it is the
            // chain that would reject it. So the refusal belongs on the confirm
            // screen, which is where the dry run's verdict is shown.
            await expect(page.getByTestId('confirm-modal'),
                'the XCHAIN-lane compose never reached a confirm screen')
                .toBeVisible({ timeout: 120_000 });
            const panel = page.getByTestId('preflight-panel');
            await expect(panel, 'the confirm screen ran no pre-flight at all')
                .toBeVisible({ timeout: 120_000 });
            await expect(panel,
                'the dry run did not report a failure, so the confirm screen is asking about a '
                + 'different transaction than the one that was built (the D-119 shape)')
                .toHaveAttribute('data-verdict', 'fail', { timeout: 120_000 });
            await expect(page.getByTestId('preflight-chip')).toHaveText('Will likely fail');
            await expect(panel,
                'the panel does not say WHY, so the user cannot tell a fee shortfall from any other refusal')
                .toContainText(/insufficient funds \(FEE\)/);

            // Approve must be gated, and gated by an UNCHECKED override: a
            // disabled button with the box already ticked would be one stray
            // click from signing.
            const ack = page.getByTestId('ack-DRYRUN_INVALID');
            await expect(ack, 'there is no "Sign anyway" override next to the failing finding')
                .toBeVisible();
            await expect(ack, 'the override is pre-acknowledged').not.toBeChecked();
            await expect(page.getByTestId('confirm-approve'),
                'Approve is live on an action the network says will fail')
                .toBeDisabled();

            await page.getByTestId('confirm-reject').click();
            await expect(page.getByTestId('confirm-modal')).toBeHidden({ timeout: 30_000 });
            await expectNothingSpent(source, funded, 'lane 1');
        });
    });
});
