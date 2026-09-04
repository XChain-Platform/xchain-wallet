// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.6 acceptance, driven: the BIP39 passphrase is entered once, at setup,
// and never asked for again.
//
// WHAT WENT WRONG BEFORE, and why the whole file ends on a signature. A user
// created a wallet with a passphrase and could not sign anything in any shell.
// The wallet looked perfect: it unlocked, Home rendered, the addresses were
// right. The seed the signer derived from the password alone was a DIFFERENT
// seed, so there was no signer for the wallet's own addresses, and the only
// symptom was a permanently disabled Approve button. Every test here therefore
// runs past "unlocked" to a transaction the CHAIN accepted. A spec that stopped
// at an unlocked shell would have passed against the defect this spec exists
// for.
//
// THE FOUR ACCEPTANCE TESTS, one per `test()`:
//
//   AT1  a wallet created with a passphrase locks, unlocks with the password
//        alone, and signs an ISSUE. No passphrase prompt after the create
//        screen.
//   AT3  a mnemonic imported WITH its passphrase lands on the same addresses as
//        the wallet it came from, and signs with the password alone afterwards.
//        Its control imports the same words WITHOUT the passphrase and proves
//        they open a different wallet, so the match above is a claim and not a
//        tautology.
//   AT2  a wallet restored from an envelope exported by a PRE-SPEC build is
//        asked for its passphrase exactly once, refuses a wrong one without
//        touching the unlock lockout, stores the right one, and is never asked
//        again. Then it signs.
//   AT4  both halves: an export from a stored-passphrase wallet restored into a
//        fresh vault under a DIFFERENT device password signs with that new
//        password alone (the re-key leg); and the pre-spec envelope restores
//        without a validation error and routes its wallet into the capture step
//        (asserted inside AT2, which is the test that consumes it).
//   AT5  Settings, this wallet, reveal recovery phrase shows the stored
//        passphrase UNDER the words, behind the same password gate and the same
//        blur, with no copy control in that block; and a wallet created without
//        a passphrase shows nothing extra there.
//
// AT5 IS THE ONE TEST HERE THAT NEVER TOUCHES THE CHAIN, and that is correct
// rather than a gap: what it proves is that the stored secret is READABLE BACK
// by its owner. Every other test proves the wallet can use the passphrase; AT5
// proves the user has not lost it. A design that seals a passphrase onto a
// record and offers no way to read it out has taken a secret away from the
// person who owns it, which is a worse outcome than the prompt it replaced.
//
// THE LEGACY WALLET COMES FROM A BACKUP, and that is a deliberate choice rather
// than a convenience. No e2e mechanism pre-seeds a vault: the fixtures only
// `addInitScript` two license keys, while a vault is an IndexedDB blob plus
// localStorage KDF meta. Restoring a checked-in pre-spec envelope is the only
// route a browser has to a wallet in the legacy state (`passphraseEnabled`
// true, `encryptedPassphrase` null), and it happens to drive AT4's second half
// on the way. The envelope and the script that builds it live in
// `test/e2e/fixtures/`; the script's header carries its throwaway secrets.
//
// NOTHING HERE PRINTS KEY MATERIAL. Recovery phrases and passphrases are held
// in locals, compared as booleans or as derived ADDRESSES, and never
// interpolated into an assertion message. A failing `toBe` prints both sides.
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RDOGE XC_REGTEST_SSH_HOST=<regtest-host> \
//       npx playwright test --config=playwright.regtest.config.js \
//       tests/wallet/passphrase-stored.regtest.spec.js
//   From a throwaway worktree if you have one, but note the preview server
//   builds `packages/web` from the SHARED checkout either way.

import { readFile } from 'node:fs/promises';

import {
    createWallet,
    expect,
    test,
    acknowledgeDonationConsent,
    dismissIntroCarousel,
    gotoSection,
    lockButton,
    mainButton,
    unlockButton,
    unlockedShell,
    LICENSE_ACCEPTED_AT_KEY,
    LICENSE_ACCEPTED_VERSION_KEY,
} from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    expectConfirmModal,
    fundAddress,
    readReceiveAddress,
    seedPrices,
    selectVenueChain,
    selectVenueSendAsset,
    switchToRegtest,
    waitForConfirmedUtxo,
    waitForValidAction,
} from '../../fixtures/regtest.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
// The generator is imported for its CONSTANTS, not to rebuild the envelope: the
// checked-in file is the fixture, and reading its secrets from the one place
// that wrote them means the two can never drift.
import {
    ENVELOPE_PATH,
    PRE_SPEC_BACKUP_PASSWORD,
    PRE_SPEC_PASSPHRASE,
    PRE_SPEC_WALLET_NAME,
    PRE_SPEC_WALLET_PASSWORD,
} from '../../fixtures/make-pre-spec-passphrase-backup.mjs';

const PASSWORD = 'regtestpassword123';
/** The 25th word for wallets this spec creates itself. */
const PASSPHRASE = 'a-passphrase-typed-once-at-setup';
/**
 * The password the RESTORING device picks for itself, different from every
 * other password here on purpose: a re-key that silently kept the source
 * device's password would pass any spec that reused one string for two roles.
 */
const NEW_DEVICE_PASSWORD = 'this-device-password-4471';
/** Opens the envelope AT4 exports. Not the fixture's; not any device's. */
const BACKUP_PASSWORD = 'export-envelope-password-5520';

const BASE_URL = `http://localhost:${Number(process.env.XC_PREVIEW_PORT) || 4183}`;

const STAMP = Date.now().toString().slice(-6);
/**
 * Enough for an ISSUE's protocol fee plus its miner fee, and it is the protocol
 * fee that sets the number.
 *
 * An ISSUE costs 1.00 XCHAIN, and the venue converts that to COIN through the
 * price the global setup seeds: XCHAIN at $2.00, coin at $0.10, so twenty coin
 * per issuance. A 3-coin funding (which is what the older token specs use, on
 * chains whose coin the seed prices far higher) is refused on this venue by the
 * compose itself with "insufficient funds", never reaching the confirm screen -
 * a venue economics failure that reads exactly like a signing failure.
 */
const ISSUE_FUNDING = 30;
const SEND_FUNDING = 1;
const SEND_AMOUNT = '0.01';

/**
 * The one sentence the capture step exists to say. Asserted verbatim (§3.4,
 * D-RA): the step is asking a user to hand over a secret the wallet promised
 * for a year it would never keep, so the copy that says otherwise is part of
 * the acceptance test, not decoration around it.
 */
const CAPTURE_COPY =
    /It will be stored on this device, protected by your wallet password, so you are not asked again/i;

/**
 * The capture step's passphrase field.
 *
 * `exact` matters: the create and import screens label theirs "BIP39
 * passphrase", and an inexact match would find either. On the unlock screen
 * this locator finding ANYTHING is the whole failure this spec pins, so it is
 * also what the "no prompt after setup" assertions read.
 */
function capturePassphraseField(page) {
    return page.getByLabel('Passphrase', { exact: true });
}

/**
 * A browser context that has never held a wallet, with the license gate
 * pre-accepted the way the `page` fixture does it.
 *
 * Every restore lane needs one: onboarding has already run on the default
 * `page`, so a restore there can only ever reach the "a wallet already exists"
 * guard.
 */
async function freshContext(browser) {
    const context = await browser.newContext();
    await context.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch { /* the gate renders and the spec fails loudly */ }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
    return context;
}

/** Opens Settings via the command palette. */
async function openSettingsViaPalette(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill('Settings');
    await page.getByRole('option', { name: /^Settings\b/ }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** A palette command by title, for the screens with no nav destination. */
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
 * Exports this wallet's encrypted backup through the UI and returns the file.
 *
 * The envelope-shape assertions that belong to §19.4 (no phrase outside the
 * ciphertext, the magic, the algorithm) are driven by
 * `tests/onboarding/backup-pointer-restore.regtest.spec.js` and are not
 * repeated. What is checked here is only that this is a real envelope for the
 * wallet we think it is, so a later restore failure cannot be blamed on the
 * capture.
 */
async function exportEnvelope(page, walletName) {
    await openSettingsViaPalette(page);
    await page.getByRole('main').getByRole('button', { name: /^Backup/ }).first().click();

    const exportRow = page.getByRole('main').getByRole('button', { name: 'Export…', exact: true });
    await expect(exportRow, 'the Backup section offers no export action')
        .toBeVisible({ timeout: 30_000 });
    await exportRow.click();

    await page.getByLabel('Backup password', { exact: true }).fill(BACKUP_PASSWORD);
    await page.getByLabel('Confirm backup password').fill(BACKUP_PASSWORD);
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120_000 }),
        page.getByRole('button', { name: 'Export', exact: true }).click(),
    ]);
    const envelope = await readFile(await download.path(), 'utf8');

    const parsed = JSON.parse(envelope);
    expect(parsed?.magic, 'the exported file is not a §19.4 backup envelope')
        .toBe('XCHAIN-WALLET-BACKUP');
    expect(parsed?.walletName, 'the captured envelope is not this wallet\'s').toBe(walletName);
    return envelope;
}

/**
 * Walks Settings, Backup, "Back up seed phrase" and through the password gate,
 * leaving the revealed block on screen.
 *
 * The password gate is the point: the reveal runs a full Argon2id decrypt of the
 * seed blob (and, for a stored-passphrase wallet, a second unwrap of the
 * passphrase under the SAME master key), so it is budgeted like an unlock.
 */
async function revealRecoveryPhrase(page, password) {
    await openSettingsViaPalette(page);
    await page.getByRole('main').getByRole('button', { name: /^Backup/ }).first().click();

    const show = page.getByRole('main').getByRole('button', { name: 'Show…', exact: true });
    await expect(show, 'the Backup section offers no seed-phrase reveal')
        .toBeVisible({ timeout: 30_000 });
    await show.click();

    await page.getByLabel('Wallet password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByText('Your seed phrase'),
        'the wallet password did not open the reveal, so nothing below can be read back')
        .toBeVisible({ timeout: kdfStepTimeout() });
}

/**
 * The revealed panel itself, not the Settings page around it.
 *
 * Scoping matters for the no-copy-control assertion. Settings at large carries
 * copy buttons that have every right to exist (addresses, ids); the claim is
 * about THIS block, whose own hint says "Never type or paste it into anything
 * else". A page-wide sweep would fail on innocent buttons, and a sweep that was
 * loosened enough to pass would stop proving anything.
 */
function revealBlock(page) {
    return page.getByRole('button', { name: /^(Reveal|Hide) seed phrase$/ }).locator('..');
}

/** The blurred value button the reveal renders for the stored 25th word. */
function revealedPassphraseButton(page) {
    return page.getByRole('button', { name: /^(Reveal|Hide) passphrase$/ });
}

/** Walks a vault-less browser to the restore screen's Encrypted-backup tab. */
async function openFreshRestoreScreen(page) {
    await page.goto(BASE_URL);
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Import wallet' }).click();
    await page.getByRole('tab', { name: 'Encrypted backup' }).click();
}

/**
 * Restores `envelope` into a browser with no vault, under a device password of
 * this device's own choosing.
 *
 * The three fields are three different secrets and are filled from three
 * different strings everywhere this is called. A lane that confused two of them
 * would pass just as happily against a spec that did not.
 */
async function restoreOntoFreshDevice(page, {
    envelope, backupPassword, walletPassword, devicePassword,
}) {
    await openFreshRestoreScreen(page);
    await page.getByPlaceholder('{"version":1').fill(envelope);
    await page.getByLabel('Backup password', { exact: true }).fill(backupPassword);
    await page.getByLabel('Password of the wallet in this backup', { exact: true })
        .fill(walletPassword);
    await page.getByLabel('Password for this device', { exact: true }).fill(devicePassword);
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
}

/**
 * Locks, then unlocks with the PASSWORD ALONE, and asserts the wallet asked for
 * nothing else on the way through.
 *
 * This is the shape of AT1, and the shape AT2 must reach after its capture. The
 * two assertions are separate on purpose: a passphrase field ON the unlock form
 * is the retired per-session prompt, and the capture copy AFTER a successful
 * unlock is the one-time step firing when it has nothing to capture. They are
 * different defects and a run should say which one it hit.
 */
async function lockAndUnlockWithPasswordOnly(page, password) {
    await lockButton(page).click();
    await expect(unlockButton(page), 'the wallet never locked').toBeVisible({ timeout: 30_000 });

    await expect(capturePassphraseField(page),
        'the unlock screen is asking for a passphrase before the password has even been '
        + 'accepted, which is the per-unlock prompt storing it at setup removed')
        .toHaveCount(0);

    await page.getByLabel('Password', { exact: true }).fill(password);
    await unlockButton(page).click();

    await expect(unlockedShell(page),
        'the wallet did not open on its password alone, which is the whole claim of §15.6')
        .toBeVisible({ timeout: kdfStepTimeout() });
    await expect(page.getByText(CAPTURE_COPY),
        'the one-time capture step ran on a wallet whose passphrase is already stored, so the '
        + 'user is being asked for it again after all')
        .toHaveCount(0);
}

/**
 * Reads the wallet's venue-chain receive address and funds it.
 *
 * Returned rather than asserted on by the caller, because every test here
 * compares addresses rather than phrases: an address is the only thing derived
 * from mnemonic + passphrase that is safe to print in a failure message.
 */
async function fundedVenueAddress(page, amount) {
    const address = await readReceiveAddress(page);
    expect(address, 'Receive never reached a venue-chain address').toMatch(REGTEST_ADDRESS_RE);
    await fundAddress(address, amount);
    return address;
}

/**
 * Sends to the wallet's own address and waits for the CHAIN to confirm it.
 *
 * Self-send because the destination is irrelevant to what this proves - that
 * the signer the password alone produced owns this wallet's coins - and it is
 * the only destination valid on every venue chain without a per-chain literal.
 *
 * Approve being ENABLED is asserted before it is clicked. With the wrong seed
 * behind the wallet there is no signer for its own address and Approve is
 * rendered permanently disabled, so clicking straight through reports the
 * defect as a Playwright retry timeout on a dead button instead of naming it.
 */
async function signSelfSend(page, address) {
    await gotoSection(page, 'Send');
    await selectVenueSendAsset(page);
    await page.getByLabel('To', { exact: true }).fill(address);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(SEND_AMOUNT);
    await mainButton(page, 'Send').click();

    await expectConfirmModal(page, 'a self-send from a stored-passphrase wallet', 90_000);
    await expect(page.getByTestId('confirm-chain-badge')).toHaveText(REGTEST_CHAIN_LABEL);
    await expect(capturePassphraseField(page),
        'the confirm screen is asking for a passphrase, so signing still depends on a secret '
        + 'the user was told they would never type again')
        .toHaveCount(0);
    await expect(page.getByTestId('confirm-approve'),
        'the wallet composed a payment it cannot approve: it holds no signer for its own '
        + 'address, which is what a seed derived without the passphrase looks like on screen')
        .toBeEnabled({ timeout: 90_000 });
    await page.getByTestId('confirm-approve').click();

    await expect(page.getByRole('heading', { name: 'Broadcast pending' }),
        'the wallet approved a payment that never reached the node')
        .toBeVisible({ timeout: 180_000 });
    const txid = (await page.getByRole('main').innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'the success screen showed no transaction id').toBeTruthy();

    // The wallet reporting on itself is not enough: a transaction signed with
    // the wrong key never reaches a block.
    const utxo = await waitForConfirmedUtxo(address, txid);
    expect(Number(utxo.amount)).toBeCloseTo(Number(SEND_AMOUNT), 8);
}

test.describe('the BIP39 passphrase is stored at setup (§15.6)', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_500_000);

    // AT1. The create screen is the LAST place a passphrase is typed.
    test('AT1 a wallet created with a passphrase signs an ISSUE after unlocking with the password alone',
        async ({ page }) => {
            const tick = `PST${STAMP}`;
            /** @type {string} */
            let source;

            await test.step('create the wallet with a passphrase, on the venue chain', async () => {
                await createWallet(page, {
                    password: PASSWORD,
                    name: 'Stored Passphrase Wallet',
                    bip39Passphrase: PASSPHRASE,
                });
                // The network switch reloads and unlocks, with the password
                // alone and nothing else on offer. A passphrase wallet that
                // `SignerPool.populate` declines to pool is not pooled by that
                // unlock at all, so the wallet is already proven past that
                // failure by the time the ISSUE form opens.
                await switchToRegtest(page, PASSWORD);
            });

            await test.step('fund the address the Issue form will sign from', async () => {
                await gotoPalette(page, 'Issue token');
                const main = page.getByRole('main');
                await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
                await selectVenueChain(main);
                source = await main.getByLabel('From').inputValue();
                expect(source, 'the Issue form has no venue-chain address to sign with')
                    .toMatch(REGTEST_ADDRESS_RE);
                await fundAddress(source, ISSUE_FUNDING);
                await seedPrices();
            });

            await test.step('lock, and unlock with the password ONLY', async () => {
                await gotoPalette(page, 'Home');
                await lockAndUnlockWithPasswordOnly(page, PASSWORD);
            });

            await test.step('and it signs an ISSUE the chain accepts', async () => {
                await gotoPalette(page, 'Issue token');
                const form = page.getByRole('main');
                await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
                await selectVenueChain(form);
                expect(await form.getByLabel('From').inputValue(),
                    'the Issue form moved to a different address after the unlock')
                    .toBe(source);
                await form.getByLabel('Ticker').fill(tick);
                await form.getByLabel('Supply', { exact: true }).fill('1000');
                await form.getByRole('button', { name: 'Issue token', exact: true }).click();

                await expectConfirmModal(page, `the ISSUE of ${tick}`, 90_000);
                await expect(capturePassphraseField(page),
                    'the confirm screen is asking for the passphrase, so the create screen was '
                    + 'not the last place it is typed')
                    .toHaveCount(0);
                const approve = page.getByTestId('confirm-approve');
                await expect(approve,
                    'Approve is disabled on a wallet that just unlocked: the password alone did '
                    + 'not produce a signer for this wallet, leaving the unlock-time '
                    + 'passphrase bug unfixed')
                    .toBeEnabled({ timeout: 120_000 });
                await approve.click();

                const main = page.getByRole('main');
                await expect(main, 'no transaction id appeared after Approve')
                    .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
                const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
                const action = await waitForValidAction(txid);
                expect(String(action.action), 'the chain recorded something other than an ISSUE')
                    .toMatch(/ISSUE/i);
            });
        });

    // AT3. The import lane, and the report that started this work: a user who
    // imported without their passphrase "pulled up a different wallet".
    test('AT3 a mnemonic imported with its passphrase lands on the same wallet, and signs with the password alone',
        async ({ page, browser }) => {
            /** @type {string[]} */
            let words;
            /** The origin wallet's first Bitcoin address, before any switch. */
            let originAddress;
            /** @type {string} */
            let venueAddress;

            await test.step('ORIGIN: a wallet created with a passphrase', async () => {
                words = await createWallet(page, {
                    password: PASSWORD,
                    name: 'Origin Passphrase Wallet',
                    bip39Passphrase: PASSPHRASE,
                });
                await gotoSection(page, 'Receive');
                originAddress = await page.getByLabel('Address', { exact: true }).inputValue();
                expect(originAddress.length, 'the origin wallet shows no receive address')
                    .toBeGreaterThan(0);
            });

            const withPassphrase = await freshContext(browser);
            const withoutPassphrase = await freshContext(browser);
            try {
                await test.step('THE CONTROL: the same words WITHOUT the passphrase open a different wallet',
                    async () => {
                        // Without this the comparison below is a tautology: any
                        // import of the right words would match if the
                        // passphrase were ignored entirely, which is precisely
                        // the failure the user reported.
                        const control = await withoutPassphrase.newPage();
                        await importMnemonic(control, {
                            words, passphrase: null, name: 'No Passphrase Import',
                        });
                        await gotoSection(control, 'Receive');
                        const address = await control.getByLabel('Address', { exact: true }).inputValue();
                        expect(address,
                            'the same recovery phrase with and without its passphrase opened the '
                            + 'SAME wallet, so the passphrase is not reaching seed derivation and '
                            + 'the match asserted below proves nothing')
                            .not.toBe(originAddress);
                    });

                const two = await withPassphrase.newPage();

                await test.step('IMPORT: the same words WITH the passphrase land on the same addresses',
                    async () => {
                        await importMnemonic(two, {
                            words, passphrase: PASSPHRASE, name: 'Imported Passphrase Wallet',
                        });
                        await gotoSection(two, 'Receive');
                        expect(await two.getByLabel('Address', { exact: true }).inputValue(),
                            'the import derived a different first address than the wallet it came '
                            + 'from, so the passphrase typed on the import screen did not reach '
                            + 'seed derivation')
                            .toBe(originAddress);
                    });

                await test.step('and after a lock and unlock it signs with the password alone', async () => {
                    await switchToRegtest(two, PASSWORD);
                    venueAddress = await fundedVenueAddress(two, SEND_FUNDING);
                    await lockAndUnlockWithPasswordOnly(two, PASSWORD);
                    await signSelfSend(two, venueAddress);
                });
            } finally {
                await withPassphrase.close();
                await withoutPassphrase.close();
            }
        });

    // AT2, and AT4's second half. The wallet that predates the change.
    test('AT2 a pre-spec wallet is asked for its passphrase exactly once, then never again',
        async ({ browser }) => {
            const envelope = await readFile(ENVELOPE_PATH, 'utf8');
            const context = await freshContext(browser);
            try {
                const page = await context.newPage();

                await test.step('AT4b: the pre-spec envelope restores, with no validation error',
                    async () => {
                        // The record inside is at schemaVersion 2 and carries no
                        // `encryptedPassphrase` key. `put` validates against the
                        // CURRENT version and never migrates, so without the
                        // migrate-before-rekey step this restore dies inside the
                        // vault and the user's only backup is unopenable.
                        await restoreOntoFreshDevice(page, {
                            envelope,
                            backupPassword: PRE_SPEC_BACKUP_PASSWORD,
                            walletPassword: PRE_SPEC_WALLET_PASSWORD,
                            devicePassword: NEW_DEVICE_PASSWORD,
                        });
                        await expect(page.getByRole('alert'),
                            'the restore refused the pre-spec envelope. If it names the record or '
                            + 'the schema, the migration on the way out of the envelope is missing '
                            + 'and every backup taken by a pre-spec build is unrestorable')
                            .toHaveCount(0);
                        await expect(unlockedShell(page),
                            'the pre-spec envelope never reached an unlocked wallet')
                            .toBeVisible({ timeout: kdfStepTimeout() });
                    });

                await test.step('the next unlock asks for the passphrase, ONCE, and says it will store it',
                    async () => {
                        await page.reload();
                        const unlock = unlockButton(page);
                        await unlock.or(unlockedShell(page)).first()
                            .waitFor({ state: 'visible', timeout: kdfStepTimeout() });
                        await expect(unlock, 'the reload did not re-lock the vault')
                            .toBeVisible({ timeout: 30_000 });

                        // Step 1 is the password, and only the password: the
                        // collapsed 25th-word field the earlier unlock-time
                        // passphrase fix put here is gone, and its absence is
                        // half of what AT2 asserts.
                        await expect(capturePassphraseField(page),
                            'the unlock form carries a passphrase field again')
                            .toHaveCount(0);
                        await page.getByLabel('Password', { exact: true }).fill(NEW_DEVICE_PASSWORD);
                        await unlock.click();

                        // Step 2. The password was right, so the wallet is open;
                        // what it wants now is the one secret the old design
                        // never stored.
                        await expect(capturePassphraseField(page),
                            'a wallet with a passphrase and nothing stored was let through without '
                            + 'the capture step, so it is unlocked and unable to sign with no way '
                            + 'to fix itself')
                            .toBeVisible({ timeout: kdfStepTimeout() });
                        await expect(page.getByText(PRE_SPEC_WALLET_NAME),
                            'the capture step does not say WHICH wallet is asking, which is the '
                            + 'only thing that makes it answerable on a device with several')
                            .toBeVisible();
                        await expect(page.getByText(CAPTURE_COPY),
                            'the capture step does not tell the user the passphrase will be stored, '
                            + 'so it is collecting a secret under the old promise')
                            .toBeVisible();
                    });

                await test.step('a wrong passphrase is refused on that field, and costs no unlock attempt',
                    async () => {
                        await capturePassphraseField(page).fill('not-the-25th-word');
                        await page.getByRole('button', { name: 'Continue', exact: true }).click();

                        // Marked on the field, not on the password: the password
                        // was right. Read as an alert so this cannot pass on the
                        // step merely re-rendering.
                        await expect(page.getByRole('alert').first(),
                            'a wrong passphrase was accepted, or refused silently. Accepted is the '
                            + 'worse half: it would seal the WRONG string onto the record forever '
                            + 'and no password would ever open the wallet again')
                            .toBeVisible({ timeout: kdfStepTimeout() });
                        await expect(capturePassphraseField(page),
                            'the wrong passphrase threw the user back to the password step')
                            .toBeVisible();
                        await expect(page.getByText(/Too many failed attempts/i),
                            'a mistyped passphrase counted against the UNLOCK lockout, which locks '
                            + 'a user out of a wallet whose password they got right')
                            .toHaveCount(0);
                        await expect(unlockButton(page),
                            'the screen fell back to the password form, so the password would have '
                            + 'to be typed again for a mistake made one field later')
                            .toHaveCount(0);
                    });

                await test.step('the right one is accepted and the wallet opens', async () => {
                    await capturePassphraseField(page).fill(PRE_SPEC_PASSPHRASE);
                    await page.getByRole('button', { name: 'Continue', exact: true }).click();
                    await expect(unlockedShell(page),
                        'the correct passphrase did not finish the capture step')
                        .toBeVisible({ timeout: kdfStepTimeout() });
                });

                await test.step('the NEXT lock and unlock asks nothing at all', async () => {
                    // The claim of the whole spec, on the wallet that has the
                    // most to lose from it being false. If the capture did not
                    // persist, this is where it shows.
                    await lockAndUnlockWithPasswordOnly(page, NEW_DEVICE_PASSWORD);
                });

                await test.step('and it signs', async () => {
                    await switchToRegtest(page, NEW_DEVICE_PASSWORD);
                    const address = await fundedVenueAddress(page, SEND_FUNDING);
                    await signSelfSend(page, address);
                });
            } finally {
                await context.close();
            }
        });

    // AT4's first half: the re-key leg. The passphrase blob cannot ride through
    // a restore verbatim - the restore mints a fresh salt for the new seal, so
    // a carried-over blob fails its GCM tag at the first unlock and the wallet
    // opens and then derives somebody else's addresses.
    test('AT4 an export from a stored-passphrase wallet signs under a DIFFERENT device password',
        async ({ page, browser }) => {
            /** @type {string} */
            let envelope;
            /** @type {string} */
            let originAddress;

            await test.step('DEVICE ONE: a funded stored-passphrase wallet, backed up', async () => {
                await createWallet(page, {
                    password: PASSWORD,
                    name: 'Backed Up Passphrase Wallet',
                    bip39Passphrase: PASSPHRASE,
                });
                await switchToRegtest(page, PASSWORD);
                originAddress = await fundedVenueAddress(page, SEND_FUNDING);
                // Exported after the network switch: settings ride in the
                // envelope, and on a fresh vault they are applied, which is what
                // lands the restoring device on this venue's chain.
                envelope = await exportEnvelope(page, 'Backed Up Passphrase Wallet');
            });

            const context = await freshContext(browser);
            try {
                const two = await context.newPage();

                await test.step('DEVICE TWO: restore under a password device one never had', async () => {
                    await restoreOntoFreshDevice(two, {
                        envelope,
                        backupPassword: BACKUP_PASSWORD,
                        walletPassword: PASSWORD,
                        devicePassword: NEW_DEVICE_PASSWORD,
                    });
                    await expect(unlockedShell(two), 'the restore never reached an unlocked wallet')
                        .toBeVisible({ timeout: kdfStepTimeout() });
                });

                await test.step('it never asks for the passphrase, because the envelope carried it',
                    async () => {
                        await lockAndUnlockWithPasswordOnly(two, NEW_DEVICE_PASSWORD);
                    });

                await test.step('and it is device one\'s wallet, and it can spend device one\'s coins',
                    async () => {
                        const restoredAddress = await readReceiveAddress(two);
                        expect(restoredAddress,
                            'the restored device derives a different address than the wallet it '
                            + 'restored, so the re-keyed passphrase is not the one that went in')
                            .toBe(originAddress);
                        await signSelfSend(two, restoredAddress);
                    });
            } finally {
                await context.close();
            }
        });

    // AT5. The way back OUT. A passphrase the user typed once and can never
    // read again is a secret the wallet has taken from them, so the reveal row
    // is part of the bargain the capture copy makes.
    test('AT5 reveal recovery phrase shows the stored passphrase under the words, and nothing extra without one',
        async ({ page, browser }) => {
            /** @type {string[]} */
            let words;

            await test.step('a wallet created WITH a passphrase', async () => {
                words = await createWallet(page, {
                    password: PASSWORD,
                    name: 'Revealed Passphrase Wallet',
                    bip39Passphrase: PASSPHRASE,
                });
            });

            await test.step('the same password gate reveals the words AND the 25th word', async () => {
                await revealRecoveryPhrase(page, PASSWORD);

                await expect(page.getByText('Passphrase (25th word)'),
                    'the reveal shows the seed but not the stored passphrase, so a user who took '
                    + 'the capture step at its word can never read back the secret it kept')
                    .toBeVisible();

                const seed = page.getByRole('button', { name: /^(Reveal|Hide) seed phrase$/ });
                const pass = revealedPassphraseButton(page);
                await expect(pass, 'the reveal names a passphrase row but renders no value in it')
                    .toBeVisible();

                // Compared as booleans. A failing `toBe` prints both sides, and
                // one of those sides would be the passphrase itself, in a
                // report that outlives the run.
                expect((await seed.innerText()).trim() === words.join(' '),
                    'the revealed seed is not the phrase this wallet was created with')
                    .toBe(true);
                expect((await pass.innerText()).trim() === PASSPHRASE,
                    'the revealed 25th word is not the passphrase this wallet was created with. A '
                    + 'reveal that shows the WRONG string is worse than one that shows none: it '
                    + 'sends the user away to write down something that opens nothing')
                    .toBe(true);
            });

            await test.step('it sits UNDER the words, behind the same blur, toggled by the same tap',
                async () => {
                    const seed = page.getByRole('button', { name: /^(Reveal|Hide) seed phrase$/ });
                    const pass = revealedPassphraseButton(page);

                    const seedBox = await seed.boundingBox();
                    const passBox = await pass.boundingBox();
                    expect(passBox.y > seedBox.y,
                        'the passphrase is not rendered under the words, so the reveal reads as two '
                        + 'unrelated secrets rather than a phrase and its 25th word')
                        .toBe(true);

                    // Blurred on arrival is the whole guardrail: this panel opens
                    // over the user's shoulder, and the seed and the passphrase
                    // are equally fatal to leak.
                    await expect(seed).toHaveCSS('filter', /blur/);
                    await expect(pass,
                        'the passphrase is legible the moment the panel opens, while the seed above '
                        + 'it is blurred')
                        .toHaveCSS('filter', /blur/);

                    await seed.click();
                    await expect(seed).toHaveCSS('filter', 'none');
                    await expect(pass,
                        'one tap uncovers the words but leaves the passphrase blurred, so the two '
                        + 'halves of one secret are behind two different controls')
                        .toHaveCSS('filter', 'none');
                });

            await test.step('and there is no copy control anywhere in that block', async () => {
                // §15.6: the block's own hint says "Never type or paste it into
                // anything else". A clipboard button here would contradict the
                // sentence directly above it, and would put the seed on a
                // surface every other app on the device can read.
                const names = await revealBlock(page).getByRole('button').allInnerTexts();
                expect(names.length,
                    'the reveal block scoped to nothing, so the sweep below proves nothing')
                    .toBeGreaterThan(0);
                expect(names.some((t) => /copy/i.test(t)),
                    'the reveal block offers a copy control, which invites the user to put their '
                    + 'seed and passphrase on the system clipboard')
                    .toBe(false);
            });

            const context = await freshContext(browser);
            try {
                await test.step('a wallet created WITHOUT a passphrase shows nothing extra there',
                    async () => {
                        // A separate vault rather than a second wallet in this
                        // one: the reveal reads the ACTIVE wallet, and a lane
                        // that switched wallets could show the right emptiness
                        // for the wrong reason.
                        const plain = await context.newPage();
                        await plain.goto(BASE_URL);
                        await createWallet(plain, {
                            password: PASSWORD,
                            name: 'No Passphrase Wallet',
                            navigate: false,
                        });
                        await revealRecoveryPhrase(plain, PASSWORD);

                        await expect(plain.getByText('Passphrase (25th word)'),
                            'a wallet with no passphrase is offered a passphrase row, so the reveal '
                            + 'is describing a secret that does not exist')
                            .toHaveCount(0);
                        await expect(revealedPassphraseButton(plain),
                            'a wallet with no passphrase renders an empty passphrase value')
                            .toHaveCount(0);
                        await expect(plain.getByText(/25th-word passphrase/),
                            'a wallet with no passphrase is told something about a 25th word it '
                            + 'never had. That note belongs to the LEGACY state (enabled, nothing '
                            + 'stored), and showing it here would send the user hunting for a '
                            + 'passphrase to capture')
                            .toHaveCount(0);
                    });
            } finally {
                await context.close();
            }
        });
});

/**
 * Drives the Import screen's mnemonic lane, with or without a passphrase.
 *
 * Local to this spec rather than added to `fixtures/wallet.js`: the shared
 * fixture owns the CREATE walk, and one spec needing the import walk is not yet
 * a seam. Pass `passphrase: null` to leave the Advanced toggle alone, which is
 * the control AT3 needs.
 */
async function importMnemonic(page, { words, passphrase, name }) {
    await page.goto(BASE_URL);
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Import wallet' }).click();

    await page.getByLabel('Recovery phrase').fill(words.join(' '));
    await page.getByLabel('Wallet name').fill(name);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel(/^Confirm( password)?$/).fill(PASSWORD);
    if (passphrase !== null) {
        await page.getByLabel('This wallet uses a BIP39 passphrase').check();
        await page.getByLabel('BIP39 passphrase', { exact: true }).fill(passphrase);
    }
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    await acknowledgeDonationConsent(page, 'decline');
    await expect(unlockedShell(page), 'the import never reached an unlocked wallet')
        .toBeVisible({ timeout: kdfStepTimeout() });
}
