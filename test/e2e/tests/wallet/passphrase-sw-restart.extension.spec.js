// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.6 AT6, driven in a real packaged MV3 extension:
//
//   with a passphrase wallet unlocked in the extension, the service worker is
//   terminated; the next popup open signs without any prompt. The session slot
//   holds the password only.
//
// WHY THIS SPEC EXISTS SEPARATELY FROM THE REGTEST ONE. Every other §15.6
// acceptance test runs in the web preview, and the web shell has no service
// worker to lose: `packages/web/src/hostBridge.js` builds a background host per
// page, which lives exactly as long as the page. The claim AT6 makes is about a
// host that VANISHES under a still-unlocked wallet, so it is only expressible
// where such a host exists. That is the MV3 background, and that is this venue.
//
// THE PART THAT IS EASY TO FAKE, AND WHAT IS DONE ABOUT IT
//
// A test can call a helper named `killServiceWorker`, watch a worker keep
// running, and pass anyway, because nothing downstream depends on the kill
// having happened. That test is worse than no test: it retires the question. So
// the eviction here is PROVEN before a single signing assertion runs. A global
// is written into the live worker's scope and read back; after the kill, the
// worker is asked for it again and must no longer have it, because a global is
// a property of a JS REALM and a realm does not survive its worker.
//
// TWO SIGNALS THAT LOOK LIKE PROOF AND ARE NOT, both measured here on
// 2026-09-03 rather than assumed:
//
//   - Playwright's `close` event on the worker. It does NOT fire when the MV3
//     worker is stopped; in a probe it stayed silent through three separate
//     `stopAllWorkers` calls and 30s of waiting, and only fired when the browser
//     context itself tore down at end of test. A spec that waits for `close`
//     fails on a kill that worked.
//   - The worker's object identity. `context.serviceWorkers()` keeps returning
//     the SAME Playwright handle across the restart, so `after !== before` is
//     never true and would fail on a kill that worked too.
//
// The realm check is the one that tracks reality: in that same probe the stamp
// was readable as 'alive' before the kill and null one second after it.
//
// AND THE ABSENCE IS CROSS-CHECKED, because "evaluate returned null" has a
// second possible cause: an evaluation that never reached the worker at all.
// So the same round trip that reports the missing stamp also carries a value
// back out. A reply that arrives proves the channel is live; a missing stamp on
// a live channel proves the realm is new.
//
// AND IT ENDS ON A CONFIRMED TRANSACTION, for the reason the regtest spec's
// header gives at length: an unlocked shell proves nothing about signing. The
// defect this spec pins showed up ONLY as a permanently disabled Approve on a
// wallet that looked entirely healthy. Here that defect has a second way in:
// the re-pooled signer is built from whatever the session slot holds, so a slot
// that lost the wallet's identity produces a wallet that opens, renders, and
// cannot spend its own coins.
//
// NOTHING HERE PRINTS KEY MATERIAL. The password and the passphrase are
// compared as booleans, never interpolated into an assertion message.
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RDOGE XC_REGTEST_SSH_HOST=<regtest-host> \
//       npx playwright test --config=playwright.extension.config.js \
//       tests/wallet/passphrase-sw-restart.extension.spec.js
//   The config's global setup builds `packages/extension` itself; the venue
//   must be reachable or that setup fails loudly before any test runs.

import { createWallet, gotoSection, mainButton, unlockedShell } from '../../fixtures/wallet.js';
import {
    expect, killServiceWorker, test, waitForServiceWorker,
} from '../../fixtures/extension.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    expectConfirmModal,
    fundAddress,
    readReceiveAddress,
    selectVenueSendAsset,
    switchToRegtest,
    waitForConfirmedUtxo,
} from '../../fixtures/regtest.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
// Imported rather than retyped: the slot's key is the one string this spec and
// the background must agree on, and a copy of it here would go stale silently
// the first time the background renamed it, leaving a test that reads an empty
// slot and calls that "the password only".
import { SIGNING_SECRET_SESSION_KEY } from '../../../../packages/extension/src/background/signingSecretSession.js';

const PASSWORD = 'extpassword1234';
/** The 25th word, typed once on the create screen and never again. */
const PASSPHRASE = 'a-passphrase-typed-once-at-setup';

const FUNDING = 1;
const SEND_AMOUNT = '0.01';

/**
 * The global this spec writes into the worker's scope before killing it.
 *
 * Its absence afterwards is the evidence that the JS realm was destroyed rather
 * than merely disconnected from Playwright.
 */
const STAMP = '__xcAt6WorkerStamp';

/**
 * The same locator the regtest spec uses for "is the wallet asking for the
 * passphrase". `exact` matters: the create screen labels its own field "BIP39
 * passphrase", and an inexact match would find that one too.
 */
function passphraseField(page) {
    return page.getByLabel('Passphrase', { exact: true });
}

/**
 * Reads the signing-secret session slot out of the worker that owns it.
 *
 * Read from inside the worker rather than from a popup on purpose:
 * `chrome.storage.session` is not page-accessible by default, and a read that
 * happened to work from a page would be reporting on a different slot than the
 * one `ensureHost` re-pools from.
 *
 * Returns the decoded slot text, or null when the slot is empty. The value is
 * returned rather than asserted on here so that no assertion message in this
 * file can end up holding it.
 */
async function readSigningSlot(worker) {
    const encoded = await worker.evaluate(
        async (key) => {
            const got = await chrome.storage.session.get(key);
            const value = got?.[key];
            return typeof value === 'string' ? value : null;
        },
        SIGNING_SECRET_SESSION_KEY,
    );
    // The backend base64s its bytes on the way into chrome.storage (see
    // ChromeStorageBackend), so this is the inverse of one hop, not a decrypt:
    // the slot is deliberately plaintext-in-memory and its contents are exactly
    // what this test is here to bound.
    return encoded === null ? null : Buffer.from(encoded, 'base64').toString('utf8');
}

test.describe('a stored-passphrase wallet survives an MV3 worker eviction (§15.6 AT6)', () => {
    test.setTimeout(900_000);

    test('the worker is terminated, the next popup opens unlocked, and it signs with no prompt',
        async ({ context, page, extensionId }) => {
            /** @type {string} */
            let address;

            await test.step('a wallet created WITH a passphrase, funded on the venue chain', async () => {
                await createWallet(page, {
                    password: PASSWORD,
                    name: 'SW Restart Passphrase Wallet',
                    bip39Passphrase: PASSPHRASE,
                    navigate: false,
                });
                await switchToRegtest(page, PASSWORD);
                address = await readReceiveAddress(page);
                expect(address, 'Receive never reached a venue-chain address')
                    .toMatch(REGTEST_ADDRESS_RE);
                await fundAddress(address, FUNDING);
            });

            const before = await waitForServiceWorker(context);

            await test.step('the session slot already holds the password ALONE, before any restart',
                async () => {
                    // Asserted here as well as after the restart because the two
                    // say different things. Here: the unlock did not cache the
                    // passphrase in the first place. After: the restart did not
                    // put one back.
                    const slot = await readSigningSlot(before);
                    expect(slot !== null && slot.length > 0,
                        'the signing-secret session slot is empty on an unlocked wallet, so there '
                        + 'is nothing for the worker to re-pool from and the restart below would '
                        + 'pass for the wrong reason')
                        .toBe(true);
                    expect(slot.charCodeAt(0) === 0,
                        'the slot took the legacy credentials-marker shape, which carries a '
                        + 'passphrase in session storage alongside the password, and no shipped '
                        + 'caller writes that shape any more')
                        .toBe(false);
                    expect(slot === PASSWORD,
                        'the slot does not hold the wallet password alone')
                        .toBe(true);
                });

            await test.step('EVICT: the worker is stamped, then really terminated', async () => {
                await before.evaluate((key) => { globalThis[key] = 'alive'; }, STAMP);
                expect(await before.evaluate((key) => globalThis[key] ?? null, STAMP),
                    'the stamp did not take, so its absence after the kill would prove nothing and '
                    + 'this spec would be measuring its own broken instrument')
                    .toBe('alive');

                // Killed with the popup still open, which is the arrangement
                // measured to work. The popup is closed immediately afterwards
                // so that the signing lane below runs on a genuinely new window.
                await killServiceWorker(context, page);

                // Both halves come back on ONE round trip so they cannot
                // disagree: `echo` says the channel reached a live realm, and
                // `stamp` says which realm it reached.
                await expect
                    .poll(
                        async () => {
                            const [sw] = context.serviceWorkers();
                            if (!sw) return 'no worker running';
                            try {
                                const r = await sw.evaluate(
                                    (key) => ({ echo: 'reachable', stamp: globalThis[key] ?? null }),
                                    STAMP,
                                );
                                if (r.echo !== 'reachable') return 'the worker answered nothing';
                                return r.stamp === null ? 'new realm' : 'same realm';
                            } catch {
                                // Mid-teardown the handle refuses evaluation.
                                // That is a terminating worker, not a verdict.
                                return 'unevaluable';
                            }
                        },
                        {
                            timeout: 60_000,
                            message:
                                'the service worker kept the global this test wrote before the '
                                + 'kill, so `ServiceWorker.stopAllWorkers` evicted NOTHING. Every '
                                + 'assertion below would then be describing a worker that never '
                                + 'restarted, which is the one outcome this spec must never report '
                                + 'as a pass',
                        },
                    )
                    .toBe('new realm');
            });

            /** @type {import('@playwright/test').Page} */
            let reopened;

            await test.step('the next popup open finds no prompt at all', async () => {
                await page.close();
                reopened = await context.newPage();
                await reopened.goto(`chrome-extension://${extensionId}/popup.html`);

                // "Without any prompt" is the whole claim, and it has two halves
                // that fail for different reasons. A password prompt means the
                // session master key did not survive the restart; a passphrase
                // prompt means the stored 25th word is not being used.
                await expect(unlockedShell(reopened),
                    'the reopened popup is not unlocked. The session master key did not survive '
                    + 'the worker restart, so the user is asked to type their password again every '
                    + 'time Chrome reclaims an idle worker')
                    .toBeVisible({ timeout: kdfStepTimeout() });
                await expect(reopened.getByRole('button', { name: 'Unlock Wallet' }),
                    'the reopened popup is showing an unlock form')
                    .toHaveCount(0);
                await expect(passphraseField(reopened),
                    'the reopened popup is asking for the passphrase, which is exactly the prompt '
                    + 'storing it at setup removed, reappearing at the one moment the '
                    + 'user cannot predict')
                    .toHaveCount(0);
            });

            await test.step('and it signs a transaction the CHAIN accepts', async () => {
                await gotoSection(reopened, 'Send');
                await selectVenueSendAsset(reopened);
                await reopened.getByLabel('To', { exact: true }).fill(address);
                await reopened.getByRole('textbox', { name: /^Amount/ }).fill(SEND_AMOUNT);
                await mainButton(reopened, 'Send').click();

                await expectConfirmModal(reopened, 'a self-send after a worker eviction', 90_000);
                await expect(reopened.getByTestId('confirm-chain-badge'))
                    .toHaveText(REGTEST_CHAIN_LABEL);
                await expect(passphraseField(reopened),
                    'the confirm screen is asking for the passphrase, so signing after a worker '
                    + 'restart still depends on a secret the user was told they would never type '
                    + 'again')
                    .toHaveCount(0);
                await expect(reopened.getByTestId('confirm-approve'),
                    'the wallet composed a payment it cannot approve. The restarted worker holds '
                    + 'no signer for this wallet\'s own address, which is what re-pooling WITHOUT '
                    + 'the stored passphrase looks like on screen')
                    .toBeEnabled({ timeout: 120_000 });
                await reopened.getByTestId('confirm-approve').click();

                await expect(reopened.getByRole('heading', { name: 'Broadcast pending' }),
                    'the wallet approved a payment that never reached the node')
                    .toBeVisible({ timeout: 180_000 });
                const txid = (await reopened.getByRole('main').innerText()).match(/[0-9a-f]{64}/)?.[0];
                expect(txid, 'the success screen showed no transaction id').toBeTruthy();

                // The wallet reporting on itself is not enough: a transaction
                // signed with the wrong key never reaches a block.
                const utxo = await waitForConfirmedUtxo(address, txid);
                expect(Number(utxo.amount)).toBeCloseTo(Number(SEND_AMOUNT), 8);
            });

            await test.step('and the slot STILL holds the password only', async () => {
                const after = await waitForServiceWorker(context);
                const slot = await readSigningSlot(after);
                expect(slot !== null && slot.length > 0,
                    'the signing-secret slot is empty after a restart that signed successfully, so '
                    + 'the next restart has nothing to re-pool from')
                    .toBe(true);
                expect(slot.charCodeAt(0) === 0,
                    'the restart rewrote the slot in the legacy credentials-marker shape, putting '
                    + 'the passphrase back into session storage')
                    .toBe(false);
                expect(slot.includes(PASSPHRASE),
                    'the passphrase is present in the signing-secret session slot')
                    .toBe(false);
                expect(slot === PASSWORD,
                    'the slot does not hold the wallet password alone after the restart')
                    .toBe(true);
            });
        });
});
