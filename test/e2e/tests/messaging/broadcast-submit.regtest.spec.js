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
// proven which wire VERSION each field combination actually selects once
// real bytes hit a real node.
//
// `BroadcastForm.jsx` maps three UI fields onto four protocol format
// versions, entirely client-side, before compose ever runs:
//
//   - Feed name empty, Value/Feed fee/Memo all empty -> v0 (message only,
//     no fee, the wallet's own zero-fee reference action - see
//     `tests/fees/protocol-fee-mandatory-lane.regtest.spec.js`).
//   - A Value present alongside a Feed fee or a non-empty memo -> v1
//     (oracle: feed name + value, memo carries the free-text body and/or the
//     UTC timestamp).
//
// This file drives both lanes and reads the version, the message, the
// value, the fee and the memo back off the CHAIN's own BROADCAST row
// (`xchain-explorer`'s BROADCAST_QUERY: message / value / broadcast_fee /
// memo / action_format), independently of the wallet's own "Broadcast
// sent" screen.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
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
// How long to wait for the indexer to record the broadcast. The fixture's 300s
// default is too short on a rail in the mirror-admission era: block B is indexed
// only after the hub stamps an oracle_prices admission height of B - 1 for this
// chain, and that stamp trails the tip. Measured 2026-09-26 on RLTC, a valid
// BROADCAST mined at 03:49:28 was indexed 9 to 10 minutes later. Fits inside the
// 30-minute test timeout below with room left for onboarding and funding.
const INDEX_BUDGET_MS = 1_200_000;

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
 * Onboards a fresh wallet, opens the Broadcast form on this run's chain,
 * funds the address it will sign from, and leaves the form open (freshly
 * reloaded and unlocked) ready to fill in.
 */
async function onboardOntoBroadcastForm(page, walletName) {
    await createWallet(page, { password: PASSWORD, name: walletName });
    await switchToRegtest(page, PASSWORD);

    await gotoPalette(page, 'Broadcast a message');
    let main = page.getByRole('main');
    await expect(main.getByLabel('Message')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    const address = await main.getByLabel('From').inputValue();
    expect(address, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`).toMatch(REGTEST_ADDRESS_RE);

    await fundAddress(address, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);

    await gotoPalette(page, 'Broadcast a message');
    main = page.getByRole('main');
    await expect(main.getByLabel('Message')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    expect(await main.getByLabel('From').inputValue(), 'still signing with the funded address').toBe(address);
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

    test('a plain message with no feed, value or fee submits as v0 with no memo and no fee', async ({ page }) => {
        const text = `xc-e2e plain broadcast ${STAMP}`;
        let address;

        await test.step('onboard, fund, and submit a plain broadcast', async () => {
            const opened = await onboardOntoBroadcastForm(page, 'Broadcast Plain Wallet');
            address = opened.address;
            const main = opened.main;

            await main.getByLabel('Message').fill(text);
            // Neither the feed name nor the value/fee fields are touched, so
            // FormatSelector has nothing that forces a memo-carrying version.
            await main.getByRole('button', { name: 'Broadcast', exact: true }).click();

            await approveConfirm(page, 'the plain broadcast');
            const txid = await readDoneTxid(page);

            const action = await waitForValidAction(txid, INDEX_BUDGET_MS);
            expect(action.action, 'the submit did not record a BROADCAST action').toBe('BROADCAST');
            expect(action.source, 'the broadcast was not signed by the funded address').toBe(address);
            expect(String(action.action_format), 'a plain broadcast with none of feed/value/fee/memo set was not sent as v0')
                .toBe('0');
            expect(action.message, 'the on-chain MESSAGE does not match what was typed').toBe(text);
            expect(action.value, 'a plain broadcast recorded a VALUE nobody set').toBeFalsy();
            expect(action.memo, 'a plain broadcast recorded a MEMO nobody set').toBeFalsy();
        });
    });

    test('a feed name with a value and a fee submits as v1, and the memo carries the typed body', async ({ page }) => {
        const feedName = `XCE2E${STAMP}`;
        const body = `xc-e2e oracle body ${STAMP}`;
        const value = '42.5';
        const feedFee = '2';
        let address;

        await test.step('onboard, fund, and submit an oracle-style broadcast', async () => {
            const opened = await onboardOntoBroadcastForm(page, 'Broadcast Oracle Wallet');
            address = opened.address;
            const main = opened.main;

            await main.getByLabel('Feed name (optional)').fill(feedName);
            await main.getByLabel('Message').fill(body);
            await main.getByLabel('Value (optional)').fill(value);
            await main.getByLabel('Feed fee (optional, %)').fill(feedFee);
            await main.getByRole('button', { name: 'Broadcast', exact: true }).click();

            await approveConfirm(page, 'the oracle broadcast');
            const txid = await readDoneTxid(page);

            const action = await waitForValidAction(txid, INDEX_BUDGET_MS);
            expect(action.action, 'the submit did not record a BROADCAST action').toBe('BROADCAST');
            expect(action.source, 'the broadcast was not signed by the funded address').toBe(address);
            expect(String(action.action_format),
                'a feed name with a value and a fee was not sent as v1').toBe('1');
            // The feed name is the wire MESSAGE for an oracle broadcast; the
            // free-text body moves to MEMO instead (BroadcastForm's own field
            // mapping), so it does not appear here.
            expect(action.message, 'the on-chain MESSAGE is not the feed name that was typed').toBe(feedName);
            expect(Number(action.value), 'the on-chain VALUE does not match what was typed').toBe(Number(value));
            expect(Number(action.broadcast_fee ?? action.fee), 'the on-chain fee does not match what was typed')
                .toBe(Number(feedFee));
            expect(action.memo, 'the free-text body never reached the on-chain MEMO').toContain(body);
        });
    });
});
