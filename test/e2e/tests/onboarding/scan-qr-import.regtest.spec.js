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
//   NO SCANNER the BACKUP lane no longer scans at all (restore-v2, 2026-11-14):
//             it takes a chosen file, so a recovery phrase on a camera has no
//             way into it. The assertion is that no scan control is offered
//             and nothing is shown as a chosen backup.
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
    acknowledgeImportNotice, expect, test, dismissIntroCarousel, openedWalletHome,
    LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY,
} from '../../fixtures/wallet.js';
import { launchWithQrCamera } from '../../fixtures/qrCamera.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import { fieldByLabel } from '../../fixtures/fields.js';

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

/** A §15.4 pointer. Held up to the PHRASE lane, which must not take it as a phrase. */
const POINTER_LOCATION = 'https://backup.example.test/vault/envelope.json';
const POINTER_QR = `xchain-backup:1?loc=${encodeURIComponent(POINTER_LOCATION)}`;

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

/**
 * Skips the calling test on a browser with no Shape Detection API. `QrScanner`
 * reads frames through the native `BarcodeDetector`, which Chromium ships on
 * macOS, Windows and Android but not on Linux, so a Linux venue runner cannot
 * read any camera QR no matter what the wallet does. Probed on a real
 * localhost origin because the API is secure-context only.
 *
 * @param {import('@playwright/test').Browser} browser
 */
async function skipWithoutBarcodeDetector(browser) {
    const context = await browser.newContext();
    try {
        const probe = await context.newPage();
        await probe.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        const present = await probe.evaluate(() => typeof window.BarcodeDetector === 'function');
        test.skip(!present, 'this browser has no BarcodeDetector (Chromium on Linux), so no camera QR can be read');
    } finally {
        await context.close();
    }
}

test.describe('QR scan on the import screen (§15.4)', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('a scanned recovery phrase imports, and the backup lane refuses it', async ({ browser }) => {
        await skipWithoutBarcodeDetector(browser);
        await test.step('SCAN: a phrase on a QR lands in the box and imports', async () => {
            const { page, close } = await importScreenFacing(PHRASE_QR);
            try {
                expect(await scan(page, 'Scan QR'),
                    'the recovery-phrase scanner never read the QR in front of it')
                    .toBe(true);

                const box = fieldByLabel(page, 'Recovery phrase');
                // Compared as a boolean: a failing string matcher would print
                // the phrase into the run log.
                expect((await box.inputValue()).trim() === PHRASE,
                    'the scanned phrase did not reach the box intact - either the decode mangled '
                    + 'it or the `bip39:` prefix some generators emit was not stripped')
                    .toBe(true);

                await fieldByLabel(page, 'Wallet name').fill('Scanned Wallet');
                await fieldByLabel(page, 'Password').fill(PASSWORD);
                await page.getByLabel(/^Confirm( password)?$/).fill(PASSWORD);
                await page.getByRole('button', { name: 'Import', exact: true }).click();
                // The import ends on the donation notice, not the shell.
                await acknowledgeImportNotice(page);

                // Argon2id, then the vault write. The budget is the shared
                // one for exactly that reason: a hand-picked number here is a
                // bet on how fast this venue derives, and the 120_000 that
                // used to sit on this line was BELOW what the budget computes
                // on a loaded box or on CI.
                await expect(openedWalletHome(page),
                    'the scanned phrase never became an unlocked wallet')
                    .toBeVisible({ timeout: kdfStepTimeout() });
            } finally {
                await close();
            }
        });

        await test.step('NO SCANNER: the BACKUP lane takes a chosen file and offers no scan', async () => {
            // The Backup tab lost its pointer scan with the paste box
            // (restore-v2, 2026-11-14; pinned by
            // test/unit/routes/ImportWallet.backupPointer.test.jsx). A seed
            // held up to the camera therefore has no way into that lane, and
            // the lane must not grow one quietly.
            const { page, close } = await importScreenFacing(PHRASE_QR, { lane: 'backup' });
            try {
                await expect(page.getByLabel('Backup file', { exact: true }),
                    'the Backup tab did not open, so its lack of a scanner proves nothing')
                    .toBeAttached({ timeout: 30_000 });
                await expect(page.getByRole('button', { name: /scan/i }),
                    'the Backup tab offers a QR scanner, so a stray scan of a seed has a way into '
                    + 'the lane that takes a backup')
                    .toHaveCount(0);
                await expect(page.getByRole('region', { name: 'Chosen backup file' }),
                    'a backup file is shown as chosen though none was')
                    .toHaveCount(0);
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
                await fieldByLabel(page, 'Password').fill(PASSWORD);
                await page.getByLabel(/^Confirm( password)?$/).fill(PASSWORD);
                await page.getByRole('button', { name: 'Import', exact: true }).click();

                // The field's own sentence; the form-errors summary above it repeats it.
                await expect(page.getByRole('alert').filter({ hasNotText: /Fix \d+ things? to continue/ }),
                    'a backup-pointer URI scanned into the recovery-phrase box was accepted as a '
                    + 'recovery phrase')
                    .toContainText(/Expected 12, 15, 18, 21, or 24 words/i, { timeout: 30_000 });
                await expect(openedWalletHome(page), 'a non-phrase QR produced a wallet')
                    .toHaveCount(0);
            } finally {
                await close();
            }
        });
    });
});
