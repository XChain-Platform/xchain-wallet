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
    WALLET_UNLOCK,
    approve,
    gotoPalette,
    readDoneTxid,
} from '../../fixtures/testnet_walk.js';
import {
    INDEXED_WAIT_MS,
    TESTNET_COIN,
    addressTypeOf,
    assertTreasuryKey,
    checkTestnetVenue,
    liveVenue,
    readRunInput,
    switchToTestnet,
    testnetEndpoints,
    unlockAfterReload,
    waitForValidAction,
} from '../../fixtures/testnet.js';
import { preflightClaimantUtxo } from '../../fixtures/testnet_preflight.js';
import {
    claimAmount,
    preflightClaimantReward,
    unclaimedReward,
} from '../../fixtures/testnet_rewards.js';

const INCLUSION_TIMEOUT = INDEXED_WAIT_MS;

const venue = liveVenue();
const { explorerUrl } = testnetEndpoints();

async function importClaimant(page, claimant) {
    // The live validators stake from P2PKH addresses, so the key is proven
    // against, and imported as, the type its declared address carries.
    const type = addressTypeOf(claimant.address);
    assertTreasuryKey(claimant, undefined, { type });
    await gotoPalette(page, 'Addresses');
    await page.getByRole('button', { name: 'Add or import address' }).click();
    await page.getByRole('menuitem', { name: 'Import address' }).click();

    const chain = page.getByRole('button', { name: /^Network:/ });
    await expect(chain).toBeVisible({ timeout: 30_000 });
    if (!((await chain.getAttribute('aria-label')) || '').includes('Bitcoin')) {
        await chain.click();
        await page.getByRole('option', { name: /^Bitcoin\b/ }).first().click();
    }

    await page.getByLabel('Address type').selectOption(type);
    await page.getByLabel('WIF private key').fill(claimant.wif);
    await page.getByLabel('Label (optional)').fill('Testnet validator claimant');
    const password = page.getByLabel('Wallet password', { exact: true });
    if (await password.count()) await password.fill(WALLET_UNLOCK);
    await page.getByRole('checkbox', { name: /backed up by my recovery phrase/i }).check();
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    const notice = page.getByText(/^Imported /);
    await expect(notice).toBeVisible({ timeout: 120_000 });
    expect(await notice.innerText()).toContain(claimant.address);
    await page.getByRole('button', { name: `View address ${claimant.address}` }).click();
    const use = page.getByRole('button', { name: 'Use', exact: true });
    await expect(use).toHaveAttribute('title', 'Make this the active address');
    await use.click();
    await expect(use).toBeHidden({ timeout: 120_000 });
}

test.describe('partial validator reward claim on Bitcoin testnet', () => {
    test.use({ actionTimeout: 120_000 });
    // One indexed wait, plus an hour for the wallet walk and the reads around it.
    test.setTimeout(INCLUSION_TIMEOUT + 60 * 60_000);

    let input;

    test.beforeAll(async () => {
        input = readRunInput();
        await checkTestnetVenue(venue);
    });

    test('claims part of an existing validator reward and leaves the remainder pending', async ({ page }) => {
        const claimant = input.claimant;
        const before = await preflightClaimantReward(input, { explorerUrl, coin: TESTNET_COIN });
        await preflightClaimantUtxo(venue, claimant.address);

        await test.step('import and activate the validator claimant', async () => {
            await createWallet(page, { password: WALLET_UNLOCK });
            await switchToTestnet(page, WALLET_UNLOCK);
            await importClaimant(page, claimant);
        });

        await test.step('claim only part of the pending amount', async () => {
            const amount = claimAmount(before, claimant.amount);
            expect(Number(amount)).toBeGreaterThan(0);
            expect(Number(amount)).toBeLessThan(before);

            await page.reload();
            await unlockAfterReload(page, WALLET_UNLOCK);
            await gotoPalette(page, 'Staking');
            // A live validator can hold several stake rows (its first STAKE and
            // any top-up), and every row shows the same reward because COLLECT
            // is claimed per source address, so any of them opens the same claim.
            const row = page.getByRole('listitem', { name: 'Open Validator stake', exact: true }).first();
            await expect(row).toBeVisible({ timeout: 120_000 });
            await row.click();
            const claim = page.getByRole('group', { name: 'Stake actions' })
                .getByRole('button', { name: 'Claim', exact: true });
            await expect(claim).toBeEnabled({ timeout: 120_000 });
            await claim.click();

            const main = page.getByRole('main');
            // Type only once the form knows the pending total. Until then the
            // field reads "Loading…" and a submit carries no AMOUNT, which the
            // chain takes as a claim of everything (seen 2026-09-30: 1 typed,
            // COLLECT|0 paid 130).
            await expect(main.getByText(/XCHAIN available$/)).toBeVisible({ timeout: 120_000 });
            await main.getByRole('textbox', { name: /^Amount/ }).fill(amount);
            await main.getByRole('button', { name: 'Claim rewards', exact: true }).click();
            await approve(page);
            await expect(main.getByText(/Claim broadcast\./)).toBeVisible({ timeout: 120_000 });
            const action = await waitForValidAction(venue, await readDoneTxid(page), {
                timeoutMs: INCLUSION_TIMEOUT,
            });
            expect(action.action).toBe('COLLECT');
            expect(action.source).toBe(claimant.address);
            expect(Number(action.amount)).toBeCloseTo(Number(amount), 8);
            expect(String(action.tx_data).split('|')).toHaveLength(3);

            const after = await unclaimedReward(claimant.address, { explorerUrl, coin: TESTNET_COIN });
            expect(after).toBeGreaterThanOrEqual(before - Number(amount) - 0.00000001);
            expect(after).toBeGreaterThan(0);
        });
    });
});
