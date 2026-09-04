// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Create token" -> SUBTOKEN: the last owed leg, a
// parent whose OWNERSHIP is escrowed in an open offer.
//
// WHY THE RULE EXISTS, and it is the reason this is worth a run rather than a
// completeness tick. Listing a token's NAME for sale escrows its ownership
// (`SellOwnershipForm` composes an ORDER or DISPENSER with `GIVE_TICK`, and
// order.js / swap.js / dispenser.js set `tokens.escrow_action_index`). While
// that offer is open the seller must not be able to change what the buyer is
// about to receive - and minting a CHILD does exactly that, because a subtoken
// hangs off the parent's name permanently and its supply is credited to
// whoever issues it. So `issue.js` refuses a child while the parent's
// ownership is escrowed:
//
//   if(!error && parentInfo && !data['IS_GENESIS']
//      && await this.indexerDb.isOwnershipEscrowed(parent))
//       error = 'invalid: TICK (parent ownership escrowed)';
//
// WHAT MAKES THE REFUSAL MEAN SOMETHING. A run that only shows the refusal is
// equally consistent with a wizard that could not compose a subtoken under this
// parent at all - which is precisely what D-163 looked like from outside, and
// what D-168 actually was. So the SAME parent, the SAME wizard and the SAME
// signer produce a VALID child first, minutes before the sale is listed, and
// the only thing that changes between the two attempts is the escrow.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js \
//       tests/tokens/subtoken-escrowed-parent.regtest.spec.js
//
// ⚠️: the parent ISSUE and the first child are each the first credit of
// a brand-new (address, tick) key, which is the shape that wedges this venue.
// If a leg times out, compare `last_block` against `chain_tip` - NOT
// `decoder_health`, which reads "healthy" straight through a wedge.

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
    tokenBalance,
    unlockAfterReload,
    expectConfirmModal as sharedConfirmModal,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** A parent ISSUE, a child ISSUE and an ORDER, each paying a real coin fee. */
const FUNDING = 4;
const STAMP = Date.now().toString().slice(-6);

const PARENT = `ESC${STAMP}`;
/** Issued BEFORE the sale is listed: the control that gives the refusal meaning. */
const CHILD_OK = 'KID';
/** Attempted AFTER, and never expected to exist. */
const CHILD_BLOCKED = 'GHOST';

const PARENT_SUPPLY = 1000;
const CHILD_SUPPLY = 500;
/** The asking price for the name, in the venue's native coin. */
const ASK = '0.01';

const explorerJson = async (path) => {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`);
    if (!res.ok) throw new Error(`explorer ${path} -> ${res.status}`);
    return res.json();
};

/** The venue's own ISSUE verdict for `tick` from `source`. */
async function feeQuote(tick, source) {
    const url = new URL(`${EXPLORER_URL}/${REGTEST_COIN}/api/feequote`);
    url.searchParams.set('action', 'ISSUE');
    url.searchParams.set('params', `0|${tick}`);
    url.searchParams.set('source', source);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`feequote ${tick} -> ${res.status}`);
    return res.json();
}

/**
 * Mines a block while the decoder is keeping up.
 *
 * Gated on the DECODER's lag rather than the miner's `mempool_size`: that
 * counter was measured unreliable on this venue (Session 40), which makes the
 * §3.5 helper inert and strands broadcast actions unconfirmed.
 */
async function mineIfBehind() {
    try {
        const status = await explorerJson('status');
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* best-effort; the waits below carry the timeout */ }
}

async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfBehind();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(`No XChain action recorded for ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s. chain_tip `
        + `${status?.chain_tip?.[REGTEST_COIN]} vs last_block `
        + `${status?.last_block?.[REGTEST_COIN]}. A last_block frozen below the tip across two `
        + 'reads is wedging the venue, not a wallet defect (§3.7).');
}

async function waitForBalance(address, tick, want, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (String(last) === String(want)) return last;
        await mineIfBehind();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance for ${address} never reached ${want} (last=${last})`);
}

/** Polls the venue until an ISSUE of `tick` is quoted with `pattern`, or times out. */
async function waitForQuote(tick, source, pattern, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const q = await feeQuote(tick, source).catch(() => null);
        last = q ? String(q.error || q.status || (q.valid ? 'valid' : '?')) : last;
        if (last && pattern.test(last)) return last;
        await mineIfBehind();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`the venue never quoted ${tick} matching ${pattern} (last=${last})`);
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

async function reloadToHome(page) {
    await gotoPalette(page, 'Home');
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
}

/**
 * The shared reader, plus this lane's own price check.
 *
 * A narrower wait races the modal against the stale-price alert and NOTHING else,
 * so every other refusal the screen carried read as the modal simply not being
 * there. That is the swallowing idiom wearing the clothes of a helper, and it
 * is why the shared explorer's 429 was reported as a bare locator timeout for
 * five runs. `expectConfirmModal` reads every alert on the screen instead.
 *
 * The price assertion stays: it names ONE venue state early and by itself,
 * which the general reader can only report as one sentence among several.
 */
async function expectConfirmScreen(page) {
    await sharedConfirmModal(page, 'this action', 90_000);
    expect(await page.getByText(/fee price is temporarily unavailable/).count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. Venue '
        + 'state, not a wallet defect - re-seed (campaign §3.2) and re-run')
        .toBe(0);
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
 * Fills the wizard's Subtoken template and submits it, WITHOUT assuming what
 * happens next: a refused action never reaches the confirm screen (the
 * native-fee pre-flight answers on the form), so the caller waits for whichever
 * outcome it is asserting.
 */
async function fillSubtoken(page, { parent, child, supply }) {
    await reloadToHome(page);
    await gotoPalette(page, 'Create a token');

    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Subtoken/ }).click();
    await selectVenueChain(main);
    await expect.poll(async () => main.getByLabel('Fee paid by').inputValue().catch(() => ''),
        { timeout: 30_000, message: 'the wizard names no signing address' })
        .toMatch(REGTEST_ADDRESS_RE);
    await main.getByRole('button', { name: 'Next', exact: true }).click();

    await expect(main.getByLabel('Parent ticker')).toBeVisible({ timeout: 30_000 });
    await main.getByLabel('Parent ticker').fill(parent);
    await main.getByLabel('Subtoken name').fill(child);
    await main.getByLabel('Supply', { exact: true }).fill(String(supply));
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();
}

test.describe(`subtoken under an escrowed parent on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('listing the parent name for sale blocks new children, and the same wizard made one minutes before', async ({ page }) => {
        let owner;

        await test.step('onboard, fund, and issue the parent', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Escrow Parent Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const probe = page.getByRole('main');
            await expect(probe.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(probe);
            owner = await probe.getByLabel('From').inputValue();
            expect(owner, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(owner, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await seedPrices();

            await gotoPalette(page, 'Issue token');
            const form = page.getByRole('main');
            await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(form);
            await form.getByLabel('Ticker').fill(PARENT);
            await form.getByLabel('Supply', { exact: true }).fill(String(PARENT_SUPPLY));
            await form.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmScreen(page);
            const issued = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(issued.status), `the venue rejected the parent ISSUE: ${issued.status}`)
                .toBe('valid');
            await waitForBalance(owner, PARENT, PARENT_SUPPLY);
        });

        await test.step('CONTROL: a child settles while the parent is NOT for sale', async () => {
            // Without this, the refusal below is equally consistent with a
            // wizard that could not compose a subtoken under this parent at
            // all - which is what D-163 looked like and what D-168 was.
            await fillSubtoken(page, { parent: PARENT, child: CHILD_OK, supply: CHILD_SUPPLY });
            await expectConfirmScreen(page);
            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status),
                `the chain refused ${PARENT}.${CHILD_OK} before any sale existed, so this run `
                + 'cannot attribute the later refusal to the escrow')
                .toBe('valid');
            await waitForBalance(owner, `${PARENT}.${CHILD_OK}`, CHILD_SUPPLY);
        });

        await test.step('list the parent NAME for sale, which escrows its ownership', async () => {
            // Reached through Manage Token, where the action is labelled "Sell
            // name" rather than "sell ownership", and lives in the More menu or
            // the button row depending on the token's state (§3.5, Session 39).
            // Scoped to `main`, because the shell's own chrome carries
            // same-named controls.
            await reloadToHome(page);
            await gotoPalette(page, 'My Tokens');
            const main = page.getByRole('main');
            const row = main.getByRole('button').filter({ hasText: PARENT }).first();
            await expect(row, `${PARENT} is on chain but My Tokens does not list it`)
                .toBeVisible({ timeout: 60_000 });
            await row.click();
            await expect(page.getByRole('heading', { name: 'Manage Token' })
                .or(page.getByText('Manage Token').first()))
                .toBeVisible({ timeout: 30_000 });

            const sell = main.getByRole('button', { name: 'Sell name', exact: true });
            if (await sell.count() === 0) {
                await main.getByRole('button', { name: /^More/ }).first().click();
                await page.getByRole('menuitem', { name: 'Sell name' }).click();
            } else {
                await sell.click();
            }

            await expect(page.getByRole('main').getByLabel(/^Price/))
                .toBeVisible({ timeout: 30_000 });
            await page.getByRole('main').getByLabel(/^Price/).fill(ASK);
            await page.getByRole('main').getByRole('button', { name: 'Review', exact: true }).click();

            // This form does NOT route through the shared confirm modal. It
            // has its own review stage ("Review sale") whose submit is
            // labelled "List name for sale", and it broadcasts from there,
            // reporting the txid in its own result panel. The submit is
            // disabled until the signer is ready or a password is typed; with
            // the vault already unlocked there is no password field at all
            // (§3.5, Session 29), so identify the stage by its button.
            const listBtn = page.getByRole('main')
                .getByRole('button', { name: 'List name for sale', exact: true });
            await expect(listBtn, 'the sell-ownership review stage never offered its submit')
                .toBeEnabled({ timeout: 90_000 });
            await listBtn.click();

            const main2 = page.getByRole('main');
            await expect(main2, 'the ownership sale never reported a transaction id')
                .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
            const orderTxid = (await main2.innerText()).match(/[0-9a-f]{64}/)?.[0];

            const order = await waitForIndexedAction(orderTxid);
            expect(String(order.status), `the venue rejected the ownership sale: ${order.status}`)
                .toBe('valid');
        });

        await test.step('the chain now refuses a NEW child, naming the escrow', async () => {
            // Polled rather than read once: the escrow is set when the ORDER
            // indexes, and the quote is pinned per block height, so an
            // immediate read can still answer from before the offer landed.
            const verdict = await waitForQuote(
                `${PARENT}.${CHILD_BLOCKED}`, owner, /parent ownership escrowed/i,
            );
            expect(verdict).toMatch(/parent ownership escrowed/i);

            // And the FIRST child is untouched: the escrow blocks new issuance,
            // it does not retroactively invalidate what already exists.
            expect(await tokenBalance(owner, `${PARENT}.${CHILD_OK}`),
                'listing the parent for sale moved the existing child\'s supply')
                .toBe(CHILD_SUPPLY);
        });

        await test.step('and the wizard stops before spending anything', async () => {
            await fillSubtoken(page, {
                parent: PARENT, child: CHILD_BLOCKED, supply: CHILD_SUPPLY,
            });

            const alert = page.getByRole('alert')
                .filter({ hasText: /parent ownership escrowed/i });
            await expect(alert,
                'the wizard neither refused a child under an escrowed parent nor explained it, so '
                + 'a doomed ISSUE reached the signing screen')
                .toBeVisible({ timeout: 90_000 });
            await expect(alert).toContainText(/Nothing was signed or sent/i);
            expect(await page.getByTestId('confirm-modal').count(),
                'an ISSUE the network has already refused reached the confirm screen')
                .toBe(0);
            expect(await tokenBalance(owner, `${PARENT}.${CHILD_BLOCKED}`),
                'the blocked child exists on chain')
                .toBe(0);
        });
    });
});
