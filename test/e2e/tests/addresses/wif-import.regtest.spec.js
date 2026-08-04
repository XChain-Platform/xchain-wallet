// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Addresses" -> the ⬜ "Import address" residual, and
// the automated guard that D-63's own correction note asks for.
//
// WHY THIS LANE AND NOT ANOTHER. It is the single lane in this wallet with FOUR
// HIGH defects behind it - D-54, D-63, D-65 and the fourth site that fixing
// D-65 exposed in `resolveActiveAddresses` - and every one of them is the SAME
// bug: `importWif` writes its Address record with `accountId: null` (§11.3.3's
// carve-out for imported keys), and one selector after another filtered those
// records out again with `a.accountId !== accId`. The allocating side and the
// selecting side disagreed about one convention, in four places, found one at a
// time by driving it live.
//
// AND ONE OF THOSE FIXES WAS WRONG THE FIRST TIME, which is the reason this file
// has to be an end-to-end read rather than a unit test. D-63's first fix
// excluded imported keys whenever a specific accountId was requested, reasoning
// that an address belonging to no account cannot belong to one account.
// AddressList always passes the active accountId, so that carve-out left the
// only consumer that matters exactly as broken as before - AND ITS UNIT TESTS
// PASSED, because they asked the question the way the fix answered it. It was
// caught only by re-running the live import. Imported keys are WALLET-scoped,
// not account-scoped.
//
// The lane was proven by hand in Session 16 (funded, made active, spent, with a
// 212-hex-char scriptSig read back off the chain). What it has never had is a
// guard that runs without a human. This is that guard.
//
// THE VECTOR IS DERIVED, NOT TRUSTED. The expected address is computed here from
// the WIF with `wif` + `tiny-secp256k1` + `bitcoinjs-lib`, independently of
// anything the wallet does, so "the wallet imported an address" cannot pass for
// "the wallet imported THE RIGHT address". A screen that pairs a key with
// somebody else's address looks perfectly correct and nothing else would catch
// it.
//
// HOW IT HANDLES THE SECRET, copied from `secret-reveal.regtest.spec.js`: the
// WIF is a throwaway constant for a key nobody funds on purpose, but every
// assertion about it is still reduced to a BOOLEAN or an ADDRESS before it
// reaches `expect`, because a failing matcher prints both sides.
//
// ⚠️ WHERE IT STOPS, 2026-08-03. Marked `test.fixme` because it is NOT green
// yet, and a red spec sitting in this directory reads as a regression - which is
// the exact confusion this campaign just spent a session clearing up in
// `backup-pointer-restore.regtest.spec.js`. Everything above the walk is done:
// the vector, the four claims and their failure messages are written.
//
// TWO THINGS ALREADY MEASURED, so the next session does not re-pay for them:
//
//   1. `gotoSection(page, 'Addresses')` NEVER RETURNS. The bottom bar surfaces
//      only Home/History/Send/Scan, the fixture falls back to a "More" button,
//      and this layout renders none - so it waits out its whole 600s budget.
//      Use the palette (`gotoPalette` below). That one cost a full run.
//   2. With the palette it reaches the Addresses list fine, and then the walk
//      into the import FORM does not land: the run dies at
//      `getByLabel('WIF private key')`, and the failure snapshot shows the page
//      still on the LIST, with `button "Add or import address"` present and no
//      "Import address" control and no WIF textbox anywhere in the tree. So the
//      "+" menu either never opened or `getByRole('button', { name: 'Import
//      address' })` matched something that is not the menu item -
//      `AddressList.jsx` carries BOTH a `title="Import address"` Screen header
//      (~line 546) and the menu row (~line 719), which is the likely collision.
//      NEXT STEP: dump the "+" menu's accessible tree after clicking it, and
//      address the menu row by its real role (it may be a `menuitem`, not a
//      `button`), then delete the `.fixme`.
//
// RUN IT:
//   cd test/e2e && npx playwright test \
//       --config=playwright.regtest.config.js tests/addresses/wif-import.regtest.spec.js

import bitcoin from 'bitcoinjs-lib';
import wifCodec from 'wif';
import * as ecc from 'tiny-secp256k1';

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import { REGTEST_ADDRESS_RE, switchToRegtest, unlockAfterReload } from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

/**
 * A throwaway regtest key, from a fixed scalar so the vector never moves.
 *
 * Deliberately NOT generated per run: a hardcoded WIF whose address this file
 * recomputes is a real vector, while a randomly generated pair would only ever
 * prove the test agrees with itself.
 */
const IMPORT_WIF = 'cSztgdXf1ns4XGajHiQexSWzvLSKdhhHzBV1zpr5ZfC41jFgN5Vh';
const IMPORT_LABEL = 'E2E imported key';

/**
 * Every address this WIF could legitimately produce, computed independently.
 *
 * The import form offers an address TYPE, and its default is not this spec's
 * business, so the assertion is "the address shown is one this key actually
 * controls" rather than a guess at which type the form picked. Regtest shares
 * Bitcoin testnet's base58 version bytes (campaign §3.5), which is what lets one
 * network object cover the p2pkh case; bech32 differs by prefix.
 */
function addressesControlledBy(wif) {
    const decoded = wifCodec.decode(wif);
    const point = ecc.pointFromScalar(decoded.privateKey, decoded.compressed);
    const pubkey = Buffer.from(point);
    const testnet = bitcoin.networks.testnet;
    const out = [];
    for (const build of [
        () => bitcoin.payments.p2pkh({ pubkey, network: testnet }).address,
        () => bitcoin.payments.p2wpkh({ pubkey, network: { ...testnet, bech32: 'bcrt' } }).address,
        () => bitcoin.payments.p2sh({
            redeem: bitcoin.payments.p2wpkh({ pubkey, network: { ...testnet, bech32: 'bcrt' } }),
            network: testnet,
        }).address,
    ]) {
        try { out.push(build()); } catch { /* not this shape on this network */ }
    }
    return out;
}

/**
 * Opens a destination through the COMMAND PALETTE, not `gotoSection`.
 *
 * Measured 2026-08-03, and it cost a full 600s run: `gotoSection(page,
 * 'Addresses')` never returns here. The bottom bar surfaces only
 * Home/History/Send/Scan, so the fixture falls back to a "More" button, and at
 * this layout there is no More button either - the call then waits out its
 * entire budget for a control that is never coming. The palette reaches every
 * destination at every width, which is why `secret-reveal.regtest.spec.js`
 * carries its own copy of this too.
 */
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

/** Walks to Addresses and opens the Import-address page. */
async function openImportForm(page) {
    await gotoPalette(page, 'Addresses');
    await page.getByRole('button', { name: 'Add or import address' }).click();
    await page.getByRole('button', { name: 'Import address' }).click();
}

/** Fills and submits the import form. Leaves the result on screen. */
async function submitImport(page, { wif, label }) {
    await page.getByLabel('WIF private key').fill(wif);
    if (label) await page.getByLabel('Label (optional)').fill(label);
    await page.getByLabel('Wallet password', { exact: true }).fill(PASSWORD);
    await page.getByRole('checkbox', { name: /not backed up by my recovery phrase/i }).check();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
}

test.describe('Addresses: importing a private key', () => {
    test.setTimeout(600_000);

    // ⚠️ DRAFT, NOT YET GREEN - marked `fixme` on purpose so it cannot be read
    // as a regression. See the "WHERE IT STOPS" note in the file header: the
    // assertions are written and reviewed, but the walk into the import FORM is
    // not solved yet. Remove the `.fixme` the moment it navigates.
    test.fixme('an imported key is derived right, stays visible, can be made active, and cannot be added twice',
        async ({ page }) => {
            const expected = addressesControlledBy(IMPORT_WIF);
            expect(expected.length, 'the vector produced no candidate addresses').toBeGreaterThan(0);

            let imported;

            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            await test.step('it imports the address the key ACTUALLY controls', async () => {
                await openImportForm(page);
                await submitImport(page, { wif: IMPORT_WIF, label: IMPORT_LABEL });

                const notice = page.getByText(/^Imported /);
                await expect(notice, 'the import never reported a result').toBeVisible({ timeout: 60_000 });
                imported = ((await notice.innerText()).match(/Imported (\S+?)\.?$/) || [])[1];

                expect(imported, `the import notice named no address: ${await notice.innerText()}`)
                    .toBeTruthy();
                expect(imported, 'the imported address is not even shaped like a regtest address')
                    .toMatch(REGTEST_ADDRESS_RE);
                // The claim that matters, and the only one a screenshot cannot
                // make: this address is derivable from THIS key. Compared
                // against an independently computed set, so a wallet that
                // imported somebody else's address fails here.
                expect(expected.includes(imported),
                    'the wallet imported an address this private key does NOT control, so the user '
                    + 'has been shown a key paired with the wrong address')
                    .toBe(true);
            });

            await test.step('D-63: it is still there after a full reload, under the Imported filter',
                async () => {
                    // A RELOAD, not a re-render. D-63 was a host-boundary
                    // selector dropping accountId-less records, so the records
                    // were persisted correctly the whole time and only the READ
                    // was broken - which means anything short of a fresh load
                    // can pass over the defect.
                    await page.reload();
                    await unlockAfterReload(page, PASSWORD);
                    await gotoPalette(page, 'Addresses');

                    const filters = page.getByRole('tablist', { name: 'Filter by address type' });
                    await filters.getByRole('button', { name: 'Imported', exact: true }).click();

                    await expect(page.getByRole('button', { name: `View address ${imported}` }),
                        'the imported address is not listed under the Imported filter after a reload, '
                        + 'which is D-63 exactly: the key is persisted but no selector will return it, '
                        + 'so it can never be seen, chosen or spent')
                        .toBeVisible({ timeout: 30_000 });
                });

            await test.step('D-65: pressing Use really makes it the active address', async () => {
                await page.getByRole('button', { name: `View address ${imported}` }).click();

                const use = page.getByRole('button', { name: 'Use', exact: true });
                await expect(use, 'the address detail offers no Use action').toBeVisible({ timeout: 30_000 });
                await expect(use,
                    'Use is already reporting this address as active before it was pressed, so the '
                    + 'assertion below would pass without the button working')
                    .toHaveAttribute('title', 'Make this the active address');

                await use.click();

                // The button's own title is the app's statement about which
                // address is active. D-65 returned "setActiveAddress: address
                // does not belong to this account" here, and fixing that
                // exposed a FOURTH site with the identical filter, so this
                // needs the state to actually flip rather than the click to
                // merely not throw.
                await expect(use,
                    'Use did not make the imported address active - D-65 and its fourth sibling in '
                    + 'resolveActiveAddresses both present exactly this way, and Send spends the '
                    + 'ACTIVE address, so an imported key that cannot be activated cannot be spent')
                    .toHaveAttribute('title', 'This is the active address', { timeout: 30_000 });
            });

            await test.step('D-67: the same key cannot be imported a second time', async () => {
                await openImportForm(page);
                await submitImport(page, { wif: IMPORT_WIF, label: 'duplicate attempt' });

                const alert = page.getByRole('alert').first();
                await expect(alert, 'a duplicate import was not refused at all')
                    .toBeVisible({ timeout: 60_000 });
                await expect(alert,
                    'the refusal does not name the address already held, which is what tells the '
                    + 'user this is their own key rather than a broken import')
                    .toContainText(imported);

                // And no second record. D-67's real damage was a duplicate row
                // that INFLATED the wallet's balance by counting one address
                // twice, so the row count is the assertion, not the message.
                await gotoPalette(page, 'Addresses');
                await page.getByRole('tablist', { name: 'Filter by address type' })
                    .getByRole('button', { name: 'Imported', exact: true }).click();
                await expect(page.getByRole('button', { name: `View address ${imported}` }),
                    'the refused duplicate still created a second record for one address, which is '
                    + 'how D-67 inflated a balance')
                    .toHaveCount(1);
            });
        });
});
