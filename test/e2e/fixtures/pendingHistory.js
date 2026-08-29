// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared ground for the specs that drive PENDING history on a regtest venue.
//
// These started as locals inside pending-lifecycle.regtest.spec.js and moved
// here when a second spec needed them, for one reason worth stating: two specs
// that assert on the same screen must not hold two ideas of what a pending row
// IS. A row's key shape (`pending:<chainId>:<lowercased hash>`) is a contract
// with the wallet's own merge, and a copy of it in a second file would keep
// passing for months after the real one changed.
//
// What is deliberately NOT here: anything carrying a spec's own password,
// budget, or narrative. Those stay local, because they are choices a spec
// makes rather than facts about the app.

import {
    explorerJson,
    minerRpc,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
} from './regtest.js';
import { expect, gotoSection } from './wallet.js';

/** The venue's native ticker, e.g. RLTC -> LTC. */
export const NATIVE_COIN = REGTEST_COIN.replace(/^R/, '');

/* ───── venue probes ───────────────────────────────────────────────── */

/**
 * The probe for "the chain did not move", and deliberately NOT the explorer's
 * `chain_tip`: that is the INDEXER's tip, which keeps climbing for a while
 * after a mining flurry as the indexer catches up, so an assertion built on it
 * would fail on a perfectly parked miner. The miner's own counter is the
 * direct measurement, it also counts explicit `generate_blocks` calls (which
 * is what makes it useful - a neighbour or the price keeper mining into this
 * window is exactly the interference worth catching), and nothing else on a
 * regtest chain produces blocks.
 */
export async function blocksMined() {
    const status = await minerRpc('status', {});
    const n = Number(status?.blocks_mined);
    expect(Number.isFinite(n), 'the venue miner published no blocks_mined counter, so this spec '
        + 'cannot prove the chain stayed still while it asserted on a pending row').toBe(true);
    return n;
}

/**
 * Waits for the EXPLORER'S OWN mempool to carry `txid`, without mining.
 *
 * The independent half of any pending claim: the wallet saying "pending" is
 * the wallet reporting on itself, and this is the venue reporting that a node
 * is holding the same transaction. Deliberately reads the unfiltered
 * `/api/mempool` window rather than the address-filtered form the wallet uses,
 * so a failure here means "no mempool row exists" rather than "the address
 * prefilter missed it", which are different bugs in different repos.
 *
 * The 210s default: the measured worst case from broadcast to first sighting
 * is ~85s (spec §1, "Timing floor"), and this is 2.5x that. It is the same
 * shape as M2.2's own 180s `NETWORK_SEEN_WINDOW_MS`, leaving room for a
 * decoder that is a poll behind on a shared venue without leaving room for a
 * decoder that is simply not working.
 */
export async function waitForMempoolRow(txid, timeoutMs = 210_000) {
    const deadline = Date.now() + timeoutMs;
    let seen = 0;
    while (Date.now() < deadline) {
        try {
            const body = await explorerJson('mempool');
            const rows = Array.isArray(body?.data) ? body.data : [];
            seen = rows.length;
            const row = rows.find((r) => String(r.tx_hash).toLowerCase() === txid.toLowerCase());
            if (row) return row;
        } catch { /* transient; the explorerJson throw names a real refusal */ }
        await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new Error(
        `the explorer's own mempool never carried ${txid} within ${Math.round(timeoutMs / 1000)}s `
        + `(it listed ${seen} rows on the last read). The miner is held, so the transaction cannot `
        + `have been mined out from under this wait: either the ${REGTEST_COIN} decoder is not `
        + 'polling its node (it is the platform\'s only mempool store) or the node never accepted '
        + 'the broadcast.');
}

/**
 * The explorer's own history row for `txid`, polled WITHOUT mining.
 *
 * Callers reach here only once the action is known indexed and valid, so
 * anything left is the address mapping catching up, and mining at it would put
 * the decoder further behind.
 */
export async function chainHistoryRow(address, txid, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    let seen = 0;
    while (Date.now() < deadline) {
        try {
            const body = await explorerJson(`history/${address}/address`);
            const rows = Array.isArray(body?.data) ? body.data : [];
            seen = rows.length;
            const row = rows.find((r) => String(r.tx_hash).toLowerCase() === txid.toLowerCase());
            if (row) return row;
        } catch { /* transient while a block lands; keep asking */ }
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(
        `the explorer's own history for ${address} never carried ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s (it listed ${seen} rows). The action is indexed and `
        + 'valid by this point, so this is the address mapping, not the wallet.');
}

/* ───── wallet walks ───────────────────────────────────────────────── */

/**
 * Picks an asset in the Send form's picker by its (chainId, tick) pair.
 *
 * NOT by accessible name: `BalanceList` labels every row `Open <name> details`,
 * which is IDENTICAL for the same token on all three regtest chains, and
 * picking the wrong one silently re-targets the form's network.
 * `data-balance-key` is the only per-row discriminator in the DOM.
 */
export async function pickAssetByChainAndTick(page, searchText, chainId, tick) {
    await page.getByRole('button', { name: /Change asset/ }).click();
    await page.getByLabel('Search coins or tokens').fill(searchText);
    const row = page.locator(`[data-balance-key="${chainId}:${tick}"]`).first();
    await expect(row, `the Send picker offered no ${tick} row on ${chainId} for "${searchText}"`)
        .toBeVisible({ timeout: 30_000 });
    await row.click();
}

/**
 * This wallet's own address on the venue chain, read off the Send form.
 *
 * Not `readReceiveAddress`: the Receive screen opens on whichever chain the
 * wallet lists first (Bitcoin), so off Bitcoin it hands back the wrong chain's
 * address. Picking the NATIVE asset is what selects the chain on Send, and the
 * form then states the source address it will spend from.
 */
export async function readOwnAddress(page) {
    await gotoSection(page, 'Send');
    await pickAssetByChainAndTick(page, REGTEST_CHAIN_LABEL, REGTEST_CHAIN_ID, NATIVE_COIN);
    const address = await page.getByRole('main').getByLabel('From', { exact: true }).inputValue();
    expect(address, `the Send form named no source address on ${REGTEST_CHAIN_LABEL}`).toBeTruthy();
    return address;
}

/** Approves the open confirm modal and returns the txid the wallet reports. */
export async function approveAndGetTxid(page) {
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

/* ───── History screen ─────────────────────────────────────────────── */

/** Every top-level History ROW. Collapsed group cards carry no such key. */
export function historyRows(page) {
    return page.locator('[data-history-key]');
}

/** The pending row for a tx hash: `pendingKeyFor(chainId, txHash)`. */
export function pendingRowFor(page, txid) {
    return page.locator(`[data-history-key="pending:${REGTEST_CHAIN_ID}:${txid.toLowerCase()}"]`);
}

/** The confirmed row for a (chainId, actionIndex, address) triple. */
export function confirmedRowFor(page, actionIndex, address) {
    return page.locator(`[data-history-key="${REGTEST_CHAIN_ID}:${actionIndex}:${address}"]`);
}

/**
 * Narrows History to one transaction, by txid.
 *
 * The txid is the one field that reads identically off a pending entry and a
 * confirmed one, so it is the only search term that can ask "how many rows
 * does this transaction have" across the confirmation boundary. Everything
 * else about the entry (its key, its action index, its block) changes
 * underneath.
 *
 * There is NO date widening here, deliberately: the default window is part of
 * what these specs are asserting.
 */
export async function searchForTx(page, txid) {
    const search = page.getByLabel('Search history');
    await expect(search, 'History did not render its filter bar').toBeVisible({ timeout: 60_000 });
    await search.fill(txid);
    return search;
}
