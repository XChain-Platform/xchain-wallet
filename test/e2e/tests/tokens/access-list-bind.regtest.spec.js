// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Manage Token": the ACCESS-LIST bind, end to end, in
// BOTH polarities, plus the only thing that proves a bind is real - the chain
// refusing a transfer because of it.
//
// WHY THIS LANE WAS STILL ⬜ AFTER THIRTY-ONE SESSIONS. Session 20 opened the
// Access lists form and got as far as its empty state: "No address lists
// published from this chain's addresses yet. Create one in My Lists first."
// That sentence is the whole reason the lane stalled. Binding needs a published
// LIST, and no session had ever driven the LIST authoring form to broadcast
// either, so two never-run surfaces were each waiting on the other. This spec
// runs both, in the order the protocol requires.
//
// WHAT MAKES IT WORTH THE RUNTIME, and why the bind alone would not be enough.
// An access list is the one piece of token configuration whose entire purpose is
// to STOP a later action. A spec that bound a list and read the binding back
// would prove the wallet wrote a number into the token record; it would not
// prove that number does anything, and a bind pointing at the wrong index, or
// at a list the chain stored empty, reads identically. So each test is a PAIR of
// sends differing in ONE respect - whether the destination is on the bound list
// - and the chain answering them differently:
//
//   ALLOW-list: destination ON the list      -> `valid`, the credit lands
//               destination NOT on the list  -> `invalid: DESTINATION (not authorized)`
//   BLOCK-list: destination NOT on the list  -> `valid`, the credit lands
//               destination ON the list      -> `invalid: DESTINATION (not authorized)`
//
// Both verdicts come from `indexerDb.isActionAllowed`, which xchain-indexer's
// send.js consults for the source AND the destination of every leg
// (src/actions/send.js "TICK action is allowed to DESTINATION"). The refusal is
// also the wallet's to surface BEFORE the money is spent: the pre-flight
// dry-run runs the real handler, so a wallet that showed "Looks good" here
// would be inviting the user to pay a fee for an action the network has already
// decided to reject.
//
// WHY THE BLOCK HALF IS A SEPARATE TEST AND NOT AN ASSUMED MIRROR. In the
// indexer the two branches really are symmetric, four lines apart. In the WALLET
// they are not one code path: `TokenAdminForm` holds `allowListIdx` and
// `blockListIdx` as separate state, `composeAdminParams` emits ALLOW_LIST and
// BLOCK_LIST as separate ISSUE v5 fields, and each has its own picker button and
// its own "changed from the token's current binding" test. A bug that writes the
// allow field for both, or drops the block field, is entirely plausible and is
// invisible from the allow side - which is why the block test asserts the chain
// carries `lists.block` set AND `lists.allow` still null. D-136 was exactly this
// shape one layer down: one optional field INNER JOINed where its 50 siblings
// were LEFT JOINed.
//
// THREE ADDRESSES, ALL THE WALLET'S OWN. The gate is about the DESTINATION, so
// the destinations do not have to be spendable by anyone in particular - but
// they do have to be real addresses for this exact coin and network, because
// the list form validates them properly (`classifyRecipients` -> base58check /
// bech32 for the chain, ). Generating them in the wallet is the only way
// to be sure of that on a venue table that spans three chains, and it makes the
// resulting balances readable at the explorer.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/access-list-bind.regtest.spec.js

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
    warmPreflight,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** ISSUE, LIST and the ISSUE v5 edit each pay a real coin fee on this chain . */
const FUNDING = 2;
const STAMP = Date.now().toString().slice(-6);
const TICK_ALLOW = `ALW${STAMP}`;
const TICK_BLOCK = `BLK${STAMP}`;
const SUPPLY = 1000;
/** Moved by each permitted send, and attempted by each refused one. */
const SEND_AMOUNT = 10;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * Mines only while something is actually waiting for a block (campaign §3.5,
 * third answer). Mining on every poll outruns the decoder on a long run, and not
 * mining at all means a spec waits forever for a confirmation only a block can
 * produce.
 */
async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

/**
 * Waits for the chain to record the action carried by `txid` and returns its
 * detail, WITHOUT asserting the verdict.
 *
 * Deliberately not `waitForValidAction`: half this spec is about actions the
 * chain must REFUSE, and a helper that fails on a non-valid status cannot
 * express that. Callers assert the status they expect, by name.
 *
 * Never fetches an action index speculatively - the explorer memoizes a miss
 * forever (§3.6/D-127), so the list read comes first and only an index it
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
 * Waits for a token balance to reach `want` exactly and returns it.
 *
 * The explorer serves an action's row before that action's effect on the
 * balance view, so a single read taken the moment an action indexes can still
 * show the pre-action figure - which reads exactly like "the transfer moved
 * nothing" and has cost this campaign a run already.
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
 * These tests are long (an ISSUE, a LIST, an ISSUE v5 edit and two SENDs each,
 * every one waiting on real blocks) and a price snapshot is usable for 1800
 * chain-seconds. Without this an aged-out seed presents as a confirm screen that
 * never opens, which reads like a wallet regression rather than venue state.
 */
async function expectConfirmModal(page) {
    const modal = page.getByTestId('confirm-modal');
    const priceAlert = page.getByText(/fee price is temporarily unavailable/);
    await modal.or(priceAlert).first().waitFor({ state: 'visible', timeout: 60_000 });
    expect(await priceAlert.count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. Venue '
        + 'state, not a wallet defect - re-seed (campaign §3.2) and re-run')
        .toBe(0);
    await expect(modal).toBeVisible({ timeout: 60_000 });
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
 * The navigation FIRST is load-bearing, not tidiness: this shell restores the
 * route it was on across a reload, and `unlockAfterReload` waits for Home's
 * balance hero - so reloading from any other screen unlocks fine and then times
 * out for 90s on a wallet that is working. Reloading at all is what drops the
 * caches a form filled in an earlier step (the D-83 stale-token-info shape).
 */
async function reloadToHome(page) {
    await gotoPalette(page, 'Home');
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
}

/**
 * Every address this wallet holds ON THE VENUE CHAIN, read off the open form's
 * own From picker, then restoring the selection by picking `keep` again.
 *
 * It has to be a form's picker rather than the Addresses screen because
 * `switchToRegtest` derives a first address on ALL THREE regtest chains, and
 * Bitcoin, Litecoin and Dogecoin regtest share the legacy m/n/2 version bytes
 * (campaign §3.5, note 3) - so a prefix filter over the unfiltered list cannot
 * tell them apart, and one wrong-chain address here would be an unspendable
 * list member on a token whose gate is the thing under test. Every From field
 * routes to `OwnAddressPickerScreen`, which renders the same list with a COIN
 * filter applied, so the scoping is the wallet's own.
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

    // Picking `keep` closes the picker AND asserts it was on this chain's list:
    // a From address the coin-filtered picker cannot offer would be a wallet
    // defect in its own right.
    const back = page.getByRole('button', { name: `View address ${keep}` });
    await expect(back, `the From address ${keep} is not among this chain's own addresses`)
        .toBeVisible({ timeout: 15_000 });
    await back.click();
    return addresses;
}

/**
 * Onboards a fresh wallet, funds its ONLY address and issues `tick` from it.
 * Returns that address, which is both the token's owner and the chain's active
 * address.
 *
 * THE ISSUER MUST BE THE CHAIN'S ACTIVE ADDRESS, which is why the token is
 * created while the wallet still has exactly one. Send is hard-wired to the
 * active address and offers no source picker at all (Send.jsx: "Send defaults
 * its from-address to this so a send always spends from the chain's active
 * address"), while Issue, List and the admin forms default to the NEWEST HD
 * address and let you change it. Generate the extra addresses first and those
 * two diverge: the supply lands on the newest address and the send that has to
 * move it later composes from an address holding nothing. That is not a
 * hypothetical - it is how this spec failed its second run, with the encoder's
 * own words: "no spendable UTXOs found for the funding address". See D-140.
 */
async function onboardAndIssue(page, tick, walletName) {
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
    await form.getByLabel('Ticker').fill(tick);
    await form.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
    await form.getByRole('button', { name: 'Issue token', exact: true }).click();

    await expectConfirmModal(page);
    const issued = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(issued.status),
        `the venue rejected the ISSUE of ${tick} (${issued.status}); on this chain that is `
        + 'usually the price sentinel going stale mid-run (campaign §3.2), not a wallet defect')
        .toBe('valid');
    await waitForBalance(source, tick, SUPPLY);
    return source;
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
 * Publishes a TYPE=2 address LIST from `source` and returns its ACTION_INDEX,
 * having first read the wallet's other addresses off this form's own picker.
 *
 * `chooseMembers` receives the wallet's other chain addresses and returns the
 * members to publish, so a caller can put the issuer on the list (the allow
 * case) or deliberately leave it off (the block case).
 *
 * The LIST authoring form (PC-10) had never been driven to broadcast in this
 * campaign before Session 32. It is the input the Access lists form's empty
 * state has been asking for since Session 20.
 */
async function publishAddressList(page, source, chooseMembers) {
    await seedPrices();
    await gotoPalette(page, 'Create a list');
    const main = page.getByRole('main');
    await expect(main.getByLabel('List type')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);

    // Reading the wallet's addresses through this form's own From picker does
    // two jobs: it scopes them to this chain (see readChainAddresses) and it
    // leaves From set to the issuer, the only funded address on the wallet.
    const others = (await readChainAddresses(page, source)).filter((a) => a !== source);
    expect(others.length,
        `expected 2 more ${REGTEST_CHAIN_LABEL} addresses beside the issuer, found `
        + `${others.length}: ${others.join(', ')}`)
        .toBeGreaterThanOrEqual(2);

    expect(await main.getByLabel('From').inputValue(),
        'the list would be published from an address that is not the token issuer, so it would be '
        + 'paid for by an address holding no coin')
        .toBe(source);

    const members = chooseMembers(others);

    // TYPE=2. An access list must be an address list: issue.js refuses anything
    // else with `invalid: ALLOW_LIST (bad list)` / `BLOCK_LIST (bad list)`.
    await main.getByLabel('List type').selectOption('2');
    await main.getByLabel('Addresses', { exact: true }).fill(members.join('\n'));

    // The parser's own count, before anything is composed. A list silently short
    // of a member would make the gate below pass or fail for the wrong reason.
    const plural = members.length === 1 ? 'address' : 'addresses';
    await expect(main, `the list form did not accept all ${members.length} addresses as valid for this chain`)
        .toContainText(`${members.length} valid ${plural}`);

    await main.getByRole('button', { name: /^(Publish list|Review)$/ }).click();
    await expectConfirmModal(page);
    const published = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(published.action)).toBe('LIST');
    expect(String(published.status), 'the chain rejected the LIST').toBe('valid');
    const listIndex = String(published.action_index);

    // The indexer stores a list even when it drops items it rejects into
    // `list_items_invalid` , so the ACTION being valid is not the same
    // as the MEMBERSHIP being what was asked for. Read it back.
    const stored = (published.list || published.items || published.members || [])
        .map((row) => String(typeof row === 'object' ? (row.address ?? row.item ?? '') : row));
    expect(stored.sort(), `list #${listIndex} did not store the addresses it was given`)
        .toEqual([...members].sort());

    return { listIndex, others, members };
}

/**
 * Binds list `listIndex` to `tick` as the allow- or block-list, through Manage
 * Token, and waits for the chain to carry the binding on the field that was
 * chosen and NOT on the other one.
 *
 * @param {'allow' | 'block'} kind
 */
async function bindAccessList(page, tick, kind, listIndex, memberCount) {
    const other = kind === 'allow' ? 'block' : 'allow';

    await seedPrices();
    await gotoPalette(page, 'My Tokens');
    const main = page.getByRole('main');
    const row = main.getByRole('button').filter({ hasText: tick }).first();
    await expect(row, `${tick} is on chain but My Tokens does not list it`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();

    await expect(page.getByRole('heading', { name: 'Manage Token' })
        .or(page.getByText('Manage Token').first()))
        .toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /More/ }).last().click();
    await page.getByRole('menuitem', { name: 'Access lists' }).click();

    const form = page.getByRole('main');
    // The state Session 20 stopped at, asserted rather than assumed: the "after"
    // only means something against a token that started ungated. The BUTTON
    // LABEL is the assertion, because it reads "Change …" once something is
    // bound and "Choose …" while nothing is - a per-field answer that the
    // shared "None" text cannot give.
    const pickButton = form.getByRole('button', { name: `Choose ${kind}-list` });
    await expect(pickButton, `this token already had a ${kind}-list before the bind`)
        .toBeVisible({ timeout: 30_000 });
    await expect(form.getByRole('button', { name: `Choose ${other}-list` }),
        `this token already had a ${other}-list, so a stray binding could explain the verdicts below`)
        .toBeVisible();

    await pickButton.click();
    const pick = page.getByRole('button', { name: new RegExp(`^Address list #${listIndex}\\b`) });
    await expect(pick,
        `the list picker cannot see list #${listIndex}, which this wallet published minutes ago - `
        + 'the "Create one in My Lists first" empty state again')
        .toBeVisible({ timeout: 60_000 });
    await pick.click();

    // The count comes from a per-list detail read, so it is the picker agreeing
    // with the chain about what is inside the list it is about to bind.
    await expect(form).toContainText(`List #${listIndex}`);
    await expect(form).toContainText(`${memberCount} member${memberCount === 1 ? '' : 's'}`);

    await form.getByRole('button', { name: /^(Update token|Preview)$/ }).click();
    await expectConfirmModal(page);
    const bound = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(bound.action)).toBe('ISSUE');
    expect(String(bound.status), 'the chain rejected the access-list edit').toBe('valid');

    // The chain's own record of the binding, which is the only thing the send
    // verdicts below can be explained by.
    const deadline = Date.now() + 120_000;
    let lists = null;
    while (Date.now() < deadline) {
        lists = (await explorerJson(`token/${tick}`).catch(() => null))?.lists ?? null;
        if (lists && lists[kind] != null) break;
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(String(lists?.[kind]), `${tick} carries no ${kind.toUpperCase()}_LIST after a valid ISSUE v5 edit`)
        .toBe(listIndex);
    // THE FIELD MATTERS AS MUCH AS THE VALUE. `composeAdminParams` emits
    // ALLOW_LIST and BLOCK_LIST as separate v5 fields off separate form state,
    // so a wallet that wrote the wrong one would still produce a valid edit and
    // a token that gates - in the opposite direction from the one the owner
    // asked for.
    expect(lists?.[other],
        `the wallet bound the list as ${other.toUpperCase()}_LIST as well as (or instead of) `
        + `${kind.toUpperCase()}_LIST`)
        .toBeNull();
}

/**
 * Warms the indexer's dry-run for the exact SEND about to be composed, and
 * asserts the VENUE holds the opinion this spec is scripted around.
 *
 * Two jobs, both load-bearing. The dry-run costs real work and the SDK abandons
 * Tier 1 at 4000ms, so a cold one on this shared venue can leave the confirm
 * panel with a Tier-2-only report - which looks exactly like a clean network
 * answer and would make a permitted leg's "Looks good" mean nothing.
 *
 * And it is the ONE assertion here with no wallet in the loop at all: the same
 * question, asked of the explorer directly, must answer `valid: true` for the
 * destination the gate permits and `valid: false` for the one it refuses. If it
 * does not, the access list is not doing what the rest of the test is about to
 * attribute to it, and the failure says so at the venue rather than as confusing
 * missing text on a page.
 */
async function warmSend(source, tick, destination, expected) {
    const quote = await warmPreflight({
        action: 'SEND',
        params: `0|${tick}|${SEND_AMOUNT}|${destination}`,
        source,
    });
    expect(quote.valid,
        `the venue's own dry-run for a ${SEND_AMOUNT} ${tick} send to ${destination} disagrees with `
        + `this spec's premise (expected valid=${expected}): ${JSON.stringify(quote)}`)
        .toBe(expected);
    return quote;
}

/**
 * Fills the real Send form for `SEND_AMOUNT` of `tick` to `destination` and
 * opens the confirm screen.
 *
 * Shared by the permitted and refused legs on purpose: within a test the two
 * must differ in the DESTINATION and in nothing else, or the different verdicts
 * prove nothing about the list.
 */
async function composeTokenSend(page, tick, destination) {
    await gotoPalette(page, 'Send');
    const main = page.getByRole('main');
    await page.getByRole('button', { name: /Change asset/ }).click();
    await page.getByLabel('Search coins or tokens').fill(tick);
    await page.getByLabel(new RegExp(`Open ${tick} details`, 'i')).click();

    // The form's "available" line is read from the address it will actually
    // spend from, so it is the earliest place a wrong source shows up. Without
    // this the run gets all the way to compose and dies on the encoder's own
    // words ("no spendable UTXOs found for the funding address"), several
    // screens away from the cause (D-140).
    await expect(main, `the Send form is not sourcing from the address that holds ${tick}`)
        .toContainText(new RegExp(`[\\d,]+\\s*${tick} available`), { timeout: 60_000 });

    await page.getByLabel('To', { exact: true }).fill(destination);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(String(SEND_AMOUNT));
    await main.getByRole('button', { name: 'Send', exact: true }).click();
    await expectConfirmModal(page);
}

/** Drives a send the gate must PERMIT, and asserts the chain moved the tokens. */
async function expectPermittedSend(page, { source, tick, destination, senderStart }) {
    await reloadToHome(page);
    await warmSend(source, tick, destination, true);
    await composeTokenSend(page, tick, destination);

    // The dry-run ran the real handler against the bound list and let this
    // destination through. Anything else here means the gate is refusing traffic
    // it should pass, which is worse than not gating at all.
    await expect(page.getByTestId('preflight-chip')).toHaveText('Looks good');
    await expect(page.getByTestId('ack-DRYRUN_INVALID')).toHaveCount(0);

    const permitted = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(permitted.action)).toBe('SEND');
    for (const leg of permitted.sends || []) {
        expect(String(leg.status), 'the chain refused a send the access list should have permitted')
            .toBe('valid');
    }
    await waitForBalance(destination, tick, SEND_AMOUNT);
    await waitForBalance(source, tick, senderStart - SEND_AMOUNT);
}

/** Drives a send the gate must REFUSE, in the wallet first and then on chain. */
async function expectRefusedSend(page, { source, tick, destination, senderNow }) {
    await reloadToHome(page);
    await warmSend(source, tick, destination, false);
    await composeTokenSend(page, tick, destination);

    // Half one: the wallet says so BEFORE the fee is spent, and quotes the
    // network's own words rather than paraphrasing them.
    await expect(page.getByTestId('preflight-chip')).toHaveText('Will likely fail');
    await expect(page.getByTestId('preflight-panel')).toHaveAttribute('data-verdict', 'fail');
    await expect(page.getByTestId('preflight-panel'))
        .toContainText(/The network reports this will fail: .*not authorized/i);

    // ...and it blocks by default. The override is the anti-censorship half of
    // §4.2 and is what lets this spec ask the chain directly.
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeDisabled();
    await page.getByTestId('ack-DRYRUN_INVALID').check();
    await expect(approve).toBeEnabled();

    // Half two: the chain, asked over the wallet's objection.
    const refused = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(refused.action)).toBe('SEND');
    const statuses = (refused.sends || []).map((leg) => String(leg.status));
    expect(statuses.length, 'the SEND recorded no legs at all, so nothing was judged')
        .toBeGreaterThan(0);
    for (const status of statuses) {
        expect(status, 'a gated token accepted a transfer its access list should have refused')
            .toMatch(/not authorized/i);
    }

    // And the refusal is a refusal: no credit, no debit. An action recorded
    // invalid must move nothing.
    expect(await tokenBalance(destination, tick),
        'the refused destination was credited by an action the chain recorded as invalid')
        .toBe(0);
    expect(await tokenBalance(source, tick),
        'the refused send still debited the sender')
        .toBe(senderNow);
}

test.describe(`token access lists on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('an allow-list bound to a token decides who may receive it', async ({ page }) => {
        let source;
        /** On the list: a send here must settle. */
        let listed;
        /** Not on the list: a send here must be refused, by the wallet and the chain. */
        let unlisted;
        let listIndex;

        await test.step('onboard and issue the token from the wallet\'s only address', async () => {
            source = await onboardAndIssue(page, TICK_ALLOW, 'Allow-list Wallet');
        });

        await test.step('generate the two addresses the gate will sort', async () => {
            await generateExtraAddresses(page, 2);
        });

        await test.step('publish an address LIST holding the issuer and ONE of the two others', async () => {
            // The ISSUER goes on the list too, and must: send.js checks the
            // SOURCE against the same list before it checks the destination, so
            // an allow-list that omits the owner locks the owner out of their
            // own token.
            const published = await publishAddressList(page, source, (others) => {
                [listed, unlisted] = others;
                return [source, listed];
            });
            listIndex = published.listIndex;
        });

        await test.step('bind it as the token ALLOW_LIST from Manage Token', async () => {
            await bindAccessList(page, TICK_ALLOW, 'allow', listIndex, 2);
        });

        await test.step('a send to a LISTED destination settles', async () => {
            await expectPermittedSend(page, {
                source, tick: TICK_ALLOW, destination: listed, senderStart: SUPPLY,
            });
        });

        await test.step('the SAME send to an UNLISTED destination is refused twice over', async () => {
            await expectRefusedSend(page, {
                source, tick: TICK_ALLOW, destination: unlisted, senderNow: SUPPLY - SEND_AMOUNT,
            });
        });
    });

    test('a block-list bound to the OTHER field refuses only its own members', async ({ page }) => {
        let source;
        /** ON the block-list: a send here must be refused. */
        let blocked;
        /** Not on it: a send here must settle, which is what makes the block specific. */
        let allowed;
        let listIndex;

        await test.step('onboard and issue a second token', async () => {
            source = await onboardAndIssue(page, TICK_BLOCK, 'Block-list Wallet');
        });

        await test.step('generate the two addresses the gate will sort', async () => {
            await generateExtraAddresses(page, 2);
        });

        await test.step('publish a one-member address LIST naming only the address to deny', async () => {
            // The issuer is deliberately NOT on this list: on a block-list,
            // membership is the denial, so putting the owner on it would stop
            // the owner spending their own token (send.js checks the SOURCE
            // against the same list). That inversion is the whole reason this
            // half cannot be assumed from the allow half.
            const published = await publishAddressList(page, source, (others) => {
                [blocked, allowed] = others;
                return [blocked];
            });
            listIndex = published.listIndex;
        });

        await test.step('bind it as the token BLOCK_LIST, and only that field', async () => {
            await bindAccessList(page, TICK_BLOCK, 'block', listIndex, 1);
        });

        await test.step('a send to an address that is NOT on the block-list settles', async () => {
            // The half that makes the denial specific rather than total. A
            // block-list that stopped everything would pass the refusal test
            // below and be a far worse bug than no gate at all.
            await expectPermittedSend(page, {
                source, tick: TICK_BLOCK, destination: allowed, senderStart: SUPPLY,
            });
        });

        await test.step('the SAME send to the BLOCKED address is refused twice over', async () => {
            await expectRefusedSend(page, {
                source, tick: TICK_BLOCK, destination: blocked, senderNow: SUPPLY - SEND_AMOUNT,
            });
        });
    });
});
