// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// THE BROWSER PROOF FOR THE SILENT KEY-REQUEST BUTTON: pressing the message
// key-request button on a wallet with no ready signer must SAY something, and
// must say something the user can act on.
//
// The defect this pins was not a wrong answer, it was no answer. Every failure
// of "Request encrypted session (publish your key)" was written into
// `submitError`, which the compose FORM stage renders nowhere at all (only the
// review stage and the hardware branch do), so the button did nothing, forever,
// with no way to learn why. The not-ready-signer branch was worse than silent:
// it said "Enter your password to send the key request" on a stage that has no
// password field, because the send path collects the password on the review
// screen and a key request never reaches one.
//
// WHY THIS FILE EXISTS ALONGSIDE THE UNIT TEST. The unit test
// (`test/unit/components/composeMessageHandshakeErrors.test.jsx`) renders the
// real component with a stubbed `signerReady`. That proves the component, and
// it is deliberately not enough here: the whole defect was in what reaches a
// SCREEN in a running shell, and the not-ready state itself was reached in the
// unit test by asserting it rather than by producing it. This file produces it.
//
// HOW THE NOT-READY STATE IS REACHED, and it is a real user, not a fault
// injection. `SignerPool.populate` deliberately SKIPS a 25th-word passphrase
// wallet (`if (w.passphraseEnabled && !bip39Passphrase) continue;`) and no
// unlock path in either shell carries a passphrase, so such a wallet runs
// unlocked in the UI with NO pre-unlocked signer. `useSignerReady` therefore
// reads false on a wallet that is working normally. That is the exact shape of
// the state the defect was found in (an empty pool under a live session), it is
// deterministic, and it needs no chain.
//
// The LOCK/UNLOCK in the first test is load-bearing and cost this file a red
// run to learn: CREATION holds the passphrase in scope and pools a signer with
// it, so a freshly created passphrase wallet can still sign and the press sails
// straight past the branch under test. Only from the next unlock onward - which
// takes the password alone - is the pool empty. So the state under test is not
// the first minute of a wallet's life, it is all the rest of it.
//
// WHY THE DEV-MOCK VENUE IS THE RIGHT ONE, and this is the point most likely to
// be second-guessed later. The branch under test returns BEFORE any signing,
// composing or broadcasting happens: it is a refusal, not an attempt. So this
// needs a browser and a real wallet, and it does not need a chain. The regtest
// sibling (`handshake-and-methods.regtest.spec.js`) drives the OTHER half - a
// key request that really goes out - and is blocked on a separate defect one
// layer down where `handshakeAction` composes with no change address at all.
// Pinning this half to that venue would park a proof that is available today
// behind a fix that is not.
//
// WHAT WOULD BE FALSE IF THIS PASSED VACUOUSLY. Four things, each guarded:
//   - "an error is shown" would pass on the missing-key banner itself, which is
//     a `role="alert"` on screen BEFORE the button is pressed. `pressOutcome`
//     reads only the banner's DESCENDANTS, which is where the key request's own
//     answer renders, and the pre-press state is asserted to carry no failure.
//   - "something appeared" would pass instantly on the fee readout further down
//     the form, which is a permanent `role="status"`. Same scoping answers it,
//     and it matters more than it looks: an outcome wait that passes at once
//     leaves every assertion after it racing an async handler. This file was
//     briefly red for exactly that reason.
//   - "the button was reachable" would pass while the lookup was still in
//     flight. The handshake button only exists inside the settled `missing`
//     banner, so waiting for the button IS waiting for the settled state.
//   - "the wallet had no ready signer" would pass on a wallet that simply had
//     no addresses, since `handleRequestSession` also returns early with no
//     message when there is no source address. The control case at the bottom
//     presses the same button on an ORDINARY wallet built by the same walk and
//     requires it NOT to answer with the not-ready sentence, so a wallet that
//     was broken in some other way could not produce this file's green.
//
// RUN IT:
//   npx playwright test --config test/e2e/playwright.config.js \
//       tests/messaging/key-request-error.spec.js

import {
    createWallet, expect, gotoSection, lockWallet, test, unlockWallet,
} from '../../fixtures/wallet.js';

const PASSWORD = 'keyrequestpassword123';
const PASSPHRASE = 'twenty-fifth word';

// BIP173 test vector: checksum-valid, and nothing here holds its key, so the
// chain has no public key to serve for it and the wallet lands on the
// missing-key banner that carries the button under test.
const UNKNOWN_RECIPIENT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

/**
 * Opens a fresh compose screen.
 *
 * SCREEN FACT: "New conversation" is the Messaging inbox's trailing header
 * button (`MessagingInbox.jsx` renders it as an icon with no visible text, so
 * its accessible name is the only handle on it).
 */
async function gotoNewConversation(page) {
    await gotoSection(page, 'Messaging');
    const compose = page.getByRole('button', { name: 'New conversation' });
    await expect(compose, 'no "New conversation" entry point on the Messaging screen')
        .toBeVisible({ timeout: 30_000 });
    await compose.click();

    const main = page.getByRole('main');
    await expect(main.getByLabel('Address', { exact: true }),
        'the compose screen never rendered its Address field').toBeVisible({ timeout: 30_000 });
    return main;
}

/**
 * The "we don't know their key" banner. It renders ONLY once the recipient
 * lookup has SETTLED on missing with an encrypted method selected, which is why
 * waiting for it is how this file waits out the debounced lookup.
 */
function missingPubkeyBanner(scope) {
    return scope.getByRole('alert').filter({ hasText: "don't know the recipient's public key" });
}

function requestButton(scope) {
    return scope.getByRole('button', { name: /Request encrypted session/i });
}

/** Every alert currently on screen, joined, so nothing can hide in a sibling. */
async function alertText(scope) {
    return (await scope.getByRole('alert').allInnerTexts()).join(' | ');
}

/**
 * Whatever the press itself put on screen: the alert or status INSIDE the
 * missing-key banner, which is where `ComposeMessage` renders both the key
 * request's failure and its "Key request sent" confirmation.
 *
 * Scoped to the banner's descendants for two reasons, and both were live
 * mistakes in this file before it went green. The banner is itself a
 * `role="alert"` that exists before anything is pressed, so a page-wide read
 * lets the box supply the answer the button was supposed to give. And the fee
 * readout further down the form is a `role="status"` that is always on screen,
 * so a page-wide "something appeared" wait passes instantly, at which point the
 * assertions after it are racing the async handler rather than waiting for it.
 */
function pressOutcome(scope) {
    const banner = missingPubkeyBanner(scope);
    return banner.getByRole('alert').or(banner.getByRole('status'));
}

/** Fills the recipient and waits for the handshake button to be reachable. */
async function reachHandshakeButton(page) {
    const main = await gotoNewConversation(page);
    await main.getByLabel('Address', { exact: true }).fill(UNKNOWN_RECIPIENT);
    await expect(missingPubkeyBanner(main),
        'the recipient lookup never settled on "missing", so the key-request button '
        + 'this file is about was never on screen')
        .toBeVisible({ timeout: 60_000 });
    await expect(requestButton(main)).toBeVisible({ timeout: 30_000 });
    return main;
}

test.describe('a failed message key-request says why', () => {
    test('a wallet with no ready signer gets a reason, on the form stage, that it can act on', async ({ page }) => {
        await createWallet(page, {
            password: PASSWORD,
            name: 'Passphrase Wallet',
            bip39Passphrase: PASSPHRASE,
        });
        // THE LOCK/UNLOCK IS THE WHOLE POINT, not tidying. Creation holds the
        // passphrase in scope and pools a signer with it, so a freshly created
        // passphrase wallet CAN sign and this test passed straight through the
        // branch it exists to reach. Every subsequent unlock takes the password
        // alone, `SignerPool.populate` skips the wallet, and the session runs on
        // from there with an empty pool - which is the state a real user is in
        // for all but the first few minutes of the wallet's life.
        await lockWallet(page);
        await unlockWallet(page, PASSWORD);

        const main = await reachHandshakeButton(page);

        // Before the press: the missing-key banner is up (it has to be, the
        // button lives inside it) but nothing on screen reports a failure. This
        // is what stops the banner from standing in for the answer below.
        expect(await alertText(main), 'a failure is being reported for an attempt nobody made')
            .not.toMatch(/cannot be signed|locked/i);

        await requestButton(main).click();

        // THE CLAIM. Before the fix this press produced nothing at all: no
        // alert, no busy state, no navigation, forever.
        await expect(pressOutcome(main).first(),
            'the key request failed silently: the form stage reported nothing at all')
            .toBeVisible({ timeout: 30_000 });

        const said = (await pressOutcome(main).allInnerTexts()).join(' | ');
        expect(said, 'the key request answered, but not with a reason')
            .toMatch(/cannot be signed/i);
        // And the reason has to be one the user can comply with on THIS stage.
        // The old copy asked for a password here; there is no password field on
        // the compose form to type one into.
        expect(said, 'the reason asks for a password on a stage that has no password field')
            .not.toMatch(/enter your password/i);
        // This wallet is not locked and unlocking it again would not help: a
        // passphrase wallet is never put in the signer pool at all. Naming
        // plain text is the one way forward it actually has, and the banner
        // above already offers that choice.
        expect(said, 'a passphrase wallet was told to unlock, which is a loop it cannot leave')
            .toMatch(/25th-word passphrase/i);
        expect(said, 'the reason names no remedy the user can reach from this screen')
            .toMatch(/plain text/i);
    });

    test('an ordinary wallet is NOT refused for a missing signer', async ({ page }) => {
        // The control, and it is deliberately the SAME walk down to the
        // lock/unlock cycle: one difference, the passphrase, so this wallet's
        // signer comes back into the pool on unlock and `signerReady` is true.
        // Without it, a wallet broken in some unrelated way (no addresses at
        // all, say, which also makes the handler return early and silently)
        // would let the test above pass for the wrong reason, and so would a
        // build where the lock/unlock itself was what broke signing.
        await createWallet(page, { password: PASSWORD, name: 'Ordinary Wallet' });
        await lockWallet(page);
        await unlockWallet(page, PASSWORD);

        const main = await reachHandshakeButton(page);

        await requestButton(main).click();

        // SOMETHING has to come back, and waiting for it is what makes the
        // negative assertion below mean anything: a press that produced nothing
        // would otherwise "not match" the not-ready sentence and pass. What
        // comes back is the dev-mock SDK's business and is not this file's
        // subject - a compose failure and a "Key request sent" are both fine
        // here. What must NOT come back is a refusal for a signer this wallet
        // has.
        const outcome = pressOutcome(main);
        await expect(outcome.first(),
            'the key request answered nothing at all on a wallet that can sign, which is the '
            + 'original silent-button defect in its other half')
            .toBeVisible({ timeout: 60_000 });

        expect((await outcome.allInnerTexts()).join(' | '),
            'an unlocked wallet with a pooled signer was refused as not-ready')
            .not.toMatch(/25th-word passphrase|wallet is locked/i);
    });
});
