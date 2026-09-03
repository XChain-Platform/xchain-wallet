// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Manage Token": the CONTROLLER bind, end to end, and
// the only thing that proves a bind is real - the chain refusing a transfer
// because a deployed contract said no, then permitting it again once the
// binding is dropped.
//
// WHY THIS LANE WAS STILL ⬜ AFTER THIRTEEN SESSIONS. Session 20 drove the form
// to its REFUSAL and no further: a made-up contract index composed, and the
// dry-run answered `invalid: CONTROLLER (unknown)`. That proved the wallet can
// author the action and that the chain validates the field; it proved nothing
// about a binding, because there was no deployed guard contract to bind. The
// coverage line said so: "A real bind needs a DEPLOYED guard contract, so ⬜ the
// successful bind + unbind stays owed." Session 29 removed that blocker without
// touching this lane - `tests/contracts/deploy-execute.regtest.spec.js` deploys
// a contract FROM THE WALLET and calls a method on it - so the input this form
// has been waiting for is now something a spec can make for itself.
//
// WHAT IS ACTUALLY UNDER TEST, and why the bind alone would prove nothing. The
// programmable-policy layer is the platform's whole royalty / marketplace-fee /
// compliance story ([[project-controller-bound-tokens]]): a token routes one
// native ACTION CLASS to a contract's `guard` method, and the indexer runs that
// method before the action settles. A spec that bound a contract and read the
// binding back would show the wallet wrote a number into an append-only log. A
// bind naming the wrong contract, the wrong class, or a contract with no `guard`
// export reads identically. So the assertion is THE SAME SEND, three times,
// answered differently by the chain as the binding goes on and comes off:
//
//   before the bind   -> `valid`, the credit lands          (the token is ungated)
//   while bound       -> `invalid: controller (reverted)`   (the guard denied it)
//   after the unbind  -> `valid`, the credit lands again    (the drop took effect)
//
// Source, tick, amount and destination are identical in all three. The only
// thing that changes is the binding, so the binding is the only thing the
// different verdicts can be attributed to.
//
// AND A CONTROL INSIDE THE REFUSED WINDOW, because "the third send failed" has
// more explanations than the gate. While the guard is bound, the same address
// sends an UNGATED token (XCHAIN) to the same destination in the same window and
// the chain accepts it. That separates "this token is gated" from "this wallet,
// address, destination or venue stopped working", which is the failure mode a
// before/after pair on its own cannot rule out.
//
// THE REFUSAL STRING IS THE PROTOCOL'S, NOT THE GUARD'S. A reverting guard is
// reported as `controller (reverted)` and the revert message is deliberately
// dropped (xchain-indexer utility.vmFailureStatus maps `revert:` -> `reverted`),
// so a controlled token's holder learns THAT a contract refused and never WHY.
// Asserted here as the shape it is, because it is the sentence a user of a
// royalty-gated token will actually meet.
//
// ONE THING THE WALLET CANNOT DO HERE, AND IT IS BY DESIGN. The public
// `/feequote` and `/preflight` dry-runs refuse to enter a controller guard at
// all (`GUARD_INERT` -> `FEE_QUOTE_CONTROLLER_UNSUPPORTED`, xchain-indexer
// utility._invokeController): running caller-influenced VM code would hand an
// unauthenticated endpoint an unmetered compute primitive. So on a
// controller-bound token the wallet has NO network verdict to show, and the one
// thing it must not do is claim one. The refused leg asserts that the confirm
// screen says "Local checks only" with `data-dryrun="unreached"` - the honest
// answer - rather than the "Looks good" a wallet that trusted a guard-less
// verdict would print over an action the chain is about to reject.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/controller-bind.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    expectConfirmModal as sharedConfirmModal,
    explorerJson,
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
/** ISSUE, DEPLOY and the two ISSUE v6 binds each pay a real coin fee here. */
const FUNDING = 2;
const STAMP = Date.now().toString().slice(-6);
const TICK = `CTL${STAMP}`;
/**
 * The control token, issued from the same address in the same run and never
 * bound to anything.
 *
 * A second TOKEN rather than XCHAIN, and deliberately: the control has to differ
 * from the gated send in the BINDING and in nothing else, and XCHAIN is
 * special-cased across the wallet (it is the gas token, it is free-mintable on
 * regtest, it is the fee currency). A control that differs in three ways cannot
 * isolate one. This one is the same action, from the same address, to the same
 * destination, on a token issued minutes apart from the gated one.
 */
const CONTROL_TICK = `UNG${STAMP}`;
/** The second test's token, gated through the `all` catch-all rather than by class. */
const CATCHALL_TICK = `ALL${STAMP}`;
/** The third test's token. It is never gated: the ADDRESS is what carries the binding. */
const ADDRESS_TICK = `ADR${STAMP}`;
const SUPPLY = 1000;
/** Moved by each permitted send, attempted by the refused one. */
const SEND_AMOUNT = 10;
/** The control send inside the refused window. */
const CONTROL_AMOUNT = 5;

/**
 * VM gas is XCHAIN and a freshly-onboarded wallet holds none. This covers the
 * DEPLOY (VM_DEPLOY_BASE 100000 + 10/byte, priced at GAS_PRICE 0.00001) and the
 * VM_GUARD_GAS_CEILING of 200000 that every guarded leg reserves against the
 * SENDER - including the legs the guard goes on to deny.
 */
const MINT_XCHAIN = 2000;
const DEPLOY_GAS = '200000';

/**
 * The guard: it denies the token's transfers and nothing else.
 *
 * `xchain.getInputParam(0)` is the ACTION TYPE, and the literal it is compared
 * against is xchain-indexer's own: `send.js` calls `maybeRunControllerGuard`
 * with `actionType: 'SEND'`. Branching on it rather than reverting outright is
 * what makes this a guard rather than a wall - the same contract bound over
 * `trade` would let a SEND through - and it is the parameter a royalty guard
 * reads first.
 *
 * One line on purpose: a source past one action's byte budget deploys through
 * the PC-38 chunked lane, which is a different code path with a different
 * failure mode and nothing to do with this test. No RegExp and no BigInt: the
 * VM rejects both at deploy.
 */
const GUARD_SOURCE =
    "module.exports = { guard: function(){ if (xchain.getInputParam(0) === 'SEND')"
    + " { xchain.revert('transfers are gated'); } return {}; } };";

/**
 * Denies everything it is asked about, with no branch at all.
 *
 * Bound over the `all` class in the second test. Unconditional on purpose there:
 * the point of `all` is that it answers for classes NOTHING was specifically
 * bound to, so a guard that only recognised SEND would leave "did the fallback
 * resolve?" and "did the guard branch match?" tangled together.
 */
const DENY_ALL_SOURCE =
    "module.exports = { guard: function(){ xchain.revert('all-class denied'); } };";

/**
 * Allows everything. Bound over `transfer` ON TOP of the deny-all binding, to
 * show most-specific-wins: the concrete class outranks the catch-all.
 */
const ALLOW_SOURCE = 'module.exports = { guard: function(){ return {}; } };';

// A local `explorerJson` here would be a bare fetch that returned
// whatever JSON came back, error bodies included. The shared fixture helper of
// the same name waits out a 429 twice and THROWS with the venue named
// rather than answering, and shadowing it locally meant a rate-limited read arrived here as
// `{error:'Too many requests'}`, an object with no `controllers` key, which
// `?? null` below then turned into an accusation about the chain's state. Run 7
// died exactly that way: "this address already carried a controller binding
// before the spec bound one", on a venue where nothing was bound and the
// explorer had simply refused the read. Import the hardened one instead - a
// local copy of a helper the campaign has hardened three times is a copy that
// misses every hardening.

/**
 * Mines only while something is actually waiting for a block (campaign §3.5).
 * Mining on every poll outruns the decoder on a run this long; not mining at all
 * means waiting forever for a confirmation only a block can produce.
 */
async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

/**
 * Waits for the chain to record the action carried by `txid` and returns its
 * detail, WITHOUT asserting the verdict - half this spec is about an action the
 * chain must REFUSE, and `waitForValidAction` cannot express that.
 *
 * Never fetches an action index speculatively: the explorer memoizes a miss
 * forever (§3.6 / D-127), so the list read comes first and only an index it
 * returned is ever fetched.
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

/**
 * Waits for a token balance to reach `want` exactly.
 *
 * The explorer serves an action's row before that action's effect on the balance
 * view, so a single read taken the moment an action indexes can still show the
 * pre-action figure - which reads exactly like "the transfer moved nothing".
 */
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

/**
 * Asserts a balance is EXACTLY `want` and stays there, tolerating a read that
 * blips.
 *
 * Used for the "a refusal moved nothing" checks, and the reason it is not a
 * plain read is a failure this spec suffered on its fourth green run: a single
 * `tokenBalance` came back 0 for an address holding 10, because the explorer
 * returned an empty body and the helper maps "no row" to zero. That is D-152's
 * mistake one layer out - an unavailable read presenting as a confident zero -
 * and the harness had it too.
 *
 * Polling to an exact value cannot mask a real failure here: balances only move
 * forward, so if the refused send HAD settled the figure would be higher and
 * would never come back to `want`. All the wait can do is outlast a blip.
 */
async function expectUnmovedBalance(address, tick, want, what) {
    const deadline = Date.now() + 60_000;
    let last = null;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => null);
        if (last === want) return;
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${what} (${tick} for ${address} read ${last}, expected ${want})`);
}

/**
 * The controller bindings the chain says are still gating `tick`, right now.
 *
 * Deliberately does NOT catch: a read that failed and a token with nothing
 * bound to it are different answers, and collapsing them into `null` is what
 * let a rate limit read as a verdict about the chain. The poll loops below
 * catch for themselves, because there "not yet" is the expected answer.
 */
async function controllerBindings(tick) {
    return (await explorerJson(`token/${tick}`))?.controllers ?? null;
}

/**
 * The controller bindings the chain says are still gating this ADDRESS.
 *
 * A different table and a different endpoint from the token one
 * (`address_controllers` behind `/api/address/<addr>`), which is the point: the
 * two halves of the policy layer are separate records and a bind that wrote the
 * wrong one would still read as "a controller is attached" on the other.
 */
async function addressBindings(address) {
    return (await explorerJson(`address/${address}`))?.controllers ?? null;
}

/** Polls until `predicate` accepts the address's live controller list. */
async function waitForAddressBindings(address, predicate, what, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await addressBindings(address).catch(() => null);
        if (last && predicate(last)) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${address} never reached ${what}; controllers=${JSON.stringify(last)}`);
}

/** Polls until `predicate` accepts the token's live controller list. */
async function waitForBindings(tick, predicate, what, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await controllerBindings(tick).catch(() => null);
        if (last && predicate(last)) return last;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} never reached ${what}; controllers=${JSON.stringify(last)}`);
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
 * Waits for the confirm screen, naming a stale price sentinel for what it is.
 *
 * This run is long (an ISSUE, a MINT, a DEPLOY, two binds and four sends, every
 * one waiting on real blocks) and a price snapshot is usable for 1800
 * chain-seconds. Without this an aged-out seed presents as a confirm screen that
 * never opens, which reads like a wallet regression rather than venue state.
 */
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
}

async function approveAndGetTxid(page) {
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled({ timeout: 120_000 });
    await approve.click();
    const main = page.getByRole('main');
    // The success screens render the id with no separators ("Transaction
    // IDae0d…Done"), so a \b-anchored pattern does not match (§3.5, Session 30).
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

/**
 * Reloads onto a clean, unlocked Home.
 *
 * The navigation FIRST is load-bearing: this shell restores the route it was on
 * across a reload and `unlockAfterReload` waits for Home's balance hero, so
 * reloading from any other screen unlocks fine and then times out for 90s on a
 * wallet that is working (§3.5, Session 32). Reloading at all is what drops the
 * token-info caches an earlier form filled (the D-83 shape) - which matters more
 * here than usual, because the binding this spec adds and removes is exactly the
 * kind of token state a stale cache would hide.
 */
async function reloadToHome(page) {
    await gotoPalette(page, 'Home');
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
}

/**
 * Every address this wallet holds ON THE VENUE CHAIN, read off the open form's
 * own From picker, then restoring the selection by picking `keep`.
 *
 * It has to be a form's picker rather than the Addresses screen because
 * `switchToRegtest` derives a first address on ALL THREE regtest chains, and
 * Bitcoin, Litecoin and Dogecoin regtest share the legacy m/n/2 version bytes
 * (§3.5, note 3), so a prefix filter over the unfiltered list cannot tell them
 * apart. Every From field routes to `OwnAddressPickerScreen`, which applies the
 * wallet's own COIN filter.
 *
 * Picking `keep` on the way out is not tidiness. Several forms here default From
 * to the NEWEST HD address, and after the destination is generated that is no
 * longer the funded issuer - so leaving the picker anywhere else composes an
 * action signed by an address holding nothing.
 */
async function readChainAddresses(page, keep) {
    await page.getByRole('button', { name: 'Choose source address' }).click();
    const rows = page.getByRole('button', { name: /^View address / });
    await expect(rows.first(), 'the From picker listed no addresses at all')
        .toBeVisible({ timeout: 30_000 });
    const labels = await rows.evaluateAll(
        (els) => els.map((el) => el.getAttribute('aria-label') || ''),
    );
    const addresses = labels.map((l) => l.replace(/^View address /, '').trim()).filter(Boolean);

    const back = page.getByRole('button', { name: `View address ${keep}` });
    await expect(back, `the From address ${keep} is not among this chain's own addresses`)
        .toBeVisible({ timeout: 15_000 });
    await back.click();
    return addresses;
}

/**
 * Onboards a fresh wallet, funds its ONLY address and issues `TICK` from it.
 * Returns that address, which is the token's owner AND the chain's active
 * address.
 *
 * THE ISSUER MUST BE THE CHAIN'S ACTIVE ADDRESS, which is why the token is
 * created while the wallet still has exactly one. Send is hard-wired to the
 * active address and offers no source picker at all (D-140), while Issue and the
 * admin forms default to the NEWEST HD address and let you change it. Generate
 * the extra address first and those two diverge: the supply lands on the newest
 * address and the sends below compose from an address holding nothing.
 */
async function issueToken(page, tick, source) {
    // Start from Home, not from wherever the last action ended. A form's own
    // palette command is a NO-OP while the shell is already on that route - the
    // ISSUE done screen ("Token issued") stays up and the next `getByLabel
    // ('Ticker')` waits 30s on a wallet that is working. It presents as the form
    // having disappeared, which is how this spec failed its second run.
    await reloadToHome(page);
    await seedPrices();
    await gotoPalette(page, 'Issue token');
    const form = page.getByRole('main');
    await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(form);
    expect(await form.getByLabel('From').inputValue(),
        'the Issue form is not signing with the funded address')
        .toBe(source);
    await form.getByLabel('Ticker').fill(tick);
    await form.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
    await form.getByRole('button', { name: 'Issue token', exact: true }).click();

    await expectConfirmModal(page);
    const issued = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(issued.status),
        `the venue rejected the ISSUE of ${tick} (${issued.status}); on this chain that is usually `
        + 'the price sentinel going stale mid-run (campaign §3.2), not a wallet defect')
        .toBe('valid');
    await waitForBalance(source, tick, SUPPLY);
}

async function onboardAndIssue(page, ticks = [TICK, CONTROL_TICK], walletName = 'Controller Wallet') {
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

    // Issued back to back from one address so the only thing that ever differs
    // between them is the binding.
    for (const tick of ticks) await issueToken(page, tick, source);
    return source;
}

/**
 * Deploys the guard contract from the wallet's own Contracts form and returns
 * its ACTION INDEX, which is the only identity a contract has on chain and the
 * value the bind form asks for.
 *
 * Driven through the real form rather than a raw broadcast on purpose: the
 * number typed into "Guard contract" has to be one a user could have obtained
 * from this wallet, or the lane is only half proven.
 */
async function deployGuard(page, source, guardSource = GUARD_SOURCE) {
    await seedPrices();
    await gotoPalette(page, 'Contracts');
    const deploy = page.getByRole('button', { name: '+ Deploy new contract' });
    await expect(deploy).toBeVisible({ timeout: 30_000 });
    await deploy.click();

    const main = page.getByRole('main');
    await expect(main.getByLabel('Code source')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    expect(await main.getByLabel('From', { exact: true }).inputValue(),
        'the deploy would be signed by an address this spec never funded')
        .toBe(source);

    await main.getByLabel('Code source').fill(guardSource);
    // A source the validator rejects can never deploy, so a green validation is
    // the cheap precondition that keeps a later failure meaningful.
    await main.getByRole('button', { name: 'Validate code' }).click();
    await expect(main.getByText('Syntax OK.')).toBeVisible({ timeout: 30_000 });
    await main.getByLabel('Gas limit').fill(DEPLOY_GAS);
    await main.getByRole('button', { name: 'Deploy', exact: true }).click();

    await expectConfirmModal(page);
    const deployed = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(deployed.action)).toBe('DEPLOY');
    expect(String(deployed.status), 'the chain rejected the guard contract').toBe('valid');
    const contractIndex = String(deployed.action_index);

    // The contract exists AS a contract and carries the body that was typed. A
    // bind naming an index whose code is not this guard would gate on someone
    // else's logic, and every verdict below would be about their contract.
    const contract = await explorerJson(`contract/${contractIndex}`);
    expect(String(contract.status ?? contract.STATUS), 'the contract row is not valid').toBe('valid');
    expect(String(contract.code || '').replace(/\s+/g, ' ').trim(),
        'the chain stored a body that is not the guard this spec wrote')
        .toBe(guardSource.replace(/\s+/g, ' ').trim());

    return contractIndex;
}

/** Adds `count` more receive addresses on the venue chain. */
async function generateExtraAddresses(page, count) {
    await gotoPalette(page, 'Addresses');
    await page.getByTestId('address-add-menu').click();
    await page.getByTestId('address-add-address').click();
    await selectVenueChain(page, 'Coin');
    await page.getByLabel('Number of addresses').fill(String(count));
    await page.getByTestId('add-address-generate').click();
}

/**
 * Opens Manage Token -> More -> Controller for `TICK`.
 *
 * Reached the way a token owner reaches it: My Tokens is ownership-scoped
 * (D-82), so the row being there at all is the wallet recognising this as its
 * own token, and the More menu is where every issuer action past the first six
 * lives.
 */
async function gotoControllerForm(page, tick) {
    await gotoPalette(page, 'My Tokens');
    const row = page.getByRole('main').getByRole('button').filter({ hasText: tick }).first();
    await expect(row, `${tick} is on chain but My Tokens does not list it`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();

    await expect(page.getByRole('heading', { name: 'Manage Token' })
        .or(page.getByText('Manage Token').first()))
        .toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /More/ }).last().click();
    await page.getByRole('menuitem', { name: 'Controller' }).click();

    const form = page.getByRole('main');
    await expect(form.getByLabel('Guard contract')).toBeVisible({ timeout: 30_000 });
    return form;
}

/**
 * Binds `contractIndex` over the token's `transfer` class and waits for the
 * chain to carry the binding.
 *
 * The COOLDOWN is deliberately 0. A bind commits the friction a later unbind
 * must serve (`cooldown_end_block = unbind block + the bind's cooldown`), so any
 * non-zero value here would leave the guard gating for that many blocks after
 * the drop - which is the protocol working correctly and would make the release
 * leg below un-runnable inside one session. The non-zero variant is a separate
 * test and is called out in the campaign notes rather than faked here.
 */
async function bindController(page, source, contractIndex, { tick = TICK, actionClass = 'transfer' } = {}) {
    await seedPrices();
    const form = await gotoControllerForm(page, tick);

    // Opened from a token, so the subject defaults to that token rather than to
    // the signing address. The two are different actions on the wire (ISSUE v6
    // vs ADDRESS v1) and an address-scoped bind would gate this wallet's whole
    // account instead of this token, so the default is worth pinning.
    await expect(form.getByLabel('What to protect'),
        'the form opened from a token but did not default to protecting it')
        .toHaveValue('token');

    // The form defaults From to the NEWEST HD address, which by now is the
    // destination generated below - not the token owner. An ISSUE v6 signed by
    // anyone but the owner is refused, so this is a correction, not a check.
    await readChainAddresses(page, source);
    expect(await form.getByLabel('From').inputValue(),
        'the bind would be signed by an address that does not own the token')
        .toBe(source);

    await form.getByLabel('Guard contract').fill(contractIndex);
    // selectOption THROWS when the option is absent, so this line is also the
    // browser-side proof of D-150: before the fix the picker carried five of the
    // chain's seven bindable classes and `all` was simply not there to choose.
    await form.getByLabel('Action class').selectOption(actionClass);
    await form.getByLabel(/^Cooldown blocks/).fill('0');
    await form.getByRole('button', { name: 'Bind', exact: true }).click();

    await expectConfirmModal(page);
    const bound = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(bound.action), 'a token controller bind rides as an ISSUE v6').toBe('ISSUE');
    expect(String(bound.status), 'the chain rejected the controller bind').toBe('valid');

    // The chain's own record of the binding: the only thing the refusal below
    // can be explained by. Read for the CLASS as well as the contract, because a
    // bind that wrote the wrong class would still be a valid binding and would
    // still show up here - gating something other than the transfers this spec
    // is about to attempt.
    const live = await waitForBindings(
        tick,
        (rows) => rows.some((r) => r.action_class === actionClass
            && String(r.contract_index) === contractIndex),
        `a live ${actionClass}-class binding on contract ${contractIndex}`);
    const binding = live.find((r) => r.action_class === actionClass);
    expect(String(binding.contract_index), 'the token is gated by some OTHER contract')
        .toBe(contractIndex);
    expect(Number(binding.is_unbind), 'the binding was recorded as a drop, not a bind').toBe(0);
    expect(String(binding.bound_by), 'the chain credits the bind to another address')
        .toBe(source);
    return { bound, live };
}

/** Drops the transfer-class binding through the same form and waits for release. */
async function unbindController(page, source, tick = TICK) {
    await seedPrices();
    const form = await gotoControllerForm(page, tick);
    await readChainAddresses(page, source);

    await form.getByLabel(/^Unbind/).check();
    // The cooldown field belongs to a bind and must not be offered on a drop:
    // the friction a drop serves was committed when the binding was made, so a
    // second field here would invite an owner to think they can lower it.
    await expect(form.getByLabel(/^Cooldown blocks/),
        'the Unbind path still offers a cooldown field, which a drop cannot set')
        .toHaveCount(0);
    await form.getByLabel('Action class').selectOption('transfer');
    await form.getByRole('button', { name: 'Unbind', exact: true }).click();

    await expectConfirmModal(page);
    const dropped = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(dropped.action)).toBe('ISSUE');
    expect(String(dropped.status), 'the chain rejected the controller unbind').toBe('valid');

    // With a zero cooldown the drop is effective at once, so the token carries
    // no gating transfer binding at all any more.
    await waitForBindings(
        tick,
        (rows) => !rows.some((r) => r.action_class === 'transfer'),
        'no transfer-class controller still gating');
    return dropped;
}

/**
 * Opens the controller form THROUGH THE COMMAND PALETTE, with no token context
 * at all, and points it at the signing address.
 *
 * The palette entry is D-153's fix. Before it the form was reachable only from
 * Manage Token and both shells gated the route on a token context, so this
 * whole lane was unreachable for a wallet that had never issued a token. Driving
 * it this way rather than through Manage Token is deliberate: it is the entry
 * point a user of the ADDRESS lane actually has, and a regression that removed
 * it fails here rather than quietly re-orphaning the feature.
 */
async function gotoAddressControllerForm(page, source) {
    await seedPrices();
    await gotoPalette(page, 'Bind a controller');
    const form = page.getByRole('main');
    await expect(form.getByLabel(/What to protect/), 'the palette did not open the controller form')
        .toBeVisible({ timeout: 30_000 });

    // No token was passed, so the address subject must be the only one offered -
    // a form that defaulted to a token here would build an ISSUE v6 with an
    // empty TICK.
    await expect(form.getByLabel(/What to protect/),
        'opened without a token, the form still defaults to protecting one')
        .toHaveValue('address');

    await selectVenueChain(form);
    await readChainAddresses(page, source);
    expect(await form.getByLabel('From').inputValue(),
        'the binding would be attached to a different address than the one this test sends from')
        .toBe(source);
    return form;
}

/** Binds `contractIndex` to `source` itself (ADDRESS v1) and waits for the chain. */
async function bindAddressController(page, source, contractIndex) {
    const form = await gotoAddressControllerForm(page, source);
    await form.getByLabel('Guard contract').fill(contractIndex);
    await form.getByLabel('Action class').selectOption('transfer');
    await form.getByLabel(/^Cooldown blocks/).fill('0');
    await form.getByRole('button', { name: 'Bind', exact: true }).click();

    await expectConfirmModal(page);
    const bound = await waitForIndexedAction(await approveAndGetTxid(page));
    // The OTHER wire action. A token bind rides as ISSUE v6; this one is
    // ADDRESS v1, self-signed, with no subject field because the subject IS the
    // source. Asserted by name, because "a controller got bound" would be true
    // of both and this test is about the account half.
    expect(String(bound.action), 'an address controller bind rides as an ADDRESS v1').toBe('ADDRESS');
    expect(String(bound.source), 'the chain credits the bind to a different address').toBe(source);

    // NO STATUS ASSERTION HERE, and that is D-154 rather than an omission: on this
    // venue an ADDRESS v1 has no readable verdict. The explorer's ADDRESS action
    // detail INNER JOINed the `addresses` preferences table, which a v1 never
    // wrote, so the endpoint served a stub with no `status` and none of the
    // binding's own fields; worse, an INVALID v1 persisted nothing at all, so a
    // refused bind was indistinguishable from one still being processed.
    // FIXED IN CODE under: the handler is format-aware and reads
    // address_controllers, and the indexer writes an audit row for every ADDRESS
    // action, refused ones included. This venue still runs the pre-fix images
    // over a pre-fix index, so the assertion turns on only once the regtest
    // explorer and indexer are rebuilt and replayed.
    // The EFFECT is observable either way, so that is what this asserts: the
    // binding appearing on the address is the only proof of acceptance a client
    // gets on this venue today, and a refusal shows up here as this wait
    // timing out.
    const live = await waitForAddressBindings(
        source,
        (rows) => rows.some((r) => r.action_class === 'transfer'),
        'a live transfer-class binding on this address');
    const binding = live.find((r) => r.action_class === 'transfer');
    expect(String(binding.contract_index), 'the address is gated by some OTHER contract')
        .toBe(contractIndex);
    expect(Number(binding.is_unbind), 'the binding was recorded as a drop, not a bind').toBe(0);
    return bound;
}

/** Drops the address's transfer binding and waits for release. */
async function unbindAddressController(page, source) {
    await reloadToHome(page);
    const form = await gotoAddressControllerForm(page, source);
    await form.getByLabel(/^Unbind/).check();
    await form.getByLabel('Action class').selectOption('transfer');
    await form.getByRole('button', { name: 'Unbind', exact: true }).click();

    await expectConfirmModal(page);
    const dropped = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(dropped.action)).toBe('ADDRESS');
    // Same D-154 gap as the bind: the drop's acceptance is only observable as
    // its effect, so the wait below IS the assertion.
    await waitForAddressBindings(
        source,
        (rows) => !rows.some((r) => r.action_class === 'transfer'),
        'no transfer-class controller still gating this address');
    return dropped;
}

/**
 * Fills the real Send form for `amount` of `tick` to `destination` and opens the
 * confirm screen.
 *
 * Shared by every leg on purpose: the three sends of `TICK` must differ in
 * NOTHING but the binding in force at the time, or their different verdicts
 * prove nothing about the controller.
 */
/**
 * Opens the Send asset picker and selects `tick`.
 *
 * WAITS FOR THE LIST TO HAVE ANY ROW BEFORE FILTERING, and that is the whole
 * point of the helper. `TokenPicker` renders before the balances behind it
 * arrive, and its "Nothing matches" empty state is IDENTICAL whether the wallet
 * does not hold the token or the balance read has not landed - so typing the
 * filter first turns a slow read into "this token does not exist", 30 seconds
 * later, several screens from the cause. This spec lost two runs to it, once on
 * XCHAIN and once on the gated token itself, on a venue whose explorer blipped
 * mid-run.
 *
 * The retry re-enters Send rather than clicking again: the picker only refetches
 * on mount, so a second click inside a picker that already resolved to an empty
 * list would wait on state that cannot change.
 */
async function pickAsset(page, tick) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        await page.getByRole('button', { name: /Change asset/ }).click();
        try {
            await expect(page.getByLabel(/Open .+ details/i).first(),
                'the asset picker listed nothing at all, so its balances never arrived')
                .toBeVisible({ timeout: 30_000 });
            await page.getByLabel('Search coins or tokens').fill(tick);
            const row = page.getByLabel(new RegExp(`Open ${tick} details`, 'i')).first();
            await expect(row, `the wallet's balance list does not carry ${tick}`)
                .toBeVisible({ timeout: 15_000 });
            await row.click();
            return;
        } catch (err) {
            if (attempt === 3) throw err;
            await reloadToHome(page);
            await gotoPalette(page, 'Send');
        }
    }
}

async function composeSend(page, tick, destination, amount) {
    await gotoPalette(page, 'Send');
    const main = page.getByRole('main');
    await pickAsset(page, tick);

    // The form's "available" line is read from the address it will actually
    // spend from, so it is the earliest place a wrong source shows up (D-140).
    await expect(main, `the Send form is not sourcing from the address that holds ${tick}`)
        .toContainText(new RegExp(`[\\d,]+\\s*${tick} available`), { timeout: 60_000 });

    await page.getByLabel('To', { exact: true }).fill(destination);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(String(amount));
    await main.getByRole('button', { name: 'Send', exact: true }).click();
    await expectConfirmModal(page);
}

/** Drives a send the chain must ACCEPT, and asserts it moved the tokens. */
async function expectPermittedSend(page, { source, tick, destination, amount, senderAfter, destAfter }) {
    await reloadToHome(page);
    await composeSend(page, tick, destination, amount);

    const permitted = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(permitted.action)).toBe('SEND');
    const legs = (permitted.sends || []).map((leg) => String(leg.status));
    expect(legs.length, 'the SEND recorded no legs at all, so nothing was judged').toBeGreaterThan(0);
    for (const status of legs) {
        expect(status, `the chain refused a ${tick} send nothing should have been gating`)
            .toBe('valid');
    }
    await waitForBalance(destination, tick, destAfter);
    await waitForBalance(source, tick, senderAfter);
}

test.describe(`token controller bindings on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('a bound guard contract refuses the token\'s transfers, and unbinding releases them', async ({ page }) => {
        let source;
        let destination;
        let contractIndex;

        await test.step('onboard, fund and issue the token from the wallet\'s only address', async () => {
            source = await onboardAndIssue(page);
        });

        await test.step('mint the XCHAIN the VM meters its gas in', async () => {
            await reloadToHome(page);
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(source, 'XCHAIN', MINT_XCHAIN);
            await reloadToHome(page);
        });

        await test.step('deploy the guard contract from the wallet', async () => {
            contractIndex = await deployGuard(page, source);
        });

        await test.step('generate the destination every send below will use', async () => {
            await generateExtraAddresses(page, 1);
            await reloadToHome(page);
            await gotoPalette(page, 'Issue token');
            await selectVenueChain(page.getByRole('main'));
            const addresses = await readChainAddresses(page, source);
            const others = addresses.filter((a) => a !== source);
            expect(others.length,
                `expected one more ${REGTEST_CHAIN_LABEL} address beside the issuer, found `
                + `${others.length}: ${others.join(', ')}`)
                .toBe(1);
            [destination] = others;
        });

        await test.step('BEFORE the bind: the send settles, so the token starts ungated', async () => {
            // The control that makes the refusal attributable. Without it, a
            // refused send after a bind could be explained by the token, the
            // address, the destination or the venue just as easily as by the
            // guard.
            expect(await controllerBindings(TICK),
                `${TICK} already carried a controller binding before this spec bound one`)
                .toEqual([]);
            await expectPermittedSend(page, {
                source, tick: TICK, destination, amount: SEND_AMOUNT,
                senderAfter: SUPPLY - SEND_AMOUNT, destAfter: SEND_AMOUNT,
            });
        });

        await test.step('bind the guard over the token\'s transfer class', async () => {
            await bindController(page, source, contractIndex);
        });

        await test.step('WHILE BOUND: the identical send is refused by the contract', async () => {
            await reloadToHome(page);
            await composeSend(page, TICK, destination, SEND_AMOUNT);

            // The wallet has no network verdict to show and must not invent one:
            // the public dry-run refuses to enter a controller guard at all
            // (FEE_QUOTE_CONTROLLER_UNSUPPORTED), so the honest chip is "Local
            // checks only". A wallet that trusted a guard-less verdict would
            // print "Looks good" over an action the chain is about to reject.
            await expect(page.getByTestId('preflight-panel'),
                'the confirm screen claims a network verdict on a controller-bound action, which '
                + 'the public dry-run refuses to produce')
                .toHaveAttribute('data-dryrun', 'unreached');
            await expect(page.getByTestId('preflight-chip')).toHaveText('Local checks only');

            const refused = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(refused.action)).toBe('SEND');
            const legs = (refused.sends || []).map((leg) => String(leg.status));
            expect(legs.length, 'the SEND recorded no legs at all, so nothing was judged')
                .toBeGreaterThan(0);
            for (const status of legs) {
                // `controller (reverted)` is the protocol's own wording: the
                // guard's revert message is deliberately dropped
                // (utility.vmFailureStatus), so a holder learns THAT a contract
                // refused and never WHY.
                expect(status, 'a controller-bound token accepted a transfer its guard denied')
                    .toMatch(/controller \(reverted\)/);
            }

            // A refusal is a refusal: no credit, no debit.
            await expectUnmovedBalance(destination, TICK, SEND_AMOUNT,
                'the destination was credited by an action the chain recorded as invalid');
            await expectUnmovedBalance(source, TICK, SUPPLY - SEND_AMOUNT,
                'the refused send still debited the sender');
        });

        await test.step('...and the SAME address may still send an UNGATED token to the SAME destination', async () => {
            // The control inside the refused window. It separates "this token is
            // gated" from "this wallet, address, destination or venue stopped
            // working" - the explanation a before/after pair alone cannot rule
            // out. The control token carries no controller, so the guard is the
            // only thing left that can account for the difference.
            expect(await controllerBindings(CONTROL_TICK),
                `${CONTROL_TICK} picked up a controller of its own, so it is not a control`)
                .toEqual([]);
            await expectPermittedSend(page, {
                source, tick: CONTROL_TICK, destination, amount: CONTROL_AMOUNT,
                senderAfter: SUPPLY - CONTROL_AMOUNT, destAfter: CONTROL_AMOUNT,
            });
        });

        await test.step('unbind the guard', async () => {
            await unbindController(page, source);
        });

        await test.step('AFTER the unbind: the identical send settles again', async () => {
            await expectPermittedSend(page, {
                source, tick: TICK, destination, amount: SEND_AMOUNT,
                senderAfter: SUPPLY - (2 * SEND_AMOUNT), destAfter: 2 * SEND_AMOUNT,
            });
        });
    });

    // THE `all` CLASS, WHICH IS THE ONE THE POLICY LAYER IS ACTUALLY DESIGNED
    // AROUND - and which, until this session, no client could author at all.
    //
    // D-150: the SDK validated ACTION_CLASS against the indexer's ROUTING set
    // (CONTROLLER_ACTION_CLASSES) where the field it guards appears only on a
    // BIND, so it had to be the BINDING set (CONTROLLER_BINDABLE_CLASSES). The
    // two differ by `all`, so `controller.bindToken({ actionClass: 'all' })`
    // threw before a wire string existed and the wallet's picker never offered
    // it. That fix is unit-pinned; this test is the part that matters, which is
    // the chain agreeing.
    //
    // TWO PROPERTIES, and the second is why one binding is not enough to prove
    // anything about a catch-all:
    //
    //   FALLBACK      - `all` answers for a class NOTHING was specifically bound
    //                   to. A deny-all guard bound over `all` must refuse a SEND,
    //                   which routes to `transfer`.
    //   MOST-SPECIFIC - a concrete binding OUTRANKS the catch-all. An allow guard
    //                   bound over `transfer` on top of it must let that same
    //                   SEND through, with the `all` binding still in place and
    //                   still gating everything else.
    //
    // The pair is the whole assertion: the same send, refused and then permitted,
    // flipped by ADDING a more specific binding rather than by removing the
    // broad one. A wallet that wrote `all` into the wrong field, or a chain that
    // ignored it, fails the first; a resolver that took the newest binding
    // instead of the most specific one passes the first and fails the second.
    //
    // It also settles a bind-time rule worth having on chain rather than in a
    // comment: binding `transfer` while `all` is live is NOT "already bound".
    // The validator checks the exact class, the guard resolver falls back - two
    // different reads, and conflating them would refuse this test's second bind.
    test('the `all` catch-all gates a class nothing was bound to, and a specific bind outranks it', async ({ page }) => {
        let source;
        let destination;
        let denyIndex;
        let allowIndex;

        await test.step('onboard, fund and issue the token', async () => {
            source = await onboardAndIssue(page, [CATCHALL_TICK], 'Catch-all Wallet');
        });

        await test.step('mint the XCHAIN the VM meters its gas in', async () => {
            await reloadToHome(page);
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(source, 'XCHAIN', MINT_XCHAIN);
            await reloadToHome(page);
        });

        await test.step('deploy both guards: one that denies everything, one that allows', async () => {
            denyIndex = await deployGuard(page, source, DENY_ALL_SOURCE);
            await reloadToHome(page);
            allowIndex = await deployGuard(page, source, ALLOW_SOURCE);
            expect(allowIndex, 'the two guards must be different contracts')
                .not.toBe(denyIndex);
        });

        await test.step('generate the destination', async () => {
            await generateExtraAddresses(page, 1);
            await reloadToHome(page);
            await gotoPalette(page, 'Issue token');
            await selectVenueChain(page.getByRole('main'));
            const others = (await readChainAddresses(page, source)).filter((a) => a !== source);
            expect(others.length, `expected exactly one address beside the issuer, found ${others.length}`)
                .toBe(1);
            [destination] = others;
        });

        await test.step('bind the deny-all guard over the `all` class', async () => {
            // The class the wallet could not name until this session. `selectOption`
            // throws when the option is absent, so reaching the chain at all is the
            // browser-side half of D-150.
            const { live } = await bindController(page, source, denyIndex, {
                tick: CATCHALL_TICK, actionClass: 'all',
            });
            expect(live.some((r) => r.action_class === 'transfer'),
                'a transfer-class binding exists, so the next step would not be testing the fallback')
                .toBe(false);
        });

        await test.step('FALLBACK: a send is refused by a guard bound to no class in particular', async () => {
            await reloadToHome(page);
            await composeSend(page, CATCHALL_TICK, destination, SEND_AMOUNT);
            const refused = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(refused.action)).toBe('SEND');
            const legs = (refused.sends || []).map((leg) => String(leg.status));
            expect(legs.length, 'the SEND recorded no legs at all').toBeGreaterThan(0);
            for (const status of legs) {
                expect(status, 'the `all` binding did not gate a class it was never told about')
                    .toMatch(/controller \(reverted\)/);
            }
            await expectUnmovedBalance(destination, CATCHALL_TICK, 0,
                'a refused send credited the destination');
            await expectUnmovedBalance(source, CATCHALL_TICK, SUPPLY,
                'a refused send debited the sender');
        });

        await test.step('bind the allow guard over `transfer`, ON TOP of the live `all` binding', async () => {
            const { live } = await bindController(page, source, allowIndex, {
                tick: CATCHALL_TICK, actionClass: 'transfer',
            });
            // BOTH bindings, side by side. The specific one must not have
            // replaced the catch-all: `all` still gates every other class, which
            // is exactly what makes this a precedence rule rather than an
            // overwrite.
            const catchAll = live.find((r) => r.action_class === 'all');
            expect(catchAll, 'the specific bind REPLACED the catch-all instead of layering over it')
                .toBeTruthy();
            expect(String(catchAll.contract_index),
                'the catch-all now points at a different contract').toBe(denyIndex);
        });

        await test.step('MOST-SPECIFIC WINS: the identical send now settles', async () => {
            await expectPermittedSend(page, {
                source, tick: CATCHALL_TICK, destination, amount: SEND_AMOUNT,
                senderAfter: SUPPLY - SEND_AMOUNT, destAfter: SEND_AMOUNT,
            });
        });
    });

    // THE OTHER SUBJECT, AND THE OTHER WIRE ACTION. Everything above gates a
    // TOKEN (ISSUE v6). The programmable-policy layer has a second half that
    // gates an ACCOUNT (ADDRESS v1): a self-imposed rule on what this address
    // may send, and - the same binding, the chain checks it twice - on what it
    // will accept. `send.js` runs `maybeRunAddressControllerGuard` for the
    // SOURCE and again for the DESTINATION, both on the `transfer` class, so one
    // binding gates both directions and the guard branches on from/to.
    //
    // It had never been driven, and D-153 is why: the form's only entry point
    // was Manage Token -> More -> Controller, and both shells gated the ROUTE
    // itself on a token context, so an account-scoped bind was unreachable for
    // anyone who had not issued a token. This test opens the form THROUGH THE
    // PALETTE, which is the entry point that fix adds - so a regression that
    // removed it fails here rather than silently making the lane unreachable
    // again.
    //
    // Scoped to the OUTBOUND direction on purpose. The inbound half needs a send
    // FROM a different address, and Send is hard-wired to the chain's ACTIVE
    // address with no source picker (D-140), so proving it means making a second
    // address active first - a lane of its own, noted as owed rather than
    // half-driven here.
    test('an address-scoped controller gates what the signing address may send', async ({ page }) => {
        let source;
        let destination;
        let guardIndex;

        await test.step('onboard, fund and issue a token to have something to move', async () => {
            source = await onboardAndIssue(page, [ADDRESS_TICK], 'Address-controller Wallet');
        });

        await test.step('mint the XCHAIN the VM meters its gas in', async () => {
            await reloadToHome(page);
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(source, 'XCHAIN', MINT_XCHAIN);
            await reloadToHome(page);
        });

        await test.step('deploy the guard', async () => {
            guardIndex = await deployGuard(page, source);
        });

        await test.step('generate the destination', async () => {
            await generateExtraAddresses(page, 1);
            await reloadToHome(page);
            await gotoPalette(page, 'Issue token');
            await selectVenueChain(page.getByRole('main'));
            const others = (await readChainAddresses(page, source)).filter((a) => a !== source);
            expect(others.length, `expected exactly one address beside the issuer, found ${others.length}`)
                .toBe(1);
            [destination] = others;
        });

        await test.step('BEFORE the bind: the send settles, so the ADDRESS starts ungated', async () => {
            expect(await addressBindings(source),
                'this address already carried a controller binding before the spec bound one')
                .toEqual([]);
            await expectPermittedSend(page, {
                source, tick: ADDRESS_TICK, destination, amount: SEND_AMOUNT,
                senderAfter: SUPPLY - SEND_AMOUNT, destAfter: SEND_AMOUNT,
            });
        });

        await test.step('bind the guard to THIS ADDRESS, reached from the palette', async () => {
            await bindAddressController(page, source, guardIndex);
        });

        await test.step('WHILE BOUND: the identical send is refused, by a rule the sender set on itself', async () => {
            await reloadToHome(page);
            await composeSend(page, ADDRESS_TICK, destination, SEND_AMOUNT);
            const refused = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(refused.action)).toBe('SEND');
            const legs = (refused.sends || []).map((leg) => String(leg.status));
            expect(legs.length, 'the SEND recorded no legs at all').toBeGreaterThan(0);
            for (const status of legs) {
                expect(status, 'an address-scoped controller did not gate its own outbound transfer')
                    .toMatch(/controller \(reverted\)/);
            }
            // Attributable to the ADDRESS and not to the token, which is the one
            // thing this test could otherwise be confused with: the token is
            // asked directly and carries no binding of its own.
            expect(await controllerBindings(ADDRESS_TICK),
                'the TOKEN picked up a controller, so the refusal is not attributable to the address')
                .toEqual([]);
            await expectUnmovedBalance(destination, ADDRESS_TICK, SEND_AMOUNT,
                'a refused send credited the destination');
            await expectUnmovedBalance(source, ADDRESS_TICK, SUPPLY - SEND_AMOUNT,
                'a refused send debited the sender');
        });

        await test.step('unbind, and the identical send settles again', async () => {
            await unbindAddressController(page, source);
            await expectPermittedSend(page, {
                source, tick: ADDRESS_TICK, destination, amount: SEND_AMOUNT,
                senderAfter: SUPPLY - (2 * SEND_AMOUNT), destAfter: 2 * SEND_AMOUNT,
            });
        });
    });
});
