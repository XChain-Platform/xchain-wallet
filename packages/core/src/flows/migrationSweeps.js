// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Migrate-to-BIP39 sweep list, kept outside the wizard screen.
//
// After the new BIP39 wallet is saved, the wizard lists one sweep per legacy
// address. Each sweep opens on its own screen, so the list has to outlive the
// wizard: Back or Done from a sweep returns to it with that row marked, and
// the legacy wallet offers it again until every row is swept or the user
// dismisses it. Without this record the only way back is to upgrade again,
// which makes another phrase and another wallet.
//
// The record holds addresses, wallet ids, chain ids, txids and flags only:
// never a phrase, a password or a key. It lives in localStorage keyed by the
// legacy wallet id (the same per-device, non-secret store as the backup
// reminder), and the wallet removal and wipe paths clear it.

import { logConsole } from '../shared/utils/logConsole.js';

/** localStorage key of the map from legacy wallet id to its migration record. */
export const MIGRATION_SWEEPS_STORAGE_KEY = 'xc:migrationSweeps';

let memoryStore = null;
let storageFailureLogged = false;

/**
 * @typedef {Object} MigrationSweepRow
 * @property {string} chainId
 * @property {string} fromAddress     legacy address the sweep empties
 * @property {string | null} toAddress matching address in the new wallet
 * @property {boolean} swept
 * @property {string} [txid]          broadcast txid of the sweep
 */

/**
 * @typedef {Object} MigrationSweepRecord
 * @property {string} newWalletId
 * @property {boolean} listed         the address list has been written at least once
 * @property {MigrationSweepRow[]} rows
 */

function readAll() {
    if (memoryStore) return structuredCloneMap(memoryStore);
    try {
        const raw = globalThis.localStorage?.getItem(MIGRATION_SWEEPS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function structuredCloneMap(map) {
    return JSON.parse(JSON.stringify(map));
}

function announce() {
    try {
        if (typeof globalThis.dispatchEvent !== 'function'
            || typeof globalThis.StorageEvent !== 'function') return;
        globalThis.dispatchEvent(new globalThis.StorageEvent('storage', { key: MIGRATION_SWEEPS_STORAGE_KEY }));
    } catch { /* storage event unavailable; best-effort */ }
}

function writeAll(map) {
    const empty = Object.keys(map).length === 0;
    try {
        const storage = globalThis.localStorage;
        if (!storage) throw new Error('no localStorage');
        if (empty) storage.removeItem(MIGRATION_SWEEPS_STORAGE_KEY);
        else storage.setItem(MIGRATION_SWEEPS_STORAGE_KEY, JSON.stringify(map));
        memoryStore = null;
    } catch {
        memoryStore = structuredCloneMap(map);
        if (!storageFailureLogged) {
            storageFailureLogged = true;
            logConsole.record({
                source: 'migration-sweeps',
                level: 'warn',
                message: 'local storage write failed; using in-memory state',
            });
        }
    }
    // Same-document writes emit no native storage event; this lets an open
    // Home alert or wallet screen react.
    announce();
}

function validId(value) {
    return typeof value === 'string' && value.length > 0;
}

function normalizeRecord(record) {
    if (!record || typeof record !== 'object' || !validId(record.newWalletId)) return null;
    const rows = Array.isArray(record.rows)
        ? record.rows
            .filter((row) => row && validId(row.chainId) && validId(row.fromAddress))
            .map((row) => ({
                chainId: row.chainId,
                fromAddress: row.fromAddress,
                toAddress: validId(row.toAddress) ? row.toAddress : null,
                swept: row.swept === true,
                ...(validId(row.txid) ? { txid: row.txid } : {}),
            }))
        : [];
    return {
        newWalletId: record.newWalletId,
        listed: record.listed === true,
        rows,
    };
}

/**
 * The migration record of one legacy wallet, or null when none is kept.
 *
 * @param {string} legacyWalletId
 * @returns {MigrationSweepRecord | null}
 */
export function readMigrationSweeps(legacyWalletId) {
    if (!validId(legacyWalletId)) return null;
    return normalizeRecord(readAll()[legacyWalletId]);
}

/**
 * The record while it still has work for the user: its list was never
 * written (the wizard closed before the addresses loaded) or a row is still
 * unswept.
 *
 * @param {string} legacyWalletId
 * @returns {MigrationSweepRecord | null}
 */
export function pendingMigrationSweeps(legacyWalletId) {
    const record = readMigrationSweeps(legacyWalletId);
    if (!record) return null;
    if (record.listed && !record.rows.some((row) => !row.swept)) return null;
    return record;
}

/**
 * Start a fresh record once the new wallet is saved. Any older record for the
 * same legacy wallet belongs to an earlier upgrade and is replaced.
 *
 * @param {string} legacyWalletId
 * @param {string} newWalletId
 */
export function recordMigration(legacyWalletId, newWalletId) {
    if (!validId(legacyWalletId) || !validId(newWalletId)) return;
    const map = readAll();
    map[legacyWalletId] = { newWalletId, listed: false, rows: [] };
    writeAll(map);
}

/**
 * Write the sweep list the wizard derived from the live addresses. Rows
 * already swept keep their mark and txid; a swept row the live list no
 * longer offers stays so the user still sees it was moved.
 *
 * @param {string} legacyWalletId
 * @param {string} newWalletId
 * @param {Array<{ chainId: string, fromAddress: string, toAddress?: string | null }>} rows
 */
export function setMigrationRows(legacyWalletId, newWalletId, rows) {
    if (!validId(legacyWalletId) || !validId(newWalletId) || !Array.isArray(rows)) return;
    const map = readAll();
    const current = normalizeRecord(map[legacyWalletId]);
    if (current && current.newWalletId !== newWalletId) return;
    const previous = new Map((current?.rows || []).map((row) => [`${row.chainId}\n${row.fromAddress}`, row]));
    const next = [];
    const seen = new Set();
    for (const row of rows) {
        if (!row || !validId(row.chainId) || !validId(row.fromAddress)) continue;
        const key = `${row.chainId}\n${row.fromAddress}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const before = previous.get(key);
        next.push({
            chainId: row.chainId,
            fromAddress: row.fromAddress,
            toAddress: validId(row.toAddress) ? row.toAddress : null,
            swept: before?.swept === true,
            ...(before?.txid ? { txid: before.txid } : {}),
        });
    }
    for (const [key, row] of previous) {
        if (!seen.has(key) && row.swept) next.push(row);
    }
    map[legacyWalletId] = {
        newWalletId,
        listed: true,
        rows: next,
    };
    writeAll(map);
}

/**
 * Mark one legacy address swept after its sweep broadcast. A sweep into any
 * wallet other than the record's destination leaves the record alone.
 *
 * @param {string} legacyWalletId
 * @param {{ newWalletId: string, chainId: string, fromAddress: string, txid?: string | null }} sweep
 * @returns {boolean} whether a row was marked
 */
export function markMigrationSwept(legacyWalletId, { newWalletId, chainId, fromAddress, txid } = {}) {
    if (!validId(legacyWalletId) || !validId(chainId) || !validId(fromAddress)) return false;
    const map = readAll();
    const current = normalizeRecord(map[legacyWalletId]);
    if (!current || current.newWalletId !== newWalletId) return false;
    let row = current.rows.find((r) => r.chainId === chainId && r.fromAddress === fromAddress);
    if (!row) {
        row = { chainId, fromAddress, toAddress: null, swept: false };
        current.rows.push(row);
    }
    row.swept = true;
    if (validId(txid)) row.txid = txid;
    map[legacyWalletId] = current;
    writeAll(map);
    return true;
}

/**
 * Stop offering the list from the legacy wallet. The record goes, so the
 * next upgrade starts a fresh one.
 *
 * @param {string} legacyWalletId
 */
export function dismissMigrationSweeps(legacyWalletId) {
    if (!validId(legacyWalletId)) return;
    const map = readAll();
    if (!Object.prototype.hasOwnProperty.call(map, legacyWalletId)) return;
    delete map[legacyWalletId];
    writeAll(map);
}

/**
 * Drop every record that names the wallet, as the legacy wallet or as the
 * sweep destination, or every record when no id is given.
 *
 * @param {string | null} [walletId]
 */
export function clearMigrationSweeps(walletId = null) {
    if (!validId(walletId)) {
        memoryStore = null;
        try { globalThis.localStorage?.removeItem(MIGRATION_SWEEPS_STORAGE_KEY); } catch { /* best-effort cleanup */ }
        return;
    }
    const map = readAll();
    let changed = false;
    for (const [legacyId, record] of Object.entries(map)) {
        if (legacyId === walletId || record?.newWalletId === walletId) {
            delete map[legacyId];
            changed = true;
        }
    }
    if (changed) writeAll(map);
}

/**
 * Subscribe to record changes from this tab or another one.
 *
 * @param {() => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribeMigrationSweeps(onChange) {
    if (typeof globalThis.addEventListener !== 'function') return () => {};
    const onStorage = (event) => {
        if (event?.key === MIGRATION_SWEEPS_STORAGE_KEY || event?.key === null) onChange();
    };
    globalThis.addEventListener('storage', onStorage);
    return () => globalThis.removeEventListener('storage', onStorage);
}
