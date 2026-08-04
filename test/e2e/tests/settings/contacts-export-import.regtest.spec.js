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
//   2. The Contacts panel is INLINE on Settings, not a collapsible row like
//      Privacy or Backup, so there is nothing to click to open it. Clicking
//      `/^Contacts/` unscoped hits the primary navigation and leaves Settings
//      entirely; scoping to `main` then matches nothing.
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

import { createWallet, expect, openSettings, test } from '../../fixtures/wallet.js';

const PASSWORD = 'regtestpassword123';

const CONTACT_NAME = 'E2E Round Trip';
// A checksum-valid regtest P2WPKH nobody holds the key to. Fixed, so the
// assertion below is an exact string rather than "an address came back".
const CONTACT_ADDRESS = 'bcrt1qmr46t4ca5wh35k6mczdzrkepqw2d8ne956f48f';

/** Opens the Contacts route through the command palette. */
async function gotoContacts(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill('Contacts');
    await page.getByRole('option', { name: /^Contacts\b/ }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** Opens Settings and scrolls the Contacts panel into reach. */
async function gotoContactsSettings(page) {
    await openSettings(page);
    // NOTHING IS CLICKED, and that cost two runs to learn. Settings is a list
    // of collapsible rows ("Privacy", "Safety", "Backup", …) but Contacts is
    // NOT one of them: its panel is rendered inline and is already on screen.
    // The first attempt clicked `/^Contacts/` and hit the primary navigation's
    // own Contacts destination, leaving Settings entirely; scoping that click
    // to `main` then matched nothing at all, and a Playwright click has NO
    // default action timeout, so it waited out the entire 600s test budget
    // instead of failing. An unmatched click is a hang, not an error.
    await expect(page.getByRole('button', { name: 'Export…' }),
        'the Contacts settings panel has no Export control').toBeVisible({ timeout: 30_000 });
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
                await gotoContacts(page);
                await page.getByRole('button', { name: 'Add contact' }).click();
                // `getByLabel` matches accessible names, and the app bar's
                // "Scan and addresses" button carries one containing "Address".
                // Ask for the TEXTBOX, exactly, or this is a strict-mode
                // violation rather than a fill.
                await page.getByRole('textbox', { name: 'Name', exact: true }).fill(CONTACT_NAME);
                await page.getByRole('textbox', { name: 'Address', exact: true }).fill(CONTACT_ADDRESS);
                await page.getByRole('button', { name: 'Save', exact: true }).click();

                await expect(contactRow(page, CONTACT_NAME),
                    'the contact was never created, so there is nothing to export')
                    .toBeVisible({ timeout: 30_000 });
            });

            let exported;
            await test.step('Export writes a file that actually holds the contact', async () => {
                await gotoContactsSettings(page);
                const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: 60_000 }),
                    page.getByRole('button', { name: 'Export…' }).click(),
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
                await gotoContacts(page);
                await contactRow(page, CONTACT_NAME).click();
                await page.getByRole('button', { name: 'Delete', exact: true }).click();
                // Deleting a contact goes through `useConfirmModal`, whose
                // panel is a `role="dialog"` named by its title. Scoped to the
                // dialog rather than picked off the page by label, because the
                // detail screen behind it carries a "Delete" of its own.
                const dialog = page.getByRole('dialog', { name: 'Delete this contact?' });
                await expect(dialog, 'deleting a contact raised no confirmation')
                    .toBeVisible({ timeout: 30_000 });
                await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

                await expect(contactRow(page, CONTACT_NAME),
                    'the contact could not be deleted, so the restore below would prove nothing')
                    .toHaveCount(0, { timeout: 30_000 });
            });

            await test.step('Import restores it, with the address intact', async () => {
                await gotoContactsSettings(page);
                await page.getByLabel('Import contacts JSON').setInputFiles(exported);

                await expect(page.getByText(/^Imported 1 contact/),
                    'the import never reported a result').toBeVisible({ timeout: 30_000 });

                await gotoContacts(page);
                await contactRow(page, CONTACT_NAME).click();
                await expect(page.getByText(CONTACT_ADDRESS),
                    'the contact came back by NAME but not by ADDRESS - a restored address book that '
                    + 'shows a familiar name against a missing or wrong address is worse than one '
                    + 'that failed outright, because the user pays a stranger from a form that looks '
                    + 'correct')
                    .toBeVisible({ timeout: 30_000 });
            });
        });
});
