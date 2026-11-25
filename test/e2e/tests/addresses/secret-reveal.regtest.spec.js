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
// The page (operator ruling, simplified View Private Key): the address, one
// never-share danger notice, the wallet password and I Understand on one form.
// The key shows at once after the password; there is no separate reveal tap
// and no Hide, and the back arrow, a window blur or the timeout wipes it.
//
// FOUR THINGS THAT CAN BE WRONG HERE, and none of them is visible without
// driving it:
//   1. The key is in the DOM before the user has agreed to see it. Everything
//      else on this screen is a warning ABOUT a key that is, in that case,
//      already there.
//   2. Export skips the wallet-password confirmation.
//   3. The revealed key is not this address's key. A screen that shows A's
//      address beside B's key looks completely correct, and the only way to
//      catch it is to derive the address back from the key independently.
//   4. The blur auto-wipe (§17.7.1) is not wired. It covers accidental
//      exposure during screen sharing, and a listener that quietly stops
//      firing looks identical to one that works until the moment it matters.
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
import { decode as decodeWif } from 'wif';
import { secp256k1 } from '@noble/curves/secp256k1';

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    readFromAddress,
    switchToRegtest,
} from '../../fixtures/regtest.js';
import { fieldByLabel } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';

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
        decoded = decodeWif(wif);
    } catch {
        return false;
    }
    // bitcoinjs-lib v6 dropped ECPair, so the pubkey comes off the curve
    // directly rather than through another dependency.
    let point;
    try {
        point = secp256k1.getPublicKey(decoded.privateKey, decoded.compressed);
    } catch {
        return false;
    }
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

/** The read-only Private key field, which only exists once the user has agreed. */
const wifField = (page) => page.getByRole('main').getByRole('textbox', { name: 'Private key', exact: true });

/**
 * Is anything key-shaped in the page, as text or as a field value? A BOOLEAN,
 * so a failure never prints the key.
 */
async function keyShapedInDom(page) {
    return page.getByRole('main').evaluate((root) => {
        const wifRe = /\b[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}\b/;
        if (wifRe.test(root.innerText || '')) return true;
        return [...root.querySelectorAll('input, textarea')].some((el) => wifRe.test(el.value || ''));
    });
}

test.describe('revealing an address private key', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('is gated, correct, and wipes itself when the window blurs',
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
                await openPaletteCommand(page, 'Issue token');
                const form = page.getByRole('main');
                await expect(fieldByLabel(form, 'Ticker')).toBeVisible({ timeout: 30_000 });
                address = await readFromAddress(form);
                expect(address, `no ${REGTEST_CHAIN_LABEL} address in this wallet`)
                    .toMatch(REGTEST_ADDRESS_RE);

                await openPaletteCommand(page, 'Addresses');
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
                await expect(main.getByRole('form', { name: 'Before you continue' }),
                    'the Secret screen went straight to the key with no warning stage')
                    .toBeVisible({ timeout: 30_000 });

                // The one danger notice: never share the key, and what holding
                // it means.
                await expect(main, 'the warning does not say never to share the key')
                    .toContainText(/never share this private key/i);
                await expect(main, 'the warning does not say what having the key means')
                    .toContainText(/anyone with it can spend/i);

                // THE ASSERTION THIS STEP EXISTS FOR: nothing key-shaped is in
                // the DOM yet. A warning about a key that is already rendered
                // is decoration.
                await expect(wifField(page),
                    'the Private key field is already on the warning screen, before the user has '
                    + 'agreed to see anything')
                    .toHaveCount(0);
                expect(await keyShapedInDom(page),
                    'a key-shaped string is already in the DOM on the warning screen, before the '
                    + 'user has agreed to see anything')
                    .toBe(false);
            });

            await test.step('the revealed key really controls THIS address', async () => {
                const main = page.getByRole('main');
                // The label carries a help tip button named after it (U57), so
                // the field is found by its textbox role.
                const password = main.getByRole('textbox', { name: 'Wallet password', exact: true });
                await expect(password, 'private-key export did not request the wallet password')
                    .toBeVisible();
                const agree = main.getByRole('button', { name: 'I Understand' });

                // I Understand with no password exports nothing: the field is
                // marked and the key stays out of the DOM.
                await agree.click();
                await expect(main, 'I Understand with an empty password did not ask for it')
                    .toContainText('Enter your wallet password.');
                await expect(wifField(page),
                    'the private key showed without the wallet password')
                    .toHaveCount(0);

                await password.fill(PASSWORD);
                await agree.click();

                const field = wifField(page);
                await expect(field, 'no key appeared after the password and I Understand')
                    .toBeVisible({ timeout: 60_000 });

                // From here on the key is held in a local and never printed.
                const wif = (await field.inputValue() || '').trim();
                expect(wif.length > 40 && wif.length < 60,
                    'the revealed string is not the length of a WIF').toBe(true);

                // The screen must still be about the address it was opened
                // from: the pair checked below is only meaningful if the user is
                // looking at that pair. The screen shows it whole, in a
                // read-only Address field above the key (a field value, which
                // innerText does not carry), so the field is read and compared
                // in full.
                const shownAddress = main.getByRole('textbox', { name: 'Address', exact: true });
                expect(await shownAddress.inputValue().catch(() => '') === address,
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

            await test.step('the blur auto-wipe is wired', async () => {
                const main = page.getByRole('main');

                // §17.7.1's auto-wipe. Dispatched rather than produced by a real
                // OS focus change, and the distinction is worth stating: this
                // proves the LISTENER is wired and wipes the reveal, not that
                // every platform's blur reaches it. A listener that is silently
                // removed - the regression this guards - fails here.
                await page.evaluate(() => window.dispatchEvent(new Event('blur')));
                await expect(wifField(page),
                    'the window blurred and the private key stayed on screen, which is the '
                    + 'screen-sharing case the auto-wipe covers')
                    .toHaveCount(0, { timeout: 15_000 });
                expect(await keyShapedInDom(page),
                    'a key-shaped string stayed in the DOM after the window blurred')
                    .toBe(false);

                // The wipe returns to the warning form with the password
                // cleared, so seeing the key again costs the password again.
                await expect(main.getByRole('form', { name: 'Before you continue' }),
                    'the blur wipe did not return to the warning form')
                    .toBeVisible({ timeout: 15_000 });
                await expect(main.getByRole('textbox', { name: 'Wallet password', exact: true }),
                    'the blur wipe left the wallet password filled in')
                    .toHaveValue('');
            });
        });
});
