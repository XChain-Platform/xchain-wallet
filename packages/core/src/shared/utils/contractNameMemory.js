// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Local contract labels, keyed by chainId + contract action_index.
//
// The protocol has no name field for contracts: the DEPLOY wire string is
// VERSION|CODE|GAS_LIMIT (plus the staking fields on v1+), and the explorer's
// contract rows carry no name column, so a contract is identified on chain by
// its action index alone. The deploy form still asks for a Name because a list
// of "#1418, #1422, #1901" is unusable, and that label has to live somewhere:
// this module is that somewhere. It is a note the user writes to themselves
// about a contract, stored on this device, and every surface that shows a
// contract reads it here.
//
// TWO KEYS, and the second one exists because of a timing gap. A contract's
// action_index is only knowable once the indexer has read the transaction, and
// the single-leg deploy lane does not wait for that (the host registers
// `action.deploy` with no waitForTxid, so its result carries a txid and
// nothing else). Writing the name at deploy success therefore has to be able
// to file it under the TXID and have it found later. So:
//
//   byIndex[actionIndex] - the settled label, what every read wants;
//   byTxid[txid]         - a label waiting for its action index.
//
// `mergeContractNames` promotes a byTxid entry to byIndex the first time it
// sees a row carrying both, which is the only moment the two identities are
// known together. Until that happens the label still resolves, through the
// txid, so a freshly deployed contract shows its name on the very next list
// load rather than after some indeterminate settling period.
//
// Why localStorage rather than the vault: this is per-device UI convenience,
// the same class as the last-view and chain-filter memories. A user restoring
// from seed onto a new device gets the chain's own truth (contract numbers)
// and can re-label; nothing about their funds or history depends on it.

const NS = 'xc:contractNames:';

// Labels are shown inline in list rows and page headings; anything longer is
// the user pasting something by accident, not naming a contract.
export const MAX_CONTRACT_NAME_LENGTH = 64;

// Per-chain cap. Entries are only created by an explicit user action (a deploy
// or a rename), so this is a backstop against a pathological store rather than
// an expected pressure. Oldest-first eviction by write time.
const MAX_ENTRIES_PER_CHAIN = 500;

function safeGet(chainId) {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(NS + chainId);
    } catch { return null; }
}

function safeSet(chainId, value) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(NS + chainId, value);
    } catch { /* noop */ }
}

function safeRemove(chainId) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(NS + chainId);
    } catch { /* noop */ }
}

/** A stored label: a non-empty trimmed string within the length cap, or null. */
function cleanName(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, MAX_CONTRACT_NAME_LENGTH);
}

function cleanBucket(raw) {
    /** @type {Record<string, { name: string, ts: number }>} */
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [key, entry] of Object.entries(raw)) {
        if (!key) continue;
        // Accept both the record shape and a bare string, so a hand-edited or
        // older store still reads rather than being thrown away wholesale.
        const name = cleanName(typeof entry === 'string' ? entry : entry && entry.name);
        if (!name) continue;
        const ts = Number(entry && entry.ts);
        out[key] = { name, ts: Number.isFinite(ts) ? ts : 0 };
    }
    return out;
}

/**
 * The whole label store for one chain. Missing or unparseable storage reads as
 * empty buckets, so every caller can treat "nothing stored" and "storage is
 * unavailable" the same way.
 *
 * @param {string | null | undefined} chainId
 * @returns {{ byIndex: Record<string, { name: string, ts: number }>,
 *             byTxid: Record<string, { name: string, ts: number }> }}
 */
export function readContractNames(chainId) {
    if (typeof chainId !== 'string' || !chainId) return { byIndex: {}, byTxid: {} };
    const raw = safeGet(chainId);
    if (typeof raw !== 'string' || !raw) return { byIndex: {}, byTxid: {} };
    try {
        const parsed = JSON.parse(raw);
        return {
            byIndex: cleanBucket(parsed && parsed.byIndex),
            byTxid: cleanBucket(parsed && parsed.byTxid),
        };
    } catch { return { byIndex: {}, byTxid: {} }; }
}

function evict(bucket) {
    const keys = Object.keys(bucket);
    if (keys.length <= MAX_ENTRIES_PER_CHAIN) return bucket;
    keys.sort((a, b) => (bucket[a].ts || 0) - (bucket[b].ts || 0));
    /** @type {Record<string, { name: string, ts: number }>} */
    const out = {};
    for (const key of keys.slice(keys.length - MAX_ENTRIES_PER_CHAIN)) out[key] = bucket[key];
    return out;
}

function writeStore(chainId, store) {
    const byIndex = evict(store.byIndex);
    const byTxid = evict(store.byTxid);
    if (Object.keys(byIndex).length === 0 && Object.keys(byTxid).length === 0) {
        safeRemove(chainId);
        return;
    }
    safeSet(chainId, JSON.stringify({ byIndex, byTxid }));
}

/**
 * Set (or clear) the label for one contract, keyed by its action index. This
 * is the Rename path; a blank name removes the label rather than storing an
 * empty string, so the contract falls back to whatever the chain says.
 *
 * @param {{ chainId: string, actionIndex: string | number, name: string | null }} args
 * @returns {string | null} the label as stored, or null when cleared
 */
export function setContractName({ chainId, actionIndex, name }) {
    if (typeof chainId !== 'string' || !chainId) return null;
    const key = String(actionIndex ?? '');
    if (!key) return null;
    const store = readContractNames(chainId);
    const clean = cleanName(name);
    if (clean) store.byIndex[key] = { name: clean, ts: Date.now() };
    else delete store.byIndex[key];
    writeStore(chainId, store);
    return clean;
}

/**
 * File the name the user typed on the deploy form.
 *
 * Called on deploy success, where the action index is usually NOT yet known
 * (the single-leg lane returns before the indexer answers). Pass whatever is
 * known: with an action index the label settles immediately, with only a txid
 * it waits in the txid bucket for `mergeContractNames` to promote it.
 *
 * @param {{ chainId: string, actionIndex?: string | number | null,
 *           txid?: string | null, name: string | null }} args
 * @returns {boolean} whether anything was stored
 */
export function recordDeployedContractName({ chainId, actionIndex, txid, name }) {
    if (typeof chainId !== 'string' || !chainId) return false;
    const clean = cleanName(name);
    if (!clean) return false;
    const idx = actionIndex === undefined || actionIndex === null ? '' : String(actionIndex);
    const tx = typeof txid === 'string' ? txid.trim() : '';
    if (!idx && !tx) return false;
    const store = readContractNames(chainId);
    const ts = Date.now();
    if (idx) store.byIndex[idx] = { name: clean, ts };
    // Keep the txid entry even when the index is known: the two identities
    // agree here, and a row that only carries one of them still resolves.
    if (tx) store.byTxid[tx] = { name: clean, ts };
    writeStore(chainId, store);
    return true;
}

/**
 * The stored label for one contract, or null. Pure: it looks the contract up
 * by index, then by txid, and changes nothing. Rendering calls this.
 *
 * @param {{ chainId: string, actionIndex?: string | number | null,
 *           txid?: string | null,
 *           store?: { byIndex: object, byTxid: object } }} args
 *   Pass `store` to look several contracts up against one read.
 * @returns {string | null}
 */
export function contractNameFor({ chainId, actionIndex, txid, store }) {
    const s = store || readContractNames(chainId);
    const idx = actionIndex === undefined || actionIndex === null ? '' : String(actionIndex);
    if (idx && s.byIndex[idx]) return s.byIndex[idx].name;
    const tx = typeof txid === 'string' ? txid.trim() : '';
    if (tx && s.byTxid[tx]) return s.byTxid[tx].name;
    return null;
}

/**
 * Attach stored labels to indexer rows, promoting any txid-keyed label to its
 * now-known action index.
 *
 * Every row comes back with a `localName` (null when unlabelled) so the
 * renderers stay pure and the search filter has one field to match on. Rows
 * are copied, never mutated in place.
 *
 * @param {string} chainId
 * @param {any[]} rows           indexer rows (contracts, or interaction rows)
 * @returns {any[]}
 */
export function mergeContractNames(chainId, rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (typeof chainId !== 'string' || !chainId || list.length === 0) return list;
    const store = readContractNames(chainId);
    if (Object.keys(store.byIndex).length === 0 && Object.keys(store.byTxid).length === 0) {
        return list.map((row) => ({ ...row, localName: null }));
    }
    let promoted = false;
    const out = list.map((row) => {
        const actionIndex = row && (row.action_index ?? row.contract_action_index
            ?? row.ACTION_INDEX ?? row.CONTRACT_ACTION_INDEX);
        const txid = row && (row.tx_hash ?? row.txid ?? row.TX_HASH);
        const idx = actionIndex === undefined || actionIndex === null ? '' : String(actionIndex);
        const tx = typeof txid === 'string' ? txid.trim() : '';
        let localName = idx && store.byIndex[idx] ? store.byIndex[idx].name : null;
        if (!localName && tx && store.byTxid[tx]) {
            localName = store.byTxid[tx].name;
            // First sighting of both identities together: settle the label
            // under the index so it survives the txid entry being evicted.
            if (idx) {
                store.byIndex[idx] = { name: localName, ts: store.byTxid[tx].ts || Date.now() };
                delete store.byTxid[tx];
                promoted = true;
            }
        }
        return { ...row, localName };
    });
    if (promoted) writeStore(chainId, store);
    return out;
}

/** Drop every label stored for one chain. */
export function clearContractNames(chainId) {
    if (typeof chainId !== 'string' || !chainId) return;
    safeRemove(chainId);
}
