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
// injection. It is the LEGACY wallet: `passphraseEnabled` true with no stored
// passphrase, the shape a 25th-word wallet carries until its passphrase is
// sealed onto the record at setup. `SignerPool.populate` cannot pool such a
// wallet from the password alone, so it runs unlocked in the UI with NO signer
// and `useSignerReady` reads false. Deterministic, and it needs no chain.
//
// CREATING A PASSPHRASE WALLET DOES NOT PRODUCE THAT STATE, which is why the
// obvious shortcut is not taken here. The passphrase typed on the create screen
// is encrypted under the wallet's own master key and stored, so every later
// unlock pools a signer from the password alone and the press under test sails
// straight past the branch. Create-with-a-passphrase, lock, unlock builds an
// ordinary wallet, and reading that walk here would mislead the next person
// into thinking a passphrase alone still empties the pool.
//
// SO THE WALLET COMES FROM A BACKUP, and there is no shorter route: nothing in
// the e2e harness pre-seeds a vault (a vault is an IndexedDB blob plus
// localStorage KDF meta, and the fixtures only `addInitScript` two license
// keys), and no create or import walk can build a legacy record, because both
// now store what they are given. `test/e2e/fixtures/pre-spec-passphrase-backup
// .json` is a §19.4 envelope holding exactly such a record, built by the
// generator beside it, whose header carries its throwaway secrets.
//
// AND `Not now` IS THE LOAD-BEARING CLICK. Restoring that envelope routes the
// wallet into the one-time capture step at its next unlock, which is the wallet
// offering to fix itself. Accepting it would store the passphrase and pool a
// signer, which is the state the OTHER test in this file already covers.
// Declining it proceeds into the app with the wallet still unpooled, which is
// where a real user lands any time they postpone that step. See
// `tests/wallet/passphrase-stored.regtest.spec.js` (AT2) for the same walk with
// `Continue` pressed instead.
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

import { readFile } from 'node:fs/promises';

import {
    createWallet, dismissIntroCarousel, expect, gotoSection, lockWallet, test,
    unlockButton, unlockedShell, unlockWallet,
} from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
// Imported for its CONSTANTS, not to rebuild the envelope: the checked-in file
// is the fixture, and reading its secrets from the one place that wrote them
// means the two can never drift.
import {
    ENVELOPE_PATH,
    PRE_SPEC_BACKUP_PASSWORD,
    PRE_SPEC_WALLET_NAME,
    PRE_SPEC_WALLET_PASSWORD,
} from '../../fixtures/make-pre-spec-passphrase-backup.mjs';

const PASSWORD = 'keyrequestpassword123';

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

/**
 * Restores the checked-in pre-spec envelope into this browser's empty vault.
 *
 * The record inside is at `schemaVersion` 2 with no `encryptedPassphrase` key
 * at all, on a wallet whose `passphraseEnabled` is true: a wallet that HAS a
 * passphrase and has never stored it. That is the legacy state, and restoring
 * this file is the only route a browser has to it.
 *
 * The three passwords are three different secrets. Two come from the envelope
 * (the file's own, and the one the exporting device used); the third is this
 * device's, chosen here, and it is the one every later unlock takes.
 */
async function restorePreSpecWallet(page) {
    const envelope = await readFile(ENVELOPE_PATH, 'utf8');
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Import wallet' }).click();
    await page.getByRole('tab', { name: 'Encrypted backup' }).click();

    await page.getByPlaceholder('{"version":1').fill(envelope);
    await page.getByLabel('Backup password', { exact: true })
        .fill(PRE_SPEC_BACKUP_PASSWORD);
    await page.getByLabel('Password of the wallet in this backup', { exact: true })
        .fill(PRE_SPEC_WALLET_PASSWORD);
    await page.getByLabel('Password for this device', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Restore', exact: true }).click();

    await expect(unlockedShell(page),
        'the pre-spec envelope never reached an unlocked wallet, so this file has no legacy '
        + 'passphrase wallet to press the key-request button on')
        .toBeVisible({ timeout: kdfStepTimeout() });
}

/**
 * Locks, unlocks with the password, and DECLINES the one-time capture step.
 *
 * Both halves are assertions as much as steps. The capture step has to appear,
 * because it appearing is what proves the wallet really is in the legacy state
 * this file needs; and `Not now` has to be what is pressed, because `Continue`
 * would store the passphrase, pool a signer, and leave the press below with
 * nothing to refuse.
 */
async function unlockDecliningCapture(page, password) {
    await lockWallet(page);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await unlockButton(page).click();

    await expect(page.getByText(PRE_SPEC_WALLET_NAME),
        'the unlock let a wallet through that holds a passphrase it has never stored, so '
        + 'either the capture step is gone or this wallet is not in the legacy state at all')
        .toBeVisible({ timeout: kdfStepTimeout() });
    const notNow = page.getByRole('button', { name: 'Not now', exact: true });
    await expect(notNow, 'the capture step offers no way to postpone, so a user who does not '
        + 'have their passphrase to hand cannot reach the wallet at all')
        .toBeVisible({ timeout: 30_000 });
    await notNow.click();

    await expect(unlockedShell(page),
        'declining the capture step did not proceed into the wallet')
        .toBeVisible({ timeout: kdfStepTimeout() });
}

test.describe('a failed message key-request says why', () => {
    test('a wallet with no ready signer gets a reason, on the form stage, that it can act on', async ({ page }) => {
        // A wallet that PREDATES stored passphrases: it has a 25th word and has
        // never sealed it onto its record, so no password alone can pool a
        // signer for it. Creating a passphrase wallet here would NOT do: that
        // stores the passphrase at setup and signs normally forever after,
        // which is the wallet the control case below builds.
        await restorePreSpecWallet(page);
        // And the wallet's own offer to fix itself is declined, which is what
        // leaves it listed, unlocked and unpooled - the state under test.
        await unlockDecliningCapture(page, PASSWORD);

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
        // The generic "unlock it and press this again" would be a loop this
        // wallet cannot leave: it is already unlocked, and the next unlock
        // pools nothing either while the passphrase is unstored. So the reason
        // has to name the passphrase, and it has to name the two ways out this
        // wallet actually has - the unlock screen's capture step, or the plain
        // text the banner above already offers.
        expect(said, 'a legacy passphrase wallet was told to just unlock, which is a loop it '
            + 'cannot leave: unlocking again pools nothing until the passphrase is stored')
            .toMatch(/25th-word passphrase/i);
        expect(said, 'the reason names no remedy the user can reach from this screen')
            .toMatch(/plain text/i);
    });

    test('an ordinary wallet is NOT refused for a missing signer', async ({ page }) => {
        // The control: an ordinary wallet, put through the same lock/unlock
        // cycle and pressing the same button, so what differs is the signer and
        // nothing else. Without it, a wallet broken in some unrelated way (no
        // addresses at all, say, which also makes the handler return early and
        // silently) would let the test above pass for the wrong reason, and so
        // would a build where the lock/unlock itself was what broke signing.
        //
        // A wallet created WITH a passphrase would serve here too: its
        // passphrase is stored at setup, so it pools on the password alone
        // exactly like this one. What it cannot do is stand in for the test
        // above.
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
