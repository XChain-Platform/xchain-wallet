// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Addresses" -> the ⬜ "Import address" residual, and
// the automated guard that D-63's own correction note asks for.
//
// WHY THIS LANE AND NOT ANOTHER. It is the single lane in this wallet with FOUR
// HIGH defects behind it - D-54, D-63, D-65 and the fourth site that fixing
// D-65 exposed in `resolveActiveAddresses` - and every one of them is the SAME
// bug: `importWif` writes its Address record with `accountId: null` (§11.3.3's
// carve-out for imported keys), and one selector after another filtered those
// records out again with `a.accountId !== accId`. The allocating side and the
// selecting side disagreed about one convention, in four places, found one at a
// time by driving it live.
//
// AND ONE OF THOSE FIXES WAS WRONG THE FIRST TIME, which is the reason this file
// has to be an end-to-end read rather than a unit test. D-63's first fix
// excluded imported keys whenever a specific accountId was requested, reasoning
// that an address belonging to no account cannot belong to one account.
// AddressList always passes the active accountId, so that carve-out left the
// only consumer that matters exactly as broken as before - AND ITS UNIT TESTS
// PASSED, because they asked the question the way the fix answered it. It was
// caught only by re-running the live import. Imported keys are WALLET-scoped,
// not account-scoped.
//
// The lane was proven by hand in Session 16 (funded, made active, spent, with a
// 212-hex-char scriptSig read back off the chain). What it has never had is a
// guard that runs without a human. This is that guard.
//
// THE VECTOR IS DERIVED, NOT TRUSTED. The expected address is computed here from
// the WIF with `wif` + `tiny-secp256k1` + `bitcoinjs-lib`, independently of
// anything the wallet does, so "the wallet imported an address" cannot pass for
// "the wallet imported THE RIGHT address". A screen that pairs a key with
// somebody else's address looks perfectly correct and nothing else would catch
// it. The form's address TYPE is pinned to p2wpkh for the same reason: it makes
// the comparison an exact address rather than membership in a candidate set.
//
// HOW IT HANDLES THE SECRET, copied from `secret-reveal.regtest.spec.js`: the
// WIF is a throwaway constant for a key nobody funds on purpose, but every
// assertion about it is still reduced to a BOOLEAN or an ADDRESS before it
// reaches `expect`, because a failing matcher prints both sides.
//
// FOUR THINGS MEASURED WHILE GETTING THIS GREEN, each of which cost a run or
// would have. They are recorded because every one of them is a property of the
// SCREEN, not of this file, so the next spec to touch Addresses inherits them:
//
//   1. `gotoSection(page, 'Addresses')` NEVER RETURNS. The bottom bar surfaces
//      only Home/History/Send/Scan, the fixture falls back to a "More" button,
//      and this layout renders none - so it waits out its whole 600s budget.
//      Use the palette (`gotoPalette` below).
//   2. The "+" menu's rows are `role="menuitem"`, NOT buttons. A
//      `getByRole('button', { name: 'Import address' })` matches nothing here
//      and burns its whole budget; the earlier draft died one step later, at
//      `getByLabel('WIF private key')`, with the page still on the list.
//   3. The filter strip is a `role="tablist"` of `role="tab"`s. Same trap:
//      "Imported" is not a button.
//   4. **Use NAVIGATES AWAY.** `setAsActive` persists, then calls `onBack()` on
//      purpose, so Home remounts and refetches balances against the new active
//      address. The detail screen the button lives on is gone by the time the
//      click resolves, so the state flip cannot be read off that button - it
//      has to be re-read by walking BACK to the address. An assertion that
//      re-queries the same button can only ever time out.
//
// RUN IT:
//   cd test/e2e && npx playwright test \
//       --config=playwright.regtest.config.js tests/addresses/wif-import.regtest.spec.js

import bitcoin from 'bitcoinjs-lib';
import wifCodec from 'wif';
import * as ecc from 'tiny-secp256k1';

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

/**
 * A throwaway regtest key, from a fixed scalar so the vector never moves.
 *
 * Deliberately NOT generated per run: a hardcoded WIF whose address this file
 * recomputes is a real vector, while a randomly generated pair would only ever
 * prove the test agrees with itself.
 */
const IMPORT_WIF = 'cSztgdXf1ns4XGajHiQexSWzvLSKdhhHzBV1zpr5ZfC41jFgN5Vh';
const IMPORT_LABEL = 'E2E imported key';

/**
 * Bech32 HRP per venue chain, and the reason this spec is chain-aware at all.
 *
 * The WIF's version byte IS the network: `0xef` is what Bitcoin AND Litecoin
 * regtest both declare (`wifVersionByte` in their descriptors), so one key
 * imports onto either. Dogecoin does not - its testnet WIF byte is `0xf1` and
 * it has no bech32 form at all - so this vector is simply not valid there and
 * the spec says so rather than failing several steps later on a refusal that
 * looks like a wallet defect.
 */
const VENUE_HRP = { RBTC: 'bcrt', RLTC: 'rltc' };

/**
 * The ONE address this WIF controls at the type the spec pins, computed
 * independently of the wallet.
 *
 * The type is pinned in the form rather than left at the chain default, so this
 * can assert an EXACT address instead of membership in a candidate set - a
 * screen that pairs a key with somebody else's address passes a set test far
 * too easily. Regtest shares testnet's base58 version bytes (campaign §3.5),
 * which is what lets one network object cover both chains; only the HRP moves.
 */
function expectedP2wpkh(wif, hrp) {
    const decoded = wifCodec.decode(wif);
    const point = ecc.pointFromScalar(decoded.privateKey, decoded.compressed);
    const pubkey = Buffer.from(point);
    return bitcoin.payments.p2wpkh({
        pubkey,
        network: { ...bitcoin.networks.testnet, bech32: hrp },
    }).address;
}

/**
 * Opens a destination through the COMMAND PALETTE, not `gotoSection`.
 *
 * Measured 2026-08-03, and it cost a full 600s run: `gotoSection(page,
 * 'Addresses')` never returns here. The bottom bar surfaces only
 * Home/History/Send/Scan, so the fixture falls back to a "More" button, and at
 * this layout there is no More button either - the call then waits out its
 * entire budget for a control that is never coming. The palette reaches every
 * destination at every width, which is why `secret-reveal.regtest.spec.js`
 * carries its own copy of this too.
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

/**
 * Lands on the address LIST, from wherever this route currently is.
 *
 * The Addresses route has three screens - list, address detail, import form -
 * and the two inner ones are STATES of the same route, not routes of their own.
 * So the command palette cannot leave them: navigating to Addresses while
 * already on Addresses changes nothing, the list never renders, and the wait
 * that follows burns its whole budget on a screen that was never coming. Both
 * inner screens carry a header Back, which is the only control that pops them.
 */
async function gotoAddressList(page) {
    const filters = page.getByRole('tablist', { name: 'Filter by address type' });
    for (let i = 0; i < 3 && await filters.count() === 0; i++) {
        const back = page.getByRole('button', { name: 'Back', exact: true });
        if (await back.count() > 0) await back.first().click();
        else await gotoPalette(page, 'Addresses');
        await filters.or(page.getByRole('status', { name: 'Loading addresses' })).first()
            .waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    }
    await expect(filters, 'never reached the address LIST - see gotoAddressList on why the '
        + 'palette cannot leave the detail or the import form').toBeVisible({ timeout: 60_000 });
}

/** Opens the Imported filter on the address list. */
async function showImportedOnly(page) {
    await gotoAddressList(page);
    await page.getByRole('tablist', { name: 'Filter by address type' })
        .getByRole('tab', { name: 'Imported', exact: true }).click();
}

/** Walks to Addresses and opens the Import-address page. */
async function openImportForm(page) {
    await gotoAddressList(page);
    await page.getByRole('button', { name: 'Add or import address' }).click();
    // A `menuitem`, not a button: the "+" trailing control is
    // `aria-haspopup="menu"` over a `role="menu"` list. Asking for a button
    // here matches nothing and waits out the full timeout.
    await page.getByRole('menuitem', { name: 'Import address' }).click();
    await expect(page.getByLabel('WIF private key'), 'the + menu did not reach the import form')
        .toBeVisible({ timeout: 30_000 });
}

/**
 * Points the form's own chain picker at the venue chain.
 *
 * Not `selectVenueChain`: that helper returns early on RBTC, and this form
 * seeds its chain from `wifChainIds[0]` rather than from the active chain, so
 * on a wallet holding several regtest chains the default is whichever the
 * address table happens to list first. A WIF carries a NETWORK in its version
 * byte, so importing onto the wrong chain is refused - loudly, but several
 * steps from the cause.
 */
async function selectImportChain(page) {
    const trigger = page.getByRole('button', { name: /^Chain:/ });
    await expect(trigger, 'the import form has no Chain picker').toBeVisible({ timeout: 30_000 });
    if (((await trigger.getAttribute('aria-label')) || '').includes(REGTEST_CHAIN_LABEL)) return;
    await trigger.click();
    await page.getByRole('option', { name: new RegExp(`^${REGTEST_CHAIN_LABEL}\\b`) }).first().click();
    await expect(trigger, `the Chain picker would not move to ${REGTEST_CHAIN_LABEL}`)
        .toHaveAttribute('aria-label', new RegExp(REGTEST_CHAIN_LABEL), { timeout: 15_000 });
}

/** Fills and submits the import form. Leaves the result on screen. */
async function submitImport(page, { wif, label }) {
    await selectImportChain(page);
    // Pinned, not defaulted: the assertion downstream is an EXACT address, and
    // the chain default is free to move.
    await page.getByLabel('Address type').selectOption('p2wpkh');
    await page.getByLabel('WIF private key').fill(wif);
    if (label) await page.getByLabel('Label (optional)').fill(label);
    // The password field renders only while the signer is NOT ready: unlocked,
    // the vault key is already in hand. Conditional rather than assumed, so
    // this spec does not depend on which side of that fork the shell is on.
    const password = page.getByLabel('Wallet password', { exact: true });
    if (await password.count() > 0) await password.fill(PASSWORD);
    await page.getByRole('checkbox', { name: /not backed up by my recovery phrase/i }).check();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
}

test.describe('Addresses: importing a private key', () => {
    test.setTimeout(600_000);

    test.skip(!VENUE_HRP[REGTEST_COIN],
        `this vector is a 0xef testnet WIF, which ${REGTEST_COIN} does not use`);

    test('an imported key is derived right, stays visible, can be made active, and cannot be added twice',
        async ({ page }) => {
            const expected = expectedP2wpkh(IMPORT_WIF, VENUE_HRP[REGTEST_COIN]);

            let imported;

            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            await test.step('it imports the address the key ACTUALLY controls', async () => {
                await openImportForm(page);
                await submitImport(page, { wif: IMPORT_WIF, label: IMPORT_LABEL });

                const notice = page.getByText(/^Imported /);
                await expect(notice, 'the import never reported a result').toBeVisible({ timeout: 60_000 });
                imported = ((await notice.innerText()).match(/Imported (\S+?)\.?$/) || [])[1];

                expect(imported, `the import notice named no address: ${await notice.innerText()}`)
                    .toBeTruthy();
                expect(imported, 'the imported address is not even shaped like a regtest address')
                    .toMatch(REGTEST_ADDRESS_RE);
                // The claim that matters, and the only one a screenshot cannot
                // make: this address is derivable from THIS key. Computed here
                // from the WIF, so a wallet that imported somebody else's
                // address fails on this line.
                expect(imported === expected,
                    'the wallet imported an address this private key does NOT control, so the user '
                    + 'has been shown a key paired with the wrong address')
                    .toBe(true);
            });

            await test.step('D-63: it is still there after a full reload, under the Imported filter',
                async () => {
                    // A RELOAD, not a re-render. D-63 was a host-boundary
                    // selector dropping accountId-less records, so the records
                    // were persisted correctly the whole time and only the READ
                    // was broken - which means anything short of a fresh load
                    // can pass over the defect.
                    await page.reload();
                    await unlockAfterReload(page, PASSWORD);
                    await gotoPalette(page, 'Addresses');
                    await showImportedOnly(page);

                    await expect(page.getByRole('button', { name: `View address ${imported}` }),
                        'the imported address is not listed under the Imported filter after a reload, '
                        + 'which is D-63 exactly: the key is persisted but no selector will return it, '
                        + 'so it can never be seen, chosen or spent')
                        .toBeVisible({ timeout: 30_000 });
                });

            await test.step('D-65: pressing Use really makes it the active address', async () => {
                await page.getByRole('button', { name: `View address ${imported}` }).click();

                const use = page.getByRole('button', { name: 'Use', exact: true });
                await expect(use, 'the address detail offers no Use action').toBeVisible({ timeout: 30_000 });
                // A negative control, and it is not decoration: if the address
                // were already active the flip below would pass without the
                // button ever having worked.
                await expect(use,
                    'Use already reports this address as active before it was pressed, so the '
                    + 'assertion below would pass without the button working')
                    .toHaveAttribute('title', 'Make this the active address');

                await use.click();

                // Use NAVIGATES. `setAsActive` persists and then calls
                // `onBack()` so Home remounts against the new active address,
                // which means this screen is gone and the flip has to be
                // re-read by walking back to it. D-65 returned
                // "setActiveAddress: address does not belong to this account"
                // at the click, and fixing that exposed a FOURTH site with the
                // identical filter - so the state has to actually flip, not
                // merely fail to throw.
                await expect(use, 'Use did not leave the address detail, so setAsActive never resolved')
                    .toBeHidden({ timeout: 60_000 });

                await gotoPalette(page, 'Addresses');
                await showImportedOnly(page);
                await page.getByRole('button', { name: `View address ${imported}` }).click();

                await expect(page.getByRole('button', { name: 'Use', exact: true }),
                    'Use did not make the imported address active - D-65 and its fourth sibling in '
                    + 'resolveActiveAddresses both present exactly this way, and Send spends the '
                    + 'ACTIVE address, so an imported key that cannot be activated cannot be spent')
                    .toHaveAttribute('title', 'This is the active address', { timeout: 30_000 });
            });

            await test.step('D-67: the same key cannot be imported a second time', async () => {
                await openImportForm(page);
                await submitImport(page, { wif: IMPORT_WIF, label: 'duplicate attempt' });

                const alert = page.getByRole('alert').first();
                await expect(alert, 'a duplicate import was not refused at all')
                    .toBeVisible({ timeout: 60_000 });
                await expect(alert,
                    'the refusal does not name the address already held, which is what tells the '
                    + 'user this is their own key rather than a broken import')
                    .toContainText(imported);

                // And no second record. D-67's real damage was a duplicate row
                // that INFLATED the wallet's balance by counting one address
                // twice, so the row count is the assertion, not the message.
                await gotoPalette(page, 'Addresses');
                await showImportedOnly(page);
                await expect(page.getByRole('button', { name: `View address ${imported}` }),
                    'the refused duplicate still created a second record for one address, which is '
                    + 'how D-67 inflated a balance')
                    .toHaveCount(1);
            });
        });
});
