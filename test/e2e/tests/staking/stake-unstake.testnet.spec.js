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
import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    WALLET_UNLOCK,
    approve,
    gotoPalette,
    readDoneTxid,
} from '../../fixtures/testnet_walk.js';
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
import { FUNDING_SATS } from '../../fixtures/testnet_preflight.js';
import { writeRecoveryRecord } from '../../fixtures/testnet_recover.js';
import { waitForResidualStake } from '../../fixtures/testnet_stakes.js';

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
            const destination = treasury?.address || '<destination>';
            console.warn(`[testnet ${TESTNET_COIN}] ${left} sats remain on ${fundedAddress}; `
                + `recovery file: ${recoveryFile}; dry run: `
                + `node test/e2e/fixtures/testnet_recover.js ${recoveryFile} ${destination}; `
                + 'add --broadcast to send it');
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
            recoveryFile = writeRecoveryRecord(address, phrase);
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
            await gotoPalette(page, 'Staking');
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
            await gotoPalette(page, 'Staking');
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

            const residual = await waitForResidualStake(address, unstake.action_index, {
                explorerUrl,
                coin: TESTNET_COIN,
                timeoutMs: INCLUSION_TIMEOUT,
            });
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
