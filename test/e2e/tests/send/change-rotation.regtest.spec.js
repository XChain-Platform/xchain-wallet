// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Change-address rotation, proven on a chain rather than at a
// function boundary.
//
// The row that opened this item was found by DOING it: rotation was
// switched on, 0.05 BTC was sent, and the raw transaction paid the
// remainder straight back to the address it came from - exactly the
// address reuse the setting says it prevents. The fix (flows/
// changeAddress.js, wired at both seams that decide the wire bytes) is
// covered by 33 unit tests, but every one of them stops at
// `encoder.createTx`: they assert the wallet ASKED for a different
// change address. Whether the transaction the chain ended up holding
// pays a different address is a question only the chain can answer, and
// the original defect lived in exactly that gap.
//
// So the assertions here are made against the venue's UTXO set and not
// against anything the wallet says about itself:
//
//   1. the destination holds the amount sent, from this txid;
//   2. the funding address holds NOTHING from this txid - no change
//      came home, which is the whole claim;
//   3. some OTHER address in the wallet's own list does hold change
//      from this txid, so the leftover moved rather than being burned.
//
// (3) matters as much as (2). A wallet that dropped the change entirely
// would satisfy "no reuse" while destroying most of the user's balance,
// and the toggle copy promises the leftover MOVES, not that it vanishes.
//
// The second test is the control: the same send with rotation off, where
// change must come home. Without it, a wallet that had stopped producing
// change outputs at all would pass the first test for the wrong reason.

import { createWallet, expect, gotoSection, mainButton, openSettings, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_DESTINATION,
    encoderRpc,
    fundAddress,
    readReceiveAddress,
    switchToRegtest,
    unlockAfterReload,
    waitForConfirmedUtxo,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING_BTC = 1;
const SEND_BTC = '0.01';

function toField(page) {
    return page.getByLabel('To', { exact: true });
}

function amountField(page) {
    return page.getByRole('textbox', { name: /^Amount/ });
}

/**
 * Opens a destination through the COMMAND PALETTE.
 *
 * Same reason `wif-import.regtest.spec.js` carries its own copy: the
 * bottom bar surfaces only Home/History/Send/Scan, so `gotoSection` for
 * anything else can wait out the entire budget for a control that is
 * never coming.
 */
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

/** Opens Settings, walks into the Privacy panel, sets the rotation toggle. */
async function setRotation(page, on) {
    await openSettings(page);
    const row = page.getByRole('main').getByRole('button', { name: /^Privacy/ });
    await expect(row, 'Settings has no Privacy row').toBeVisible({ timeout: 30_000 });
    await row.click();

    const toggle = page.getByRole('switch', { name: 'Change-address rotation' });
    await expect(toggle, 'the Privacy panel did not open').toBeVisible({ timeout: 30_000 });

    // Click-then-wait rather than `.check()`: the input is controlled by
    // PERSISTED settings, so `checked` does not flip until the vault write
    // resolves, and check()'s post-click assertion is synchronous.
    if ((await toggle.isChecked()) !== on) await toggle.click();
    await expect(toggle, `privacy.changeAddressRotation did not become ${on}`)
        .toBeChecked({ checked: on, timeout: 30_000 });
}

/** Every confirmed UTXO the venue holds for `address`. */
async function utxosOf(address) {
    const result = await encoderRpc('get_utxos', { address });
    return Array.isArray(result?.utxos) ? result.utxos : [];
}

/** The UTXOs `address` received from this exact transaction. */
async function utxosFromTx(address, txid) {
    return (await utxosOf(address)).filter((u) => u.txid === txid || u.fullTxid === txid);
}

/**
 * Every address the wallet's own address list renders, across all of its
 * filter tabs.
 *
 * Read off the rendered list rather than out of storage, because the
 * address the rotation derived is only useful if the wallet SHOWS it to
 * the user - that is what the toggle's copy promises ("appears in your
 * address list as Change #N"). The row control's accessible name carries
 * the full address ("View address <addr>"), so nothing here depends on
 * how the row truncates it visually.
 */
async function walletAddresses(page) {
    const filters = page.getByRole('tablist', { name: 'Filter by address type' });
    for (let i = 0; i < 3 && await filters.count() === 0; i++) {
        const back = page.getByRole('button', { name: 'Back', exact: true });
        if (await back.count() > 0) await back.first().click();
        else await gotoPalette(page, 'Addresses');
        await filters.or(page.getByRole('status', { name: 'Loading addresses' })).first()
            .waitFor({ state: 'visible', timeout: 30_000 })
            .catch(() => {});
    }
    await expect(filters, 'never reached the address LIST').toBeVisible({ timeout: 60_000 });

    const readTab = async () => (await page.getByRole('button', { name: /^View address / })
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || el.textContent || '')))
        .map((name) => name.replace(/^View address\s+/, '').trim())
        .filter((a) => REGTEST_ADDRESS_RE.test(a));

    const found = new Set(await readTab());
    const tabs = await filters.getByRole('tab').all();
    for (const tab of tabs) {
        await tab.click().catch(() => {});
        for (const addr of await readTab()) found.add(addr);
    }
    return [...found];
}

/** Drives one send to REGTEST_DESTINATION and returns its txid. */
async function sendAndBroadcast(page) {
    await gotoSection(page, 'Send');
    await toField(page).fill(REGTEST_DESTINATION);
    await amountField(page).fill(SEND_BTC);
    await mainButton(page, 'Send').click();

    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('confirm-approve').click();

    await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
        .toBeVisible({ timeout: 120_000 });
    // The queued path would mean the node never accepted it, and a queued
    // transaction leaves no chain evidence to read.
    await expect(page.getByText('Signed. Broadcast will retry.')).toHaveCount(0);

    const txid = (await page.getByRole('main').innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
    expect(txid, 'success screen showed no transaction id').toBeTruthy();
    return txid;
}

test.describe('change-address rotation on regtest', () => {
    test.setTimeout(600_000);

    let ownAddress;

    test.beforeEach(async ({ page }) => {
        await createWallet(page, { password: PASSWORD });
        await switchToRegtest(page, PASSWORD);

        ownAddress = await readReceiveAddress(page);
        await fundAddress(ownAddress, FUNDING_BTC);

        // Balances are fetched per chain on mount; a reload is the cheapest
        // way to make the freshly-confirmed UTXO visible to the send form.
        await page.reload();
        await unlockAfterReload(page, PASSWORD);
    });

    test('with rotation ON, the change does not come back to the source address',
        async ({ page }) => {
            await setRotation(page, true);

            const fundingBefore = await utxosOf(ownAddress);
            expect(fundingBefore.length,
                'the venue never funded the wallet, so nothing below would mean anything')
                .toBeGreaterThan(0);

            const txid = await sendAndBroadcast(page);

            // The payment landed. This also mines the block the reads below need.
            const paid = await waitForConfirmedUtxo(REGTEST_DESTINATION, txid);
            expect(Number(paid.amount)).toBeCloseTo(Number(SEND_BTC), 8);

            // THE CLAIM. This is the exact read that failed on 2026-07-27:
            // out 0.05 to the destination and 0.54996808 back to the source.
            const cameHome = await utxosFromTx(ownAddress, txid);
            expect(cameHome,
                `change returned to the funding address ${ownAddress} in ${txid}: `
                + 'this is the address reuse the setting promises to prevent')
                .toEqual([]);

            // And it went somewhere the user can still spend from.
            const candidates = (await walletAddresses(page))
                .filter((a) => a !== ownAddress && a !== REGTEST_DESTINATION);

            let changeAt = null;
            for (const addr of candidates) {
                if ((await utxosFromTx(addr, txid)).length) { changeAt = addr; break; }
            }
            expect(changeAt,
                `no address the wallet lists holds the change from ${txid}. The funding address `
                + `held ${fundingBefore.length} utxo(s) and the send was ${SEND_BTC} BTC, so the `
                + `remainder has to be somewhere. Listed: ${candidates.join(', ') || '(none)'}`)
                .not.toBeNull();
        });

    test('with rotation OFF, the change does come back to the source address',
        async ({ page }) => {
            await setRotation(page, false);

            const txid = await sendAndBroadcast(page);
            await waitForConfirmedUtxo(REGTEST_DESTINATION, txid);

            const cameHome = await utxosFromTx(ownAddress, txid);
            expect(cameHome.length,
                'rotation is off, so change should have returned to the funding address; if it '
                + 'did not, the rotated case above proves nothing about the toggle')
                .toBeGreaterThan(0);
        });
});
