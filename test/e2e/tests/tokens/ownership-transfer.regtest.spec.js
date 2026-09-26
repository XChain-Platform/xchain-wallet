// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Token ownership transfer through Manage Token. The source smoke check only
// proves that the editor calls the ISSUE flow with TRANSFER. This spec signs
// that edit, waits for its indexed ISSUE row, and then reads the new owner from
// the explorer token record.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    mintXchain,
    nudgeChain,
    readReceiveAddress,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const XCHAIN_MINT = 20;
const SUPPLY = 1000;
const STAMP = Date.now().toString().slice(-6);
const TICK = `OWR${STAMP}`;

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function reloadToHome(page) {
    await gotoPalette(page, 'Home');
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
}

async function approveAndGetTxid(page) {
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible().catch(() => false)) {
        await password.fill(PASSWORD);
    }
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled({ timeout: 120_000 });
    await approve.click();

    const main = page.getByRole('main');
    await expect(main, 'no transaction id appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'the success screen showed no transaction id').toBeTruthy();
    return txid;
}

async function openTokenAdmin(page, item, tick) {
    await reloadToHome(page);
    await gotoPalette(page, 'My Tokens');
    const main = page.getByRole('main');
    const row = main.getByRole('button').filter({ hasText: tick }).first();
    await expect(row, `${tick} is on chain but My Tokens does not list it`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();
    // "Manage Token" is the page title in the banner, outside <main>; the
    // ticker heading is what proves this token's admin page opened.
    await expect(main.getByRole('heading', { name: tick, exact: true }), 'Manage Token did not open on this ticker')
        .toBeVisible({ timeout: 30_000 });

    const button = main.getByRole('button', { name: item, exact: true });
    if (await button.count() > 0 && await button.first().isVisible()) {
        await button.first().click();
        return;
    }
    await main.getByRole('button', { name: /^More/ }).click();
    await main.getByRole('menuitem', { name: item, exact: true }).click();
}

async function generateVenueAddress(page) {
    await gotoPalette(page, 'Addresses');
    const listed = async () => {
        const rows = page.getByRole('button', { name: /^View address / });
        await expect(rows.first()).toBeVisible({ timeout: 30_000 });
        return (await Promise.all((await rows.all()).map((row) => row.getAttribute('aria-label'))))
            .map((label) => String(label).replace('View address ', ''))
            .filter(Boolean);
    };
    const before = new Set(await listed());

    await page.getByRole('button', { name: 'Add or import address' }).click();
    await page.getByRole('menuitem', { name: 'Add address' }).click();
    await selectVenueChain(page, 'Coin');
    await page.getByRole('button', { name: /^Generate/ }).click();

    const generated = (await listed()).filter((address) => !before.has(address));
    expect(generated.length, 'generating added exactly one address').toBe(1);
    expect(generated[0]).toMatch(REGTEST_ADDRESS_RE);
    return generated[0];
}

async function waitForOwner(tick, expected, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const token = await explorerJson(`token/${tick}`).catch(() => null);
        last = token?.info?.owner ?? null;
        if (last === expected) return token;
        await nudgeChain();
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`${tick} owner never became ${expected} (last=${last})`);
}

test.describe(`token ownership transfer on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('the transfer editor changes the owner recorded by the explorer', async ({ page }) => {
        let owner;
        let newOwner;

        await test.step('onboard, fund the protocol fee, and issue an owned token', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Ownership Transfer Wallet' });
            await switchToRegtest(page, PASSWORD);
            owner = await readReceiveAddress(page);
            expect(owner).toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(owner, FUNDING);
            await mintXchain(page, XCHAIN_MINT);
            await waitForTokenBalance(owner, 'XCHAIN', XCHAIN_MINT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await seedPrices();

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            expect(await main.getByLabel('From').inputValue()).toBe(owner);
            await main.getByLabel('Ticker').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmModal(page, 'the ISSUE');
            const action = await waitForValidAction(await approveAndGetTxid(page));
            expect(action.action).toBe('ISSUE');
            expect(action.source).toBe(owner);
            await waitForTokenBalance(owner, TICK, SUPPLY);
            expect((await waitForOwner(TICK, owner))?.info?.owner).toBe(owner);
        });

        await test.step('generate a same-chain destination and submit the transfer editor', async () => {
            await reloadToHome(page);
            newOwner = await generateVenueAddress(page);
            expect(newOwner, 'the transfer destination must differ from the issuer').not.toBe(owner);

            await openTokenAdmin(page, 'Transfer', TICK);
            const main = page.getByRole('main');
            const destination = main.getByLabel('New owner address');
            await expect(destination).toBeVisible({ timeout: 30_000 });
            await destination.fill(newOwner);
            await main.getByRole('button', { name: 'Update token', exact: true }).click();

            await expectConfirmModal(page, 'the ownership transfer');
            await expect(page.getByTestId('action-intent'))
                .toContainText(`Transfer ownership of ${TICK}`);
            const txid = await approveAndGetTxid(page);
            const action = await waitForValidAction(txid);
            expect(action.action, 'ownership transfer must ride as ISSUE v0').toBe('ISSUE');
            expect(action.source).toBe(owner);
        });

        await test.step('the explorer token record names the new owner', async () => {
            const token = await waitForOwner(TICK, newOwner);
            expect(token?.info?.owner, 'the indexed owner did not change').toBe(newOwner);
            expect(token?.info?.owner, 'the old owner still owns the token').not.toBe(owner);
        });
    });
});
