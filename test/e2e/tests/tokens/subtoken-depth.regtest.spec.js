// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Create token" -> SUBTOKEN, the two legs Session 39
// left owed: a parent that is itself a subtoken, and the `parent unknown`
// refusal.
//
// D-168 IS WHAT THE FIRST LEG FOUND. `TokenWizard.handleDetailsSubmit`
// validated the parent field as a single alphanumeric run
// (`/^[A-Za-z0-9]+$/`), so every dotted parent was refused on the form with
// "Parent ticker must be A–Z, 0–9." The chain has no such rule: `issue.js`
// resolves a child's parent as `parts.slice(0,-1).join('.')`, so `A.B.C` is a
// child of `A.B` and nests to any depth. Measured against this venue with curl
// before a browser was opened, which is what settles that the gap is the
// wallet's:
//
//   ISSUE 0|GAT530653.KID.GRAND     -> valid,  xchainFee 0.50000000, 3,333,333 sats
//   ISSUE 0|GAT530653.KID.GRAND.X   -> invalid: TICK (parent unknown)
//   ISSUE 0|PLAIN90210              -> valid,  xchainFee 1.00000000, 6,666,667 sats
//
// So a grandchild is not a special case to the chain - it is an ordinary
// subtoken, priced at the same halved ISSUE_SUBTOKEN rate - and the second line
// is the recursion proving itself: the great-grandchild is refused only because
// ITS parent does not exist yet.
//
// IT MATTERED BECAUSE THIS WIZARD IS THE ONLY WAY IN. `IssueTokenForm` rejects
// the dot in its own ticker field (`/^[A-Za-z0-9]+$/`, Session 39), so a
// grandchild was uncreatable from the wallet rather than merely awkward - the
// same shape as D-163 one level deeper, in the code D-163 had just been fixed
// in. The composer never had the limit: `templates.subtoken` already joins
// `${parent}.${child}` with no assumption about the parent's depth, so the
// validator was the whole of it.
//
// WHY THE LAST STEP IS THE TEETH ON THE JOIN. A green "the grandchild exists"
// is also satisfied by a wallet that truncated the parent to its first segment,
// because `PAR.KID` truncated to `PAR` names a token that really does exist and
// really is owned by this address - it would just have created the WRONG token,
// a second child rather than a grandchild. So the run also asks for a child
// under `PARENT.NOSUCH`, a middle level that does not exist: truncation would
// make that succeed as `PARENT.<child>`, and the full path makes it
// `invalid: TICK (parent unknown)`. That is the campaign's owed `parent
// unknown` leg and the control on the join at once.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/subtoken-depth.regtest.spec.js
//
// ⚠️: three of the four legs here are the FIRST credit of a brand-new
// (address, tick) key, which is the shape that wedged this venue twice in
// Session 39. A leg that times out with `decoder_lag_blocks` not shrinking over
// two reads is that, not this spec - restart the indexer and re-run.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    encoderRpc,
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
/** Three ISSUEs plus a refused one, each paying a real coin fee. */
const FUNDING = 4;
const STAMP = Date.now().toString().slice(-6);

/** Level 1, issued through the DIRECT form - the wizard is the surface under test. */
const PARENT = `DPT${STAMP}`;
/** Level 2. The full tick is `${PARENT}.${CHILD}`. */
const CHILD = 'KID';
/** Level 3, the one the wallet could not author: `${PARENT}.${CHILD}.${GRAND}`. */
const GRAND = 'GRAND';
/** A middle level that is never issued, for the truncation control. */
const ABSENT = 'NOSUCH';

const PARENT_SUPPLY = 1000;
const CHILD_SUPPLY = 500;
const GRAND_SUPPLY = 250;

/** Quoted but never issued: the control the subtoken rate is halved against. */
const PLAIN_PROBE = `PLN${STAMP}`;

const explorerJson = async (path) => {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`);
    if (!res.ok) throw new Error(`explorer ${path} -> ${res.status}`);
    return res.json();
};

/**
 * The venue's own quote for an ISSUE of `tick` from `source`.
 *
 * The authority the confirm screen is checked against (§4), and the only way to
 * learn the parent rules without broadcasting: the quote runs the real handler,
 * so it answers `invalid: TICK (...)` for a parent that is missing or owned
 * elsewhere.
 */
async function feeQuote(tick, source) {
    const url = new URL(`${EXPLORER_URL}/${REGTEST_COIN}/api/feequote`);
    url.searchParams.set('action', 'ISSUE');
    url.searchParams.set('params', `0|${tick}`);
    url.searchParams.set('source', source);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`feequote ${tick} -> ${res.status}`);
    return res.json();
}

/** Spendable coin at `address`, in satoshis, off the encoder's own utxo view. */
async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
}

/**
 * Mines only when something is actually waiting for a block (§3.5, Session 29).
 *
 * Unconditional mining outruns the decoder and that is a feedback loop: a
 * lagging decoder makes each wait longer, which mines more.
 */
async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* the miner is best-effort here; the waits below carry the timeout */ }
}

/**
 * Waits for the action carrying `txid` and returns its full record.
 *
 * Waits on the ACTION LIST and fetches the detail only for an index the list
 * has already returned: a speculative GET of an index that does not exist yet
 * is memoised blank for the life of the explorer process (§3.6, D-127).
 */
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
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}, indexer lag `
        + `${status?.chain_lag_blocks?.[REGTEST_COIN]}. A lag that does not shrink over two reads `
        + 'is wedging the venue, not a wallet defect (§3.7).');
}

/** Waits for `tick` at `address` to read exactly `want`, and returns it. */
async function waitForBalance(address, tick, want, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last === want) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance for ${address} never reached ${want} (last=${last})`);
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
 * Reloads onto a clean, unlocked Home.
 *
 * Navigating FIRST is load-bearing: the shell restores the route it was on, and
 * `unlockAfterReload` waits for Home's balance hero, so a reload from anywhere
 * else unlocks fine and then times out on a healthy wallet (§3.5, Session 32).
 */
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
    // The success screens render the id with no separators, so a \b-anchored
    // pattern does not match (§3.5, Session 30).
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/** The composed PSBT's own network fee, in satoshis, off the confirm screen. */
async function screenNetworkFeeSats(page) {
    const text = await page.getByTestId('confirm-fee').innerText();
    const coin = Number(text.match(/([\d.]+)\s*[A-Z]{3,5}/)?.[1]);
    expect(Number.isFinite(coin), `unparseable network fee line: ${text}`).toBe(true);
    return Math.round(coin * 1e8);
}

/**
 * The protocol-fee row inside the balance projection, in satoshis, or null.
 *
 * Read out of the deltas panel because that is where that fix put it.
 */
async function projectedProtocolFeeSats(page) {
    const deltas = page.getByTestId('action-intent-deltas');
    if (await deltas.count() === 0) return null;
    const text = await deltas.innerText();
    const coin = text.match(/Protocol fee\s*[A-Z]{3,5}\s*([\d.]+)/)?.[1];
    return coin === undefined ? null : Math.round(Number(coin) * 1e8);
}

/**
 * Onboards a fresh wallet, funds its ONLY address, and issues `PARENT` from it
 * through the DIRECT Issue form. Returns that address.
 *
 * Level 1 is issued somewhere other than the wizard because the wizard is what
 * is under test, and while the wallet holds exactly one address, so the owner
 * and the wizard's auto-picked signer are the same throughout - the ownership
 * gate is Session 39's subject, not this one's.
 */
async function onboardAndIssueParent(page, walletName) {
    await createWallet(page, { password: PASSWORD, name: walletName });
    await switchToRegtest(page, PASSWORD);

    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);

    const source = await main.getByLabel('From').inputValue();
    expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
        .toMatch(REGTEST_ADDRESS_RE);

    await fundAddress(source, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    await seedPrices();

    await gotoPalette(page, 'Issue token');
    const form = page.getByRole('main');
    await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(form);
    expect(await form.getByLabel('From').inputValue(),
        'the Issue form changed its From address between the two visits')
        .toBe(source);
    await form.getByLabel('Ticker').fill(PARENT);
    await form.getByLabel('Supply', { exact: true }).fill(String(PARENT_SUPPLY));
    await form.getByRole('button', { name: 'Issue token', exact: true }).click();

    await expectConfirmScreen(page);
    const issued = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(issued.status),
        `the venue rejected the ISSUE of ${PARENT} (${issued.status}); on this chain that is `
        + 'usually the price sentinel going stale mid-run (campaign §3.2), not a wallet defect')
        .toBe('valid');
    await waitForBalance(source, PARENT, PARENT_SUPPLY);
    return source;
}

/**
 * Fills the wizard's Subtoken template and submits it, WITHOUT assuming what
 * happens next: a refused action never reaches the confirm screen at all (the
 * native-fee pre-flight answers on the form), so the caller waits for whichever
 * of the two outcomes it is asserting.
 *
 * Returns the address it is signing with, read off the chain step.
 */
async function fillSubtoken(page, { parent, child, supply }) {
    await reloadToHome(page);
    await gotoPalette(page, 'Create a token');

    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Subtoken/ }).click();
    await selectVenueChain(main);

    // POLLED, not read once: the signer resolves in an effect that re-runs when
    // the chain changes, so a single read straight after picking the network
    // catches the render before it and returns "" (§3.5, Session 39).
    let feePaidBy = '';
    await expect.poll(async () => {
        feePaidBy = await main.getByLabel('Fee paid by').inputValue().catch(() => '');
        return feePaidBy;
    }, {
        timeout: 30_000,
        message: 'the wizard\'s chain step names no signing address at all',
    }).toMatch(REGTEST_ADDRESS_RE);

    await main.getByRole('button', { name: 'Next', exact: true }).click();

    await expect(main.getByLabel('Parent ticker')).toBeVisible({ timeout: 30_000 });
    await main.getByLabel('Parent ticker').fill(parent);
    await main.getByLabel('Subtoken name').fill(child);
    await main.getByLabel('Supply', { exact: true }).fill(String(supply));
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();

    return feePaidBy.trim();
}

/**
 * Composes a subtoken and settles it on chain, asserting the confirm screen's
 * disclosure against the venue's quote and the payer's own coin on the way.
 *
 * Returns the indexed action record.
 */
async function issueSubtokenAndSettle(page, { parent, child, supply, owner, expectedFeeSats }) {
    const satsBefore = await coinBalanceSats(owner);

    await fillSubtoken(page, { parent, child, supply });
    await expectConfirmScreen(page);

    const minerSats = await screenNetworkFeeSats(page);
    const feeSats = await projectedProtocolFeeSats(page);
    expect(feeSats,
        'the confirm screen disclosed no protocol fee at all on a fee-bearing ISSUE')
        .not.toBeNull();
    expect(feeSats,
        `the screen projected ${feeSats} sats of protocol fee against the venue's own quote of `
        + `${expectedFeeSats} for this exact action`)
        .toBe(expectedFeeSats);

    const action = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(action.status),
        `the chain refused ${parent}.${child}: ${action.status}`)
        .toBe('valid');

    // Read off the action's own fee record: this is the chain agreeing it
    // charged the SUBTOKEN rate at this depth rather than the plain one.
    expect(Number(action.fee?.gas_cost),
        `a level-${String(parent).split('.').length + 1} subtoken was priced at the plain ISSUE `
        + 'gas rate on chain')
        .toBe(50_000);

    const satsAfter = await coinBalanceSats(owner);
    expect(satsBefore - satsAfter,
        `${parent}.${child} cost ${satsBefore - satsAfter} sats against a screen that disclosed `
        + `${minerSats} network + ${feeSats} protocol`)
        .toBe(minerSats + feeSats);

    return action;
}

test.describe(`subtoken depth on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('a grandchild issues under a parent that is itself a subtoken, at the same halved rate', async ({ page }) => {
        let owner;
        const childTick = `${PARENT}.${CHILD}`;
        const grandTick = `${PARENT}.${CHILD}.${GRAND}`;

        await test.step('onboard, fund, and issue level 1 from the only address', async () => {
            owner = await onboardAndIssueParent(page, 'Subtoken Depth Wallet');
        });

        await test.step('level 2: an ordinary subtoken, so level 3 has a dotted parent to hang off', async () => {
            const quote = await feeQuote(childTick, owner);
            expect(String(quote.status), `the venue will not price ${childTick}`).toBe('valid');
            await issueSubtokenAndSettle(page, {
                parent: PARENT,
                child: CHILD,
                supply: CHILD_SUPPLY,
                owner,
                expectedFeeSats: Number(quote.requiredFeeSats),
            });
            await waitForBalance(owner, childTick, CHILD_SUPPLY);
        });

        await test.step('the chain prices a GRANDchild like any other subtoken, not like a plain ISSUE', async () => {
            // Both quotes at the same block from the same address, so the only
            // thing differing is the tick's depth.
            const plain = await feeQuote(PLAIN_PROBE, owner);
            const grand = await feeQuote(grandTick, owner);

            expect(String(plain.status), 'the venue cannot price a plain ISSUE at all').toBe('valid');
            expect(String(grand.status),
                `the venue refuses a grandchild under a parent this address owns: ${grand.status}. `
                + 'That would make the wizard\'s old refusal correct, and this whole lane moot')
                .toBe('valid');

            // Depth does not compound the discount and does not lose it: a
            // level-3 tick is charged exactly what a level-2 one is.
            expect(Number(grand.xchainFee) * 2,
                'a grandchild is not costing half a plain ISSUE, so the halving this test measures '
                + 'the screen against is not in force at depth')
                .toBe(Number(plain.xchainFee));
        });

        await test.step('THE FIX: the wizard accepts a dotted parent and the grandchild settles', async () => {
            // Before D-168 this never reached a network call: the form refused
            // `DPT….KID` in the parent field with "Parent ticker must be A–Z,
            // 0–9." and there was no other surface that could compose it.
            const quote = await feeQuote(grandTick, owner);
            const action = await issueSubtokenAndSettle(page, {
                parent: childTick,
                child: GRAND,
                supply: GRAND_SUPPLY,
                owner,
                expectedFeeSats: Number(quote.requiredFeeSats),
            });

            // The full dotted name, three levels deep, on the chain's own record.
            expect(String(action.tick ?? action.params?.TICK ?? ''),
                'the action that settled does not carry the three-level tick')
                .toBe(grandTick);

            // The new token exists with its supply on the issuer, and NEITHER
            // ancestor moved - which is what says level 3 is a new token rather
            // than an edit of the one it hangs off.
            await waitForBalance(owner, grandTick, GRAND_SUPPLY);
            expect(await tokenBalance(owner, childTick),
                'issuing the grandchild moved its parent\'s supply')
                .toBe(CHILD_SUPPLY);
            expect(await tokenBalance(owner, PARENT),
                'issuing the grandchild moved the top-level supply')
                .toBe(PARENT_SUPPLY);
        });

        await test.step('and the parent is passed whole: an absent MIDDLE level is refused, not truncated', async () => {
            // The control on the join. A wallet that sent only the first
            // segment would read `${PARENT}.${ABSENT}` as `${PARENT}` - a token
            // that exists and that this address owns - and would happily create
            // `${PARENT}.${GRAND}`, a second CHILD wearing the name of a
            // grandchild. Every assertion above would still be green.
            const absentParent = `${PARENT}.${ABSENT}`;
            const quote = await feeQuote(`${absentParent}.${GRAND}`, owner);
            expect(String(quote.status),
                'the venue accepts a child under a middle level that was never issued, so this '
                + 'step cannot tell truncation from correctness')
                .toMatch(/parent unknown/i);

            const satsBefore = await coinBalanceSats(owner);
            await fillSubtoken(page, {
                parent: absentParent, child: GRAND, supply: GRAND_SUPPLY,
            });

            // Refused on the FORM by the native-fee pre-flight, so no confirm
            // screen opens and no fee is attached to anything (Session 39).
            const alert = page.getByRole('alert').filter({ hasText: /parent unknown/i });
            await expect(alert,
                'the wizard neither refused a grandchild under a non-existent middle level nor '
                + 'explained it, which is what truncating the parent to its first segment would '
                + 'look like from here')
                .toBeVisible({ timeout: 90_000 });
            await expect(alert).toContainText(/Nothing was signed or sent/i);
            expect(await page.getByTestId('confirm-modal').count(),
                'an ISSUE the network has already refused reached the confirm screen')
                .toBe(0);
            expect(await coinBalanceSats(owner),
                'a refused compose still moved coin')
                .toBe(satsBefore);
        });
    });
});
