// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    createWallet,
    expect,
    gotoSection,
    LICENSE_ACCEPTED_AT_KEY,
    LICENSE_ACCEPTED_VERSION_KEY,
    mainButton,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import {
    callbackBlockAhead,
    explorerJson,
    expectConfirmModal,
    fundAddress,
    healVenueClock,
    mintXchain,
    nudgeChain,
    readReceiveAddress,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    seedPrices,
    selectVenueChain,
    selectVenueSendAsset,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const UNLOCK_VALUE = 'regtestpassword123';
const FUNDING = 3;
const SUPPLY = 10;
const HOLDER_UNITS = 4;
const PAYOUT_AMOUNT = 2;
const PAYOUT_TICK = 'XCHAIN';
const XCHAIN_MINT = 50;
const STAMP = Date.now().toString().slice(-6);
const TICK = `CBH${STAMP}`;

async function newDevice(browser) {
    const context = await browser.newContext();
    await context.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch {
                return undefined;
            }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
    return context.newPage();
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function approveAndReadTxid(page, what, { typedCallback = false } = {}) {
    await expectConfirmModal(page, what, 90_000);
    if (typedCallback) {
        const typed = page.getByLabel('Type "CALLBACK" to confirm');
        await expect(typed, 'the CALLBACK confirmation field is missing')
            .toBeVisible({ timeout: 30_000 });
        await typed.fill('CALLBACK');
    }
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
        await password.fill(UNLOCK_VALUE);
    }
    const approve = page.getByTestId('confirm-approve');
    await expect(approve, `Approve never became enabled for ${what}`)
        .toBeEnabled({ timeout: 120_000 });
    await approve.click();

    const main = page.getByRole('main');
    await expect(main, `${what} did not show a transaction id`)
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
    expect(txid, `${what} result had no transaction id`).toBeTruthy();
    return txid;
}

async function openManageToken(page) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'My Tokens', exact: true }).click();
    const main = page.getByRole('main');
    const search = main.getByLabel('Search your tokens by ticker or description');
    await expect(search, 'My Tokens did not render').toBeVisible({ timeout: 30_000 });
    await search.fill(TICK);
    const row = main.getByRole('button', { name: new RegExp(`^${TICK}\\b`) }).first();
    await expect(row, `${TICK} is missing from My Tokens`).toBeVisible({ timeout: 60_000 });
    await row.click();
    await expect(main.getByRole('heading', { name: TICK, exact: true }))
        .toBeVisible({ timeout: 30_000 });
    return main;
}

async function pickManageMore(main, label) {
    const more = main.getByRole('button', { name: 'More', exact: true });
    await expect(more).toBeVisible({ timeout: 30_000 });
    await more.click();
    const item = main.getByRole('menuitem', { name: label, exact: true });
    await expect(item, `Manage Token has no ${label} action`).toBeVisible({ timeout: 15_000 });
    await item.click();
}

async function openExecuteCallbackWhenConfigured(page, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const main = await openManageToken(page);
        const more = main.getByRole('button', { name: 'More', exact: true });
        await expect(more).toBeVisible({ timeout: 30_000 });
        await more.click();
        const execute = main.getByRole('menuitem', { name: 'Execute callback', exact: true });
        if (await execute.isVisible()) {
            await execute.click();
            return main;
        }
        await page.keyboard.press('Escape');
        await nudgeChain();
        await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw new Error(`Manage Token did not offer "Execute callback" within ${timeoutMs} ms`);
}

async function readCurrentHeight(main) {
    const hint = main.getByText(/^Current block on /);
    await expect(hint, 'Callback settings did not show the current block')
        .toBeVisible({ timeout: 30_000 });
    const text = await hint.innerText();
    const match = text.match(/Current block on [^:]+:\s*([\d,]+)\./);
    expect(match, `could not parse the current block from: ${text}`).toBeTruthy();
    return Number(match[1].replace(/,/g, ''));
}

async function mineToHeight(target, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let tip = -1;
    while (Date.now() < deadline) {
        await nudgeChain();
        const status = await explorerJson('status');
        tip = Number(status?.chain_tip?.[REGTEST_COIN]);
        if (Number.isFinite(tip) && tip >= target) return tip;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`chain tip never reached block ${target}; last seen ${tip}`);
}

async function waitForExactBalance(address, tick, expected, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let actual = null;
    while (Date.now() < deadline) {
        actual = await tokenBalance(address, tick).catch(() => actual);
        if (actual === expected) return actual;
        await nudgeChain();
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`${tick} balance for ${address} never reached ${expected}; last seen ${actual}`);
}

async function displayedBalance(page, tick) {
    const row = page.locator(`[data-balance-key="${REGTEST_CHAIN_ID}:${tick}"]`).first();
    if (await row.count() === 0) return null;
    const quantity = (await row.innerText())
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /^[\d,]+(?:\.\d+)?$/.test(line));
    return quantity == null ? null : Number(quantity.replace(/,/g, ''));
}

async function expectHomeBalance(page, tick, expected) {
    await gotoSection(page, 'Home');
    await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
    await page.getByRole('tab', { name: 'Tokens', exact: true }).click();
    await expect.poll(() => displayedBalance(page, tick), {
        timeout: 90_000,
        message: `Home did not show ${expected} ${tick}`,
    }).toBe(expected);
}

test.describe(`holder-payout callback on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(3_600_000);

    test.beforeAll(async () => {
        await healVenueClock();
    });

    test('wallet B receives its payout and wallet A retains the recalled supply', async ({ browser }) => {
        const ownerPage = await newDevice(browser);
        const holderPage = await newDevice(browser);
        let owner;
        let holder;
        let callbackBlock;

        await test.step('create both wallets and fund wallet A', async () => {
            await createWallet(ownerPage, { password: UNLOCK_VALUE, name: 'Callback Owner' });
            await switchToRegtest(ownerPage, UNLOCK_VALUE);
            owner = await readReceiveAddress(ownerPage);
            await fundAddress(owner, FUNDING);
            await ownerPage.reload();
            await unlockAfterReload(ownerPage, UNLOCK_VALUE);
            await seedPrices();
            await mintXchain(ownerPage, XCHAIN_MINT);
            await waitForTokenBalance(owner, PAYOUT_TICK, XCHAIN_MINT);
            await ownerPage.reload();
            await unlockAfterReload(ownerPage, UNLOCK_VALUE);

            await createWallet(holderPage, { password: UNLOCK_VALUE, name: 'Callback Holder' });
            await switchToRegtest(holderPage, UNLOCK_VALUE);
            holder = await readReceiveAddress(holderPage);
            expect(holder, 'wallet B derived the same address as wallet A').not.toBe(owner);
            expect(await tokenBalance(holder, PAYOUT_TICK)).toBe(0);
        });

        await test.step('issue the token and configure its holder payout', async () => {
            await gotoPalette(ownerPage, 'Issue token');
            let main = ownerPage.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            expect(await main.getByLabel('From').inputValue()).toBe(owner);
            await main.getByLabel('Ticker').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            const issue = await waitForValidAction(
                await approveAndReadTxid(ownerPage, `the ISSUE of ${TICK}`),
            );
            expect(issue.action).toBe('ISSUE');
            expect(issue.source).toBe(owner);
            await waitForExactBalance(owner, TICK, SUPPLY);

            main = await openManageToken(ownerPage);
            await pickManageMore(main, 'Callback settings');
            main = ownerPage.getByRole('main');
            await expect(main.getByLabel('Callback token')).toBeVisible({ timeout: 30_000 });
            callbackBlock = await callbackBlockAhead(await readCurrentHeight(main));
            await main.getByLabel('Callback token').fill(PAYOUT_TICK);
            await main.getByLabel('Payout per unit').fill(String(PAYOUT_AMOUNT));
            await main.getByLabel('Callback allowed from block').fill(String(callbackBlock));
            await main.getByRole('button', { name: 'Update token', exact: true }).click();

            const update = await waitForValidAction(
                await approveAndReadTxid(ownerPage, 'the callback settings update'),
            );
            expect(update.action).toBe('ISSUE');
            expect(update.source).toBe(owner);

            const token = await explorerJson(`token/${TICK}`);
            expect(String(token?.callback?.tick || '').toUpperCase()).toBe(PAYOUT_TICK);
            expect(Number(token?.callback?.amount)).toBe(PAYOUT_AMOUNT);
            expect(Number(token?.callback?.block)).toBe(callbackBlock);
        });

        await test.step('wallet A sends part of the supply to wallet B through Send', async () => {
            await ownerPage.reload();
            await unlockAfterReload(ownerPage, UNLOCK_VALUE);
            await gotoSection(ownerPage, 'Send');
            await selectVenueSendAsset(ownerPage, TICK);
            await ownerPage.getByLabel('To', { exact: true }).fill(holder);
            await ownerPage.getByRole('textbox', { name: /^Amount/ }).fill(String(HOLDER_UNITS));
            await mainButton(ownerPage, 'Send').click();

            const send = await waitForValidAction(
                await approveAndReadTxid(ownerPage, `the SEND of ${TICK}`),
            );
            expect(send.action).toBe('SEND');
            expect(send.source).toBe(owner);
            await waitForExactBalance(owner, TICK, SUPPLY - HOLDER_UNITS);
            await waitForExactBalance(holder, TICK, HOLDER_UNITS);
        });

        let ownerXchainAfter;
        await test.step('wallet A executes the callback and the indexer records the split', async () => {
            const ownerXchainBefore = await tokenBalance(owner, PAYOUT_TICK);
            const holderXchainBefore = await tokenBalance(holder, PAYOUT_TICK);
            const expectedHolderPayout = HOLDER_UNITS * PAYOUT_AMOUNT;
            const expectedOwnerXchainAfter = ownerXchainBefore - expectedHolderPayout;
            expect(holderXchainBefore).toBe(0);

            await mineToHeight(callbackBlock);
            await ownerPage.reload();
            await unlockAfterReload(ownerPage, UNLOCK_VALUE);
            const main = await openExecuteCallbackWhenConfigured(ownerPage);

            const holdersToPay = main.getByText('Holders to pay', { exact: true })
                .locator('xpath=following-sibling::dd[1]');
            const totalPayout = main.getByText('Total payout', { exact: true })
                .locator('xpath=following-sibling::dd[1]');
            await expect(holdersToPay).toHaveText('1', { timeout: 60_000 });
            await expect(totalPayout).toHaveText(`${expectedHolderPayout} ${PAYOUT_TICK}`);

            const execute = main.getByRole('button', { name: 'Execute callback', exact: true });
            await expect(execute).toBeEnabled({ timeout: 60_000 });
            await execute.click();
            const txid = await approveAndReadTxid(ownerPage, 'the holder-payout callback', {
                typedCallback: true,
            });
            const callback = await waitForValidAction(txid);
            expect(callback.action).toBe('CALLBACK');
            expect(callback.source).toBe(owner);

            const callbackRows = await explorerJson(`callbacks/${TICK}/token`);
            expect((callbackRows?.data || []).some((row) => row.tx_hash === txid)).toBe(true);

            await waitForExactBalance(holder, PAYOUT_TICK, holderXchainBefore + expectedHolderPayout);
            await waitForExactBalance(holder, TICK, 0);
            await waitForExactBalance(owner, TICK, SUPPLY);
            ownerXchainAfter = await waitForExactBalance(
                owner,
                PAYOUT_TICK,
                expectedOwnerXchainAfter,
            );
            expect(ownerXchainAfter).toBe(expectedOwnerXchainAfter);
        });

        await test.step('both wallet UIs agree with the indexed payout balances', async () => {
            await ownerPage.reload();
            await unlockAfterReload(ownerPage, UNLOCK_VALUE);
            await expectHomeBalance(ownerPage, TICK, SUPPLY);
            await expectHomeBalance(ownerPage, PAYOUT_TICK, ownerXchainAfter);

            await holderPage.reload();
            await unlockAfterReload(holderPage, UNLOCK_VALUE);
            await expectHomeBalance(holderPage, PAYOUT_TICK, HOLDER_UNITS * PAYOUT_AMOUNT);
            await expect(holderPage.locator(`[data-balance-key="${REGTEST_CHAIN_ID}:${TICK}"]`))
                .toHaveCount(0, { timeout: 60_000 });
        });
    });
});
