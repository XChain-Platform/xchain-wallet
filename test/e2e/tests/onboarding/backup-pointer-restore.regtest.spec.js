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
// SINCE restore-v2 (2026-11-14) THE BACKUP TAB TAKES A CHOSEN FILE ONLY. The
// pointer QR scan left with the paste box (test/unit/routes/ImportWallet.backupPointer.test.jsx
// pins that), so the lanes below choose the exported file instead of scanning
// a pointer, and no camera or remote host is involved. The pointer story that
// follows is the history those lanes grew from.
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
// THE PASSWORDS ARE DELIBERATELY DIFFERENT HERE. The file's password (the
// backup password) is not the one the wallet inside was sealed under, so the
// tab has to ask for the wallet's own, and a spec that reused one string for
// both would pass just as happily against code that confused them.
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

import { readShownTxid } from '../../fixtures/pendingHistory.js';
import { readFile } from 'node:fs/promises';
import {
    acknowledgeImportNotice,
    createWallet,
    expect,
    openPaletteCommand,
    openWalletPicker,
    test,
    dismissIntroCarousel,
    gotoSection,
    mainButton,
    openedWalletHome,
    unlockedShell,
    LICENSE_ACCEPTED_AT_KEY,
    LICENSE_ACCEPTED_VERSION_KEY,
} from '../../fixtures/wallet.js';
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
    approveConfirm,
} from '../../fixtures/regtest.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';
import { fieldByLabel } from '../../fixtures/fields.js';
import { chooseBackupFile, restoreBackupFile } from '../../fixtures/backupRestore.js';

const DEVICE_PASSWORD = 'regtestpassword123';
/** Deliberately NOT the device password: the two are independent by design. */
const BACKUP_PASSWORD = 'backup-envelope-password-9182';
const ORIGIN_WALLET = 'Origin Wallet';
const SECOND_DEVICE_WALLET = 'Second Device Wallet';

const BASE_URL = `http://localhost:${Number(process.env.XC_PREVIEW_PORT) || 4183}`;

const FUNDING = 1;
const SEND_AMOUNT = '0.01';

/**
 * Opens Settings via the wallet menu, then Backup and Recovery, then its
 * Encrypted backup file row, which lands straight on the export form.
 */
async function openBackupExport(page) {
    await openPaletteCommand(page, 'Settings');
    const main = page.getByRole('main');
    const group = main.getByRole('button', { name: /^Backup and Recovery\b/ }).first();
    await expect(group, 'Settings has no Backup and Recovery row').toBeVisible({ timeout: 30_000 });
    await group.click();
    const exportRow = main.getByRole('button', { name: /^Encrypted backup file\b/ });
    await expect(exportRow, 'the Backup section offers no export action')
        .toBeVisible({ timeout: 30_000 });
    await exportRow.click();
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
    await openBackupExport(page);

    await fieldByLabel(page, 'Backup password').fill(BACKUP_PASSWORD);
    await fieldByLabel(page, 'Confirm backup password').fill(BACKUP_PASSWORD);
    // Take the download route: a headless browser cannot answer the save picker.
    await page.evaluate(() => { window.showSaveFilePicker = undefined; });
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120_000 }),
        page.getByRole('main').getByRole('button', { name: 'Export Backup', exact: true }).click(),
    ]);
    const envelope = await readFile(await download.path(), 'utf8');
    // A browser download is not proof the file was kept, so the wallet asks
    // before it marks the backup done; answer it the way a user would.
    await page.getByRole('button', { name: 'I Saved the File', exact: true }).click();

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

/**
 * Attaches what a second-device page shows, for a failure that happened on it.
 *
 * The second device runs in its own context, which the
 * run's trace and failure screenshots do not cover, so without this a hang on
 * that device leaves no record of the screen it hung on.
 */
async function attachDeviceScreen(page, label, extra = {}) {
    if (!page || page.isClosed()) return;
    const info = test.info();
    const snapshot = await page.locator('body').ariaSnapshot({ timeout: 5_000 }).catch((e) => `no snapshot: ${e}`);
    await info.attach(`${label}-snapshot`, {
        body: `${JSON.stringify(extra)}\nurl: ${page.url()}\n${snapshot}`,
        contentType: 'text/plain',
    });
    const shot = await page.screenshot({ timeout: 5_000 }).catch(() => null);
    if (shot) await info.attach(`${label}-screenshot`, { body: shot, contentType: 'image/png' });
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

/**
 * Restores a chosen backup file onto a device that already has a wallet. The
 * tab asks for one password, then for the wallet's own and for this device's
 * only when each differs, so the extra fields are filled when they appear.
 */
async function restoreBackupFileInAddMode(page, { content, backupPassword, walletPassword, devicePassword }) {
    await chooseBackupFile(page, content);
    await page.getByLabel('Backup password', { exact: true }).fill(backupPassword);
    const restore = page.getByRole('button', { name: 'Restore', exact: true });
    await restore.click();
    const walletField = page.getByLabel('Wallet password', { exact: true });
    const deviceField = page.getByLabel('Your password on this device', { exact: true });
    const notice = page.getByRole('button', { name: 'Continue', exact: true });
    // At most two follow-up asks, one per extra field.
    for (let i = 0; i < 3; i += 1) {
        await walletField.or(deviceField).or(notice).first()
            .waitFor({ state: 'visible', timeout: kdfStepTimeout() });
        if (await notice.isVisible()) return;
        if (await walletField.isVisible() && !(await walletField.inputValue())) {
            await walletField.fill(walletPassword);
        }
        if (await deviceField.isVisible() && !(await deviceField.inputValue())) {
            await deviceField.fill(devicePassword);
        }
        await restore.click();
    }
}

test.describe('backup restore onto another device (§15.4)', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(900_000);

    test('a backup file restores the wallet it holds, onto another device', async ({ page, browser }) => {
        /** @type {string} */
        let envelope;

        await test.step('DEVICE ONE: create a wallet and export its encrypted backup', async () => {
            const words = await createWallet(page, { password: DEVICE_PASSWORD, name: ORIGIN_WALLET });
            envelope = await exportEnvelope(page, { walletName: ORIGIN_WALLET, words });
        });

        /** @type {import('@playwright/test').Page | null} */
        let two = null;
        const context = await freshContext(browser);
        try {
            two = await context.newPage();

            await test.step('DEVICE TWO: a different wallet on a different vault', async () => {
                await two.goto(BASE_URL);
                await createWallet(two, {
                    password: DEVICE_PASSWORD, name: SECOND_DEVICE_WALLET, navigate: false,
                });
            });

            await test.step('choose the backup file and restore', async () => {
                await openWalletPicker(two);

                await two.getByRole('button', { name: 'Add wallet' }).click();
                await two.getByRole('button', { name: 'Import wallet' }).click();
                await two.getByRole('tab', { name: 'Encrypted backup' }).click();

                // The Backup tab takes a chosen file only (restore-v2,
                // 2026-11-14): the pointer scan left with the paste box, and
                // a pointer is now resolved by saving the file it names.
                await expect(two.getByRole('button', { name: /scan/i }),
                    'the Backup tab offers a scanner again, so this spec should drive it')
                    .toHaveCount(0);
                await restoreBackupFileInAddMode(two, {
                    content: envelope,
                    backupPassword: BACKUP_PASSWORD,
                    walletPassword: DEVICE_PASSWORD,
                    devicePassword: DEVICE_PASSWORD,
                });
                // The restore ends on the donation notice; Continue is what
                // hands the wallet over, so answer it before waiting on the shell.
                await acknowledgeImportNotice(two);
                await expect(openedWalletHome(two), 'the restore never returned to an unlocked wallet')
                    .toBeVisible({ timeout: kdfStepTimeout() });
            });

            await test.step('the wallet in the file is now on this device', async () => {
                await openWalletPicker(two);

                const main = two.getByRole('main');
                await expect(main.getByText(ORIGIN_WALLET, { exact: false }).first(),
                    'device two does not hold the wallet the file held, so the restore reported '
                    + 'success over nothing')
                    .toBeVisible({ timeout: 30_000 });
                await expect(main.getByText(SECOND_DEVICE_WALLET, { exact: false }).first(),
                    'the restore replaced the wallet that was already on this device instead of '
                    + 'landing alongside it')
                    .toBeVisible({ timeout: 30_000 });
            });
        } catch (err) {
            await attachDeviceScreen(two, 'device-two');
            throw err;
        } finally {
            await context.close();
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
    test('A FRESH install restores from a backup file, and the restored wallet can sign',
        async ({ page, browser }) => {
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

            /** @type {import('@playwright/test').Page | null} */
            let two = null;
            const context = await freshContext(browser);
            try {
                two = await context.newPage();

                await test.step('DEVICE TWO: no wallet at all, and it restores from the file', async () => {
                    await openFreshRestoreScreen(two);

                    await expect(two.getByRole('button', { name: /scan/i }),
                        'the Backup tab offers a scanner again, so this spec should drive it')
                        .toHaveCount(0);
                    // A fresh install has no device password to ask for: the
                    // restored wallet keeps the password it was sealed under
                    // on device one, which the tab asks for once the backup
                    // password has opened the file. The backup password is
                    // deliberately a different string.
                    await restoreBackupFile(two, {
                        content: envelope,
                        backupPassword: BACKUP_PASSWORD,
                        walletPassword: DEVICE_PASSWORD,
                    });
                    await acknowledgeImportNotice(two);

                    await expect(unlockedShell(two),
                        'the fresh-install restore never reached an unlocked wallet - is the'
                        + 'item that says it could not, so check whether the pre-host lane is wired '
                        + 'into this shell before assuming a regression')
                        .toBeVisible({ timeout: kdfStepTimeout() });
                });

                await test.step('the device now unlocks with the wallet\'s own password', async () => {
                    // Not a formality. The vault was created here, during the
                    // restore, and a fresh install keeps the wallet's own
                    // password (restore-v2), so a reload that cannot unlock
                    // under it would strand the user.
                    await two.reload();
                    await unlockAfterReload(two, DEVICE_PASSWORD);
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
                    const main = two.getByRole('main');
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
                    await fieldByLabel(two, 'To').fill(ownAddress);
                    await two.getByRole('textbox', { name: /^Amount/ }).fill(SEND_AMOUNT);
                    await mainButton(two, 'Send').click();

                    const confirm = two.getByTestId('confirm-modal');
                    await expect(confirm,
                        'the restored wallet could not even compose a payment')
                        .toBeVisible({ timeout: 60_000 });
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
                    await approveConfirm(two);

                    await expect(two.getByRole('heading', { name: 'Broadcast pending' }),
                        'the restored wallet approved a payment that never reached the node')
                        .toBeVisible({ timeout: 180_000 });
                    await expect(two.getByText('Signed. Not broadcast yet.')).toHaveCount(0);

                    // The wallet reporting on itself is not enough. Ask the
                    // chain: a transaction signed with the wrong key never
                    // reaches a block.
                    const txid = await readShownTxid(main);
                    expect(txid, 'the success screen showed no transaction id').toBeTruthy();
                    const utxo = await waitForConfirmedUtxo(ownAddress, txid);
                    expect(Number(utxo.amount)).toBeCloseTo(Number(SEND_AMOUNT), 8);
                });
            } catch (err) {
                await attachDeviceScreen(two, 'device-two');
                throw err;
            } finally {
                await context.close();
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
    // Driven with a chosen backup file rather than a pointer: what is under
    // test here is the password check, which runs identically either way.
    //
    // The Backup tab (restore-v2, 2026-11-14) asks for ONE password and tries
    // it on the file and then on the wallet inside. Only when the file opens and
    // the wallet does not does it show a "Wallet password" field, with a line
    // saying the file opened. A fresh install has no device password at all:
    // the restored wallet keeps its own. So the distinction this test holds the
    // screen to is the two-step one: the file's password is accepted, and the
    // refusal lands on the wallet field, never on the file's.
    test('A wrong wallet password is refused at restore time, and the install stays fresh',
        async ({ page, browser }) => {
            const words = await createWallet(page, { password: DEVICE_PASSWORD, name: ORIGIN_WALLET });
            const envelope = await exportEnvelope(page, { walletName: ORIGIN_WALLET, words });

            const context = await freshContext(browser);
            try {
                const two = await context.newPage();
                await openFreshRestoreScreen(two);

                await chooseBackupFile(two, envelope);
                const backupField = two.getByLabel('Backup password', { exact: true });
                await backupField.fill(BACKUP_PASSWORD);
                await two.getByRole('button', { name: 'Restore', exact: true }).click();

                // The file's password opens the file; the wallet inside was
                // sealed under DEVICE_PASSWORD, so the screen asks for that one.
                const walletField = two.getByLabel('Wallet password', { exact: true });
                await expect(walletField, 'the file opened under its own password but the screen '
                    + 'never asked for the wallet\'s, so the user cannot tell which password to change')
                    .toBeVisible({ timeout: kdfStepTimeout() });
                await expect(two.getByText('The file opened, but the wallet inside uses a different password.'),
                    'the screen does not say the backup FILE opened, so the user cannot tell which '
                    + 'password was wrong')
                    .toBeVisible();

                await walletField.fill('not-the-password-this-wallet-used');
                await two.getByRole('button', { name: 'Restore', exact: true }).click();

                // The field's own sentence; the form-errors summary above it
                // repeats it, so the summary is filtered out.
                const fieldError = two.getByRole('alert').filter({ hasNotText: /Fix \d+ things? to continue/ });
                await expect(fieldError, 'a wrong wallet password was not refused, or the refusal '
                    + 'does not name the wallet in the backup as the wrong one')
                    .toHaveText("That password doesn't open the wallet in this backup.",
                        { timeout: kdfStepTimeout() });
                await expect(walletField, 'the refusal is not on the wallet password field')
                    .toHaveAttribute('aria-invalid', 'true');
                await expect(backupField, 'the refusal blames the file\'s password, which was right')
                    .not.toHaveAttribute('aria-invalid', 'true');

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
                await restoreBackupFile(two, {
                    content: envelope,
                    backupPassword: BACKUP_PASSWORD,
                    walletPassword: DEVICE_PASSWORD,
                });
                await acknowledgeImportNotice(two);
                await expect(openedWalletHome(two),
                    'the second attempt with the right password did not restore, so the first attempt '
                    + 'left the install in a state it cannot recover from')
                    .toBeVisible({ timeout: kdfStepTimeout() });
            } finally {
                await context.close();
            }
        });
});
