// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
import { readShownTxid } from '../../fixtures/pendingHistory.js';
import { createWallet, expect, openFormSection, openPaletteCommand, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    explorerJson,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    REGTEST_CHAIN_LABEL,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';
import { fieldByLabel } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';
const XCHAIN_AMOUNT = 20;
const MEMO = `SLA${Date.now().toString().slice(-8)}`;

async function readTxid(page) {
    const main = page.getByRole('main');
    await expect(main).toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = await readShownTxid(main);
    expect(txid, 'the self-lock result showed no transaction id').toBeTruthy();
    return txid;
}

test.describe(`SLEEP v0 address self-lock on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('a finite address lock lands as an indexed SLEEP v0 row', async ({ page }) => {
        let source;
        let resumeBlock;

        await test.step('onboard and fund both fee lanes', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Address Sleep Wallet' });
            await switchToRegtest(page, PASSWORD);
            source = await readReceiveAddress(page);
            await fundAddress(source, 1);
            await mintXchain(page, XCHAIN_AMOUNT);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_AMOUNT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('approve the address-mode form with its typed safety gate', async () => {
            await openPaletteCommand(page, 'All actions');
            const main = page.getByRole('main');
            await main.getByText('Lock this address', { exact: true }).first().click();
            // The screen title sits in the page banner, outside main.
            await expect(page.getByRole('banner').getByRole('heading', { name: 'Lock address' }))
                .toBeVisible({ timeout: 30_000 });
            await expect(fieldByLabel(main, 'Address to lock')).toHaveValue(source);
            // Memo is its own closed optional section.
            await openFormSection(main, 'Memo');
            await fieldByLabel(main, 'Memo').fill(MEMO);
            await main.getByRole('button', { name: 'Lock Address', exact: true }).click();

            // The form no longer shows an end line; the review's wake condition names the block.
            const confirm = await expectConfirmModal(page, 'the address lock');
            const wakeLine = confirm.getByText(/Automatically at block [\d,]+/);
            await expect(wakeLine).toBeVisible({ timeout: 30_000 });
            resumeBlock = Number((await wakeLine.first().innerText()).match(/at block ([\d,]+)/)?.[1]?.replace(/,/g, ''));
            expect(Number.isFinite(resumeBlock) && resumeBlock > 0, 'the review has no readable wake block').toBe(true);

            // The confirm page's own warning slot states what the lock means.
            await expect(page.getByTestId('confirm-warning'))
                .toContainText('Nothing can lift the lock before its resume block');
            await fieldByLabel(page, 'Type LOCK to confirm').fill('LOCK');
            // The confirm screen's own Approve, whatever the verb on it.
            const approve = page.getByTestId('confirm-approve');
            await expect(approve).toBeEnabled({ timeout: 30_000 });
            await approve.click();
        });

        await test.step('read the SLEEP v0 row back from the explorer', async () => {
            const txid = await readTxid(page);
            const action = await waitForValidAction(txid);
            expect(action.action).toBe('SLEEP');
            expect(String(action.tx_data)).toContain(`SLEEP|0|${resumeBlock}|${MEMO}`);

            const response = await explorerJson(`sleeps/${source}/address`);
            const rows = Array.isArray(response) ? response : response?.data || [];
            const row = rows.find((candidate) => candidate.tx_hash === txid);
            expect(row, `the explorer returned no address SLEEP row for ${txid}`).toBeTruthy();
            expect(String(row.status)).toBe('valid');
            expect(String(row.resume_block ?? row.resumeBlock)).toBe(String(resumeBlock));
            expect(String(row.memo)).toBe(MEMO);
        });
    });
});
