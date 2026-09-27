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
    TESTNET_COIN,
    assertTreasuryKey,
    checkTestnetVenue,
    liveVenue,
    switchToTestnet,
    testnetEndpoints,
    unlockAfterReload,
    waitForValidAction,
} from '../../fixtures/testnet.js';

const WALLET_UNLOCK = 'testnetpassword123';
const INCLUSION_TIMEOUT = 90 * 60_000;
const MIN_CLAIM_UTXO_SATS = 20_000;
const TREASURY_SLOT = Symbol.for('xchain-wallet.testnet-treasury');

const venue = liveVenue();
const { explorerUrl } = testnetEndpoints();

async function readRunInput() {
    const raw = await new Promise((resolve, reject) => {
        let text = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { text += chunk; });
        process.stdin.on('end', () => resolve(text));
        process.stdin.on('error', reject);
    });
    if (!raw.trim()) return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('testnet stdin is not a JSON object');
    }
    if (typeof parsed?.wif !== 'string'
        || typeof (parsed?.address ?? parsed?.segwitAddress) !== 'string') {
        throw new Error('testnet stdin must carry treasury fields wif and address');
    }
    return { ...parsed, address: parsed.address ?? parsed.segwitAddress };
}

async function sharedRunInput() {
    if (!globalThis[TREASURY_SLOT]) globalThis[TREASURY_SLOT] = readRunInput();
    return globalThis[TREASURY_SLOT];
}

async function approve(page) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 120_000 });
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() && await password.isVisible()) await password.fill(WALLET_UNLOCK);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId('confirm-approve').click();
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('combobox').fill(title);
    await dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
}

async function importClaimant(page, claimant) {
    assertTreasuryKey(claimant);
    await gotoPalette(page, 'Addresses');
    await page.getByRole('button', { name: 'Add or import address' }).click();
    await page.getByRole('menuitem', { name: 'Import address' }).click();

    const chain = page.getByRole('button', { name: /^Chain:/ });
    await expect(chain).toBeVisible({ timeout: 30_000 });
    if (!((await chain.getAttribute('aria-label')) || '').includes('Bitcoin')) {
        await chain.click();
        await page.getByRole('option', { name: /^Bitcoin\b/ }).first().click();
    }

    await page.getByLabel('Address type').selectOption('p2wpkh');
    await page.getByLabel('WIF private key').fill(claimant.wif);
    await page.getByLabel('Label (optional)').fill('Testnet validator claimant');
    const password = page.getByLabel('Wallet password', { exact: true });
    if (await password.count()) await password.fill(WALLET_UNLOCK);
    await page.getByRole('checkbox', { name: /not backed up by my recovery phrase/i }).check();
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

async function readDoneTxid(page) {
    const value = page.getByRole('main').locator('code, dd')
        .filter({ hasText: /^[0-9a-f]{64}$/ }).first();
    await expect(value).toBeVisible({ timeout: 120_000 });
    const txid = (await value.innerText()).trim();
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    return txid;
}

async function explorerRows(path) {
    const response = await fetch(`${explorerUrl}/${TESTNET_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`explorer returned HTTP ${response.status} for ${path}`);
    const body = await response.json();
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body?.rows)) return body.rows;
    return [];
}

function rewardTotal(rewards, claims) {
    const accrued = rewards.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const claimed = claims
        .filter((row) => String(row.status).toLowerCase() === 'valid')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return accrued - claimed;
}

async function unclaimed(address) {
    const [rewards, claims] = await Promise.all([
        explorerRows(`rewards/${address}/address`),
        explorerRows(`collects/${address}/address`),
    ]);
    return rewardTotal(rewards, claims);
}

function partialAmount(total) {
    const units = BigInt(Math.floor(total * 100_000_000));
    const partial = units > 1n ? units / 2n : 1n;
    const whole = partial / 100_000_000n;
    const fraction = (partial % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
}

test.describe('partial validator reward claim on Bitcoin testnet', () => {
    test.use({ actionTimeout: 120_000 });
    test.setTimeout(3 * 60 * 60_000);

    let input;

    test.beforeAll(async () => {
        input = await sharedRunInput();
        test.skip(!input, 'pipe the stdin-only testnet run JSON to run live writes');
        await checkTestnetVenue(venue);
    });

    test('claims part of an existing validator reward and leaves the remainder pending', async ({ page }) => {
        const claimantInput = input.claimant ?? input.validator;
        if (typeof claimantInput?.wif !== 'string'
            || typeof (claimantInput?.address ?? claimantInput?.segwitAddress) !== 'string') {
            throw new Error('testnet stdin needs claimant { wif, address } for the partial-claim spec');
        }
        const claimant = {
            wif: claimantInput.wif,
            address: claimantInput.address ?? claimantInput.segwitAddress,
        };

        const before = await unclaimed(claimant.address);
        if (before <= 0.00000001) {
            throw new Error('the supplied claimant has no partial validator reward available');
        }
        const confirmed = (await venue.utxos(claimant.address))?.utxos
            ?.filter((row) => Number(row.confirmations) >= 1) ?? [];
        const largestConfirmed = confirmed.reduce(
            (largest, row) => Math.max(largest, Number(row.value) || 0),
            0,
        );
        if (largestConfirmed < MIN_CLAIM_UTXO_SATS) {
            throw new Error(`the supplied claimant needs one confirmed UTXO of at least ${MIN_CLAIM_UTXO_SATS} sats`);
        }

        await test.step('import and activate the validator claimant', async () => {
            await createWallet(page, { password: WALLET_UNLOCK });
            await switchToTestnet(page, WALLET_UNLOCK);
            await importClaimant(page, claimant);
        });

        await test.step('claim only part of the pending amount', async () => {
            const amount = partialAmount(before);
            expect(Number(amount)).toBeGreaterThan(0);
            expect(Number(amount)).toBeLessThan(before);

            await page.reload();
            await unlockAfterReload(page, WALLET_UNLOCK);
            await gotoPalette(page, 'Staking');
            const row = page.getByRole('listitem', { name: 'Open Validator stake', exact: true });
            await expect(row).toBeVisible({ timeout: 120_000 });
            await row.click();
            const claim = page.getByRole('group', { name: 'Stake actions' })
                .getByRole('button', { name: 'Claim', exact: true });
            await expect(claim).toBeEnabled({ timeout: 120_000 });
            await claim.click();

            const main = page.getByRole('main');
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

            const after = await unclaimed(claimant.address);
            expect(after).toBeGreaterThanOrEqual(before - Number(amount) - 0.00000001);
            expect(after).toBeGreaterThan(0);
        });
    });
});
