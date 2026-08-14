// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Create token" -> the UTILITY template, the last of
// the wizard's seven to go undriven, and the only one whose distinguishing
// field changes what the token can DO with money rather than what it records.
//
// WHAT IS ACTUALLY BEING TESTED, and it is not the ISSUE. `utility` is the
// plain template - no locks, no fixed numbers - so the ISSUE itself adds
// nothing the direct Issue form has not already proven. What is unique to it
// is the `divisible` checkbox, which is the ONLY control in the wizard that
// decides DECIMALS (8 vs 0), and DECIMALS is a consensus rule on every later
// SEND: `send.js` refuses an amount whose precision exceeds the tick's with
// `invalid: AMOUNT (format)` (`isValidAmountFormat`, plus the
// FRACTIONAL-PRECISION-CAP in `utility.js`).
//
// So a chain record reading `decimals: 8` proves the wallet wrote a field. The
// money path is what proves the field means anything, and the two halves are
// driven against the SAME token so nothing but the precision differs:
//
//   SEND 0.5           -> settles, and the recipient is credited exactly 0.5
//   SEND 0.123456789   -> 9 fractional digits against 8, refused by the chain
//
// Measured against the venue with curl before this was written, on an
// indivisible token, which is what says the rule is real rather than assumed:
//   SEND 0|DPT415534|1|<dest>    -> valid, xchainFee 0.00000000, 0 sats
//   SEND 0|DPT415534|0.5|<dest>  -> invalid: AMOUNT (format)
//
// ⚠️ AND NOTE WHAT THAT FIRST LINE SAYS: **A SEND IS FREE.** There is no
// protocol fee to quote, so the pre-flight DRY RUN is the only thing standing
// between a malformed amount and a broadcast. `tests/send/preflight-gate`
// established the trust model that gate runs on - a network-sourced `fail`
// blocks Approve by DEFAULT but is ALWAYS overridable, deliberately, because
// the explorer is trusted for liveness and not for censorship. That is right
// for a verdict like "insufficient funds", which is an opinion about chain
// state the explorer could be wrong about. It is a poor fit for
// `AMOUNT (format)`, which is deterministic arithmetic the wallet could check
// itself without trusting anyone: overriding it can only ever confirm a
// transaction whose action is invalid, burning the miner fee and moving no
// tokens. This spec therefore asserts the gate HOLDS on that verdict and
// records what it says; it does not assert the amount is blocked at the field,
// because today nothing checks precision there (`Send.jsx`'s input guard is a
// bare `/^\d*\.?\d*$/`, and `ContractStakeForm` only HINTS the rule in prose).
//
// A NOTE ON THE SIBLING TEMPLATE, since this is the file that raised it:
// `TEMPLATE_COMPOSERS.community` used to return `TEMPLATE_COMPOSERS.utility(form)`
// verbatim, with a field-for-field identical `TEMPLATE_FIELDS.community`, so the
// two templates composed the same ISSUE. The Community card's tagline was
// "Dividend-enabled, mintable" - and `dividend.js` has no per-token opt-in at
// all (it requires only that both ticks exist and neither is sleeping), so
// every token is dividend-enabled, including Meme and Collectible.
// merged the card into Utility and put the plain statement on the picker; the
// picker copy and the composed ISSUE are covered by
// test/unit/routes/TokenWizard.dividendCopy.test.jsx, since there was never an
// on-chain difference for an e2e spec to assert.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/utility-divisible-send.regtest.spec.js

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
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
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** The ISSUE pays a real coin fee; the sends are free. */
const FUNDING = 3;
const STAMP = Date.now().toString().slice(-6);
const TICK = `UTL${STAMP}`;
const SUPPLY = 1000;
const MAX_MINT = 50;

/** Legal at DECIMALS 8. */
const DIVISIBLE_AMOUNT = '0.5';
/** Nine fractional digits against eight: one digit too fine. */
const TOO_PRECISE = '0.123456789';

const explorerJson = async (path) => {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`);
    if (!res.ok) throw new Error(`explorer ${path} -> ${res.status}`);
    return res.json();
};

/**
 * A second address of this wallet, on the VENUE chain, to receive the sends.
 *
 * NOT the fixture's `REGTEST_DESTINATION`: that constant is a hard-coded
 * BITCOIN regtest address (`bcrt1q...`) even though the venue table behind
 * `XC_REGTEST_COIN` is multi-chain, so every SEND it addresses off Bitcoin is
 * refused `invalid: DESTINATION (format)` - which cost this spec a run and
 * presents as the chain rejecting a perfectly good amount. Generating one here
 * also lets the credit be read back through the same wallet.
 */
let destination;

/** The venue's verdict for a SEND of `amount` of TICK from `source`. */
async function sendQuote(amount, source) {
    const url = new URL(`${EXPLORER_URL}/${REGTEST_COIN}/api/feequote`);
    url.searchParams.set('action', 'SEND');
    url.searchParams.set('params', `0|${TICK}|${amount}|${destination}`);
    url.searchParams.set('source', source);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`feequote SEND -> ${res.status}`);
    return res.json();
}

/**
 * Mines a block while the decoder is keeping up.
 *
 * Gated on the DECODER's lag rather than the miner's `mempool_size`: that
 * counter was measured unreliable on this venue on 2026-08-01 (it reported
 * `mempool_size: 0` and a frozen `blocks_mined` while `generate_blocks` really
 * mined), which makes the §3.5 helper inert and strands broadcast actions.
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
        + 'reads is wedging the venue, not a wallet defect - and decoder_health stays'
        + '"healthy" throughout, so do not read that instead (§3.7).');
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
 * Generates one address on the venue chain and returns it.
 *
 * Identified by DIFFERENCE against a snapshot rather than by prefix: BTC and
 * LTC regtest share the legacy m/n/2 version bytes and DOGE has no bech32
 * form, so "the one that looks like this chain's" is ambiguous on exactly
 * these venues (§3.5). The modal has its OWN coin picker, labelled "Coin".
 */
async function generateVenueAddress(page) {
    await gotoPalette(page, 'Addresses');
    const listed = async () => {
        const rows = page.getByRole('button', { name: /^View address / });
        await expect(rows.first()).toBeVisible({ timeout: 30_000 });
        return (await Promise.all((await rows.all()).map((r) => r.getAttribute('aria-label'))))
            .map((l) => String(l).replace('View address ', ''))
            .filter(Boolean);
    };
    const before = new Set(await listed());

    await page.getByRole('button', { name: 'Add or import address' }).click();
    await page.getByRole('menuitem', { name: 'Add address' }).click();
    await selectVenueChain(page, 'Coin');
    await page.getByRole('button', { name: /^Generate/ }).click();

    const generated = (await listed()).filter((a) => !before.has(a));
    expect(generated.length, 'generating added exactly one address to the list').toBe(1);
    return generated[0];
}

/** Walks the Send form for `amount` of TICK and submits it. */
async function fillSend(page, amount) {
    await reloadToHome(page);
    await gotoSection(page, 'Send');
    // The form opens on BITCOIN with the native coin selected ("Token: BTC on
    // Bitcoin"), and the token search lives BEHIND that button - it is not on
    // the form. Picking the token is also what retargets the form's chain,
    // which is why no separate network step is needed here (§3.5 bullet 2).
    await page.getByRole('button', { name: /^Token:/ }).click();
    await page.getByLabel('Search coins or tokens').fill(TICK);
    await page.getByLabel(new RegExp(`Open ${TICK} details`, 'i')).first().click();
    await page.getByLabel('To', { exact: true }).fill(destination);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(amount);
    await mainButton(page, 'Send').click();
}

test.describe(`utility token divisibility on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('the divisible checkbox decides DECIMALS, and DECIMALS decides what can be sent', async ({ page }) => {
        let owner;

        await test.step('onboard, fund, and issue a DIVISIBLE utility token', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Utility Wallet' });
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

            await gotoPalette(page, 'Create a token');
            const main = page.getByRole('main');
            await main.getByRole('button', { name: /^Utility/ }).click();
            await selectVenueChain(main);
            await expect.poll(async () => main.getByLabel('Fee paid by').inputValue().catch(() => ''),
                { timeout: 30_000, message: 'the wizard names no signing address' })
                .toMatch(REGTEST_ADDRESS_RE);
            await main.getByRole('button', { name: 'Next', exact: true }).click();

            await expect(main.getByLabel('Token name (ticker)')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Token name (ticker)').fill(TICK);
            await main.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
            // The two fields only this template and Custom expose.
            await main.getByLabel('Divisible (8 decimal places)').check();
            await main.getByLabel('Max mint per transaction (optional)').fill(String(MAX_MINT));
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmScreen(page);
            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status), `the venue rejected the utility token: ${action.status}`)
                .toBe('valid');

            // The checkbox's whole effect, and the other utility-only field.
            expect(String(action.decimals),
                'the Divisible checkbox did not put DECIMALS 8 on chain, so every assertion below '
                + 'is measuring the wrong token')
                .toBe('8');
            expect(String(action.max_mint), 'MAX_MINT did not reach the chain')
                .toBe(String(MAX_MINT));

            await waitForBalance(owner, TICK, SUPPLY);

            // On the VENUE chain, and generated rather than hard-coded - see
            // `destination` above for the run this cost.
            destination = await generateVenueAddress(page);
            expect(destination, 'the generated destination is not on the venue chain')
                .toMatch(REGTEST_ADDRESS_RE);
            expect(destination, 'the destination is the sender, so a credit would prove nothing')
                .not.toBe(owner);
        });

        await test.step('the chain agrees: 0.5 is legal here and 9 digits is not', async () => {
            // Both quotes at the same block from the same address, so the only
            // thing differing is the amount's precision.
            const ok = await sendQuote(DIVISIBLE_AMOUNT, owner);
            const tooFine = await sendQuote(TOO_PRECISE, owner);

            expect(ok.valid,
                `the venue refuses a ${DIVISIBLE_AMOUNT} SEND of a DECIMALS-8 token, so the send `
                + 'below would fail for a reason this test is not about')
                .toBe(true);
            // Worth pinning: a SEND carries no protocol fee, which is why the
            // dry run is the only gate in front of a malformed amount.
            expect(String(ok.requiredFeeSats ?? '0'), 'a SEND has started charging a protocol fee')
                .toBe('0');
            expect(String(tooFine.error || tooFine.status),
                'the chain accepted 9 fractional digits on an 8-decimal token, so the '
                + 'FRACTIONAL-PRECISION-CAP is not in force on this venue')
                .toMatch(/AMOUNT \(format\)/i);
        });

        await test.step('THE MONEY PATH: a fractional send settles and credits exactly', async () => {
            await fillSend(page, DIVISIBLE_AMOUNT);
            await expectConfirmScreen(page);
            const action = await waitForIndexedAction(await approveAndGetTxid(page));

            // A SEND's action record carries NO `status` and a null top-level
            // `tick` - unlike an ISSUE, which is what every other spec in this
            // directory asserts on. Its validity IS the credit/debit pair, and
            // that pair is the better evidence here anyway: it carries the
            // amount at full precision, so the fractional value is read off the
            // action itself rather than inferred from a verdict string.
            const credit = (action.credits || [])
                .find((c) => c.tick === TICK && c.address === destination);
            const debit = (action.debits || [])
                .find((d) => d.tick === TICK && d.address === owner);
            expect(credit,
                `the SEND recorded no ${TICK} credit to the destination (status=${action.status}, `
                + `credits=${JSON.stringify(action.credits)})`)
                .toBeTruthy();
            expect(String(credit.amount),
                'the recipient was credited a different amount than was sent, which is what a '
                + 'truncation or rounding bug on a divisible token looks like')
                .toBe(DIVISIBLE_AMOUNT);
            expect(String(debit?.amount), 'the sender was debited a different amount than the credit')
                .toBe(DIVISIBLE_AMOUNT);

            // Credited EXACTLY, not merely non-zero: a divisibility bug that
            // truncated to 0 or rounded to 1 would still move a balance.
            await waitForBalance(destination, TICK, DIVISIBLE_AMOUNT);
            await waitForBalance(owner, TICK, SUPPLY - Number(DIVISIBLE_AMOUNT));
        });

        await test.step('and an over-precise amount does not get signed', async () => {
            await fillSend(page, TOO_PRECISE);

            // Two outcomes are acceptable and both are recorded rather than
            // assumed: the form may refuse it outright, or it may reach the
            // confirm screen where the pre-flight gate holds Approve disabled.
            // What is NOT acceptable is a signable transaction, because this
            // action can only ever confirm as `invalid` and burn the miner fee.
            const confirm = page.getByTestId('confirm-modal');
            const approve = page.getByTestId('confirm-approve');
            const formAlert = page.getByRole('alert');

            await confirm.or(formAlert).first()
                .waitFor({ state: 'visible', timeout: 90_000 });

            if (await confirm.count() > 0) {
                // The gate blocks by default (tests/send/preflight-gate), and
                // is deliberately overridable - so this asserts the DEFAULT,
                // which is the state a user actually meets.
                await expect(approve,
                    'an amount the chain will refuse as AMOUNT (format) reached a signable confirm '
                    + 'screen: overriding this can only burn the miner fee, since no chain state '
                    + 'can ever make 9 digits legal on an 8-decimal token')
                    .toBeDisabled({ timeout: 90_000 });
            } else {
                await expect(formAlert.first()).toBeVisible();
            }

            // Whatever the surface, nothing moved.
            expect(await tokenBalance(owner, TICK),
                'a refused over-precise send still moved the balance')
                .toBe(SUPPLY - Number(DIVISIBLE_AMOUNT));
        });
    });
});
