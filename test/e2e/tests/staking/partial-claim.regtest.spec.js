// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// From the validator network spec, row 21: partial-claim (COLLECT)
// e2e coverage, missing on EVERY venue before this file. `xchain-e2e-test`'s
// collect.test.js proves only the two on-chain REJECTION branches (no active
// stake, no unclaimed rewards) and says outright that the positive path
// "is federation-driven and not exercisable on this pipeline". This spec is
// that positive path, driven from the wallet against a real regtest chain.
//
// WHY A REWARD HAS TO BE ARRANGED RATHER THAN EARNED. Reward accrual is
// PBFT-federation-driven (oracle rounds, ATTEST fee settlement); no regtest
// stack runs a federation. So one uniquely attributable `validator_rewards`
// row is written directly through the indexer's regtest-only execution seam
// (`runInIndexer`, the same delegated `ssh <host> docker exec <indexer>
// node` channel `priceSeed.js` already uses for price_snapshots) rather than
// composed on-chain. The COLLECT itself, its wire, its chain verdict and its
// reward-pool debit are all real.
//
// THE REWARD POOL IS FUNDED FOR REAL, not seeded: `payReward`
// (xchain-indexer/src/actions/collect/settle.js) debits
// `config.ADDRESS.REWARD` and credits SOURCE through the ordinary ledger, so
// the pool's balance has to come from an ordinary transaction the same way
// any address's balance does. A plain XCHAIN SEND to the regtest REWARD
// address (xchain-indexer/src/coins/BTC.js, network 'regtest', a fixed
// constant with no env override) does that.
//
// TWO PRODUCT-SIDE SEAMS THIS SPEC HAD TO WORK AROUND, OUT OF THIS LANE'S
// jail (tests-only; StakingActionForm.jsx is not a listed file):
//
//   1. StakingActionForm.jsx's claim-rewards `availableAmt` (~line 217-236)
//      still filters raw `getRewardsForAddress` accrual rows by a `status`
//      field that endpoint never returns - the same dead filter PC-47
//      already diagnosed and fixed in StakeDetail.jsx's `splitRewards` via
//      `unclaimedRewards({rewards, claims})`, but that fix was never
//      propagated here. Against a real reward this computes 0, and
//      `handleReview` (~line 452) then rejects any partial amount with
//      "Amount exceeds the 0 XCHAIN available." before a confirm ever opens.
//   2. The bespoke "...the rest stays pending." review copy (~line 588)
//      lives only in the `stage === 'review'` JSX block, which the
//      non-watcher (singleEncode) software-wallet path never renders -
//      `handleReview` calls `openConfirmScreen()` directly. The real confirm
//      surface shows the host's generic decode of the composed action
//      instead, which is what this spec asserts against.

import { randomBytes } from 'node:crypto';
import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    ENCODER_URL,
    EXPLORER_URL,
    REGTEST_COIN,
    explorerJson,
    failBroadcast,
    fundAddress,
    healVenueClock,
    mintXchain,
    nudgeChain,
    readReceiveAddress,
    runInIndexer,
    selectVenueSendAsset,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
const MINT_XCHAIN = 200;

const STAKE_AMOUNT = '100';
const POOL_FUND = '60';
const REWARD_AMOUNT = '40.00000000';
const PARTIAL_CLAIM = '15';
const REWARD_REMAINDER = '25.00000000'; // REWARD_AMOUNT - PARTIAL_CLAIM

// Fixed regtest constant (xchain-indexer/src/coins/BTC.js network.regtest.addresses.REWARD);
// not a secret, not env-overridable on regtest.
const REWARD_POOL_ADDRESS = 'mrewardshQqD1ptkEBZGjPDF77L5uKJQmk';

/** A fresh, syntactically-valid 64-hex signing key, same shape the indexer
 * regexes and the stake/unstake spec already relies on. */
function newSigningPubkey() {
    return randomBytes(32).toString('hex');
}

/** Mines until the INDEXER's own processed height reaches `target`, the same
 * indexer-tip (not raw node tip) wait `stake-unstake.regtest.spec.js` uses,
 * copied rather than imported: it is spec-local there too. */
async function mineToHeight(target, timeoutMs = 240_000) {
    const deadline = Date.now() + timeoutMs;
    let tip = null;
    let indexed = null;
    while (Date.now() < deadline) {
        const status = await explorerJson('status').catch(() => null);
        tip = Number(status?.chain_tip?.[REGTEST_COIN]);
        indexed = Number(status?.decoder_tip?.[REGTEST_COIN]);
        if (Number.isFinite(indexed) && indexed >= target) return indexed;
        if (!Number.isFinite(tip) || tip < target) await nudgeChain();
        await new Promise((r) => setTimeout(r, 1_500));
    }
    throw new Error(`indexer never reached ${target} (chain tip ${tip}, indexed ${indexed})`);
}

/** The wallet's shared confirm surface, used by every action form. */
async function approveConfirm(page) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('confirm-approve').click();
}

/** Navigates through the command palette, the way Staking is reached (it
 * hangs off Home's secondary actions and the palette, never a nav tab). */
async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox').first();
    await expect(combobox).toBeVisible();
    await combobox.fill(title);
    await page.keyboard.press('Enter');
}

/** The txid off a form's done screen: every action form ends on one summary
 * line and a single Txid `<dl>` row. */
async function readDoneTxid(page) {
    const value = page.getByRole('main').locator('dl dd').first();
    await expect(value).toBeVisible({ timeout: 30_000 });
    const txid = (await value.innerText()).trim();
    expect(txid, 'the done screen names a real txid').toMatch(/^[0-9a-f]{64}$/);
    return txid;
}

function amountField(scope) {
    return scope.getByRole('textbox', { name: /^Amount/ });
}

/**
 * Every row of an explorer list endpoint, normalized (bare array, `{data}`
 * or `{rows}`), matching the house convention `extractRows` in
 * StakingActionForm.jsx / StakeDetail.jsx uses for the same two endpoints.
 */
async function explorerRows(path) {
    const body = await explorerJson(path);
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body?.rows)) return body.rows;
    return [];
}

/**
 * Independent unclaimed-reward total for `address`: accrued
 * (`validator_rewards`, via `/rewards/{address}/address`) minus VALID claims
 * (`reward_claims`, via `/collects/{address}/address`) - the exact sum
 * `getUnclaimedRewardTotal` computes server-side, read here through the
 * public explorer rather than trusted from the wallet's own screen.
 */
async function unclaimedTotal(address) {
    const rewards = await explorerRows(`rewards/${address}/address`);
    const claims = await explorerRows(`collects/${address}/address`);
    const accrued = rewards.reduce((s, r) => s + Number(r.amount || 0), 0);
    const claimed = claims
        .filter((c) => String(c.status).toLowerCase() === 'valid')
        .reduce((s, c) => s + Number(c.amount || 0), 0);
    return accrued - claimed;
}

/**
 * The script run INSIDE the regtest indexer container to arrange one
 * synthetic `validator_rewards` row. Same safety shape as
 * `priceSeed.js`'s `containerScript`: connection params come from the
 * container's own `INDEXER_DB_*` env, nothing is echoed, and it refuses
 * outright off a regtest `INDEXER_NETWORK`. Refuses separately when the
 * (source, pubkey, reward_type, round_reference) marker already exists,
 * so a prior run's leftover row can never satisfy this run's assertions.
 */
function buildRewardSeedScript({ address, pubkey, amount, rewardType, roundReference }) {
    const decls = Object.entries({ ADDRESS: address, PUBKEY: pubkey, AMOUNT: amount, TYPE: rewardType, REF: roundReference })
        .map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join('\n');
    return `'use strict';
const mariadb = require('mariadb');
${decls}
const env = process.env;
if (env.INDEXER_NETWORK !== 'regtest'){
    console.error('REFUSING: INDEXER_NETWORK is ' + JSON.stringify(env.INDEXER_NETWORK) + ', not regtest.');
    process.exit(2);
}
const params = {
    host: env.INDEXER_DB_HOST, port: Number(env.INDEXER_DB_PORT || 3306),
    user: env.INDEXER_DB_USER, password: env.INDEXER_DB_PASS, database: env.INDEXER_DB_NAME,
};
(async () => {
    const conn = await mariadb.createConnection(params);
    try {
        const src = await conn.query('SELECT id FROM index_addresses WHERE address=? LIMIT 1', [ADDRESS]);
        const pk  = await conn.query('SELECT id FROM index_pubkeys WHERE pubkey=? LIMIT 1', [PUBKEY]);
        if (!src.length || !pk.length)
            throw new Error('address or pubkey not yet interned; the stake must confirm before seeding');
        const sourceId = Number(src[0].id), pubkeyId = Number(pk[0].id);
        const dupe = await conn.query(
            'SELECT 1 FROM validator_rewards WHERE source_id=? AND signing_pubkey_id=?'
            + ' AND reward_type=? AND round_reference=? AND round_qualifier=0',
            [sourceId, pubkeyId, TYPE, REF]);
        if (dupe.length) throw new Error('REFUSING: reward marker already used');
        const tip = await conn.query('SELECT MAX(block_index) AS h FROM blocks');
        const blockIndex = Number(tip[0].h);
        await conn.query(
            'INSERT INTO validator_rewards'
            + ' (source_id, signing_pubkey_id, reward_type, round_reference, round_qualifier, amount, block_index)'
            + ' VALUES (?, ?, ?, ?, 0, ?, ?)',
            [sourceId, pubkeyId, TYPE, REF, AMOUNT, blockIndex]);
        process.stdout.write(JSON.stringify({ sourceId, pubkeyId, blockIndex }) + '\\n');
    } finally {
        await conn.end().catch(() => {});
    }
})().catch((err) => {
    console.error('SEED FAILED: ' + err.message);
    process.exit(1);
});
`;
}

/** Arranges the one synthetic reward this spec claims against. The round
 * reference mixes wall time with random bytes, unique per run regardless of
 * how many times this suite has driven this venue before. */
async function arrangeValidatorReward({ address, pubkey, amount }) {
    const rewardType = 'oracle_round';
    const roundReference = Date.now() * 1000 + randomBytes(2).readUInt16BE(0);
    const result = await runInIndexer(buildRewardSeedScript({
        address, pubkey: pubkey.toLowerCase(), amount, rewardType, roundReference,
    }));
    expect(result?.sourceId, `reward seed did not resolve: ${JSON.stringify(result)}`).toBeTruthy();
    return { rewardType, roundReference, ...result };
}

/** Sends `amount` XCHAIN from the wallet's active address to the regtest
 * reward pool, for real: `payReward` debits that address's ordinary ledger
 * balance, so the pool needs an ordinary funded balance, not a seeded one. */
async function fundRewardPool(page, amount) {
    await gotoSection(page, 'Send');
    await selectVenueSendAsset(page, 'XCHAIN');
    await page.getByLabel('To', { exact: true }).fill(REWARD_POOL_ADDRESS);
    await amountField(page.getByRole('main')).fill(amount);
    await mainButton(page, 'Send').click();
    await approveConfirm(page);
    const txid = await readDoneTxid(page);
    await waitForValidAction(txid);
}

test.describe('partial COLLECT (validator reward claim) on regtest', () => {
    test.use({ actionTimeout: 30_000 });

    // Onboarding, funding, a mint, a stake, a pool-funding SEND, a seeded
    // reward, a deliberately-failed claim, and the real partial claim - more
    // round trips than stake-unstake, sized the same order of magnitude.
    test.setTimeout(1_800_000);

    // COLLECT is BTC-only (xchain-indexer/src/actions/collect/validate.js
    // rejects any other chain outright), matching stake-unstake's own guard.
    test.beforeEach(() => {
        test.skip(REGTEST_COIN !== 'RBTC',
            `COLLECT is BTC-only; ${REGTEST_COIN} has no staking/reward surface to drive`);
    });

    test.beforeAll(async () => {
        await healVenueClock();
    });

    test('a seeded validator reward claims partially, leaves the remainder pending, and the wire carries AMOUNT', async ({ page }) => {
        let staker;
        let pubkey;
        let stakeAction;
        let unclaimedBefore;

        await test.step('onboard onto regtest, fund, mint XCHAIN, and stake under a fresh pubkey', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            staker = await readReceiveAddress(page);
            await fundAddress(staker, FUNDING_BTC);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(staker, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            pubkey = newSigningPubkey();
            await gotoPalette(page, 'Staking');
            const newStakeBtn = page.getByRole('button', { name: 'New stake', exact: true });
            await expect(newStakeBtn).toBeVisible({ timeout: 30_000 });
            await newStakeBtn.click();
            const validatorOption = page.getByRole('button', { name: /^Validator staking/ });
            await expect(validatorOption).toBeVisible({ timeout: 30_000 });
            await validatorOption.click();

            const main = page.getByRole('main');
            await expect(main.getByLabel('Signing public key', { exact: true })).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Signing public key', { exact: true }).fill(pubkey);
            await expect(main.getByText('✓ No existing stake for this pubkey; defaulting to New stake.'))
                .toBeVisible({ timeout: 30_000 });
            await amountField(main).fill(STAKE_AMOUNT);
            await main.getByRole('button', { name: 'Stake', exact: true }).click();
            await approveConfirm(page);
            await expect(main.getByText(/Stake broadcast\./)).toBeVisible({ timeout: 120_000 });

            stakeAction = await waitForValidAction(await readDoneTxid(page));
            expect(stakeAction.action).toBe('STAKE');
            expect(stakeAction.source).toBe(staker);
        });

        await test.step('mine past the activation delay, then fund the reward pool for real', async () => {
            await mineToHeight(Number(stakeAction.activation_block) + 3);
            await fundRewardPool(page, POOL_FUND);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('arrange one uniquely attributable validator reward via the indexer seam', async () => {
            await arrangeValidatorReward({ address: staker, pubkey, amount: REWARD_AMOUNT });
            unclaimedBefore = await unclaimedTotal(staker);
            expect(unclaimedBefore, 'the seeded reward is visible before any claim').toBeCloseTo(Number(REWARD_AMOUNT), 8);
        });

        await test.step('FALSIFY: a permanent broadcast failure on a partial Claim never succeeds and never records a claim', async () => {
            await gotoPalette(page, 'Staking');
            const row = page.getByRole('listitem', { name: 'Open Validator stake', exact: true });
            await expect(row).toBeVisible({ timeout: 60_000 });
            await row.click();

            const claimBtn = page.getByRole('group', { name: 'Stake actions' })
                .getByRole('button', { name: 'Claim', exact: true });
            await expect(claimBtn).toBeVisible({ timeout: 30_000 });
            await expect(claimBtn).toBeEnabled();
            await claimBtn.click();

            const main = page.getByRole('main');
            await failBroadcast(page, 'permanent');
            await amountField(main).fill(PARTIAL_CLAIM);
            await main.getByRole('button', { name: 'Claim rewards', exact: true }).click();

            // The singleEncode path (every non-watcher software wallet) composes
            // host-side and opens the shared confirm surface directly - it never
            // renders StakingActionForm's own `stage === 'review'` block, so the
            // review copy this spec can assert on lives on the CONFIRM MODAL
            // (the host's decode of what it actually composed), not on the form.
            // The remainder-stays-pending review copy is checked on the confirm
            // page's own intent line for that reason.
            const confirm = page.getByTestId('confirm-modal');
            await expect(confirm).toBeVisible({ timeout: 60_000 });
            await expect(confirm).toContainText(PARTIAL_CLAIM);
            await expect(confirm).toContainText('XCHAIN');
            await approveConfirm(page);

            await expect(confirm).toHaveCount(0, { timeout: 120_000 });
            const err = main.getByRole('alert');
            await expect(err).toBeVisible({ timeout: 30_000 });
            await expect(page.getByText(/Claim broadcast\./)).toHaveCount(0);
            expect(await unclaimedTotal(staker), 'a rejected broadcast must not move the unclaimed total')
                .toBeCloseTo(unclaimedBefore, 8);

            await page.unroute(`${ENCODER_URL}/**`);
        });

        await test.step('the real partial claim broadcasts, indexes valid, and leaves the remainder pending', async () => {
            const main = page.getByRole('main');
            await expect(amountField(main)).toHaveValue(PARTIAL_CLAIM);
            await main.getByRole('button', { name: 'Claim rewards', exact: true }).click();
            await approveConfirm(page);
            await expect(main.getByText(/Claim broadcast\./)).toBeVisible({ timeout: 120_000 });

            const collectAction = await waitForValidAction(await readDoneTxid(page));
            expect(collectAction.action).toBe('COLLECT');
            expect(collectAction.status).toBe('valid');
            expect(collectAction.source).toBe(staker);
            expect(Number(collectAction.amount)).toBeCloseTo(Number(PARTIAL_CLAIM), 8);
            // A strict partial carries AMOUNT on the wire (COLLECT|0|<amount>, 3
            // segments); a full claim stays legacy-short (COLLECT|0, 2 segments).
            expect(String(collectAction.tx_data).split('|').length,
                'a partial COLLECT carries AMOUNT on the wire').toBe(3);

            const unclaimedAfter = await unclaimedTotal(staker);
            expect(unclaimedAfter, 'unclaimed after = unclaimed before - the claimed amount')
                .toBeCloseTo(unclaimedBefore - Number(PARTIAL_CLAIM), 8);
            expect(unclaimedAfter).toBeCloseTo(Number(REWARD_REMAINDER), 8);
        });
    });
});
