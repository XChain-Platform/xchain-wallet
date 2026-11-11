// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The standalone BROADCAST form's submit path (§40.6), driven against a
// live regtest chain. Only the dev-mock venue had ever exercised it, so no
// run had ever produced a signature the chain accepted, and nothing had
// proven the plain-message format with real bytes on a real node.
//
// This file drives format 0 and reads the version and message back off the
// chain's own BROADCAST row
// (`xchain-explorer`'s BROADCAST_QUERY: message / value / broadcast_fee /
// memo / action_format), independently of the wallet's own "Broadcast
// sent" screen.

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    expectConfirmModal,
    fundAddress,
    healVenueClock,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const STAMP = Date.now().toString().slice(-6);

/**
 * Onboards a fresh wallet, opens the Broadcast form on this run's chain,
 * funds the address it will sign from, and leaves the form open (freshly
 * reloaded and unlocked) ready to fill in.
 */
async function onboardOntoBroadcastForm(page, walletName) {
    await createWallet(page, { password: PASSWORD, name: walletName });
    await switchToRegtest(page, PASSWORD);

    await openPaletteCommand(page, 'Broadcast a message');
    let main = page.getByRole('main');
    await expect(main.getByLabel('Message', { exact: true })).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    const address = await main.getByLabel('From', { exact: true }).inputValue();
    expect(address, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`).toMatch(REGTEST_ADDRESS_RE);

    await fundAddress(address, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);

    await openPaletteCommand(page, 'Broadcast a message');
    main = page.getByRole('main');
    await expect(main.getByLabel('Message', { exact: true })).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    expect(await main.getByLabel('From', { exact: true }).inputValue(), 'still signing with the funded address').toBe(address);
    return { main, address };
}

/** Fills the password when the confirm screen asks for one and approves. */
async function approveConfirm(page, what = 'this action') {
    await expectConfirmModal(page, what, 90_000);
    const password = page.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    const approve = page.getByTestId('confirm-approve');
    await expect(approve, 'Approve never became enabled on the confirm screen').toBeEnabled({ timeout: 120_000 });
    await approve.click();
}

/** Reads the 64-hex-char transaction id printed on a form's done screen. */
async function readDoneTxid(page, timeoutMs = 180_000) {
    const main = page.getByRole('main');
    await expect(main, 'the done screen never printed a transaction id')
        .toContainText(/[0-9a-f]{64}/, { timeout: timeoutMs });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'no 64-hex-char transaction id found on the done screen').toBeTruthy();
    return txid;
}

test.describe(`Broadcast submit path on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test.beforeAll(async () => {
        await healVenueClock();
    });

    test('a plain message submits as v0 with no memo, value, or feed fee', async ({ page }) => {
        const text = `xc-e2e plain broadcast ${STAMP}`;
        let address;

        await test.step('onboard, fund, and submit a plain broadcast', async () => {
            const opened = await onboardOntoBroadcastForm(page, 'Broadcast Plain Wallet');
            address = opened.address;
            const main = opened.main;

            await main.getByLabel('Message', { exact: true }).fill(text);
            await main.getByRole('button', { name: 'Broadcast', exact: true }).click();

            await approveConfirm(page, 'the plain broadcast');
            const txid = await readDoneTxid(page);

            const action = await waitForValidAction(txid);
            expect(action.action, 'the submit did not record a BROADCAST action').toBe('BROADCAST');
            expect(action.source, 'the broadcast was not signed by the funded address').toBe(address);
            expect(String(action.action_format), 'the plain broadcast was not sent as v0')
                .toBe('0');
            expect(action.message, 'the on-chain MESSAGE does not match what was typed').toBe(text);
            expect(action.value, 'a plain broadcast recorded a VALUE nobody set').toBeFalsy();
            expect(action.memo, 'a plain broadcast recorded a MEMO nobody set').toBeFalsy();
        });
    });

});
