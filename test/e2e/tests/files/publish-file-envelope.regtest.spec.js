// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A public file above the legacy 8 KB ceiling, published on Bitcoin through the
// confirm lane. The encoder answers with a Taproot commit and its reveal, the
// confirm screen lists both transactions, one Approve signs and broadcasts both,
// and the chain records the FILE action on the reveal.
//
// The file is random bytes so compression cannot bring it under 8 KB, which is
// the size band that needs the Taproot envelope rather than the legacy cap.

import { randomBytes } from 'node:crypto';

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    expectConfirmModal,
    fundAddress,
    readReceiveAddress,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
// Well over the legacy 8,192-byte compiled ceiling of a plain data carrier.
const FILE_BYTES = 51_200;
const STAMP = Date.now().toString().slice(-6);
const FILE_NAME = `taproot-${STAMP}.bin`;
const TITLE = 'Taproot test 50k';
const MEMO = 'wallet QA taproot envelope';

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

// The Taproot envelope is Bitcoin's; the other venues have no p2tr descriptor.
test.skip(REGTEST_COIN !== 'RBTC', 'the Taproot envelope is offered on Bitcoin only');

test.describe(`Publish file over 8 KB on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('a 50 KB public file rides a Taproot commit and reveal through one Approve', async ({ page }) => {
        let source;
        await test.step('onboard and fund', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Envelope Wallet' });
            await switchToRegtest(page, PASSWORD);
            source = await readReceiveAddress(page);
            expect(source).toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(source, 1);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        const main = page.getByRole('main');
        await test.step('fill Publish file with a file the legacy cap refuses', async () => {
            await gotoPalette(page, 'Publish file');
            await expect(main.getByRole('radiogroup', { name: 'Publish mode' })).toBeVisible({ timeout: 30_000 });
            await main.getByRole('radio', { name: /Public/ }).check();
            await selectVenueChain(main, 'Chain');
            // The form offers the envelope ceiling on this chain and says why.
            await expect(main).toContainText('compact Taproot encoding', { timeout: 30_000 });

            await main.getByLabel('Choose file to publish').setInputFiles({
                name: FILE_NAME,
                mimeType: 'application/octet-stream',
                buffer: randomBytes(FILE_BYTES),
            });
            await expect(main).toContainText(`${FILE_BYTES.toLocaleString('en-US')} bytes`);
            await main.getByLabel('Title (optional)').fill(TITLE);
            await main.getByLabel('Memo (optional)').fill(MEMO);
            await main.getByRole('checkbox', { name: /on-chain forever/ }).check();
            await main.getByRole('button', { name: 'Publish file', exact: true }).click();
        });

        let revealTxid;
        await test.step('the confirm screen shows both transactions, and Approve sends both', async () => {
            const modal = await expectConfirmModal(page, `the ${FILE_BYTES}-byte FILE`, 180_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 180_000 });
            await expect(modal.getByTestId('confirm-envelope-commit')).toContainText(/Commit transaction: .*fee [\d.]+ BTC/);
            await expect(modal.getByTestId('confirm-envelope-reveal')).toContainText(/Reveal transaction: .*fee [\d.]+ BTC/);
            await expect(modal.getByTestId('confirm-fee')).toContainText('both transactions');
            await page.getByTestId('confirm-approve').click();

            await expect(main.getByRole('heading', { name: 'File published' }),
                'Approve did not end on the published screen')
                .toBeVisible({ timeout: 240_000 });
            revealTxid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
            expect(revealTxid, 'the published screen showed no transaction id').toBeTruthy();
        });

        await test.step('the chain records the FILE on the reveal, valid', async () => {
            // The action's identity is the reveal's txid, so a valid FILE row
            // under it means both transactions confirmed and the envelope decoded.
            const detail = await waitForValidAction(revealTxid);
            console.log(`[envelope] reveal ${revealTxid} action ${JSON.stringify(detail).slice(0, 1500)}`);
            expect(detail.action).toBe('FILE');
            expect(detail.name).toBe(FILE_NAME);
            expect(detail.title).toBe(TITLE);
            expect(detail.memo).toBe(MEMO);
        });
    });
});
