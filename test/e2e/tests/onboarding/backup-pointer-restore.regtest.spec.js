// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Onboarding & wallet lifecycle" -> "backup-pointer
// restore" (§15.4), undriven since the line was written.
//
// THE USER STORY, from `uri/backupPointer.js`: a user publishes their encrypted
// backup somewhere (an https mirror, a self-hosted blob), keeps a small QR that
// says only WHERE it lives, and later restores from it by showing that QR to a
// wallet and typing the backup password. The pointer never carries the
// password, so a leaked pointer alone opens nothing.
//
// THIS DRIVES THE WHOLE ROUND TRIP ACROSS TWO DEVICES: device one exports a
// real encrypted backup through the UI; device two - a separate browser with a
// separate vault - scans a pointer QR off a real camera, fetches the envelope,
// decrypts it and ends up holding device one's wallet.
//
// WHAT IS FAKED, AND WHAT IS NOT. The envelope is real (exported by the app,
// encrypted with a password the spec then has to type back in). The camera is
// real (a rendered QR replayed as a capture device; the wallet's own
// `BarcodeDetector` reads it). Only the REMOTE HOST is stood in for, by routing
// the one https URL the pointer names - which leaves the wallet's own resolver
// doing all of its own work: building the URL, enforcing https, calling fetch,
// checking the status, reading the body. The spec asserts the request the
// wallet actually made rather than trusting that it made one.
//
// ⚠️ NOT COVERED HERE, AND IT IS THE PRIMARY STORY: restoring a backup on a
// FRESH install. The Welcome screen offers the lane and it cannot work - the
// route is host-only and there is no host before a wallet exists, so it fails
// with "wallet is locked". Filed as  / D-173 and driven by the last step
// of this spec, which pins the broken behaviour so the fix has a test waiting.
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/onboarding/backup-pointer-restore.regtest.spec.js

import { readFile } from 'node:fs/promises';
import {
    createWallet, expect, test, dismissIntroCarousel, unlockedShell,
    LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY,
} from '../../fixtures/wallet.js';
import { launchWithQrCamera } from '../../fixtures/qrCamera.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';

const DEVICE_PASSWORD = 'regtestpassword123';
/** Deliberately NOT the device password: the two are independent by design. */
const BACKUP_PASSWORD = 'backup-envelope-password-9182';

const ORIGIN_WALLET = 'Origin Wallet';
const SECOND_DEVICE_WALLET = 'Second Device Wallet';

/** Where the pointer says the envelope lives. Nothing resolves this name. */
const ENVELOPE_URL = 'https://backup.example.test/vault/origin.json';
const POINTER_NAME = 'Origin backup';
const POINTER_QR = `xchain-backup:1?loc=${encodeURIComponent(ENVELOPE_URL)}&name=${encodeURIComponent(POINTER_NAME)}`;

const BASE_URL = `http://localhost:${Number(process.env.XC_PREVIEW_PORT) || 4183}`;

/** Opens Settings via the command palette, then the Backup sub-page. */
async function openBackupSection(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill('Settings');
    await page.getByRole('option', { name: /^Settings\b/ }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await page.getByRole('main').getByRole('button', { name: /^Backup/ }).first().click();
}

test.describe('backup-pointer restore (§15.4)', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('a pointer QR restores the wallet it points at, onto another device', async ({ page }) => {
        /** @type {string} */
        let envelope;
        /** @type {string[]} */
        let originWords;

        await test.step('DEVICE ONE: create a wallet and export its encrypted backup', async () => {
            originWords = await createWallet(page, { password: DEVICE_PASSWORD, name: ORIGIN_WALLET });
            await openBackupSection(page);

            const exportRow = page.getByRole('main').getByRole('button', { name: 'Export…', exact: true });
            await expect(exportRow, 'the Backup section offers no export action')
                .toBeVisible({ timeout: 30_000 });
            await exportRow.click();

            await page.getByLabel('Backup password', { exact: true }).fill(BACKUP_PASSWORD);
            await page.getByLabel('Confirm backup password').fill(BACKUP_PASSWORD);
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 120_000 }),
                page.getByRole('button', { name: 'Export', exact: true }).click(),
            ]);
            envelope = await readFile(await download.path(), 'utf8');

            // Controls on the FIXTURE, not on the wallet: everything below is
            // meaningless if what was captured is not a real encrypted envelope
            // of the right wallet.
            const parsed = JSON.parse(envelope);
            expect(parsed?.magic, "the exported file is not a §19.4 backup envelope")
                .toBe("XCHAIN-WALLET-BACKUP");
            expect(parsed?.encryption?.algorithm, "the envelope is not AES-256-GCM encrypted")
                .toBe("aes-256-gcm");
            expect(typeof parsed?.payload === "string" && parsed.payload.length > 100,
                "the envelope carries no ciphertext").toBe(true);
            // The wallet NAME rides in the clear by design (§19.4 documents it
            // in the envelope layout, so a restore screen can say which wallet
            // a file holds before asking for the password). Asserted here as
            // the fixture check that this is device one's file - and worth
            // knowing, because a pointer publishes this envelope somewhere.
            expect(parsed?.walletName, "the captured envelope is not device one's")
                .toBe(ORIGIN_WALLET);
            // THE CLAIM THAT MATTERS: nothing outside the ciphertext leaks the
            // seed. Scanned with the ciphertext blanked, so an accidental
            // base64 collision cannot be read as a leak - and compared as a
            // COUNT so no failure message can print a word.
            const outsideCiphertext = JSON.stringify({ ...parsed, payload: "<ciphertext>" }).toLowerCase();
            const leaked = originWords
                .filter((word) => new RegExp(`\\b${word}\\b`).test(outsideCiphertext)).length;
            expect(leaked,
                "the backup envelope leaks word(s) of the recovery phrase outside its encrypted "
                + "payload, and §15.4 exists so this file can be published somewhere")
                .toBe(0);
        });

        const browser = await launchWithQrCamera(POINTER_QR);
        try {
            const context = await browser.newContext({
                permissions: ['camera'],
                ignoreHTTPSErrors: true,
            });
            await context.addInitScript(
                ([atKey, versionKey, version]) => {
                    try {
                        window.localStorage.setItem(atKey, new Date().toISOString());
                        window.localStorage.setItem(versionKey, version);
                    } catch { /* gate renders and the spec fails loudly */ }
                },
                [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
            );

            /** Every request the wallet made for the envelope. */
            const fetched = [];
            await context.route(ENVELOPE_URL, async (route) => {
                fetched.push(route.request().url());
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: envelope,
                });
            });

            const two = await context.newPage();

            await test.step('DEVICE TWO: a different wallet on a different vault', async () => {
                await two.goto(BASE_URL);
                await createWallet(two, {
                    password: DEVICE_PASSWORD, name: SECOND_DEVICE_WALLET, navigate: false,
                });
            });

            await test.step('scan the pointer and restore', async () => {
                await two.keyboard.press('ControlOrMeta+k');
                const dialog = two.getByRole('dialog', { name: 'Command palette' });
                await expect(dialog).toBeVisible({ timeout: 15_000 });
                await dialog.getByRole('combobox').first().fill('Switch wallet');
                await two.getByRole('option', { name: /^Switch wallet/ }).first().click();
                await expect(dialog).toBeHidden({ timeout: 15_000 });

                await two.getByRole('button', { name: 'Add Wallet' }).click();
                await two.getByRole('button', { name: 'Import wallet' }).click();
                await two.getByRole('tab', { name: 'Encrypted backup' }).click();

                const scanBtn = two.getByRole('button', { name: 'Scan pointer QR', exact: true });
                await scanBtn.click();
                const cancel = two.getByRole('button', { name: 'Cancel scan', exact: true });
                await expect(cancel, 'the pointer scanner never opened').toBeVisible({ timeout: 30_000 });
                await expect(cancel, 'the pointer scanner never read the QR in front of it')
                    .toBeHidden({ timeout: 60_000 });

                const card = two.getByRole('status').filter({ hasText: /Backup pointer loaded/ });
                await expect(card, 'the scanned pointer was not accepted').toBeVisible({ timeout: 30_000 });
                await expect(card,
                    'the pointer card does not show where the backup would be fetched from, which is '
                    + 'the user\'s only chance to notice a pointer aimed somewhere they did not choose')
                    .toContainText(ENVELOPE_URL);

                await two.getByLabel('Backup password').fill(BACKUP_PASSWORD);
                await two.getByRole('button', { name: 'Restore', exact: true }).click();
                await expect(unlockedShell(two), 'the restore never returned to an unlocked wallet')
                    .toBeVisible({ timeout: 180_000 });
            });

            await test.step('the wallet that was pointed at is now on this device', async () => {
                expect(fetched.length,
                    'the wallet never fetched the pointer\'s location, so whatever it restored did '
                    + 'not come from where the QR said it would')
                    .toBeGreaterThan(0);
                expect(fetched.every((u) => u.startsWith('https://')),
                    'the pointer was fetched over something other than https').toBe(true);

                await two.keyboard.press('ControlOrMeta+k');
                const dialog = two.getByRole('dialog', { name: 'Command palette' });
                await expect(dialog).toBeVisible({ timeout: 15_000 });
                await dialog.getByRole('combobox').first().fill('Switch wallet');
                await two.getByRole('option', { name: /^Switch wallet/ }).first().click();
                await expect(dialog).toBeHidden({ timeout: 15_000 });

                const main = two.getByRole('main');
                await expect(main.getByText(ORIGIN_WALLET, { exact: false }).first(),
                    'device two does not hold the wallet the pointer named, so the restore reported '
                    + 'success over nothing')
                    .toBeVisible({ timeout: 30_000 });
                await expect(main.getByText(SECOND_DEVICE_WALLET, { exact: false }).first(),
                    'the restore replaced the wallet that was already on this device instead of '
                    + 'landing alongside it')
                    .toBeVisible({ timeout: 30_000 });
            });
        } finally {
            await browser.close();
        }
    });

    test(': restoring a backup on a FRESH install cannot work', async ({ page }) => {
        // Pinned rather than fixed: the Welcome screen offers "Import wallet ->
        // Encrypted backup" on a device with no wallet, which is the primary
        // reason to keep a backup at all, and the route behind it is registered
        // on the host - which does not exist until a wallet does. The user sees
        // "wallet is locked", which is both untrue and unactionable while they
        // are holding a valid backup file and its password.
        //
        // This test asserts the CURRENT behaviour on purpose, so the day the
        // lane is implemented it goes red and asks to be rewritten into the
        // real assertion.
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Import wallet' }).click();
        await page.getByRole('tab', { name: 'Encrypted backup' }).click();
        await page.getByPlaceholder('{"version":1').fill('{"version":1,"kdf":{"name":"argon2id"},"ct":"zz"}');
        await page.getByLabel('Backup password').fill('any-password-at-all');
        await page.getByRole('button', { name: 'Restore', exact: true }).click();

        await expect(page.getByRole('alert'),
            'the fresh-install backup lane behaves differently than  recorded - if it now '
            + 'WORKS, rewrite this test to assert the restore rather than the failure')
            .toContainText(/wallet is locked/i, { timeout: 60_000 });
    });
});
