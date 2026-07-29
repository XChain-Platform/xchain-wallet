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

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    fundAddress,
    minerRpc,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const GAS_LIMIT = '50000';

const SMALL_SOURCE = 'function main(){ return 1 }';
// Padding chosen from chunkHelper.planDeploy: 6102 is the smallest that stops
// fitting one inline DEPLOY, and it plans as exactly 2 chunks.
const CHUNKED_SOURCE = `//${'x'.repeat(6102)}\nfunction main(){ return 1 }`;

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

        await test.step('onboard and fund on Bitcoin', async () => {
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
            const nudger = setInterval(() => { minerRpc('generate_blocks', { count: 1 }).catch(() => {}); }, 5_000);
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
});
