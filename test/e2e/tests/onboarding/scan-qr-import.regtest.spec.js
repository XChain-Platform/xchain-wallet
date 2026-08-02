// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Onboarding & wallet lifecycle" -> "Scan-QR import"
// and the scan half of "backup-pointer restore" (§15.4), undriven since the
// lines were written.
//
// WHY IT WAS UNDRIVEN, and what changed. Both lanes only accept input through a
// CAMERA: `QrScanner` runs the browser's native `BarcodeDetector` over a
// `getUserMedia` stream, so there is no way to type into them. This spec gives
// the venue a real camera instead - `fixtures/qrCamera.js` renders the QR to a
// raw video file that Chromium replays as a capture device, and the wallet's
// OWN decoder reads it off its OWN video element. Nothing on the scan path is
// stubbed; a broken scanner fails here.
//
// WHAT IS ASSERTED:
//
//   SCAN      a recovery phrase on a QR lands in the phrase box intact, with the
//             `bip39:` prefix some generators emit stripped, and imports to an
//             unlocked wallet.
//   REFUSAL   the SAME phrase QR held up to the BACKUP lane is REFUSED. That
//             lane classifies what it scanned and takes only a backup pointer;
//             the comment on `handleBackupQrFrame` states the rule it is
//             enforcing - "we never silently import secret material from a
//             stray scan" - and the assertion is not just that it says no, but
//             that the phrase did not land in the backup box either.
//   POINTER   a real §15.4 backup-pointer QR loads, and the screen shows the
//             LOCATION it would fetch from before the user commits to it. That
//             is the only chance a user gets to notice a pointer aimed
//             somewhere they did not expect.
//   GARBAGE   a QR that is neither (the pointer URI, held up to the PHRASE
//             lane) cannot be imported: the word-count validator refuses it.
//
// NO CHAIN. Every assertion is local: decoding, classification, and a vault
// write. It runs on the regtest config only because that is where the harness
// lives.
//
// ⚠️ THE SPEC MUST NOT LEAK WHAT IT TESTS (Session 38 rule). The phrase on the
// QR is a published BIP39 test vector, but the assertions still reduce to
// BOOLEANS before they are compared so no failure message can print it.
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/onboarding/scan-qr-import.regtest.spec.js

import {
    expect, test, dismissIntroCarousel, unlockedShell,
    LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY,
} from '../../fixtures/wallet.js';
import { launchWithQrCamera } from '../../fixtures/qrCamera.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';

const PASSWORD = 'regtestpassword123';

/** A published BIP39 test vector, so nothing here is anyone's live phrase. */
const PHRASE =
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

/**
 * Some QR generators prefix a seed with `bip39:`; `handleQrFrame` strips it.
 * Putting the prefix ON the code means the strip is exercised by the scan
 * rather than asserted in a unit test.
 */
const PHRASE_QR = `bip39:${PHRASE}`;

/** A §15.4 pointer. The location is deliberately one nothing will fetch. */
const POINTER_NAME = 'Laptop backup';
const POINTER_LOCATION = 'https://backup.example.test/vault/envelope.json';
const POINTER_QR = `xchain-backup:1?loc=${encodeURIComponent(POINTER_LOCATION)}&name=${encodeURIComponent(POINTER_NAME)}`;

const BASE_URL = `http://localhost:${Number(process.env.XC_PREVIEW_PORT) || 4183}`;

/**
 * Opens the import screen in a browser whose camera is showing `qrText`.
 * Returns the page and a close function; the caller always closes.
 *
 * @param {string} qrText
 * @param {{ lane?: 'mnemonic' | 'backup' }} [opts]
 */
async function importScreenFacing(qrText, { lane = 'mnemonic' } = {}) {
    const browser = await launchWithQrCamera(qrText);
    const context = await browser.newContext({ permissions: ['camera'] });
    await context.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch {
                // Storage unavailable: the gate renders and the spec fails
                // loudly rather than silently testing the gate.
            }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Import wallet' }).click();
    if (lane === 'backup') {
        await page.getByRole('tab', { name: 'Encrypted backup' }).click();
    }
    return { page, close: () => browser.close() };
}

/**
 * Presses a scan button and waits for the scanner to close itself, which is
 * how both lanes signal a decoded frame. Returns false if it never did.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} buttonName
 */
async function scan(page, buttonName) {
    const button = page.getByRole('button', { name: buttonName, exact: true });
    await button.click();
    // The scanner unmounts on the frame it accepts, and on a rejected frame
    // too - both lanes set their scanning flag false either way - so the
    // button's label flipping back is the signal that a frame was PROCESSED,
    // whatever the verdict was.
    const cancel = page.getByRole('button', { name: 'Cancel scan', exact: true });
    await expect(cancel, 'the scanner never opened').toBeVisible({ timeout: 30_000 });
    try {
        await expect(cancel).toBeHidden({ timeout: 60_000 });
        return true;
    } catch {
        return false;
    }
}

test.describe('QR scan on the import screen (§15.4)', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('a scanned recovery phrase imports, and the backup lane refuses it', async () => {
        await test.step('SCAN: a phrase on a QR lands in the box and imports', async () => {
            const { page, close } = await importScreenFacing(PHRASE_QR);
            try {
                expect(await scan(page, 'Scan QR'),
                    'the recovery-phrase scanner never read the QR in front of it')
                    .toBe(true);

                const box = page.getByLabel('Recovery phrase', { exact: true });
                // Compared as a boolean: a failing string matcher would print
                // the phrase into the run log.
                expect((await box.inputValue()).trim() === PHRASE,
                    'the scanned phrase did not reach the box intact - either the decode mangled '
                    + 'it or the `bip39:` prefix some generators emit was not stripped')
                    .toBe(true);

                await page.getByLabel('Wallet name').fill('Scanned Wallet');
                await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
                await page.getByLabel(/^Confirm( password)?$/).fill(PASSWORD);
                await page.getByRole('button', { name: 'Import', exact: true }).click();

                // Argon2id, then the vault write.
                await expect(unlockedShell(page),
                    'the scanned phrase never became an unlocked wallet')
                    .toBeVisible({ timeout: 120_000 });
            } finally {
                await close();
            }
        });

        await test.step('REFUSAL: the same phrase QR is refused by the BACKUP lane', async () => {
            // The rule `handleBackupQrFrame` exists to enforce: a lane that
            // accepts a location must not quietly swallow a seed because one
            // happened to be in front of the camera.
            const { page, close } = await importScreenFacing(PHRASE_QR, { lane: 'backup' });
            try {
                expect(await scan(page, 'Scan pointer QR'),
                    'the backup-pointer scanner never processed the QR in front of it')
                    .toBe(true);

                await expect(page.getByRole('alert'),
                    'a recovery phrase was scanned into the BACKUP lane and the screen said nothing')
                    .toContainText(/not a backup pointer/i, { timeout: 30_000 });

                // The refusal has to be a refusal, not a redirect: nothing may
                // have been captured on the way past.
                await expect(page.getByRole('status').filter({ hasText: /Backup pointer loaded/ }),
                    'a recovery phrase was accepted AS a backup pointer')
                    .toHaveCount(0);
                const backupBox = page.getByPlaceholder('{"version":1');
                expect((await backupBox.inputValue()).length === 0,
                    'the scanned recovery phrase was written into the backup-content box, so a '
                    + 'stray scan of a seed ends up in a field the user is about to submit')
                    .toBe(true);
            } finally {
                await close();
            }
        });

        await test.step('POINTER: a real backup pointer loads and shows where it points', async () => {
            const { page, close } = await importScreenFacing(POINTER_QR, { lane: 'backup' });
            try {
                expect(await scan(page, 'Scan pointer QR'),
                    'the backup-pointer scanner never read the pointer QR')
                    .toBe(true);

                const card = page.getByRole('status').filter({ hasText: /Backup pointer loaded/ });
                await expect(card, 'a valid backup pointer was not accepted')
                    .toBeVisible({ timeout: 30_000 });
                // The location is the only thing standing between a user and a
                // pointer aimed somewhere they did not choose, so it has to be
                // ON the screen, not just in the parsed object.
                await expect(card,
                    'the pointer card does not show the location it would fetch the backup from')
                    .toContainText(POINTER_LOCATION);
                await expect(card,
                    'the pointer card does not show the label the pointer carries')
                    .toContainText(POINTER_NAME);
            } finally {
                await close();
            }
        });

        await test.step('GARBAGE: a pointer QR in the PHRASE lane cannot be imported', async () => {
            // `handleQrFrame` does not classify - anything scanned lands in the
            // phrase box. That is safe only because the word-count validator
            // stands behind it, which is what this asserts rather than assumes.
            const { page, close } = await importScreenFacing(POINTER_QR);
            try {
                expect(await scan(page, 'Scan QR'), 'the phrase scanner never read the QR')
                    .toBe(true);
                await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
                await page.getByLabel(/^Confirm( password)?$/).fill(PASSWORD);
                await page.getByRole('button', { name: 'Import', exact: true }).click();

                await expect(page.getByRole('alert'),
                    'a backup-pointer URI scanned into the recovery-phrase box was accepted as a '
                    + 'recovery phrase')
                    .toContainText(/Expected 12, 15, 18, 21, 24 words/i, { timeout: 30_000 });
                await expect(unlockedShell(page), 'a non-phrase QR produced a wallet')
                    .toHaveCount(0);
            } finally {
                await close();
            }
        });
    });
});
