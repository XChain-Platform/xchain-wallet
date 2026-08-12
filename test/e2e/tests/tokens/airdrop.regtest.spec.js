// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Manage Token" -> AIRDROP: the two-transaction drop,
// end to end, for the first time in the campaign, in all THREE of its source
// modes.
//
//   1. Paste addresses  - publishes a TYPE=2 address list, waits for it to
//                         index, then drops to it. The lane below.
//   2. Token holders    - publishes a TYPE=1 TOKEN list; the recipients are
//                         resolved from who HOLDS that token at execute time,
//                         which the second test proves by changing the holder
//                         set between the two signatures.
//   3. Existing list    - no LIST leg at all, one signature, against a list
//                         published somewhere else entirely.
//
// Each mode's own rationale sits above its test; what follows is mode 1's.
//
// WHY THIS LANE WAS STILL ⬜ AFTER SIXTEEN SESSIONS, and why the reason no
// longer holds. Session 19 drove step 1 (the recipient list) and stopped at the
// wait-for-index screen with a stated blocker: campaign §3.3, the MCP-driven tab
// is permanently `document.visibilityState === "hidden"`, and the stage-4 poll
// that resolves the LIST's ACTION_INDEX returns early on exactly that condition
// (AirdropForm.jsx, "Pauses when the tab is hidden"). So the wallet sat on
// "Waiting for list to be indexed" forever and step 2 was unreachable - through
// THAT harness. A Playwright page is a real foreground tab and reports
// `visible`, so the poll runs. Same lesson Session 34 paid for on the controller
// lane: a ⬜ whose blocker is NAMED should be re-read against today's harness
// before it is planned around, because the blocker may belong to a tool the
// campaign has since replaced.
//
// WHAT MAKES IT WORTH THE RUNTIME. AIRDROP is the only action in the wallet that
// spends money in TWO signed transactions with an indexer round-trip wedged
// between them, and the second one is priced per recipient. Reading the drop
// back off the sender would prove nothing interesting: a drop that credited
// nobody, a drop that credited the wrong addresses, and a drop that credited
// everyone the wallet holds all debit the same sender. So the assertion is the
// SPLIT, measured on four addresses at once:
//
//   recipient 1 (on the published list)     -> credited exactly AMOUNT
//   recipient 2 (on the published list)     -> credited exactly AMOUNT
//   the control (the wallet's own address,
//     never on the list, same wallet,
//     same chain, generated in the same
//     breath as the other two)              -> credited NOTHING
//   the issuer                              -> debited exactly 2 x AMOUNT
//
// The control is what makes the other three mean something. `AIRDROP` to an
// ADDRESS list pays "each address on the list" (protocol AIRDROP.md), and the
// indexer resolves that membership from the LIST action's stored rows
// (`indexerDb.getList`) rather than from anything the AIRDROP carries - so an
// off-by-one in the list, a list stored empty, or a wallet that published a
// different set from the one it displayed all land as a credit going somewhere
// nobody asked for. A fourth address of the same wallet, on the same chain,
// differing ONLY in not being on the list, is the cheapest way to say that.
//
// AND THE LIST ITSELF IS READ BACK OFF THE CHAIN, not trusted from the screen.
// that second half: the indexer marks a LIST valid while silently dropping
// items it rejects into `list_items_invalid`, so "the LIST action is valid" is
// NOT "the membership is what was asked for". D-87 was exactly that - a mainnet
// address counted among "3 valid addresses", printed on the review screen, given
// "Looks good" by the dry-run, and dropped by the chain, leaving a paid-for
// 3-item list holding 2. The fix (parse against the ACTIVE chain's real address
// parameters) is checked here on the live form, in the same paste that composes
// the real drop, because a client-side guard is only worth what the chain
// confirms.
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/airdrop.regtest.spec.js

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
/** ISSUE, LIST, SEND and AIRDROP each pay a real coin fee on this chain. */
const FUNDING = 3;
const STAMP = Date.now().toString().slice(-6);
const TICK = `DRP${STAMP}`;
/** Test 2 drops this token to the holders of MEMB_TICK, which is a different token. */
const DROP_TICK = `HDR${STAMP}`;
const MEMB_TICK = `MEM${STAMP}`;
/** Test 3 drops this token to a list published outside the airdrop form. */
const LIST_TICK = `EXL${STAMP}`;
const SUPPLY = 1000;
const MEMB_SUPPLY = 100;
/** Moved to make an address a holder of MEMB_TICK. */
const MEMB_MOVE = 10;
/** Paid to EACH address on the list, so the drop costs this x the recipient count. */
const AMOUNT = 25;

/**
 * A real, well-formed BITCOIN MAINNET address (the published BIP84
 * m/84'/0'/0'/0/0 vector the campaign's import lanes are pinned against).
 *
 * Deliberately a valid address rather than garbage: the form has always
 * rejected debris on length + charset alone, and D-87 was about the case that
 * passes that test and still cannot be paid - which is why the assertion below
 * is on the WRONG-NETWORK wording and not merely on the invalid count.
 */
const MAINNET_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

/**
 * The venue coin's spendable satoshis at `address`, read from the encoder's
 * UTXO view rather than from the explorer - it is the same set the wallet
 * spends from, so a before/after pair measures what the transaction really
 * cost. (Method borrowed from `fees/protocol-fee-mandatory-lane`.)
 */
async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
}

/** The composed transaction's miner fee, in satoshis, off the confirm screen. */
async function screenNetworkFeeSats(page) {
    const text = await page.getByTestId('confirm-fee').innerText();
    const coin = Number(text.match(/([\d.]+)\s*[A-Z]{3,5}/)?.[1]);
    expect(Number.isFinite(coin), `unparseable network fee line: ${text}`).toBe(true);
    return Math.round(coin * 1e8);
}

/** The protocol-fee row of the confirm screen's balance projection, in sats. */
async function projectedProtocolFeeSats(page) {
    const deltas = page.getByTestId('action-intent-deltas');
    if (await deltas.count() === 0) return null;
    const text = await deltas.innerText();
    const coin = text.match(/Protocol fee\s*[A-Z]{3,5}\s*([\d.]+)/)?.[1];
    return coin === undefined ? null : Math.round(Number(coin) * 1e8);
}

/**
 * Asserts the chain's own fee record for an AIRDROP that paid `recipients`
 * addresses.
 *
 * AIRDROP is the only action in the wallet whose protocol fee scales with the
 * size of its own input: the unified schedule bills `AIRDROP_PER_RECIPIENT`
 * (100 gas units) PER recipient, and the recipients are the set the indexer
 * resolved, not the set the wallet asked for. So a fee computed off the list
 * length, off a flat rate, or off the wrong count is a real and plausible bug,
 * and the gas figure is where it shows up undivided by any price.
 */
function expectPerRecipientFee(dropped, recipients) {
    const fee = dropped.fee || {};
    expect(Number(fee.gas_cost),
        `an airdrop to ${recipients} addresses was billed ${fee.gas_cost} gas units; the unified `
        + `schedule prices it per recipient, so it should be ${100 * recipients}`)
        .toBe(100 * recipients);
    // Off Bitcoin the native coin is the ONLY lane, so a fee recorded
    // against an XCHAIN balance here would be a fee this wallet cannot pay (it
    // holds no XCHAIN at all).
    expect(Number(fee.payment_mode),
        'the airdrop recorded an XCHAIN-lane fee on a chain that has no XCHAIN fee lane')
        .toBe(1);
    expect(Number(fee.native_coin_amount),
        'the mandatory native lane recorded no coin amount for a fee-bearing action')
        .toBeGreaterThan(0);
}

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
 * detail, WITHOUT asserting the verdict - callers assert the status they expect,
 * by name.
 *
 * Never fetches an action index speculatively: the explorer memoizes a miss
 * forever (§3.6/D-127), so the recent-actions list comes first and only an index
 * it returned is ever fetched.
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
 * Polls to the expected value rather than reading once, for the reason Session
 * 34 wrote down after losing a green run to it: the explorer serves an action's
 * row before that action's effect on the balance view, and a blipped read maps
 * "no row" to a confident zero. Balances only move forward here, so a poll
 * cannot mask a real failure - a credit that had landed would read HIGHER and
 * never come back down.
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
 * This test is long (an ISSUE, a LIST and an AIRDROP, each waiting on real
 * blocks) and a price snapshot is usable for 1800 chain-seconds. Without this an
 * aged-out seed presents as a confirm screen that never opens, which reads like
 * a wallet regression rather than venue state.
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

/**
 * Approves the open confirm screen and returns the transaction id it produced.
 *
 * `not` excludes an id ALREADY on screen, which this flow needs and no other
 * spec does: the airdrop's terminal screen prints BOTH transactions ("Recipient
 * list transaction" above "Airdrop transaction"), so taking the first 64-hex
 * match off leg 2 hands back leg 1's id - and every downstream assertion then
 * reads a LIST where it expects an AIRDROP, which is how this spec failed its
 * third run.
 */
async function approveAndGetTxid(page, not = null) {
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled({ timeout: 120_000 });
    await approve.click();
    const main = page.getByRole('main');
    // The success screens render the id with no separators ("Transaction
    // IDae0d…Done"), so a \b-anchored pattern does not match (§3.5, Session 30).
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        const found = ((await main.innerText().catch(() => '')).match(/[0-9a-f]{64}/g) || [])
            .filter((id) => id !== not);
        if (found.length > 0) return found[0];
        await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error('no new transaction id ever appeared after Approve');
}

/**
 * Reloads onto a clean, unlocked Home.
 *
 * The navigation FIRST is load-bearing: this shell restores the route it was on
 * across a reload, and `unlockAfterReload` waits for Home's balance hero - so
 * reloading from any other screen unlocks fine and then times out for 90s on a
 * wallet that is working (§3.5, Session 32).
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
 * (campaign §3.5, note 3) - so a prefix filter over the unfiltered list cannot
 * tell them apart, and a wrong-chain address here would be a recipient the LIST
 * form correctly refuses, on the chain whose parser is under test.
 *
 * Picking `keep` on the way out is not tidiness either: this form defaults From
 * to the NEWEST external HD address (AirdropForm.jsx, "or the newest external HD
 * address on the chosen chain"), which after generating the recipients is one of
 * THEM - an address holding no coin and no supply. See D-140 for what that costs.
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

/** Issues `tick` with `supply` from `source` and waits for the supply to land. */
async function issueToken(page, tick, supply, source) {
    // Start from Home, not from wherever the last action ended: a form's own
    // palette command is a NO-OP while the shell is already on that route, so
    // issuing a second token from the ISSUE done screen waits 30s on a form that
    // never remounts (Session 34).
    await reloadToHome(page);
    await gotoPalette(page, 'Issue token');
    const form = page.getByRole('main');
    await expect(form.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(form);
    expect(await form.getByLabel('From').inputValue(),
        'the Issue form is not signing with the funded address')
        .toBe(source);
    await form.getByLabel('Ticker').fill(tick);
    await form.getByLabel('Supply', { exact: true }).fill(String(supply));
    await form.getByRole('button', { name: 'Issue token', exact: true }).click();

    await expectConfirmModal(page);
    const issued = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(issued.status),
        `the venue rejected the ISSUE of ${tick} (${issued.status}); on this chain that is `
        + 'usually the price sentinel going stale mid-run (campaign §3.2), not a wallet defect')
        .toBe('valid');
    await waitForBalance(source, tick, supply);
}

/**
 * Onboards a fresh wallet, funds its ONLY address and issues each `[tick,
 * supply]` from it. Returns that address, which owns every token, is the
 * chain's active address, and is the only address on the wallet holding coin.
 *
 * The tokens are created while the wallet still has exactly one address on
 * purpose: the other addresses are generated afterwards, so the issuer stays
 * the lowest HD index and every later form that defaults to the NEWEST one is
 * visibly wrong rather than silently signing from an empty address (D-140).
 */
async function onboardAndIssue(page, ticks = [[TICK, SUPPLY]], walletName = 'Airdrop Wallet') {
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

    // Seeded ONCE for the whole setup, not per action. A snapshot is good for
    // 1800 chain-seconds and these runs are ~3 minutes, while `seedPrices()`
    // reads the explorer several times per call - and on a venue shared with
    // another session's suite, calling it per step is enough to earn a
    // "Too many requests" that presents as an unpriceable venue (this run).
    await seedPrices();
    for (const [tick, supply] of ticks) await issueToken(page, tick, supply, source);
    return source;
}

/**
 * Sends `amount` of `tick` to `destination` from the chain's ACTIVE address and
 * waits for the credit.
 *
 * Send offers no source picker at all - it is hard-wired to the active address
 * (D-140) - which is exactly why the issuer is created before any other address
 * exists: the active address and the address holding the supply have to be the
 * same one.
 */
async function sendToken(page, tick, destination, amount, destinationAfter) {
    await reloadToHome(page);
    await gotoPalette(page, 'Send');
    const main = page.getByRole('main');
    await pickAsset(page, tick);
    await expect(main, `the Send form is not sourcing from the address that holds ${tick}`)
        .toContainText(new RegExp(`[\\d,]+\\s*${tick} available`), { timeout: 60_000 });

    await page.getByLabel('To', { exact: true }).fill(destination);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(String(amount));
    await main.getByRole('button', { name: 'Send', exact: true }).click();
    await expectConfirmModal(page);

    // A SEND carries its verdict per LEG (`sends[].status`) and has no top-level
    // `status` of its own, unlike every other action this spec reads - so a
    // `detail.status` check here reads `undefined` and says the chain refused a
    // send it accepted.
    const sent = await waitForIndexedAction(await approveAndGetTxid(page));
    const legs = (Array.isArray(sent.sends) ? sent.sends : [])
        .map((leg) => String(leg.status))
        .concat(typeof sent.status === 'string' ? [sent.status] : []);
    expect(legs.length, `the ${tick} send exposed no status at all; keys: ${Object.keys(sent).join(',')}`)
        .toBeGreaterThan(0);
    for (const status of legs) {
        expect(status, `the chain refused a plain ${tick} send`).toBe('valid');
    }
    await waitForBalance(destination, tick, destinationAfter ?? amount);
}

/**
 * Opens the Send asset picker and selects `tick`.
 *
 * Waits for the list to have ANY row before filtering: the picker's "Nothing
 * matches" empty state is identical whether the wallet does not hold the token
 * or the balance read has not landed, so filtering first turns a slow read into
 * "this token does not exist" thirty seconds later (Session 34, D-152). The
 * retry re-enters Send because the picker only refetches on mount.
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

/**
 * Publishes a TYPE=2 address LIST of `members` through the standalone list
 * form and returns its ACTION_INDEX.
 *
 * Deliberately NOT through the airdrop form: the 'existing' mode's whole point
 * is airdropping to a list that was already there, so the list has to come from
 * somewhere else or the test is just the paste lane again.
 */
async function publishAddressList(page, source, members) {
    await reloadToHome(page);
    await gotoPalette(page, 'Create a list');
    const main = page.getByRole('main');
    await expect(main.getByLabel('List type')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    await readChainAddresses(page, source);
    expect(await main.getByLabel('From').inputValue(),
        'the list would be published from an address holding no coin')
        .toBe(source);

    await main.getByLabel('List type').selectOption('2');
    await main.getByLabel('Addresses', { exact: true }).fill(members.join('\n'));
    const plural = members.length === 1 ? 'address' : 'addresses';
    await expect(main, `the list form did not accept all ${members.length} addresses for this chain`)
        .toContainText(`${members.length} valid ${plural}`);

    await main.getByRole('button', { name: /^(Publish list|Review)$/ }).click();
    await expectConfirmModal(page);
    const published = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(published.action)).toBe('LIST');
    expect(String(published.status), 'the chain rejected the LIST').toBe('valid');
    return String(published.action_index);
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

/** Opens the Airdrop form's token picker and selects `tick`. */
async function pickDropToken(page, tick) {
    await page.getByRole('button', { name: /^Token to drop:/ }).click();
    // Wait for the picker to have ANY row before filtering: its "Nothing
    // matches" empty state is identical whether the wallet does not hold the
    // token or its balances have not landed yet, so filtering first turns a slow
    // read into "this token does not exist" thirty seconds later (Session 34).
    await expect(page.getByLabel(/Open .+ details/i).first(),
        'the token picker listed nothing at all, so its balances never arrived')
        .toBeVisible({ timeout: 60_000 });
    await page.getByLabel('Search coins or tokens').fill(tick);
    const row = page.getByLabel(new RegExp(`Open ${tick} details`, 'i')).first();
    await expect(row, `the wallet's balance list does not carry ${tick}`)
        .toBeVisible({ timeout: 30_000 });
    await row.click();
}

test.describe(`airdrop on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('a paste-mode airdrop publishes its list, waits for it to index, and credits exactly the addresses on it', async ({ page }) => {
        let issuer;
        let recipients;
        let control;
        let listTxid;
        let listIndex;
        let airdropTxid;
        let minerSats;
        let projectedFeeSats;
        let satsBefore;

        await test.step('onboard, fund and issue the token from the wallet\'s only address', async () => {
            issuer = await onboardAndIssue(page);
        });

        await test.step('generate the two recipients and the control address', async () => {
            await generateExtraAddresses(page, 3);
            await reloadToHome(page);
        });

        await test.step('compose the drop, and refuse a mainnet address while doing it', async () => {
            await seedPrices();
            await gotoPalette(page, 'Airdrop');
            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: /^Token to drop:/ }))
                .toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);

            // Token first: the picker re-targets the form's network to the
            // chain the selected token lives on, so picking it after the From
            // address would silently reset the address default underneath it.
            await pickDropToken(page, TICK);
            await selectVenueChain(main);

            // Reading the wallet's addresses through this form's own picker
            // scopes them to this chain AND leaves From on the issuer, which is
            // the only address holding either coin or supply.
            const own = await readChainAddresses(page, issuer);
            const others = own.filter((a) => a !== issuer);
            expect(others.length,
                `expected 3 more ${REGTEST_CHAIN_LABEL} addresses beside the issuer, found `
                + `${others.length}: ${others.join(', ')}`)
                .toBe(3);
            recipients = others.slice(0, 2);
            [control] = others.slice(2);

            expect(await main.getByLabel('From').inputValue(),
                'the airdrop would be signed by an address that is not the token issuer, so it '
                + 'would be paid for by an address holding no coin and no supply')
                .toBe(issuer);

            await page.getByRole('textbox', { name: /^Per-recipient amount/ }).fill(String(AMOUNT));

            // D-87, checked on the live form and in the SAME paste that
            // composes the real drop: a well-formed address for another network
            // used to count as valid all the way through review, dry-run and
            // broadcast, and only the chain dropped it - after it was paid for.
            await page.getByLabel('Recipients').fill([...recipients, MAINNET_ADDRESS].join('\n'));
            await expect(main, 'the form counted the mainnet address among the payable recipients')
                .toContainText(`${recipients.length} valid addresses · 1 invalid skipped`);
            const skipped = main.getByRole('alert');
            await expect(skipped,
                'the mainnet address was skipped without saying it was skipped for being on '
                + 'another network, which reads as a typo rather than as a chain mismatch')
                .toContainText(/for another network/);
            await expect(skipped,
                'the skip notice does not name the chain this airdrop pays on, which is the half '
                + 'that tells the user what to do about it')
                .toContainText(REGTEST_CHAIN_LABEL);

            // Now the real list: two addresses, no debris, and the control
            // deliberately absent.
            await page.getByLabel('Recipients').fill(recipients.join('\n'));
            await expect(main).toContainText(`${recipients.length} valid addresses`);
            await expect(main, 'the form did not project the total this drop pays out')
                .toContainText(`total ~${AMOUNT * recipients.length} ${TICK}`);

            await main.getByRole('button', { name: 'Review recipients' }).click();
        });

        await test.step('sign leg 1: the LIST that names the recipients', async () => {
            const main = page.getByRole('main');
            // The stage titles live in PageHeader, which renders a <span> rather
            // than a heading, so these are text matches by necessity.
            await expect(page.getByText('Review address list', { exact: true }).first())
                .toBeVisible({ timeout: 30_000 });
            await expect(main, 'the review stage does not state that this costs two signatures')
                .toContainText('Airdrop is a two-transaction flow');

            await main.getByRole('button', { name: /^Sign LIST/ }).click();
            await expectConfirmModal(page);
            listTxid = await approveAndGetTxid(page);
        });

        await test.step('the wallet resolves the LIST index on its own and advances to leg 2', async () => {
            // THE STEP THIS LANE HAS BEEN OWED SINCE SESSION 19. The wallet's
            // own 10s poll is what has to resolve the LIST's ACTION_INDEX; the
            // spec supplies only the blocks, and never touches the form.
            await expect(page.getByText('Waiting for list to be indexed', { exact: true }).first(),
                'the wallet did not enter its own wait-for-index stage after the LIST broadcast')
                .toBeVisible({ timeout: 30_000 });

            const title = page.getByText('Review airdrop', { exact: true }).first();
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                if (await title.isVisible().catch(() => false)) break;
                await mineIfPending();
                await new Promise((r) => setTimeout(r, 2_000));
            }
            await expect(title,
                'the wallet never advanced past "Waiting for list to be indexed". The LIST is on '
                + 'chain (see the txid above), so this is the stage-4 poll, not the broadcast: it '
                + 'returns early whenever document.visibilityState is "hidden" (campaign §3.3).')
                .toBeVisible({ timeout: 60_000 });
        });

        await test.step('sign leg 2: the AIRDROP that references the indexed list', async () => {
            const main = page.getByRole('main');
            // Not decoration: in paste mode this figure is the count the wallet
            // read BACK off the published list (`listReconcile.storedCount`),
            // falling back to the submitted count only if that read failed - so
            // the screen agreeing with the chain is the reconcile working.
            // Case-insensitive because the detail labels are upper-cased in CSS
            // and `useInnerText` reports the TRANSFORMED text ("RECIPIENTS").
            await expect(main, 'the airdrop review does not name how many addresses it pays')
                .toContainText(new RegExp(`recipients\\s*${recipients.length}\\b`, 'i'),
                    { useInnerText: true });

            await main.getByRole('button', { name: /^Sign AIRDROP/ }).click();
            await expectConfirmModal(page);

            // Read the screen's two money figures BEFORE approving, and the
            // payer's coin balance with them. This is the only action in the
            // wallet whose protocol fee scales with its own input, so "the
            // screen projected what the chain charged" is a different claim
            // here than it is for a flat-rate action.
            minerSats = await screenNetworkFeeSats(page);
            projectedFeeSats = await projectedProtocolFeeSats(page);
            expect(projectedFeeSats,
                'the confirm screen projected NO protocol fee for an airdrop that is about to be '
                + 'charged one per recipient, which is s screen: the miner fee quoted to'
                + 'eight places and the larger charge unmentioned')
                .not.toBeNull();
            satsBefore = await coinBalanceSats(issuer);

            // The done screen prints the LIST's id above the AIRDROP's, so the
            // one already known has to be excluded by name.
            airdropTxid = await approveAndGetTxid(page, listTxid);
            expect(airdropTxid,
                'the airdrop reported the recipient list\'s transaction as its own')
                .not.toBe(listTxid);
            await expect(page.getByRole('heading', { name: 'Airdrop sent' }))
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('the chain stored the list the wallet displayed, and nothing more', async () => {
            const published = await waitForIndexedAction(listTxid);
            expect(String(published.action)).toBe('LIST');
            expect(String(published.status), 'the chain rejected the recipient LIST').toBe('valid');
            listIndex = String(published.action_index);

            // The LIST being valid is NOT the membership being right: the
            // indexer stores a list while dropping items it rejects into
            // `list_items_invalid`. Read the rows back.
            const stored = (published.list || published.items || published.members || [])
                .map((row) => String(typeof row === 'object' ? (row.address ?? row.item ?? '') : row));
            expect(stored.sort(), `list #${listIndex} did not store the addresses it was shown`)
                .toEqual([...recipients].sort());
            expect(stored, 'the control address reached the published list, so it is no longer a control')
                .not.toContain(control);
        });

        await test.step('every address on the list was credited, and the one off it was not', async () => {
            const dropped = await waitForIndexedAction(airdropTxid);
            // The protocol lets DROP stand in for AIRDROP as a shorter wire
            // reference, so the recorded name is either.
            expect(String(dropped.action)).toMatch(/^(AIRDROP|DROP)$/);
            expect(String(dropped.status), 'the chain rejected the AIRDROP').toBe('valid');
            expect(String(dropped.tick), 'the AIRDROP settled against a different token')
                .toBe(TICK);
            expect(Number(dropped.amount),
                'the chain recorded a different PER-RECIPIENT amount from the one composed')
                .toBe(AMOUNT);
            expect(String(dropped.list_action_index),
                'the AIRDROP does not reference the list this run published')
                .toBe(listIndex);

            for (const address of recipients) {
                await waitForBalance(address, TICK, AMOUNT);
            }
            // Only meaningful AFTER both credits have landed: before that, zero
            // is what an unprocessed airdrop looks like too.
            expect(await tokenBalance(control, TICK),
                `${control} was never on the published list and was credited anyway, so the drop `
                + 'is paying addresses nobody asked for')
                .toBe(0);
            await waitForBalance(issuer, TICK, SUPPLY - (AMOUNT * recipients.length));
        });

        await test.step('the per-recipient fee is what the screen projected, to the satoshi', async () => {
            const dropped = await waitForIndexedAction(airdropTxid);
            expectPerRecipientFee(dropped, recipients.length);
            expect(Math.round(Number(dropped.fee.native_coin_amount) * 1e8),
                `the coin fee on chain is not the ${projectedFeeSats} sats the screen projected`)
                .toBe(projectedFeeSats);

            // What the payer actually lost: the miner fee plus the protocol
            // fee, and nothing else. was exactly this subtraction coming
            // out short, and on an action whose fee is a function of its own
            // recipient count it is the only check that would catch a
            // projection computed off the wrong number.
            const satsAfter = await coinBalanceSats(issuer);
            expect(satsBefore - satsAfter,
                `the screen projected ${minerSats + projectedFeeSats} sats (network ${minerSats} `
                + `+ protocol ${projectedFeeSats}); the chain charged ${satsBefore - satsAfter}`)
                .toBe(minerSats + projectedFeeSats);

            // This wallet minted no XCHAIN, so a fee taken there as well would
            // have to come out of a balance of nothing.
            expect(await tokenBalance(issuer, 'XCHAIN'),
                'the mandatory coin lane also touched an XCHAIN balance')
                .toBe(0);
        });
    });

    // WHY THIS SECOND TEST EXISTS, and why it is not "the same drop with a
    // different list type". A TYPE=2 list names ADDRESSES, so the set the
    // wallet published and the set the chain pays are the same set by
    // construction. A TYPE=1 list names TOKENS, and the recipients are whoever
    // HOLDS those tokens - a set the indexer resolves at EXECUTE time
    // (`getHolders(tick, BLOCK_INDEX, ACTION_INDEX)`), not when the list was
    // published. The form says so in as many words: it labels the figure
    // "Holders (current, not final)" and its own comment calls the count "a
    // preview, never a promise".
    //
    // That promise is the whole test, and there is exactly one way to check it:
    // CHANGE THE HOLDER SET BETWEEN THE TWO SIGNATURES and require the chain to
    // pay the address that arrived late. A wallet that snapshotted the holders
    // into the LIST, or an indexer that resolved them at publication, would pass
    // every other assertion here and fail that one. The late holder is also the
    // reason this lane cannot be checked by reading the screen: the screen never
    // counted them.
    //
    // It buys a second thing for free. Leaving the form mid-flow to make that
    // send drives the RESUME path - "Close (keep waiting)", the Home banner, and
    // the pending record rehydrating a signed-but-unfinished airdrop - which
    // Session 19 documented from the outside and no session has ever driven
    // through to a broadcast.
    test('a token-holder list pays the holders at EXECUTE time, including one who arrived after the list was published', async ({ page }) => {
        let issuer;
        let early;
        let late;
        let control;
        let listTxid;
        let listIndex;
        let airdropTxid;

        await test.step('onboard, fund and issue both tokens: the one dropped and the one held', async () => {
            issuer = await onboardAndIssue(
                page,
                [[DROP_TICK, SUPPLY], [MEMB_TICK, MEMB_SUPPLY]],
                'Holder Airdrop Wallet',
            );
        });

        await test.step('generate the early holder, the late holder and the control', async () => {
            await generateExtraAddresses(page, 3);
            await reloadToHome(page);

            // Read them off the Airdrop form's own picker, which scopes them to
            // this chain - the three regtest chains share legacy version bytes,
            // so the unfiltered Addresses list cannot tell them apart (§3.5).
            await gotoPalette(page, 'Airdrop');
            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: /^Token to drop:/ }))
                .toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            const own = await readChainAddresses(page, issuer);
            const others = own.filter((a) => a !== issuer);
            expect(others.length,
                `expected 3 more ${REGTEST_CHAIN_LABEL} addresses beside the issuer, found `
                + `${others.length}`)
                .toBe(3);
            [early, late, control] = others;
        });

        await test.step('make ONE address a holder, before the list is published', async () => {
            await sendToken(page, MEMB_TICK, early, MEMB_MOVE);
        });

        await test.step('compose a token-holder drop and publish the TYPE=1 list', async () => {
            await reloadToHome(page);
            await seedPrices();
            await gotoPalette(page, 'Airdrop');
            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: /^Token to drop:/ }))
                .toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await pickDropToken(page, DROP_TICK);
            await selectVenueChain(main);
            await readChainAddresses(page, issuer);
            expect(await main.getByLabel('From').inputValue(),
                'the drop would be signed by an address that is not the issuer')
                .toBe(issuer);

            await page.getByRole('textbox', { name: /^Per-recipient amount/ }).fill(String(AMOUNT));
            await main.getByLabel('Airdrop to').selectOption('holders');
            await page.getByLabel('Tokens (one per line)').fill(MEMB_TICK);

            // TWO holders right now: the issuer, which kept most of the supply,
            // and the address it just paid. This figure is the one the test is
            // about to make wrong on purpose.
            await expect(main, 'the form did not preview the holder count for the listed token')
                .toContainText(/1 token · ~2 holders right now/, { timeout: 60_000 });

            await main.getByRole('button', { name: 'Review recipients' }).click();
            await expect(page.getByText('Review token list', { exact: true }).first(),
                'a token-holder drop did not reach the TOKEN list review (it may have fallen '
                + 'back to the address-list wording, which would mean the wrong LIST TYPE)')
                .toBeVisible({ timeout: 30_000 });

            await page.getByRole('main').getByRole('button', { name: /^Sign LIST/ }).click();
            await expectConfirmModal(page);
            listTxid = await approveAndGetTxid(page);
        });

        await test.step('the wallet resolves the list index on its own and offers leg 2', async () => {
            const title = page.getByText('Review airdrop', { exact: true }).first();
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                if (await title.isVisible().catch(() => false)) break;
                await mineIfPending();
                await new Promise((r) => setTimeout(r, 2_000));
            }
            await expect(title, 'the wallet never advanced past the wait-for-index stage')
                .toBeVisible({ timeout: 60_000 });
            await expect(page.getByRole('main'),
                'a token-holder drop should label its count as a PREVIEW, since the chain fixes '
                + 'the holder set at execute time and the form knows it')
                .toContainText(/holders \(current, not final\)/i, { useInnerText: true });
        });

        await test.step('a NEW holder arrives after the list is published, with the airdrop unsigned', async () => {
            // Walking away here is the documented affordance ("Safe to close the
            // wallet; we'll resume from Home when you reopen it"), and it is the
            // only way to make the holder set change between the two signatures.
            await sendToken(page, MEMB_TICK, late, MEMB_MOVE);
            await reloadToHome(page);

            const resume = page.getByRole('button', { name: /^Resume airdrop:/ });
            await expect(resume,
                'the signed-but-unfinished airdrop is not offered on Home, so a LIST that has '
                + 'already been paid for would be stranded')
                .toBeVisible({ timeout: 60_000 });
            await expect(resume).toContainText('Ready to sign the airdrop');
            await resume.click();

            await expect(page.getByText('Review airdrop', { exact: true }).first(),
                'resuming did not land back on the airdrop review')
                .toBeVisible({ timeout: 60_000 });
            // The preview has moved with the chain: three holders now, and the
            // wallet re-read them rather than replaying the count it published.
            await expect(page.getByRole('main'),
                'the resumed review still quotes the holder count from before the new holder '
                + 'arrived, so the figure is a replay rather than a live read')
                .toContainText(/holders \(current, not final\)\s*3/i, { useInnerText: true });
        });

        await test.step('sign the AIRDROP against the token list', async () => {
            const main = page.getByRole('main');
            await main.getByRole('button', { name: /^Sign AIRDROP/ }).click();
            await expectConfirmModal(page);
            airdropTxid = await approveAndGetTxid(page, listTxid);
            expect(airdropTxid).not.toBe(listTxid);
            await expect(page.getByRole('heading', { name: 'Airdrop sent' }))
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('the list stored the TOKEN, not the holders it had at the time', async () => {
            const published = await waitForIndexedAction(listTxid);
            expect(String(published.action)).toBe('LIST');
            expect(String(published.status), 'the chain rejected the token LIST').toBe('valid');
            expect(String(published.type),
                'the holders mode published an ADDRESS list (TYPE 2) instead of a TOKEN list')
                .toBe('1');
            listIndex = String(published.action_index);

            const stored = (published.list || published.items || published.members || [])
                .map((row) => String(typeof row === 'object' ? (row.tick ?? row.item ?? '') : row));
            expect(stored, 'the token list does not carry the token it was given').toEqual([MEMB_TICK]);
            // The point of the whole test, stated as an assertion: the list is a
            // pointer to a token, not a snapshot of who held it.
            expect(stored, 'the list snapshotted holders instead of naming the token, so the '
                + 'execute-time resolution the form promises cannot happen')
                .not.toContain(early);
        });

        await test.step('the late holder was paid, and the non-holder was not', async () => {
            const dropped = await waitForIndexedAction(airdropTxid);
            expect(String(dropped.action)).toMatch(/^(AIRDROP|DROP)$/);
            expect(String(dropped.status), 'the chain rejected the AIRDROP').toBe('valid');
            expect(String(dropped.tick)).toBe(DROP_TICK);
            expect(String(dropped.list_action_index)).toBe(listIndex);

            // Three recipients here against two in the paste lane and one in
            // the existing-list lane: three points on the per-recipient curve,
            // and this is the one whose count came from the CHAIN rather than
            // from anything the wallet published.
            expectPerRecipientFee(dropped, 3);

            // The address that HELD the token when the list was published.
            await waitForBalance(early, DROP_TICK, AMOUNT);
            // THE ASSERTION THIS TEST EXISTS FOR: the address that became a
            // holder AFTER the list was on chain, and that the wallet's own
            // preview never counted at publication time.
            await waitForBalance(late, DROP_TICK, AMOUNT);
            // A wallet address that never held the listed token at all.
            expect(await tokenBalance(control, DROP_TICK),
                `${control} never held ${MEMB_TICK} and was credited anyway, so the drop is not `
                + 'resolving its recipients from the token at all')
                .toBe(0);
            // Three recipients paid, and the issuer is one of them (it kept most
            // of MEMB), so it is down by two shares rather than three.
            await waitForBalance(issuer, DROP_TICK, SUPPLY - (AMOUNT * 3) + AMOUNT);
        });
    });

    // The third and last source mode, and the only one that is a SINGLE
    // transaction: 'existing' takes a list that is already on chain, so there is
    // no LIST leg, no indexer wait and no pending record. Its hint says exactly
    // that - "no new list gets created" - and that promise is the negative half
    // of this test, asserted where it is observable: the flow must never reach
    // the list-review stage, and the AIRDROP must reference the index that was
    // published BEFORE the form was opened.
    //
    // It is also the only mode where the list index comes from a PICKER rather
    // than from a broadcast the wallet just made, which is the one place a wrong
    // number pays strangers. So the list is published with one member and a
    // second wallet address is held out: the picker resolving to the wrong list,
    // or the form sending an index it did not display, both land as the held-out
    // address being paid.
    test('an existing list is airdropped to in one transaction, with no second list published', async ({ page }) => {
        let issuer;
        let member;
        let heldOut;
        let listIndex;
        let airdropTxid;

        await test.step('onboard, fund and issue the token', async () => {
            issuer = await onboardAndIssue(page, [[LIST_TICK, SUPPLY]], 'Existing List Wallet');
        });

        await test.step('generate the list member and the address held off it', async () => {
            await generateExtraAddresses(page, 2);
            await reloadToHome(page);

            await gotoPalette(page, 'Airdrop');
            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: /^Token to drop:/ }))
                .toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            const others = (await readChainAddresses(page, issuer)).filter((a) => a !== issuer);
            expect(others.length).toBe(2);
            [member, heldOut] = others;
        });

        await test.step('publish the list somewhere else entirely', async () => {
            listIndex = await publishAddressList(page, issuer, [member]);
        });

        await test.step('airdrop to it, and never touch a list-publishing screen', async () => {
            await reloadToHome(page);
            await seedPrices();
            await gotoPalette(page, 'Airdrop');
            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: /^Token to drop:/ }))
                .toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await pickDropToken(page, LIST_TICK);
            await selectVenueChain(main);
            await readChainAddresses(page, issuer);

            await page.getByRole('textbox', { name: /^Per-recipient amount/ }).fill(String(AMOUNT));
            await main.getByLabel('Airdrop to').selectOption('existing');
            await main.getByRole('button', { name: 'Choose list' }).click();
            const row = page.getByRole('button', { name: `Address list #${listIndex}` });
            await expect(row, `the list picker does not offer list #${listIndex}, which this wallet `
                + 'published from this chain minutes ago')
                .toBeVisible({ timeout: 60_000 });
            await row.click();

            // The form has to SHOW which list it is about to pay, or the number
            // it sends is unverifiable by the person signing it.
            await expect(main, 'the form does not name the list it is airdropping to')
                .toContainText(`List #${listIndex}`);
            await expect(main, 'the form did not recognise the pick as an ADDRESS list')
                .toContainText(/address list/i);

            // 'existing' skips the LIST leg entirely, so the submit button is
            // labelled for the airdrop rather than for a recipient review.
            await main.getByRole('button', { name: 'Review airdrop' }).click();
            await expect(page.getByText('Review airdrop', { exact: true }).first())
                .toBeVisible({ timeout: 30_000 });
            expect(await page.getByText('Review address list', { exact: true }).count(),
                'the existing-list mode reached the list review, so it is about to publish a '
                + 'second list for a list that already exists')
                .toBe(0);
            expect(await page.getByText('Waiting for list to be indexed', { exact: true }).count(),
                'the existing-list mode is waiting on an indexer it has no reason to wait for')
                .toBe(0);

            await main.getByRole('button', { name: /^Sign AIRDROP/ }).click();
            await expectConfirmModal(page);
            airdropTxid = await approveAndGetTxid(page);
            await expect(page.getByRole('heading', { name: 'Airdrop sent' }))
                .toBeVisible({ timeout: 30_000 });
            // One transaction, so the done screen has no list txid to print.
            await expect(page.getByRole('main'),
                'the single-transaction mode reported a recipient-list transaction, which means '
                + 'it published one after all')
                .not.toContainText('Recipient list transaction');
        });

        await test.step('the member was paid, the held-out address was not, and the list is the old one', async () => {
            const dropped = await waitForIndexedAction(airdropTxid);
            expect(String(dropped.action)).toMatch(/^(AIRDROP|DROP)$/);
            expect(String(dropped.status), 'the chain rejected the AIRDROP').toBe('valid');
            expect(String(dropped.tick)).toBe(LIST_TICK);
            expect(String(dropped.list_action_index),
                'the AIRDROP paid a list other than the one the picker showed')
                .toBe(listIndex);

            // One recipient: the cheapest point on the per-recipient curve.
            expectPerRecipientFee(dropped, 1);

            await waitForBalance(member, LIST_TICK, AMOUNT);
            expect(await tokenBalance(heldOut, LIST_TICK),
                `${heldOut} was deliberately left off list #${listIndex} and was paid anyway`)
                .toBe(0);
            await waitForBalance(issuer, LIST_TICK, SUPPLY - AMOUNT);
        });
    });
});
