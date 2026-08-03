// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Onboarding & wallet lifecycle" -> "Pair a watcher or
// signer" (§20.5 / ), undriven since the lane shipped.
//
// WHY THIS ONE. It is the fourth onboarding lane and the only one that ends
// with two DEVICES trusting each other. Its whole reason to exist is stated in
// `flows/pairPartner.js`: before it, a mistyped word in the shared recovery
// phrase surfaced as a PSBT the offline signer could not sign, discovered after
// the air-gap round trip with no diagnosis attached. So the assertion that
// matters is the REFUSAL - a pair that is not one seed must be told so HERE,
// while the user is still standing in front of both devices.
//
// TWO HALVES, TWO BROWSER CONTEXTS. The wallet is one vault per origin
// ("wallet.create: a wallet already exists"), so the pair cannot live in one
// page. Each context is a separate device with its own IndexedDB, which is also
// the only honest way to test a lane whose entire subject is what crosses
// BETWEEN two devices: the only thing that moves between the contexts here is
// the pairing code, moved by the spec the way a user moves it by QR or paste.
//
// WHAT IS ASSERTED, in the order the test runs it:
//
//   CONTROL   two halves of ONE phrase pair, and their key fingerprints (shown
//             on screen for exactly this eyeball check) are identical.
//   PRIVACY   the emitted code carries no word of the recovery phrase, and no
//             field outside the published allow-list. This is the promise the
//             exchange screen makes in so many words: "no recovery phrase, no
//             private key, and nothing that can spend". A control assertion
//             requires the decoded payload to be structurally REAL first, so a
//             decode that quietly yielded nothing cannot pass the leak check.
//   TEETH 1   a DIFFERENT recovery phrase is refused (`seed-mismatch`). This is
//             the failure the lane was built for.
//   TEETH 2   the right seed in the WRONG ROLE is refused (`mode-mismatch`):
//             a watcher pairing with another watcher leaves nobody signing.
//   NOT STICKY the genuine partner still pairs AFTER both refusals, so the two
//             refusals above measured the payloads rather than a form that had
//             failed shut.
//
// NO CHAIN. Nothing here broadcasts, funds or indexes: a pairing payload is
// account-level PUBLIC key material derived locally. It runs on the regtest
// config only because that is where the harness lives.
//
// ⚠️ THE SPEC MUST NOT LEAK WHAT IT TESTS (Session 38 rule). A failing
// `toContain` prints both sides, and both sides here are recovery phrases and
// key material. Every assertion below is reduced to a BOOLEAN or a short screen
// string first, and no message interpolates a word of any mnemonic or any part
// of a pairing code.
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/onboarding/pair-partner.regtest.spec.js

import {
    expect, test, dismissIntroCarousel,
    LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY,
} from '../../fixtures/wallet.js';
import { launchWithQrCamera } from '../../fixtures/qrCamera.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import {
    encodeXcwChunks, createXcwCollector, addChunkToCollector,
} from '../../../../packages/core/src/uri/psbtQr.js';

const PASSWORD = 'regtestpassword123';

// Two BIP39 test vectors, so both carry a correct checksum: an INVALID phrase
// is refused by `normalizeMnemonic` during import and would never reach the
// comparison this test is aimed at.
const SHARED_MNEMONIC =
    'legal winner thank year wave sausage worth useful legal winner thank yellow';
const FOREIGN_MNEMONIC =
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

/** The wire prefix from `flows/pairPartner.js`. */
const PAIR_PREFIX = 'XCW-PAIR:';

/** A camera-equipped browser is launched outside the project, so it needs the absolute URL. */
const BASE_URL = `http://localhost:${Number(process.env.XC_PREVIEW_PORT) || 4183}`;

/**
 * Every field a pairing key entry is allowed to carry (`validatePairingPayload`
 * builds exactly these). An allow-list rather than a deny-list on purpose: the
 * leak this guards is a field nobody thought to look for.
 */
const ALLOWED_KEY_FIELDS = ['chainId', 'addressType', 'path', 'publicKey', 'chainCode', 'xpub', 'keyId'];
const ALLOWED_PAYLOAD_FIELDS = ['v', 'kind', 'walletMode', 'label', 'createdAt', 'keys'];

/**
 * A fresh browser context = a fresh device. Seeds the license keys the way the
 * shared `page` fixture does, since that fixture only covers its own page.
 */
async function newDevice(browser) {
    const context = await browser.newContext();
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
    return { context, page: await context.newPage() };
}

/**
 * Walks one device from a cold browser to the exchange stage of the pairing
 * lane, and returns its own pairing code plus the fingerprint it displays.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ role: 'watcher' | 'signer', mnemonic: string, name: string, url?: string }} opts
 */
async function pairLaneToExchange(page, { role, mnemonic, name, url = '/' }) {
    // A browser launched by `launchWithQrCamera` is not the config's project, so
    // it has no baseURL and needs the absolute one.
    await page.goto(url);
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Pair a watcher or signer' }).click();

    // The role stage names the OTHER half, which is the wording a user reasons
    // about ("this device watches") - not the mode string.
    const roleButton = role === 'watcher'
        ? 'This device watches. Pair a signer'
        : 'This device signs. Pair a watcher';
    await page.getByRole('button', { name: roleButton }).click();

    await page.getByLabel('Wallet name').fill(name);
    await page.getByLabel('Shared recovery phrase').fill(mnemonic);
    await page.getByLabel('Password for this device').fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Argon2id on the import, then the host derives an account node per active
    // chain. Both are slow enough to need the long budget. Race the code box
    // against the error row so a lane that CANNOT build a payload reports why
    // in seconds instead of timing out two minutes later with no diagnosis.
    const codeBox = page.getByText(new RegExp(`^${PAIR_PREFIX}`));
    const failed = page.getByRole('alert');
    await codeBox.or(failed).first().waitFor({ state: 'visible', timeout: 120_000 });
    if (await codeBox.count() === 0) {
        throw new Error(`the pairing lane could not build this device's code: ${(await failed.first().innerText()).trim()}`);
    }

    const code = (await codeBox.innerText()).trim();
    const fingerprintLine = await page.getByText(/^Key fingerprint:/).innerText();

    return { code, fingerprint: fingerprintLine.replace(/^Key fingerprint:\s*/, '').trim() };
}

/**
 * Hands `partnerCode` to the device on `page` and presses its pair button.
 * Returns 'paired' or the error text the screen showed, never the code.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ partnerCode: string, cta: string }} opts
 */
async function submitPartnerCode(page, { partnerCode, cta }) {
    const paired = page.getByText(/^Paired\./);
    // `StatusMessage variant="error"` is the only role="alert" on this screen.
    const failed = page.getByRole('alert');

    // A REFUSAL FROM THE PREVIOUS ATTEMPT IS STILL ON SCREEN when this runs
    // again, and it would satisfy a plain "wait for an alert" instantly - which
    // would report the NEXT attempt as refused whatever it actually did, and
    // silently invert the not-sticky check below. So remember what the screen
    // already said and only accept a message that changed. (The three attempts
    // this spec makes are refused for three different reasons, so no two
    // consecutive messages are equal.)
    const previous = (await failed.count()) > 0 ? (await failed.first().innerText()).trim() : null;

    await page.getByLabel('Paste the other wallet\'s code').fill(partnerCode);
    await page.getByRole('button', { name: cta, exact: true }).click();

    const deadline = Date.now() + 60_000;
    for (;;) {
        if (await paired.count() > 0) {
            return { ok: true, message: (await paired.first().innerText()).trim() };
        }
        if (await failed.count() > 0) {
            const text = (await failed.first().innerText()).trim();
            if (text !== previous) return { ok: false, message: text };
        }
        if (Date.now() > deadline) {
            throw new Error('the pairing form neither paired nor reported a new error within 60s');
        }
        await page.waitForTimeout(250);
    }
}

/** base64url -> the decoded pairing payload object. */
function decodePairingCode(code) {
    const body = code.startsWith(PAIR_PREFIX) ? code.slice(PAIR_PREFIX.length) : code;
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

test.describe('watcher/signer pairing lane (§20.5, )', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('two halves of one phrase pair, and everything else is refused', async ({ browser }) => {
        const watcher = await newDevice(browser);
        const signer = await newDevice(browser);
        const foreign = await newDevice(browser);

        try {
            /** @type {{ code: string, fingerprint: string }} */
            let watcherCode;
            /** @type {{ code: string, fingerprint: string }} */
            let signerCode;
            /** @type {{ code: string, fingerprint: string }} */
            let foreignCode;

            await test.step('build both halves of one recovery phrase, on two devices', async () => {
                watcherCode = await pairLaneToExchange(watcher.page, {
                    role: 'watcher', mnemonic: SHARED_MNEMONIC, name: 'Online Watcher',
                });
                signerCode = await pairLaneToExchange(signer.page, {
                    role: 'signer', mnemonic: SHARED_MNEMONIC, name: 'Cold Signer',
                });
            });

            await test.step('CONTROL: the two halves show the SAME key fingerprint', async () => {
                // The screen prints this so a user can eyeball the match before
                // trusting it, which makes it worth checking independently of
                // the verdict the wallet reaches below: if the fingerprints
                // agree, the two devices really did derive one account set.
                expect(watcherCode.fingerprint.length,
                    'the exchange screen showed no key fingerprint to compare')
                    .toBeGreaterThan(0);
                expect(watcherCode.fingerprint === signerCode.fingerprint,
                    'two wallets restored from the SAME recovery phrase printed DIFFERENT key '
                    + 'fingerprints, so the eyeball check the screen offers would tell a correctly '
                    + 'paired user their devices do not match')
                    .toBe(true);
            });

            await test.step(': the QR hand-off this lane exists for renders, and reassembles', async () => {
                // Everything else in this spec moves the pairing code as TEXT,
                // which is the one thing a real air-gapped pair cannot do: the
                // offline half shares no clipboard with the online one. The
                // screen's answer to that is a QR, and until  it was
                // never drawn - a default wallet has three mainnet chains and a
                // ~1900-character payload against MAX_QR_CHARS of 1200, so the
                // screen said "too many chains switched on for a single QR
                // code. Copy the text below instead" and offered no mechanism.
                //
                // NOW the long code goes out as an ANIMATED set of §20.3 XCW
                // chunks. So the assertion is no longer "one symbol decodes to
                // the code" - it is the thing a partner device actually does:
                // watch the display over time, decode each frame it catches,
                // and reassemble. Read off the LOADED <img> rather than by
                // re-fetching a data URL (the wallet ships a strict CSP, and
                // the painted pixels are what a camera sees).
                const code = watcherCode.code;
                const qrWrap = watcher.page.getByTestId('animated-qr-frames');
                await expect(qrWrap,
                    'the exchange screen drew no QR at all, so an air-gapped partner is left with '
                    + '"copy the text" across a gap that has no clipboard ')
                    .toBeVisible({ timeout: 30_000 });

                // A control on the fixture itself: the payload really is past
                // the single-frame threshold, so this step is exercising the
                // chunked path rather than passing on a small wallet.
                expect(code.length > 1200,
                    `this wallet's payload is only ${code.length} characters, inside the 1200 that fit `
                    + 'in one frame, so the multi-frame path was never entered and this step proves '
                    + 'nothing about ')
                    .toBe(true);
                await expect(watcher.page.getByText(/cycles through \d+ frames/),
                    'the code is too long for one frame but the screen never says it is animated, so '
                    + 'a user has no reason to hold the camera still')
                    .toBeVisible({ timeout: 30_000 });

                // Collect over time, exactly as a camera does. Each poll grabs
                // whatever frame is currently painted; duplicates are ignored
                // by the collector, and the loop ends when the set completes.
                const seen = new Map();
                const deadline = Date.now() + 60_000;
                while (Date.now() < deadline) {
                    const value = await watcher.page.evaluate(async () => {
                        if (typeof window.BarcodeDetector !== 'function') return { skipped: true };
                        const el = document.querySelector('[data-testid="animated-qr-frames"] img');
                        if (!el) return { missing: true };
                        if (!el.complete) await new Promise((r) => { el.onload = r; el.onerror = r; });
                        const bitmap = await createImageBitmap(el);
                        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                        const codes = await detector.detect(bitmap);
                        return { value: codes.length ? codes[0].rawValue : null };
                    });
                    expect(value.skipped, 'this browser has no BarcodeDetector, so no frame was read')
                        .toBeUndefined();
                    expect(value.missing, 'the QR image vanished between the wait and the read')
                        .toBeUndefined();
                    if (value.value) {
                        const m = /^XCW:(\d+)\/(\d+):/.exec(value.value);
                        // A single-frame code would arrive whole; either way,
                        // key by what identifies the frame.
                        seen.set(m ? m[1] : 'whole', value.value);
                        if (m && seen.size === Number(m[2])) break;
                    }
                    await watcher.page.waitForTimeout(120);
                }

                const frames = [...seen.entries()]
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([, v]) => v);
                expect(frames.length > 1,
                    `only ${frames.length} distinct frame(s) came off the screen in 60s for a `
                    + `${code.length}-character payload, so the display is not cycling and a partner `
                    + 'camera would wait forever')
                    .toBe(true);

                // Reassembled with the wallet's OWN collector, so this measures
                // the wire format rather than the spec's idea of it. Compared as
                // a boolean over the whole value: a dropped or re-ordered chunk
                // would still produce a plausible-looking string.
                let state = createXcwCollector();
                for (const frame of frames) state = addChunkToCollector(state, frame);
                expect(state.error, 'a frame read off the screen was rejected by the wallet\'s own collector')
                    .toBe(null);
                expect(state.complete,
                    `the frames on screen never completed a set (${state.receivedCount} of ${state.total}), `
                    + 'so a partner camera collects forever and the hand-off never finishes')
                    .toBe(true);
                expect(new TextDecoder().decode(state.psbt) === code,
                    'the frames reassemble, but to something other than the pairing code printed beside '
                    + 'them, so the two halves of the screen disagree about what is being handed over')
                    .toBe(true);
            });

            await test.step('PRIVACY: the code carries public material only', async () => {
                const payload = decodePairingCode(watcherCode.code);

                // Control first: prove the decode produced a REAL payload, so
                // the leak assertions below cannot pass on an empty object.
                expect(payload?.kind, 'the pairing code did not decode to a pairing payload')
                    .toBe('xcw-partner-pairing');
                expect(Array.isArray(payload.keys) && payload.keys.length > 0,
                    'the pairing code carries no keys, so it proves nothing about a shared seed')
                    .toBe(true);
                expect(payload.walletMode,
                    'the watcher device emitted a payload that does not say it is a watcher')
                    .toBe('watcher');
                expect(payload.keys.every((k) => typeof k.publicKey === 'string' && k.publicKey.length === 66),
                    'a key entry carries no 33-byte compressed public key')
                    .toBe(true);

                // No field outside the allow-list, at either level. The leak
                // that matters is a field nobody thought to look for.
                const strayTop = Object.keys(payload).filter((k) => !ALLOWED_PAYLOAD_FIELDS.includes(k));
                expect(strayTop,
                    'the pairing payload carries a field outside the published shape')
                    .toEqual([]);
                const strayKey = [...new Set(
                    payload.keys.flatMap((k) => Object.keys(k)).filter((k) => !ALLOWED_KEY_FIELDS.includes(k)),
                )];
                expect(strayKey,
                    'a pairing key entry carries a field outside the published shape')
                    .toEqual([]);

                // And no word of the phrase, as a whole word, anywhere in the
                // decoded payload or in the encoded code. Compared as booleans
                // and reported as a COUNT so a failure never prints a word.
                const haystack = `${JSON.stringify(payload)}\n${watcherCode.code}`.toLowerCase();
                const leaked = SHARED_MNEMONIC.split(' ')
                    .filter((word) => new RegExp(`\\b${word}\\b`).test(haystack)).length;
                expect(leaked,
                    'the pairing code contains word(s) of the recovery phrase. The exchange screen '
                    + 'promises "no recovery phrase, no private key, and nothing that can spend", and '
                    + 'this code is meant to travel by QR across an air gap')
                    .toBe(0);
            });

            await test.step('TEETH: a DIFFERENT recovery phrase is refused', async () => {
                // The failure this lane exists for. A foreign signer offers a
                // structurally perfect payload in the right role; only the
                // derived account keys disagree.
                foreignCode = await pairLaneToExchange(foreign.page, {
                    role: 'signer', mnemonic: FOREIGN_MNEMONIC, name: 'Wrong Phrase Signer',
                });
                expect(foreignCode.fingerprint === watcherCode.fingerprint,
                    'a wallet built from a DIFFERENT phrase printed the SAME key fingerprint')
                    .toBe(false);

                const res = await submitPartnerCode(watcher.page, {
                    partnerCode: foreignCode.code, cta: 'Pair a signer',
                });
                expect(res.ok,
                    'the watcher PAIRED with a signer restored from a different recovery phrase. '
                    + 'That is the exact failure this lane was built to catch, and the user finds '
                    + 'out instead when the signer cannot sign, after the air-gap round trip')
                    .toBe(false);
                expect(/different recovery phrases/i.test(res.message),
                    'the pairing was refused, but not with the seed-mismatch reason, so the user is '
                    + 'not told which of the two devices to re-enter their phrase on')
                    .toBe(true);
            });

            await test.step('TEETH: the right seed in the WRONG ROLE is refused', async () => {
                // Same seed, same fingerprint, both halves watchers: a pair
                // that would leave nobody able to sign. Only the mode says so.
                const res = await submitPartnerCode(watcher.page, {
                    partnerCode: watcherCode.code, cta: 'Pair a signer',
                });
                expect(res.ok,
                    'a watcher paired with ANOTHER watcher, so both halves of the "air-gapped pair" '
                    + 'build transactions and neither one signs them')
                    .toBe(false);
                expect(/must be in signer mode/i.test(res.message),
                    'the wrong-role pairing was refused without naming the role that is missing')
                    .toBe(true);
            });

            await test.step('AND IT IS NOT STICKY: the genuine partner still pairs', async () => {
                // Re-run the positive last. If the two refusals left the form
                // failing shut, they measured that rather than the payloads -
                // and a correctly-set-up user would be told their devices do
                // not match.
                const res = await submitPartnerCode(watcher.page, {
                    partnerCode: signerCode.code, cta: 'Pair a signer',
                });
                expect(res.ok,
                    'the genuine signer half was refused after two failed attempts, so the form is '
                    + 'sticky and its verdicts cannot be trusted in sequence')
                    .toBe(true);
                expect(/same recovery phrase/i.test(res.message),
                    'the success screen does not confirm the two halves share a phrase')
                    .toBe(true);
                await expect(watcher.page.getByText(/^Matching chains:/),
                    'the paired screen names no matching chains, so nothing says WHAT was compared')
                    .toBeVisible({ timeout: 30_000 });
            });

            await test.step('and the other half pairs back', async () => {
                // Both devices have to end up paired for the pair to be usable;
                // testing only one direction leaves the signer unaware of its
                // watcher.
                const res = await submitPartnerCode(signer.page, {
                    partnerCode: watcherCode.code, cta: 'Pair a watcher',
                });
                expect(res.ok,
                    'the signer half refused the watcher it had just been paired WITH, so the lane '
                    + 'only works in one direction')
                    .toBe(true);
            });
        } finally {
            await Promise.all([
                watcher.context.close(), signer.context.close(), foreign.context.close(),
            ].map((p) => p.catch(() => {})));
        }
    });

    test(': the partner collects the animated code off a CAMERA and pairs', async ({ browser }) => {
        // The test above proves the frames on the watcher's screen reassemble to
        // its code. This one closes the loop the lane exists for: the code moves
        // from one device to the other by CAMERA ONLY - no clipboard, no paste,
        // no file - and the receiving device ends up paired.
        //
        // The frames come from the wallet's own `encodeXcwChunks` over the code
        // the watcher really emitted, so the video the signer's camera plays is
        // the same sequence the watcher's display cycles through.
        const watcher = await newDevice(browser);
        /** @type {import('@playwright/test').Browser | null} */
        let cameraBrowser = null;
        try {
            const watcherCode = await pairLaneToExchange(watcher.page, {
                role: 'watcher', mnemonic: SHARED_MNEMONIC, name: 'Online Watcher',
            });

            const frames = encodeXcwChunks(new TextEncoder().encode(watcherCode.code));
            expect(frames.length > 1,
                'this wallet\'s pairing code fits in one frame, so the camera hand-off under test '
                + 'is not the multi-frame one  is about')
                .toBe(true);

            cameraBrowser = await launchWithQrCamera(frames);
            const context = await cameraBrowser.newContext({ permissions: ['camera'] });
            await context.addInitScript(
                ([atKey, versionKey, version]) => {
                    try {
                        window.localStorage.setItem(atKey, new Date().toISOString());
                        window.localStorage.setItem(versionKey, version);
                    } catch { /* the gate renders and the spec fails loudly */ }
                },
                [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
            );
            const page = await context.newPage();
            await pairLaneToExchange(page, {
                role: 'signer', mnemonic: SHARED_MNEMONIC, name: 'Cold Signer', url: BASE_URL,
            });

            await page.getByRole('button', { name: 'Scan the other wallet\'s QR' }).click();

            // The progress line is the only feedback that a capture is running
            // rather than stalled, and it is also the proof that more than one
            // frame was collected: a single-frame path fills the box without
            // ever showing it.
            await expect(page.getByText(/Pairing frames received: \d+ of \d+/),
                'the screen never reported multi-frame progress, so either the camera saw nothing or '
                + 'the collector was bypassed')
                .toBeVisible({ timeout: 60_000 });

            const box = page.getByLabel('Paste the other wallet\'s code');
            await expect.poll(async () => (await box.inputValue()).length, {
                timeout: 180_000,
                message: 'the capture never completed: the partner-code box stayed empty while the '
                    + 'camera played every frame',
            }).toBeGreaterThan(0);

            // Boolean, on the whole value, and never interpolated: a reassembly
            // that dropped or re-ordered a chunk would still look plausible.
            expect((await box.inputValue()).trim() === watcherCode.code,
                'the frames were collected but what landed in the box is not the code they encoded, '
                + 'so the reassembly dropped, duplicated or re-ordered a chunk')
                .toBe(true);

            // And the point of all of it: a device that has only ever SEEN the
            // other one pairs with it.
            const res = await submitPartnerCode(page, {
                partnerCode: (await box.inputValue()).trim(), cta: 'Pair a watcher',
            });
            expect(res.ok,
                'the code arrived intact over the camera and the pairing was still refused, so the '
                + 'transport is sound but the lane cannot finish on it')
                .toBe(true);
        } finally {
            await watcher.context.close().catch(() => {});
            if (cameraBrowser) await cameraBrowser.close().catch(() => {});
        }
    });
});
