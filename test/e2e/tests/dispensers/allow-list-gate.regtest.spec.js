// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Dispensers": ALLOW/BLOCK lists in anger - the last ⬜
// on that lane, and the only dispenser field the campaign had never bound to a
// real list.
//
// WHAT IT IS, and how it differs from the TOKEN access lists Session 32 proved.
// A token's allow-list gates who may HOLD the token, and it is bound with an
// ISSUE v5. A DISPENSER's allow-list gates who may BUY FROM THIS DISPENSER, is
// bound at create time, and is checked in `dispense.js` against two addresses
// at once: the payer (`SOURCE`) and the dispenser's own pay-to address
// (`GET_ADDRESS`). Six list gates run on every dispense (get-token allow/block,
// give-token allow/block, dispenser allow/block) and each has its own verdict
// string, which is what makes a refusal attributable here without a control
// probe: the chain names WHICH list refused.
//
// WHY IT NEEDS A RUN. A list on a dispenser only ever STOPS something, so
// reading the binding back proves nothing: a bind pointing at the wrong index,
// or at a list the chain stored empty, reads identically to a working one. The
// assertion is therefore a PAIR of payments - identical in every respect except
// who sent them - answered differently by the chain.
//
// AND THE HALF THAT COSTS REAL MONEY. A dispenser is triggered by a BARE COIN
// PAYMENT, so the coin has already moved by the time the gate runs. A refused
// dispense does not bounce it: the payer is out the coin and receives nothing.
// That is asserted here rather than assumed, because it decides how loudly a
// buy surface has to warn.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dispensers/allow-list-gate.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    encoderRpc,
    expectConfirmModal as sharedConfirmModal,
    EXPLORER_URL,
    fundAddress,
    minerRpc,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
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
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

/** Total confirmed satoshis the chain says this address controls. */
async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
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

/** The DISPENSE this payer triggered, whatever verdict it got. */
async function waitForDispenseBy(payer, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => String(r.action) === 'DISPENSE'
            && String(r.source) === payer);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`no DISPENSE was ever recorded for a payment from ${payer}: the coin left the `
        + 'payer and the chain did not even judge it');
}

async function giveRemaining(index) {
    const row = await explorerJson(`action/${index}`);
    const v = row?.state?.give_remaining ?? row?.give_remaining;
    return v == null ? null : Number(v);
}

/**
 * The explorer serves an action's ROW before it serves that action's effect on
 * the balance and escrow views, so a single read the moment a dispense indexes
 * still shows the pre-dispense figure - which reads exactly like "the dispenser
 * gave nothing" (campaign §"DEX", Session 31, which lost a run to it). Poll for
 * the change, then assert the exact value.
 */
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

/** The payer's balance of `tick`, as a NUMBER, once it reaches `min`. */
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

/**
 * The shared reader, plus this lane's own checks.
 *
 * A narrower wait races the modal against the stale-price alert and nothing
 * else, so every OTHER refusal the screen carried read as the modal simply
 * not being there - which is how the shared explorer's 429 was reported as a
 * locator timeout for four runs. `expectConfirmModal` reads every alert on
 * the screen instead. The price check stays because it names one venue state
 * early and by itself.
 */
async function expectConfirmModal(page) {
    const modal = await sharedConfirmModal(page, 'this action', 60_000);
    expect(await page.getByText(/fee price is temporarily unavailable/).count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. '
        + 'Venue state, not a wallet defect - re-seed (campaign §3.2) and re-run')
        .toBe(0);
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
 * Read off the Issue form rather than Receive, for the reason
 * fiat-priced-fill records: Receive answers for the ACTIVE chain, and a wallet
 * added mid-session is active on whichever chain the app lists first, so on a
 * Litecoin run it hands back a Bitcoin address. The Issue form carries a chain
 * picker; nothing is composed from it here.
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

/** Sends `amount` of the venue's native coin to `to` from the active wallet. */
async function payCoin(page, to, amount) {
    await gotoPalette(page, 'Send');
    const main = page.getByRole('main');
    const coin = REGTEST_COIN.slice(1);
    // The Send form has no chain picker (D-140): it follows the SELECTED
    // ASSET's chain. Picking the venue's native coin is how the chain gets
    // chosen, and a NATIVE row is named for its CHAIN, not its ticker.
    await page.getByRole('button', { name: /Change asset/ }).click();
    await page.getByLabel('Search coins or tokens').fill(coin);
    await page.getByLabel(new RegExp(`Open ${REGTEST_CHAIN_LABEL} details`, 'i')).first().click();
    await expect(main.getByRole('textbox', { name: new RegExp(`^Amount \\(${coin}\\)`) }),
        `the Send form is composing on the wrong chain: no ${coin} amount field`)
        .toBeVisible({ timeout: 30_000 });

    await page.getByLabel('To', { exact: true }).fill(to);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(amount);
    await main.getByRole('button', { name: 'Send', exact: true }).click();
    await expectConfirmModal(page, 'this action', 60_000);
    await page.getByTestId('confirm-approve').click();
    await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
        .toBeVisible({ timeout: 180_000 });
}

test.describe(`dispenser allow lists on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(3_000_000);

    test('a dispenser allow-list lets a member buy and refuses everyone else', async ({ page }) => {
        let seller;
        let allowed;
        let refused;
        let listIndex;
        let dispenserIndex;
        /** What the refused payment cost, carried into the panel assertion. */
        let spentDisplay = 'the trigger price';

        await test.step('three parties, and the two buyers exist before the list does', async () => {
            await createWallet(page, { password: PASSWORD, name: 'List Seller' });
            await switchToRegtest(page, PASSWORD);

            // The seller's dispenser opens on its SOURCE (D-15), so this is
            // also the dispenser's GET_ADDRESS - the second address the gate
            // checks, and the one an owner forgets to list.
            await gotoPalette(page, 'Create dispenser');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Give amount (per fill)')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            seller = await main.getByRole('textbox', { name: 'Source' }).inputValue();
            expect(seller, `the form has no ${REGTEST_CHAIN_LABEL} address`).toMatch(REGTEST_ADDRESS_RE);

            // Both buyers are read BEFORE the list is published, because the
            // list has to name one of them. Separate wallets rather than
            // separate addresses of one wallet: a payment spends from the
            // chain's ACTIVE address and Send offers no source picker (D-140),
            // so two payers means two wallets.
            allowed = await addWalletAndReadAddress(page, 'Allowed Buyer');
            refused = await addWalletAndReadAddress(page, 'Refused Buyer');
            expect(new Set([seller, allowed, refused]).size,
                'two of the three parties derived the same address').toBe(3);

            await fundAddress(allowed, FUNDING);
            await fundAddress(refused, FUNDING);
        });

        await test.step('the seller publishes a list naming itself and one buyer', async () => {
            await switchToWallet(page, 'List Seller');
            await fundAddress(seller, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT);
            await waitForTokenBalance(seller, TICK, MINT);
            await seedPrices();

            await gotoPalette(page, 'Create a list');
            const main = page.getByRole('main');
            await expect(main.getByLabel('List type')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            // TYPE=2 (addresses). The SELLER'S OWN ADDRESS IS ON THE LIST, and
            // that is not padding: dispense.js checks the dispenser's
            // GET_ADDRESS against the same allow-list as the payer, so an owner
            // who lists only their customers refuses every sale with
            // `invalid: GET_ADDRESS (dispenser allow list)`. Same asymmetry the
            // token lists have (§"Dispensers" / Session 32), one level down.
            await main.getByLabel('List type').selectOption('2');
            await main.getByLabel('Addresses', { exact: true }).fill([seller, allowed].join('\n'));
            await expect(main, 'the list form did not accept both addresses for this chain')
                .toContainText('2 valid addresses');

            await main.getByRole('button', { name: /^(Publish list|Review)$/ }).click();
            await expectConfirmModal(page);
            const published = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(published.action)).toBe('LIST');
            expect(String(published.status), 'the chain rejected the LIST').toBe('valid');
            listIndex = String(published.action_index);

            // The indexer stores a list even when it drops items into
            // list_items_invalid, so a valid ACTION is not the same as
            // the MEMBERSHIP being what was asked for.
            const stored = (published.list || published.items || published.members || [])
                .map((row) => String(typeof row === 'object' ? (row.address ?? row.item ?? '') : row));
            expect(stored.sort(), `list #${listIndex} did not store the addresses it was given`)
                .toEqual([seller, allowed].sort());
        });

        await test.step('and opens a dispenser bound to it', async () => {
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
            const picker = page.getByRole('main');
            const row = picker.getByRole('button').filter({ hasText: `Address list #${listIndex}` });
            await expect(row, `the dispenser's list picker cannot see list #${listIndex}, which this `
                + 'wallet just published from this chain')
                .toBeVisible({ timeout: 60_000 });
            await row.click();
            await expect(main.getByRole('button', { name: `Allow-list #${listIndex}` }),
                'the picker closed without binding the list')
                .toBeVisible({ timeout: 30_000 });

            await main.getByRole('button', { name: /^(Create|Preview)$/ }).click();
            await expectConfirmModal(page);
            const created = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(created.status), 'the chain rejected the gated dispenser').toBe('valid');
            dispenserIndex = String(created.action_index);

            // The FIELD as well as the value. Allow and block are two separate
            // slots and gate in OPPOSITE directions, so a bind that wrote the
            // wrong one would still read as "a list is attached" and would let
            // in exactly the addresses it was meant to keep out.
            expect(String(created.allow_list),
                'the dispenser did not store the allow-list it was given')
                .toBe(listIndex);
            expect(created.block_list == null || created.block_list === '',
                'the bind also wrote the BLOCK list, which gates the opposite way')
                .toBe(true);
        });

        await test.step('the listed buyer pays and is served', async () => {
            await switchToWallet(page, 'Allowed Buyer');
            await payCoin(page, seller, TRIGGER);

            const dispense = await waitForDispenseBy(allowed);
            expect(String(dispense.status),
                'a buyer ON the dispenser\'s allow list was refused, so the gate keeps out the '
                + 'people it was built to let in')
                .toBe('valid');
            expect(await waitForCredit(allowed, TICK, GIVE_PER_FILL),
                'the allowed buyer paid and was credited a different number of fills')
                .toBe(GIVE_PER_FILL);
            expect(await waitForEscrow(dispenserIndex, ESCROW - GIVE_PER_FILL),
                'the escrow did not fall by exactly one fill')
                .toBe(ESCROW - GIVE_PER_FILL);
        });

        await test.step('the unlisted buyer pays, is refused by name, and is out the coin', async () => {
            const escrowBefore = await giveRemaining(dispenserIndex);
            const buyerSatsBefore = await coinBalanceSats(refused);

            await switchToWallet(page, 'Refused Buyer');
            await payCoin(page, seller, TRIGGER);

            const dispense = await waitForDispenseBy(refused);
            // THE ASSERTION THIS SPEC EXISTS FOR, and it names the LIST rather
            // than merely failing: six different list gates run on a dispense
            // and each has its own verdict, so this string rules out the token
            // lists, the escrow and the payment amount all at once.
            expect(String(dispense.status),
                'the dispense from an address that is NOT on the dispenser\'s allow list was not '
                + 'refused for that reason. The pair of payments is identical except for who sent '
                + 'them, so whatever stopped this one is not the list')
                .toContain('dispenser allow list');

            expect(await tokenBalance(refused, TICK),
                'a refused dispense still credited the buyer')
                .toBe(0);
            expect(await giveRemaining(dispenserIndex),
                'a refused dispense still moved the escrow')
                .toBe(escrowBefore);

            // The half nobody gets back. A dispenser is triggered by a BARE
            // coin payment, so the coin is spent before the gate is consulted
            // and a refusal does not return it: the buyer is down the trigger
            // price plus the miner fee and holds nothing. Measured rather than
            // reasoned, because it decides how loudly a buy surface must warn.
            const buyerSatsAfter = await coinBalanceSats(refused);
            const spent = buyerSatsBefore - buyerSatsAfter;
            expect(spent,
                'the refused payment did not leave the buyer at all, so this venue returns it and '
                + 'the warning below is unnecessary')
                .toBeGreaterThanOrEqual(Math.round(Number(TRIGGER) * 1e8));
            spentDisplay = `${spent} sats`;
            // eslint-disable-next-line no-console
            console.log(`[measured] a refused dispense cost the unlisted buyer ${spent} sats `
                + `(trigger ${TRIGGER} ${REGTEST_COIN.slice(1)} + miner fee) for nothing`);
        });

        await test.step('and what the buyer is told BEFORE paying (D-148)', async () => {
            // The panel a buyer actually reaches, from the buyer's own wallet.
            // It used to say "Any LTC wallet can trigger a fill" on every
            // dispenser, gated or not, while reading neither list field - though
            // the explorer serves both on the row it was already reading and the
            // OWNER's view of the same page prints them. The step above measured
            // what following that sentence costs.
            await gotoPalette(page, 'All actions');
            await page.getByRole('main').getByText('Browse dispensers', { exact: true })
                .first().click();
            const main = page.getByRole('main');
            await expect(main.getByLabel('Token ticker')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Token ticker').fill(TICK);
            await main.getByRole('button', { name: 'Search', exact: true }).click();

            const row = main.getByRole('button').filter({ hasText: `#${dispenserIndex} ` });
            await expect(row, `the gated dispenser #${dispenserIndex} is on chain but a buyer `
                + 'searching the token it sells cannot find it')
                .toBeVisible({ timeout: 60_000 });
            await row.click();

            const panel = page.getByRole('main');
            await expect(panel, 'no pay-to-buy panel rendered at all')
                .toContainText('Pay to buy', { timeout: 30_000 });
            const text = await panel.innerText();

            expect(/Any .* wallet can trigger a fill/i.test(text),
                `the panel tells this buyer any wallet can trigger a dispenser that just refused `
                + `them and kept ${spentDisplay} for it: "${text.slice(0, 300)}"`)
                .toBe(false);
            expect(text, 'the buyer is not told the dispenser is restricted')
                .toMatch(/restricted/i);
            expect(text, 'the buyer cannot see which list decides whether their payment works')
                .toContain(`list #${listIndex}`);
            expect(text, 'the buyer is not told the coin is spent either way')
                .toMatch(/not returned/i);
        });
    });
});
