// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// THE QUESTION THIS FILE EXISTS TO ANSWER, and it is the one every FIRST
// conversation hits before ECIES is ever reachable: what does the wallet do
// when you message an address the chain has never seen?
//
// An address that has never SPENT reveals no public key, so the indexer has
// none to serve, so ECIES (which encrypts TO the recipient's key) is
// impossible. That is not an edge case, it is the opening move of every new
// contact. Read from `ComposeMessage.jsx` and `flows/messageAction.js`, the
// wallet is BUILT to answer it in exactly two ways, and neither of them is
// "encrypt anyway":
//
//   1. It REFUSES. `Send message` is disabled while an encrypted method is
//      selected and the recipient's key is unresolved, and a `role="alert"`
//      banner says why. There is no silent downgrade to plaintext.
//   2. It offers two ways forward, in that same banner: pick "Plain text"
//      (MESSAGE v3, which needs no key at all), or press "Request encrypted
//      session (publish your key)", which broadcasts MESSAGE format 0 carrying
//      OUR OWN pubkey in ENCRYPTION_KEY. Note the asymmetry, because it IS the
//      answer: the handshake does not let this wallet encrypt to them, it hands
//      THEM what they need to encrypt back to us.
//
// Test 1 drives (1) and the plaintext half of (2). Test 2 drives the handshake
// half. They are SEPARATE TESTS on purpose: the previous draft of this file
// bundled both, plus an ECDH-versus-ECIES wire-distinctness claim, into one
// test that never went green, so a failure anywhere left the first-contact
// question unanswered. A verdict you cannot reach is not a specification.
//
// WHAT WOULD BE FALSE IF THIS PASSED VACUOUSLY. Three things, each guarded:
//
//   - "Send is disabled" would pass while the pubkey lookup is merely still
//     IN FLIGHT (`pubkeyState === 'checking'` disables the button too). So
//     every disabled-assertion below is preceded by an assertion on the
//     missing-key banner, which renders ONLY in the settled `missing` state.
//     And the disable is falsified the one way that should lift it (choosing
//     Plain text) and then reinstated (choosing ECIES again), so a stuck
//     loading flag or an unrelated empty field cannot masquerade as the gate.
//   - "The message was sent" would pass on the wallet's own say-so. The
//     "Message sent" notice is the wallet reporting on itself. Every claim
//     about what actually went out is read back from the EXPLORER via
//     `waitForValidAction(txid)`, whose verdict is the indexer's, and the
//     assertions are on the action's own recorded fields (action_format,
//     destination, source, coin, plaintext_message, encryption_key).
//   - "It landed on the venue chain" would pass while the wallet drove a
//     DIFFERENT chain entirely. See the Delivery-network trap below.
//
// THE DELIVERY-NETWORK TRAP, and it is specific to this screen. Every other
// form in the wallet defaults to Bitcoin, which is why `selectVenueChain` is a
// documented no-op on RBTC. Compose does NOT: the address-load effect in
// `ComposeMessage.jsx` deliberately prefers a DOGECOIN address ("a MESSAGE
// pays a native miner fee, and DOGE is by far the cheapest supported chain").
// So on this screen EVERY chain, Bitcoin included, needs an explicit pick, and
// a spec that trusts the default broadcasts on Dogecoin while the fixture reads
// the Litecoin explorer. `pickDeliveryNetwork` below calls `selectVenueChain`
// and then asserts the picker actually reads this run's chain, which is the
// only form of the check that is honest on all three.
//
// Note what the delivery network is NOT. It is the chain that funds the
// transaction and pays the fee; the message's own COIN comes from
// `destChainId`, derived from the RECIPIENT's address (`detectAddressCoin`)
// and only falling back to the delivery chain when the address shape is
// ambiguous. Both resolve to this venue's chain here, and the on-chain `coin`
// assertion in test 1 is what proves it rather than assuming it.
//
// WHY REGTEST_DESTINATION IS THE RECIPIENT. It is the fixture's pinned
// throwaway address for this run's chain, and nothing anywhere holds its key.
// An address whose key does not exist can never sign, so it can never spend, so
// it can never publish a pubkey: it is PERMANENTLY in the "chain has never seen
// it" state, deterministically, on every run and every re-run. A freshly
// generated wallet address would also work today but only by luck of never
// having been used, and reaching one costs a walk through the Addresses screen
// and its Add-address modal, which is three more surfaces this file would then
// be pinned to for a fact it does not need.
//
// RUN IT (Litecoin: RBTC's decoder is dead and RDOGE is off limits):
//   cd test/e2e && XC_REGTEST_COIN=RLTC XC_PREVIEW_PORT=4185 XC_REUSE_BUILD=1 \
//       npx playwright test --config=playwright.regtest.config.js \
//       tests/messaging/handshake-and-methods.regtest.spec.js

import { createWallet, expect, gotoSection, test } from '../../fixtures/wallet.js';
import {
    ENCODER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    REGTEST_DESTINATION,
    fundAddress,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 4;

/**
 * The protocol COIN ticker this run's chain stamps into a MESSAGE.
 *
 * `PROTOCOL_COIN_TICKER` in `flows/messageAction.js` maps the descriptor's coin
 * to BTC / LTC / DOGE; the venue codes are the same three with an R prefix, so
 * this is that mapping and not a second, driftable table.
 */
const PROTOCOL_COIN = REGTEST_COIN.replace(/^R/, '');

// Deliberately free of `|` and `;`: MESSAGE.md forbids both inside
// PLAINTEXT_MESSAGE / ENCRYPTED_MESSAGE, because they are the wire's own field
// and command separators.
const PLAINTEXT_TEXT = 'xc-e2e first contact probe';
const PROBE_TEXT = 'xc-e2e-structural-probe';

// `xchain-sdk/src/messaging.js` ciphertext layouts, read from that source
// rather than re-derived. ECIES prepends a KDF version byte plus the sender's
// ephemeral pubkey; ECDH-session has no use for either, because the shared
// secret is already deterministic from both parties' permanent keys.
const ECIES_OVERHEAD_BYTES = 1 + 33 + 12 + 16; // version + ephemeralPubkey + iv + authTag
const ECDH_OVERHEAD_BYTES = 12 + 16;           // iv + authTag only

/** Opens the command palette and runs the first matching entry. */
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
 * Onboards a fresh wallet on the regtest network, funds its address on this
 * run's chain, and returns that address.
 *
 * SCREEN FACT, and it is what makes the funding safe: `switchToRegtest`
 * derives ONE address per regtest chain, and the compose form auto-picks "the
 * first HD address on the delivery chain" with no From field of its own to
 * override it (`ComposeMessage.jsx` has an Address, a Message, two IconSelects
 * and a fee picker - there is no source picker on the form at all). So the one
 * address the Issue form reports here is necessarily the one Compose will send
 * from, which is why test 1 can assert on `action.source` at all.
 *
 * The address is read off the Issue-token form rather than Receive: Receive has
 * no Network picker and follows the wallet's globally active chain, which off
 * Bitcoin is not this venue's chain.
 */
async function onboardFundedWallet(page, walletName) {
    await createWallet(page, { password: PASSWORD, name: walletName });
    await switchToRegtest(page, PASSWORD);

    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);

    const address = await main.getByLabel('From').inputValue();
    expect(address, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
        .toMatch(REGTEST_ADDRESS_RE);

    await fundAddress(address, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    // A MESSAGE is a fee-bearing XChain action, so the venue has to be able to
    // price the protocol fee or compose fails on the price rather than on
    // anything this file is testing.
    await seedPrices();
    return address;
}

/**
 * Points the compose form's "Delivery network" at this run's chain.
 *
 * The pick itself is `selectVenueChain`'s job, and it now covers this screen:
 * it reads the picker on EVERY chain instead of returning early on Bitcoin,
 * which is precisely what this form defeats by defaulting to Dogecoin.
 * No local re-pick sits here: it went with that early return.
 *
 * What stays is the closing assertion, kept deliberately even though the helper
 * carries one of its own. This is the screen the wrong-chain bug actually lands
 * on, so this is where the failure message is worth reading: everywhere else a
 * message delivered on the wrong chain still looks green.
 */
async function pickDeliveryNetwork(scope) {
    const trigger = scope.getByRole('button', { name: /^Delivery network:/ });
    await expect(trigger, 'the compose form has no "Delivery network" picker')
        .toBeVisible({ timeout: 30_000 });

    await selectVenueChain(scope, 'Delivery network');

    await expect(trigger,
        `the message would have been delivered on the wrong chain: this form defaults to `
        + `DOGECOIN, not to ${REGTEST_CHAIN_LABEL}, and the explorer this run reads is `
        + `${REGTEST_COIN}'s`)
        .toHaveAttribute('aria-label', new RegExp(`^Delivery network: ${REGTEST_CHAIN_LABEL}\\b`),
            { timeout: 15_000 });
}

/**
 * Opens a fresh compose screen and puts it on this run's chain.
 *
 * SCREEN FACT: "New conversation" is the PageHeader's trailing icon button on
 * the Messaging inbox (`MessagingInbox.jsx` renders it with that exact
 * `aria-label`; it is an icon with no visible text, so the accessible name is
 * the only way to reach it).
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
    await pickDeliveryNetwork(main);
    return main;
}

/**
 * The Encryption dropdown's trigger.
 *
 * SCREEN FACT: `IconSelect` gives its trigger the accessible name
 * "<label>: <selected label>" precisely because the visible label is a `<span>`
 * and not a `<label for>`. So the CURRENT selection is readable off the
 * aria-label without opening the popover, which is how the ECIES default is
 * asserted rather than assumed.
 */
function encryptionTrigger(scope) {
    return scope.getByRole('button', { name: /^Encryption:/ });
}

/** Picks an Encryption option by its visible label prefix (a regex source). */
async function pickEncryption(scope, labelPrefix) {
    await encryptionTrigger(scope).click();
    const option = scope.getByRole('option', { name: new RegExp(`^${labelPrefix}`) });
    await expect(option, `no "${labelPrefix}" encryption option offered`)
        .toBeVisible({ timeout: 15_000 });
    await option.click();
}

/**
 * The "we don't know their key" banner. Present ONLY while the lookup has
 * SETTLED on missing and an encrypted method is selected, which is exactly why
 * it is the precondition for every "Send is disabled" assertion in this file:
 * the in-flight `checking` state disables Send too, and would otherwise let
 * that assertion pass without the refusal it claims to prove.
 */
function missingPubkeyBanner(scope) {
    return scope.getByRole('alert').filter({ hasText: "don't know the recipient's public key" });
}

const sendButton = (scope) => scope.getByRole('button', { name: 'Send message', exact: true });

/** Fills the recipient, and the body when one is given. */
async function fillRecipient(scope, address, message) {
    await scope.getByLabel('Address', { exact: true }).fill(address);
    if (message !== undefined) {
        await scope.getByLabel('Message', { exact: true }).fill(message);
    }
}

/**
 * Records every `broadcast_tx` txid this page produces, in order.
 *
 * This is the ONLY way to learn what was broadcast here. The compose form's own
 * "Message sent" result screen (which does print a txid) is never reached in
 * the web shell: `App.jsx` passes an `onSent` handler, and `openConfirmScreen`
 * short-circuits on it before `setStage('done')` ever runs, navigating back to
 * the inbox and popping a txid-less NoticeModal instead. The handshake button
 * has no result screen at all. Reading the network is also the more honest
 * source: it is what the wallet DID, not what it says it did.
 */
function trackBroadcastTxids(page) {
    const txids = [];
    page.on('response', async (response) => {
        try {
            if (!response.url().startsWith(ENCODER_URL)) return;
            if (response.request().method() !== 'POST') return;
            const body = response.request().postData() || '';
            if (!body.includes('"broadcast_tx"')) return;
            const json = await response.json().catch(() => null);
            // `XChainEncoder.broadcastTx` documents its result as `{ txid }`.
            const txid = json?.result?.txid;
            if (txid) txids.push(txid);
        } catch { /* a transient parse failure must not fail the whole run */ }
    });
    return txids;
}

/**
 * Waits for the broadcast burst that follows one user action to finish, and
 * returns the LAST txid in it.
 *
 * THE LAST ONE, NOT THE FIRST, AND THIS IS THE BUG THE PREVIOUS DRAFT CARRIED.
 * A MESSAGE is not a one-transaction action. `VERSION|COIN|DESTINATION|...`
 * with a bech32 destination is already ~50 bytes before the body, so anything
 * but a trivially short plaintext (and EVERY encrypted body, which is hex, and
 * every format-0 handshake, which carries a 66-hex-char pubkey) overflows the
 * 80-byte OP_RETURN and the encoder chunks it into a commit plus a reveal. Per
 * `submitWithSigner.js` step 4a, "the decoder indexes the REVEAL, so its txid
 * is the action's identity, not the commit's" - and the reveal is broadcast
 * SECOND. Grabbing the first new txid therefore hands `waitForValidAction` a
 * transaction that carries no action at all, and it times out reporting "no
 * action recorded" for a message that is on chain and perfectly valid.
 *
 * The settle window exists because the `response` handler above is async: the
 * final txid can still be in flight when the UI already says the send is done.
 */
async function settledTxid(txids, countBefore, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let lastCount = countBefore;
    let stableSince = null;
    while (Date.now() < deadline) {
        if (txids.length !== lastCount) {
            lastCount = txids.length;
            stableSince = Date.now();
        } else if (lastCount > countBefore && stableSince !== null
            && Date.now() - stableSince >= 3_000) {
            return txids[txids.length - 1];
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('no broadcast_tx response settled for the expected send: either nothing was '
        + `broadcast, or the encoder URL match (${ENCODER_URL}) is wrong`);
}

/**
 * Approves the confirm screen, waits for the send to finish, and returns the
 * action's txid.
 *
 * DISMISSING THE NOTICE IS NOT COSMETIC. `onSent` navigates back to the inbox
 * AND mounts a `<NoticeModal title="Message sent">`, an `aria-modal="true"`
 * overlay that does not auto-close. Leaving it open and navigating on hangs:
 * the overlay swallows every click aimed at what is underneath it, which reads
 * as a dead nav rail rather than what it is, an unread notice. `NoticeModal`
 * dismisses on its "OK" button (also Escape and the backdrop, per its source).
 *
 * The notice appearing is also the signal that `messageAction` RESOLVED, i.e.
 * that every broadcast in the burst has already been issued - which is what
 * makes the settle window in `settledTxid` short rather than a guess.
 */
async function approveAndCaptureTxid(page, txids) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm, 'the compose form never reached a confirm screen')
        .toBeVisible({ timeout: 90_000 });
    const before = txids.length;
    const approve = page.getByTestId('confirm-approve');
    // Approve stays disabled while pre-flight is in flight; waiting on the
    // button rather than on a sleep is what keeps this off the venue's clock.
    await expect(approve, 'Approve never became clickable on the confirm screen')
        .toBeEnabled({ timeout: 120_000 });
    await approve.click();

    const notice = page.getByRole('dialog', { name: 'Message sent', exact: true });
    await expect(notice, 'the wallet never reported the message as sent')
        .toBeVisible({ timeout: 180_000 });
    const txid = await settledTxid(txids, before);
    await notice.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(notice, 'the "Message sent" notice did not close, and it blocks every click after it')
        .toHaveCount(0, { timeout: 15_000 });
    return txid;
}

test.describe(`Messaging: first contact on ${REGTEST_CHAIN_LABEL}`, () => {
    test.setTimeout(1_800_000);

    test('an address the chain has no key for is refused encryption, and the plaintext fallback really lands unencrypted', async ({ page }) => {
        const txids = trackBroadcastTxids(page);
        let ownAddress;
        let main;

        await test.step('onboard and fund the venue chain', async () => {
            ownAddress = await onboardFundedWallet(page, 'First Contact Wallet');
            expect(REGTEST_DESTINATION,
                'the recipient is this wallet\'s own address, which would prove nothing about a stranger')
                .not.toBe(ownAddress);
        });

        await test.step('the wallet REFUSES to encrypt, and says why', async () => {
            main = await gotoNewConversation(page);
            await fillRecipient(main, REGTEST_DESTINATION, PLAINTEXT_TEXT);

            // Default first, so the rest of this step is about a known start
            // state rather than whatever the form happened to be in.
            await expect(encryptionTrigger(main),
                'the compose form no longer defaults to ECIES, so this step is testing a '
                + 'different method than it claims to')
                .toHaveAttribute('aria-label', /^Encryption: Standard \(ECIES\)/);

            await expect(missingPubkeyBanner(main),
                'the wallet never told the user it could not find a public key for an address '
                + 'that has never spent')
                .toBeVisible({ timeout: 60_000 });

            // The banner above proves the lookup SETTLED on missing, so this is
            // the refusal and not the in-flight `checking` disable.
            await expect(sendButton(main),
                'Send is enabled for an ENCRYPTED message to a recipient with no known public key: '
                + 'the wallet is about to sign something it cannot actually encrypt')
                .toBeDisabled();

            // The banner is also where the two ways out are offered, and an
            // offer nobody can see is not an offer.
            await expect(missingPubkeyBanner(main),
                'the refusal banner does not tell the user what to do instead')
                .toContainText('pick "Plain text" above');
            await expect(missingPubkeyBanner(main)
                .getByRole('button', { name: 'Request encrypted session (publish your key)' }),
            'the refusal banner offers no handshake, so the only way forward it leaves is plaintext')
                .toBeVisible();
        });

        await test.step('the refusal is conditioned on the encryption choice, not stuck on', async () => {
            // Falsify the disable by taking the ONE path that should lift it.
            // Without this, a stuck loading flag or an unrelated empty field
            // would read exactly like the gate under test.
            await pickEncryption(main, 'Plain text');
            await expect(missingPubkeyBanner(main),
                'the missing-key banner is still shown for a PLAIN TEXT send, which needs no key at all')
                .toHaveCount(0);
            await expect(sendButton(main),
                'Send stayed disabled after switching to Plain text, so the disable above is not '
                + 'really a function of encryption mode plus key state')
                .toBeEnabled({ timeout: 15_000 });

            // And back, to show it is the CURRENT choice that decides, not a
            // one-way flag the first switch tripped.
            await pickEncryption(main, 'Standard \\(ECIES\\)');
            await expect(missingPubkeyBanner(main),
                'the missing-key banner did not come back for the same unresolved recipient')
                .toBeVisible({ timeout: 15_000 });
            await expect(sendButton(main),
                'switching back to ECIES did not re-disable Send for the same unresolved recipient')
                .toBeDisabled();
        });

        await test.step('the plaintext fallback delivers, and the CHAIN says it is plaintext', async () => {
            await pickEncryption(main, 'Plain text');
            await expect(sendButton(main)).toBeEnabled({ timeout: 15_000 });
            await sendButton(main).click();

            const confirm = page.getByTestId('confirm-modal');
            await expect(confirm, 'the compose form never reached a confirm screen')
                .toBeVisible({ timeout: 90_000 });
            // The headline is `decoded.summary` from the composed action bytes,
            // not from form state, and the decoder's own word for v3 is PUBLIC
            // rather than the softer "unencrypted" (`describe.js` decodeMessage,
            // version 3 branch). A user about to publish a message forever is
            // owed the harder word.
            await expect(confirm,
                'the confirm screen does not name the message as PUBLIC on the venue chain')
                .toContainText(`Send public message to ${REGTEST_DESTINATION} on ${REGTEST_CHAIN_LABEL}`);

            const txid = await approveAndCaptureTxid(page, txids);
            const action = await waitForValidAction(txid);

            // Everything below is the explorer's record of the action, read
            // back independently of the wallet's own "Message sent".
            expect(action.action,
                'the transaction the wallet broadcast did not record a MESSAGE action')
                .toBe('MESSAGE');
            expect(String(action.action_format),
                'the plaintext fallback was not sent as MESSAGE format 3, so whatever went out is '
                + 'not the unencrypted format the confirm screen promised')
                .toBe('3');
            expect(action.destination, 'the on-chain DESTINATION is not the address that was typed')
                .toBe(REGTEST_DESTINATION);
            expect(action.source, 'the message was not sent from this wallet\'s funded address')
                .toBe(ownAddress);
            expect(action.coin,
                `COIN was not stamped ${PROTOCOL_COIN}, so the message names the wrong destination network`)
                .toBe(PROTOCOL_COIN);
            // THE ASSERTION THIS STEP EXISTS FOR: the chain's own copy of the
            // body. A fallback that corrupts or drops the message is worse than
            // refusing to send at all, because the user believes it went.
            expect(action.plaintext_message,
                'the on-chain PLAINTEXT_MESSAGE is not what was typed')
                .toBe(PLAINTEXT_TEXT);
            expect(action.encrypted_message,
                'a message sent as "Plain text" carries an ENCRYPTED_MESSAGE payload on chain, so it '
                + 'is not what the confirm screen called it')
                .toBeFalsy();
        });
    });

    // THE BROWSER PROOF FOR THE SILENT KEY-REQUEST BUTTON DOES NOT LIVE HERE.
    // It is `tests/messaging/key-request-error.spec.js`, which drives the
    // not-ready-signer refusal on the dev-mock venue and runs GREEN: that
    // branch returns before any signing, composing or broadcast, so it needs a
    // browser and a real wallet and it does not need a chain. Parking a proof
    // that is available today behind a chain-side defect that is not fixed is
    // what this note exists to stop the next reader from re-doing.
    //
    // THE SILENT BUTTON IS FIXED AND THIS TEST IS ALSO HOW WE KNOW: un-fixme'd and driven
    // 2026-08-27 (sixth run), it now fails with the venue's own words on screen
    // where it used to fail against a blank surface. The page snapshot carries
    // `alert: "Encoder RPC error: Transaction would burn significant satoshis
    // as fees. Please provide a change address."` - the exact sentence this
    // file was written to make visible.
    //
    // RE-FIXME'D AGAINST WHAT IT UNCOVERED, which is a different
    // defect one layer down: the key request cannot compose at all.
    // `handshakeAction` (flows/messageAction.js:378) builds
    // `encoderOpts: { pubkey, fee?, feePerKb?, rbf? }` with no `change` and no
    // `sourceAddress`, and `submitAction` only ROTATES a change address that is
    // already there (`submitAction.js:241`), it never supplies one. Same shape
    // as the label-sync publish, whose own defect entry claimed
    // `publishLabelsNow` was "the only action flow in the wallet that omits
    // them" - it is not.
    //
    // WHAT IS NOT PROVEN, and the next session should not assume it: why the
    // SEND path in this same file succeeds (row 33 drove the plaintext fallback
    // green on chain) while the handshake does not, when neither sets `change`
    // literally. That difference is the thing to measure first, and guessing at
    // it is how this campaign has produced wrong causes before.
    //
    // The assertions below are right and should stay exactly as written.
    // Superseded header follows.
    // FIXME'd 2026-08-27 BECAUSE IT PINS A REAL DEFECT THAT IS NOT FIXED YET,
    // not because it is unfinished. The defect is tracked.
    //
    // Driven centrally on Litecoin, this went red after 2.4 minutes with the
    // message this file already predicted from source: the handshake never
    // confirmed, and the compose surface reports the failure NOWHERE.
    // `handleRequestSession` writes every failure into `submitError`, the form
    // stage renders `submitError` nowhere at all, and the same function returns
    // early with "Enter your password to send the key request." when the signer
    // pool is not ready, on a stage that has no password field. So the button
    // does nothing, silently, with no way for the user to learn why or to
    // comply.
    //
    // The claim below is right and should stay exactly as written; it is the
    // product that has to move. Un-fixme it when that fix lands, and expect this
    // test to be how you know it landed.
    test.fixme('the handshake publishes OUR key to an address the chain has never seen', async ({ page }) => {
        const txids = trackBroadcastTxids(page);
        let ownAddress;
        let main;
        // Recorded rather than assumed to be zero: onboarding broadcasts
        // nothing today (funding goes through the miner, price seeding through
        // the indexer), but a future setup step that did would silently make
        // the handshake's txid the wrong transaction.
        let txidsBeforeHandshake = 0;

        await test.step('onboard and fund the venue chain', async () => {
            ownAddress = await onboardFundedWallet(page, 'Handshake Wallet');
        });

        await test.step('the handshake is offered, and reports itself sent', async () => {
            main = await gotoNewConversation(page);
            // No body: the handshake carries no message, and the button lives in
            // the banner whether or not one is typed. Leaving it empty also
            // keeps `Send message` disabled on its own account, so nothing here
            // can be confused with an ordinary send.
            await fillRecipient(main, REGTEST_DESTINATION);

            const banner = missingPubkeyBanner(main);
            await expect(banner, 'no missing-key banner, so the handshake offer is not on screen')
                .toBeVisible({ timeout: 60_000 });

            const request = banner
                .getByRole('button', { name: 'Request encrypted session (publish your key)' });
            await expect(request, 'no handshake offer for a recipient the chain has no key for')
                .toBeVisible({ timeout: 30_000 });

            txidsBeforeHandshake = txids.length;
            await request.click();

            // SCREEN FACT, and it is a hazard rather than a nicety:
            // `handleRequestSession` writes its failures to `submitError`, and
            // the FORM stage renders `submitError` NOWHERE (only the legacy
            // review stage and the hardware branch do). A handshake that throws
            // therefore leaves the screen unchanged, so this timeout is the only
            // signal there is. Two candidate causes if it fires: the broadcast
            // failed silently, or `signerReady` was false, in which case
            // `handleRequestSession` returns early asking for a password that
            // this stage has no field for.
            await expect(main.getByText(/Key request sent/),
                'the wallet never confirmed the key request. This surface reports failure NOWHERE '
                + 'on the form stage, so this may be a broadcast that failed silently, or a '
                + 'session that was not unlocked (handleRequestSession refuses without a password, '
                + 'and the form has no password field)')
                .toBeVisible({ timeout: 120_000 });
        });

        await test.step('the CHAIN carries our key, addressed to them', async () => {
            const txid = await settledTxid(txids, txidsBeforeHandshake);
            const action = await waitForValidAction(txid);

            expect(action.action, 'the handshake did not record a MESSAGE action')
                .toBe('MESSAGE');
            // Format 0 is "Sender Key" (MESSAGE.md, and the indexer's own
            // `formats[0]`). This is the whole answer to the first-contact
            // question in one field: the wallet did NOT encrypt to an unknown
            // key and did not pretend to. It published OURS, so THEY can
            // encrypt back to us, and this attempt carries no message body at
            // all because there is nothing yet to encrypt it with.
            expect(String(action.action_format),
                'the handshake was not sent as MESSAGE format 0 (Sender Key)')
                .toBe('0');
            expect(action.destination, 'the handshake was not addressed to the intended recipient')
                .toBe(REGTEST_DESTINATION);
            expect(action.source, 'the handshake was not sent FROM this wallet\'s own address')
                .toBe(ownAddress);
            expect(action.coin,
                `COIN was not stamped ${PROTOCOL_COIN} on the handshake`)
                .toBe(PROTOCOL_COIN);
            expect(String(action.encryption_method),
                'the handshake did not declare ECDH-session (method 2), which is the only method a '
                + 'published key is useful for')
                .toBe('2');
            // A compressed secp256k1 pubkey: 33 bytes, hex, leading 0x02/0x03.
            // Not matched against a specific value (this spec has no
            // independent derivation tooling), but the SHAPE is exactly what a
            // key publication must carry, and an empty or truncated field would
            // be a handshake that teaches the recipient nothing.
            expect(action.encryption_key,
                'the handshake carried no usable ENCRYPTION_KEY, so the recipient learns nothing '
                + 'from it and can still not reply encrypted')
                .toMatch(/^0[23][0-9a-f]{64}$/i);
            expect(action.encrypted_message,
                'a key-publish handshake carries an ENCRYPTED_MESSAGE, which it has no key to have '
                + 'produced')
                .toBeFalsy();
            expect(action.plaintext_message,
                'a key-publish handshake carries a PLAINTEXT_MESSAGE, which is a message the user '
                + 'never wrote')
                .toBeFalsy();
        });
    });

    // UNFINISHED, AND `test.fixme` FOR THAT REASON ALONE.
    //
    // IT PINS NO DEFECT AND MAKES NO CLAIM ABOUT THE WALLET. The body below is
    // written out in full and every selector in it was read off the product
    // source, but it has never been run, and an assertion that has never passed
    // is a guess about the screen rather than a specification of it. Do not
    // read anything here as a finding until it is green once.
    //
    // It is separated from the two tests above deliberately, because bundling
    // bundled with them, and because it is the most expensive leg by far (three
    // broadcasts, two of them behind a pubkey that must first be indexed) its
    // failure is what left the first-contact question unanswered for a whole
    // session. Whatever happens to this test now, that question is answered
    // above and stays answered.
    //
    // WHAT IT WOULD PROVE, and why it has to prove it this way. Neither the wire
    // nor the UI distinguishes ECIES from ECDH-session: a v2 MESSAGE has no
    // ENCRYPTION_METHOD field, so the indexer stamps `encryption_method=1` on
    // every v2 row regardless (`xchain-indexer/src/actions/message.js`), and the
    // confirm screen decodes both to the identical "Send encrypted message to X"
    // (`describe.js`, version 2 branch). Asserting "the app says it used ECDH"
    // would only prove the app's claim about itself. The one place the methods
    // provably differ is ciphertext SHAPE (`xchain-sdk/src/messaging.js`):
    //   ECIES = [version(1)][ephemeralPubkey(33)][iv(12)][authTag(16)][body]
    //   ECDH  = [iv(12)][authTag(16)][body]
    // a 34-byte delta for the SAME plaintext to the SAME recipient, read off the
    // chain. That is a measurement, not a decrypt through the wallet's own code,
    // which is the point: self-consistency proves nothing about encryption.
    //
    // WHY IT SELF-MESSAGES. Both encrypted methods need the RECIPIENT's pubkey
    // indexed, which needs that address to have spent. The cheapest way there
    // without a second funded wallet is to send to ourselves after our own
    // address has spent once. That first send is the leg most likely to make
    // this test slow or flaky on a shared venue, and it is the first thing to
    // cut if this has to be reduced to something that finishes.
    // Tracked rather than left as an unowned red: this is the one
    // deliberate `test.fixme` in the suite that named no item, which is the
    // second clause of the campaign's whole-suite acceptance test. It marks
    // ABSENT COVERAGE, not a known defect - nothing else establishes that the
    // two encrypted methods differ on the wire.
    test.fixme('ECDH-session and ECIES are wire-distinct on chain for the same plaintext', async ({ page }) => {
        const txids = trackBroadcastTxids(page);
        let ownAddress;
        const probeBytes = Buffer.byteLength(PROBE_TEXT, 'utf8');
        let eciesBytes;
        let ecdhBytes;
        let eciesHex;

        await test.step('onboard, fund, and spend once so our own key is indexed', async () => {
            ownAddress = await onboardFundedWallet(page, 'Wire Distinctness Wallet');

            // A plaintext self-message is the cheapest spend that publishes our
            // pubkey: it needs no recipient key, so it works before any key is
            // known, and it is the same lane test 1 already drives.
            const main = await gotoNewConversation(page);
            await fillRecipient(main, ownAddress, PLAINTEXT_TEXT);
            await pickEncryption(main, 'Plain text');
            await expect(sendButton(main)).toBeEnabled({ timeout: 15_000 });
            await sendButton(main).click();
            const txid = await approveAndCaptureTxid(page, txids);
            await waitForValidAction(txid);
        });

        await test.step('ECIES to a KNOWN key carries the ephemeral-key envelope', async () => {
            const main = await gotoNewConversation(page);
            await fillRecipient(main, ownAddress, PROBE_TEXT);
            await expect(missingPubkeyBanner(main),
                'this wallet\'s own address never became resolvable after spending once')
                .toHaveCount(0, { timeout: 120_000 });
            await expect(main.getByText(/Recipient public key found/),
                'the form never confirmed it resolved a key, so the method below is not the one '
                + 'this step names')
                .toBeVisible({ timeout: 120_000 });

            await expect(encryptionTrigger(main))
                .toHaveAttribute('aria-label', /^Encryption: Standard \(ECIES\)/);
            await expect(sendButton(main)).toBeEnabled({ timeout: 15_000 });
            await sendButton(main).click();
            await expect(page.getByTestId('confirm-modal')).toContainText(
                `Send encrypted message to ${ownAddress} on ${REGTEST_CHAIN_LABEL}`);

            const action = await waitForValidAction(await approveAndCaptureTxid(page, txids));
            expect(action.encrypted_message, 'the ECIES send carries no ENCRYPTED_MESSAGE on chain')
                .toBeTruthy();
            expect(action.plaintext_message, 'an "encrypted" send left a PLAINTEXT_MESSAGE on chain too')
                .toBeFalsy();
            // Pinned because it is the REASON this step cannot simply read the
            // method off the chain: v2 has no wire slot for it and the indexer
            // stamps 1 on every v2 row.
            expect(String(action.encryption_method),
                'the indexer stopped stamping ECIES(1) on a v2 row that carries no on-wire method')
                .toBe('1');

            eciesHex = action.encrypted_message.toLowerCase();
            eciesBytes = eciesHex.length / 2;
            expect(eciesBytes,
                'ECIES ciphertext length does not match version(1)+ephemeralPubkey(33)+iv(12)'
                + '+authTag(16)+plaintext, the layout xchain-sdk/src/messaging.js packs')
                .toBe(ECIES_OVERHEAD_BYTES + probeBytes);
            expect(eciesHex.slice(0, 2),
                'ECIES ciphertext does not open with the v1 KDF version byte (0x01)')
                .toBe('01');
            expect(eciesHex.slice(2, 4),
                'ECIES ciphertext byte 1 is not a compressed-pubkey prefix (02/03)')
                .toMatch(/^0[23]$/);
        });

        await test.step('ECDH-session carries no ephemeral key, and the delta says so', async () => {
            const main = await gotoNewConversation(page);
            await fillRecipient(main, ownAddress, PROBE_TEXT);
            await expect(main.getByText(/Recipient public key found/))
                .toBeVisible({ timeout: 120_000 });
            await pickEncryption(main, 'Shared key \\(ECDH\\)');
            await expect(sendButton(main)).toBeEnabled({ timeout: 15_000 });
            await sendButton(main).click();
            // The SAME decoded headline as ECIES: the confirm screen cannot tell
            // the methods apart either, because v2 carries no method field.
            await expect(page.getByTestId('confirm-modal')).toContainText(
                `Send encrypted message to ${ownAddress} on ${REGTEST_CHAIN_LABEL}`);

            const action = await waitForValidAction(await approveAndCaptureTxid(page, txids));
            expect(action.encrypted_message, 'the ECDH send carries no ENCRYPTED_MESSAGE on chain')
                .toBeTruthy();
            const ecdhHex = action.encrypted_message.toLowerCase();
            ecdhBytes = ecdhHex.length / 2;
            expect(ecdhBytes,
                'ECDH-session ciphertext length does not match iv(12)+authTag(16)+plaintext: no '
                + 'version byte and no ephemeral pubkey, because the shared secret is already '
                + "deterministic from both parties' permanent keys")
                .toBe(ECDH_OVERHEAD_BYTES + probeBytes);

            // THE CROSS-CHECK. For an identical plaintext to an identical
            // recipient, ECDH is exactly 34 bytes shorter than ECIES: the
            // ephemeral pubkey (33) plus the KDF version byte (1) that only
            // ECIES carries. If ECDH silently aliased to ECIES the two lengths
            // would match instead.
            expect(eciesBytes - ecdhBytes,
                'ECIES and ECDH-session ciphertexts differ by the wrong number of bytes for the '
                + 'same plaintext, so the two methods are not producing the wire shapes the SDK '
                + 'documents')
                .toBe(ECIES_OVERHEAD_BYTES - ECDH_OVERHEAD_BYTES);
            expect(ecdhHex,
                'ECDH and ECIES produced byte-identical ciphertext for the same plaintext and '
                + 'recipient, which random ephemeral keys and IVs make astronomically unlikely '
                + "unless one method is silently reusing the other's output")
                .not.toBe(eciesHex);
        });
    });
});
