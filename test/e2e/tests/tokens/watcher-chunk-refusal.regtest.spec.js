// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §6, D-159: the debt that defect left behind. The fix was unit- and
// source-proven only, and its own write-up said so - "no watcher wallet has
// composed a chunked action on the venue, so the refusal itself is owed a
// browser drive". This is that drive.
//
// WHAT D-159 WAS. `buildActionPsbt` is the whole air-gapped lane: 26 forms
// route their watcher-mode submit through it, and it can only ever produce ONE
// transaction. When the encoder chunks an action (P2SH/P2WSH), the transaction
// it produces is a COMMIT that carries no action at all - the reveal that
// spends its script output is the one the indexer reads, and nothing outside
// `submitWithSigner` can build one. So the hex handed to the signer could not
// be completed by anything, while `WatcherResultPanel` printed `Encoding: P2SH`
// as a neutral detail row beside instructions to sign it and broadcast it. The
// encoder folds the payload's value and every custom output's value into that
// script output, so following those instructions spends real coin into a script
// only the missing reveal can open, and records nothing.
//
// WHY A CONTROLLED PAIR, and why on ONE form. A one-sided run ("the wallet
// refused") cannot tell the guard apart from watcher mode being unable to build
// anything at all, from an unfunded address, from a venue that is down. Both
// builds below are the same action, on the same form, from the same funded
// address, in the same watcher-mode session, in the same minute. The ONLY
// difference is the length of the optional DESCRIPTION - which is what decides
// whether the encoder puts the payload in an OP_RETURN or chunks it. So
// whatever differs in the outcome is attributable to the encoding and to
// nothing else.
//
// ISSUE rather than the DISPENSER that found the defect, deliberately. A Mode B
// dispenser is 90 action bytes and so chunks every time, but it also needs a
// live oracle price inside a 24-hour window (§3.8) and a patched indexer
// (D-156), so a red run would have four candidate causes. ISSUE has a 250-char
// free-text field and no such dependencies: the same lane, reached by the
// cheapest possible door. The guard lives in the shared flow, not in either
// form, which is what makes this substitution honest.
//
// WHAT IS ASSERTED, and each is something the fix could plausibly have got
// wrong:
//   1. The short build still works. The guard did not break the lane it protects.
//   2. The long build produces NO transaction hex. The half-transaction is not
//      offered at all - not offered with a warning beside it, which is the state
//      D-159 found.
//   3. The sentence on screen carries the REMEDY, not a retry. "Compose it from
//      the wallet holding the key", not "Issue failed." - the D-121 shape, where
//      a message written carefully is discarded one layer up by the form's own
//      fallback.
//   4. There is a way out. The refusal ships an Edit control back to the form,
//      so this is not another D-134/D-151 dead end.
//
// Runs on Litecoin (XC_REGTEST_COIN=RLTC) for the reasons §3.5 records: Bitcoin
// regtest is the contended chain.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    fundAddress,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const SUPPLY = '1000';

/**
 * A description long enough that the action cannot fit an 80-byte OP_RETURN,
 * and varied enough that no compression could squeeze it back under.
 *
 * 200 characters, inside the form's own 250 cap, so this stays a payload-size
 * experiment and never becomes a field-validation one.
 */
const LONG_DESCRIPTION =
    'A deliberately long on-chain description, written to push this ISSUE past the eighty-byte '
    + 'OP_RETURN limit so the encoder chunks it into a commit-plus-reveal pair: 7f3a91c fixtures, '
    + 'no repetition.';

/** The control's description: short, so the same action fits one transaction. */
const SHORT_DESCRIPTION = 'Short.';

/** Ticks are claimed once on chain, so each build gets its own. */
const RUN = String(Date.now()).slice(-6);
const TICK_SHORT = `WCS${RUN}`;
const TICK_LONG = `WCL${RUN}`;

async function gotoPalette(page, title) {
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox');
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Puts the wallet into watcher mode and waits for the write to land.
 *
 * The radio is fully controlled by PERSISTED settings, so it does not flip
 * until the vault write resolves.
 */
async function setWalletMode(page, mode) {
    const label = mode === 'watcher' ? /^Watcher/ : /^Full/;
    await gotoPalette(page, 'Settings');
    await page.getByRole('button', { name: /^Wallet Mode/ }).click();
    const radio = page.getByRole('radio', { name: label });
    await expect(radio).toBeVisible({ timeout: 30_000 });
    await radio.click();
    await expect(radio, `the wallet did not switch to ${mode} mode`).toBeChecked({ timeout: 30_000 });
}

/** Fills the issue form and leaves it at the review stage, ready to build. */
async function stageIssue(page, tick, description) {
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    // §3.5: every form carries its own chain picker and the wallet defaults to
    // Bitcoin. Skipping this composes on the contended chain instead of the one
    // the run was pointed at, which is a silently wrong-venue pass.
    await selectVenueChain(main, 'Network');
    await main.getByLabel('Ticker').fill(tick);
    await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);
    await main.getByLabel('Description (optional)').fill(description);
    // Watcher mode is the branch that gets a review stage at all: full mode
    // composes straight onto the confirm screen ( single-encode).
    await main.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(main.getByRole('button', { name: 'Create unsigned transaction', exact: true }),
        'the form did not reach the watcher review stage')
        .toBeVisible({ timeout: 30_000 });
    return main;
}

const hexBox = (page) => page.getByRole('textbox', { name: 'Unsigned transaction hex' });

test.describe('the watcher lane and an action the encoder chunks', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('refuses the half-transaction in words, and still builds the one it can', async ({ page }) => {
        let source;

        await test.step('onboard, fund, and go watch-only', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Watcher Chunk Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main, 'Network');
            source = await main.getByLabel('From').inputValue();
            expect(source, 'this wallet has no address on the venue chain').toMatch(REGTEST_ADDRESS_RE);

            // Funding is not incidental: the encoder selects real UTXOs, and an
            // empty address fails BEFORE the encoding is chosen - which would
            // make the refusal below unattributable.
            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await setWalletMode(page, 'watcher');
        });

        await test.step('CONTROL: a short payload still exports an unsigned transaction', async () => {
            const main = await stageIssue(page, TICK_SHORT, SHORT_DESCRIPTION);
            await main.getByRole('button', { name: 'Create unsigned transaction', exact: true }).click();

            const hex = hexBox(page);
            await expect(hex, 'the watcher lane produced no unsigned transaction for a payload that '
                + 'fits one transaction - the guard has broken the lane it exists to protect')
                .toBeVisible({ timeout: 120_000 });
            const value = await hex.inputValue();
            expect(value, 'the exported transaction is empty').toMatch(/^[0-9a-f]{40,}$/i);

            // The panel names the encoding, and this is the one that is safe to
            // hand a signer: a single transaction that carries the action itself.
            await expect(page.getByText(/OP_RETURN/i).first(),
                'the control did not encode as OP_RETURN, so it is not the single-transaction case '
                + 'this pair needs as its other half')
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('the chunked payload is refused, with the remedy and not a retry', async () => {
            // Back via the panel's own control: re-selecting "Issue token" while
            // the route is already mounted changes no state, so the form would
            // stay on its result screen (D-117's shape).
            await page.getByRole('button', { name: 'Build another', exact: true }).click();
            const main = await stageIssue(page, TICK_LONG, LONG_DESCRIPTION);
            await main.getByRole('button', { name: 'Create unsigned transaction', exact: true }).click();

            const alert = page.getByRole('main').getByRole('alert')
                .filter({ hasText: /too large for one transaction/i }).first();
            await expect(alert, 'the wallet said nothing about an action it can only half-build')
                .toBeVisible({ timeout: 120_000 });

            const said = (await alert.textContent()) || '';
            // The remedy, which is the whole reason this error has a type.
            expect(said, 'the refusal does not tell the user what to do instead')
                .toMatch(/wallet holding the key/i);
            // What ignoring it costs. A user who has just been refused will
            // otherwise reach for the commit hex they can see in their history.
            expect(said, 'the refusal does not say what broadcasting the half would cost')
                .toMatch(/spend coin into a script/i);
            // And NOT the form's own fallback, which is the D-121 failure this
            // fix has a second half for: a transient-sounding sentence invites
            // the retry that spends the coin again.
            expect(said, 'the refusal arrived as the form\'s generic fallback, so the sentence was '
                + 'discarded one layer up (D-121)')
                .not.toMatch(/^Issue failed\.?$/i);

            // THE POINT: no half-transaction is offered at all.
            await expect(hexBox(page),
                'the wallet exported an unsigned transaction for a chunked action - this is the '
                + 'commit with no reveal, and signing it spends coin into a script nothing can open')
                .toHaveCount(0);

            // A way out, rather than a dead end (D-134 / D-151 family).
            await expect(page.getByRole('button', { name: 'Edit', exact: true }),
                'the refusal left the user on a screen with no way back to the form')
                .toBeVisible({ timeout: 30_000 });
        });
    });
});
