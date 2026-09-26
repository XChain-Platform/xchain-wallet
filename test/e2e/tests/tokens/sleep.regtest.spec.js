// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SLEEP (PC-05), both formats, signed in the wallet UI and checked against
// the chain's own SLEEP rows on the explorer, not the wallet's success copy.
//
// v1 pauses and resumes a token from Manage Token (shared confirm screen).
// v0 locks the signing address from Token Actions (legacy review stage with
// a typed SLEEP confirm); it runs last because a slept address cannot sign.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const SUPPLY = '1000';
const STAMP = Date.now().toString().slice(-6);
// A prefix of its own, so this spec's rows stand apart on a shared venue.
const TICK = `SLW${STAMP}`;
/** Pays the ISSUE fee and the three SLEEP fees in XCHAIN, with room to spare. */
const MINT_XCHAIN = 20;
/** How far past the tip the address lock resumes, beyond anything a nudge mines mid-test. */
const LOCK_AHEAD_BLOCKS = 1000;

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
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'success screen showed no transaction id').toBeTruthy();
    return txid;
}

/** Opens Manage Token for `tick` and clicks the pause/resume action (label varies with state). */
async function openPauseAction(page, tick, label) {
    await gotoPalette(page, 'My Tokens');
    const main = page.getByRole('main');
    const row = main.getByRole('button').filter({ hasText: tick }).first();
    await expect(row, `${tick} is on chain but My Tokens does not list it`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();
    await expect(page.getByText('Manage Token').first()).toBeVisible({ timeout: 30_000 });

    const primary = main.getByRole('button', { name: label, exact: true });
    if (await primary.count() > 0 && await primary.first().isVisible()) {
        await primary.first().click();
        return;
    }
    const more = main.getByRole('button', { name: /^More/ });
    await expect(more, `Manage Token offers neither a "${label}" button nor a More menu`)
        .toBeVisible({ timeout: 15_000 });
    await more.first().click();
    const item = page.getByRole('menuitem', { name: label, exact: true });
    await expect(item, `no "${label}" action available for ${tick}`).toBeVisible({ timeout: 15_000 });
    await item.click();
}

/** Opens the address self-lock form (SLEEP v0) off the Token Actions page. */
async function openLockAddress(page) {
    await gotoPalette(page, 'All actions');
    const entry = page.getByRole('main').getByRole('button', { name: /^Lock this address/ });
    await expect(entry, 'Token Actions has no "Lock this address" entry').toBeVisible({ timeout: 30_000 });
    await entry.click();
    await expect(page.getByLabel('Address to lock')).toBeVisible({ timeout: 30_000 });
}

/**
 * Waits for the lock form's "This address is currently ..." line to read
 * `expected`; the state read is async, so the first paint always says active.
 */
async function expectAddressStateLine(page, expected) {
    await expect(page.getByRole('main').getByText(/^This address is currently /),
        'the lock form does not state the address\'s current pause state as the chain has it')
        .toHaveText(expected, { timeout: 30_000 });
}

/** The latest valid SLEEP row for `tick`, straight off the explorer. */
async function latestSleepRow(tick) {
    const resp = await explorerJson(`sleeps/${tick}/token`);
    const rows = (Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [])
        .filter((r) => String(r.status || 'valid') === 'valid');
    expect(rows.length, `the explorer has no SLEEP rows at all for ${tick} yet`).toBeGreaterThan(0);
    rows.sort((a, b) => Number(b.action_index ?? 0) - Number(a.action_index ?? 0));
    return rows[0];
}

test.describe(`SLEEP (tick pause/resume and address lock) on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('pausing a token, resuming it and locking the address all land on chain', async ({ page }) => {
        let source;

        await test.step('onboard, fund and issue a token', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Sleep Wallet' });
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
            // ISSUE and SLEEP charge an XCHAIN protocol fee, and the preflight
            // disables Approve on a wallet that holds none.
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(source, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Ticker').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);
            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const txid = await approveAndGetTxid(page);
            await waitForValidAction(txid);
        });

        await test.step('pause the token indefinitely', async () => {
            await openPauseAction(page, TICK, 'Pause token');
            const main = page.getByRole('main');
            await expect(main.getByRole('radio', { name: /Pause indefinitely/ }))
                .toBeVisible({ timeout: 30_000 });
            await main.getByRole('radio', { name: /Pause indefinitely/ }).check();
            await main.getByRole('button', { name: 'Pause token', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const txid = await approveAndGetTxid(page);
            await waitForValidAction(txid);

            const row = await latestSleepRow(TICK);
            expect(String(row.resume_block ?? row.resumeBlock),
                `the chain's newest SLEEP row for ${TICK} does not read as an indefinite pause `
                + '(RESUME_BLOCK -1)')
                .toBe('-1');
            expect(row.tx_hash).toBe(txid);
        });

        await test.step('a paused token does not read as a locked address', async () => {
            // `/sleeps/{address}/address` lists every SLEEP the address signed,
            // tick pauses included; the lock form must not read the tick pause
            // above as a lock on the owner's own address.
            await openLockAddress(page);
            await expect(page.getByLabel('Address to lock')).toHaveValue(source);
            await expectAddressStateLine(page, 'This address is currently active (not paused).');
        });

        await test.step('resume the token', async () => {
            await openPauseAction(page, TICK, 'Resume token');
            const main = page.getByRole('main');
            await expect(main.getByRole('radio', { name: /Resume now/ })).toBeVisible({ timeout: 30_000 });
            await main.getByRole('radio', { name: /Resume now/ }).check();
            await main.getByRole('button', { name: 'Resume token', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const txid = await approveAndGetTxid(page);
            await waitForValidAction(txid);

            const row = await latestSleepRow(TICK);
            expect(String(row.resume_block ?? row.resumeBlock),
                `the chain's newest SLEEP row for ${TICK} does not read as resumed (RESUME_BLOCK 0)`)
                .toBe('0');
            expect(row.tx_hash).toBe(txid);
        });

        await test.step('lock the signing address until a block (SLEEP v0)', async () => {
            await openLockAddress(page);
            const main = page.getByRole('main');
            await expect(main.getByLabel('Address to lock'),
                'the lock form offers a different address than the one that signed the rest of this test')
                .toHaveValue(source);
            await expectAddressStateLine(page, 'This address is currently active (not paused).');

            // Lock relative to the height the form's future-block check uses.
            const heightLine = main.getByText(/^Current block on /);
            await expect(heightLine, 'the lock form never read the chain height').toBeVisible({ timeout: 30_000 });
            const height = Number((await heightLine.innerText()).match(/: ([\d,]+)\./)?.[1]?.replace(/,/g, ''));
            expect(Number.isFinite(height) && height > 0, 'unreadable chain height on the lock form').toBe(true);
            const resumeBlock = height + LOCK_AHEAD_BLOCKS;

            await main.getByRole('radio', { name: /Lock until a block/ }).check();
            await main.getByLabel('Resume at block').fill(String(resumeBlock));
            await main.getByRole('button', { name: 'Preview', exact: true }).click();

            // Legacy review stage: irreversibility warning, typed confirm, sign.
            await expect(page.getByText('This locks your own address.', { exact: false }))
                .toBeVisible({ timeout: 30_000 });
            const sign = main.getByRole('button', { name: `Lock address on ${REGTEST_CHAIN_LABEL}`, exact: true });
            await expect(sign, 'Sign is live before SLEEP was typed').toBeDisabled();
            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await main.getByLabel('Type SLEEP to confirm').fill('SLEEP');
            await expect(sign).toBeEnabled({ timeout: 15_000 });
            await sign.click();

            await expect(main.getByText('Lock address broadcast'), 'the lock never reported a broadcast')
                .toBeVisible({ timeout: 180_000 });
            const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
            expect(txid, 'the lock success screen showed no transaction id').toBeTruthy();
            await waitForValidAction(txid);

            const resp = await explorerJson(`sleeps/${source}/address`);
            const rows = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [];
            const row = rows.find((r) => r.tx_hash === txid);
            expect(row, `the explorer lists no SLEEP row for the lock ${txid}`).toBeTruthy();
            expect(String(row.status || 'valid')).toBe('valid');
            expect(Number(row.action_format), 'the lock was not composed as SLEEP v0').toBe(0);
            expect(row.tick ?? null, 'an address lock carries no TICK').toBeNull();
            expect(String(row.resume_block ?? row.resumeBlock),
                'the chain did not record the resume block the form was given').toBe(String(resumeBlock));
            expect(row.source).toBe(source);

            // Back to the form: it now reads the lock off the chain.
            await openLockAddress(page);
            await expectAddressStateLine(page,
                `This address is currently PAUSED until block ${resumeBlock.toLocaleString('en-US')}.`);
        });
    });
});
