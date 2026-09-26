// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Batch and Parallel composers (§42.8.2), driven against a live
// regtest chain. Both let a power user queue several actions by hand
// (action + raw JSON params) and were exercised only against the dev-mock
// SDK before this file, so neither had ever produced a signature the chain
// accepted.
//
// THE ONE THING THAT DISTINGUISHES THEM, AND WHY EACH GETS ITS OWN
// ASSERTION SHAPE. Batch bundles every queued step into ONE transaction
// under ONE signature (`BatchComposerForm.jsx`'s own header: "not the same
// as all-or-nothing", but still one signed tx); Parallel signs and
// broadcasts each row as its OWN transaction, sequentially, with no atomicity
// at all. So this file proves Batch by reading ONE action's wire content for
// both sub-commands, and proves Parallel by reading TWO independent actions
// off TWO independent transactions.
//
// WHY BOTH STEPS USE BROADCAST. BROADCAST v0 (message only, no VALUE/FEE) is
// the wallet's own zero-fee reference action
// (`tests/fees/protocol-fee-mandatory-lane.regtest.spec.js` uses exactly this
// fact to build its unpriced-action leg), so composing it needs no price
// seed and no XCHAIN gas, which keeps this file about the COMPOSER rather
// than about funding a second token. BATCH excludes FILE outright and caps
// ISSUE/DEPLOY at one each (`EXCLUDED_ACTIONS`, `validateBatchConstraints`);
// two BROADCASTs trip none of those constraints, which is exactly why they
// are the cheapest legal multi-step batch to compose.
//
// CHAIN SELECTION IS BY VALUE, NOT BY LABEL. Both composers render a plain
// HTML `<select>` for Chain (`option value={cid}`, unlike the ChainPicker
// popover `selectVenueChain` drives elsewhere), so `REGTEST_CHAIN_ID` -
// this venue's own chain id - selects it directly with no dependency on how
// `chainRegistry` formats a display name.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    ENCODER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    expectConfirmModal,
    explorerJson,
    fundAddress,
    healVenueClock,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const STAMP = Date.now().toString().slice(-6);

// How long to wait for the indexer to record a mined action. The fixture's
// 300s default is not enough on this shared rail: the indexer defers each
// new block behind the hub's oracle admission watermark, which was measured
// trailing the tip by three to five blocks for several minutes at a time
// (2026-09-26, RLTC: a Batch mined fine and took about 620s to index, past
// the 300s default). Both tests set a 30-minute budget, which still covers this.
const INDEX_BUDGET_MS = 1_200_000;

/** Opens the command palette and runs the first matching entry. */
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
 * Onboards a fresh wallet, funds its address on this run's chain, and
 * returns that address.
 *
 * Read off the Issue-token form rather than Receive, which has no Network
 * picker and follows the wallet's globally active chain: off Bitcoin that is
 * not this venue's chain. Both composers resolve their own default
 * "From address" the same way Send does (active address, else newest HD
 * external), which for a wallet that has never touched a second address is
 * necessarily this one.
 *
 * `utxos` is how many separate funding outputs the address gets. The
 * Parallel composer needs one per row: each row is its own transaction
 * built straight after the previous one, and the encoder will not spend a
 * change output that has not confirmed yet (it reserves the input row 1
 * used and refuses row 2 with "all 1 candidate input(s) are reserved").
 * A user with one coin sees the same refusal and retries the row once the
 * change confirms; this spec gives each row its own coin instead.
 */
async function onboardFundedWallet(page, walletName, { utxos = 1 } = {}) {
    await createWallet(page, { password: PASSWORD, name: walletName });
    await switchToRegtest(page, PASSWORD);

    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    const address = await main.getByLabel('From').inputValue();
    expect(address, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`).toMatch(REGTEST_ADDRESS_RE);

    for (let i = 0; i < utxos; i += 1) await fundAddress(address, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    return address;
}

// The composers' fields are plain <label><span>Name</span><select>, and
// getByLabel reads a wrapping label's WHOLE text, options included, so
// "Chain" also matched the Action select once an option description said
// "cross-chain" (a strict-mode failure on the first rail run). The
// accessible name is just the span, so match on role plus exact name.
const picker = (scope, name) => scope.getByRole('combobox', { name, exact: true });
const paramsBox = (scope) => scope.getByRole('textbox', { name: 'Params (JSON object)', exact: true });

/** Opens the catch-all Actions page ("More actions", off the pancake menu). */
async function gotoMoreActions(page) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
}

// Each catalogue entry's accessible name is its label immediately followed
// by its own description, with no separating space (`ActionsMenu.jsx` puts
// both in sibling spans inside the one button), so an `exact` match on the
// label alone can never resolve. Anchored at the start instead, on a prefix
// no other entry in the catalogue shares.
//
// The click itself is scoped to the `<main>` landmark ActionsMenu renders
// into (`Screen.jsx`), not just `page`, because a wallet the test named
// "Batch Composer Wallet" or "Parallel Composer Wallet" (see
// onboardFundedWallet below) also matches these same prefixes as the
// accessible name of `LeftNav.jsx`'s wallet-switcher button, which lives
// outside `<main>` in the sidebar - the prefix alone can't tell the two
// buttons apart, so the search is narrowed to the landmark instead.
async function gotoBatchComposer(page) {
    await gotoMoreActions(page);
    const menu = page.getByRole('main');
    await menu.getByRole('button', { name: /^Batch/ }).click();
    const main = page.getByRole('main');
    await expect(picker(main, 'Chain'), 'the Batch composer never rendered').toBeVisible({ timeout: 30_000 });
    return main;
}

async function gotoParallelComposer(page) {
    await gotoMoreActions(page);
    const menu = page.getByRole('main');
    await menu.getByRole('button', { name: /^Parallel cross-chain actions/ }).click();
    const main = page.getByRole('main');
    await expect(picker(main, 'Chain').first(), 'the Parallel composer never rendered').toBeVisible({ timeout: 30_000 });
    return main;
}

/** Fills the password when the confirm screen asks for one and approves. */
async function approveConfirm(page, what = 'this action') {
    await expectConfirmModal(page, what, 90_000);
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    const approve = page.getByTestId('confirm-approve');
    await expect(approve, 'Approve never became enabled on the confirm screen').toBeEnabled({ timeout: 120_000 });
    await approve.click();
}

/**
 * Signs the Parallel composer's active row.
 *
 * SignCredentials asks for a password only while the vault is locked. A
 * wallet this run just created and unlocked shows "Wallet unlocked. No
 * password needed." with no field at all, so the field is filled when it
 * is there and never required.
 */
async function signParallelRow(main) {
    const sign = main.getByRole('button', { name: 'Sign', exact: true });
    await expect(sign, 'the signing stage shows no Sign button').toBeVisible({ timeout: 15_000 });
    const password = main.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible() && !(await password.inputValue())) {
        await password.fill(PASSWORD);
    }
    await expect(sign, 'Sign never became enabled for this row').toBeEnabled({ timeout: 30_000 });
    await sign.click();
}

/** Reads the 64-hex-char transaction id printed on a form's done screen. */
async function readDoneTxid(page, timeoutMs = 180_000) {
    const main = page.getByRole('main');
    await expect(main, 'the done screen never printed a transaction id')
        .toContainText(/[0-9a-f]{64}/, { timeout: timeoutMs });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'no 64-hex-char transaction id found on the done screen').toBeTruthy();
    return txid;
}

/**
 * Records every `broadcast_tx` txid this page produces, in order.
 *
 * The Parallel composer's own "done" summary prints only a SHORTENED txid
 * per row (`shortenTxid`), so the full id every later assertion needs has to
 * come from the wire instead - what the wallet actually sent, not a display
 * string it trimmed for the screen.
 */
function trackBroadcastTxids(page) {
    const txids = [];
    page.on('response', async (response) => {
        try {
            if (!response.url().startsWith(ENCODER_URL)) return;
            if (response.request().method() !== 'POST') return;
            const body = response.request().postData() || '';
            if (!body.includes('"broadcast_tx"')) return;
            const json = await response.json().catch(() => null);
            const txid = json?.result?.txid;
            if (txid) txids.push(txid);
        } catch { /* a transient parse failure must not fail the whole run */ }
    });
    return txids;
}

/** Waits for the Nth (1-indexed by `countBefore`) broadcast to settle, and returns its txid. */
async function settledTxid(txids, countBefore, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let lastCount = countBefore;
    let stableSince = null;
    while (Date.now() < deadline) {
        if (txids.length !== lastCount) {
            lastCount = txids.length;
            stableSince = Date.now();
        } else if (lastCount > countBefore && stableSince !== null && Date.now() - stableSince >= 2_000) {
            return txids[txids.length - 1];
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no broadcast_tx response settled past count ${countBefore} (have ${txids.length})`);
}

test.describe(`Batch and Parallel composers on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test.beforeAll(async () => {
        await healVenueClock();
    });

    test('the Batch composer bundles two BROADCASTs into one signed transaction, and the chain confirms both', async ({ page }) => {
        const msgOne = `xc-e2e batch one ${STAMP}`;
        const msgTwo = `xc-e2e batch two ${STAMP}`;
        let owner;

        await test.step('onboard and fund the venue chain', async () => {
            owner = await onboardFundedWallet(page, 'Batch Composer Wallet');
        });

        await test.step('queue two BROADCASTs and sign them as one batch', async () => {
            const main = await gotoBatchComposer(page);
            await picker(main, 'Chain').selectOption(REGTEST_CHAIN_ID);
            expect(await picker(main, 'From address').evaluate((el) => el.options[el.selectedIndex]?.text || ''),
                'the batch composer defaulted to a different address than the one this run funded')
                .toBe(owner);

            await picker(main, 'Action').nth(0).selectOption('BROADCAST');
            await paramsBox(main).nth(0)
                .fill(JSON.stringify({ VERSION: '0', MESSAGE: msgOne }));

            await main.getByRole('button', { name: '+ Add action', exact: true }).click();
            await picker(main, 'Action').nth(1).selectOption('BROADCAST');
            await paramsBox(main).nth(1)
                .fill(JSON.stringify({ VERSION: '0', MESSAGE: msgTwo }));

            await main.getByRole('button', { name: 'Review', exact: true }).click();
            await expect(main.getByText('Batch steps (2)'),
                'the batch composer never built a 2-step COMMAND host-side')
                .toBeVisible({ timeout: 60_000 });

            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);

            await main.getByRole('button', { name: 'Sign batch', exact: true }).click();
            await approveConfirm(page, 'the batch');

            await expect(main.getByText('Batch broadcast'), 'the batch never reported broadcast')
                .toBeVisible({ timeout: 180_000 });
            const txid = await readDoneTxid(page);

            // Waits until the transaction is indexed; every action it produced
            // is then read off the transaction endpoint below.
            await waitForValidAction(txid, INDEX_BUDGET_MS);

            // The indexer records a BATCH as its own action plus one action
            // per sub-command, all sharing the one tx_hash, so the newest row
            // for this txid is the LAST sub-command, not the BATCH. Reading
            // the whole transaction is what proves both sub-commands landed
            // from one signed tx, each with its own verdict.
            const tx = await explorerJson(`transaction/${txid}/tx_hash`);
            expect(tx.source, 'the batch was not signed by the funded address').toBe(owner);
            const wire = String(tx.tx_data ?? '');
            expect(wire.startsWith('BATCH|'), `the transaction is not a BATCH on the wire: ${wire}`).toBe(true);
            expect(wire, `the on-chain BATCH command carries no trace of "${msgOne}"`).toContain(msgOne);
            expect(wire, `the on-chain BATCH command carries no trace of "${msgTwo}"`).toContain(msgTwo);

            const actions = Array.isArray(tx.actions) ? tx.actions : [];
            const batchRow = actions.find((a) => a.action === 'BATCH');
            expect(batchRow, `no BATCH action recorded for ${txid}: ${JSON.stringify(actions)}`).toBeTruthy();
            expect(batchRow.status, 'the chain rejected the BATCH itself').toBe('valid');
            const broadcasts = actions.filter((a) => a.action === 'BROADCAST');
            expect(broadcasts.map((a) => a.status), 'both BROADCAST sub-actions must be recorded valid')
                .toEqual(['valid', 'valid']);
            expect(broadcasts.map((a) => a.details?.message).sort(),
                'the recorded BROADCAST messages do not match what was typed')
                .toEqual([msgOne, msgTwo].sort());
        });
    });

    test('the Parallel composer submits two independent BROADCASTs as two independent transactions', async ({ page }) => {
        const msgOne = `xc-e2e parallel one ${STAMP}`;
        const msgTwo = `xc-e2e parallel two ${STAMP}`;
        const txids = trackBroadcastTxids(page);
        let owner;

        await test.step('onboard and fund the venue chain', async () => {
            owner = await onboardFundedWallet(page, 'Parallel Composer Wallet', { utxos: 2 });
        });

        await test.step('queue two independent BROADCASTs and sign them one at a time', async () => {
            const main = await gotoParallelComposer(page);
            await picker(main, 'Chain').nth(0).selectOption(REGTEST_CHAIN_ID);
            expect(await picker(main, 'From address').nth(0).evaluate((el) => el.options[el.selectedIndex]?.text || ''),
                'row 1 defaulted to a different address than the one this run funded')
                .toBe(owner);
            await picker(main, 'Action').nth(0).selectOption('BROADCAST');
            await paramsBox(main).nth(0)
                .fill(JSON.stringify({ VERSION: '0', MESSAGE: msgOne }));

            await main.getByRole('button', { name: '+ Add action', exact: true }).click();
            await picker(main, 'Chain').nth(1).selectOption(REGTEST_CHAIN_ID);
            expect(await picker(main, 'From address').nth(1).evaluate((el) => el.options[el.selectedIndex]?.text || ''),
                'row 2 defaulted to a different address than the one this run funded')
                .toBe(owner);
            await picker(main, 'Action').nth(1).selectOption('BROADCAST');
            await paramsBox(main).nth(1)
                .fill(JSON.stringify({ VERSION: '0', MESSAGE: msgTwo }));

            await main.getByRole('button', { name: 'Review', exact: true }).click();
            await main.getByRole('checkbox').check();
            await main.getByRole('button', { name: 'Sign all', exact: true }).click();

            await expect(main.getByText('Signing action 1 of 2'),
                'the composer never entered the sequential signing stage')
                .toBeVisible({ timeout: 30_000 });
            await signParallelRow(main);

            // No confirm modal here (§42.8.2: ParallelComposer signs each row
            // directly, with no ActionConfirmScreen), so the FIRST broadcast
            // this test's own network listener sees is row 1's.
            const txidOne = await settledTxid(txids, 0);

            await expect(main.getByText('Signing action 2 of 2'),
                'row 1 did not succeed and advance to row 2')
                .toBeVisible({ timeout: 60_000 });
            await signParallelRow(main);

            const txidTwo = await settledTxid(txids, 1);

            await expect(main.getByText('Parallel run complete'), 'the composer never reached its done stage')
                .toBeVisible({ timeout: 60_000 });

            const actionOne = await waitForValidAction(txidOne, INDEX_BUDGET_MS);
            expect(actionOne.action, 'row 1 did not record a BROADCAST action').toBe('BROADCAST');
            expect(actionOne.source, 'row 1 was not signed by the funded address').toBe(owner);
            expect(actionOne.message, 'row 1\'s on-chain MESSAGE does not match what was typed').toBe(msgOne);

            const actionTwo = await waitForValidAction(txidTwo, INDEX_BUDGET_MS);
            expect(actionTwo.action, 'row 2 did not record a BROADCAST action').toBe('BROADCAST');
            expect(actionTwo.source, 'row 2 was not signed by the funded address').toBe(owner);
            expect(actionTwo.message, 'row 2\'s on-chain MESSAGE does not match what was typed').toBe(msgTwo);

            expect(txidOne, 'the two parallel rows produced the same transaction, so they were not independent')
                .not.toBe(txidTwo);
        });
    });
});
