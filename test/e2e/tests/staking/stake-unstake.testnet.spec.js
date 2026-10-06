// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    GAS_TICK,
    INDEXED_WAIT_MS,
    TESTNET_COIN,
    assertTreasuryKey,
    buildTreasuryFunding,
    checkTestnetVenue,
    liveVenue,
    mintXchain,
    readRunInput,
    readTestnetReceiveAddress,
    switchToTestnet,
    testnetEndpoints,
    unlockAfterReload,
    waitForActivationHeight,
    waitForFundingConfirmed,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/testnet.js';

const WALLET_UNLOCK = 'testnetpassword123';
const FUNDING_SATS = 500_000;
const STAKE_AMOUNT = '100';
const UNSTAKE_AMOUNT = '30';
const MINT_AMOUNT = 200;
const INCLUSION_TIMEOUT = INDEXED_WAIT_MS;
// Activation is several blocks past the stake, each of which can carry the same future wait.
const ACTIVATION_TIMEOUT = INDEXED_WAIT_MS + 60 * 60_000;

const venue = liveVenue();
const { explorerUrl } = testnetEndpoints();

// The funded wallet has a random seed, so its phrase is the only way back to the
// sats sent to it. It is written here, owner-only, before any funding is sent.
const RECOVERY_DIR = path.join(os.tmpdir(), 'xchain-wallet-testnet-recovery');

function recordRecovery(address, phrase) {
    mkdirSync(RECOVERY_DIR, { recursive: true, mode: 0o700 });
    const file = path.join(RECOVERY_DIR, `stake-unstake-${address}.json`);
    writeFileSync(file, JSON.stringify({ address, phrase: phrase.join(' ') }), { mode: 0o600 });
    return file;
}

function signingPubkey() {
    return randomBytes(32).toString('hex');
}

async function fundAddress(treasury, destination) {
    assertTreasuryKey(treasury);
    const view = await venue.utxos(treasury.address);
    const tx = buildTreasuryFunding({
        treasury,
        utxos: Array.isArray(view?.utxos) ? view.utxos : [],
        destination,
        sendSats: FUNDING_SATS,
    });
    const result = await venue.broadcast(tx.txHex);
    const txid = result?.txid || tx.txid;
    await waitForFundingConfirmed(venue, destination, txid, { timeoutMs: INCLUSION_TIMEOUT });
    return txid;
}

async function approve(page) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 120_000 });
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() && await password.isVisible()) await password.fill(WALLET_UNLOCK);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId('confirm-approve').click();
}

async function gotoStaking(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('combobox').fill('Staking');
    await dialog.getByRole('option', { name: /^Staking\b/ }).first().click();
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

async function waitForResidual(address, actionIndex) {
    const deadline = Date.now() + INCLUSION_TIMEOUT;
    while (Date.now() < deadline) {
        const rows = await explorerRows(`stakes/${address}/source`).catch(() => []);
        const row = rows.find((item) => Number(item.action_index) === Number(actionIndex));
        if (row) return row;
        await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    throw new Error(`residual stake for action ${actionIndex} was not indexed`);
}

test.describe('STAKE and partial UNSTAKE on Bitcoin testnet', () => {
    test.use({ actionTimeout: 120_000 });
    // Five indexed waits (funding, mint balance, stake, unstake, residual) and
    // the activation wait, plus an hour for the wallet walk: a ceiling, not an estimate.
    test.setTimeout(5 * INCLUSION_TIMEOUT + ACTIVATION_TIMEOUT + 60 * 60_000);

    let treasury;
    let fundedAddress = null;
    let recoveryFile = null;

    test.beforeAll(async () => {
        treasury = readRunInput();
        await checkTestnetVenue(venue);
    });

    test.afterAll(async () => {
        if (!fundedAddress) return;
        const view = await venue.utxos(fundedAddress).catch(() => null);
        const left = (view?.utxos || []).reduce((sum, u) => sum + Number(u.value), 0);
        if (left > 0) {
            console.warn(`[testnet ${TESTNET_COIN}] ${left} sats remain on ${fundedAddress}; `
                + `restore the wallet from ${recoveryFile} to recover them`);
        }
    });

    test('mints, stakes, waits for activation, and partially unstakes', async ({ page }) => {
        let address;
        let pubkey;
        let stake;

        await test.step('fund a new wallet and mint XCHAIN', async () => {
            const phrase = await createWallet(page, { password: WALLET_UNLOCK });
            await switchToTestnet(page, WALLET_UNLOCK);
            address = await readTestnetReceiveAddress(page);
            fundedAddress = address;
            recoveryFile = recordRecovery(address, phrase);
            await fundAddress(treasury, address);
            await page.reload();
            await unlockAfterReload(page, WALLET_UNLOCK);
            await mintXchain(page, MINT_AMOUNT);
            await waitForTokenBalance(venue, address, GAS_TICK, MINT_AMOUNT, {
                timeoutMs: INCLUSION_TIMEOUT,
            });
            await page.reload();
            await unlockAfterReload(page, WALLET_UNLOCK);
        });

        await test.step('stake under a new signing key', async () => {
            pubkey = signingPubkey();
            await gotoStaking(page);
            await page.getByRole('button', { name: 'New stake', exact: true }).click();
            await page.getByRole('button', { name: /^Validator staking/ }).click();
            const main = page.getByRole('main');
            await expect(main.getByLabel('From', { exact: true })).toHaveValue(address);
            await main.getByLabel('Signing public key', { exact: true }).fill(pubkey);
            await expect(main.getByText('✓ No existing stake for this pubkey; defaulting to New stake.'))
                .toBeVisible({ timeout: 120_000 });
            await main.getByRole('textbox', { name: /^Amount/ }).fill(STAKE_AMOUNT);
            await main.getByRole('button', { name: 'Stake', exact: true }).click();
            await approve(page);
            await expect(main.getByText(/Stake broadcast\./)).toBeVisible({ timeout: 120_000 });
            stake = await waitForValidAction(venue, await readDoneTxid(page), {
                timeoutMs: INCLUSION_TIMEOUT,
            });
            expect(stake.action).toBe('STAKE');
            expect(Number(stake.version)).toBe(1);
            expect(stake.source).toBe(address);
            expect(String(stake.signing_pubkey).toLowerCase()).toBe(pubkey);
            expect(Number(stake.amount)).toBeCloseTo(Number(STAKE_AMOUNT), 8);
        });

        await test.step('wait for the indexed activation height', async () => {
            await waitForActivationHeight(venue, Number(stake.activation_block) + 1, {
                timeoutMs: ACTIVATION_TIMEOUT,
            });
        });

        await test.step('partially unstake and wait for the valid action', async () => {
            await gotoStaking(page);
            const row = page.getByRole('listitem', { name: 'Open Validator stake', exact: true });
            await expect(row).toBeVisible({ timeout: 120_000 });
            await row.click();
            await page.getByRole('group', { name: 'Stake actions' })
                .getByRole('button', { name: 'Unstake', exact: true }).click();
            const main = page.getByRole('main');
            await expect(main.getByLabel('Signing public key', { exact: true })).toHaveValue(pubkey);
            await main.getByRole('textbox', { name: /^Amount/ }).fill(UNSTAKE_AMOUNT);
            await main.getByRole('button', { name: 'Unstake', exact: true }).click();
            await approve(page);
            await expect(main.getByText(/Unstake broadcast\./)).toBeVisible({ timeout: 120_000 });
            const unstake = await waitForValidAction(venue, await readDoneTxid(page), {
                timeoutMs: INCLUSION_TIMEOUT,
            });
            expect(unstake.action).toBe('UNSTAKE');
            expect(unstake.source).toBe(address);
            expect(String(unstake.signing_pubkey).toLowerCase()).toBe(pubkey);
            expect(Number(unstake.amount)).toBeCloseTo(Number(UNSTAKE_AMOUNT), 8);
            expect(String(unstake.tx_data).split('|')).toHaveLength(4);

            const residual = await waitForResidual(address, unstake.action_index);
            expect(residual.status).toBe('valid');
            expect(Number(residual.version)).toBe(2);
            expect(String(residual.signing_pubkey).toLowerCase()).toBe(pubkey);
            expect(Number(residual.amount)).toBeCloseTo(
                Number(STAKE_AMOUNT) - Number(UNSTAKE_AMOUNT),
                8,
            );
        });
    });
});
