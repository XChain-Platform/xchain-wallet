// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { waitForShownTxid } from '../../fixtures/pendingHistory.js';
import { showHomeBalances } from '../../fixtures/homeBalances.js';
import {
    clickManageTokenAction,
    createWallet,
    expect,
    expectManageTokenView,
    expectMyTokensRow,
    gotoSection,
    LICENSE_ACCEPTED_AT_KEY,
    LICENSE_ACCEPTED_VERSION_KEY,
    mainButton,
    openPaletteCommand,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import {
    callbackBlockAhead,
    explorerJson,
    expectConfirmModal,
    fundAddress,
    issuePlainToken,
    readIssueSource,
    healVenueClock,
    mintXchain,
    nudgeChain,
    readReceiveAddress,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    seedPrices,
    selectVenueSendAsset,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    approveConfirm,
    searchMyTokens,
} from '../../fixtures/regtest.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
import { fieldByLabel } from '../../fixtures/fields.js';

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

async function approveAndReadTxid(page, what, { typedCallback = false } = {}) {
    await expectConfirmModal(page, what, 90_000);
    if (typedCallback) {
        const typed = fieldByLabel(page, 'Type "RECALL" to confirm');
        await expect(typed, 'the RECALL confirmation field is missing')
            .toBeVisible({ timeout: 30_000 });
        await typed.fill('RECALL');
    }
    const password = fieldByLabel(page, 'Password');
    if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
        await password.fill(UNLOCK_VALUE);
    }
    await approveConfirm(page);

    return waitForShownTxid(page.getByRole('main'), {
        timeout: 180_000,
        message: `${what} did not show a transaction id`,
    });
}

async function openManageToken(page) {
    await openPaletteCommand(page, 'My tokens');
    const main = page.getByRole('main');
    // The search sits in the title bar's "Filter tokens" menu, outside main.
    await searchMyTokens(page, TICK);
    const row = main.getByRole('button', { name: `Open ${TICK} token details`, exact: true }).first();
    await expectMyTokensRow(main, row, `${TICK} is missing from My Tokens`);
    await row.click();
    // The token opens as the "<TICK> token management" view beside the list.
    await expectManageTokenView(page);
    await expect(page.getByRole('region', { name: `${TICK} token management`, exact: true }),
        `the management view is not showing ${TICK}`).toBeVisible({ timeout: 30_000 });
    return main;
}

async function openExecuteCallbackWhenConfigured(page, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const main = await openManageToken(page);
        // "Recall tokens" is an Actions row that stays aria-disabled until
        // the token's callback config has been read back from the chain.
        const execute = main.locator('[data-action-id="execute-callback"]').first();
        await expect(execute, 'Manage Token has no "Recall tokens" action').toBeVisible({ timeout: 30_000 });
        if ((await execute.getAttribute('aria-disabled')) !== 'true') {
            await execute.click();
            return main;
        }
        await nudgeChain();
        await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw new Error(`Manage Token did not offer "Recall tokens" within ${timeoutMs} ms`);
}

async function readCurrentHeight(main) {
    const hint = main.getByText(/^Current block: /);
    await expect(hint, 'Callback settings did not show the current block')
        .toBeVisible({ timeout: 30_000 });
    const text = await hint.innerText();
    const match = text.match(/Current block:\s*([\d,]+)\./);
    expect(match, `could not parse the current block from: ${text}`).toBeTruthy();
    return Number(match[1].replace(/,/g, ''));
}

/**
 * Mines until the INDEXER's processed height (`last_block`) reaches `target`.
 *
 * The callback form refuses before review while the wallet's indexer
 * watermark is below the token's callback block ("Callback is not allowed
 * until block N. The network is at M."), and that watermark is `last_block`,
 * which trails `chain_tip` by a few blocks while the indexer catches up. A
 * wait on the node's tip alone opens the form that short of the block.
 */
async function mineToHeight(target, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let tip = null;
    let indexed = null;
    while (Date.now() < deadline) {
        const status = await explorerJson('status').catch(() => null);
        tip = Number(status?.chain_tip?.[REGTEST_COIN]);
        indexed = Number(status?.last_block?.[REGTEST_COIN]);
        if (Number.isFinite(indexed) && indexed >= target) return indexed;
        if (!Number.isFinite(tip) || tip < target) await nudgeChain();
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`the indexer never reached block ${target} (chain tip ${tip}, indexed ${indexed})`);
}

/**
 * Opens Execute callback and waits until the WALLET's own block height has
 * reached `callbackBlock`.
 *
 * The explorer's indexer height (`mineToHeight`) is not what the form gates
 * on: the form reads the wallet's own watermark once when it mounts, and that
 * can still be a couple of blocks behind the indexer, so Execute is refused
 * ("Callback is not allowed until block N. The network is at M."). The form
 * prints "Allowed from block N (reached)" once its own height has caught up;
 * until then, keep mining and reopen the form so it re-reads the height.
 */
async function openExecuteCallbackAtWalletHeight(page, callbackBlock, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let seen = 'no block line shown';
    while (Date.now() < deadline) {
        const main = await openExecuteCallbackWhenConfigured(page);
        const allowed = main.getByText('Allowed from block', { exact: true })
            .locator('xpath=following-sibling::dd[1]');
        await expect(allowed, 'Execute callback did not show the allowed-from block')
            .toBeVisible({ timeout: 30_000 });
        await expect.poll(async () => (await allowed.innerText()).includes('(reached)'), {
            timeout: 15_000,
        }).toBe(true).then(() => { seen = 'reached'; }, async () => {
            seen = (await allowed.innerText().catch(() => seen)).replace(/\s+/g, ' ');
        });
        if (seen === 'reached') return main;
        await mineToHeight(callbackBlock);
        await nudgeChain();
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        await page.reload();
        await unlockAfterReload(page, UNLOCK_VALUE);
    }
    throw new Error(`the wallet's own height never reached callback block ${callbackBlock} (${seen})`);
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
    // Home reuses a saved balance read for five minutes, across a reload
    // (BALANCE_MAX_AGE_MS), and only this device's own broadcasts mark it
    // stale. The holder's payout comes from the owner's CALLBACK, so without
    // the menu's Refresh the holder's Home keeps showing the empty read it
    // took before the callback (run 44500883200: no balance request at all
    // after the reload, "No tokens yet" for 90 s).
    await openPaletteCommand(page, 'Refresh');
    await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
    await showHomeBalances(page, 'tokens');
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
            await openPaletteCommand(ownerPage, 'Issue token');
            let main = ownerPage.getByRole('main');
            await expect(fieldByLabel(main, 'Ticker')).toBeVisible({ timeout: 30_000 });
            expect(await readIssueSource(main)).toBe(owner);
            await issuePlainToken(main, { ticker: TICK, supply: SUPPLY });

            const issue = await waitForValidAction(
                await approveAndReadTxid(ownerPage, `the ISSUE of ${TICK}`),
            );
            expect(issue.action).toBe('ISSUE');
            expect(issue.source).toBe(owner);
            await waitForExactBalance(owner, TICK, SUPPLY);

            main = await openManageToken(ownerPage);
            await clickManageTokenAction(main, 'Callback settings');
            main = ownerPage.getByRole('main');
            // Callback token is a token field: a button that opens the token
            // picker, whose search sits behind its Filter button.
            const callbackToken = main.getByRole('button', { name: /^Callback token:/ });
            await expect(callbackToken).toBeVisible({ timeout: 30_000 });
            callbackBlock = await callbackBlockAhead(await readCurrentHeight(main));
            await callbackToken.click();
            await ownerPage.getByRole('button', { name: 'Filter coins and tokens', exact: true }).click();
            await ownerPage.getByLabel('Search coins or tokens', { exact: true }).fill(PAYOUT_TICK);
            await ownerPage.getByRole('button', { name: new RegExp(`^Select ${PAYOUT_TICK} on `) }).first()
                .click({ timeout: 30_000 });
            main = ownerPage.getByRole('main');
            await expect(main.getByRole('button', { name: new RegExp(`^Callback token: ${PAYOUT_TICK} on `) }))
                .toBeVisible({ timeout: 30_000 });
            await fieldByLabel(main, 'Payout per unit').fill(String(PAYOUT_AMOUNT));
            await fieldByLabel(main, 'Callback allowed from block').fill(String(callbackBlock));
            await main.getByRole('button', { name: 'Update callback settings', exact: true }).click();

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
            await fieldByLabel(ownerPage, 'To').fill(holder);
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
            expect(holderXchainBefore).toBe(0);

            await mineToHeight(callbackBlock);
            await ownerPage.reload();
            await unlockAfterReload(ownerPage, UNLOCK_VALUE);
            const main = await openExecuteCallbackAtWalletHeight(ownerPage, callbackBlock);

            const holdersToPay = main.getByText('Holders to pay', { exact: true })
                .locator('xpath=following-sibling::dd[1]');
            const totalPayout = main.getByText('Total payout', { exact: true })
                .locator('xpath=following-sibling::dd[1]');
            await expect(holdersToPay).toHaveText('1', { timeout: 60_000 });
            await expect(totalPayout).toHaveText(`${expectedHolderPayout} ${PAYOUT_TICK}`);

            const execute = main.getByRole('button', { name: 'Recall Tokens', exact: true });
            await expect(execute).toBeEnabled({ timeout: 60_000 });
            await execute.click();
            const txid = await approveAndReadTxid(ownerPage, 'the holder-payout callback', {
                typedCallback: true,
            });
            const callback = await waitForValidAction(txid);
            expect(callback.action).toBe('CALLBACK');
            expect(callback.source).toBe(owner);

            // CALLBACK carries a unified-gas protocol fee (CALLBACK_BASE plus a
            // per-recipient term). On Bitcoin it is paid from the owner's XCHAIN
            // balance, so the owner loses the payout AND the fee. The fee is read
            // off the chain's own record of this action rather than hard-coded,
            // since the gas schedule is protocol data, and summed in millionths
            // so a binary float cannot turn 41 - 0.051 into 40.948999.
            const fee = callback.fee || {};
            const xchainFee = String(fee.tick || '').toUpperCase() === PAYOUT_TICK
                ? Number(fee.amount || 0) : 0;
            expect(Number.isFinite(xchainFee) && xchainFee >= 0,
                `the CALLBACK fee record is unreadable: ${JSON.stringify(callback.fee)}`).toBe(true);
            const micro = (n) => Math.round(n * 1e6);
            const expectedOwnerXchainAfter = (micro(ownerXchainBefore) - micro(expectedHolderPayout)
                - micro(xchainFee)) / 1e6;

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
            // The venue reports XCHAIN with 0 decimals while gas leaves the
            // indexed amount fractional, and Home rounds an explorer aggregate
            // down to the asset's decimals (atomicFromHumanAmount in flows/balances.js).
            await expectHomeBalance(ownerPage, PAYOUT_TICK, Math.floor(ownerXchainAfter));

            await holderPage.reload();
            await unlockAfterReload(holderPage, UNLOCK_VALUE);
            await expectHomeBalance(holderPage, PAYOUT_TICK, HOLDER_UNITS * PAYOUT_AMOUNT);
            await expect(holderPage.locator(`[data-balance-key="${REGTEST_CHAIN_ID}:${TICK}"]`))
                .toHaveCount(0, { timeout: 60_000 });
        });
    });
});
