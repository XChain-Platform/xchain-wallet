// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    createWallet,
    expect,
    gotoSection,
    LICENSE_ACCEPTED_AT_KEY,
    LICENSE_ACCEPTED_VERSION_KEY,
    mainButton,
    test,
} from '../../fixtures/wallet.js';
import { selectNamedToken } from '../../fixtures/crossChain.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import {
    expectConfirmModal,
    fundAddress,
    mintXchain,
    nudgeChain,
    readReceiveAddress,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    selectVenueChain,
    selectVenueSendAsset,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const XCHAIN_MINT = 100;
const STAMP = Date.now().toString().slice(-6);
const HOLDER_TICK = `DVD${STAMP}`;
const HOLDER_SUPPLY = 10;
const HOLDER_UNITS = 4;
const RATE = 2;

async function newDevice(browser) {
    const context = await browser.newContext();
    await context.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch { /* the license gate will make the setup fail visibly */ }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
    return context.newPage();
}

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

async function fundWithFees(page, address) {
    await fundAddress(address, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    await mintXchain(page, XCHAIN_MINT);
    await waitForTokenBalance(address, 'XCHAIN', XCHAIN_MINT);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
}

async function issueHolderToken(page, source) {
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    await main.getByLabel('Ticker').fill(HOLDER_TICK);
    await main.getByLabel('Supply', { exact: true }).fill(String(HOLDER_SUPPLY));
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();

    const txid = await approveAndReadTxid(page, `the ISSUE of ${HOLDER_TICK}`);
    const action = await waitForValidAction(txid);
    expect(String(action.action)).toBe('ISSUE');
    await waitForTokenBalance(source, HOLDER_TICK, HOLDER_SUPPLY);
}

async function sendHolderUnits(page, destination) {
    await gotoSection(page, 'Send');
    await selectVenueSendAsset(page, HOLDER_TICK);
    await page.getByLabel('To', { exact: true }).fill(destination);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(String(HOLDER_UNITS));
    await mainButton(page, 'Send').click();

    const txid = await approveAndReadTxid(page, `the SEND of ${HOLDER_TICK}`);
    const action = await waitForValidAction(txid);
    expect(String(action.action)).toBe('SEND');
    await waitForTokenBalance(destination, HOLDER_TICK, HOLDER_UNITS);
}

function indexedField(detail, field) {
    const value = detail?.[field] ?? detail?.details?.[field];
    if (value == null) {
        throw new Error(`indexed DIVIDEND row has no ${field} field`);
    }
    return value;
}

async function waitForExactBalance(address, tick, expected, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let actual = null;
    while (Date.now() < deadline) {
        actual = await tokenBalance(address, tick);
        if (actual === expected) return actual;
        if (actual > expected) {
            throw new Error(`${address} received too much ${tick}: expected ${expected}, found ${actual}`);
        }
        await nudgeChain();
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`${address} never reached ${expected} ${tick}; last balance was ${actual}`);
}

test.describe('DIVIDEND on regtest', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('the form signs a holder payout and the indexed action credits the holder', async ({ browser }) => {
        const issuer = await newDevice(browser);
        const holder = await newDevice(browser);
        let issuerAddress;
        let holderAddress;

        await test.step('fund both wallets with coin and protocol-fee tokens', async () => {
            await createWallet(issuer, { password: PASSWORD, name: 'Dividend Issuer' });
            await switchToRegtest(issuer, PASSWORD);
            issuerAddress = await readReceiveAddress(issuer);
            await fundWithFees(issuer, issuerAddress);

            await createWallet(holder, { password: PASSWORD, name: 'Dividend Holder' });
            await switchToRegtest(holder, PASSWORD);
            holderAddress = await readReceiveAddress(holder);
            await fundWithFees(holder, holderAddress);
        });

        await test.step('issue the holder-of token and give four units to the holder', async () => {
            await issueHolderToken(issuer, issuerAddress);
            await issuer.reload();
            await unlockAfterReload(issuer, PASSWORD);
            await sendHolderUnits(issuer, holderAddress);
            expect(await tokenBalance(holderAddress, HOLDER_TICK)).toBe(HOLDER_UNITS);
            await issuer.reload();
            await unlockAfterReload(issuer, PASSWORD);
        });

        const holderXchainBefore = await tokenBalance(holderAddress, 'XCHAIN');
        let dividendTxid;

        await test.step('drive the dividend form through the real confirm screen', async () => {
            await gotoPalette(issuer, 'Pay a dividend');
            const main = issuer.getByRole('main');
            await expect(main.getByRole('button', { name: /^Holder-of token:/ }))
                .toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await selectNamedToken(issuer, 'Holder-of token', {
                chainId: REGTEST_CHAIN_ID,
                chainLabel: REGTEST_CHAIN_LABEL,
                tick: HOLDER_TICK,
            });
            await selectNamedToken(issuer, 'Dividend token', {
                chainId: REGTEST_CHAIN_ID,
                chainLabel: REGTEST_CHAIN_LABEL,
                tick: 'XCHAIN',
            });
            await main.getByRole('textbox', { name: /^Per-unit amount/ }).fill(String(RATE));

            await expect(main.getByText(/1 eligible holder/)).toBeVisible({ timeout: 60_000 });
            await expect(main.getByText(new RegExp(`total distribution ~${HOLDER_UNITS * RATE} XCHAIN`)))
                .toBeVisible({ timeout: 30_000 });
            await main.getByRole('button', { name: 'Pay dividend', exact: true }).click();

            await expectConfirmModal(issuer, 'the DIVIDEND');
            await expect(issuer.getByTestId('action-intent'))
                .toContainText(`Pay ${RATE} XCHAIN per unit of ${HOLDER_TICK}`);
            dividendTxid = await approveAndReadTxid(issuer, 'the DIVIDEND');
            await expect(main).toContainText('Dividend sent');
        });

        await test.step('the explorer indexes the terms and the holder receives the exact credit', async () => {
            const action = await waitForValidAction(dividendTxid);
            expect(String(action.action)).toBe('DIVIDEND');
            expect(String(indexedField(action, 'tick')).toUpperCase()).toBe(HOLDER_TICK);
            expect(String(indexedField(action, 'dividend_tick')).toUpperCase()).toBe('XCHAIN');
            expect(Number(indexedField(action, 'amount'))).toBe(RATE);

            await waitForExactBalance(
                holderAddress,
                'XCHAIN',
                holderXchainBefore + (HOLDER_UNITS * RATE),
            );
        });
    });
});
