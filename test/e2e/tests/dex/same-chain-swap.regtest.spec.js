// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import { selectNamedToken } from '../../fixtures/crossChain.js';
import {
    expectConfirmModal,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const XCHAIN_MINT = 100;
const STAMP = Date.now().toString().slice(-6);
const GIVE_TICK = `SCS${STAMP}`;
const GIVE_SUPPLY = 500;
const GIVE_AMOUNT = 25;
const GET_AMOUNT = 10;
const COIN = REGTEST_COIN.replace(/^R/, '');

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const search = dialog.getByRole('combobox').first();
    await search.fill(title);
    await dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function approveAndReadTxid(page, what) {
    await expectConfirmModal(page, what);
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
        await password.fill(PASSWORD);
    }
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled({ timeout: 120_000 });
    await approve.click();

    const main = page.getByRole('main');
    await expect(main).toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, `${what} success screen showed no transaction id`).toBeTruthy();
    return txid;
}

async function issueGiveToken(page, source) {
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    await main.getByLabel('Ticker').fill(GIVE_TICK);
    await main.getByLabel('Supply', { exact: true }).fill(String(GIVE_SUPPLY));
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();

    const txid = await approveAndReadTxid(page, `the ISSUE of ${GIVE_TICK}`);
    const action = await waitForValidAction(txid);
    expect(String(action.action)).toBe('ISSUE');
    await waitForTokenBalance(source, GIVE_TICK, GIVE_SUPPLY);
}

function indexedField(detail, field) {
    const value = detail?.[field] ?? detail?.details?.[field];
    if (value == null) throw new Error(`indexed SWAP row has no ${field} field`);
    return value;
}

test.describe(`same-chain SWAP on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('the dedicated Swap form signs, broadcasts, and indexes a same-chain offer', async ({ page }) => {
        let source;

        await test.step('fund the wallet, mint protocol fees, and issue the give token', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Same Chain Swap Wallet' });
            await switchToRegtest(page, PASSWORD);
            source = await readReceiveAddress(page);
            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await mintXchain(page, XCHAIN_MINT);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_MINT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await issueGiveToken(page, source);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        let swapTxid;
        await test.step('fill the dedicated same-chain Swap form and approve it', async () => {
            await gotoPalette(page, 'Swap');
            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: /^Chain:/ }))
                .toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main, 'Chain');
            await selectNamedToken(page, 'Give token', {
                chainId: REGTEST_CHAIN_ID,
                chainLabel: REGTEST_CHAIN_LABEL,
                tick: GIVE_TICK,
            });
            await selectNamedToken(page, 'Get token', {
                chainId: REGTEST_CHAIN_ID,
                chainLabel: REGTEST_CHAIN_LABEL,
                tick: 'XCHAIN',
            });
            await main.getByRole('textbox', { name: /^Give amount/ }).fill(String(GIVE_AMOUNT));
            await main.getByRole('textbox', { name: /^Get amount/ }).fill(String(GET_AMOUNT));
            await main.getByRole('button', { name: 'Swap', exact: true }).click();

            await expectConfirmModal(page, 'the same-chain SWAP');
            await expect(page.getByTestId('action-intent'))
                .toContainText(`give ${GIVE_AMOUNT} ${GIVE_TICK} for ${GET_AMOUNT} XCHAIN`);
            swapTxid = await approveAndReadTxid(page, 'the same-chain SWAP');
            await expect(main).toContainText('Swap sent');
        });

        await test.step('the explorer carries a valid same-chain SWAP row with both sides', async () => {
            const action = await waitForValidAction(swapTxid);
            expect(String(action.action)).toBe('SWAP');
            expect(String(indexedField(action, 'give_coin')).toUpperCase()).toBe(COIN);
            expect(String(indexedField(action, 'get_coin')).toUpperCase()).toBe(COIN);
            expect(String(indexedField(action, 'give_tick')).toUpperCase()).toBe(GIVE_TICK);
            expect(String(indexedField(action, 'get_tick')).toUpperCase()).toBe('XCHAIN');
            expect(Number(indexedField(action, 'give_amount'))).toBe(GIVE_AMOUNT);
            expect(Number(indexedField(action, 'get_amount'))).toBe(GET_AMOUNT);
        });
    });
});
