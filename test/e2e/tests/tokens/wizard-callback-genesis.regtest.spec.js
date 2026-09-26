// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    REGTEST_CHAIN_LABEL,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const STAMP = Date.now().toString().slice(-6);
const TICK = `WCB${STAMP}`;
const SUPPLY = 1000;
const XCHAIN_MINT = 50;
const CALLBACK_TICK = 'XCHAIN';
const CALLBACK_AMOUNT = 2;

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('combobox').first().fill(title);
    await dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function approveAndReadTxid(page) {
    await expectConfirmModal(page, 'the token creation');
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
    expect(txid, 'the token creation result did not show a transaction id').toBeTruthy();
    return txid;
}

async function readCurrentHeight(main) {
    const hint = main.getByText(/^Current block on /);
    await expect(hint, 'the advanced callback fields did not load the current block')
        .toBeVisible({ timeout: 30_000 });
    const text = await hint.innerText();
    const match = text.match(/Current block on [^:]+:\s*([\d,]+)\./);
    expect(match, `could not parse the current block from: ${text}`).toBeTruthy();
    return Number(match[1].replace(/,/g, ''));
}

test.describe(`wizard callback fields on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('Custom creates a token with callback fields in the genesis ISSUE', async ({ page }) => {
        await createWallet(page, { password: PASSWORD, name: 'Wizard Callback Wallet' });
        await switchToRegtest(page, PASSWORD);
        const source = await readReceiveAddress(page);

        await fundAddress(source, 3);
        await page.reload();
        await unlockAfterReload(page, PASSWORD);
        await seedPrices();
        await mintXchain(page, XCHAIN_MINT);
        await waitForTokenBalance(source, 'XCHAIN', XCHAIN_MINT);
        await page.reload();
        await unlockAfterReload(page, PASSWORD);

        await gotoPalette(page, 'Create a token');
        const main = page.getByRole('main');
        await main.getByRole('button', { name: /^Custom/ }).click();
        await selectVenueChain(main);
        await main.getByRole('button', { name: 'Next', exact: true }).click();

        await main.getByLabel('Token name (ticker)').fill(TICK);
        await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
        await main.getByRole('button', { name: 'Advanced settings (optional)' }).click();

        const callbackBlock = (await readCurrentHeight(main)) + 25;
        await main.getByLabel('Callback token (optional)').fill(CALLBACK_TICK);
        await main.getByLabel('Payout per unit').fill(String(CALLBACK_AMOUNT));
        await main.getByLabel('Callback allowed from block').fill(String(callbackBlock));
        await main.getByRole('button', { name: 'Issue token', exact: true }).click();

        const txid = await approveAndReadTxid(page);
        const genesis = await waitForValidAction(txid);
        expect(genesis.action).toBe('ISSUE');
        expect(String(genesis.tick)).toBe(TICK);
        expect(String(genesis.callback_tick).toUpperCase()).toBe(CALLBACK_TICK);
        expect(Number(genesis.callback_amount)).toBe(CALLBACK_AMOUNT);
        expect(Number(genesis.callback_block)).toBe(callbackBlock);

        await waitForTokenBalance(source, TICK, SUPPLY);
        const token = await explorerJson(`token/${TICK}`);
        expect(String(token?.callback?.tick || '').toUpperCase()).toBe(CALLBACK_TICK);
        expect(Number(token?.callback?.amount)).toBe(CALLBACK_AMOUNT);
        expect(Number(token?.callback?.block)).toBe(callbackBlock);
    });
});
