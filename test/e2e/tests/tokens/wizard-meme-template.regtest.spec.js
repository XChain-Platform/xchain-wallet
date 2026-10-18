// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
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
const TICK = `MEM${STAMP}`;
const SUPPLY = 21_000_000;
const XCHAIN_MINT = 50;

async function approveAndReadTxid(page) {
    await expectConfirmModal(page, 'the Meme token creation');
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
    expect(txid, 'the Meme token result did not show a transaction id').toBeTruthy();
    return txid;
}

test.describe(`Meme token wizard template on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('Meme issues fixed supply with every inflation path locked', async ({ page }) => {
        await createWallet(page, { password: PASSWORD, name: 'Meme Wizard Wallet' });
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

        await openPaletteCommand(page, 'Create a token');
        const main = page.getByRole('main');
        await main.getByRole('button', { name: /^Meme token/ }).click();
        await selectVenueChain(main);
        await main.getByRole('button', { name: 'Next', exact: true }).click();

        await expect(main).toContainText('Step 3 of 4: Details');
        await main.getByLabel('Token name (ticker)').fill(TICK);
        await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
        await main.getByRole('button', { name: 'Review token', exact: true }).click();
        // Only the review stage names the chosen template.
        await expect(main).toContainText('Meme token');
        await main.getByRole('button', { name: 'Continue to confirmation', exact: true }).click();

        const txid = await approveAndReadTxid(page);
        const genesis = await waitForValidAction(txid);
        expect(genesis.action).toBe('ISSUE');
        expect(String(genesis.tick)).toBe(TICK);
        expect(Number(genesis.max_supply)).toBe(SUPPLY);
        expect(Number(genesis.mint_supply)).toBe(SUPPLY);
        expect(Number(genesis.decimals)).toBe(0);
        expect(genesis.lock_max_supply).toBeTruthy();
        expect(genesis.lock_mint).toBeTruthy();
        expect(genesis.lock_mint_supply).toBeTruthy();

        await waitForTokenBalance(source, TICK, SUPPLY);
        const token = await explorerJson(`token/${TICK}`);
        expect(Number(token?.supply?.current)).toBe(SUPPLY);
        expect(Number(token?.supply?.max)).toBe(SUPPLY);
        expect(Number(token?.supply?.decimals)).toBe(0);
        expect(token?.locks?.max_supply).toBe(true);
        expect(token?.locks?.mint).toBe(true);
        expect(token?.locks?.mint_supply).toBe(true);
    });
});
