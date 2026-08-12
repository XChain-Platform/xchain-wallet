// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Create token" -> SUBTOKEN: the PARENT.CHILD lane,
// which no session has ever composed, signed or broadcast.
//
// WHY IT IS WORTH A RUN. A subtoken is the only ISSUE the chain judges against
// SOMEBODY ELSE'S record: `issue.js` splits the tick on its dot, looks the
// parent up, and refuses the child unless the parent exists AND its OWNER is
// this action's SOURCE. Three verdicts, measured against this venue with curl
// before a browser was opened, so the spec knows what the chain does before it
// asks the wallet:
//
//   ISSUE 0|PROBEX99              -> valid,  xchainFee 1.00000000, 6,666,667 sats
//   ISSUE 0|EXL874792.KID9        -> valid,  xchainFee 0.50000000, 3,333,333 sats
//   ISSUE 0|NOSUCHPARENTZZ.KID9   -> invalid: TICK (parent unknown)
//   ...and the middle one from an address that does NOT own EXL874792:
//                                 -> invalid: TICK (parent issued by another address)
//
// So the lane carries a fee rule and an authorisation rule at once, and the two
// assertions the campaign cares about fall straight out of them.
//
// THE FEE IS EXACTLY HALF, AND THAT IS THE TEETH ON TEST 1. The gas schedule
// prices ISSUE at 100000 and ISSUE_SUBTOKEN at 50000, and the indexer picks
// between them on `parentInfo` - i.e. on the tick containing a dot. Nothing in
// the wallet knows that. It quotes by handing the composed params to the venue,
// so a wizard that composed the child's name without joining the parent (or
// quoted before the join) would price this action at DOUBLE and disclose the
// wrong number under, while still broadcasting something the chain
// accepts. A green "the token exists" would hide that completely, which is why
// the projected protocol fee is compared against the SUBTOKEN quote and
// asserted to differ from the plain-ISSUE one.
//
// TEST 2 IS THE SAME FORM WITH ONE VARIABLE CHANGED: who owns the parent. Same
// wallet, same chain, same parent ticker, same child name, minutes apart - the
// only difference is that the wizard is signing from a second address. That is
// not a contrived setup. The wizard has NO source picker at all: it auto-picks
// the highest external HD address on the chain (`TokenWizard.jsx`, "Auto-pick
// the highest external HD address"), so any user who issues a parent and later
// taps Receive has silently moved the signer off the owner. The direct Issue
// form, which cannot compose a subtoken at all (its ticker validation is
// `/^[A-Za-z0-9]+$/`, so the dot is refused), is the one with the picker.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/subtoken-issue.regtest.spec.js

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
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Every leg here (two ISSUEs, plus a refused one) pays a real coin fee. */
const FUNDING = 3;
const STAMP = Date.now().toString().slice(-6);
/** The parent, issued through the DIRECT form, which is the only one with a source picker. */
const PARENT = `PAR${STAMP}`;
/** The child's own half of the ticker; the full tick is `${PARENT}.${CHILD}`. */
const CHILD = 'KID';
const PARENT_SUPPLY = 1000;
const CHILD_SUPPLY = 500;
/** Quoted but never issued: the control the subtoken quote is halved against. */
const PLAIN_PROBE = `PLN${STAMP}`;
/** Test 2's parent, in its own wallet, owned by an address the wizard will not pick. */
const GATE_PARENT = `GAT${STAMP}`;

const explorerJson = async (path) => {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`);
    if (!res.ok) throw new Error(`explorer ${path} -> ${res.status}`);
    return res.json();
};

/**
 * The venue's own fee quote for an ISSUE of `tick` from `source`.
 *
 * This is the authority the confirm screen is checked against (§4, "never trust
 * a confirm-screen total on a fee-bearing action"), and here it is also the
 * only way to learn the parent rules without broadcasting: the quote runs the
 * real handler, so it answers `invalid: TICK (...)` for a child whose parent is
 * missing or owned elsewhere.
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
    } catch { /* transient while a block lands */ }
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
        + `${status?.chain_lag_blocks?.[REGTEST_COIN]}. A non-zero lag means the venue is `
        + 'behind, not that the wallet sent something wrong.');
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
 * Read out of the deltas panel because that is where that fix put it: the
 * row rides beside the coin balance it was folded into, so a fee claimed in
 * words but missing from the projection is exactly what this reads for.
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
 * The parent has to exist before the wizard runs, and it has to be issued
 * somewhere other than the wizard, because the wizard is the surface under
 * test. It is also issued while the wallet holds exactly one address, so the
 * owner and the wizard's auto-picked signer are the same address in test 1 and
 * provably different in test 2.
 */
async function onboardAndIssueParent(page, walletName, parentTick = PARENT) {
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
    await form.getByLabel('Ticker').fill(parentTick);
    await form.getByLabel('Supply', { exact: true }).fill(String(PARENT_SUPPLY));
    await form.getByRole('button', { name: 'Issue token', exact: true }).click();

    await expectConfirmScreen(page);
    const issued = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(issued.status),
        `the venue rejected the ISSUE of ${parentTick} (${issued.status}); on this chain that is `
        + 'usually the price sentinel going stale mid-run (campaign §3.2), not a wallet defect')
        .toBe('valid');
    await waitForBalance(source, parentTick, PARENT_SUPPLY);
    return source;
}

/**
 * Fills the wizard's Subtoken template and submits it, WITHOUT assuming what
 * happens next: a refused action never reaches the confirm screen at all (the
 * native-fee pre-flight answers on the form), so the caller waits for whichever
 * of the two outcomes it is asserting.
 *
 * `signAs` picks the signing address through the chain step's own picker.
 * Omitted, the wizard's default stands - which is the newest external HD
 * address, and is the whole subject of the second test.
 *
 * Returns the address it is signing with, read off the chain step.
 */
async function fillSubtoken(page, { parent, child, supply, signAs }) {
    await reloadToHome(page);
    await gotoPalette(page, 'Create a token');

    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Subtoken/ }).click();

    await selectVenueChain(main);

    // POLLED, not read once: the signer is resolved by an effect that re-runs
    // when the chain changes, so a single read straight after picking the
    // network catches the render before it and returns "" - which reads
    // exactly like a wizard that names no signer at all. Cost a run.
    const signerField = () => main.getByLabel('Fee paid by');
    let feePaidBy = '';
    await expect.poll(async () => {
        feePaidBy = await signerField().inputValue().catch(() => '');
        return feePaidBy;
    }, {
        timeout: 30_000,
        message: 'the wizard\'s chain step names no signing address at all, so there is nothing '
            + 'to check the parent\'s owner against',
    }).toMatch(REGTEST_ADDRESS_RE);

    if (signAs && signAs !== feePaidBy) {
        // Through the wallet's own picker, not by any back door: the point of
        // the fix is that this route exists from the screen a user is on when
        // the chain tells them the signer is wrong.
        await page.getByRole('button', { name: 'Choose source address' }).click();
        const row = page.getByRole('button', { name: `View address ${signAs}` });
        await expect(row, `the source picker does not offer ${signAs}`)
            .toBeVisible({ timeout: 30_000 });
        await row.click();
        await expect.poll(async () => {
            feePaidBy = await signerField().inputValue().catch(() => '');
            return feePaidBy;
        }, { timeout: 30_000 }).toBe(signAs);
    }

    await main.getByRole('button', { name: 'Next', exact: true }).click();

    await expect(main.getByLabel('Parent ticker')).toBeVisible({ timeout: 30_000 });
    await main.getByLabel('Parent ticker').fill(parent);
    await main.getByLabel('Subtoken name').fill(child);
    await main.getByLabel('Supply', { exact: true }).fill(String(supply));
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();

    return feePaidBy.trim();
}

/** Fills the form and waits for the confirm screen, for a composition that must reach it. */
async function composeSubtoken(page, opts) {
    const signer = await fillSubtoken(page, opts);
    await expectConfirmScreen(page);
    return signer;
}

/**
 * Generates one address on the venue chain and returns it.
 *
 * Identified by DIFFERENCE against a snapshot rather than by prefix: BTC and
 * LTC regtest share the legacy m/n/2 version bytes and DOGE has no bech32 form,
 * so "the one that looks like this chain's" is ambiguous on exactly these
 * venues (§3.5). The modal has its OWN coin picker, labelled "Coin".
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

test.describe(`subtoken issuance on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('a subtoken issues under its own parent, and is priced at half an ISSUE', async ({ page }) => {
        let owner;
        /** The venue's quote for this exact child, in sats and XCHAIN. */
        let childQuote;
        /** The same quote for a PLAIN token from the same address at the same block. */
        let plainQuote;

        await test.step('onboard, fund, and issue the parent from the only address', async () => {
            owner = await onboardAndIssueParent(page, 'Subtoken Wallet');
        });

        await test.step('the chain prices a subtoken at exactly half a plain ISSUE', async () => {
            plainQuote = await feeQuote(PLAIN_PROBE, owner);
            childQuote = await feeQuote(`${PARENT}.${CHILD}`, owner);

            expect(String(plainQuote.status), 'the venue cannot price a plain ISSUE at all')
                .toBe('valid');
            expect(String(childQuote.status),
                `the venue refuses a subtoken under a parent this address owns: ${childQuote.status}`)
                .toBe('valid');

            // The rule the wallet has to reflect without knowing it exists:
            // ISSUE_SUBTOKEN is 50000 gas against ISSUE's 100000, selected by
            // the indexer on the tick's dot alone.
            //
            // EXACT in XCHAIN, and one satoshi off in coin - measured, not
            // tolerated on principle. The gas charge halves cleanly
            // (1.00000000 -> 0.50000000 XCHAIN) and the coin figure is that
            // divided by the LTC price and rounded to 8 places, so $30 gives
            // 0.06666667 rounded UP against 0.03333333 rounded DOWN. Asserting
            // an exact doubling here failed on that satoshi, which is
            // arithmetic rather than a fee rule.
            expect(Number(childQuote.xchainFee) * 2,
                'a subtoken is not costing half a plain ISSUE on this venue, so the halving this '
                + 'test measures the screen against is not in force')
                .toBe(Number(plainQuote.xchainFee));
            expect(Math.abs(Number(childQuote.requiredFeeSats) * 2
                - Number(plainQuote.requiredFeeSats)),
                'the coin quotes are further apart than the 1-sat rounding the halving allows')
                .toBeLessThanOrEqual(1);
        });

        let signer;
        await test.step('the wizard composes it, and quotes the SUBTOKEN price on screen', async () => {
            signer = await composeSubtoken(page, {
                parent: PARENT, child: CHILD, supply: CHILD_SUPPLY,
            });
            expect(signer,
                'the wizard is not signing with the address that owns the parent, so this run is '
                + 'measuring the refusal path instead of the happy one')
                .toBe(owner);

            // Nothing is wrong with this action, and the wallet has to agree
            // before the fee assertion below means anything.
            //
            // Asserted on `data-dryrun` rather than on the chip, because the
            // chip reads "Review warnings" here for a reason that is not about
            // the subtoken at all: every fee-bearing action on this chain
            // carries the native-fee forfeiture notice, which is a warn. The
            // machine-readable attribute says the stronger thing anyway - that
            // the network was ASKED and approved, rather than that the client
            // found nothing to say.
            const panel = page.getByTestId('preflight-panel');
            await expect(panel).toHaveAttribute('data-dryrun', 'approved');
            expect(await panel.getAttribute('data-verdict'),
                'the network refused a subtoken under a parent this address owns')
                .not.toBe('fail');
            await expect(page.getByTestId('ack-DRYRUN_INVALID')).toHaveCount(0);

            // THE ASSERTION THIS TEST EXISTS FOR. Litecoin forces the native
            // lane, so the cost is disclosed as a coin row in the
            // projection. It must be the SUBTOKEN quote.
            const projected = await projectedProtocolFeeSats(page);
            expect(projected,
                'the balance projection carries no protocol-fee row, so the screen is showing the '
                + 'miner fee as the whole cost of a fee-bearing action')
                .toBe(Number(childQuote.requiredFeeSats));
            expect(projected,
                'the screen priced this subtoken as a PLAIN ISSUE - double what the chain charges. '
                + 'That is a quote composed without the parent join')
                .not.toBe(Number(plainQuote.requiredFeeSats));
        });

        await test.step('the chain accepts it, and takes exactly what the screen said', async () => {
            const satsBefore = await coinBalanceSats(owner);
            const minerSats = await screenNetworkFeeSats(page);
            const feeSats = Number(childQuote.requiredFeeSats);

            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status), 'the chain rejected a subtoken under its own parent')
                .toBe('valid');

            // Read off the action's own fee record rather than inferred: this
            // is the chain agreeing that it charged the subtoken rate.
            expect(Number(action.fee?.gas_cost),
                'the action was priced at the plain ISSUE gas rate on chain')
                .toBe(50_000);
            expect(Math.round(Number(action.fee?.native_coin_amount) * 1e8),
                `the coin fee on chain is not the ${feeSats} sats the screen projected`)
                .toBe(feeSats);

            // The token exists, under its full dotted name, with the supply on
            // the issuer - and the PARENT is untouched, which is what says the
            // child is a new token rather than an edit of the one it hangs off.
            await waitForBalance(owner, `${PARENT}.${CHILD}`, CHILD_SUPPLY);
            expect(await tokenBalance(owner, PARENT),
                'issuing the child moved the parent supply')
                .toBe(PARENT_SUPPLY);

            // that subtraction: what it cost, against what was disclosed.
            const satsAfter = await coinBalanceSats(owner);
            expect(satsBefore - satsAfter,
                `the subtoken cost ${satsBefore - satsAfter} sats against a screen that disclosed `
                + `${minerSats} network + ${feeSats} protocol`)
                .toBe(minerSats + feeSats);
        });
    });

    test('a subtoken is refused from an address that does not own the parent, and the wizard can be pointed at one that does', async ({ page }) => {
        /** Owns GATE_PARENT. Issued from the wallet's only address, before any other exists. */
        let owner;
        /** Generated afterwards, so it becomes the highest external HD index. */
        let stranger;

        await test.step('onboard, issue the parent, then generate a second address', async () => {
            owner = await onboardAndIssueParent(page, 'Subtoken Gate Wallet', GATE_PARENT);

            stranger = await generateVenueAddress(page);
            expect(stranger, 'the generated address is not on the venue chain')
                .toMatch(REGTEST_ADDRESS_RE);
            expect(stranger, 'generating returned the address that already existed')
                .not.toBe(owner);

            // Funded, so that a refusal below is attributable to the parent
            // rule and not to an address with nothing to spend. An unfunded
            // signer dies at the encoder with "no spendable UTXOs", which would
            // satisfy a naive "it was refused" assertion for the wrong reason.
            await fundAddress(stranger, FUNDING);
            // Via Home, not a bare reload: this step ends on the Addresses
            // screen, the shell restores the route it was on, and
            // `unlockAfterReload` waits for Home's balance hero - so a reload
            // from here unlocks correctly and then times out for 90 seconds on
            // a wallet that is perfectly healthy (§3.5, Session 32).
            await reloadToHome(page);
        });

        await test.step('the venue would accept this child from the owner and refuses it from anyone else', async () => {
            // The control that makes the refusal mean something, taken at the
            // same block from the same venue: the ONLY thing differing between
            // these two quotes is who is asking.
            const fromOwner = await feeQuote(`${GATE_PARENT}.${CHILD}`, owner);
            const fromStranger = await feeQuote(`${GATE_PARENT}.${CHILD}`, stranger);
            expect(String(fromOwner.status),
                'the venue will not price this child even for the parent\'s owner, so a refusal '
                + 'below would not be about ownership')
                .toBe('valid');
            expect(String(fromStranger.status))
                .toMatch(/parent issued by another address/i);
        });

        await test.step('the wizard defaults to the wrong signer, and stops before spending anything', async () => {
            const signer = await fillSubtoken(page, {
                parent: GATE_PARENT, child: CHILD, supply: CHILD_SUPPLY,
            });

            // The default is the newest external HD address, which the Receive
            // tap above moved off the owner. Nothing warned; nothing asked.
            expect(signer,
                'the wizard defaulted to the parent\'s owner, so this run never reached the gate')
                .toBe(stranger);

            // THE GOOD HALF, and it is why this was a dead end rather than a
            // loss: the refusal arrives on the FORM, from the native-fee
            // pre-flight, so no confirm screen opens and no fee is attached to
            // anything. The wallet quotes the network's own verdict.
            const alert = page.getByRole('alert')
                .filter({ hasText: /parent issued by another address/i });
            await expect(alert,
                'the wizard neither refused this nor explained it, so a doomed action reached the '
                + 'signing screen')
                .toBeVisible({ timeout: 90_000 });
            await expect(alert).toContainText(/Nothing was signed or sent/i);
            expect(await page.getByTestId('confirm-modal').count(),
                'a subtoken the network has already refused reached the confirm screen')
                .toBe(0);
        });

        await test.step('THE FIX: the same form, pointed at the owner, composes and settles', async () => {
            // Same wallet, same chain, same parent, same child name, minutes
            // apart. The only variable is the signer - chosen through the
            // picker this stage did not have, which is what made the refusal
            // above unfixable from the screen that reported it.
            const signer = await composeSubtoken(page, {
                parent: GATE_PARENT, child: CHILD, supply: CHILD_SUPPLY, signAs: owner,
            });
            expect(signer, 'the source picker did not move the signer to the parent\'s owner')
                .toBe(owner);

            const panel = page.getByTestId('preflight-panel');
            await expect(panel).toHaveAttribute('data-dryrun', 'approved');
            expect(await panel.getAttribute('data-verdict'),
                'the network still refuses the child once the owner is signing, so the signer was '
                + 'not what it was objecting to')
                .not.toBe('fail');

            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status),
                'the chain refused a subtoken signed by the address that owns its parent')
                .toBe('valid');

            // Credited to the OWNER, not to the address the wizard would have
            // picked on its own - which is the whole difference this step made.
            await waitForBalance(owner, `${GATE_PARENT}.${CHILD}`, CHILD_SUPPLY);
            expect(await tokenBalance(stranger, `${GATE_PARENT}.${CHILD}`),
                'the supply landed on the address that could not have created this token')
                .toBe(0);
            expect(await tokenBalance(owner, GATE_PARENT),
                'issuing the child moved the parent supply')
                .toBe(PARENT_SUPPLY);
        });
    });
});
