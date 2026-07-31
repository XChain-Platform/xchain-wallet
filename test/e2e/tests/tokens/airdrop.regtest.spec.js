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
// end to end, for the first time in the campaign.
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
// 's second half: the indexer marks a LIST valid while silently dropping
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
    fundAddress,
    minerRpc,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** ISSUE, LIST and AIRDROP each pay a real coin fee on this chain . */
const FUNDING = 2;
const STAMP = Date.now().toString().slice(-6);
const TICK = `DRP${STAMP}`;
const SUPPLY = 1000;
/** Paid to EACH address on the list, so the drop costs 2 x this. */
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

/**
 * Onboards a fresh wallet, funds its ONLY address and issues TICK from it.
 * Returns that address, which is the token's owner, the chain's active address
 * and the only address on the wallet holding any coin.
 *
 * The token is created while the wallet still has exactly one address on
 * purpose: the recipients are generated afterwards, so the issuer stays the
 * lowest HD index and every later form that defaults to the NEWEST one is
 * visibly wrong rather than silently signing from an empty address (D-140).
 */
async function onboardAndIssue(page) {
    await createWallet(page, { password: PASSWORD, name: 'Airdrop Wallet' });
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
    await form.getByLabel('Ticker').fill(TICK);
    await form.getByLabel('Supply', { exact: true }).fill(String(SUPPLY));
    await form.getByRole('button', { name: 'Issue token', exact: true }).click();

    await expectConfirmModal(page);
    const issued = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(issued.status),
        `the venue rejected the ISSUE of ${TICK} (${issued.status}); on this chain that is `
        + 'usually the price sentinel going stale mid-run (campaign §3.2), not a wallet defect')
        .toBe('valid');
    await waitForBalance(source, TICK, SUPPLY);
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

            // D-87 / , checked on the live form and in the SAME paste that
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
            // `list_items_invalid` . Read the rows back.
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
    });
});
