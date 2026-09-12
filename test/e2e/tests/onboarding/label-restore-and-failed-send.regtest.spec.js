// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The two halves of a tester's report, driven end to end on regtest.
//
// 1. CONTACTS SURVIVE A WIPE THROUGH THE SEED. A contact lives only
//    in the vault, and a browser that purges site data on quit erases the
//    vault. The wallet's answer is the on-chain label publish (§19.5.2) plus a
//    restore on import, and before this the restore half was never called.
//    This spec adds a contact, expects the Contacts screen to say the edit is
//    only on this device and to open Backup, publishes from there, then
//    imports the same words in a browser context that has never held a
//    wallet (the purge, as Playwright can stage it) and expects the contact
//    back on the Contacts screen with nothing typed but the phrase.
//
//    The fresh import starts on MAINNET while the payload sits on this venue's
//    regtest chain, which is exactly the tester's shape (published on testnet,
//    re-imported onto a wallet that opens on mainnet): the restore has to
//    search every chain the registry knows, not the active set.
//
// 2. A FAILED SEND IS VISIBLE IN HISTORY. A send the wallet gave up on
//    left no row anywhere before this. Here a permanent broadcast rejection is
//    injected at the encoder boundary (the signature and the classification
//    path are real), and History must show the failure with its reason and
//    let the user remove it.
//
// RUN IT ON LITECOIN, the venue the publish spec is verified on:
//   cd test/e2e && XC_REGTEST_COIN=RLTC XC_REGTEST_SSH_HOST=<venue host> \
//       npx playwright test --config=playwright.regtest.config.js \
//       tests/onboarding/label-restore-and-failed-send.regtest.spec.js

import {
    acknowledgeDonationConsent,
    createWallet,
    dismissIntroCarousel,
    expect,
    gotoSection,
    LICENSE_ACCEPTED_AT_KEY,
    LICENSE_ACCEPTED_VERSION_KEY,
    mainButton,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import {
    expectConfirmModal,
    failBroadcast,
    fundAddress,
    readReceiveAddress,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_DESTINATION,
    selectVenueSendAsset,
    switchToRegtest,
    unlockAfterReload,
    waitForValidAction,
} from '../../fixtures/regtest.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
import { LICENSE_VERSION } from '../../../../packages/core/src/buildInfo.js';

const PASSWORD = 'regtestpassword123';
/** One FILE publish (miner fees only) plus one native send that never broadcasts. */
const FUNDING = 2;
const SEND_AMOUNT = '0.01';
const BASE_URL = `http://localhost:${Number(process.env.XC_PREVIEW_PORT) || 4183}`;

const RUN_TAG = String(Date.now()).slice(-8);
const CONTACT_CANARY = `ZQ7RST${RUN_TAG}`;

/** A browser context that has never held a wallet, license gate pre-accepted. */
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

/** The words typed, the name given, nothing else: the tester's re-import. */
async function importFromPhrase(page, words, name) {
    await page.goto(BASE_URL);
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Import wallet' }).click();
    await page.getByLabel('Recovery phrase').fill(words.join(' '));
    await page.getByLabel('Wallet name').fill(name);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel(/^Confirm( password)?$/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await acknowledgeDonationConsent(page, 'decline');
    await expect(unlockedShell(page), 'the import never reached an unlocked wallet')
        .toBeVisible({ timeout: kdfStepTimeout() });
}

test.describe(`contacts restore on import and failed sends in History, on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('a contact published from the Contacts nudge comes back on a bare re-import, and a failed send shows in History', async ({ page, browser }) => {
        let words;
        let owner;
        let publishTxid;

        await test.step('create, switch to regtest, fund the address the publish signs from', async () => {
            words = await createWallet(page, { password: PASSWORD, name: 'Label Owner' });
            await switchToRegtest(page, PASSWORD);
            owner = await readReceiveAddress(page);
            expect(owner, `Receive gave no ${REGTEST_CHAIN_LABEL} address`).toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(owner, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('add a contact; the Contacts screen says it is only on this device and opens Backup', async () => {
            await gotoPalette(page, 'Contacts');
            await page.getByLabel('Add contact').first().click();
            await page.getByRole('textbox', { name: 'Name' }).fill(CONTACT_CANARY);
            await page.getByRole('textbox', { name: 'Address' }).fill(owner);
            await page.getByRole('button', { name: 'Save', exact: true }).first().click();
            await expect(page.getByText(CONTACT_CANARY).first(), 'the contact was never saved')
                .toBeVisible({ timeout: 30_000 });

            // The publish nudge: the unpublished edit is named where it was made,
            // and the one real button on the row lands on Backup.
            const nudge = page.locator('#contacts-publish-nudge');
            await expect(nudge, 'the Contacts screen never said the edit is unpublished')
                .toBeVisible({ timeout: 30_000 });
            await expect(nudge).toContainText(/only on this device/);
            await nudge.getByRole('button', { name: 'Open Backup' }).click();

            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: 'Publish now…', exact: true }),
                'Open Backup did not land on the Backup section')
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('publish the labels from Backup and wait for the chain to accept the FILE', async () => {
            const main = page.getByRole('main');
            await main.getByRole('button', { name: 'Publish now…', exact: true }).click();
            const chain = page.getByLabel('Publish chain');
            await expect(chain, 'the publish form has no chain picker').toBeVisible({ timeout: 30_000 });
            await chain.selectOption(REGTEST_CHAIN_ID);
            await page.getByLabel('Wallet password').fill(PASSWORD);
            await page.getByRole('button', { name: 'Publish', exact: true }).click();
            await expect(main.getByText('✓ Labels published'), 'the publish never reported success')
                .toBeVisible({ timeout: 180_000 });
            publishTxid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
            expect(publishTxid, 'the report shows no txid').toMatch(/^[0-9a-f]{64}$/);
            await main.getByRole('button', { name: 'Done', exact: true }).click();

            await waitForValidAction(publishTxid);
        });

        await test.step('re-import the phrase in a browser that never held a wallet: the contact is back', async () => {
            const context = await freshContext(browser);
            try {
                const restored = await context.newPage();
                await importFromPhrase(restored, words, 'Restored Owner');

                // The toast is the wallet's own claim; the list below is the
                // proof. The toast is short-lived, so it is checked softly.
                await expect.soft(restored.getByText(/Restored 1 contact/),
                    'the import did not announce the restored contact')
                    .toBeVisible({ timeout: 20_000 });

                await gotoPalette(restored, 'Contacts');
                await expect(restored.getByText(CONTACT_CANARY).first(),
                    'the contact published under this seed did not come back on import')
                    .toBeVisible({ timeout: 60_000 });
                // And the nudge stays quiet: nothing on this device is unpublished.
                await expect(restored.locator('#contacts-publish-nudge')).toHaveCount(0);
            } finally {
                await context.close();
            }
        });

        await test.step('a send whose broadcast is permanently rejected shows in History as failed, with its reason', async () => {
            await gotoSection(page, 'Send');
            await selectVenueSendAsset(page);
            await failBroadcast(page, 'permanent');
            await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
            await page.getByRole('textbox', { name: /^Amount/ }).fill(SEND_AMOUNT);
            await mainButton(page, 'Send').click();
            await expectConfirmModal(page, 'this action', 30_000);
            await page.getByTestId('confirm-approve').click();
            await expect(page.getByRole('alert').first(), 'the rejected broadcast raised no error')
                .toBeVisible({ timeout: 120_000 });
            await page.unroute(/.*/);

            await gotoPalette(page, 'History');
            const failedRow = page.locator('[data-pending-state="failed"]').first();
            await expect(failedRow, 'History shows no failed row for the rejected send')
                .toBeVisible({ timeout: 60_000 });
            await expect(failedRow).toContainText(/failed, never sent/);

            // Open it: the reason the wallet recorded, and the way out.
            await failedRow.locator('xpath=ancestor::button[1]').click();
            await expect(page.getByText(/^Reason: /), 'the failed detail shows no reason')
                .toBeVisible({ timeout: 30_000 });
            await expect(page.getByText(/bad-txns-inputs-missingorspent/),
                'the reason shown is not the node\'s rejection')
                .toBeVisible();
            await page.getByRole('button', { name: 'Remove from history', exact: true }).click();

            // Gone from the list, and only that row.
            await expect(page.locator('[data-pending-state="failed"]'),
                'the failed row survived Remove from history')
                .toHaveCount(0, { timeout: 60_000 });
        });
    });
});
