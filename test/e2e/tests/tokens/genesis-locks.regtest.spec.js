// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Create token" -> the CUSTOM template and its PC-06
// advanced disclosure: lock flags set AT GENESIS, in the same transaction that
// creates the token.
//
// WHY THIS IS THE ONE TO DRIVE. Every other flag the wallet writes can be
// changed later. These cannot: a lock is a one-way switch, the wizard says so
// ("Freezes DESCRIPTION. The token metadata can never be edited again"), and
// the whole claim rests on a chain rule nothing in this campaign has ever
// tested from the genesis side. Session 20 drove locking as a LATER admin edit
// and found the opposite of a working feature - D-92/, where
// `isValidLock` read a NULL prior as "already locked" and refused a lock on
// every one of the 108 ticks whose genesis omitted the flags. The fix is gated
// behind LOCK_NULL_PRIOR_UNSET. Setting the flag at genesis is the path that
// was always supposed to work, and it has never been asked.
//
// THE ASSERTION IS THE PAIR, not the flag. A token record that says
// `locks: { description: true }` proves the wallet wrote a field; it does not
// prove anything is locked. So the same token, minutes apart, from the same
// address, through the same Manage Token menu:
//
//   Mint settings (MAX_MINT, NOT locked)  -> accepted, and the chain shows the
//                                            new value
//   Description   (LOCK_DESCRIPTION set)  -> refused, `DESCRIPTION (locked)`
//
// The unlocked edit is what makes the refusal mean something: without it, a
// wallet that simply could not compose an ISSUE edit at all - which is exactly
// what D-92 looked like from the outside - would pass a lock test that only
// checked for a refusal.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/genesis-locks.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 3;
const STAMP = Date.now().toString().slice(-6);
const TICK = `CST${STAMP}`;
const SUPPLY = 1000;
/** Written at genesis, and frozen there by LOCK_DESCRIPTION in the same params. */
const DESCRIPTION = `locked at genesis ${STAMP}`;
/** What the refused edit tries to make it. It must never reach the chain. */
const NEW_DESCRIPTION = `edited after the fact ${STAMP}`;
/** MAX_MINT at genesis, deliberately left UNLOCKED so it can be the control. */
const MAX_MINT = 100;
const MAX_MINT_EDITED = 50;
/**
 * Test 2's token: an EDITION, because it is the only template that leaves mint
 * headroom (MAX_SUPPLY without MINT_SUPPLY). A Custom token always mints its
 * whole supply at genesis, so on one of those "can it still be minted" has no
 * answer to give.
 */
const MINTABLE_TICK = `LKM${STAMP}`;
const EDITION_SIZE = 100;
const EDITION_PER_TX = 10;
const EDITION_DESCRIPTION = `mintable and unlocked ${STAMP}`;

const explorerJson = async (path) => {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`);
    if (!res.ok) throw new Error(`explorer ${path} -> ${res.status}`);
    return res.json();
};

/**
 * The venue's own verdict on an ISSUE v1 description edit, taken without the
 * wallet.
 *
 * An ISSUE edit is fee-bearing, so a refused one never reaches the confirm
 * screen: the native-fee pre-flight asks for a quote, the venue answers
 * `invalid: <verdict>` with no fee, and the form stops there (see the edition
 * lane's header for the same shape). That leaves no broadcast to read a status
 * off, so the chain's answer has to be asked for directly.
 */
async function describeQuote(description, source, tick = TICK) {
    const url = new URL(`${EXPLORER_URL}/${REGTEST_COIN}/api/feequote`);
    url.searchParams.set('action', 'ISSUE');
    url.searchParams.set('params', `1|${tick}|${description}`);
    url.searchParams.set('source', source);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`feequote ISSUE v1 -> ${res.status}`);
    return res.json();
}

async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

/** §3.6: wait on the action LIST, never on a speculative index. */
async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(`No XChain action recorded for ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s. Decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}.`);
}

/** Polls the token record until `read` answers `want`, and returns it. */
async function waitForTokenField(read, want, what, tick = TICK, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const token = await explorerJson(`token/${tick}`).catch(() => null);
        last = token ? read(token) : last;
        if (String(last) === String(want)) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${what} never became ${want} (last=${last})`);
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

/** §3.5: navigate to Home FIRST, then reload, or the unlock wait times out. */
async function reloadToHome(page) {
    await gotoPalette(page, 'Home');
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
}

async function expectConfirmScreen(page) {
    const screen = page.getByTestId('confirm-modal');
    const priceAlert = page.getByText(/fee price is temporarily unavailable/);
    await screen.or(priceAlert).first().waitFor({ state: 'visible', timeout: 90_000 });
    expect(await priceAlert.count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. Venue '
        + 'state, not a wallet defect - re-seed (campaign §3.2) and re-run')
        .toBe(0);
    await expect(screen).toBeVisible({ timeout: 60_000 });
}

async function approveAndGetTxid(page) {
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled({ timeout: 120_000 });
    await approve.click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/**
 * Opens one of Manage Token's More-menu forms for TICK.
 *
 * Reached the way an owner reaches it - My Tokens is ownership-scoped, so a
 * token that is not this wallet's simply is not in the list.
 */
async function openTokenAdmin(page, item, tick = TICK) {
    await reloadToHome(page);
    await gotoPalette(page, 'My Tokens');
    const main = page.getByRole('main');
    const row = main.getByRole('button').filter({ hasText: tick }).first();
    await expect(row, `${tick} is on chain but My Tokens does not list it`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();

    await expect(page.getByRole('heading', { name: 'Manage Token' })
        .or(page.getByText('Manage Token').first()))
        .toBeVisible({ timeout: 30_000 });

    // Manage Token splits its actions between PAGE BUTTONS and the More menu,
    // and which action sits where depends on the token's state - "Mint
    // settings" is a button on this token and is absent from the menu
    // entirely, while "Description" is a menu item. A helper that only knew
    // the menu waited 30s for something that was on screen the whole time.
    // SCOPED TO `main`, and that is not tidiness: the shell's own navigation
    // carries a "Lock" button that locks the WALLET, so an unscoped lookup for
    // the token action of the same name logs the session out mid-test and the
    // failure surfaces three assertions later as a password prompt. Same trap
    // the campaign hit on "Source" in Session 31.
    const button = page.getByRole('main').getByRole('button', { name: item, exact: true });
    if (await button.count() > 0) {
        await button.first().click();
        return;
    }
    await page.getByRole('button', { name: /More/ }).last().click();
    await page.getByRole('menuitem', { name: item }).click();
}

/**
 * Onboards, funds the only address, and creates the Custom token with its
 * description LOCKED in the same genesis params. Returns that address.
 */
async function onboardAndCreateLocked(page) {
    await createWallet(page, { password: PASSWORD, name: 'Genesis Locks Wallet' });
    await switchToRegtest(page, PASSWORD);

    await gotoPalette(page, 'Issue token');
    const probe = page.getByRole('main');
    await expect(probe.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(probe);
    const source = await probe.getByLabel('From').inputValue();
    expect(source, `the wallet has no ${REGTEST_CHAIN_LABEL} address to sign with`)
        .toMatch(REGTEST_ADDRESS_RE);

    await fundAddress(source, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    await seedPrices();

    await gotoPalette(page, 'Create a token');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Custom/ }).click();
    await selectVenueChain(main);
    await main.getByRole('button', { name: 'Next', exact: true }).click();

    await expect(main.getByLabel('Token name (ticker)')).toBeVisible({ timeout: 30_000 });
    await main.getByLabel('Token name (ticker)').fill(TICK);
    await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
    await main.getByLabel('Description (optional)').fill(DESCRIPTION);
    await main.getByLabel('Max mint per transaction (optional)').fill(String(MAX_MINT));

    // The PC-06 disclosure. Deliberately NOT the "Lock this token" shortcut on
    // the same form: that sets LOCK_MAX_SUPPLY and LOCK_MINT together, and this
    // test needs exactly one flag set so the other fields stay editable and can
    // act as the control.
    await main.getByRole('button', { name: /Advanced/ }).click();
    const descriptionLock = main.getByRole('checkbox', { name: 'Description' });
    await expect(descriptionLock,
        'the advanced disclosure has no Description lock, so the lock matrix is not on this form')
        .toBeVisible({ timeout: 15_000 });
    await descriptionLock.check();

    await main.getByRole('button', { name: 'Issue token', exact: true }).click();
    await expectConfirmScreen(page);
    const issued = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(issued.status), `the venue rejected the ${TICK} genesis (${issued.status})`)
        .toBe('valid');
    return source;
}

test.describe(`genesis lock flags on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('a lock set at genesis freezes its own field and nothing else', async ({ page }) => {
        let source;

        await test.step('create a Custom token with DESCRIPTION locked in the genesis params', async () => {
            source = await onboardAndCreateLocked(page);

            const token = await explorerJson(`token/${TICK}`);
            expect(token?.info?.description,
                'the description the wizard sent is not the one the chain stored')
                .toBe(DESCRIPTION);
            expect(token?.locks?.description,
                'LOCK_DESCRIPTION did not reach the chain, so nothing below is testing a lock')
                .toBe(true);
            // The flags this test did NOT set must be off. A wizard that wrote
            // the whole lock matrix whenever one box was ticked would pass every
            // assertion about the locked field and quietly freeze the token.
            expect(token?.locks?.max_mint, 'the wizard locked MAX_MINT without being asked')
                .toBe(false);
            expect(token?.locks?.max_supply, 'the wizard locked MAX_SUPPLY without being asked')
                .toBe(false);
            expect(token?.locks?.mint, 'the wizard locked MINTING without being asked')
                .toBe(false);
            expect(Number(token?.mints?.max), 'MAX_MINT did not reach the chain').toBe(MAX_MINT);
        });

        await test.step('CONTROL: an UNLOCKED field still edits, so ISSUE edits work at all', async () => {
            await openTokenAdmin(page, 'Mint settings');
            const form = page.getByRole('main');
            const field = form.getByLabel('Max mint per transaction (optional)');
            await expect(field).toBeVisible({ timeout: 30_000 });
            await field.fill(String(MAX_MINT_EDITED));
            await form.getByRole('button', { name: /^(Save|Update|Sign)/ }).first().click();

            await expectConfirmScreen(page);
            const edited = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(edited.status),
                'the chain refused an edit to a field this token never locked - which is what D-92 '
                + 'looked like, and would make the refusal below meaningless')
                .toBe('valid');
            await waitForTokenField((t) => Number(t?.mints?.max), MAX_MINT_EDITED, 'MAX_MINT');
        });

        await test.step('THE LOCK: the same owner, the same menu, and the description will not move', async () => {
            // The chain's own answer first, so the wallet's refusal below is
            // being checked against something rather than believed.
            const quote = await describeQuote(NEW_DESCRIPTION, source);
            expect(String(quote.status),
                'the venue would ACCEPT a new description for a token whose LOCK_DESCRIPTION is set')
                .toMatch(/DESCRIPTION \(locked\)/i);

            await openTokenAdmin(page, 'Description');
            const form = page.getByRole('main');
            await expect(form.getByLabel('New description')).toBeVisible({ timeout: 30_000 });
            await form.getByLabel('New description').fill(NEW_DESCRIPTION);
            await form.getByRole('button', { name: /^(Save|Update|Sign)/ }).first().click();

            // Refused before anything is signed: the fee-bearing pre-flight
            // answers on the form, so no confirm screen opens.
            const alert = page.getByRole('alert').filter({ hasText: /DESCRIPTION \(locked\)/i });
            await expect(alert,
                'the wallet did not quote the network\'s verdict for an edit to a frozen field')
                .toBeVisible({ timeout: 90_000 });
            expect(await page.getByTestId('confirm-modal').count(),
                'an edit the network has already refused reached the confirm screen')
                .toBe(0);

            // And the field is what it was. This is the claim the wizard's
            // warning makes, measured on the chain rather than on the screen.
            const token = await explorerJson(`token/${TICK}`);
            expect(token?.info?.description,
                'the description changed despite LOCK_DESCRIPTION being set at genesis')
                .toBe(DESCRIPTION);
        });
    });

    test('locking one field later does not take away the minting it never forbade', async ({ page }) => {
        let source;

        await test.step('create a mintable EDITION and mint some of it, so minting is provably legal', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Later Lock Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const probe = page.getByRole('main');
            await expect(probe.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(probe);
            source = await probe.getByLabel('From').inputValue();
            expect(source).toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await seedPrices();

            await gotoPalette(page, 'Create a token');
            const main = page.getByRole('main');
            await main.getByRole('button', { name: /^Limited edition/ }).click();
            await selectVenueChain(main);
            await main.getByRole('button', { name: 'Next', exact: true }).click();
            await expect(main.getByLabel('Token name (ticker)')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Token name (ticker)').fill(MINTABLE_TICK);
            await main.getByLabel('Edition size').fill(String(EDITION_SIZE));
            await main.getByLabel('Copies per mint').fill(String(EDITION_PER_TX));
            await main.getByLabel('Image URL').fill(EDITION_DESCRIPTION);
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();
            await expectConfirmScreen(page);
            const issued = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(issued.status)).toBe('valid');

            // Mint once BEFORE any lock exists. This is the baseline the last
            // step is measured against: minting this token is legal, the wallet
            // offers it, and the chain accepts it.
            await reloadToHome(page);
            await gotoPalette(page, 'Mint supply');
            const mint = page.getByRole('main');
            await expect(mint.getByRole('textbox', { name: /^Amount/ })).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(mint);
            await page.getByRole('button', { name: /^Token:/ }).click();
            await page.getByLabel('Search coins or tokens').fill(MINTABLE_TICK);
            await page.getByLabel(new RegExp(`Open ${MINTABLE_TICK} details`, 'i')).first().click();
            await mint.getByRole('textbox', { name: /^Amount/ }).fill(String(EDITION_PER_TX));
            await mint.getByRole('button', { name: 'Mint', exact: true }).click();
            await expectConfirmScreen(page);
            const minted = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(minted.status), 'the chain refused a mint on an unlocked edition')
                .toBe('valid');
        });

        await test.step('THE SUCCESSFUL LOCK, owed since Session 20 and blocked on ', async () => {
            // D-92 left this leg undriven with a stated blocker: `isValidLock`
            // read a NULL prior as "already locked", so a LOCK on any token
            // whose genesis omitted the flags was refused with "<FIELD>
            // (locked)" on a flag that had never been locked. Two things have
            // changed. The fix is gated behind LOCK_NULL_PRIOR_UNSET, and this
            // token does not need it anyway: the edition template writes
            // LOCK_MAX_SUPPLY at genesis, so the prior is real rather than
            // absent.
            await openTokenAdmin(page, 'Lock', MINTABLE_TICK);
            const form = page.getByRole('main');
            const submit = form.getByRole('button', { name: 'Update token' });
            await expect(submit).toBeVisible({ timeout: 30_000 });

            const descriptionLock = form.getByRole('checkbox', { name: /^Description/ });
            await expect(descriptionLock,
                'the Lock form does not offer the Description flag on this token')
                .toBeEnabled();
            // Already locked at genesis by the edition template, and the form
            // says so rather than offering it again.
            await expect(form.getByRole('checkbox', { name: /^Max supply/ })).toBeDisabled();

            // D-165, asserted in both directions. The typed confirmation used to
            // render only in the legacy review stage, which the wallet shows to
            // WATCHER wallets alone, so an ordinary user locked a token
            // permanently with a checkbox and one click.
            await descriptionLock.check();
            await expect(submit,
                'a permanent lock is submittable without the typed confirmation')
                .toBeDisabled();
            const typed = form.getByLabel('Type LOCK to confirm');
            await expect(typed, 'the Lock form has no typed confirmation at all on this path')
                .toBeVisible({ timeout: 15_000 });
            await typed.fill('LOOK');
            await expect(submit, 'a near-miss word satisfied the confirmation').toBeDisabled();
            await typed.fill('LOCK');
            await expect(submit).toBeEnabled();
            await submit.click();

            await expectConfirmScreen(page);
            const locked = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(locked.status),
                'the chain refused a LOCK on a token whose genesis DID carry lock fields - if this '
                + 'is "DESCRIPTION (locked)" on a flag that was never locked,  has regressed')
                .toBe('valid');
            await waitForTokenField(
                (t) => t?.locks?.description, true, 'LOCK_DESCRIPTION', MINTABLE_TICK,
            );
        });

        await test.step('and minting, which the lock says nothing about, still works', async () => {
            // The chain first: LOCK_DESCRIPTION and MINT are unrelated rules,
            // and `mint.js` never consults the former.
            const url = new URL(`${EXPLORER_URL}/${REGTEST_COIN}/api/feequote`);
            url.searchParams.set('action', 'MINT');
            url.searchParams.set('params', `0|${MINTABLE_TICK}|${EDITION_PER_TX}`);
            url.searchParams.set('source', source);
            const quote = await (await fetch(url)).json();
            expect(String(quote.status),
                'the chain refuses to mint a token whose only lock is on its description')
                .toBe('valid');

            // Then the wallet. `ManageToken` derives one coarse `locked` flag
            // from an OR over description/max_supply/mint/mint_supply and hides
            // the Mint action behind it, so a token frozen only in its metadata
            // can present as unmintable. Asserted on the Manage Token page
            // itself, which is where an owner would look.
            await reloadToHome(page);
            await gotoPalette(page, 'My Tokens');
            const list = page.getByRole('main');
            const row = list.getByRole('button').filter({ hasText: MINTABLE_TICK }).first();
            await expect(row).toBeVisible({ timeout: 60_000 });
            await row.click();
            await expect(page.getByRole('heading', { name: 'Manage Token' })
                .or(page.getByText('Manage Token').first()))
                .toBeVisible({ timeout: 30_000 });

            const mintAction = page.getByRole('button', { name: 'Mint', exact: true })
                .or(page.getByRole('menuitem', { name: 'Mint', exact: true }));
            expect(await mintAction.count(),
                'Manage Token hides Mint on a token the chain will happily mint, because its coarse '
                + '`locked` flag ORs LOCK_DESCRIPTION together with the supply and mint locks - '
                + 'freezing the metadata should not retire the mint button')
                .toBeGreaterThan(0);
        });
    });
});
