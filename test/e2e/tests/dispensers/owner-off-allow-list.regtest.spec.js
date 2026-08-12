// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Dispensers": the GET_ADDRESS half of the allow-list
// trap - a ⬜ that `allow-list-gate.regtest.spec.js` NAMED in a comment and
// then deliberately stepped around by putting the seller on its own list.
//
// THE TRAP. `dispense.js` checks a dispenser's allow-list against TWO addresses
// on every fill: the payer (`SOURCE`) and the dispenser's own pay-to address
// (`GET_ADDRESS`). An owner who lists their customers - the obvious reading of
// "allow list" - and not themselves builds a dispenser that refuses EVERY sale,
// including from the very buyers they just allowed. Six list gates run per
// dispense and each has its own verdict, so the chain says which one refused:
// `invalid: GET_ADDRESS (dispenser allow list)`.
//
// WHY IT IS WORTH A RUN OF ITS OWN. It is not a wallet defect and this spec
// does not claim one; it is a protocol rule with a shape that invites the
// mistake, and the wallet's create form offers "Set allow-list" with no hint
// that the owner belongs on it. What a run settles that reading cannot: whether
// the refusal is attributable (does the chain name GET_ADDRESS, or something
// vaguer that a seller would blame on the buyer?), and what it COSTS - a
// dispenser is triggered by a bare coin payment, so the buyer has already paid
// by the time the gate runs.
//
// THE CONTROLLED PAIR IS THE POINT, and it is inside ONE run on purpose. Two
// sellers, two lists, ONE buyer paying the same amount twice, minutes apart, on
// one venue state. The lists differ in exactly one member: seller B's list
// carries B's own address, seller A's does not. A one-sided run cannot tell
// "the owner was off the list" from a stale list index, an empty stored list,
// a dispenser that was never open, or a buyer the chain rejects for its own
// reasons - all of which produce a refused dispense too.
//
// TWO SELLER WALLETS RATHER THAN TWO ADDRESSES OF ONE, for a mechanical reason:
// a dispenser opens on its SOURCE (D-15), and two dispensers sharing one
// address would leave "which one did this payment trigger?" for the chain to
// decide, which is exactly the ambiguity a controlled pair exists to remove.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dispensers/owner-off-allow-list.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    mintXchain,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 2;
const TICK = 'XCHAIN';
const MINT = 1000;
const GIVE_PER_FILL = 25;
const ESCROW = 100;
/** Coin a buyer sends to trigger exactly one fill. */
const TRIGGER = '0.05';

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

async function mineIfPending() {
    try {
        const status = await explorerJson('status');
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient */ }
}

/**
 * The address's confirmed NATIVE-COIN balance in sats.
 *
 * Read from `/api/address/<addr>`, NOT from `/api/balances/<addr>`. Measured on
 * this venue 2026-07-31, on Litecoin AND Bitcoin: the balances endpoint carries
 * TOKEN rows only, with no native-coin row for any address, so a helper that
 * filters it for `LTC` returns 0 every time - and a before/after subtraction
 * over two zeroes is 0, which reads as "the refused payment cost the buyer
 * nothing". This spec's first draft did exactly that and the assertion below
 * caught it, which is the whole reason it demands a POSITIVE spend rather than
 * a non-negative one: a measurement that cannot fail proves nothing.
 * `allow-list-gate.regtest.spec.js` measures the same thing a different and
 * equally valid way, by summing `encoderRpc('get_utxos')`; the explorer read is
 * used here because it needs no second service.
 */
async function coinBalanceSats(address) {
    const body = await explorerJson(`address/${address}`).catch(() => null);
    const confirmed = body?.balances?.confirmed;
    return confirmed == null ? 0 : Math.round(Number(confirmed) * 1e8);
}

/** The highest action index the chain has judged so far, used as a watermark. */
async function tipActionIndex() {
    const list = await explorerJson('actions?limit=1').catch(() => null);
    return Number(list?.data?.[0]?.action_index ?? 0);
}

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

/**
 * The DISPENSE this payer triggered AFTER `afterIndex`, whatever verdict it got.
 *
 * The watermark is not optional here the way it is in the sibling spec: this
 * run has ONE buyer paying TWICE, so a bare "find a DISPENSE by this payer"
 * would return the first payment's verdict for the second payment and the
 * control would silently assert nothing.
 */
async function waitForDispenseBy(payer, afterIndex, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => String(r.action) === 'DISPENSE'
            && String(r.source) === payer
            && Number(r.action_index) > afterIndex);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`no DISPENSE after #${afterIndex} was ever recorded for a payment from ${payer}: `
        + 'the coin left the payer and the chain did not even judge it');
}

async function giveRemaining(index) {
    const row = await explorerJson(`action/${index}`);
    const v = row?.state?.give_remaining ?? row?.give_remaining;
    return v == null ? null : Number(v);
}

async function waitForEscrow(index, expected, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await giveRemaining(index).catch(() => last);
        if (last === expected) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`dispenser #${index} escrow never reached ${expected} (last=${last})`);
}

async function waitForCredit(address, tick, min, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = 0;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last >= min) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
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

async function expectConfirmModal(page) {
    const modal = page.getByTestId('confirm-modal');
    const priceAlert = page.getByText(/fee price is temporarily unavailable/);
    await modal.or(priceAlert).first().waitFor({ state: 'visible', timeout: 60_000 });
    expect(await priceAlert.count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. Venue '
        + 'state, not a wallet defect - re-seed (campaign §3.2) and re-run')
        .toBe(0);
    await expect(modal).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
}

async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/**
 * Creates a wallet and returns its address on THIS venue's chain.
 *
 * Read off the Issue form rather than Receive: Receive answers for the ACTIVE
 * chain, and a wallet added mid-session is active on whichever chain the app
 * lists first, so on a Litecoin run it hands back a Bitcoin address.
 */
async function addWalletAndReadAddress(page, name) {
    await gotoPalette(page, 'Switch wallet');
    await page.getByRole('button', { name: 'Add Wallet' }).click();
    await createWallet(page, { password: PASSWORD, name, navigate: false });
    await gotoPalette(page, 'Switch wallet');
    await page.getByRole('button', { name: new RegExp(name) }).first().click();
    await expect(page.getByRole('button', { name: new RegExp(name) }).first(),
        `the app did not switch to ${name}`)
        .toBeVisible({ timeout: 30_000 });

    await gotoPalette(page, 'Issue token');
    const form = page.getByRole('main');
    await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(form);
    const address = await form.getByLabel('From').inputValue();
    expect(address, `${name} has no ${REGTEST_CHAIN_LABEL} address`).toMatch(REGTEST_ADDRESS_RE);
    return address;
}

async function switchToWallet(page, name) {
    await gotoPalette(page, 'Switch wallet');
    await page.getByRole('button', { name: new RegExp(name) }).first().click();
    await expect(page.getByRole('button', { name: new RegExp(name) }).first(),
        `the app did not switch to ${name}`)
        .toBeVisible({ timeout: 30_000 });
}

/**
 * Sends `amount` of the venue's native coin to `to` from the active wallet.
 *
 * HOME FIRST, and it is not tidiness: this spec pays TWICE from one wallet, and
 * a palette command for the route you are already on is a no-op (D-117). After
 * the first payment the Send route is still mounted on its "Broadcast pending"
 * result screen, so the second call would find no form at all - which surfaces
 * as "Change asset never appeared" several lines later.
 */
async function payCoin(page, to, amount) {
    await page.getByRole('button', { name: 'Home', exact: true }).first().click();
    await gotoPalette(page, 'Send');
    const main = page.getByRole('main');
    const coin = REGTEST_COIN.slice(1);
    // The Send form has no chain picker (D-140): it follows the SELECTED
    // ASSET's chain, and a NATIVE row is named for its CHAIN, not its ticker.
    await page.getByRole('button', { name: /Change asset/ }).click();
    await page.getByLabel('Search coins or tokens').fill(coin);
    await page.getByLabel(new RegExp(`Open ${REGTEST_CHAIN_LABEL} details`, 'i')).first().click();
    await expect(main.getByRole('textbox', { name: new RegExp(`^Amount \\(${coin}\\)`) }),
        `the Send form is composing on the wrong chain: no ${coin} amount field`)
        .toBeVisible({ timeout: 30_000 });

    await page.getByLabel('To', { exact: true }).fill(to);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(amount);
    await main.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('confirm-approve').click();
    await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
        .toBeVisible({ timeout: 180_000 });
}

/**
 * Publishes an address LIST and returns its action index, asserting the stored
 * MEMBERSHIP rather than trusting the action's verdict.
 *
 * The indexer marks a LIST valid while dropping items it rejects into
 * `list_items_invalid`, so "the LIST is valid" is not "the list holds what was
 * asked for" - and on this spec a silently-dropped member would turn the
 * control into a second copy of the trap.
 */
async function publishList(page, members) {
    await gotoPalette(page, 'Create a list');
    const main = page.getByRole('main');
    await expect(main.getByLabel('List type')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);

    await main.getByLabel('List type').selectOption('2');
    await main.getByLabel('Addresses', { exact: true }).fill(members.join('\n'));
    await expect(main, 'the list form did not accept these addresses for this chain')
        .toContainText(`${members.length} valid address`);

    await main.getByRole('button', { name: /^(Publish list|Review)$/ }).click();
    await expectConfirmModal(page);
    const published = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(published.action)).toBe('LIST');
    expect(String(published.status), 'the chain rejected the LIST').toBe('valid');

    const index = String(published.action_index);
    const stored = (published.list || published.items || published.members || [])
        .map((row) => String(typeof row === 'object' ? (row.address ?? row.item ?? '') : row));
    expect(stored.sort(), `list #${index} did not store the addresses it was given`)
        .toEqual([...members].sort());
    return index;
}

/**
 * Opens a dispenser on the active wallet's address, bound to `listIndex`.
 *
 * `expectSelfWarning` asserts D-161's guard on the way past: the form reads the
 * bound list's members and says so when this dispenser's own pay-to address is
 * missing. Asserted in BOTH directions across the two calls, because a warning
 * that is always on is the same as no warning.
 */
async function openDispenser(page, listIndex, { expectSelfWarning }) {
    await gotoPalette(page, 'Create dispenser');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);

    await main.getByRole('button', { name: /^Token/ }).click();
    await page.getByText(TICK, { exact: true }).first().click();
    await main.getByLabel('Give amount (per fill)').fill(String(GIVE_PER_FILL));
    await main.getByLabel('Escrow amount').fill(String(ESCROW));
    await main.getByLabel(/Trigger price/).fill(TRIGGER);

    await main.getByRole('button', { name: 'Set allow-list' }).click();
    const row = page.getByRole('main').getByRole('button')
        .filter({ hasText: `Address list #${listIndex}` });
    await expect(row, `the dispenser's list picker cannot see list #${listIndex}, which this wallet `
        + 'just published from this chain')
        .toBeVisible({ timeout: 60_000 });
    await row.click();
    await expect(main.getByRole('button', { name: `Allow-list #${listIndex}` }),
        'the picker closed without binding the list')
        .toBeVisible({ timeout: 30_000 });

    // D-161's guard, on the screen that causes the mistake.
    const selfWarning = main.getByRole('alert')
        .filter({ hasText: /is not on the allow-list/i });
    if (expectSelfWarning) {
        await expect(selfWarning,
            'the form bound a list this dispenser is not on and said nothing: every fill will be '
            + 'refused and each buyer pays to find out')
            .toBeVisible({ timeout: 60_000 });
        const said = (await selfWarning.textContent()) || '';
        expect(said, 'the warning does not say the refusal is total')
            .toMatch(/every purchase would be refused/i);
        expect(said, 'the warning does not say the buyer pays before finding out')
            .toMatch(/after paying/i);
    } else {
        // The other half of the pair. Given a moment to appear first, so this
        // is "it did not fire" rather than "the read had not finished".
        await page.waitForTimeout(5_000);
        await expect(selfWarning,
            'the form warned about a list this dispenser IS on, which makes the warning noise')
            .toHaveCount(0);
    }

    await main.getByRole('button', { name: /^(Create|Preview)$/ }).click();
    await expectConfirmModal(page);
    const created = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(created.status), 'the chain rejected the gated dispenser').toBe('valid');
    // The FIELD as well as the value: allow and block are separate slots that
    // gate in OPPOSITE directions, so a bind that wrote the wrong one would
    // still read as "a list is attached".
    expect(String(created.allow_list), 'the dispenser did not store the allow-list it was given')
        .toBe(listIndex);
    return String(created.action_index);
}

test.describe(`a dispenser owner off its own allow list, on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(3_000_000);

    test('refuses every buyer by name, and the control differs only by the owner being listed',
        async ({ page }) => {
            let trapSeller;
            let controlSeller;
            let buyer;
            let trapDispenser;
            let controlDispenser;

            await test.step('three parties, and the buyer exists before either list does', async () => {
                await createWallet(page, { password: PASSWORD, name: 'Trap Seller' });
                await switchToRegtest(page, PASSWORD);

                // The dispenser opens on its SOURCE (D-15), so this address is
                // also the dispenser's GET_ADDRESS - the second address the
                // gate checks, and the one an owner forgets to list.
                await gotoPalette(page, 'Create dispenser');
                const main = page.getByRole('main');
                await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
                await selectVenueChain(main);
                trapSeller = await main.getByRole('textbox', { name: 'Source' }).inputValue();
                expect(trapSeller, `the form has no ${REGTEST_CHAIN_LABEL} address`)
                    .toMatch(REGTEST_ADDRESS_RE);

                controlSeller = await addWalletAndReadAddress(page, 'Control Seller');
                buyer = await addWalletAndReadAddress(page, 'One Buyer');
                expect(new Set([trapSeller, controlSeller, buyer]).size,
                    'two of the three parties derived the same address').toBe(3);

                await fundAddress(buyer, FUNDING);
                await seedPrices();
            });

            await test.step('seller A lists the buyer and NOT itself, then opens a dispenser', async () => {
                await switchToWallet(page, 'Trap Seller');
                await fundAddress(trapSeller, FUNDING);
                await page.reload();
                await unlockAfterReload(page, PASSWORD);
                await mintXchain(page, MINT);
                await waitForTokenBalance(trapSeller, TICK, MINT);

                // THE WHOLE EXPERIMENT IS THIS ONE MEMBERSHIP: the buyer is on
                // the list, so the payer-side gate passes and any refusal below
                // has to come from the other side.
                const listIndex = await publishList(page, [buyer]);
                trapDispenser = await openDispenser(page, listIndex, { expectSelfWarning: true });
            });

            await test.step('seller B lists the buyer AND itself, then opens the same dispenser', async () => {
                await switchToWallet(page, 'Control Seller');
                await fundAddress(controlSeller, FUNDING);
                await page.reload();
                await unlockAfterReload(page, PASSWORD);
                await mintXchain(page, MINT);
                await waitForTokenBalance(controlSeller, TICK, MINT);

                const listIndex = await publishList(page, [buyer, controlSeller]);
                controlDispenser = await openDispenser(page, listIndex, { expectSelfWarning: false });
            });

            await test.step('the buyer pays seller A, is refused BY NAME, and is out the coin', async () => {
                const escrowBefore = await giveRemaining(trapDispenser);
                const buyerSatsBefore = await coinBalanceSats(buyer);
                const creditBefore = await tokenBalance(buyer, TICK).catch(() => 0);
                const watermark = await tipActionIndex();

                await switchToWallet(page, 'One Buyer');
                await payCoin(page, trapSeller, TRIGGER);

                const dispense = await waitForDispenseBy(buyer, watermark);
                // THE ASSERTION THIS SPEC EXISTS FOR. It names WHICH of the six
                // gates refused, which is what rules out the token lists, the
                // escrow, the trigger price and the buyer's own membership all
                // at once - and the buyer IS on this list, so a DESTINATION
                // verdict here would mean something else entirely.
                expect(String(dispense.status),
                    'the chain did not refuse a dispenser whose own pay-to address is off its '
                    + 'allow list, so the GET_ADDRESS half of the gate is not running')
                    .toMatch(/^invalid/);
                expect(String(dispense.status),
                    'the refusal does not name GET_ADDRESS and the dispenser allow list, so a '
                    + 'seller cannot tell this apart from a buyer problem')
                    .toContain('GET_ADDRESS');
                expect(String(dispense.status)).toMatch(/dispenser allow list/i);

                // Nothing moved on the seller's side...
                expect(await giveRemaining(trapDispenser),
                    'the refused dispense still drew down the escrow')
                    .toBe(escrowBefore);
                expect(await tokenBalance(buyer, TICK).catch(() => 0),
                    'the refused buyer was credited tokens anyway')
                    .toBe(creditBefore);
                // ...and the buyer paid for the privilege. A dispenser is
                // triggered by a bare coin payment, so the coin is gone before
                // the gate runs and a refusal does not bounce it.
                const spent = buyerSatsBefore - await coinBalanceSats(buyer);
                expect(spent,
                    'the refused buyer did not actually lose the coin, so this run did not exercise '
                    + 'the cost the trap carries')
                    .toBeGreaterThan(Math.round(Number(TRIGGER) * 1e8) - 1);
            });

            await test.step('the same buyer pays seller B the same amount, and is served', async () => {
                const watermark = await tipActionIndex();
                const creditBefore = await tokenBalance(buyer, TICK).catch(() => 0);

                await payCoin(page, controlSeller, TRIGGER);

                const dispense = await waitForDispenseBy(buyer, watermark);
                expect(String(dispense.status),
                    'the CONTROL was refused too, so the refusal above is not attributable to the '
                    + 'owner being off the list - something else in this run is broken')
                    .toBe('valid');
                expect(await waitForCredit(buyer, TICK, creditBefore + GIVE_PER_FILL),
                    'the served buyer was credited a different number of fills')
                    .toBe(creditBefore + GIVE_PER_FILL);
                expect(await waitForEscrow(controlDispenser, ESCROW - GIVE_PER_FILL),
                    'the control escrow did not fall by exactly one fill')
                    .toBe(ESCROW - GIVE_PER_FILL);
            });

            // D-162: the same question, asked BEFORE the money moves. The panel
            // already warned that both dispensers are "restricted" and named
            // the list; what it could not say is which side of it you are on -
            // and for the trap dispenser the answer does not depend on the
            // buyer at all, because its own address is off its own list.
            await test.step('and the buy panel now says which of the two is unbuyable', async () => {
                const openPanel = async (index) => {
                    await page.getByRole('button', { name: 'Home', exact: true }).first().click();
                    await gotoPalette(page, 'All actions');
                    await page.getByRole('main').getByText('Browse dispensers', { exact: true })
                        .first().click();
                    const main = page.getByRole('main');
                    await expect(main.getByLabel('Token ticker')).toBeVisible({ timeout: 30_000 });
                    await main.getByLabel('Token ticker').fill(TICK);
                    await main.getByRole('button', { name: 'Search', exact: true }).click();
                    const row = main.getByRole('button').filter({ hasText: `#${index} ` });
                    await expect(row, `dispenser #${index} is on chain but a buyer searching the `
                        + 'token it sells cannot find it')
                        .toBeVisible({ timeout: 60_000 });
                    await row.click();
                    await expect(main, 'no pay-to-buy panel rendered at all')
                        .toContainText('Pay to buy', { timeout: 30_000 });
                    return main;
                };

                const trapPanel = await openPanel(trapDispenser);
                await expect(trapPanel.getByText(/cannot sell to anyone/i),
                    'the panel offers this dispenser to a buyer without saying it is unbuyable - '
                    + 'the chain refused exactly this payment two steps ago and kept the coin')
                    .toBeVisible({ timeout: 60_000 });
                const said = await trapPanel.innerText();
                expect(said, 'the notice does not say the coin is kept')
                    .toMatch(/not returned/i);
                expect(said, 'the notice does not say the buyer cannot fix it')
                    .toMatch(/only its owner can fix it/i);

                // The other half of the pair: the control is restricted too, so
                // a notice that fires on both would be telling the buyer
                // nothing about THIS dispenser.
                const controlPanel = await openPanel(controlDispenser);
                await expect(controlPanel.getByText(/restricted/i),
                    'the control lost its existing restricted warning')
                    .toBeVisible({ timeout: 30_000 });
                await page.waitForTimeout(5_000);
                await expect(controlPanel.getByText(/cannot sell to anyone/i),
                    'the panel calls a dispenser unbuyable when this buyer just bought from it')
                    .toHaveCount(0);
            });
        });
});
