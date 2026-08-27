// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §11.3's owed "legacy submit lane", which turned into a different
// question once the forms were read: is PC-38's CHUNKED deploy lane reachable
// at all?
//
// WHAT THE SOURCE SAYS. DeployContractForm routes on `singleEncode =
// !isWatcherMode`: full mode goes to `openConfirmScreen()`, which composes ONE
// `{ action: 'DEPLOY', params }` and never consults `plan`. The chunked branch
// lives in `handleSubmit`, which is only reached at `stage === 'review'`, which
// is only set when `!singleEncode` - i.e. watcher mode. And the first thing
// that branch does in watcher mode is throw, by design, because a chunked run
// signs N transactions in sequence and a watch-only wallet cannot.
//
// So the lane appears to be unreachable from both sides, while the form's own
// summary promises it: past the inline cap it renders "Too large for one
// transaction: deploys as N chunk transactions plus 1 assembling transaction".
//
// This spec exists to settle that by OBSERVATION rather than by reading, which
// is the campaign's own trust order. It deliberately makes no claim about which
// behaviour is correct - it records what a full-mode wallet does with a source
// the wallet itself has just said needs two transactions, and asserts only the
// part that cannot be defended either way: the wallet must not silently attempt
// a single-shot deploy of a plan it has told the user needs two.
//
// The payload is sized from the SDK's own planner rather than guessed: ~6.1 kB
// of source is the smallest that crosses the inline cap, giving exactly 2
// chunks, which keeps the paste small and the run fast.

import { createHash } from 'node:crypto';

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    selectVenueChain,
    mintXchain,
    nudgeChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const GAS_LIMIT = '50000';
const FUNDING = 1;
// Sized from the venue's own quotes rather than guessed: each DEPLOY v4 carrier
// quotes 0.4 XCHAIN, the assembling DEPLOY 1.0, plus GAS_LIMIT * gasPrice
// (50000 * 0.00001 = 0.5) on the assembler. Under 5 XCHAIN for the whole run;
// 1000 is the amount every other regtest spec mints, kept the same on purpose.
const MINT_XCHAIN = 1000;

/**
 * The counter contract from `deploy-execute.regtest.spec.js`, verbatim, so the
 * chunked lane is compared against a body already proven to deploy and run
 * INLINE. Same code, different transport: that is the whole experiment.
 *
 * One line, `parseInt` over a JSON-text counter, no BigInt and no RegExp
 * literal (the VM rejects both at deploy).
 */
const COUNTER_BODY =
    "module.exports = { inc: function(){ var c = parseInt(xchain.state.get('n') || '0');"
    + " xchain.state.set('n', String(c + 1)); return String(c + 1); } };";

const EXECUTE_GAS = '100000';
/** A chunked DEPLOY assembles a bigger body, so it is metered above the inline lane's 200000. */
const CHUNKED_DEPLOY_GAS = '300000';

const SMALL_SOURCE = 'function main(){ return 1 }';
// Padding chosen from chunkHelper.planDeploy: 6102 is the smallest that stops
// fitting one inline DEPLOY, and it plans as exactly 2 chunks.
const CHUNKED_SOURCE = `//${'x'.repeat(6102)}\nfunction main(){ return 1 }`;

/**
 * A source unique to this run, still planning as exactly 2 chunks.
 *
 * The tag is what makes the chain assertions precise: CODE_HASH is
 * sha256(utf8(source)) and it is the chunk GROUP id, so a per-run source means
 * "the legs carrying this hash" can only be this run's. Without it the venue's
 * earlier chunked attempts - which are on chain, and failed - would be
 * indistinguishable from this one's.
 */
function uniqueChunkedSource(tag) {
    return `//${'x'.repeat(6102)}\nfunction main(){ return 1 } // ${tag}`;
}

const codeHashOf = (source) => createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');

/** Every DEPLOY action on chain carrying `codeHash`, newest-first page. */
async function deployLegsFor(codeHash) {
    const list = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/actions?limit=100`, {
        signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json()).catch(() => null);
    const rows = (list?.data || []).filter((r) => r.action === 'DEPLOY');
    const legs = [];
    for (const row of rows) {
        const detail = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/action/${row.action_index}`, {
            signal: AbortSignal.timeout(15_000),
        }).then((r) => r.json()).catch(() => null);
        if (detail && detail.code_hash === codeHash) legs.push(detail);
    }
    return legs;
}

/**
 * A padded version of `body` that plans as exactly 2 chunks.
 *
 * The padding is a comment, so the module still exports what it exported: the
 * point is to move the SAME code through the chunked transport, not to test a
 * different contract.
 */
function chunkedCounterSource(tag) {
    return `//${'x'.repeat(6102)}\n${COUNTER_BODY} // ${tag}`;
}

/**
 * Mines a block only when a transaction is actually waiting for one.
 *
 * THE THIRD ANSWER, after two wrong ones cost a run each. `nudgeChain` skips its
 * mine while the decoder is more than 3 blocks behind, which starves a leg whose
 * confirmation only this loop can produce (measured: the wallet's 120s per-leg
 * wait expired on a transaction sitting in the mempool that indexed 40s later).
 * Mining unconditionally every 3s does confirm promptly, but on a long run it
 * outruns the decoder - measured 39 and then 47 blocks behind - and that is a
 * feedback loop, because a lagging decoder makes each leg's indexer wait longer,
 * which makes the loop mine more.
 *
 * A block is only ever NEEDED when something is unconfirmed. Asking the venue's
 * own miner how many transactions are waiting turns the loop from a timer into a
 * response: it confirms a leg within ~3s of broadcast and produces nothing at
 * all while the pipeline is catching up.
 */
async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* a blipped status read must not kill the loop */ }
}

/** The deployed-contract row for `codeHash`, or null while it does not exist. */
async function contractFor(codeHash) {
    const list = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/contracts?limit=100`, {
        signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json()).catch(() => null);
    return (list?.data || []).find((c) => c.code_hash === codeHash) || null;
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** Opens the deploy form from the Contracts route. */
async function openDeployForm(page) {
    await gotoPalette(page, 'Contracts');
    const main = page.getByRole('main');
    const deploy = main.getByRole('button', { name: /deploy/i }).first();
    await expect(deploy, 'the Contracts route offers no Deploy control').toBeVisible({ timeout: 30_000 });
    await deploy.click();
    await expect(main.getByLabel('Gas limit'), 'the deploy form did not open')
        .toBeVisible({ timeout: 30_000 });
    // DeployContractForm picks its chain with a NetworkField, and re-opening the
    // form re-defaults it to Bitcoin - so this belongs here, in the opener, not
    // once per test. Without it the form composes on a chain the funding never
    // reached. Same conversion `contracts/deploy-execute` already carries.
    await selectVenueChain(main, 'Network');
    return main;
}

async function setSource(main, source) {
    const code = main.getByRole('textbox', { name: /code source/i })
        .or(main.locator('textarea')).first();
    await expect(code, 'the deploy form has no source field').toBeVisible({ timeout: 30_000 });
    await code.fill(source);
    return code;
}

test.describe('§11.3: the chunked deploy lane', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('a full-mode wallet does not silently single-shot a plan it says needs two transactions', async ({ page }) => {
        let main;

        await test.step('onboard and fund on the venue chain', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Deploy Lane Wallet' });
            await switchToRegtest(page, PASSWORD);

            main = await openDeployForm(page);
            const from = await main.getByLabel('From').inputValue();
            expect(from, 'the deploy form has no Bitcoin address').toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(from, 1);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            main = await openDeployForm(page);
        });

        await test.step('CONTROL: a small source is planned as one transaction', async () => {
            await setSource(main, SMALL_SOURCE);
            await main.getByLabel('Gas limit').fill(GAS_LIMIT);
            await expect(main.getByText(/fits in a single transaction/i),
                'the planner never reported on the small source, so the summary this spec reads is not live')
                .toBeVisible({ timeout: 60_000 });
        });

        await test.step('THE CASE: an oversized source is planned as two, and the form says so', async () => {
            await setSource(main, CHUNKED_SOURCE);
            await main.getByLabel('Gas limit').fill(GAS_LIMIT);
            await expect(main.getByText(/too large for one transaction/i),
                'the planner did not flip to chunked, so the payload no longer crosses the inline cap '
                + '(re-derive it from chunkHelper.planDeploy)')
                .toBeVisible({ timeout: 60_000 });
            const promise = await main.getByText(/too large for one transaction/i).textContent();
            // eslint-disable-next-line no-console
            console.log(`[§11.3 chunked] the form promises:\n  ${(promise || '').trim()}`);
            expect(promise, 'the summary does not name a chunk count').toMatch(/deploys as 2 chunk/i);
        });

        await test.step('submit in FULL mode and record which lane runs', async () => {
            const submit = main.getByRole('button', { name: /^(Deploy|Preview)$/ }).first();
            const label = (await submit.textContent() || '').trim();
            await submit.click();

            // Four observable outcomes now. The REVIEW screen is the one that says
            // the plan was honoured: it is the chunked lane's entry point, and in
            // full mode it renders the signing credentials that lane needs.
            const confirm = page.getByTestId('confirm-modal');
            const review = page.getByRole('button', { name: /^Deploy on / });
            const chunkProgress = page.getByText(/chunk \d+ of \d+|chunking/i);
            const refusal = page.getByRole('alert').filter({ hasText: /\S/ });
            await expect(confirm.or(review).or(chunkProgress).or(refusal).first(),
                'the form did nothing observable at all after submit')
                .toBeVisible({ timeout: 120_000 });

            const sawConfirm = await confirm.isVisible().catch(() => false);
            const sawReview = await review.isVisible().catch(() => false);
            const sawChunks = await chunkProgress.first().isVisible().catch(() => false);
            const alertText = await refusal.first().textContent().catch(() => null);
            // eslint-disable-next-line no-console
            console.log(`[§11.3 chunked] submit "${label}" -> confirm-modal=${sawConfirm} `
                + `review=${sawReview} chunk-progress=${sawChunks} `
                + `alert=${JSON.stringify((alertText || '').trim().slice(0, 200))}`);

            // FIRST RUN, and why this assertion is worded the way it is: the wallet
            // did NOT open a confirm screen - but only because the single-shot
            // compose it attempted was refused by the encoder with "Combined
            // compiled payload (8194 bytes) exceeds maximum (8192)". So an
            // assertion on the modal's absence PASSES while the defect is present,
            // which is exactly the false green this campaign exists to avoid.
            // What has to be true is about the OUTCOME: a source the form has just
            // planned as 2 chunks must not die on the one-transaction size cap.
            expect(sawConfirm,
                'the wallet opened a single-transaction confirm screen for a source it had just told the '
                + 'user needs 2 chunk transactions plus an assembling one')
                .toBe(false);
            expect(alertText || '',
                'the deploy failed on the inline size cap, which means the single-shot lane ran for a '
                + 'plan the form had already described as 2 chunk transactions - PC-38\'s chunked lane '
                + 'was never entered')
                .not.toMatch(/exceeds maximum|payload \(\d+ bytes\)/i);
            // And the chunked lane must actually be the one that ran: either it is
            // already in flight, or the user is on the review screen that starts it.
            expect(sawChunks || sawReview,
                'neither chunk progress nor the review screen that starts a chunked run appeared, so '
                + 'nothing routed this plan into the chunked lane')
                .toBe(true);
        });

        await test.step('the chunked run actually starts from that screen', async () => {
            const password = page.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            const go = page.getByRole('button', { name: /^Deploy on / });
            await expect(go).toBeEnabled({ timeout: 30_000 });

            // Each leg must be CONFIRMED and indexed before the next is built, and
            // this venue mines only on demand, so a run left alone waits forever on
            // a block that nobody is producing. Nudging is part of driving this
            // lane at all, not a workaround for a wallet problem.
            const nudger = setInterval(() => { mineIfPending(); }, 5_000);
            try {
                await go.click();
                // ENTERING the lane is what this asserts. Completing all three legs
                // needs the payer to hold XCHAIN for gas - the first live run landed
                // a real v4 carrier (chunk_index 0 of total_chunks 2) that indexed
                // `invalid: insufficient funds (GAS)` because a fresh wallet holds
                // none - and a full three-leg run on a shared chain is a longer
                // drive. That is recorded as owed rather than smuggled in here.
                //
                // The progress copy is also the D-124 regression guard: it renders
                // during `submitting`, which is THIS screen. It used to live in the
                // form-stage JSX, i.e. on a screen the user has already left, so a
                // multi-minute run showed nothing but a spinning button.
                await expect(page.getByText(/Deploying \d+ chunk transactions/i).first(),
                    'the chunked run started but said nothing on the screen it runs on (D-124), or it '
                    + 'never started at all')
                    .toBeVisible({ timeout: 120_000 });
                const outcome = await page.getByText(/Deploying \d+ chunk transactions/i)
                    .first().textContent().catch(() => null);
                // eslint-disable-next-line no-console
                console.log(`[§11.3 chunked] the run reports: ${JSON.stringify((outcome || '').trim().slice(0, 160))}`);
            } finally {
                clearInterval(nudger);
            }
        });
    });

    // §11.3's owed leg. The test above proves the chunked lane is ENTERED; it
    // deliberately stops there, because the first live run's carrier indexed
    // `invalid: insufficient funds (GAS)` from a fresh wallet - a DEPLOY v4
    // carrier is a priced action like any other, and a wallet holding no XCHAIN
    // cannot pay for one. So "the lane runs" and "the lane WORKS" were still two
    // different claims, and only the first had been driven.
    //
    // This one funds the gas and drives all three legs to a contract that exists
    // on chain. It is the only test in this campaign whose subject is a
    // multi-transaction, multi-signature flow: three signed transactions, each
    // waiting for the previous to confirm AND index before it is built.
    //
    // ASKED OF THE CHAIN, NOT THE SCREEN. The wallet's done screen says
    // "Contract deployed" as soon as the assembling transaction is broadcast,
    // which is true and not the question - the assembler can still index invalid
    // (a missing chunk, a hash mismatch, unpaid gas) and leave the user with
    // three paid-for transactions and no contract. What has to be true is that
    // the indexer reassembled the slices, verified them against CODE_HASH, and
    // created the contract.
    test('the full chunked run deploys a contract the chain actually holds', async ({ page }) => {
        const runTag = `s29-${Date.now()}`;
        const source = uniqueChunkedSource(runTag);
        const codeHash = codeHashOf(source);
        let main;
        let payer;

        // eslint-disable-next-line no-console
        console.log(`[§11.3 full] run ${runTag} code_hash ${codeHash}`);

        await test.step('onboard, fund the coin side, and hold XCHAIN for gas', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Chunked Deploy Wallet' });
            await switchToRegtest(page, PASSWORD);

            main = await openDeployForm(page);
            payer = await main.getByLabel('From').inputValue();
            expect(payer, `the deploy form has no ${REGTEST_COIN} address`).toMatch(REGTEST_ADDRESS_RE);

            // Every leg spends the previous leg's confirmed change from this
            // same address (consensus rule 1: chunks are gathered per-deployer),
            // so one funded address is both necessary and sufficient.
            await fundAddress(payer, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(payer, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('the wallet plans this source as 2 chunks plus an assembler', async () => {
            main = await openDeployForm(page);
            await setSource(main, source);
            await main.getByLabel('Gas limit').fill(GAS_LIMIT);
            const promise = main.getByText(/too large for one transaction/i);
            await expect(promise,
                'the planner did not flip to chunked, so this source no longer crosses the inline cap '
                + '(re-derive the padding from chunkHelper.planDeploy)')
                .toBeVisible({ timeout: 60_000 });
            expect(await promise.textContent(), 'the summary does not name 2 chunks')
                .toMatch(/deploys as 2 chunk/i);
        });

        let doneTxid = null;

        await test.step('run all three legs', async () => {
            await main.getByRole('button', { name: /^(Deploy|Preview)$/ }).first().click();

            // The review screen is identified by its SUBMIT button, not by the
            // password field: SignCredentials renders no password box when the
            // vault is already unlocked for the session, and asserting on it
            // cost this spec its first run - a wallet that is behaving
            // correctly simply had nothing to type into.
            const go = page.getByRole('button', { name: /^Deploy on / });
            await expect(go, 'the review screen that starts a chunked run never appeared')
                .toBeVisible({ timeout: 60_000 });
            const password = page.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await expect(go).toBeEnabled({ timeout: 30_000 });

            // This venue mines only on demand and each leg waits for the
            // previous to be CONFIRMED and INDEXED, so a run left alone waits
            // forever on a block nobody is producing.
            //
            // MINE DIRECTLY, and this is not a style choice: the first version
            // used `nudgeChain`, which skips the mine while the decoder is more
            // than 3 blocks behind. Three ~8 kB carriers ARE enough decoder work
            // to trip that guard, so the guard withheld exactly the blocks the
            // leg needed to confirm, and the wallet's 120s per-leg indexer wait
            // expired on a transaction that was sitting in the mempool. Measured:
            // the leg landed in block 10499 and indexed fine, ~40s after the
            // wallet had already given up. The lag guard is right for a poll loop
            // waiting on state to APPEAR; it is wrong when the thing being waited
            // for is a confirmation only this loop can produce.
            const nudger = setInterval(() => { mineIfPending(); }, 3_000);
            try {
                await go.click();

                // D-124's regression guard, and the only thing the user sees for
                // several minutes: the progress copy renders during `submitting`,
                // which is the review screen. It used to sit in the form-stage
                // JSX, i.e. on a screen the run has already left.
                await expect(page.getByText(/Deploying \d+ chunk transactions/i).first(),
                    'the chunked run said nothing on the screen it runs on (D-124)')
                    .toBeVisible({ timeout: 120_000 });

                // The terminal screen, or the refusal that explains why there is
                // none. Budgeted for three sequential confirm-and-index waits on
                // a shared venue.
                const done = page.getByText(/Contract deployed/i);
                // Counting ANY non-empty alert as a failure is too
                // broad off Bitcoin: where the native fee is MANDATORY the
                // confirm screen carries a correct informational disclosure
                // ("You are paying the network protocol fee in the native
                // coin..."), and this locator read it as the deploy having
                // failed. Excluded by its own wording rather than by test id,
                // because it is the only benign alert on this screen and a
                // genuine error must still trip this.
                const failed = page.getByRole('alert').filter({ hasText: /\S/ })
                    .filter({ hasNotText: /paying the network protocol fee in the native coin/ });
                await expect(done.or(failed).first(),
                    'the chunked run neither finished nor reported a failure')
                    .toBeVisible({ timeout: 900_000 });

                const alertText = await failed.first().textContent().catch(() => null);
                expect(alertText || '',
                    'the chunked run failed; the chunks it did send are paid for and on chain')
                    .toBe('');
                await expect(done, 'the run never reached the deployed screen').toBeVisible();

                doneTxid = (await page.getByText(/^[0-9a-f]{64}$/i).first().textContent()
                    .catch(() => null))?.trim() || null;
                // eslint-disable-next-line no-console
                console.log(`[§11.3 full] assembling txid ${doneTxid}`);
            } finally {
                clearInterval(nudger);
            }
        });

        await test.step('the CHAIN holds two carriers, an assembler, and the contract', async () => {
            // ORDER MATTERS, and it is a property of the EXPLORER rather than a
            // preference: `/api/action/<index>` caches a miss permanently
            // (the LRU has no TTL and is only invalidated by a reorg),
            // so asking for an index before the indexer has written its typed
            // row blanks that action for the life of the explorer process. So
            // wait on the CONTRACT row first - it cannot exist until every leg
            // has been read and reassembled - and only then read the per-leg
            // detail. Polling the details in the wait loop would poison exactly
            // the rows this step then asserts on.
            let contract = null;
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                contract = await contractFor(codeHash);
                if (contract) break;
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 3_000));
            }
            const legs = await deployLegsFor(codeHash);

            // eslint-disable-next-line no-console
            console.log(`[§11.3 full] legs: ${JSON.stringify(legs.map((l) => ({
                i: l.action_index, fmt: l.action_format, chunk: l.chunk_index,
                total: l.total_chunks, status: l.status,
            })))}`);

            const carriers = legs.filter((l) => l.action_format === 4)
                .sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index));
            const assemblers = legs.filter((l) => l.action_format !== 4);

            expect(carriers.map((c) => Number(c.chunk_index)),
                'the two DEPLOY v4 carriers this plan needs are not both on chain')
                .toEqual([0, 1]);
            for (const c of carriers) {
                expect(c.total_chunks, `carrier ${c.chunk_index} does not declare 2 chunks`).toBe(2);
                expect(c.status, `carrier ${c.chunk_index} (action ${c.action_index}) was rejected`)
                    .toBe('valid');
                expect(c.source, 'a carrier was signed by a different address; chunks are gathered '
                    + 'per-deployer, so a mismatch orphans the group').toBe(payer);
            }

            expect(assemblers.length, 'no assembling DEPLOY carries this run\'s CODE_HASH').toBe(1);
            const [assembler] = assemblers;
            expect(assembler.status,
                `the assembling DEPLOY (action ${assembler.action_index}) was rejected, so all three `
                + 'legs were paid for and no contract exists')
                .toBe('valid');
            // Consensus rule 2, checked rather than assumed: every carrier must
            // sit at a LOWER action_index than the assembler or the indexer
            // cannot see it when it reassembles.
            for (const c of carriers) {
                expect(Number(c.action_index),
                    `carrier ${c.chunk_index} indexed at or after the assembler`)
                    .toBeLessThan(Number(assembler.action_index));
            }
            if (doneTxid) {
                expect(assembler.tx_hash,
                    'the txid the wallet reported is not the assembling leg on chain')
                    .toBe(doneTxid);
            }

            expect(contract,
                'the chain records no contract for this CODE_HASH, so the slices were never '
                + 'reassembled into a deploy - the run paid for three transactions and produced nothing')
                .toBeTruthy();
            expect(contract.status, 'the contract row is not valid').toBe('valid');
            // eslint-disable-next-line no-console
            console.log(`[§11.3 full] contract action ${contract.action_index} status ${contract.status}`);
        });
    });

    // The question the chunked lane raises and nothing had asked: a contract that
    // arrives as N base64 slices has to be REASSEMBLED by the indexer before it
    // is anything at all. "A contract row exists with status valid" only proves
    // the sha256 matched; it does not prove the bytes the VM will later compile
    // are the bytes that were typed, and a body that is subtly wrong (a slice
    // boundary re-encoded, an off-by-one join) can still hash-match nothing and
    // simply never be called until someone calls it.
    //
    // So this drives the SAME contract body the inline lane is already proven on
    // (`deploy-execute.regtest.spec.js`), padded to cross the chunk cap, and then
    // CALLS it. Same code, different transport - which makes a failure here a
    // failure of the transport rather than of the contract.
    //
    // The VM state write is the assertion that cannot be faked: a reassembled
    // body that does not compile cannot increment a counter, and a `gas_used` of
    // zero would mean the action indexed without the VM running at all.
    // FIXME: THIS PINS A REAL PRODUCT DEFECT AND IS NOT AN UNFINISHED
    // SPEC. Everything up to the EXECUTE leg passes: the chunked deploy lands
    // and the chain holds the contract. Then the wallet cannot call a method on
    // it, on ANY chain. ExecuteContractForm.jsx:357 puts `GAS_LIMIT` into every
    // EXECUTE's params unconditionally (defaulting to '50000', so it is there
    // even when the user types nothing), and EXECUTE v0's wire format is
    // `VERSION|CONTRACT_ACTION_INDEX|METHOD|...PARAMS` with no gas slot at all
    // (xchain-sdk/src/formats.js:119). The SDK refuses, correctly, and the
    // screen shows `EXECUTE v0 has no slot for GAS_LIMIT; serializing it would
    // silently discard that field` where the confirm modal should be.
    //
    // Gas is not user-specified for EXECUTE in the first place: the indexer
    // uses GAS_CEILING for anything without IS_EMISSION + VM_GAS_LIMIT. DEPLOY
    // does take gas, which is the likely origin of the copied field.
    //
    // Not a chain-conversion residual: the conversion above WORKS, and this
    // reproduces on Bitcoin. Un-fixme this to prove the fix.
    test.fixme('a contract assembled from chunks compiles and runs', async ({ page }) => {
        const runTag = `s29x-${Date.now()}`;
        const source = chunkedCounterSource(runTag);
        const codeHash = codeHashOf(source);
        let main;
        let payer;
        let contractIndex;

        // eslint-disable-next-line no-console
        console.log(`[§11.3 execute] run ${runTag} code_hash ${codeHash}`);

        await test.step('onboard, fund, and hold XCHAIN for three legs plus a call', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Chunked Execute Wallet' });
            await switchToRegtest(page, PASSWORD);

            main = await openDeployForm(page);
            payer = await main.getByLabel('From').inputValue();
            expect(payer, `the deploy form has no ${REGTEST_COIN} address`).toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(payer, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(payer, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('deploy it chunked', async () => {
            main = await openDeployForm(page);
            await setSource(main, source);
            await main.getByLabel('Gas limit').fill(CHUNKED_DEPLOY_GAS);
            await expect(main.getByText(/too large for one transaction/i),
                'the padded counter no longer crosses the inline cap')
                .toBeVisible({ timeout: 60_000 });

            await main.getByRole('button', { name: /^(Deploy|Preview)$/ }).first().click();
            const go = page.getByRole('button', { name: /^Deploy on / });
            await expect(go, 'the review screen never appeared').toBeVisible({ timeout: 60_000 });
            const password = page.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);

            // Direct mining, for the reason recorded on the run above: the lag
            // guard withholds exactly the confirmations this loop must produce.
            const nudger = setInterval(() => { mineIfPending(); }, 3_000);
            try {
                await go.click();
                const done = page.getByText(/Contract deployed/i);
                // Counting ANY non-empty alert as a failure is too
                // broad off Bitcoin: where the native fee is MANDATORY the
                // confirm screen carries a correct informational disclosure
                // ("You are paying the network protocol fee in the native
                // coin..."), and this locator read it as the deploy having
                // failed. Excluded by its own wording rather than by test id,
                // because it is the only benign alert on this screen and a
                // genuine error must still trip this.
                const failed = page.getByRole('alert').filter({ hasText: /\S/ })
                    .filter({ hasNotText: /paying the network protocol fee in the native coin/ });
                await expect(done.or(failed).first()).toBeVisible({ timeout: 900_000 });
                const alertText = await failed.first().textContent().catch(() => null);
                expect(alertText || '', 'the chunked deploy failed').toBe('');
            } finally {
                clearInterval(nudger);
            }

            let contract = null;
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                contract = await contractFor(codeHash);
                if (contract) break;
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 3_000));
            }
            expect(contract, 'the slices were never reassembled into a contract').toBeTruthy();
            expect(contract.status).toBe('valid');
            contractIndex = String(contract.action_index);
            // eslint-disable-next-line no-console
            console.log(`[§11.3 execute] contract ${contractIndex}`);
        });

        await test.step('the reassembled body is byte-identical to what was typed', async () => {
            // The strongest thing the chain can say about reassembly, and the
            // reason it is asserted separately from the call: a truncated or
            // re-encoded join would still deploy and still index, and every
            // later assertion would then be about someone else's code.
            const detail = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/contract/${contractIndex}`, {
                signal: AbortSignal.timeout(15_000),
            }).then((r) => r.json());
            expect(String(detail.code || '').length,
                'the chain stored no code for a contract it called valid').toBeGreaterThan(0);
            expect(String(detail.code), 'the reassembled source differs from the source that was typed')
                .toBe(source);
            // The same claim in the protocol's own terms, which is what the
            // indexer verifies the slices against: CODE_HASH is sha256(utf8(source)).
            // Measured on this venue before it was asserted - the explorer returns
            // the body with its newline intact, and its digest equals the stored
            // code_hash - so a mismatch here is reassembly, not transport.
            expect(codeHashOf(String(detail.code)), 'the stored body does not hash to its own CODE_HASH')
                .toBe(codeHash);
            expect(String(detail.code_hash), 'the chain records a different CODE_HASH than the plan used')
                .toBe(codeHash);
        });

        await test.step('call inc() and read the state the VM wrote', async () => {
            await gotoPalette(page, 'Contracts');
            const row = page.getByRole('button', { name: `Contract ${contractIndex}`, exact: true });
            await expect(row.first(), 'the deployed contract is not in the list')
                .toBeVisible({ timeout: 60_000 });
            await row.first().click();

            const scope = page.getByRole('main');
            await expect(page.getByText(`Contract #${contractIndex}`).first())
                .toBeVisible({ timeout: 30_000 });
            await page.getByRole('button', { name: 'Call method', exact: true }).click();
            // ExecuteContractForm is a SECOND NetworkField, separate from the
            // deploy form's, and it defaults to Bitcoin like every other one -
            // so a contract this run deployed on the venue chain would be
            // executed against Bitcoin, and the compose never opens a confirm
            // modal. Converting the deploy form alone left this failing here.
            await selectVenueChain(scope, 'Network');
            await scope.getByLabel('Method', { exact: true }).fill('inc');
            await scope.getByLabel('Gas limit').fill(EXECUTE_GAS);
            await scope.getByRole('button', { name: 'Execute', exact: true }).click();

            const confirm = page.getByTestId('confirm-modal');
            await expect(confirm).toBeVisible({ timeout: 60_000 });
            const pw = page.getByLabel('Password', { exact: true });
            if (await pw.count() > 0 && await pw.isVisible()) await pw.fill(PASSWORD);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
            await page.getByTestId('confirm-approve').click();

            await expect(scope.getByText('Method call broadcast.')).toBeVisible({ timeout: 120_000 });
            const txid = (await scope.locator('dl dd').first().innerText()).trim();
            expect(txid, 'the done screen names a real txid').toMatch(/^[0-9a-f]{64}$/);

            const nudger = setInterval(() => { mineIfPending(); }, 3_000);
            let action;
            try {
                action = await waitForValidAction(txid);
            } finally {
                clearInterval(nudger);
            }
            expect(action.action).toBe('EXECUTE');
            expect(String(action.contract_index), 'the call targeted the chunked contract')
                .toBe(contractIndex);
            expect(action.method_name).toBe('inc');
            expect(action.error_message, 'the reassembled body threw when the VM ran it').toBeFalsy();
            expect(Number(action.gas_used), 'gas_used 0 means the VM never ran the reassembled body')
                .toBeGreaterThan(0);

            // The state write. A contract whose reassembly was subtly wrong
            // cannot get this far: it would have failed to compile, or it would
            // have written something else.
            let counter = null;
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                const state = await fetch(
                    `${EXPLORER_URL}/${REGTEST_COIN}/api/contract/${contractIndex}/state`,
                    { signal: AbortSignal.timeout(15_000) },
                ).then((r) => r.json()).catch(() => null);
                counter = (state?.data || []).find((r) => r.state_key === 'n');
                if (counter) break;
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 2_000));
            }
            expect(counter, 'the method wrote no state, so the VM did not run the body').toBeTruthy();
            expect(JSON.parse(counter.state_value), 'the counter the reassembled body incremented')
                .toBe('1');
            // eslint-disable-next-line no-console
            console.log(`[§11.3 execute] EXECUTE ${action.action_index} gas_used ${action.gas_used} `
                + `state n=${counter.state_value}`);
        });
    });

    // The money-critical promise on this form, and the one nothing had tested.
    // Every leg is a real transaction with a real fee, so an interrupted run
    // leaves paid-for chunks on chain, and the banner says in words:
    // "Finishing costs only the remaining ones; starting over pays for all of
    // them again."
    //
    // is the reason this is worth driving NOW and could not be driven
    // before: until legs recorded their action_index, `verifyRecordedChunks`
    // could confirm nothing, so a resume re-sent and re-paid for chunk 0 every
    // time. With the index recorded, the skip path becomes reachable for the
    // first time - and an unexercised skip path that handles money is exactly
    // where a wrong assumption is expensive.
    //
    // THE ASSERTION THAT MATTERS IS A COUNT: exactly two v4 carriers may exist
    // for this CODE_HASH when the run finishes. A third - a re-sent chunk 0 -
    // is the user paying twice for a chunk the chain already had, which is
    // precisely what the banner promises will not happen. Consensus rule 3
    // (dedup by position, lowest index wins) means it cannot corrupt anything;
    // it just quietly costs money, which is why only a count catches it.
    test('an interrupted chunked deploy resumes without re-paying for the chunk already sent', async ({ page }) => {
        const runTag = `s29r-${Date.now()}`;
        const source = uniqueChunkedSource(runTag);
        const codeHash = codeHashOf(source);
        let main;
        let payer;

        // eslint-disable-next-line no-console
        console.log(`[§11.3 resume] run ${runTag} code_hash ${codeHash}`);

        await test.step('onboard and fund', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Chunked Resume Wallet' });
            await switchToRegtest(page, PASSWORD);
            main = await openDeployForm(page);
            payer = await main.getByLabel('From').inputValue();
            expect(payer).toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(payer, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(payer, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('start the run, then interrupt it once chunk 0 is on chain', async () => {
            main = await openDeployForm(page);
            await setSource(main, source);
            await main.getByLabel('Gas limit').fill(GAS_LIMIT);
            await expect(main.getByText(/too large for one transaction/i)).toBeVisible({ timeout: 60_000 });

            await main.getByRole('button', { name: /^(Deploy|Preview)$/ }).first().click();
            const go = page.getByRole('button', { name: /^Deploy on / });
            await expect(go).toBeVisible({ timeout: 60_000 });
            const password = page.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);

            const nudger = setInterval(() => { mineIfPending(); }, 3_000);
            try {
                await go.click();
                // Wait for the FIRST carrier to be indexed, then pull the rug. It
                // has to be indexed and not merely broadcast, or the record holds
                // no action_index and this is a test of the old bug rather than of
                // the resume path.
                const deadline = Date.now() + 600_000;
                let carriers = [];
                while (Date.now() < deadline) {
                    carriers = (await deployLegsFor(codeHash)).filter((l) => l.action_format === 4);
                    if (carriers.length >= 1) break;
                    await new Promise((r) => setTimeout(r, 3_000));
                }
                expect(carriers.length, 'no carrier reached the chain, so there is nothing to resume from')
                    .toBeGreaterThanOrEqual(1);
                // eslint-disable-next-line no-console
                console.log(`[§11.3 resume] interrupting with ${carriers.length} carrier(s) on chain: `
                    + JSON.stringify(carriers.map((c) => ({ i: c.action_index, chunk: c.chunk_index }))));
            } finally {
                clearInterval(nudger);
            }

            // The interruption itself: a reload kills the in-page run mid-flight,
            // which is what a closed tab or a crash does to a real user.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        let resumedGas = null;

        await test.step('the form offers to finish it, and says what is already paid for', async () => {
            main = await openDeployForm(page);
            const banner = main.getByText(/Unfinished deploy/i).first();
            await expect(banner, 'the resume banner never appeared, so the paid-for chunk is unreachable')
                .toBeVisible({ timeout: 60_000 });
            const text = (await banner.textContent()) || '';
            // eslint-disable-next-line no-console
            console.log(`[§11.3 resume] banner: ${JSON.stringify(text.trim().slice(0, 200))}`);
            // that second half: the count must include a chunk known only by
            // its txid. Counting action_indexes alone read "0 of 2" over a run
            // whose first chunk was on chain and paid for, which is the one
            // number a user reads to choose between finishing and starting over.
            const sent = /(\d+) of 2 chunk transactions have already been sent/i.exec(text);
            expect(sent, 'the banner does not say how many chunk transactions have been sent')
                .not.toBeNull();
            expect(Number(sent[1]),
                'the banner counted zero sent chunks over a run whose chunk 0 is on chain and paid for')
                .toBeGreaterThanOrEqual(1);

            await main.getByRole('button', { name: 'Resume this deploy', exact: true }).click();

            // The resume must restore the whole plan, not just the source.
            // The flow assembles phase 2 from the record, so a blank field here
            // would mean the review screen describes a different transaction than
            // the one being signed. Measured before the fix: "" against an
            // original 50000, which fell through to the auto-suggested value.
            resumedGas = await main.getByLabel('Gas limit').inputValue();
            // eslint-disable-next-line no-console
            console.log(`[§11.3 resume] gas limit after resume: ${JSON.stringify(resumedGas)} `
                + `(original ${GAS_LIMIT})`);
            expect(resumedGas, 'the resume did not restore the gas limit the deploy was planned with')
                .toBe(GAS_LIMIT);
            await expect(main.getByText(/too large for one transaction/i),
                'the restored source no longer plans as chunked, so Resume did not restore the code')
                .toBeVisible({ timeout: 60_000 });
        });

        await test.step('finishing it sends only what was missing', async () => {
            // Deliberately NOT re-filling the gas limit: the step above asserts
            // the resume restored it, so typing it again here would hide a
            // regression by supplying the value the wallet was supposed to keep.
            expect(resumedGas, 'nothing to submit with').toBe(GAS_LIMIT);

            await main.getByRole('button', { name: /^(Deploy|Preview)$/ }).first().click();
            const go = page.getByRole('button', { name: /^Deploy on / });
            await expect(go).toBeVisible({ timeout: 60_000 });
            const password = page.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);

            const nudger = setInterval(() => { mineIfPending(); }, 3_000);
            try {
                await go.click();
                const done = page.getByText(/Contract deployed/i);
                // Counting ANY non-empty alert as a failure is too
                // broad off Bitcoin: where the native fee is MANDATORY the
                // confirm screen carries a correct informational disclosure
                // ("You are paying the network protocol fee in the native
                // coin..."), and this locator read it as the deploy having
                // failed. Excluded by its own wording rather than by test id,
                // because it is the only benign alert on this screen and a
                // genuine error must still trip this.
                const failed = page.getByRole('alert').filter({ hasText: /\S/ })
                    .filter({ hasNotText: /paying the network protocol fee in the native coin/ });
                await expect(done.or(failed).first()).toBeVisible({ timeout: 900_000 });
                const alertText = await failed.first().textContent().catch(() => null);
                expect(alertText || '', 'the resumed run failed').toBe('');
            } finally {
                clearInterval(nudger);
            }
        });

        await test.step('exactly two carriers exist: the chunk already paid for was not re-sent', async () => {
            let contract = null;
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                contract = await contractFor(codeHash);
                if (contract) break;
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 3_000));
            }
            expect(contract, 'the resumed run produced no contract').toBeTruthy();
            expect(contract.status).toBe('valid');

            const legs = await deployLegsFor(codeHash);
            const carriers = legs.filter((l) => l.action_format === 4);
            // eslint-disable-next-line no-console
            console.log(`[§11.3 resume] final carriers: ${JSON.stringify(carriers.map((c) => ({
                i: c.action_index, chunk: c.chunk_index, status: c.status,
            })))}`);

            // THE assertion. Three carriers for a two-chunk plan means chunk 0 was
            // sent twice and paid for twice, which is the thing the banner
            // promises does not happen.
            expect(carriers.length,
                'more carriers than the plan needs: a chunk that was already on chain was re-sent and '
                + 're-paid for, which is exactly what the resume banner promises will not happen')
                .toBe(2);
            expect(carriers.map((c) => Number(c.chunk_index)).sort(),
                'the two carriers are not chunks 0 and 1').toEqual([0, 1]);
            for (const c of carriers) expect(c.status).toBe('valid');
        });
    });
});
