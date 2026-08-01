// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Addresses": SECRET REVEAL - the one surface in the
// wallet whose whole job is to hand over a spending key, and the only ⬜ on that
// line where a defect is unrecoverable rather than merely annoying.
//
// FOUR THINGS THAT CAN BE WRONG HERE, and none of them is visible without
// driving it:
//   1. The key is in the DOM before the user has agreed to see it. Everything
//      else on this screen is a warning ABOUT a key that is, in that case,
//      already there.
//   2. The revealed key is not this address's key. A screen that shows A's
//      address beside B's key looks completely correct, and the only way to
//      catch it is to derive the address back from the key independently.
//   3. Hide does not hide.
//   4. The blur auto-hide (§17.7.1) is not wired. It is the control that covers
//      the case the warning list explicitly raises - screen-sharing - and a
//      listener that quietly stops firing looks identical to one that works
//      until the moment it matters.
//
// HOW THIS SPEC HANDLES THE KEY ITSELF, and it is a real constraint rather than
// a note: a spec that asserts ON a secret can leak it into the run's own output.
// Every assertion touching key material is therefore reduced to a BOOLEAN
// before it reaches `expect`, and no message interpolates the value. That is
// why several assertions below read `expect(someBool).toBe(true)` where a
// `toContain` would have been more natural: a failing `toContain` prints both
// sides, and one of those sides is a private key.
//
// No chain interaction and no funding: this is a vault + UI surface, and the
// address it reveals does not need to hold anything.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/addresses/secret-reveal.regtest.spec.js

import bitcoin from 'bitcoinjs-lib';
import wifCodec from 'wif';
import * as ecc from 'tiny-secp256k1';

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    selectVenueChain,
    switchToRegtest,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Does this WIF control this address, on any of the encodings the wallet
 * derives?
 *
 * Returns a BOOLEAN and never the key, so a failed assertion can print the
 * verdict without printing the secret. The regtest networks share Bitcoin
 * testnet's version bytes for base58, which is what lets one network object
 * cover all three venues (campaign §3.5, point 3); bech32 differs by prefix, so
 * the p2wpkh check is done against the address's own human-readable part.
 */
function wifControlsAddress(wif, address) {
    let decoded;
    try {
        decoded = wifCodec.decode(wif);
    } catch {
        return false;
    }
    // bitcoinjs-lib v6 dropped ECPair, so the pubkey comes off the curve
    // directly rather than through another dependency.
    const point = ecc.pointFromScalar(decoded.privateKey, decoded.compressed);
    if (!point) return false;
    const pub = Buffer.from(point);

    const testnet = bitcoin.networks.testnet;
    const candidates = [];
    try {
        candidates.push(bitcoin.payments.p2pkh({ pubkey: pub, network: testnet }).address);
    } catch { /* not this shape */ }
    try {
        candidates.push(bitcoin.payments.p2wpkh({ pubkey: pub, network: testnet }).address);
    } catch { /* not this shape */ }
    try {
        const hrp = String(address).includes('1') ? String(address).split('1')[0] : null;
        if (hrp) {
            candidates.push(bitcoin.payments.p2wpkh({
                pubkey: pub, network: { ...testnet, bech32: hrp },
            }).address);
        }
    } catch { /* not a bech32 address */ }
    try {
        candidates.push(bitcoin.payments.p2sh({
            redeem: bitcoin.payments.p2wpkh({ pubkey: pub, network: testnet }),
            network: testnet,
        }).address);
    } catch { /* not this shape */ }

    return candidates.filter(Boolean).includes(String(address));
}

/** The revealed key element, which only exists once the user has agreed. */
const wifCode = (page) => page.getByRole('main').locator('code').filter({ hasText: /^[5KLc9]/ });

test.describe('revealing an address private key', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('is gated, correct, hideable, and hides itself when the window blurs',
        async ({ page }) => {
            let address;

            await test.step('open the Secret screen for a real address', async () => {
                await createWallet(page, { password: PASSWORD, name: 'Secret Holder' });
                await switchToRegtest(page, PASSWORD);

                // The venue address is read off a FORM rather than picked out of
                // the address list: the list carries every chain's addresses at
                // once, and on these venues the legacy prefixes overlap (§3.5,
                // point 3), so "the row that looks like this chain's" is
                // ambiguous by construction. With the address in hand the row is
                // addressed by its exact accessible name.
                await gotoPalette(page, 'Issue token');
                const form = page.getByRole('main');
                await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
                await selectVenueChain(form);
                address = await form.getByLabel('From').inputValue();
                expect(address, `no ${REGTEST_CHAIN_LABEL} address in this wallet`)
                    .toMatch(REGTEST_ADDRESS_RE);

                await gotoPalette(page, 'Addresses');
                const main = page.getByRole('main');
                const row = main.getByRole('button', { name: `View address ${address}` });
                await expect(row, 'the address list has no row for this venue address')
                    .toBeVisible({ timeout: 30_000 });
                await row.click();

                const detail = page.getByRole('main');
                const secret = detail.getByRole('button', { name: 'Secret' });
                await expect(secret, 'the address detail offers no Secret affordance')
                    .toBeVisible({ timeout: 30_000 });
                await expect(secret, 'the Secret affordance is disabled on an ordinary HD address')
                    .toBeEnabled();
                await secret.click();
            });

            await test.step('the warning stands BETWEEN the user and the key', async () => {
                const main = page.getByRole('main');
                await expect(main.getByRole('heading', { name: 'Before you continue' }),
                    'the Secret screen went straight to the key with no warning stage')
                    .toBeVisible({ timeout: 30_000 });

                // The warning that the auto-hide below exists to back up.
                await expect(main, 'the warning does not raise screen-sharing, which is the case '
                    + 'the blur auto-hide is for')
                    .toContainText(/screen-sharing or recording/i);
                await expect(main, 'the warning does not say what having the key means')
                    .toContainText(/anyone with it can spend/i);

                // THE ASSERTION THIS STEP EXISTS FOR: nothing key-shaped is in
                // the DOM yet. A warning about a key that is already rendered
                // is decoration.
                await expect(wifCode(page),
                    'a key-shaped string is already in the DOM on the warning screen, before the '
                    + 'user has agreed to see anything')
                    .toHaveCount(0);

            });

            await test.step('the revealed key really controls THIS address', async () => {
                const main = page.getByRole('main');
                await main.getByRole('button', { name: 'I understand, show key' }).click();

                const code = wifCode(page);
                await expect(code, 'no key appeared after agreeing to the warning')
                    .toBeVisible({ timeout: 60_000 });

                // From here on the key is held in a local and never printed.
                const wif = (await code.textContent() || '').trim();
                expect(wif.length > 40 && wif.length < 60,
                    'the revealed string is not the length of a WIF').toBe(true);

                // The screen must still be about the address it was opened
                // from: the pair checked below is only meaningful if the user is
                // looking at that pair. Matched on the ABBREVIATED form the
                // screen actually renders (`rltc1q…jpqld3`), which is also all a
                // user has to compare against - so this asserts what they can
                // actually check, not what is in the DOM behind it.
                const screen = await main.innerText();
                const onScreen = screen.includes(address.slice(0, 6))
                    && screen.includes(address.slice(-6));
                expect(onScreen,
                    'the reveal screen no longer names the address it was opened from')
                    .toBe(true);

                // The check that a screenshot cannot make: derive the address
                // BACK from the key. A wallet handing out the wrong address's
                // key looks perfectly correct until someone does this.
                expect(wifControlsAddress(wif, address),
                    'the revealed private key does not derive the address it is shown beside, on '
                    + 'any encoding this wallet uses. Verdict only: the key is deliberately not '
                    + 'printed here')
                    .toBe(true);
            });

            await test.step('Hide hides it, and the blur auto-hide is wired', async () => {
                const main = page.getByRole('main');

                await main.getByRole('button', { name: 'Hide', exact: true }).click();
                await expect(wifCode(page), 'Hide left the key on screen')
                    .toHaveCount(0);
                await expect(main.getByRole('button', { name: /Tap to reveal/ }),
                    'hiding the key left no way to bring it back')
                    .toBeVisible({ timeout: 15_000 });

                await main.getByRole('button', { name: /Tap to reveal/ }).click();
                await expect(wifCode(page), 'the key did not come back within the session')
                    .toBeVisible({ timeout: 15_000 });

                // §17.7.1's auto-hide. Dispatched rather than produced by a real
                // OS focus change, and the distinction is worth stating: this
                // proves the LISTENER is wired and wipes the reveal, not that
                // every platform's blur reaches it. A listener that is silently
                // removed - the regression this guards - fails here.
                await page.evaluate(() => window.dispatchEvent(new Event('blur')));
                await expect(wifCode(page),
                    'the window blurred and the private key stayed on screen, which is the '
                    + 'screen-sharing case the warning list raises by name')
                    .toHaveCount(0, { timeout: 15_000 });
            });
        });
});
