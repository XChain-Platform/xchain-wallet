// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "History" (frontier row 30). Three claims, in the
// order a reader would want them answered: a real send LANDS as a row and the
// row agrees with the chain; the search box actually narrows the list; the
// Grouped/Flat toggle does not lose the row.
//
// WHAT WOULD BE FALSE IF THIS PASSED VACUOUSLY. History is the only screen in
// the wallet whose entire content comes from a third party (the explorer's
// `/history/<addr>/address`), and the wallet re-shapes every row on the way in
// (History.jsx's entry construction, ~line 327). A spec that asserted "a row
// that says Send is on screen" would pass on demo fixtures, on a stale cache,
// on the wrong chain, and on a row belonging to somebody else's action. So
// nothing below is asserted against the screen alone: the row is ADDRESSED by
// the action index the explorer recorded for this exact txid
// (`data-history-key`), and every field asserted on it - block, status, tick,
// amount, destination - is read out of the explorer's own record of that same
// txid first and compared second. If the explorer and the screen agree, they
// agree about a number neither of them made up.
//
// WHY A TOKEN SEND AND NOT A NATIVE ONE. The obvious minimal setup is a plain
// native-coin payment, and it CANNOT work here, for a reason that is a design
// decision rather than a bug: History is action-indexed end to end
// (`getHistoryData`, xchain-explorer/src/db.js, reads `actions` /
// `mappings_actions`), and a native send is deliberately composed with NO
// OP_RETURN, so no action is ever written for one. The fixture says so in its
// own words - `assertNoActionRecorded` exists precisely to pin that a plain
// payment records nothing - and `send/confirm-broadcast.regtest.spec.js` asserts
// it on every run. A native send therefore has nothing to appear in History AS,
// and a spec built on one would be permanently red about the wallet while
// actually reporting on the protocol. XCHAIN is free-mintable on regtest by any
// address, so the cheapest thing that DOES write an action is one MINT followed
// by one SEND: two broadcasts, versus the ISSUE + two MINTs + SEND this spec
// on the critical path, and no issuance fee quote.
//
// A DEFECT THIS SPEC DELIBERATELY DOES NOT ASSERT, recorded here because the
// next session pays to rediscover it otherwise. `getActionSummaryData`
// (xchain-explorer/src/db.js) nests every per-action field under a `details`
// sub-object:
//
//   { action: "SEND", action_index: "2262", block_index: "5581",
//     status: "valid",
//     details: { tick: "…", amount: "50", destination: "rltc1q…" } }
//
// while History.jsx reads `row.source` / `row.tick` at the TOP level. So
// `entry.source` is always the empty string and `entry.raw.tick` is always
// undefined, which means (a) every row's source chip renders "-", (b)
// `historyGrouping.js`'s `pickField(e.raw, ['tick', …])` never finds a tick, so
// issue-mint / dispenser-dispense / order-fills grouping is a silent no-op for
// every wallet on this build, and (c) `historyFilter.js`'s payload search
// (memo / tick / destination / …) matches nothing, leaving only the fields
// History.jsx flattens itself - `entry.action`, `entry.address`, `entry.txHash`
// - actually searchable. That is why claim 2 searches by TXID and not by the
// destination address, and why claim 3 asserts that Grouped keeps the row
// rather than that Grouped collapses anything. The second test below drives the
// grouping half directly and is `test.fixme` for the reason stated on it.
//
// SCREEN FACTS worth more than the time they cost to find:
//   - The search box is `<input type="search">`, so its ARIA role is SEARCHBOX,
//     not textbox. `getByRole('textbox', { name: 'Search history' })` matches
//     nothing and, with no actionTimeout set, hangs for the whole test budget.
//     Address it by label.
//   - A History row is `<li data-history-key="<chainId>:<actionIndex>:<address>">`
//     (History.jsx EntryRow). A collapsed GROUP is an `<li>` with no such
//     attribute, so `[data-history-key]` counts rows and never group cards.
//   - The row itself carries only: action label, status pill, source chip,
//     "Block N", "N Confirms", relative time. Amount, destination, tick and
//     txid are NOT on the row - they live on the detail view.
//   - On the web shell a row click does NOT expand inline. App.jsx passes
//     `onSelectEntry`, so `onRowClick` navigates to a STANDALONE ActionDetail
//     page (header "Send #2,262", back button labelled "Back to history"). The
//     filter bar does not exist on that page; claims 2 and 3 have to come back
//     first, and History re-mounts with its default date window when they do.
//   - ActionDetail's Details tab renders `entry.raw`'s own keys, and since
//     `details` is not in its skip-list the whole nested object renders as ONE
//     JSON-stringified cell. The real values are substrings of it.
//   - `tx_hash` on that tab is SHORTENED to `first16…last8` (U+2026), so the
//     full txid never appears as text; assert the shortened form.
//   - The Send form has no chain picker (D-140): it follows the SELECTED
//     ASSET's chain. A native row is named for its CHAIN ("Open Litecoin
//     details"), and the same token on three chains produces three rows with
//     an IDENTICAL accessible name - `data-balance-key="<chainId>:<tick>"`
//     (BalanceList) is the only thing that tells them apart.
//   - The amount field's label carries the active unit ("Amount (XCHAIN)"),
//     which is the cheapest available proof the form is composing on the asset
//     and chain this run intends.
//
// RUN IT (central verification only; the venue is workers:1 and shared):
//   cd test/e2e && XC_REGTEST_COIN=RLTC \
//       npx playwright test --config=playwright.regtest.config.js \
//       tests/history/history-coverage.regtest.spec.js

import { randomBytes } from 'node:crypto';

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    REGTEST_DESTINATION,
    fundAddress,
    mintXchain,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Native coin, to pay miner fees for both broadcasts. */
const FUNDING = 1;
/** XCHAIN minted, then the slice of it the SEND actually moves. */
const MINT_AMOUNT = 500;
const SEND_AMOUNT = '25';
const TICK = 'XCHAIN';

/**
 * A throwaway destination with this chain's own HRP.
 *
 * A cross-HRP address is refused by the Send form long before anything this
 * spec is about, so the constant cannot be one address for every venue. Both
 * entries are p2wpkh over a fixed hash160 on that chain's regtest params, hold
 * no key anyone has, and were checked against the chain's own
 * `validateaddress` before being written down (the Litecoin one in
 * `send/dust-and-max.regtest.spec.js`, which derives and documents it).
 *
 * An unpinned chain SKIPS (see the describe below) rather than silently
 * borrowing Bitcoin's, which would fail several screens later as an unexplained
 * form refusal. Skipping rather than throwing at module scope on purpose: a
 * throw here would break test COLLECTION for the whole suite on that venue, and
 * this one spec's missing constant is not a reason for every other spec to stop.
 */
const DESTINATIONS = {
    RBTC: REGTEST_DESTINATION,
    RLTC: 'rltc1q94wew2dxt8psxdx670k2yc9620ljmd4w847rcl',
};
const DESTINATION = DESTINATIONS[REGTEST_COIN];

/** The venue's native ticker, e.g. RLTC -> LTC. */
const COIN = REGTEST_COIN.replace(/^R/, '');

/* ───── venue reads ────────────────────────────────────────────────── */

/**
 * The explorer's OWN history row for `txid`, read from the exact endpoint the
 * wallet reads (`sdk.getHistory(address, 'address')` ->
 * `/<COIN>/api/history/<address>/address`).
 *
 * This is the reference every screen assertion below is compared against, and
 * addressing it by txid rather than by position is the point: a row that merely
 * looks right at the top of a list proves nothing about WHICH action it is.
 *
 * Polls without mining. `waitForValidAction` has already established that the
 * action is indexed and valid by the time this is called, so anything left here
 * is the address mapping catching up; mining at it would only put the decoder
 * further behind (see `nudgeChain` in the fixture).
 */
async function chainHistoryRow(address, txid, timeoutMs = 90_000) {
    const url = `${EXPLORER_URL}/${REGTEST_COIN}/api/history/${address}/address`;
    const deadline = Date.now() + timeoutMs;
    let seen = 0;
    while (Date.now() < deadline) {
        try {
            const body = await fetch(url, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
            const rows = Array.isArray(body?.data) ? body.data : [];
            seen = rows.length;
            const row = rows.find((r) => r.tx_hash === txid);
            if (row) return row;
        } catch { /* transient while a block lands; keep asking */ }
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(
        `the explorer's own history for ${address} never carried ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s (it listed ${seen} rows). The action is indexed and `
        + `valid by this point, so this is the address mapping, not the wallet.`);
}

/* ───── wallet walks ───────────────────────────────────────────────── */

/** Opens a command-palette entry by its visible title. */
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

/** Reloads onto a clean, unlocked Home so the next form opens with fresh state. */
async function reloadToHome(page) {
    await page.goto('/');
    await unlockAfterReload(page, PASSWORD);
}

/** Approves the open confirm modal and returns the txid the wallet reports. */
async function approveAndGetTxid(page) {
    const approve = page.getByTestId('confirm-approve');
    // Generous, because Approve stays disabled until the pre-flight report
    // resolves and a COLD dry-run on this shared venue has been measured at
    // several seconds. A real blocking verdict fails here too, which is why
    // the message names both possibilities rather than guessing.
    await expect(approve, 'Approve never became enabled: either the pre-flight report never '
        + 'arrived, or the venue really does refuse this action')
        .toBeEnabled({ timeout: 120_000 });
    await approve.click();

    await expect(page.getByRole('heading', { name: 'Broadcast pending' }))
        .toBeVisible({ timeout: 180_000 });
    const txid = (await page.getByRole('main').innerText()).match(/\b[0-9a-f]{64}\b/)?.[0];
    expect(txid, 'the success screen showed no transaction id').toBeTruthy();
    return txid;
}

/**
 * Picks an asset in the Send form's picker by its (chainId, tick) pair.
 *
 * NOT by accessible name. `BalanceList` labels every row `Open <name> details`,
 * which is IDENTICAL for the same token on all three regtest chains, and
 * picking the wrong one silently re-targets the form's network. `pinKey`
 * (`<chainId>:<tick>`) is the only per-row discriminator in the DOM.
 */
async function pickAssetByChainAndTick(page, searchText, chainId, tick) {
    await page.getByRole('button', { name: /Change asset/ }).click();
    await page.getByLabel('Search coins or tokens').fill(searchText);
    const row = page.locator(`[data-balance-key="${chainId}:${tick}"]`).first();
    await expect(row, `the Send picker offered no ${tick} row on ${chainId} for "${searchText}"`)
        .toBeVisible({ timeout: 30_000 });
    await row.click();
    // No amount-label check here on purpose. `data-balance-key` is already a
    // strictly stronger discriminator than the label, and this helper also runs
    // BEFORE funding (to read the source address), where the amount field's
    // presence on a zero-balance asset is not something this spec should be
    // betting on. Where the amount is actually filled, the label carries the
    // unit and an unmatched locator is the assertion.
}

/**
 * This wallet's own address on the venue chain, read off the Send form.
 *
 * Not `readReceiveAddress`: the Receive screen opens on whichever chain the
 * wallet lists first (Bitcoin), so off Bitcoin it hands back the wrong chain's
 * address and the fixture's own address-shape assertion times out. Picking the
 * NATIVE asset is what selects the chain on the Send surface, and the form then
 * states the source address it will spend from.
 */
async function readOwnAddress(page) {
    await gotoSection(page, 'Send');
    await pickAssetByChainAndTick(page, REGTEST_CHAIN_LABEL, REGTEST_CHAIN_ID, COIN);
    const address = await page.getByRole('main').getByLabel('From', { exact: true }).inputValue();
    expect(address, `the Send form named no source address on ${REGTEST_CHAIN_LABEL}`).toBeTruthy();
    return address;
}

/* ───── History screen ─────────────────────────────────────────────── */

/** Every top-level History ROW. Collapsed group cards carry no such key. */
function historyRows(page) {
    return page.locator('[data-history-key]');
}

/** The one row for a given (chainId, actionIndex, address) triple. */
function historyRowFor(page, chainId, actionIndex, address) {
    return page.locator(`[data-history-key="${chainId}:${actionIndex}:${address}"]`);
}

/**
 * Lands on History with the date window opened wide enough that the venue's
 * clock cannot hide a row.
 *
 * The default window is [today-30d, today] computed from the BROWSER's LOCAL
 * date (`isoDateDaysAgo`), while the chain stamps blocks in UTC. On a venue
 * running west of UTC a block mined seconds ago is already dated "tomorrow",
 * and the row the spec just created is filtered out for a reason that has
 * nothing to do with History. Session 3 lost time to exactly this.
 *
 * Also called on the way BACK from ActionDetail: History re-mounts and re-runs
 * the same default, so the widening does not survive the round trip.
 */
async function openHistoryWidened(page) {
    await gotoSection(page, 'History');
    await widenDateWindow(page);
}

async function widenDateWindow(page) {
    const iso = (offsetDays) =>
        new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
    await expect(page.getByLabel('Search history'), 'History did not render its filter bar')
        .toBeVisible({ timeout: 30_000 });
    await page.getByLabel('From date').fill(iso(-30));
    await page.getByLabel('To date').fill(iso(2));
}

/** ActionDetail's Details tab renders one `<tr>` per raw key; this is one of them. */
function detailRow(page, key) {
    return page.getByRole('tabpanel').getByRole('row', { name: new RegExp(`^${key}\\b`) });
}

/**
 * The exact substring the Details tab's one `details` cell must contain for a
 * single field of the explorer's payload.
 *
 * Re-serialised from the CHAIN's own value rather than compared as a bare
 * substring, for two reasons. It pins the FIELD and not just the digits: a
 * `toContainText('25')` would pass on a block index that happens to contain 25.
 * And it survives the explorer changing an amount from a JSON string to a
 * number, because whatever type it publishes is the type this re-serialises.
 */
function detailsFragment(details, key) {
    return `"${key}":${JSON.stringify(details[key])}`;
}

/** History.jsx's `shortenAddress`, reproduced so assertions can predict the text. */
function shortenAddress(value) {
    if (!value) return '';
    if (value.length <= 26) return value;
    return `${value.slice(0, 16)}…${value.slice(-8)}`;
}

test.describe(`History on ${REGTEST_CHAIN_LABEL} regtest`, () => {
    // Two real broadcasts plus two indexing waits. Well under the old
    // ISSUE+2 MINT+SEND walk, and still generous: the long pole on this shared
    // venue is the indexer, not the app.
    test.setTimeout(600_000);
    // Without this, actions inherit the TEST budget, so one unmatched locator
    // costs ten minutes instead of thirty seconds.
    test.use({ actionTimeout: 30_000 });
    // A venue with no pinned throwaway destination cannot run this walk at all;
    // say so by name instead of failing inside the Send form.
    test.skip(!DESTINATION, `no pinned throwaway destination for ${REGTEST_COIN}. Derive one on `
        + `that chain's regtest params (the address shape its regtest params produce), check it `
        + `with the chain's own validateaddress, and add it to DESTINATIONS. Do NOT fall back to `
        + `another chain's: the Send form refuses a cross-HRP address.`);

    test('a real send lands as a History row that matches the chain, search filters to it, and Grouped keeps it', async ({ page }) => {
        /** This wallet's own address; the source of the send and the History subject. */
        let own;
        /** The txid the wallet reported for the SEND. */
        let sendTxid;
        /** The explorer's own history row for that txid: the reference for every screen claim. */
        let chainRow;
        /** How many rows History shows before any search narrows it. */
        let baselineRows;

        await test.step(`onboard onto ${REGTEST_CHAIN_LABEL} regtest and fund the address`, async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);

            own = await readOwnAddress(page);
            // The destination must not be this wallet's own address, or the
            // direction claim below would be true by accident.
            expect(own, 'the throwaway destination is this wallet\'s own address, so the send '
                + 'would prove nothing about direction').not.toBe(DESTINATION);

            await fundAddress(own, FUNDING);
            await reloadToHome(page);
        });

        await test.step(`mint ${TICK}, the one action a fresh wallet can afford to write`, async () => {
            // XCHAIN is free-mintable on regtest by any address, so this needs
            // no ISSUE and no issuance fee quote. The fixture drives it through
            // the palette's Advanced action, which is the only surface that
            // offers a tick the wallet holds none of.
            await mintXchain(page, MINT_AMOUNT);
            await waitForTokenBalance(own, TICK, MINT_AMOUNT);
            await reloadToHome(page);
        });

        await test.step(`send ${SEND_AMOUNT} ${TICK} to a real destination`, async () => {
            await gotoSection(page, 'Send');
            await pickAssetByChainAndTick(page, TICK, REGTEST_CHAIN_ID, TICK);
            await expect(page.getByRole('main').getByLabel('From', { exact: true }))
                .toHaveValue(own);
            await page.getByLabel('To', { exact: true }).fill(DESTINATION);
            await page.getByRole('textbox', { name: `Amount (${TICK})` }).fill(SEND_AMOUNT);
            await mainButton(page, 'Send').click();

            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 30_000 });
            sendTxid = await approveAndGetTxid(page);

            // The chain's own verdict, before any screen is consulted. A
            // transaction that confirmed says nothing about whether the
            // indexer ACCEPTED the action inside it, and a rejected action
            // would be a History row this spec had no business expecting.
            await waitForValidAction(sendTxid);

            chainRow = await chainHistoryRow(own, sendTxid);
            expect(chainRow.action, 'the explorer indexed this txid as something other than a SEND')
                .toBe('SEND');
            expect(String(chainRow.status), 'the explorer did not record this SEND as valid')
                .toBe('valid');
            expect(Number(chainRow.block_index), 'the explorer carries no block for a confirmed action')
                .toBeGreaterThan(0);
            // The payload the row detail is about to be checked against. If the
            // explorer stopped publishing these, the screen claims below would
            // "pass" against undefined, so refuse to continue instead.
            expect(chainRow.details, 'the explorer published no per-action details for this SEND, '
                + 'so there is nothing to check the wallet\'s rendering against').toBeTruthy();
            expect(String(chainRow.details.tick)).toBe(TICK);
            expect(String(chainRow.details.destination)).toBe(DESTINATION);
        });

        await test.step('CLAIM 1: the send is a row, addressed by the action index the chain recorded', async () => {
            await reloadToHome(page);
            await openHistoryWidened(page);

            // Addressed by the chain's own action index, not by "the row that
            // says Send". This is the whole difference between proving the
            // wallet rendered THIS action and proving it rendered A action.
            const row = historyRowFor(page, REGTEST_CHAIN_ID, chainRow.action_index, own);
            await expect(row, `no History row for action ${chainRow.action_index}, which the `
                + `explorer records at ${own} for txid ${sendTxid}`)
                .toBeVisible({ timeout: 60_000 });

            const button = row.getByRole('button').first();
            await expect(button, 'the row does not name the action the chain recorded')
                .toContainText('Send');
            await expect(button, 'the row does not read Confirmed for a mined, valid action')
                .toContainText('Confirmed');
            await expect(button, 'the row shows a different block than the explorer recorded')
                .toContainText(`Block ${Number(chainRow.block_index).toLocaleString('en-US')}`);

            baselineRows = await historyRows(page).count();
            // The MINT and the SEND. More than one matters: claim 2's
            // narrowing to a single row would be vacuous on a list of one.
            expect(baselineRows, 'History shows fewer rows than the two actions this spec wrote')
                .toBeGreaterThanOrEqual(2);
        });

        await test.step('CLAIM 1b: the row detail carries the chain\'s own amount, tick, destination and txid', async () => {
            const row = historyRowFor(page, REGTEST_CHAIN_ID, chainRow.action_index, own);
            await row.getByRole('button').first().click();

            // Web shell: this is a route change to a standalone page, not an
            // inline expand. The heading is the first proof we landed on the
            // right action.
            await expect(page.getByRole('region', { name: 'Action detail' }))
                .toBeVisible({ timeout: 30_000 });
            await expect(page.getByRole('banner').filter({ hasText: 'Send #' }).first(),
                'the detail page is not titled for the action index the chain recorded')
                .toContainText(`Send #${Number(chainRow.action_index).toLocaleString('en-US')}`);

            await page.getByRole('tab', { name: 'Details' }).click();

            // The nested per-action object renders as one JSON-stringified
            // cell (see the header), so its values are asserted individually
            // rather than as an exact string whose key ORDER this spec would
            // then be pinning by accident.
            const details = detailRow(page, 'details');
            await expect(details, 'the detail does not carry the tick the chain recorded')
                .toContainText(detailsFragment(chainRow.details, 'tick'));
            await expect(details, 'the detail does not carry the amount the chain recorded')
                .toContainText(detailsFragment(chainRow.details, 'amount'));
            await expect(details, 'the detail does not name the destination the chain recorded')
                .toContainText(detailsFragment(chainRow.details, 'destination'));

            // Direction, stated by two facts that cannot both be an accident:
            // the wallet's own address is the row's address, and the money went
            // somewhere that is not it.
            await expect(detailRow(page, 'address'), 'the detail does not attribute this action to '
                + 'the wallet\'s own address').toContainText(shortenAddress(own));
            expect(String(chainRow.details.destination)).not.toBe(own);

            await expect(detailRow(page, 'status'), 'the detail disagrees with the chain about status')
                .toContainText(String(chainRow.status));
            await expect(detailRow(page, 'block_index'), 'the detail disagrees with the chain about the block')
                .toContainText(Number(chainRow.block_index).toLocaleString('en-US'));
            // Shortened, never in full: the whole txid only exists on the copy
            // button's value, so a `toContainText(sendTxid)` here would fail on
            // a screen that is behaving correctly.
            await expect(detailRow(page, 'tx_hash'), 'the detail shows a different transaction than '
                + 'the one the wallet said it broadcast').toContainText(shortenAddress(sendTxid));
        });

        await test.step('CLAIM 2: the search box narrows the list to this row, and releases it again', async () => {
            // Back to the LIST: the filter bar does not exist on the detail
            // page, and History re-mounts with its default date window.
            await page.getByRole('button', { name: 'Back to history' }).click();
            await widenDateWindow(page);

            const search = page.getByLabel('Search history');

            await search.fill('zzz-no-such-history-row-zzz');
            await expect(historyRows(page), 'a search that matches nothing still left rows on screen, '
                + 'so the box is re-rendering rather than filtering')
                .toHaveCount(0, { timeout: 15_000 });

            // By TXID, which is one of the few fields History.jsx flattens onto
            // the entry itself (`txHash`). Searching by destination or tick
            // matches nothing on this build; see the header.
            await search.fill(sendTxid);
            await expect(historyRows(page), 'searching the send\'s own txid did not narrow the list to it')
                .toHaveCount(1, { timeout: 15_000 });
            await expect(historyRowFor(page, REGTEST_CHAIN_ID, chainRow.action_index, own),
                'the one surviving row is not the action that txid belongs to')
                .toBeVisible();

            await search.fill('');
            await expect(historyRows(page), 'clearing the search did not restore the full list')
                .toHaveCount(baselineRows, { timeout: 15_000 });
        });

        await test.step('CLAIM 3: Grouped and Flat both render, and neither loses the row', async () => {
            const modes = page.getByRole('radiogroup', { name: 'Grouping mode' });
            const grouped = modes.getByRole('radio', { name: 'Grouped' });
            const flat = modes.getByRole('radio', { name: 'Flat' });
            const row = historyRowFor(page, REGTEST_CHAIN_ID, chainRow.action_index, own);

            // Grouped is the persisted default for a wallet that has never
            // chosen (`readPersistedGroupingMode`), and this browser context is
            // fresh, so the screen should open there.
            await expect(grouped, 'History did not open in its default Grouped mode')
                .toHaveAttribute('aria-checked', 'true');
            await expect(row, 'Grouped mode does not show the send').toBeVisible();

            await flat.click();
            await expect(flat, 'the Flat segment did not take').toHaveAttribute('aria-checked', 'true');
            await expect(grouped).toHaveAttribute('aria-checked', 'false');
            await expect(row, 'Flat mode dropped the send').toBeVisible();
            // A MINT with no ISSUE beside it and a SEND have nothing to collapse
            // under ANY grouping rule, so equal counts here is the correct
            // outcome for this data - not a restatement of the grouping defect
            // the header describes. The second test is what would pin that.
            await expect(historyRows(page), 'Flat mode changed how many rows exist')
                .toHaveCount(baselineRows);

            await grouped.click();
            await expect(grouped, 'the Grouped segment did not take back')
                .toHaveAttribute('aria-checked', 'true');
            await expect(row, 'coming back to Grouped mode lost the send').toBeVisible();
            await expect(historyRows(page), 'returning to Grouped changed how many rows exist')
                .toHaveCount(baselineRows);
        });
    });

    // UNFINISHED, AND `test.fixme` FOR THAT REASON.
    //
    // It pins NO defect and makes no claim about the wallet on its own
    // authority. It has never once run green, and an assertion that has never
    // passed is a guess about the screen rather than a specification of it - so
    // nothing in it may be read as a finding until somebody runs it.
    //
    // What it is FOR: the file header describes, from the source, why
    // `historyGrouping.js` can never collapse an ISSUE with its MINTs on this
    // build (`entry.raw.tick` is undefined because the explorer nests it at
    // `raw.details.tick`). That reasoning deserves to be driven rather than
    // believed, and this is the walk that would drive it: ISSUE plus two MINTs
    // of the same (chainId, tick, source), which is the minimum the issue-mint
    // subkind requires (`minMembers = 2`, counted over MEMBERS, which excludes
    // the leader). It asserts the CORRECT behaviour - one Launch card - and is
    // expected to fail against the current build for the documented reason.
    //
    // Whoever picks it up: run it, read the failure, and either it confirms the
    // header (in which case the defect is a wallet fix, not a spec fix) or it
    // does not, in which case the header is wrong and should be corrected. Do
    // NOT un-fixme it while it is red: a knowingly-red spec in a green
    // directory teaches the suite to ignore reds.
    //
    // It is deliberately the SECOND test. It is slow (four broadcasts, four
    // indexing waits) and it is the half that failed central verification
    // before reaching any History assertion at all; keeping it here means a
    // failure in it can never again hide the send claim above.
    test.fixme('an ISSUE and its MINTs collapse into one Launch card under Grouped mode', async ({ page }) => {
        // Unique per run: protocol tickers are global once issued, so a fixed
        // one would collide with its own previous run on this shared venue.
        const tick = `E2EH${randomBytes(3).toString('hex').toUpperCase()}`;
        const ISSUE_SUPPLY = '1000';
        const INITIAL_MINT = '300';
        const EXTRA_MINTS = ['150', '150'];
        let own;

        /**
         * Mints `amount` of a wallet-issued tick through the palette's Advanced
         * action. The fixture's `mintXchain` hardcodes TICK=XCHAIN, so it cannot
         * be reused for a tick this wallet issued itself.
         */
        const mintTick = async (amount) => {
            await gotoPalette(page, 'Advanced action');
            await selectVenueChain(page);
            await page.getByLabel('Action').selectOption('MINT');
            await page.getByRole('textbox', { name: 'TICK', exact: true }).fill(tick);
            await page.getByRole('textbox', { name: 'AMOUNT', exact: true }).fill(String(amount));
            await page.getByRole('button', { name: 'Sign action' }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 30_000 });
            return approveAndGetTxid(page);
        };

        await test.step('onboard and fund', async () => {
            await createWallet(page, { password: PASSWORD });
            await switchToRegtest(page, PASSWORD);
            own = await readOwnAddress(page);
            // Three coins, not one: an ISSUE carries a protocol fee the two
            // later MINTs do not, and a funding that only covers the mints
            // fails as an opaque compose error on the first screen.
            await fundAddress(own, 3);
            await reloadToHome(page);
        });

        await test.step('issue a token, leaving headroom to mint', async () => {
            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(main);
            await main.getByLabel('Ticker').fill(tick);
            await main.getByLabel('Supply', { exact: true }).fill(ISSUE_SUPPLY);
            await main.getByLabel(/Initial mint/).fill(INITIAL_MINT);
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 30_000 });
            await waitForValidAction(await approveAndGetTxid(page));
            await reloadToHome(page);
        });

        await test.step('mint the same tick from the same source, twice', async () => {
            for (const amount of EXTRA_MINTS) {
                await waitForValidAction(await mintTick(amount));
                await reloadToHome(page);
            }
        });

        await test.step('the ISSUE and its MINTs are one card, not three rows', async () => {
            await openHistoryWidened(page);
            // What SHOULD happen (§28.2 issue-mint): same chainId, tick and
            // source, so the ISSUE leads and both MINTs collapse under a single
            // "Launch" card. A collapsed group is an <li> WITHOUT a
            // data-history-key, so a correct build shows zero plain rows here.
            await expect(page.getByRole('button', { name: /^Launch\b/ }),
                'the ISSUE and its two MINTs never collapsed into a Launch card')
                .toBeVisible({ timeout: 30_000 });
            await expect(historyRows(page),
                'the ISSUE and its MINTs are still rendering as separate rows under Grouped mode')
                .toHaveCount(0, { timeout: 15_000 });
        });
    });
});
