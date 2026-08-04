// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Receive" -> the ⬜ residual open since SESSION 1:
// "Exact URI contents, token switch, fee-slider effect on the request,
// Copy/Share correctness (DOM read blocked by privacy filter; verify from
// source or Copy paste)."
//
// THE REASON IT SAT THERE FOR FORTY SESSIONS HAS EXPIRED. "DOM read blocked by
// privacy filter" described the MCP harness, which drove a browser by hand.
// Under Playwright the QR is an ordinary `<img>` and Chromium's own
// `BarcodeDetector` will read it, so the request can be checked the way a payer
// checks it: BY DECODING THE PAINTED CODE, not by reading the state that drew
// it. That distinction is the whole point of this file. Every value asserted
// below comes back out of the rendered pixels, so a Receive screen that
// displays one address and encodes another fails here - and that is the single
// worst defect this surface can have, because the user reads the text and the
// payer scans the code.
//
// The residual also says "BIP21", and that is now stale in a way worth
// recording: `Receive.jsx` builds a BIP21 `bitcoin:`/`litecoin:` URI only as a
// FALLBACK, for a chain the registry has no coin code for. The real payload is
// the `xchain:CODE/send?to=…` shape from `uri/xchainUri.js`, which carries the
// amount, tick and fee preference BIP21 has no slot for.
//
// NOT COVERED HERE, and left honestly rather than quietly: the token switch
// (it navigates to the picker route, which is its own surface) and Copy/Share
// (`copyQrImage` writes an IMAGE to the clipboard, which needs a different
// harness than a text read). The rest of the residual is closed.
//
// RUN IT:
//   cd test/e2e && npx playwright test \
//       --config=playwright.regtest.config.js tests/receive/receive-qr-uri.regtest.spec.js

import { createWallet, expect, gotoSection, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    switchToRegtest,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const REQUEST_AMOUNT = '0.25';

/**
 * Reads the QR the user is actually looking at.
 *
 * `BarcodeDetector` is secure-context only, which is why an early probe of it
 * on `about:blank` reported `undefined` (see fixtures/qrCamera.js); on this
 * venue's localhost origin it is a function. Returns null while the QR is
 * still being drawn, so callers poll rather than race the render.
 */
async function decodeReceiveQr(page) {
    return page.evaluate(async () => {
        const img = document.querySelector('img[alt^="QR code for"]');
        if (!img || !img.src) return null;
        if (typeof window.BarcodeDetector !== 'function') {
            // Reported rather than swallowed: a missing detector would
            // otherwise present as "the QR never rendered", which is a wallet
            // defect, and this is not one.
            return 'NO_BARCODE_DETECTOR';
        }
        try {
            if (!img.complete) await img.decode();
            const bitmap = await createImageBitmap(img);
            const codes = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap);
            return codes.length ? codes[0].rawValue : null;
        } catch {
            return null;
        }
    });
}

/** Polls until the painted QR decodes to something matching `predicate`. */
async function expectQr(page, predicate, message) {
    let last = null;
    await expect
        .poll(async () => {
            last = await decodeReceiveQr(page);
            expect(last, 'the venue browser has no BarcodeDetector, so nothing here is being read')
                .not.toBe('NO_BARCODE_DETECTOR');
            return last !== null && predicate(last);
        }, { message, timeout: 30_000 })
        .toBe(true);
    return last;
}

function parseXchainUri(raw) {
    const match = /^xchain:([A-Za-z0-9]+)\/([a-z]+)\?(.*)$/.exec(raw);
    if (!match) return null;
    return {
        code: match[1],
        action: match[2],
        params: Object.fromEntries(new URLSearchParams(match[3])),
    };
}

test.describe('Receive: the request the payer actually scans', () => {
    test.setTimeout(600_000);

    let ownAddress;

    test.beforeEach(async ({ page }) => {
        await createWallet(page, { password: PASSWORD });
        await switchToRegtest(page, PASSWORD);
        await gotoSection(page, 'Receive');

        // NO `selectVenueChain` HERE, deliberately: the Receive screen carries
        // no "Network" picker at all - it follows the wallet's ACTIVE chain -
        // so the venue helper throws "no Network chain picker on this screen".
        // That is why the campaign's other multi-chain specs read an address
        // off a form instead. The regex below is what keeps it honest: on a
        // venue whose chain Receive is not showing, this fails here naming the
        // shape it wanted rather than asserting URI contents for another chain.
        const field = page.getByLabel('Address', { exact: true });
        await expect(field,
            `Receive is not showing a ${REGTEST_COIN} address; it follows the active chain and has `
            + 'no network picker, so this spec runs on whichever chain the wallet opens on')
            .toHaveValue(REGTEST_ADDRESS_RE, { timeout: 30_000 });
        ownAddress = await field.inputValue();
    });

    test('the QR encodes the address on screen, and the amount and fee the form was given', async ({ page }) => {
        await test.step('bare request: the code carries THIS address and nothing invented', async () => {
            const raw = await expectQr(page, (v) => v.startsWith('xchain:'),
                'the Receive QR never decoded to an xchain: URI');
            const uri = parseXchainUri(raw);
            expect(uri, `the Receive QR decoded to something unparseable: ${raw}`).not.toBeNull();
            expect(uri.action, 'the receive QR does not ask the scanning wallet to SEND').toBe('send');

            // THE ASSERTION THIS FILE EXISTS FOR. The user reads the Address
            // field; the payer scans the code. If those two ever disagree the
            // money goes somewhere the user never saw, and every other check on
            // this screen would still pass.
            expect(uri.params.to,
                'the QR encodes a DIFFERENT address than the one displayed on screen - a payer '
                + 'scanning this code would pay somewhere the user never saw')
                .toBe(ownAddress);

            // No amount is requested until one is typed. An invented amount
            // here would silently under- or over-charge every payer.
            expect(uri.params.amount,
                'the QR requests an amount the user never entered').toBeUndefined();
        });

        await test.step('an amount typed on screen reaches the code exactly', async () => {
            await page.getByRole('textbox', { name: /^Amount/ }).fill(REQUEST_AMOUNT);

            const raw = await expectQr(page,
                (v) => parseXchainUri(v)?.params?.amount !== undefined,
                'the QR never picked up the requested amount, so a payer scanning it would be '
                + 'asked for nothing while the screen shows a request');
            const uri = parseXchainUri(raw);

            // Compared as a NUMBER as well as a string: a formatter that ships
            // "0.250000000" or "25000000" (sats) would still be "present", and
            // one of those two overcharges by 1e8.
            expect(uri.params.amount,
                'the requested amount reached the QR in a different form than the user typed')
                .toBe(REQUEST_AMOUNT);
            expect(Number(uri.params.amount)).toBeCloseTo(Number(REQUEST_AMOUNT), 8);
            expect(uri.params.to, 'the address changed when an amount was typed').toBe(ownAddress);
        });

        await test.step('the fee slider is part of the REQUEST, not just decoration', async () => {
            const before = parseXchainUri(await decodeReceiveQr(page))?.params?.feePriority;
            expect(before,
                'the Receive QR carries no fee preference at all, so the slider on this screen '
                + 'changes nothing a payer will ever see')
                .toBeTruthy();

            // THE SLIDER, not the tick buttons beside it. `FeeSelector` puts
            // its Low/Normal/Fast ticks inside a container marked
            // `aria-hidden="true"`, so they are absent from the accessibility
            // tree and no role query can ever reach them - a click on them
            // waits out its full budget. The `<input type="range">` carries
            // `aria-label="Network fee"` and is the control an assistive-tech
            // user drives, so it is the right one to drive here too.
            const slider = page.getByRole('main').getByRole('slider', { name: 'Network fee' });
            await expect(slider,
                'the fee slider never rendered, so this screen offers no fee preference at all')
                .toBeVisible({ timeout: 30_000 });
            await expect(slider,
                'the fee slider is DISABLED, which means the tiers never estimated - the request '
                + 'below would be asserting against a control the user cannot move either')
                .toBeEnabled();

            await slider.focus();
            await page.keyboard.press(before === 'fast' ? 'ArrowLeft' : 'ArrowRight');

            const raw = await expectQr(page,
                (v) => {
                    const p = parseXchainUri(v)?.params?.feePriority;
                    return p !== undefined && p !== before;
                },
                `the QR still asks for "${before}" after the fee slider was moved, so the control `
                + 'changes nothing the payer will ever see');
            const uri = parseXchainUri(raw);
            expect(uri.params.feePriority).not.toBe(before);
            // Everything else must survive the move. A re-encode that drops the
            // amount is the kind of bug a fee assertion alone cannot see.
            expect(uri.params.to).toBe(ownAddress);
        });
    });

    // Separate case because it is a different claim: not "the code is right"
    // but "the code KEEPS UP". A QR that renders once and then goes stale is
    // the worst outcome on this screen, since it looks correct while encoding
    // a superseded request - and the campaign's Session-1 note only ever
    // established that the image re-renders, never that its CONTENT changed.
    test('the code is re-encoded when the request changes, not merely repainted', async ({ page }) => {
        const bare = await expectQr(page, (v) => v.startsWith('xchain:'), 'no initial QR');

        await page.getByRole('textbox', { name: /^Amount/ }).fill('1.5');
        const withAmount = await expectQr(page, (v) => v !== bare,
            'the QR content never changed after an amount was entered');

        await page.getByRole('textbox', { name: /^Amount/ }).fill('2.5');
        const changed = await expectQr(page, (v) => v !== withAmount,
            'the QR content was NOT re-encoded when the amount changed from 1.5 to 2.5, so the '
            + 'payer would be asked for the previous amount');

        expect(parseXchainUri(changed)?.params?.amount).toBe('2.5');

        // And clearing it returns to a bare request rather than stranding the
        // last amount on the code.
        await page.getByRole('textbox', { name: /^Amount/ }).fill('');
        await expectQr(page, (v) => parseXchainUri(v)?.params?.amount === undefined,
            'clearing the amount left the old one stranded on the QR, so a payer would still be '
            + 'asked for it');
    });
});
