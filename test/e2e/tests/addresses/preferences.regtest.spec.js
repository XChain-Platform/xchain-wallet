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
import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    approveConfirm,
} from '../../fixtures/regtest.js';
import { fieldByLabel } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';
const XCHAIN_AMOUNT = 20;
const MEMO = `ADP${Date.now().toString().slice(-8)}`;

async function readTxid(page) {
    const main = page.getByRole('main');
    await expect(main).toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = await readShownTxid(main);
    expect(txid, 'the preferences result showed no transaction id').toBeTruthy();
    return txid;
}

test.describe('ADDRESS v0 preferences on regtest', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('the preferences form writes all three values to the indexed ADDRESS row', async ({ page }) => {
        let source;

        await test.step('onboard and fund both fee lanes', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Address Preferences Wallet' });
            await switchToRegtest(page, PASSWORD);
            source = await readReceiveAddress(page);
            await fundAddress(source, 1);
            await mintXchain(page, XCHAIN_AMOUNT);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_AMOUNT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('submit changed preferences through the address detail form', async () => {
            await openPaletteCommand(page, 'Addresses');
            const main = page.getByRole('main');
            await main.getByRole('button', { name: `View address ${source}` }).click();
            await main.getByRole('button', { name: 'Edit on-chain preferences' }).click();

            // The screen title sits in the page banner, outside main.
            await expect(page.getByRole('banner').getByRole('heading', {
                name: 'On-chain preferences',
            }))
                .toBeVisible({ timeout: 30_000 });
            // Each preference is the themed dropdown (G119): open it, pick the option.
            await main.getByRole('button', { name: /^How the protocol fee is handled: / }).click();
            await main.getByRole('option', { name: 'Destroy (reduces supply)' }).click();
            await main.getByRole('button', { name: /^Require memo on incoming sends: / }).click();
            await main.getByRole('option', { name: 'Yes' }).click();
            await main.getByRole('button', { name: /^Who may open dispensers: / }).click();
            await main.getByRole('option', { name: 'Anyone' }).click();
            await fieldByLabel(main, 'Memo').fill(MEMO);
            await main.getByRole('button', { name: 'Update preferences', exact: true }).click();

            await expect(main).toContainText('Destroy the fee (reduces supply) - CHANGED');
            await expect(main).toContainText('Memo required on incoming sends - CHANGED');
            await expect(main).toContainText('Anyone may open a dispenser here - CHANGED');
            await main.getByRole('button', { name: 'Continue to Confirmation', exact: true }).click();
            await expectConfirmModal(page, 'address preferences');
            const password = fieldByLabel(page, 'Password');
            if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
                await password.fill(PASSWORD);
            }
            await approveConfirm(page);
        });

        await test.step('read the exact ADDRESS row back from the explorer', async () => {
            const txid = await readTxid(page);
            const action = await waitForValidAction(txid);
            expect(action.action).toBe('ADDRESS');
            expect(String(action.tx_data)).toContain(`ADDRESS|0|1|1|2|${MEMO}`);

            const response = await explorerJson(`addresses/${source}/address`);
            const rows = Array.isArray(response) ? response : response?.data || [];
            const row = rows.find((candidate) => candidate.tx_hash === txid);
            expect(row, `the explorer returned no ADDRESS row for ${txid}`).toBeTruthy();
            expect(String(row.status)).toBe('valid');
            expect(Number(row.fee_preference)).toBe(1);
            expect(Number(row.require_memo)).toBe(1);
            expect(Number(row.dispenser_preference)).toBe(2);
            expect(String(row.memo)).toBe(MEMO);
        });
    });
});
