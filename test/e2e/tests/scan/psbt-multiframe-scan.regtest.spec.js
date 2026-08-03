// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Sign" -> the MULTI-FRAME transaction capture (§20.3),
// never driven: it needs a camera showing an ANIMATED code, which no harness
// could produce until §3.9.
//
// WHY IT MATTERS BEYOND ITS OWN LANE. This is the transport the whole air-gap
// story rests on. A watcher builds a PSBT it cannot sign, displays it as a
// sequence of QR frames, and the offline signer collects them with its camera -
// there is no cable, no clipboard and no file system between the two halves. And
// it is the same transport  wants for the pairing payload, so what this
// measures is also what chunked pairing would cost.
//
// WHAT IS ASSERTED:
//
//   PROGRESS   the panel reports "XCW frames received: N of M" while collecting,
//              which is the only feedback a user gets that the capture is
//              working rather than stalled.
//   REASSEMBLY the box ends up holding EXACTLY the transaction the frames
//              encoded, compared as a boolean over the whole value so a
//              truncated or mis-ordered reassembly fails.
//   INCOMPLETE a set with a frame missing never completes and never puts a
//              partial transaction in the box - the failure that matters, since
//              a half-decoded PSBT that reached the signing path would be worse
//              than no capture at all.
//
// The frames come from the wallet's OWN `encodeXcwChunks`, so this drives the
// real wire format rather than a spec's idea of it, and the receiver is the
// wallet's own collector reading its own camera.
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/scan/psbt-multiframe-scan.regtest.spec.js

import {
    createWallet, expect, test,
    LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY,
} from '../../fixtures/wallet.js';
import { launchWithQrCamera } from '../../fixtures/qrCamera.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import { encodeXcwChunks } from '../../../../packages/core/src/uri/psbtQr.js';

const PASSWORD = 'regtestpassword123';
const BASE_URL = `http://localhost:${Number(process.env.XC_PREVIEW_PORT) || 4183}`;

/**
 * A PSBT-shaped blob big enough to need several chunks. `encodeXcwChunks` gives
 * chunk 1 a 32-byte hash overhead out of its 180-byte budget, so ~400 bytes
 * lands three frames - enough that ordering and reassembly are really exercised
 * rather than a single frame wearing a chunk header.
 */
const PSBT_HEX = '70736274ff' + 'ab'.repeat(400);

/** Opens the Sign panel in a browser whose camera is showing `frames`. */
async function signPanelFacing(frames) {
    const browser = await launchWithQrCamera(frames);
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
    await createWallet(page, { password: PASSWORD, name: 'Signer Wallet', navigate: false });

    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('combobox').first().fill('Sign a PSBT');
    await page.getByRole('option', { name: /^Sign a PSBT/ }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const box = page.getByLabel('Unsigned transaction (hex or base64)');
    await expect(box, 'the Sign panel did not open').toBeVisible({ timeout: 30_000 });
    return { page, box, close: () => browser.close() };
}

test.describe('multi-frame transaction capture (§20.3)', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('an animated QR is collected frame by frame and reassembled exactly', async () => {
        const frames = encodeXcwChunks(PSBT_HEX);
        expect(frames.length,
            'the fixture PSBT no longer needs multiple frames, so this test would pass without '
            + 'exercising the collector at all')
            .toBeGreaterThan(1);

        const { page, box, close } = await signPanelFacing(frames);
        try {
            await page.getByRole('button', { name: 'Scan transaction', exact: true }).click();

            // The progress line is the only thing telling a user that a capture
            // is progressing rather than stalled, and it is also the proof that
            // the collector saw MORE THAN ONE frame - a single-frame path would
            // fill the box without ever showing it.
            await expect(page.getByText(/XCW frames received: \d+ of \d+/),
                'the panel never reported multi-frame progress, so either the camera showed nothing '
                + 'or the collector was bypassed')
                .toBeVisible({ timeout: 60_000 });

            // Compared as a boolean, and on the WHOLE value: a reassembly that
            // dropped or re-ordered a chunk would still produce plausible hex.
            await expect.poll(async () => (await box.inputValue()).length, {
                timeout: 120_000,
                message: 'the capture never completed: the transaction box stayed empty while the '
                    + 'camera played every frame',
            }).toBeGreaterThan(0);
            expect((await box.inputValue()).toLowerCase() === PSBT_HEX.toLowerCase(),
                'the frames were collected but what landed in the box is not the transaction they '
                + 'encoded, so the reassembly dropped, duplicated or re-ordered a chunk')
                .toBe(true);
        } finally {
            await close();
        }
    });

    test('a set with a frame missing never completes, and leaves nothing behind', async () => {
        // The failure that matters. A partial PSBT that reached the signing path
        // would be worse than no capture: it would be a transaction the user
        // never saw whole. The collector must hold, not guess.
        const frames = encodeXcwChunks(PSBT_HEX);
        const missingOne = frames.filter((_f, i) => i !== 1);

        const { page, box, close } = await signPanelFacing(missingOne);
        try {
            await page.getByRole('button', { name: 'Scan transaction', exact: true }).click();
            await expect(page.getByText(/XCW frames received: \d+ of \d+/),
                'the panel never reported progress, so this test proves nothing about incompleteness')
                .toBeVisible({ timeout: 60_000 });

            // Give the camera several loops of every frame it DOES have.
            await page.waitForTimeout(15_000);

            expect((await box.inputValue()).length,
                'a transaction was assembled from an INCOMPLETE frame set, so the signing path can '
                + 'be handed a transaction the user never saw whole')
                .toBe(0);
            await expect(page.getByText(/XCW frames received: \d+ of \d+/),
                'the incomplete capture stopped reporting progress, so a user has no way to tell it '
                + 'is still waiting for a frame')
                .toBeVisible();
        } finally {
            await close();
        }
    });
});
