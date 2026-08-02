// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Onboarding & wallet lifecycle" -> "Test backup
// (dry-run restore)" (§19.6), undriven since the line was written.
//
// WHY THIS ONE. Every other surface in this campaign can be wrong and cost the
// user a fee, a transaction, or an afternoon. This one can cost them the
// wallet. Its entire purpose is to answer "is this piece of paper really my
// backup?", and the whole point of asking is that the user is about to rely on
// the answer - the flow's own doc lists "test a newly generated seed before
// deleting the old wallet" as a use case. A FALSE PASS here is the only defect
// in the wallet that destroys funds rather than costing them.
//
// So the assertion that matters is not the happy path. It is that a mnemonic
// which is NOT this wallet's is REFUSED - and the happy path exists only to
// prove the refusal is discriminating rather than a screen that says no to
// everything.
//
// THE TWO WAYS A CHECK LIKE THIS GOES VACUOUSLY GREEN, both asserted:
//
//   1. Nothing to compare against. `dryRunRestore` matches derived addresses to
//      persisted ones BY DERIVATION PATH, and a path with no record counts as
//      `missing` ("new"), not as a mismatch - so a wallet with no records at
//      the derived paths would match ANY seed on a pure divergence count. The
//      flow already guards this ("if the wallet has addresses but NONE matched
//      ... flip overallMatch to false"), and test 2 is what proves the guard is
//      wired rather than just written.
//   2. A near-miss that is still a different wallet. Test 3 uses THIS wallet's
//      own words with a BIP39 passphrase added: same phrase, different seed,
//      different addresses. A check comparing words rather than derived
//      addresses would pass it, and the user who set a passphrase and forgot it
//      would be told their backup is fine when it cannot restore anything.
//
// NO CHAIN. Nothing here broadcasts, funds or indexes; the comparison is purely
// local derivation against the vault's records. It runs on the regtest config
// only because that is where the harness lives.
//
// ⚠️ AND THE SPEC MUST NOT LEAK WHAT IT TESTS, the Session 38 rule from the
// secret-reveal lane. A failing `toContain`/`toEqual` prints both sides, so on
// this surface it would print a live recovery phrase into CI output. Every
// assertion below is reduced to a BOOLEAN or a screen string first, and no
// message interpolates a word of any mnemonic. The next person to extend this
// file will reach for the natural matcher; please do not.
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/onboarding/backup-dry-run.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import { switchToRegtest } from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

/**
 * A valid BIP39 phrase that is emphatically NOT the wallet's.
 *
 * The canonical all-`abandon` test vector, so it carries a correct checksum -
 * which matters, because an INVALID phrase is refused by `normalizeMnemonic`
 * long before any address is derived. That refusal is a different code path
 * and would prove nothing about the comparison this test is aimed at.
 */
const FOREIGN_MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** Any non-empty passphrase produces a different seed from the same words. */
const A_PASSPHRASE = 'not-the-one-used-at-creation';

const MATCH_TEXT = /Backup matches this wallet on every active chain/i;
const MISMATCH_TEXT = /Backup does NOT match this wallet/i;

/** Opens Settings -> Backup and reveals the dry-run form. */
async function openDryRunForm(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill('Settings');
    await page.getByRole('option', { name: /^Settings\b/ }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Backup/ }).first().click();

    const open = main.getByRole('button', { name: 'Test…', exact: true });
    await expect(open, 'the Backup section offers no "Test…" action').toBeVisible({ timeout: 30_000 });
    await open.click();
    await expect(page.getByLabel('Candidate mnemonic')).toBeVisible({ timeout: 30_000 });
}

/**
 * Runs one dry-run and returns 'match' | 'mismatch', read off the report.
 *
 * Deliberately returns a verdict rather than the result object: nothing the
 * caller can assert on carries key material, so no failure message can print
 * a phrase.
 */
async function runDryRun(page, { mnemonic, passphrase = '' }) {
    await page.getByLabel('Candidate mnemonic').fill(mnemonic);
    if (passphrase) await page.getByLabel('BIP39 passphrase').fill(passphrase);
    await page.getByRole('button', { name: 'Run test', exact: true }).click();

    const matched = page.getByText(MATCH_TEXT);
    const mismatched = page.getByText(MISMATCH_TEXT);
    await matched.or(mismatched).first().waitFor({ state: 'visible', timeout: 60_000 });
    return (await matched.count()) > 0 ? 'match' : 'mismatch';
}

/** Returns to the dry-run form from a report, ready for the next candidate. */
async function resetToForm(page) {
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const open = page.getByRole('main').getByRole('button', { name: 'Test…', exact: true });
    await expect(open).toBeVisible({ timeout: 30_000 });
    await open.click();
    await expect(page.getByLabel('Candidate mnemonic')).toBeVisible({ timeout: 30_000 });
}

test.describe('backup dry-run restore (§19.6)', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(600_000);

    test('the backup check accepts this wallet\'s own phrase and refuses every near miss', async ({ page }) => {
        /** @type {string[]} */
        let words;

        await test.step('create a wallet and keep its phrase', async () => {
            // createWallet returns the generated recovery phrase. It is held in
            // a local only, never logged, and never interpolated into an
            // assertion message.
            words = await createWallet(page, { password: PASSWORD, name: 'Backup Test Wallet' });
            expect(Array.isArray(words) && words.length >= 12,
                'onboarding did not yield a recovery phrase to test with')
                .toBe(true);
            // Activates all three regtest chains and derives a first address on
            // each, so the comparison has records on more than one chain to
            // walk rather than a single trivially-matching row.
            await switchToRegtest(page, PASSWORD);
        });

        await test.step('CONTROL: the wallet\'s own phrase matches', async () => {
            // This is not the point of the test, but without it the refusals
            // below are equally consistent with a screen that says no to
            // everything - which would be a useless check that looks safe.
            await openDryRunForm(page);
            expect(await runDryRun(page, { mnemonic: words.join(' ') }),
                'the wallet rejected its OWN recovery phrase, so either the check is broken or '
                + 'every refusal below is meaningless')
                .toBe('match');
        });

        await test.step('THE TEETH: a foreign phrase is refused, not reported as new addresses', async () => {
            // The failure mode this guards is specific. Derived addresses are
            // matched to persisted ones by derivation path, and a path with no
            // record counts as `missing`, not as a divergence - so a check that
            // only counted divergences could call a completely unrelated seed a
            // match. `dryRunRestore` flips overallMatch false when the wallet
            // has addresses and NONE matched; this proves that guard is live.
            await resetToForm(page);
            expect(await runDryRun(page, { mnemonic: FOREIGN_MNEMONIC }),
                'a recovery phrase belonging to a DIFFERENT wallet was accepted as this wallet\'s '
                + 'backup. Acting on that answer destroys the wallet: the flow exists so a user can '
                + 'delete the old one once it passes')
                .toBe('mismatch');
        });

        await test.step('AND THE NEAR MISS: the right words with a passphrase are a different wallet', async () => {
            // Same twelve words, different seed, different addresses. A check
            // that compared WORDS rather than derived addresses would pass this,
            // and the user who set a passphrase and cannot remember it would be
            // told the paper in their hand restores this wallet when it does
            // not.
            await resetToForm(page);
            expect(await runDryRun(page, { mnemonic: words.join(' '), passphrase: A_PASSPHRASE }),
                'the wallet\'s own words plus a passphrase it was NOT created with were accepted, '
                + 'so the check is comparing words rather than the addresses they derive')
                .toBe('mismatch');
        });

        await test.step('and the control still holds afterwards', async () => {
            // Re-run the happy path last. If the two refusals left the form in a
            // state where everything now fails, the assertions above measured
            // that rather than the seeds - and the screen would be telling a
            // user with a perfectly good backup that it is worthless.
            await resetToForm(page);
            expect(await runDryRun(page, { mnemonic: words.join(' ') }),
                'the wallet\'s own phrase stopped matching after two refusals, so the report is '
                + 'sticky and its verdicts cannot be trusted in sequence')
                .toBe('match');
        });
    });
});
