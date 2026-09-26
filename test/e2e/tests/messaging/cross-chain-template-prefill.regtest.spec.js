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
import {
    ENCODER_URL,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_TICKER,
    fundAddress,
    healVenueClock,
    mintXchain,
    readReceiveAddress,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const STAMP = Date.now().toString().slice(-6);
const TICK_ONE = `XTA${STAMP}`;
const TICK_TWO = `XTB${STAMP}`;
const XCHAIN_FUNDING = 50;

function trackBroadcastTxids(page) {
    const txids = [];
    page.on('response', async (response) => {
        try {
            if (!response.url().startsWith(ENCODER_URL)) return;
            if (response.request().method() !== 'POST') return;
            if (!(response.request().postData() || '').includes('"broadcast_tx"')) return;
            const body = await response.json().catch(() => null);
            if (body?.result?.txid) txids.push(body.result.txid);
        } catch { /* ignore */ }
    });
    return txids;
}

async function waitForBroadcastTxid(txids, index, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (txids[index]) return txids[index];
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`broadcast ${index + 1} never returned a transaction id`);
}

// Exact role names, not getByLabel: a label query substring-matches, so
// 'Action' also picks up the composer's "+ Add action" button.
const rowField = (scope, role, name) => scope.getByRole(role, { name, exact: true });

async function gotoCrossChainTemplates(page) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    const actions = page.getByRole('main');
    await actions.getByRole('button', { name: /^Cross-chain templates/ }).click();
    await expect(page.getByRole('main').getByText('Bridge token pair', { exact: true }))
        .toBeVisible({ timeout: 30_000 });
}

test.describe(`cross-chain template prefill on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test.beforeAll(async () => {
        await healVenueClock();
    });

    test('selecting Bridge token pair prefills Parallel and every edited row lands as an indexed action', async ({ page }) => {
        const txids = trackBroadcastTxids(page);
        let source;
        let firstSetupAction;
        let secondSetupAction;

        await test.step('fund the signer and create fee balance plus two real LINK targets', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Template Prefill Wallet' });
            await switchToRegtest(page, PASSWORD);
            source = await readReceiveAddress(page);
            await fundAddress(source, 1);

            await mintXchain(page, XCHAIN_FUNDING);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_FUNDING);
            const firstMintTxid = await waitForBroadcastTxid(txids, 0);
            firstSetupAction = await waitForValidAction(firstMintTxid);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await mintXchain(page, XCHAIN_FUNDING);
            await waitForTokenBalance(source, 'XCHAIN', XCHAIN_FUNDING * 2);
            const secondMintTxid = await waitForBroadcastTxid(txids, 1);
            secondSetupAction = await waitForValidAction(secondMintTxid);

            // One confirmed input per Parallel row. Rows sign back to back from
            // one address, and the encoder reserves an input for 5 minutes once
            // built, so with a single UTXO row 2 waits on row 1's change reaching
            // the utxo-tracker's mempool view (polled once a minute) and fails
            // with "all 1 candidate input(s) are reserved".
            await fundAddress(source, 1);
            await fundAddress(source, 1);

            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('select the bundled template and prove its three rows reached Parallel', async () => {
            await gotoCrossChainTemplates(page);
            const card = page.locator('article').filter({ hasText: 'Bridge token pair' });
            await expect(card).toContainText('Issue the canonical supply');
            await card.getByRole('button', { name: 'Use template', exact: true }).click();

            const main = page.getByRole('main');
            await expect(main.getByText('Compose any number of independent actions'))
                .toBeVisible({ timeout: 30_000 });
            await expect(rowField(main, 'combobox', 'Action')).toHaveCount(3);
            await expect(rowField(main, 'combobox', 'Action').nth(0)).toHaveValue('ISSUE');
            await expect(rowField(main, 'combobox', 'Action').nth(1)).toHaveValue('ISSUE');
            await expect(rowField(main, 'combobox', 'Action').nth(2)).toHaveValue('LINK');
            await expect(rowField(main, 'textbox', 'Params (JSON object)').nth(0)).toHaveValue(/"TICK": "BRIDGEME"/);
            await expect(rowField(main, 'textbox', 'Params (JSON object)').nth(2))
                .toHaveValue(/<ISSUE action_index from row 1>/);

            for (let i = 0; i < 3; i += 1) {
                await rowField(main, 'combobox', 'Chain').nth(i).selectOption(REGTEST_CHAIN_ID);
                expect(await rowField(main, 'combobox', 'From address').nth(i)
                    .evaluate((el) => el.options[el.selectedIndex]?.text || ''))
                    .toBe(source);
            }

            await rowField(main, 'textbox', 'Params (JSON object)').nth(0).fill(JSON.stringify({
                VERSION: '0',
                TICK: TICK_ONE,
                MAX_SUPPLY: '1000',
                MINT_SUPPLY: '1000',
                DECIMALS: '0',
                DESCRIPTION: `template row one ${STAMP}`,
            }));
            await rowField(main, 'textbox', 'Params (JSON object)').nth(1).fill(JSON.stringify({
                VERSION: '0',
                TICK: TICK_TWO,
                MAX_SUPPLY: '2000',
                MINT_SUPPLY: '2000',
                DECIMALS: '0',
                DESCRIPTION: `template row two ${STAMP}`,
            }));
            await rowField(main, 'textbox', 'Params (JSON object)').nth(2).fill(JSON.stringify({
                VERSION: '0',
                COIN1: REGTEST_TICKER,
                COIN1_ACTION_INDEX: String(firstSetupAction.action_index),
                COIN2: REGTEST_TICKER,
                COIN2_ACTION_INDEX: String(secondSetupAction.action_index),
                MEMO: `template link ${STAMP}`,
            }));
        });

        await test.step('sign each prefilled row and verify all three explorer records', async () => {
            const main = page.getByRole('main');
            await main.getByRole('button', { name: 'Review', exact: true }).click();
            await expect(main.getByText('3 actions across 1 chain')).toBeVisible({ timeout: 30_000 });
            await main.getByRole('checkbox', { name: 'I understand parallel actions are not atomic.' }).check();
            await main.getByRole('button', { name: 'Sign all', exact: true }).click();

            const password = main.getByLabel('Password', { exact: true });
            for (let row = 0; row < 3; row += 1) {
                await expect(main.getByText(`Signing action ${row + 1} of 3`))
                    .toBeVisible({ timeout: 120_000 });
                // An unlocked wallet signs without a password field at all.
                if (await password.count() && !(await password.inputValue())) await password.fill(PASSWORD);
                await main.getByRole('button', { name: 'Sign', exact: true }).click();
                await waitForBroadcastTxid(txids, row + 2);
            }

            await expect(main.getByText('Parallel run complete')).toBeVisible({ timeout: 120_000 });

            const issuedOne = await waitForValidAction(txids[2]);
            expect(issuedOne.action).toBe('ISSUE');
            expect(issuedOne.source).toBe(source);
            expect(String(issuedOne.tick ?? issuedOne.params?.TICK ?? '')).toBe(TICK_ONE);

            const issuedTwo = await waitForValidAction(txids[3]);
            expect(issuedTwo.action).toBe('ISSUE');
            expect(issuedTwo.source).toBe(source);
            expect(String(issuedTwo.tick ?? issuedTwo.params?.TICK ?? '')).toBe(TICK_TWO);

            const linked = await waitForValidAction(txids[4]);
            expect(linked.action).toBe('LINK');
            expect(linked.source).toBe(source);
            expect(String(linked.coin1_action_index ?? linked.params?.COIN1_ACTION_INDEX ?? ''))
                .toBe(String(firstSetupAction.action_index));
            expect(String(linked.coin2_action_index ?? linked.params?.COIN2_ACTION_INDEX ?? ''))
                .toBe(String(secondSetupAction.action_index));
            expect(String(linked.memo ?? linked.params?.MEMO ?? '')).toBe(`template link ${STAMP}`);
        });
    });
});
