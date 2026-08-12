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
// TWO LANES, both on ISSUE, both on BITCOIN - and Bitcoin is the deliberate
// choice. Off Bitcoin `mandatory` forces the flag on, so "the flag reached the
// wire" would be true no matter what the form did with it; on Bitcoin the flag
// is a genuine opt-in, which is the only place the question has an answer.
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
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    switchToRegtest,
    unlockAfterReload,
    warmFeeQuote,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const TICK = `FEE${Date.now().toString().slice(-7)}`;
const SUPPLY = '1000';

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

async function nudgeChain() {
    try {
        const status = await explorerJson('status');
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient */ }
}

/** The venue's own answer for what this action's protocol fee costs in coin. */
async function feeQuote(params) {
    // Retried, not read once. This venue's fee-quote path stalls past the
    // explorer's 5s indexer-hop timeout often enough to redden this spec on a
    // perfectly healthy stack  , and reading it cold at the top of a
    // run is the likeliest moment to hit it. The failure then reads as a
    // price-seed problem that is not there.
    return warmFeeQuote({ action: 'ISSUE', params });
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
    const name = /^Pay protocol fee in BTC instead of XCHAIN/;
    return scope.getByRole('switch', { name }).or(scope.getByRole('checkbox', { name })).first();
}

/**
 * Fills the issue form and returns it, leaving the caller to submit.
 *
 * `tick` varies per call because a tick is claimed once on chain: reusing one
 * would make the second build fail for a reason that has nothing to do with
 * fees.
 */
async function fillIssueForm(page, tick, { nativeFee }) {
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
    return main;
}

test.describe('the native-fee flag on each submit lane', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('the flag reaches the wire on the confirm path and on the watcher build', async ({ page }) => {
        let source;
        let quotedSats;

        await test.step('onboard and fund on Bitcoin', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Fee Lane Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            source = await main.getByLabel('From').inputValue();
            expect(source, 'the form has no Bitcoin address to sign with').toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // The venue's own price of this action, read BEFORE composing so the
            // spec fails on a stale oracle with that named rather than blaming
            // the wallet several steps later (§3.2).
            const quote = await feeQuote(`${TICK}|${SUPPLY}|0|0|0`);
            expect(quote?.valid,
                `the venue cannot price this action (${quote?.status}); seed the sentinels at wall `
                + 'clock per campaign §3.2 before re-running - this is a venue state, not a wallet bug')
                .toBe(true);
            quotedSats = Number(quote.requiredFeeSats);
            expect(quotedSats, 'the quoted protocol fee is not a positive number of sats')
                .toBeGreaterThan(0);
        });

        await test.step('LANE 1: the confirm path pays the fee in coin, on chain', async () => {
            const main = await fillIssueForm(page, TICK, { nativeFee: true });
            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            // In full mode this form is SINGLE-ENCODE: the form button
            // composes and opens the confirm screen directly, with no review
            // stage in between. Watcher mode is the one that gets "Preview".
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
            await page.getByTestId('confirm-approve').click();

            // Read the RESULT off the chain rather than off the screen: the
            // screen is what already showed can be wrong about fees.
            const until = Date.now() + 300_000;
            let action = null;
            while (Date.now() < until && !action) {
                const list = await explorerJson('actions?limit=50');
                const row = (list?.data || []).find((a) => a.source === source);
                if (row) {
                    const detail = await explorerJson(`action/${row.action_index}`);
                    if (String(detail?.tick) === TICK || String(detail?.tx_data || '').includes(TICK)) {
                        action = detail;
                    }
                }
                if (!action) { await nudgeChain(); await new Promise((r) => setTimeout(r, 2_000)); }
            }
            expect(action, `the ISSUE of ${TICK} never reached the chain`).toBeTruthy();
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
            expect(String(action.fee?.native_coin)).toBe('BTC');
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

            const off = await build(`${TICK}A`, false);
            // BACK VIA THE SCREEN'S OWN CONTROL, not the palette: re-selecting
            // "Issue token" while the route is already mounted changes no state,
            // so the form stays on its result screen and the second build never
            // starts. Same shape as D-117 on the betting hub - a command for the
            // route you are already on is a no-op - and here the wallet offers
            // "Build another" precisely for this.
            await page.getByRole('button', { name: 'Build another', exact: true }).click();
            const on = await build(`${TICK}B`, true);

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
});
