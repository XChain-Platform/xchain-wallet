// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Settings sub-pages" -> the Contacts Import/Export
// pair, one of the four surfaces the 2026-08-03 re-scope found undriven.
//
// WHY A ROUND TRIP AND NOT TWO TESTS. Export and import are only meaningful
// together: an export nobody can import is a file, not a backup, and an import
// that accepts anything is not reading the export's format. So this drives the
// user's actual recovery story - export, lose the address book, import the file
// back - and asserts the contact SURVIVES it with its address intact. Half of
// that is unfalsifiable on its own: a spec that exports and re-imports without
// clearing in between passes against a wallet whose import is a no-op.
//
// THE ADDRESS IS THE ASSERTION, not the name. A contacts file that restores
// names while dropping or corrupting addresses is the dangerous failure: the
// user sees a familiar name in a Send form and pays a stranger. The name only
// gets the row on screen; the address is read back out of the contact's own
// detail.
//
// FILE HANDLING. Export writes through an `<a download>` + object URL, which
// Playwright surfaces as a download event; import reads a hidden
// `<input type="file">`, which `setInputFiles` drives directly (hidden inputs
// are the normal case for a styled upload control, and this is how a user's
// file picker reaches it). The bytes go through a real temp file rather than
// being handed to the page as a string, so the JSON the wallet WROTE is the
// JSON it READS.
//
// MEASURED GREEN 2026-08-03, 36.8s on the Litecoin venue, both claims
// falsified: an export that keeps names but drops `entries` reds the export
// check, and an import that reports "Imported 1 contact." while saving nothing
// reds the restore - which is the failure this spec exists for, since it is the
// one that looks like success on screen.
//
// FOUR THINGS IT COST, all properties of the screen or the host rather than of
// the wallet, and all of them cheap to inherit:
//
//   1. Contact rows are `role="listitem"`, which is NOT a name-from-content
//      role, so they carry no accessible name at all. `getByRole('listitem',
//      { name })` matches nothing however plainly the name is rendered; match
//      by TEXT (`contactRow` below).
//   2. Export and Import are rows on Settings, Backup and Recovery (since the
//      grouped Settings list of 2026-11-13): Export contacts opens its own
//      page, Import contacts opens the file picker. Clicking `/^Contacts/`
//      unscoped hits the primary navigation and leaves Settings entirely, so
//      every Settings click here is scoped to `main`.
//   3. **AN UNMATCHED CLICK IS A HANG, NOT AN ERROR.** Playwright has no
//      default action timeout, so the miss in (2) waited out the whole 600s
//      test budget instead of failing. When diagnosing, pass `--timeout` so a
//      hang names its step.
//   4. Two host facts that read exactly like a hung spec: **macOS has no
//      `timeout`** (that is coreutils' `gtimeout`), so wrapping a run in it
//      exits 127 with no output at all; and **killing a Playwright run leaves
//      its `vite preview` webServer holding :4183**, so the next run dies with
//      "already used" rather than starting. `lsof -ti :4183 | xargs kill -9`
//      after any kill.
//
// RUN IT:
//   cd test/e2e && npx playwright test \
//       --config=playwright.regtest.config.js \
//       tests/settings/contacts-export-import.regtest.spec.js

import { readFile } from 'node:fs/promises';

import {
    backToSettingsList, createWallet, expect, openPaletteCommand, openSettings, test,
} from '../../fixtures/wallet.js';
import { REGTEST_DESTINATION } from '../../fixtures/regtest.js';
import { fieldByLabel } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';

const CONTACT_NAME = 'E2E Round Trip';
// A checksum-valid regtest address nobody holds the key to. Fixed, so the
// assertion below is an exact string rather than "an address came back".
//
// From the fixture rather than a literal: this was the Bitcoin `bcrt1…` string
// until 2026-08-27, which made a spec about ADDRESS BOOK PORTABILITY refuse its
// own contact on any chain but one. `REGTEST_DESTINATION` is the same key
// re-encoded for whichever chain `XC_REGTEST_COIN` names.
const CONTACT_ADDRESS = REGTEST_DESTINATION;

/**
 * Opens Settings, Backup and Recovery: the group page that holds the Export
 * contacts and Import contacts rows (the grouped Settings list since
 * 2026-11-13; Contacts is no longer a panel of its own).
 *
 * Every click is scoped to `main` and its target asserted visible first: the
 * primary navigation has a Contacts destination of its own, and a Playwright
 * click has NO default action timeout, so a miss waits out the whole test
 * budget instead of failing. An unmatched click is a hang, not an error.
 */
async function openBackupAndRecovery(page) {
    await openSettings(page);
    await backToSettingsList(page);
    const group = page.getByRole('main').getByRole('button', { name: /^Backup and Recovery\b/ }).first();
    await expect(group, 'Settings has no Backup and Recovery row').toBeVisible({ timeout: 30_000 });
    await group.click();
    await expect(page.getByRole('main').getByRole('button', { name: /^Export contacts\b/ }),
        'Backup and Recovery has no Export contacts row').toBeVisible({ timeout: 30_000 });
}

/** Opens the Export contacts page; it lands on JSON, the format this spec reads back. */
async function openExportContacts(page) {
    await openBackupAndRecovery(page);
    await page.getByRole('main').getByRole('button', { name: /^Export contacts\b/ }).click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Export', exact: true }),
        'the Export contacts page has no Export button').toBeVisible({ timeout: 30_000 });
}

/**
 * The contact's row in the Contacts list.
 *
 * Addressed by TEXT, not by accessible name, and that is a property of the
 * screen rather than a preference: the rows are `role="listitem"`, and
 * `listitem` is not a name-from-content role, so the row has NO accessible name
 * at all - `getByRole('listitem', { name })` matches nothing here however
 * plainly the name is rendered inside it. Scoped to the Contacts list because
 * the primary navigation is made of listitems too.
 */
function contactRow(page, name) {
    return page.getByRole('list', { name: 'Contacts' })
        .getByRole('listitem').filter({ hasText: name });
}

test.describe('Settings: contacts export / import', () => {
    test.setTimeout(600_000);

    test('an exported address book restores the contact, and its ADDRESS, on a wallet that lost it',
        async ({ page }, testInfo) => {
            await createWallet(page, { password: PASSWORD });

            await test.step('a contact exists to export', async () => {
                await openPaletteCommand(page, 'Contacts');
                // An empty list offers "Create first contact"; a list with entries offers "Add contact".
                await page.getByRole('button', { name: /^(Add contact|Create first contact)$/ }).click();
                // `getByLabel` matches accessible names, and the app bar's
                // "Scan and addresses" button carries one containing "Address".
                // Ask for the TEXTBOX, exactly, or this is a strict-mode
                // violation rather than a fill.
                await page.getByRole('textbox', { name: 'Name', exact: true }).fill(CONTACT_NAME);
                await page.getByRole('textbox', { name: 'Address', exact: true }).fill(CONTACT_ADDRESS);
                await page.getByRole('button', { name: 'Create contact', exact: true }).click();

                await expect(contactRow(page, CONTACT_NAME),
                    'the contact was never created, so there is nothing to export')
                    .toBeVisible({ timeout: 30_000 });
            });

            let exported;
            await test.step('Export writes a file that actually holds the contact', async () => {
                await openExportContacts(page);
                const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: 60_000 }),
                    page.getByRole('main').getByRole('button', { name: 'Export', exact: true }).click(),
                ]);
                exported = testInfo.outputPath('contacts.json');
                await download.saveAs(exported);

                // Read as JSON, not as text: "the file contains the string" is
                // satisfied by an error message that happens to quote it.
                const parsed = JSON.parse(await readFile(exported, 'utf8'));
                expect(Array.isArray(parsed), 'the export is not a JSON array of contact records')
                    .toBe(true);
                const mine = parsed.find((c) => c?.name === CONTACT_NAME);
                expect(Boolean(mine), 'the exported file does not contain the contact that exists')
                    .toBe(true);
                expect((mine.entries || []).some((e) => e?.address === CONTACT_ADDRESS),
                    'the export carries the contact NAME but not its address, which is the half that '
                    + 'makes the file worth having')
                    .toBe(true);
            });

            await test.step('the address book is lost', async () => {
                // Without this the round trip proves nothing: re-importing over
                // a contact that never left passes against an import that does
                // nothing at all.
                await openPaletteCommand(page, 'Contacts');
                await contactRow(page, CONTACT_NAME).click();
                await page.getByRole('list', { name: 'Contact actions' })
                    .getByRole('button', { name: /^Delete\b/ }).click();
                // Deleting a contact goes through `useConfirmModal`, whose
                // panel is a `role="dialog"` named by its title. Scoped to the
                // dialog rather than picked off the page by label, because the
                // detail screen behind it carries a "Delete" of its own.
                const dialog = page.getByRole('dialog', {
                    name: `Delete ${CONTACT_NAME} from contacts?`,
                });
                await expect(dialog, 'deleting a contact raised no confirmation')
                    .toBeVisible({ timeout: 30_000 });
                await dialog.getByRole('button', { name: 'Delete contact', exact: true }).click();

                await expect(contactRow(page, CONTACT_NAME),
                    'the contact could not be deleted, so the restore below would prove nothing')
                    .toHaveCount(0, { timeout: 30_000 });
            });

            await test.step('Import restores it, with the address intact', async () => {
                // The Import contacts row opens a hidden file input; a file
                // picker reaches that input, so the spec hands the file to it.
                await openBackupAndRecovery(page);
                await fieldByLabel(page, 'Contacts file to import').setInputFiles(exported);
                // Every import asks first, because records with a matching id
                // are overwritten.
                const ask = page.getByRole('dialog', { name: 'Import contacts?' });
                await expect(ask, 'the import never asked before overwriting contacts')
                    .toBeVisible({ timeout: 30_000 });
                await ask.getByRole('button', { name: 'Import contacts', exact: true }).click();

                await expect(page.getByText(/^Imported 1 contact/),
                    'the import never reported a result').toBeVisible({ timeout: 30_000 });

                await openPaletteCommand(page, 'Contacts');
                await contactRow(page, CONTACT_NAME).click();
                // The contact page opens on its Actions tab; the addresses are
                // cards on the Addresses tab, each drawing the address with the
                // full value as that element's accessible name.
                const main = page.getByRole('main');
                await main.getByRole('tablist', { name: 'Contact sections' })
                    .getByRole('tab', { name: 'Addresses', exact: true }).click();
                await expect(main.getByRole('list', { name: 'Addresses', exact: true })
                    .locator(`[aria-label="${CONTACT_ADDRESS}"]`),
                    'the contact came back by NAME but not by ADDRESS - a restored address book that '
                    + 'shows a familiar name against a missing or wrong address is worse than one '
                    + 'that failed outright, because the user pays a stranger from a form that looks '
                    + 'correct')
                    .toBeVisible({ timeout: 30_000 });
            });
        });
});
