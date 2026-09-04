// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §10.2's two remaining legs: the unhappy paths and the immutability
// sweep. The fee check is already done (`tests/fees/bet-feed-create-fee`).
//
// WHY THE REFUSALS ARE WORTH A LIVE SPEC RATHER THAN A UNIT TEST. A market is
// IMMUTABLE once it is on the chain - the form says so itself: "Everything above
// is permanent once the market is on the chain: there is no edit." So a bad
// market is not an inconvenience, it is a market that can only be cancelled,
// and the refusals are the last point at which a mistake is free. The one that
// matters most on the wire is an outcome label containing a comma, a semicolon
// or a vertical bar: those are the separators the BET format is built from, so a
// label carrying one is not a validation nicety but a corrupt encoding.
//
// EVERY REFUSAL IS CHECKED FOR SILENCE AS WELL AS FOR WORDING. The expensive
// failure mode in this family is not a bad message, it is a refusal that has
// already signed something - so the leg reads the miner's mempool and the
// payer's confirmed satoshis afterwards and requires both to be untouched
// (§11.5's discipline). An unchanged balance alone would also be true while a
// transaction sat unconfirmed, and an empty mempool alone is true one block
// after a broadcast; together they say nothing was ever sent.
//
// THE ABSENCE ASSERTIONS HAVE A POSITIVE CONTROL, deliberately, because an
// assertion on the absence of a thing passes for the wrong reason (§11.3's
// lesson): the same `confirm-modal` locator that must NOT appear for a refused
// market DOES appear in the immutability leg below, from the same page object in
// the same run. So the locator is proven capable of matching before its absence
// is trusted.
//
// ONE CASE FROM THE PLAN CANNOT BE AUTHORED, and that is a property of the UI
// rather than a gap here: "a refund window that ends before the deadline". The
// form expresses the window as a DURATION after the deadline (a preset select,
// or custom days), so there is no way to place its end before the deadline. The
// composer's guard against it still exists host-side; nothing in the wallet can
// reach it.
//
// Runs on any regtest chain. Litecoin is the default choice for betting work
// (§3.5: Bitcoin is the busy chain), and nothing here depends on the fee lane.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    encoderRpc,
    fundAddress,
    minerRpc,
    mintXchain,
    nudgeChain,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const MINT_XCHAIN = 1000;
const RUN_TAG = `REF${Date.now().toString().slice(-6)}`;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/** The chain's own clock: DEADLINE is compared against block time, not wall time. */
async function chainTime() {
    const status = await explorerJson('status');
    const tip = Number(status?.chain_tip?.[REGTEST_COIN]);
    if (!Number.isFinite(tip)) throw new Error(`explorer reports no ${REGTEST_COIN} tip`);
    for (let h = tip; h > tip - 10 && h > 0; h--) {
        const block = await explorerJson(`block/${h}`);
        const ts = Number(block?.timestamp);
        if (Number.isFinite(ts) && ts > 0) return ts;
    }
    throw new Error(`no parsed block with a timestamp within 10 blocks of tip ${tip}`);
}

async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
}

async function mempoolSize() {
    const status = await minerRpc('status', {});
    return Number(status?.mempool_size ?? -1);
}

async function mineIfPending() {
    try {
        // `nudgeChain`, not a bare `generate_blocks`: this venue's mempool is
        // never reliably empty (see `mempoolBefore` below - stuck sub-minimum-fee
        // bodies sit in it indefinitely), so the size check alone would mine on
        // every pass of a five-minute poll and put a hundred blocks in front of a
        // decoder that is already behind. `nudgeChain` skips the mine while the
        // pipeline is catching up, which is the only case where mining hurts.
        if (await mempoolSize() > 0) await nudgeChain();
    } catch { /* transient while a block lands */ }
}

async function waitForFeed(oracle, labelPart, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson(`bet_feeds/${oracle}/source`);
        const feed = (list?.data || []).find((f) => String(f.label).includes(labelPart));
        if (feed) return feed;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`no market labelled *${labelPart}* landed for ${oracle}`);
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

function toLocalDateTimeInput(unixSec) {
    const d = new Date(unixSec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Opens a FRESH create-market form, filled so that it would be accepted, and
 * hands it back for one field to be broken.
 *
 * Fresh every time on purpose: the form is remounted, so each case starts from
 * the same state and a refusal can only be attributable to the field this
 * caller changes. `pickToken: false` leaves the wager tick unchosen, which is
 * itself one of the cases.
 */
async function openValidForm(page, { label, pickToken = true, deadlineOffsetSec = 2 * 86_400 }) {
    await gotoPalette(page, 'Betting');
    await page.getByRole('button', { name: 'Create market', exact: true }).click();
    const main = page.getByRole('main');
    await selectVenueChain(main);

    if (pickToken) {
        const tokenField = main.getByRole('button', { name: /^Token bets are placed in:/ });
        await expect(tokenField).toBeVisible({ timeout: 30_000 });
        await tokenField.click();
        await page.locator('[data-balance-key$=":XCHAIN"]').first().click();
    }

    await main.getByLabel('What is being bet on').fill(label);
    await main.getByLabel('Outcome 0').fill('Yes');
    await main.getByLabel('Outcome 1').fill('No');
    const now = await chainTime();
    await main.getByLabel('Betting closes').fill(toLocalDateTimeInput(now + deadlineOffsetSec));
    const password = main.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    return main;
}

/** Submits and requires the named refusal, with no confirm screen behind it. */
async function expectRefusal(page, main, expected, why) {
    await main.getByRole('button', { name: 'Review market', exact: true }).click();
    await expect(page.getByRole('alert'), why).toContainText(expected, { timeout: 30_000 });
    // A refused market must not have composed anything to approve. The same
    // locator is proven to match in the immutability leg, so its absence here
    // means what it says.
    await expect(page.getByTestId('confirm-modal'),
        `${why}: a confirm screen opened for a market the form had already refused`)
        .toHaveCount(0);
}

test.describe(`refusing a bad market, and the promise that it cannot be edited (${REGTEST_CHAIN_LABEL})`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('every bad market is refused for the stated reason and nothing is signed', async ({ page }) => {
        let oracle;
        let satsBefore;
        /**
         * The venue mempool's size before the refusals, not zero.
         *
         * This leg asked for an EMPTY mempool until 2026-09-02, which is a claim
         * about the whole shared chain rather than about this wallet. The RLTC
         * venue carries permanently stuck transactions - 11kB chunked-deploy
         * bodies paying 0.49 sat/vB, under the node's block-assembly minimum, so
         * no block will ever include them - and the spec failed on "a refused
         * market reached the mempool" with three of them sitting there from
         * another suite days earlier. The honest measurement is the DELTA: a
         * refusal that secretly signed something would raise this count.
         */
        let mempoolBefore;

        await test.step('onboard, fund, and hold the wager token', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Market Refusal Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Betting');
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            const main = page.getByRole('main');
            await selectVenueChain(main);
            oracle = await main.getByLabel('Your oracle address').inputValue();
            expect(oracle, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(oracle, FUNDING);
            // Leave the form before minting: `mintXchain` opens the palette with
            // `getByRole('combobox').first()`, and this form carries its own
            // <select>, which would be the one it typed into.
            await gotoPalette(page, 'Home');
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(oracle, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            satsBefore = await coinBalanceSats(oracle);
            mempoolBefore = await mempoolSize();
        });

        await test.step('no title', async () => {
            const main = await openValidForm(page, { label: `${RUN_TAG} notitle` });
            await main.getByLabel('What is being bet on').fill('');
            await expectRefusal(page, main, 'Give the market a question or title.',
                'an untitled market was not refused');
        });

        await test.step('no wager token, which is not the same as the chain coin', async () => {
            // Betting is token-only, and this is the message that has to say so:
            // a user who reads the coin as bettable has misunderstood the whole
            // product, not mistyped a field.
            const main = await openValidForm(page, { label: `${RUN_TAG} notoken`, pickToken: false });
            await expectRefusal(page, main, 'Choose the token bets are placed in.',
                'a market with no wager token was not refused');
            await expect(page.getByRole('alert'),
                'the refusal does not explain that the chain coin cannot be wagered')
                .toContainText('the chain coin cannot be wagered');
        });

        await test.step('a single outcome, which nobody could lose', async () => {
            const main = await openValidForm(page, { label: `${RUN_TAG} oneway` });
            await main.getByLabel('Outcome 1').fill('');
            await expectRefusal(page, main, 'A market needs at least two outcomes.',
                'a one-outcome market was not refused');
        });

        await test.step('two outcomes with the same label', async () => {
            const main = await openValidForm(page, { label: `${RUN_TAG} dupes` });
            await main.getByLabel('Outcome 1').fill('Yes');
            await expectRefusal(page, main, 'Two outcomes have the same label.',
                'a market with duplicate outcomes was not refused');
        });

        await test.step('an outcome carrying a wire separator', async () => {
            // The one refusal here that is about the FORMAT rather than about
            // sense: comma, semicolon and vertical bar are the separators BET is
            // built from, so a label containing one is a corrupt encoding, and a
            // market is immutable once it is on the chain.
            const main = await openValidForm(page, { label: `${RUN_TAG} pipe` });
            await main.getByLabel('Outcome 1').fill('No|Maybe');
            await expectRefusal(page, main,
                'Outcome labels cannot contain a comma, a semicolon or a vertical bar.',
                'an outcome label containing a vertical bar was not refused');
        });

        await test.step('a deadline in the past', async () => {
            // Measured against the CHAIN's clock, not the browser's: this venue's
            // clock can sit hours from wall time (§3.2), and a spec that used
            // `Date.now()` would be testing its own arithmetic.
            const main = await openValidForm(page, {
                label: `${RUN_TAG} past`, deadlineOffsetSec: -3 * 86_400,
            });
            await expectRefusal(page, main, 'Betting must close in the future.',
                'a market that had already closed was not refused');
        });

        await test.step('none of that signed or sent anything', async () => {
            // The measurement, not the impression. Six refusals, one payer, and
            // the chain must show no trace of any of them.
            expect(await mempoolSize(),
                'the venue mempool GREW across six refusals, so the wallet signed and sent '
                + 'something it had refused')
                .toBeLessThanOrEqual(mempoolBefore);
            expect(await coinBalanceSats(oracle),
                'the payer coin balance moved across six refusals, so one of them paid a miner fee')
                .toBe(satsBefore);
        });

        await test.step('a created market offers no way to edit it', async () => {
            // The positive control for every absence assertion above: the same
            // confirm-modal locator, on the same page, DOES appear here.
            const label = `${RUN_TAG} live`;
            const main = await openValidForm(page, { label });
            await main.getByRole('button', { name: 'Review market', exact: true }).click();
            await expect(page.getByTestId('confirm-modal'),
                'a valid market did not reach the confirm screen, which would make every absence '
                + 'assertion in this spec meaningless')
                .toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            await page.getByTestId('confirm-approve').click();

            const feed = await waitForFeed(oracle, label);
            expect(feed.source, 'the market is owned by the funded oracle address').toBe(oracle);

            // The oracle's own console is where an edit affordance would live if
            // one existed: it is the surface that offers the two things that DO
            // exist for a market you created. Reached from the hub's "My
            // markets", not from the palette - there is no command for it.
            await gotoPalette(page, 'Betting');
            await page.getByRole('button', { name: 'My markets', exact: true }).click();
            const console_ = page.getByRole('main');
            await expect(console_.getByText(label, { exact: false }).first(),
                'the market this run created is not listed in the oracle console')
                .toBeVisible({ timeout: 60_000 });

            // Non-vacuous first: the affordances that SHOULD be here are here,
            // which proves we are looking at the right screen before asserting
            // that something else is absent.
            await expect(console_.getByRole('button', { name: 'Copy to a new market' }).first(),
                'the console offers no "Copy to a new market", so this is not the surface this '
                + 'assertion thinks it is')
                .toBeVisible({ timeout: 30_000 });

            // And then the promise the form makes in words: there is no edit.
            for (const scope of [console_]) {
                await expect(scope.getByRole('button', { name: /\b(edit|modify|change the terms|update)\b/i }),
                    'a created market offers an edit control, but BET has no edit format on the wire: '
                    + 'anything that looked like one could only ever silently do something else')
                    .toHaveCount(0);
                await expect(scope.getByRole('link', { name: /\bedit\b/i })).toHaveCount(0);
            }
        });
    });
});
