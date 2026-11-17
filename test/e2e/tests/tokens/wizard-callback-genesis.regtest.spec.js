// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWallet, expect, openIssueSection, openPaletteCommand, submitTokenWizard, test } from '../../fixtures/wallet.js';
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
    approveConfirm,
} from '../../fixtures/regtest.js';
import { fieldByLabel, searchTokenPicker } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';
const STAMP = Date.now().toString().slice(-6);
const TICK = `WCB${STAMP}`;
const SUPPLY = 1000;
const XCHAIN_MINT = 50;
const CALLBACK_TICK = 'XCHAIN';
const CALLBACK_AMOUNT = 2;

async function approveAndReadTxid(page) {
    await expectConfirmModal(page, 'the token creation');
    const password = fieldByLabel(page, 'Password');
    if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
        await password.fill(PASSWORD);
    }
    await approveConfirm(page);

    const main = page.getByRole('main');
    await expect(main).toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'the token creation result did not show a transaction id').toBeTruthy();
    return txid;
}

async function readCurrentHeight(main) {
    const hint = main.getByText(/^Current block: /);
    await expect(hint, 'the advanced callback fields did not load the current block')
        .toBeVisible({ timeout: 30_000 });
    const text = await hint.innerText();
    const match = text.match(/Current block:\s*([\d,]+)\./);
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

        await openPaletteCommand(page, 'Create a token');
        const main = page.getByRole('main');
        // No template: the Custom token is the form with nothing picked. The
        // network sits in the From section, closed until opened.
        await openIssueSection(main, 'From');
        await selectVenueChain(main);

        await fieldByLabel(main, 'Ticker').fill(TICK);
        await fieldByLabel(main, 'Max supply').fill(String(SUPPLY));
        // Opening the Callback section is what makes the form read the chain tip.
        await openIssueSection(main, 'Callback');

        const callbackBlock = (await readCurrentHeight(main)) + 25;
        // Callback token is a token field: a button that opens the token picker.
        await main.getByRole('button', { name: /^Callback token:/ }).click();
        await searchTokenPicker(page, CALLBACK_TICK);
        await page.getByRole('button', { name: new RegExp(`^Select ${CALLBACK_TICK} on `) }).first()
            .click({ timeout: 30_000 });
        await expect(main.getByRole('button', { name: new RegExp(`^Callback token: ${CALLBACK_TICK} on `) }))
            .toBeVisible({ timeout: 30_000 });
        await fieldByLabel(main, 'Payout per unit').fill(String(CALLBACK_AMOUNT));
        await fieldByLabel(main, 'Callback allowed from block').fill(String(callbackBlock));
        await submitTokenWizard(page);

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
