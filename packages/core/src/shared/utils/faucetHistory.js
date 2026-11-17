// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regtest faucet history: the faucet page's History list. Each request the
// page sends to the local miner is recorded with its result, under one
// localStorage key holding the newest 100 entries across every wallet; a
// reader asks for one wallet's entries.
//
// Why localStorage: a faucet send is a developer convenience on a throwaway
// regtest chain, so the list is a per-device record that never needs to
// survive a restore from seed. Reads and writes swallow storage failures
// (private windows, a full or disabled store) and a malformed value reads as
// an empty list.

export const FAUCET_HISTORY_KEY = 'xc:faucetHistory';
export const FAUCET_HISTORY_LIMIT = 100;

function readAll() {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = localStorage.getItem(FAUCET_HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
        return [];
    }
}

function writeAll(entries) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(FAUCET_HISTORY_KEY, JSON.stringify(entries));
    } catch { /* a refused write leaves the list as it was */ }
}

function isEntry(entry) {
    return Boolean(entry)
        && typeof entry === 'object'
        && typeof entry.id === 'string'
        && typeof entry.walletId === 'string'
        && typeof entry.chainId === 'string'
        && Number.isFinite(entry.at);
}

/**
 * @typedef {object} FaucetHistoryEntry
 * @property {string} id
 * @property {string} walletId
 * @property {string} [accountId]
 * @property {string} chainId
 * @property {string} amount        the amount as typed, e.g. "10"
 * @property {string} ticker        the coin ticker, e.g. "BTC"
 * @property {string} [address]     the address the miner was asked to pay
 * @property {string} [txid]        set when the miner accepted the request
 * @property {'sent' | 'failed'} status
 * @property {string} [error]       the failure in words
 * @property {number} at            when the request finished, ms since the epoch
 */

/**
 * One wallet's faucet requests, newest first.
 *
 * @param {string | null | undefined} walletId
 * @returns {FaucetHistoryEntry[]}
 */
export function readFaucetHistory(walletId) {
    if (!walletId) return [];
    return readAll()
        .filter((entry) => entry.walletId === walletId)
        .sort((a, b) => b.at - a.at);
}

/**
 * Drop one wallet's entries, as removing that wallet does; other wallets'
 * entries stay. Nothing is written when the wallet has none.
 *
 * @param {string | null | undefined} walletId
 */
export function forgetFaucetHistory(walletId) {
    if (!walletId) return;
    const all = readAll();
    const kept = all.filter((entry) => entry.walletId !== walletId);
    if (kept.length !== all.length) writeAll(kept);
}

/**
 * Record one faucet request and keep only the newest 100 entries.
 *
 * @param {Omit<FaucetHistoryEntry, 'id' | 'at'> & { at?: number }} entry
 * @returns {FaucetHistoryEntry} the stored entry
 */
export function recordFaucetRequest(entry) {
    const at = Number.isFinite(entry?.at) ? entry.at : Date.now();
    const stored = {
        ...entry,
        at,
        id: `${at}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    };
    const next = [stored, ...readAll()]
        .sort((a, b) => b.at - a.at)
        .slice(0, FAUCET_HISTORY_LIMIT);
    writeAll(next);
    return stored;
}
