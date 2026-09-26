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
    REGTEST_DESTINATION,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const STAMP = Date.now().toString().slice(-6);
const TICK = `WLS${STAMP}`;
const SUPPLY = 1000;
const XCHAIN_MINT = 50;

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('combobox').first().fill(title);
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
    expect(txid, `${what} result did not show a transaction id`).toBeTruthy();
    return txid;
}

async function publishAddressList(page, member) {
    await gotoPalette(page, 'Create a list');
    const main = page.getByRole('main');
    await expect(main.getByLabel('List type')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    await main.getByLabel('List type').selectOption('2');
    await main.getByLabel('Addresses', { exact: true }).fill(member);
    await expect(main).toContainText('1 valid address');
    await main.getByRole('button', { name: /^(Publish list|Review)$/ }).click();

    const action = await waitForValidAction(await approveAndReadTxid(page, 'the address list'));
    expect(action.action).toBe('LIST');
    const stored = (action.list || action.items || action.members || [])
        .map((row) => String(typeof row === 'object' ? (row.address ?? row.item ?? '') : row));
    expect(stored).toContain(member);

    // The palette does not reset a route it is already on, so a second
    // "Create a list" from this success screen would keep showing it.
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    return String(action.action_index);
}

async function chooseList(page, kind, actionIndex) {
    const main = page.getByRole('main');
    await main.getByRole('button', { name: `Choose ${kind}-list` }).click();
    const row = page.getByRole('button', {
        name: new RegExp(`^Address list #${actionIndex}\\b`),
    });
    await expect(row, `list #${actionIndex} was not offered as the ${kind}-list`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();
    await expect(main).toContainText(`List #${actionIndex}`);
}

test.describe(`wizard access-list fields on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('Custom binds both published address lists in the genesis ISSUE', async ({ page }) => {
        await createWallet(page, { password: PASSWORD, name: 'Wizard Lists Wallet' });
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

        const allowList = await publishAddressList(page, source);
        const blockList = await publishAddressList(page, REGTEST_DESTINATION);
        expect(blockList).not.toBe(allowList);

        await gotoPalette(page, 'Create a token');
        const main = page.getByRole('main');
        await main.getByRole('button', { name: /^Custom/ }).click();
        await selectVenueChain(main);
        await main.getByRole('button', { name: 'Next', exact: true }).click();

        await main.getByLabel('Token name (ticker)').fill(TICK);
        await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
        await main.getByRole('button', { name: 'Advanced settings (optional)' }).click();
        await chooseList(page, 'allow', allowList);
        await chooseList(page, 'block', blockList);
        await main.getByRole('button', { name: 'Issue token', exact: true }).click();

        const txid = await approveAndReadTxid(page, 'the token creation');
        const genesis = await waitForValidAction(txid);
        expect(genesis.action).toBe('ISSUE');
        expect(String(genesis.tick)).toBe(TICK);
        expect(String(genesis.allow_list)).toBe(allowList);
        expect(String(genesis.block_list)).toBe(blockList);

        await waitForTokenBalance(source, TICK, SUPPLY);
        const token = await explorerJson(`token/${TICK}`);
        expect(String(token?.lists?.allow)).toBe(allowList);
        expect(String(token?.lists?.block)).toBe(blockList);
    });
});
