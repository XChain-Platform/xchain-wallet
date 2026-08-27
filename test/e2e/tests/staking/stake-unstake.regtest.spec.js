// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Coverage-map Staking row: the OTHER half of the validator lifecycle,
// driven from the wallet against a real regtest chain.
//
// Session 4 already proved a full validator STAKE end to end (form -> sign
// -> broadcast -> VALID index -> lock -> ACTIVE stake). Session 6 then tried
// UNSTAKE and hit: a PARTIAL unstake (20 of 50) carries the mandatory
// 64-hex signing pubkey plus an AMOUNT field, tips the OP_RETURN payload past
// the point a bare full sweep sits at, and the encoder's non-base58 chunk
// lane crashed with "Non-base58 character at XChainEncoder.prepareData:293".
// That bug closed 2026-07-25. This spec is the re-drive: not a new
// capability to build, but the question "does UNSTAKE broadcast now that the
// encoder is fixed" answered against a live chain.
//
// FOUR VENUE FACTS ARE BAKED IN:
//
// 1. THE FAILING SHAPE, NOT THE SAFE ONE. StakingActionForm keeps the wire
//    byte-identical to legacy for a full-balance unstake (VERSION|PUBKEY, no
//    AMOUNT) and only emits AMOUNT for a STRICT PARTIAL. A full sweep would
// dodge by construction and prove nothing about the fix; this spec
//    deliberately unstakes LESS than the full stake so the broadcast carries
//    the exact AMOUNT-bearing wire that crashed before.
//
// 2. ACTIVATION IS A REAL 6-BLOCK DELAY, ON BOTH ENDS. UNSTAKE and STAKE-v2
//    (top-up) both read `getActiveStakeByPubkey(pubkey, blockIndex)`
//    server-side, which requires `activation_block <= blockIndex` - an
//    UNSTAKE attempted before the stake activates fails
//    `invalid: SIGNING_PUBKEY (no active stake...)` for a reason that has
//    nothing to do with the encoder. This spec mines past BTC's
//    ACTIVATION_DELAY_BLOCKS (6) before attempting either.
//
// 3. ASSERTIONS READ THE EXPLORER, NOT THE SCREEN. "Unstake broadcast" is
//    the wallet reporting on itself. The UNSTAKE action's own chain status,
//    its wire (tx_data) and the `stakes` table's synthetic residual row are
//    the chain reporting on the wallet.
//
// 4. THE FALSIFICATION IS THE SAME REAL UNSTAKE, WITH THE ENCODER'S ANSWER
//    FAKED. Source is never touched (the running build is a shared static
//    `vite preview`, so an unrebuilt source edit would be a no-op fixture
//    anyway); `failBroadcast` intercepts the encoder's `broadcast_tx` call
//    the same way `confirm-broadcast.regtest.spec.js` proves Send's
//    permanent-failure classification. Here it proves the confirm surface
// would NOT have quietly reported an -style encoder crash as a
//    success, before the same inputs are sent for real.

import { randomBytes } from 'node:crypto';
import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    ENCODER_URL,
    EXPLORER_URL,
    REGTEST_COIN,
    failBroadcast,
    fundAddress,
    minerRpc,
    mintXchain,
    nudgeChain,
    readReceiveAddress,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
const MINT_XCHAIN = 300;

const STAKE_AMOUNT = '100';
const UNSTAKE_PARTIAL = '30';
const TOPUP_AMOUNT = '20';

/** A fresh, syntactically-valid 64-hex signing key. The indexer regexes the
 * shape (`/^[0-9a-fA-F]{64}$/`) and never checks it is a point on the
 * Ed25519 curve - unstake.js/stake.js validate format only - so a random
 * key is exactly what Session 4's "generated Ed25519 signing pubkey" did. */
function newSigningPubkey() {
    return randomBytes(32).toString('hex');
}

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/** Every `stakes` row (STAKE originals, top-ups, and UNSTAKE's synthetic
 * residual rows) for `address`, whatever pubkey they carry. */
async function stakesForSource(address) {
    const body = await explorerJson(`stakes/${address}/source`);
    return Array.isArray(body) ? body : (Array.isArray(body?.data) ? body.data : []);
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

/** Navigates through the command palette, the way a returning user reaches
 * anything that is not one of the four primary tabs. Staking is not a nav
 * destination at any width; it hangs off Home's secondary actions
 * and off the palette, so the palette is what works identically in every
 * shell. */
async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox').first();
    await expect(combobox).toBeVisible();
    await combobox.fill(title);
    await page.keyboard.press('Enter');
}

/** The txid off a form's done screen: StakeForm and StakingActionForm both
 * end on one summary line and a single Txid `<dl>` row. */
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

/** Mines (paced by `nudgeChain`, never outrunning the indexer) until the
 * INDEXER's own processed height reaches `target` - i.e. past a stake's
 * `activation_block`.
 *
 * MEASURED, not assumed: this waits on `decoder_tip`, not `chain_tip`. A
 * first version polled the raw node tip and returned as soon as it crossed
 * `activation_block`, which raced a transient one-block decode lag on this
 * shared venue - the very next preflight dry-run (Tier 1) still reported
 * "invalid: SIGNING_PUBKEY (no active stake...)" because the INDEXER had not
 * processed that block yet, even though the node had. The stake-activation
 * check reads indexer state, so indexer state is what has to clear the bar. */
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

/** Polls `fetchFn` (mining while it waits) until `predicate` accepts. */
async function waitForCondition(fetchFn, predicate, what, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            last = await fetchFn();
            if (predicate(last)) return last;
        } catch { /* transient while a block lands */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${what} never observed; last=${JSON.stringify(last)}`);
}

test.describe('STAKE -> UNSTAKE lifecycle on regtest (partial unstake, re-driven against the fixed encoder)', () => {
    // The regtest config bounds `expect` but leaves ACTION timeouts unbounded, so
    // a click on a locator that never appears would hang until the whole test
    // times out and report nothing useful. Bounded here, spec-locally.
    test.use({ actionTimeout: 30_000 });

    // Onboarding, funding, a mint, THREE signed actions (STAKE, a deliberately
    // failed UNSTAKE, the real UNSTAKE) plus a top-up, and two rounds of
    // mining past a 6-block activation delay on a shared venue. Sized well
    // above the DEPLOY+EXECUTE spec's 25 minutes for the extra round trips.
    test.setTimeout(1_800_000);

    // BITCOIN BY DESIGN, IN THE PRODUCT, NOT JUST IN THIS SPEC. Staking is
    // BTC-only at launch: `flows/stakingQueries.js` says so in its own comment
    // and its callers resolve a BTC chain through `useBtcAddressesPresent`
    // before querying, and `flows/stakeAction.js` carries the same note. So on
    // Litecoin there is no staking surface to drive and a red here would be a
    // defect report against the wallet for honouring its own launch scope.
    // Skipped rather than converted or `fixme`d. Row 32 drove this green on
    // Bitcoin; it stays the record, and this guard is what keeps that record
    // from reading as a failure on every other chain.
    test.beforeEach(() => {
        test.skip(REGTEST_COIN !== 'RBTC',
            `staking is BTC-only at launch (flows/stakingQueries.js); ${REGTEST_COIN} has no staking surface `
            + 'to drive');
    });

    test.beforeAll(async () => {
        // Heal the shared node's clock before trusting it. Other suites on this
        // venue jump mocktime to cross deadlines and put it back in teardown; a
        // killed run never reaches that teardown, and the next suite then
        // inherits a node whose clock sits under median-time-past, where
        // `generate_blocks` fails outright and every spec on the machine looks
        // broken. Pinning to tip+5 is the ops recipe's repair and costs nothing
        // when the clock is already fine.
        try {
            const status = await explorerJson('status');
            const tip = Number(status?.last_block_time?.[REGTEST_COIN]);
            if (Number.isFinite(tip) && tip > 0) {
                await minerRpc('set_mock_time', { timestamp: tip + 5 });
                await minerRpc('set_default_mining_time', {});
            }
        } catch { /* the venue check in global setup reports unreachability */ }
    });

    test('a stake activates, a partial UNSTAKE broadcasts valid, and a same-key top-up broadcasts as VERSION 2', async ({ page }) => {
        let staker;
        let pubkey;
        let stakeAction;
        let unstakeAction;

        await test.step('onboard onto regtest, fund, and mint XCHAIN', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            staker = await readReceiveAddress(page);
            await fundAddress(staker, FUNDING_BTC);

            // Balances are fetched per chain on mount, so a reload is the cheapest
            // way to make the freshly-confirmed UTXO visible to the forms.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // Capability staking debits AMOUNT straight out of the XCHAIN balance
            // (no separate gas concept, unlike a contract EXECUTE), so this only
            // has to cover STAKE_AMOUNT + TOPUP_AMOUNT with margin.
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(staker, 'XCHAIN', MINT_XCHAIN);

            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('stake XCHAIN under a fresh signing pubkey', async () => {
            pubkey = newSigningPubkey();

            await gotoPalette(page, 'Staking');
            const newStakeBtn = page.getByRole('button', { name: 'New stake', exact: true });
            await expect(newStakeBtn).toBeVisible({ timeout: 30_000 });
            await newStakeBtn.click();

            // Bitcoin is the only chain with an address, so StakeNew skips its
            // inline network step and lands straight on StakeForm.
            const validatorOption = page.getByRole('button', { name: /^Validator staking/ });
            await expect(validatorOption).toBeVisible({ timeout: 30_000 });
            await validatorOption.click();

            const main = page.getByRole('main');
            await expect(main.getByLabel('Signing public key', { exact: true }))
                .toBeVisible({ timeout: 30_000 });

            // The address that will sign must be the one that was funded and
            // minted to: the form resolves its own source from wallet state.
            expect(await main.getByLabel('From', { exact: true }).inputValue(),
                'the stake form signs with the funded address').toBe(staker);

            await main.getByLabel('Signing public key', { exact: true }).fill(pubkey);
            // Auto-detect (new-vs-topup) is what StakeForm actually gates the
            // wire's VERSION on; wait for it rather than trusting the radio's
            // default, so a detection regression would fail HERE, not silently
            // stake the wrong VERSION.
            await expect(main.getByText('✓ No existing stake for this pubkey; defaulting to New stake.'))
                .toBeVisible({ timeout: 30_000 });

            await amountField(main).fill(STAKE_AMOUNT);
            await main.getByRole('button', { name: 'Stake', exact: true }).click();
            await approveConfirm(page);

            await expect(main.getByText(/Stake broadcast\./)).toBeVisible({ timeout: 120_000 });
            const txid = await readDoneTxid(page);

            stakeAction = await waitForValidAction(txid);
            expect(stakeAction.action).toBe('STAKE');
            expect(Number(stakeAction.version), 'a fresh pubkey stakes as VERSION 1').toBe(1);
            expect(stakeAction.source, 'staked by the funded address').toBe(staker);
            expect(String(stakeAction.signing_pubkey).toLowerCase()).toBe(pubkey);
            expect(Number(stakeAction.amount)).toBeCloseTo(Number(STAKE_AMOUNT), 8);
            expect(Number(stakeAction.activation_block), 'the chain assigned a real activation block')
                .toBeGreaterThan(Number(stakeAction.block_index));
        });

        await test.step('mine past the 6-block BTC activation delay', async () => {
            // UNSTAKE and STAKE-v2 both gate on `activation_block <= blockIndex`
            // server-side (getActiveStakeByPubkey); attempting either before this
            // point fails on stake-ownership grounds that have nothing to do with
            // the encoder, which would make this spec's verdict ambiguous. +3 for
            // margin on top of the indexer-height fix in `mineToHeight` itself.
            await mineToHeight(Number(stakeAction.activation_block) + 3);
        });

        await test.step('FALSIFY: a permanent broadcast failure on UNSTAKE surfaces as an error, never a silent success', async () => {
            await gotoPalette(page, 'Staking');
            // StakeRow renders a real <button> but pins role="listitem" on it
            // (it lives inside a role="list" container), so it answers to
            // 'listitem', not 'button', in the accessibility tree.
            const row = page.getByRole('listitem', { name: 'Open Validator stake', exact: true });
            await expect(row).toBeVisible({ timeout: 60_000 });
            await row.click();

            const unstakeBtn = page.getByRole('group', { name: 'Stake actions' })
                .getByRole('button', { name: 'Unstake', exact: true });
            await expect(unstakeBtn).toBeVisible({ timeout: 30_000 });
            await expect(unstakeBtn).toBeEnabled();
            await unstakeBtn.click();

            const main = page.getByRole('main');
            // Prefilled from the stake this address owns; asserting it is the
            // same guard as the STAKE step's From check.
            await expect(main.getByLabel('Signing public key', { exact: true }))
                .toHaveValue(pubkey, { timeout: 30_000 });

            // The encoder is faked from here, deliberately breaking the ONLY
            // thing this spec's "it broadcasts" claim depends on: the network's
            // answer. Everything upstream (compose, tamper-check, signature) is
            // still real, exactly as `failBroadcast`'s own contract promises.
            await failBroadcast(page, 'permanent');

            await amountField(main).fill(UNSTAKE_PARTIAL);
            await main.getByRole('button', { name: 'Unstake', exact: true }).click();

            const confirm = page.getByTestId('confirm-modal');
            await expect(confirm).toBeVisible({ timeout: 60_000 });
            const password = page.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
            await page.getByTestId('confirm-approve').click();

            // RED, on purpose: the happy-path assertions two steps below
            // (success text, `waitForValidAction`) would fail exactly like this
            // if the fix regressed. Proving they CAN fail is what makes them
            // meaningful when they pass for real.
            //
            // MEASURED (not the guess this spec started with): a permanent
            // broadcast rejection does NOT leave the confirm modal open with a
            // `confirm-error` panel - useConfirmAction's 'error' phase resolves
            // through `openConfirmScreen`'s own catch, which closes the confirm
            // screen and returns the PLAIN FORM with the failure surfaced as a
            // StatusMessage `role="alert"` reading
            // "broadcast failed (phase1): Encoder RPC error: <reason>".
            await expect(confirm).toHaveCount(0, { timeout: 120_000 });
            const err = main.getByRole('alert');
            await expect(err).toBeVisible({ timeout: 30_000 });
            await expect(err).toContainText(/missingorspent/i);
            await expect(page.getByText(/Unstake broadcast\./)).toHaveCount(0);

            // Restore: drop the fake encoder answer. The plain form's own state
            // (amount, pubkey) survives the round trip untouched, so the next
            // step re-drives the SAME inputs for real with no re-fill needed.
            await page.unroute(`${ENCODER_URL}/**`);
        });

        await test.step('the real partial UNSTAKE broadcasts and indexes valid', async () => {
            const main = page.getByRole('main');
            // Reject returned to the plain form with state intact (proven for
            // Send in confirm-broadcast.regtest.spec.js); re-assert rather than
            // trust it, since a regression here would silently unstake the
            // wrong amount.
            await expect(amountField(main)).toHaveValue(UNSTAKE_PARTIAL);
            await main.getByRole('button', { name: 'Unstake', exact: true }).click();
            await approveConfirm(page);

            await expect(main.getByText(/Unstake broadcast\./)).toBeVisible({ timeout: 120_000 });
            const txid = await readDoneTxid(page);

            unstakeAction = await waitForValidAction(txid);
            expect(unstakeAction.action).toBe('UNSTAKE');
            expect(unstakeAction.source).toBe(staker);
            expect(String(unstakeAction.signing_pubkey).toLowerCase()).toBe(pubkey);
            expect(Number(unstakeAction.amount)).toBeCloseTo(Number(UNSTAKE_PARTIAL), 8);
            expect(Number(unstakeAction.cooldown_end_block),
                'a cooldown window was assigned').toBeGreaterThan(Number(unstakeAction.block_index));

            // The exact wire-format claim this row exists to re-test.
            // broke on the AMOUNT-bearing lane specifically: a full sweep stays
            // legacy-short (UNSTAKE|0|<pubkey>, 3 segments) and would never have
            // hit the P2SH chunk lane; a strict partial adds AMOUNT (4 segments)
            // and is the shape that crashed before.
            expect(String(unstakeAction.tx_data).split('|').length,
                'a partial UNSTAKE carries AMOUNT on the wire (UNSTAKE|0|<pubkey>|<amount>)')
                .toBe(4);

            // Read the RESULT off the chain, not off the screen: unstake.js's
            // own docstring promises the residual re-stakes as a synthetic
            // VERSION-2 row keyed by this UNSTAKE's own action_index.
            const rows = await waitForCondition(
                () => stakesForSource(staker),
                (list) => list.some((r) => Number(r.action_index) === Number(unstakeAction.action_index)),
                'the synthetic residual stake row for the partial unstake');

            const residual = rows.find((r) => Number(r.action_index) === Number(unstakeAction.action_index));
            expect(residual, 'a residual stake row exists for this UNSTAKE').toBeTruthy();
            expect(residual.status).toBe('valid');
            expect(Number(residual.version), 'the residual re-stake rides as VERSION 2 (top-up)').toBe(2);
            expect(String(residual.signing_pubkey).toLowerCase()).toBe(pubkey);
            expect(Number(residual.amount),
                'residual = original stake - the partial unstake amount')
                .toBeCloseTo(Number(STAKE_AMOUNT) - Number(UNSTAKE_PARTIAL), 8);

            const original = rows.find((r) => Number(r.action_index) === Number(stakeAction.action_index));
            expect(original, 'the original stake row is still present').toBeTruthy();
            expect(Number(original.deactivation_block),
                'the swept original row now carries a real deactivation block')
                .toBeGreaterThan(Number(unstakeAction.block_index));
        });

        await test.step('Top-up mode: staking again under the SAME pubkey broadcasts as VERSION 2', async () => {
            await gotoPalette(page, 'Staking');
            const newStakeBtn = page.getByRole('button', { name: 'New stake', exact: true });
            await expect(newStakeBtn).toBeVisible({ timeout: 30_000 });
            await newStakeBtn.click();

            const validatorOption = page.getByRole('button', { name: /^Validator staking/ });
            await expect(validatorOption).toBeVisible({ timeout: 30_000 });
            await validatorOption.click();

            const main = page.getByRole('main');
            await expect(main.getByLabel('Signing public key', { exact: true }))
                .toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Signing public key', { exact: true }).fill(pubkey);

            // The original stake (still active) plus the just-unstaked residual
            // both carry this pubkey, so detection must find SOME active row and
            // default to top-up rather than "already in use".
            await expect(main.getByText(/Existing stake found; defaulting to Top up\./))
                .toBeVisible({ timeout: 30_000 });

            await amountField(main).fill(TOPUP_AMOUNT);
            await main.getByRole('button', { name: 'Stake', exact: true }).click();
            await approveConfirm(page);

            await expect(main.getByText(/Stake broadcast\./)).toBeVisible({ timeout: 120_000 });
            const txid = await readDoneTxid(page);

            const topupAction = await waitForValidAction(txid);
            expect(topupAction.action).toBe('STAKE');
            expect(Number(topupAction.version), 'staking a key already in use rides as VERSION 2').toBe(2);
            expect(topupAction.source).toBe(staker);
            expect(String(topupAction.signing_pubkey).toLowerCase()).toBe(pubkey);
            expect(Number(topupAction.amount)).toBeCloseTo(Number(TOPUP_AMOUNT), 8);
        });
    });
});
