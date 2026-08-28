// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Onboarding & wallet lifecycle" -> "backup-pointer
// restore" (§15.4), plus the browser half and.
//
// THE USER STORY, from `uri/backupPointer.js`: a user publishes their encrypted
// backup somewhere (an https mirror, a self-hosted blob), keeps a small QR that
// says only WHERE it lives, and later restores from it by showing that QR to a
// wallet and typing the backup password. The pointer never carries the
// password, so a leaked pointer alone opens nothing.
//
// THREE LANES ARE DRIVEN HERE, and they are three different stories:
//
//   1. ADD mode: a device that already has a wallet takes on a second one from
//      a pointer. §15.4's original scenario.
// 2. FRESH mode: a device with NO wallet at all restores from a
//      pointer. This is the primary reason to keep a backup, it was broken from
//      the day the lane was offered until 2026-08-03, and the fix is a
//      pre-host route (`wallet.importBackup.fresh` / `importBackupLocal`)
//      because a device with no vault has no host to answer the normal one.
// 3. The restored wallet SIGNS. Landing unlocked was never the
//      bug. The bug was a wallet that unlocked and then could not sign,
//      because the seed travels in the backup still sealed under the OLD
//      device's password, and nothing re-keyed it onto this one. A restore
//      test that stopped at "unlocked" would have passed against that defect,
//      which is exactly why lane 3 ends on a chain-confirmed transaction.
//
// WHAT IS FAKED, AND WHAT IS NOT. The envelope is real (exported by the app,
// encrypted with a password the spec then has to type back in). The camera is
// real (a rendered QR replayed as a capture device; the wallet's own
// `BarcodeDetector` reads it). The chain is real. Only the REMOTE HOST is
// stood in for, by routing the one https URL the pointer names - which leaves
// the wallet's own resolver doing all of its own work: building the URL,
// enforcing https, calling fetch, checking the status, reading the body. The
// spec asserts the request the wallet actually made rather than trusting that
// it made one.
//
// THREE PASSWORDS, AND THEY ARE DELIBERATELY ALL DIFFERENT HERE.
// The restore screen asks for the password that opens the FILE, the password
// the wallet used on the device it came FROM, and the password this device
// will unlock with from now on. A spec that reused one string for two of them
// would pass just as happily against code that confused them.
//
// RUN IT:
//   cd test/e2e && npx playwright test \
//       --config=playwright.regtest.config.js tests/onboarding/backup-pointer-restore.regtest.spec.js
//   Every chain-specific value below comes from the venue table, so
//   XC_REGTEST_COIN moves the encoder, miner and expected address shape. What
//   it does NOT move is which chain the Receive screen shows: Receive follows
//   the wallet's ACTIVE chain and has no network picker (that is why the other
//   multi-chain specs read an address off a form instead), so on a non-Bitcoin
//   venue the address read fails loudly rather than funding the wrong chain.
//   Driven green on RBTC 2026-08-03.

import { readFile } from 'node:fs/promises';
import {
    createWallet, expect, test, dismissIntroCarousel, gotoSection, mainButton, unlockedShell,
    LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY,
} from '../../fixtures/wallet.js';
import { launchWithQrCamera } from '../../fixtures/qrCamera.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    fundAddress,
    readReceiveAddress,
    selectVenueSendAsset,
    switchToRegtest,
    unlockAfterReload,
    waitForConfirmedUtxo,
} from '../../fixtures/regtest.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';

const DEVICE_PASSWORD = 'regtestpassword123';
/** Deliberately NOT the device password: the two are independent by design. */
const BACKUP_PASSWORD = 'backup-envelope-password-9182';
/**
 * The password the RESTORING device picks for itself, and it matches neither
 * of the other two on purpose. is the claim that a restored wallet is
 * re-sealed onto whatever this device unlocks with; if the spec reused
 * DEVICE_PASSWORD the re-key could be a no-op and everything would still pass.
 */
const NEW_DEVICE_PASSWORD = 'this-device-password-4471';

const ORIGIN_WALLET = 'Origin Wallet';
const SECOND_DEVICE_WALLET = 'Second Device Wallet';

/** Where the pointer says the envelope lives. Nothing resolves this name. */
const ENVELOPE_URL = 'https://backup.example.test/vault/origin.json';
const POINTER_NAME = 'Origin backup';
const POINTER_QR = `xchain-backup:1?loc=${encodeURIComponent(ENVELOPE_URL)}&name=${encodeURIComponent(POINTER_NAME)}`;

const BASE_URL = `http://localhost:${Number(process.env.XC_PREVIEW_PORT) || 4183}`;

const FUNDING = 1;
const SEND_AMOUNT = '0.01';

/** Opens Settings via the command palette, then the Backup sub-page. */
async function openBackupSection(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill('Settings');
    await page.getByRole('option', { name: /^Settings\b/ }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await page.getByRole('main').getByRole('button', { name: /^Backup/ }).first().click();
}

/**
 * Exports device one's encrypted backup through the UI and returns the file.
 *
 * The fixture checks live here rather than in the caller: everything a restore
 * lane proves is meaningless if what was captured is not a real encrypted
 * envelope of the right wallet, and each of the three lanes below would
 * otherwise have to repeat the same four assertions.
 *
 * @returns {Promise<string>} the raw §19.4 envelope
 */
async function exportEnvelope(page, { walletName, words }) {
    await openBackupSection(page);

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
    expect(parsed?.encryption?.algorithm, 'the envelope is not AES-256-GCM encrypted')
        .toBe('aes-256-gcm');
    expect(typeof parsed?.payload === 'string' && parsed.payload.length > 100,
        'the envelope carries no ciphertext').toBe(true);
    // The wallet NAME rides in the clear by design (§19.4 documents it in the
    // envelope layout, so a restore screen can say which wallet a file holds
    // before asking for the password). Asserted here as the fixture check that
    // this is device one's file - and worth knowing, because a pointer
    // publishes this envelope somewhere.
    expect(parsed?.walletName, "the captured envelope is not device one's").toBe(walletName);
    // THE CLAIM THAT MATTERS: nothing outside the ciphertext leaks the seed.
    // Compared as a COUNT so no failure message can ever print a word.
    //
    // VALUES ONLY, NEVER KEY NAMES, and that is not a nicety. This was
    // originally written over `JSON.stringify(envelope)`, which includes the
    // envelope's own structure - and `magic`, `memory`, `salt` and `tag` are
    // ALL FOUR BIP39 words. Measured against the wordlist rather than guessed:
    // that spelling false-positives on 2.3% of runs with a twelve-word phrase,
    // and when it fires it announces that the backup leaked the user's
    // recovery phrase. A one-in-forty-three false alarm on a security
    // assertion is worse than no assertion, because the next reader either
    // panics or learns to wave it through. It caught a run here on 2026-08-03.
    // Nothing is weakened by dropping the keys: a real leak lands in a VALUE.
    const values = [];
    (function collect(node) {
        if (node === null || node === undefined) return;
        if (Array.isArray(node)) { node.forEach(collect); return; }
        if (typeof node === 'object') { Object.values(node).forEach(collect); return; }
        values.push(String(node));
    })({ ...parsed, payload: undefined });
    const outsideCiphertext = values.join('\n').toLowerCase();
    const leaked = words.filter((word) => new RegExp(`\\b${word}\\b`).test(outsideCiphertext)).length;
    expect(leaked,
        'the backup envelope leaks word(s) of the recovery phrase outside its encrypted '
        + 'payload, and §15.4 exists so this file can be published somewhere')
        .toBe(0);

    return envelope;
}

/**
 * Fills the restore screen's three password fields.
 *
 * The third field is labelled by MODE, and the labels are the contract: the
 * unit suites assert on exactly these strings, so a copy change that breaks a
 * user's ability to tell the three apart breaks here too.
 */
async function fillRestorePasswords(page, { backup, wallet, device, mode = 'fresh' }) {
    await page.getByLabel('Backup password', { exact: true }).fill(backup);
    await page.getByLabel('Password of the wallet in this backup', { exact: true }).fill(wallet);
    await page.getByLabel(
        mode === 'add' ? 'Your password on this device' : 'Password for this device',
        { exact: true },
    ).fill(device);
}

/**
 * A browser context that has never held a wallet, with the license gate
 * pre-accepted the same way the `page` fixture does it.
 *
 * The fresh-install lane cannot be driven from the default `page`: onboarding
 * has already run there, so `importBackupLocal`'s "a wallet already exists"
 * guard is the only thing it could ever reach.
 */
async function freshContext(browser, extra = {}) {
    const context = await browser.newContext(extra);
    await context.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch { /* gate renders and the spec fails loudly */ }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
    return context;
}

/** Walks a vault-less browser to the restore screen's Encrypted-backup tab. */
async function openFreshRestoreScreen(page) {
    await page.goto(BASE_URL);
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Import wallet' }).click();
    await page.getByRole('tab', { name: 'Encrypted backup' }).click();
}

/**
 * Reads the wallet's receive address ON THE VENUE'S CHAIN.
 *
 * STILL NOT `selectVenueChain`: the Receive screen carries no "Network" picker
 * at all - it follows the wallet's active chain - so the venue helper throws
 * "no Network chain picker on this screen" here. An earlier reading concluded
 * from that, and what was wrong, is that the spec was therefore stuck on
 * whichever chain the wallet opens on: it refused a Litecoin run at this line
 * while the Litecoin address sat two clicks away behind the field's own picker.
 * `readReceiveAddress` drives that picker (filter by network, first address of
 * that chain), which is the path a user takes, and still fails naming the shape
 * it wanted if the address map really has no address for this chain.
 */
async function readVenueReceiveAddress(page) {
    const address = await readReceiveAddress(page);
    expect(address,
        `Receive never reached a ${REGTEST_COIN} address even through its own picker`)
        .toMatch(REGTEST_ADDRESS_RE);
    return address;
}

test.describe('backup-pointer restore (§15.4)', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('a pointer QR restores the wallet it points at, onto another device', async ({ page }) => {
        /** @type {string} */
        let envelope;

        await test.step('DEVICE ONE: create a wallet and export its encrypted backup', async () => {
            const words = await createWallet(page, { password: DEVICE_PASSWORD, name: ORIGIN_WALLET });
            envelope = await exportEnvelope(page, { walletName: ORIGIN_WALLET, words });
        });

        const browser = await launchWithQrCamera(POINTER_QR);
        try {
            const context = await freshContext(browser, {
                permissions: ['camera'],
                ignoreHTTPSErrors: true,
            });

            /** Every request the wallet made for the envelope. */
            const fetched = [];
            await context.route(ENVELOPE_URL, async (route) => {
                fetched.push(route.request().url());
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: envelope,
                });
            });

            const two = await context.newPage();

            await test.step('DEVICE TWO: a different wallet on a different vault', async () => {
                await two.goto(BASE_URL);
                await createWallet(two, {
                    password: DEVICE_PASSWORD, name: SECOND_DEVICE_WALLET, navigate: false,
                });
            });

            await test.step('scan the pointer and restore', async () => {
                await two.keyboard.press('ControlOrMeta+k');
                const dialog = two.getByRole('dialog', { name: 'Command palette' });
                await expect(dialog).toBeVisible({ timeout: 15_000 });
                await dialog.getByRole('combobox').first().fill('Switch wallet');
                await two.getByRole('option', { name: /^Switch wallet/ }).first().click();
                await expect(dialog).toBeHidden({ timeout: 15_000 });

                await two.getByRole('button', { name: 'Add Wallet' }).click();
                await two.getByRole('button', { name: 'Import wallet' }).click();
                await two.getByRole('tab', { name: 'Encrypted backup' }).click();

                const scanBtn = two.getByRole('button', { name: 'Scan pointer QR', exact: true });
                await scanBtn.click();
                const cancel = two.getByRole('button', { name: 'Cancel scan', exact: true });
                await expect(cancel, 'the pointer scanner never opened').toBeVisible({ timeout: 30_000 });
                await expect(cancel, 'the pointer scanner never read the QR in front of it')
                    .toBeHidden({ timeout: 60_000 });

                const card = two.getByRole('status').filter({ hasText: /Backup pointer loaded/ });
                await expect(card, 'the scanned pointer was not accepted').toBeVisible({ timeout: 30_000 });
                await expect(card,
                    'the pointer card does not show where the backup would be fetched from, which is '
                    + 'the user\'s only chance to notice a pointer aimed somewhere they did not choose')
                    .toContainText(ENVELOPE_URL);

                // Three fields, not one. In ADD mode the device
                // password is the one this browser already unlocks with, and
                // the wallet password is device one's - which happens to be
                // the same string here only because device one and device two
                // were both created with DEVICE_PASSWORD. The fresh lane below
                // keeps all three distinct.
                await fillRestorePasswords(two, {
                    backup: BACKUP_PASSWORD,
                    wallet: DEVICE_PASSWORD,
                    device: DEVICE_PASSWORD,
                    mode: 'add',
                });
                await two.getByRole('button', { name: 'Restore', exact: true }).click();
                // A restore is a derivation like any create or unlock (the
                // backup's own password, then the device vault), so it takes
                // the shared KDF budget rather than a number picked here. The
                // 180_000 this replaced was the CI value transcribed by hand:
                // right on CI by luck, and unable to follow the budget the
                // day the budget moves.
                await expect(unlockedShell(two), 'the restore never returned to an unlocked wallet')
                    .toBeVisible({ timeout: kdfStepTimeout() });
            });

            await test.step('the wallet that was pointed at is now on this device', async () => {
                expect(fetched.length,
                    'the wallet never fetched the pointer\'s location, so whatever it restored did '
                    + 'not come from where the QR said it would')
                    .toBeGreaterThan(0);
                expect(fetched.every((u) => u.startsWith('https://')),
                    'the pointer was fetched over something other than https').toBe(true);

                await two.keyboard.press('ControlOrMeta+k');
                const dialog = two.getByRole('dialog', { name: 'Command palette' });
                await expect(dialog).toBeVisible({ timeout: 15_000 });
                await dialog.getByRole('combobox').first().fill('Switch wallet');
                await two.getByRole('option', { name: /^Switch wallet/ }).first().click();
                await expect(dialog).toBeHidden({ timeout: 15_000 });

                const main = two.getByRole('main');
                await expect(main.getByText(ORIGIN_WALLET, { exact: false }).first(),
                    'device two does not hold the wallet the pointer named, so the restore reported '
                    + 'success over nothing')
                    .toBeVisible({ timeout: 30_000 });
                await expect(main.getByText(SECOND_DEVICE_WALLET, { exact: false }).first(),
                    'the restore replaced the wallet that was already on this device instead of '
                    + 'landing alongside it')
                    .toBeVisible({ timeout: 30_000 });
            });
        } finally {
            await browser.close();
        }
    });

    // +, and this is the lane the whole file exists for.
    //
    // It used to be a `test.fail`-shaped pin asserting "wallet is locked",
    // written so it would go red the day the lane was built. That day was
    // 2026-08-03, so this is the assertion it was waiting to become.
    //
    // IT DOES NOT STOP AT "UNLOCKED". A wallet restored from a backup carries
    // its seed still sealed under the password of the device it came FROM. Get
    // that wrong and the restore looks perfect: the vault opens, Home renders,
    // the balances are right, and the failure waits until the user's first
    // spend - by which time they have thrown away the paper. So the last step
    // signs a real transaction and asks the chain whether it landed.
    test('A FRESH install restores from a pointer, and the restored wallet can sign',
        async ({ page }) => {
            /** @type {string} */
            let envelope;
            /** @type {string} */
            let ownAddress;

            await test.step('DEVICE ONE: a funded regtest wallet, backed up', async () => {
                const words = await createWallet(page, { password: DEVICE_PASSWORD, name: ORIGIN_WALLET });
                await switchToRegtest(page, DEVICE_PASSWORD);

                ownAddress = await readVenueReceiveAddress(page);
                await fundAddress(ownAddress, FUNDING);

                // Exported AFTER the network switch on purpose: settings ride
                // in the envelope, and on a fresh vault there is nothing to
                // preserve, so they are applied. That is what puts the
                // restoring device on this venue's chain rather than mainnet -
                // and it is asserted below rather than assumed.
                envelope = await exportEnvelope(page, { walletName: ORIGIN_WALLET, words });
            });

            const browser = await launchWithQrCamera(POINTER_QR);
            try {
                const context = await freshContext(browser, {
                    permissions: ['camera'],
                    ignoreHTTPSErrors: true,
                });

                const fetched = [];
                await context.route(ENVELOPE_URL, async (route) => {
                    fetched.push(route.request().url());
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: envelope,
                    });
                });

                const two = await context.newPage();

                await test.step('DEVICE TWO: no wallet at all, and it restores from the QR', async () => {
                    await openFreshRestoreScreen(two);

                    const scanBtn = two.getByRole('button', { name: 'Scan pointer QR', exact: true });
                    await expect(scanBtn,
                        'a device with no wallet is not offered the pointer scanner, so the only lane '
                        + 'that needs it most cannot be reached')
                        .toBeVisible({ timeout: 30_000 });
                    await scanBtn.click();

                    const cancel = two.getByRole('button', { name: 'Cancel scan', exact: true });
                    await expect(cancel, 'the pointer scanner never opened').toBeVisible({ timeout: 30_000 });
                    await expect(cancel, 'the pointer scanner never read the QR in front of it')
                        .toBeHidden({ timeout: 60_000 });

                    const card = two.getByRole('status').filter({ hasText: /Backup pointer loaded/ });
                    await expect(card, 'the scanned pointer was not accepted').toBeVisible({ timeout: 30_000 });
                    await expect(card).toContainText(ENVELOPE_URL);

                    // The three secrets, all different. `NEW_DEVICE_PASSWORD`
                    // is the point of the fresh lane: there is no device
                    // password yet, so the user gets to choose one, and the
                    // restored wallet has to be re-sealed onto it.
                    await fillRestorePasswords(two, {
                        backup: BACKUP_PASSWORD,
                        wallet: DEVICE_PASSWORD,
                        device: NEW_DEVICE_PASSWORD,
                        mode: 'fresh',
                    });
                    await two.getByRole('button', { name: 'Restore', exact: true }).click();

                    await expect(unlockedShell(two),
                        'the fresh-install restore never reached an unlocked wallet - is the'
                        + 'item that says it could not, so check whether the pre-host lane is wired '
                        + 'into this shell before assuming a regression')
                        .toBeVisible({ timeout: kdfStepTimeout() });
                });

                await test.step('it came from the pointer, over https', async () => {
                    expect(fetched.length,
                        'the wallet never fetched the pointer\'s location, so whatever it restored '
                        + 'did not come from where the QR said it would')
                        .toBeGreaterThan(0);
                    expect(fetched.every((u) => u.startsWith('https://')),
                        'the pointer was fetched over something other than https').toBe(true);
                });

                await test.step('the device now unlocks with the password the USER chose', async () => {
                    // Not a formality. The vault was created here, during the
                    // restore, under a password that appears nowhere in the
                    // backup - so a lane that quietly kept the source device's
                    // password would strand the user on their next reload.
                    await two.reload();
                    await unlockAfterReload(two, NEW_DEVICE_PASSWORD);
                });

                await test.step('it is device one\'s wallet, derived from device one\'s seed', async () => {
                    const restoredAddress = await readVenueReceiveAddress(two);
                    expect(restoredAddress,
                        'the restored device derives a different address than the wallet it restored, '
                        + 'so it is holding a different seed - a name match alone would not have '
                        + 'caught this')
                        .toBe(ownAddress);
                });

                await test.step('AND IT CAN SIGN: a real transaction, confirmed by the chain', async () => {
                    await gotoSection(two, 'Send');
                    // NOT `selectVenueChain`: Send has no "Network" picker
                    // either. It renders a `TokenField` whose trigger reads
                    // "Token: <TICK> on <Chain>" and whose click NAVIGATES to a
                    // picker SCREEN with no listbox on it, so the chain helper
                    // throws "no Network chain picker on this screen" - which is
                    // exactly how this line failed in the second whole-suite
                    // run. The campaign's widget map (frontier row 57) already
                    // records Send as the one form in that third bucket, and
                    // `selectVenueSendAsset` is the tool it names.
                    await selectVenueSendAsset(two);

                    // Sent to its OWN address on purpose. The destination is
                    // irrelevant to what this proves - that the restored seal
                    // opened under this device's password and produced a
                    // signature the chain accepted - and a self-send is the
                    // only destination that is valid on every venue chain
                    // without a per-chain literal.
                    await two.getByLabel('To', { exact: true }).fill(ownAddress);
                    await two.getByRole('textbox', { name: /^Amount/ }).fill(SEND_AMOUNT);
                    await mainButton(two, 'Send').click();

                    const confirm = two.getByTestId('confirm-modal');
                    await expect(confirm,
                        'the restored wallet could not even compose a payment')
                        .toBeVisible({ timeout: 60_000 });
                    await expect(two.getByTestId('confirm-chain-badge')).toHaveText(REGTEST_CHAIN_LABEL);

                    // that exact failure mode lives here, and this is the
                    // shape it takes on screen: with the seed still sealed
                    // under the OLD device's password the signer pool has no
                    // signer for this address, so Approve is rendered
                    // PERMANENTLY DISABLED. Measured by reverting
                    // `rekeyWalletRecord` to a no-op and re-running: every step
                    // above this one still passed - the vault opened, the
                    // device unlocked under its new password, the addresses
                    // matched, the payment composed - and the run died on a
                    // dead button. Asserted separately from the click so a
                    // future red run says WHY instead of timing out inside
                    // Playwright's retry loop.
                    await expect(two.getByTestId('confirm-approve'),
                        'the restored wallet composed a payment it cannot approve, which is'
                        + 'exactly - the seed is still sealed under the password of the device it '
                        + 'was backed up from, so this device holds no signer for its own address')
                        .toBeEnabled({ timeout: 60_000 });
                    await two.getByTestId('confirm-approve').click();

                    await expect(two.getByRole('heading', { name: 'Broadcast pending' }),
                        'the restored wallet approved a payment that never reached the node')
                        .toBeVisible({ timeout: 180_000 });
                    await expect(two.getByText('Signed. Not broadcast yet.')).toHaveCount(0);

                    // The wallet reporting on itself is not enough. Ask the
                    // chain: a transaction signed with the wrong key never
                    // reaches a block.
                    const txid = (await main.innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
                    expect(txid, 'the success screen showed no transaction id').toBeTruthy();
                    const utxo = await waitForConfirmedUtxo(ownAddress, txid);
                    expect(Number(utxo.amount)).toBeCloseTo(Number(SEND_AMOUNT), 8);
                });
            } finally {
                await browser.close();
            }
        });

    // The negative half, and the reason `BackupSeedPasswordError`
    // names WHICH password: two of the three can be right while the third is
    // wrong, and "wrong password" on its own sends the user back to re-type the
    // one that was already correct.
    //
    // It is also the "leaves the install fresh" claim, which is load-bearing.
    // `importBackupLocal` deliberately persists nothing until the merge has
    // succeeded; if it saved the vault first, a mistyped wallet password would
    // leave a half-onboarded install holding no wallet and no way back to
    // Welcome - and the user's next attempt would meet "a wallet already
    // exists" instead of a retry.
    //
    // Driven with a pasted envelope rather than a pointer: the pointer lane is
    // proven above, and what is under test here is the password check, which
    // runs identically either way.
    test('A wrong wallet password is refused at restore time, and the install stays fresh',
        async ({ page, browser }) => {
            const words = await createWallet(page, { password: DEVICE_PASSWORD, name: ORIGIN_WALLET });
            const envelope = await exportEnvelope(page, { walletName: ORIGIN_WALLET, words });

            const context = await freshContext(browser);
            try {
                const two = await context.newPage();
                await openFreshRestoreScreen(two);

                await two.getByPlaceholder('{"version":1').fill(envelope);
                await fillRestorePasswords(two, {
                    backup: BACKUP_PASSWORD,
                    wallet: 'not-the-password-this-wallet-used',
                    device: NEW_DEVICE_PASSWORD,
                    mode: 'fresh',
                });
                await two.getByRole('button', { name: 'Restore', exact: true }).click();

                const alert = two.getByRole('alert').first();
                await expect(alert, 'a wrong wallet password was not refused at all')
                    .toBeVisible({ timeout: 180_000 });
                // Says which one. "Wrong password" would be true and useless:
                // the file password WAS right, and the envelope did open.
                //
                // THE CLAIM IS THE DISTINCTION, NOT A PHRASE, and that is a
                // correction made 2026-08-27 on the second whole-suite run. This
                // asserted the literal string "backed-up wallet's password",
                // which the copy has never used, and reported the miss as "the
                // refusal does not tell the user WHICH password was wrong" - a
                // product defect that does not exist. What the wallet actually
                // says is better than what was demanded: it confirms the file
                // opened, names the field that is wrong, and rules out the other
                // two passwords by name. Same family as the `fees/` article
                // mismatch (D42): a spec asking for words rather than for
                // meaning accuses the product of a gap it does not have.
                await expect(alert, 'the refusal does not say the backup FILE opened, so the user '
                    + 'cannot tell which of the three passwords to change')
                    .toContainText(/backup file opened/i);
                await expect(alert, 'the refusal does not name the wallet-in-the-backup password as '
                    + 'the wrong one, which is the whole reason BackupSeedPasswordError exists')
                    .toContainText(/password of the wallet/i);
                await expect(alert, 'the refusal does not rule OUT the other two passwords, so a '
                    + 'user who mixed them up learns nothing')
                    .toContainText(/not this file's password and not the password for this device/i);
                await expect(alert).toContainText(/device it was backed up from/i);

                // Still fresh: Welcome, not an unlock screen. An unlock screen
                // here would mean a vault was written for a restore that never
                // completed, and the user would be locked out of an empty
                // install with a password they never confirmed.
                //
                // The wait comes FIRST and covers BOTH outcomes on purpose.
                // Asserting the absence of the unlock button straight after a
                // reload passes trivially against a page that has not painted
                // yet, and going through `dismissIntroCarousel` instead - which
                // is the obvious way to write this - reports the real failure as
                // a 60s timeout inside a fixture, naming a button rather than
                // the vault that is the actual problem. Measured: with the
                // vault persisted before the merge, this is the line that goes
                // red and it says why.
                await two.reload();
                const unlock = two.getByRole('button', { name: 'Unlock Wallet' });
                const welcome = two.getByRole('button', { name: 'Skip' })
                    .or(two.getByRole('button', { name: 'Create new wallet' }));
                await unlock.or(welcome).first().waitFor({ state: 'visible', timeout: 60_000 });
                await expect(unlock,
                    'a failed restore left a vault behind, so the install is no longer fresh: the '
                    + 'user is locked out of an empty wallet behind a password they never confirmed, '
                    + 'and their retry meets "a wallet already exists" instead of a second attempt')
                    .toHaveCount(0);

                await dismissIntroCarousel(two);
                await expect(two.getByRole('button', { name: 'Create new wallet' }))
                    .toBeVisible({ timeout: 60_000 });

                // And the retry works, which is the point of leaving it fresh.
                await two.getByRole('button', { name: 'Import wallet' }).click();
                await two.getByRole('tab', { name: 'Encrypted backup' }).click();
                await two.getByPlaceholder('{"version":1').fill(envelope);
                await fillRestorePasswords(two, {
                    backup: BACKUP_PASSWORD,
                    wallet: DEVICE_PASSWORD,
                    device: NEW_DEVICE_PASSWORD,
                    mode: 'fresh',
                });
                await two.getByRole('button', { name: 'Restore', exact: true }).click();
                await expect(unlockedShell(two),
                    'the second attempt with the right password did not restore, so the first attempt '
                    + 'left the install in a state it cannot recover from')
                    .toBeVisible({ timeout: kdfStepTimeout() });
            } finally {
                await context.close();
            }
        });
});
