// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Scan" (§24.3) - the dedicated scan-and-classify route,
// undriven until the venue got a camera (§3.9).
//
// WHY THIS ONE. `ScanRoute`'s own source calls it "the widest-open untrusted-input
// surface this parser has (no clipboard, no click-through - just whatever a camera
// points at)", and what it does with what it finds is route the user to a MONEY
// screen with the fields already filled in. Two promises are worth driving:
//
//   1. A payment QR reaches Send with the right destination and the right amount.
//      Getting either wrong sends the user's coins somewhere they did not choose.
//   2. Secret material scanned by accident is NEVER auto-imported. A WIF or a
//      recovery phrase in front of the camera has to produce a message and
//      nothing else - no navigation, no vault write.
//
// AND ONE PROPERTY THAT IS DELIBERATE AND WORTH PINNING: the address classifier is
// LOOSE on purpose ("Beyond that the caller validates" - any 20-90 char single
// alphanumeric token classifies as an address), so a garbage blob DOES route to
// Send. What protects the user there is Send's own validation, not the scanner, and
// that is asserted rather than assumed.
//
// TWO INPUT PATHS, BOTH DRIVEN. `classify()` is shared by the camera and by the
// paste box, so the camera tests prove the lens reaches the classifier and the
// paste tests walk the classification table without paying for a browser launch
// each. The paste tests deliberately run in a browser with NO camera: `QrScanner`
// fires `onFrame` on every decoded frame, so a spec that pastes while a QR is in
// view has its status overwritten by the camera between assertions.
//
// ⚠️ THE WIF HERE IS GENERATED FROM A FIXED THROWAWAY KEY inside the spec. It is
// never funded and never imported - the whole point of the test is that the wallet
// refuses to import it - and the assertions reduce to booleans and screen strings
// so no failure message prints key material.
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/scan/scan-route.regtest.spec.js

import {
    createWallet, expect, test, gotoSection,
    LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY,
} from '../../fixtures/wallet.js';
import { launchWithQrCamera } from '../../fixtures/qrCamera.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import { encodeWif } from '../../../../packages/core/src/crypto/wif.js';

const PASSWORD = 'regtestpassword123';
const BASE_URL = `http://localhost:${Number(process.env.XC_PREVIEW_PORT) || 4183}`;

/** BIP173 test vector: a valid mainnet P2WPKH address, owned by nobody. */
const PAY_TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const PAY_AMOUNT = '0.125';
const PAY_LABEL = 'Coffee money';
const PAYMENT_QR = `bitcoin:${PAY_TO}?amount=${PAY_AMOUNT}&label=${encodeURIComponent(PAY_LABEL)}`;

/** A published BIP39 test vector, so nothing here is anyone's live phrase. */
const PHRASE_QR =
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

/**
 * A syntactically valid mainnet WIF from a fixed throwaway key. Generated
 * rather than hard-coded so no real-looking secret sits in the repo, and
 * because `detectQrContent` decodes it for real - an invalid string would
 * classify as something else and the test would pass for the wrong reason.
 */
const THROWAWAY_WIF = encodeWif(new Uint8Array(32).fill(7), 0x80, true);

/** The Amount field carries its unit in the label: "Amount (BTC)". */
const AMOUNT_LABEL = /^Amount( \(.+\))?$/;

/** Alphanumeric, 40 chars, no separators: the loose heuristic's territory. */
const GARBAGE_BLOB = 'zzzz0000zzzz0000zzzz0000zzzz0000zzzz0000';

/** Has whitespace and punctuation, so nothing claims it. */
const UNCLASSIFIABLE = 'not a thing at all !!';

/** Opens the Scan route from the unlocked shell. */
async function openScan(page) {
    await gotoSection(page, 'Scan');
    await expect(page.getByTestId('scan-route'), 'the Scan route did not open')
        .toBeVisible({ timeout: 30_000 });
}

/**
 * Pastes `text` into the scan route's fallback box and classifies it.
 * Returns 'routed' when the route claimed it, or the error text otherwise.
 */
async function classifyPaste(page, text) {
    const box = page.getByRole('textbox').first();
    await box.fill(text);
    await page.getByRole('button', { name: 'Classify pasted payload' }).click();

    const routed = page.getByLabel('To', { exact: true });
    const failed = page.getByRole('alert');
    const deadline = Date.now() + 30_000;
    for (;;) {
        if (await routed.count() > 0) return 'routed';
        if (await failed.count() > 0) return (await failed.first().innerText()).trim();
        if (Date.now() > deadline) throw new Error('the scan route neither routed nor reported');
        await page.waitForTimeout(200);
    }
}

/** A browser whose camera shows `qrText`, already onboarded and unlocked. */
async function deviceFacing(qrText, walletName) {
    const browser = await launchWithQrCamera(qrText);
    const context = await browser.newContext({ permissions: ['camera'] });
    await context.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch { /* gate renders and the spec fails loudly */ }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await createWallet(page, { password: PASSWORD, name: walletName, navigate: false });
    return { page, close: () => browser.close() };
}

test.describe('scan and classify (§24.3)', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('a payment QR reaches Send with the destination and amount it carried', async () => {
        const { page, close } = await deviceFacing(PAYMENT_QR, 'Scanner Wallet');
        try {
            await openScan(page);

            // The camera claims the frame on its own; the spec touches nothing.
            const to = page.getByLabel('To', { exact: true });
            await expect(to, 'the scanned payment QR never reached the Send screen')
                .toBeVisible({ timeout: 60_000 });

            expect(await to.inputValue(),
                'Send was opened with a DIFFERENT destination than the QR carried, which is the '
                + 'one way this surface loses a user their coins')
                .toBe(PAY_TO);
            expect(await page.getByLabel(AMOUNT_LABEL).first().inputValue(),
                'the amount from the payment QR did not reach the Amount field, so the user pays '
                + 'a number nobody asked for')
                .toBe(PAY_AMOUNT);

            // BIP21 `label` becomes the memo. Present only when the form
            // renders one, so this is conditional rather than assumed.
            const memo = page.getByLabel('Memo', { exact: true });
            if (await memo.count() > 0) {
                expect(await memo.first().inputValue(),
                    'the payment QR carried a label and the memo field did not receive it')
                    .toBe(PAY_LABEL);
            }
        } finally {
            await close();
        }
    });

    test('a recovery phrase in front of the camera is refused, not imported', async () => {
        const { page, close } = await deviceFacing(PHRASE_QR, 'Refusal Wallet');
        try {
            await openScan(page);

            await expect(page.getByRole('alert'),
                'a recovery phrase was scanned and the screen said nothing about it')
                .toContainText(/recovery phrase was scanned/i, { timeout: 60_000 });

            // The promise is not just the message: nothing may happen. Give the
            // scanner several more seconds of frames and require the route to
            // still be the route.
            await page.waitForTimeout(3_000);
            await expect(page.getByTestId('scan-route'),
                'a scanned recovery phrase navigated the wallet somewhere. The route exists so a '
                + 'casual scan of secret material cannot write to the vault or move money')
                .toBeVisible();
            await expect(page.getByLabel('To', { exact: true }),
                'a scanned recovery phrase opened the Send screen').toHaveCount(0);
        } finally {
            await close();
        }
    });

    test('the classification table: secrets refused, garbage refused, an address routed', async ({ page }) => {
        // No camera in this browser on purpose: `QrScanner` fires on every
        // decoded frame, so a QR in view would overwrite the status between
        // these assertions. The paste box feeds the SAME `classify()`.
        await createWallet(page, { password: PASSWORD, name: 'Paste Wallet' });
        await openScan(page);

        await test.step('a private key is refused, and pointed at the deliberate lane', async () => {
            const result = await classifyPaste(page, THROWAWAY_WIF);
            expect(result === 'routed',
                'a WIF pasted into the scan box was ACTED ON rather than refused')
                .toBe(false);
            expect(/private key \(WIF\) was scanned/i.test(result),
                'the WIF was not acted on, but the screen does not say a private key was scanned '
                + 'nor point at the Import lane that adds one deliberately')
                .toBe(true);
        });

        await test.step('an unclassifiable payload is refused', async () => {
            const result = await classifyPaste(page, UNCLASSIFIABLE);
            expect(result === 'routed', 'unrecognized content was routed somewhere').toBe(false);
            expect(/not recognized/i.test(result),
                'unrecognized content was refused without saying so').toBe(true);
        });

        await test.step('a garbage blob DOES route: the loose classifier is the documented design', async () => {
            // `detectQrContent`'s step 6 takes any 20-90 char single
            // alphanumeric token as a probable address, on purpose, leaving
            // validation to the caller. Pinned so the looseness is a decision
            // on the record rather than a surprise - and so the NEXT assertion
            // (that Send refuses it) is known to be the thing protecting the
            // user here.
            expect(await classifyPaste(page, GARBAGE_BLOB),
                'the loose address heuristic no longer routes a garbage blob to Send. If that is '
                + 'deliberate, this test should now assert the refusal instead')
                .toBe('routed');

            const to = page.getByLabel('To', { exact: true });
            await expect(to).toBeVisible({ timeout: 30_000 });
            expect(await to.inputValue(), 'the blob did not reach the To field').toBe(GARBAGE_BLOB);
        });

        await test.step('and Send is what refuses it, since the scanner did not', async () => {
            // The destination check runs on REVIEW, not while typing, so the
            // spec has to press the button a user would press. That timing is
            // worth knowing: a scanned blob sits in the To field looking
            // accepted until the moment of submit.
            await page.getByLabel(AMOUNT_LABEL).first().fill('0.001');
            await page.getByRole('main').getByRole('button', { name: 'Send', exact: true }).click();

            // Asserted on the SPECIFIC wording, not on "some alert is showing":
            // the Send screen carries other alerts, and an any-alert assertion
            // passed here while the destination check was never reached at all.
            await expect(page.getByText(/not a valid .* address/i).first(),
                'a scanned garbage destination reached Send and Send did not refuse it. The '
                + 'classifier is loose by design, so this check is the only thing standing '
                + 'between a mis-scanned blob and a signed transaction')
                .toBeVisible({ timeout: 30_000 });
        });
    });
});
