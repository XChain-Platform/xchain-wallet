// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SLEEP (PC-05): pause and resume a token from Manage Token. Tick mode
// signs straight through the shared confirm screen (no legacy review
// stage), so this drives the wallet's own "Pause token" / "Resume
// token" action and asserts the chain's own SLEEP row - the explorer's
// `/sleeps/{tick}/token` list, the same read `sleepStateFor` uses to
// show the pause badge - rather than only the wallet's own success copy.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const SUPPLY = '1000';
const STAMP = Date.now().toString().slice(-6);
const TICK = `SLP${STAMP}`;

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

/** The latest valid SLEEP row for `tick`, straight off the explorer. */
async function latestSleepRow(tick) {
    const resp = await explorerJson(`sleeps/${tick}/token`);
    const rows = (Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [])
        .filter((r) => String(r.status || 'valid') === 'valid');
    expect(rows.length, `the explorer has no SLEEP rows at all for ${tick} yet`).toBeGreaterThan(0);
    rows.sort((a, b) => Number(b.action_index ?? 0) - Number(a.action_index ?? 0));
    return rows[0];
}

test.describe(`SLEEP (pause/resume) on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('pausing a token indefinitely and resuming it both land on chain', async ({ page }) => {
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
    });
});
