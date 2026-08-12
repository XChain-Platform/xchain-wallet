// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Taproot envelope commit-recovery records (§3.5).
//
// §3.5, verbatim on the requirement: "Before broadcasting a commit, the wallet
// durably persists {commit outpoint, internal key derivation path, tapleaf
// hash}. Cancel must be reconstructible from persisted state alone", surviving a
// crash between commit and reveal. The reason is unforgiving: the key-path
// cancel needs the internal key plus the tapleaf hash to reconstruct the tweak,
// and without them the funds sit in an address the wallet cannot re-derive.
//
// THIS MODULE DELIBERATELY BREAKS THE HOUSE PATTERN IN ONE WAY. Its siblings
// (activeAccountMemory, lastViewMemory, ...) swallow every storage error,
// because losing a UI preference is harmless and a throw would be worse. Here
// the opposite is true: a silently dropped write means the caller believes the
// record is safe, broadcasts the commit, and strands the coin. So writes FAIL
// LOUDLY and the caller must not broadcast unless the write returned.
//
// NO SECRETS ARE STORED. The derivation PATH is not the key; the tapleaf hash,
// outpoint, address and value are all public the moment the reveal is on chain.
// Anyone holding this record and not the seed can do nothing with it.

const KEY = 'xc:envelopeCommits';

/** @typedef {{
 *   commitTxid: string, commitVout: number, commitValue: number,
 *   commitAddress: string, internalKeyPath: string, tapleafHash: string,
 *   coin?: string, accountId?: string, createdAt?: number
 * }} EnvelopeRecoveryRecord */

const REQUIRED = ['commitTxid', 'commitVout', 'commitValue', 'commitAddress',
                  'internalKeyPath', 'tapleafHash'];

function store() {
    if (typeof localStorage === 'undefined') {
        throw new Error('envelopeRecoveryMemory: no localStorage; refusing to report a commit as recoverable');
    }
    return localStorage;
}

function readAll() {
    // Reads are tolerant: a corrupt blob must not make the recovery UI unusable,
    // and returning [] here is honest ("nothing recoverable is on record").
    try {
        const raw = store().getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r === 'object') : [];
    } catch {
        return [];
    }
}

/**
 * Persist a pending commit BEFORE it is broadcast.
 *
 * Throws when the record is incomplete or the write fails, and the caller must
 * treat a throw as "do not broadcast": an unrecorded commit is unrecoverable.
 *
 * @param {EnvelopeRecoveryRecord} record
 * @returns {EnvelopeRecoveryRecord[]} the full pending list, post-write
 */
export function recordPendingCommit(record) {
    if (!record || typeof record !== 'object') {
        throw new Error('envelopeRecoveryMemory: a recovery record is required before broadcasting a commit');
    }
    for (const field of REQUIRED) {
        const v = record[field];
        const missing = (field === 'commitVout' || field === 'commitValue')
            ? !Number.isFinite(Number(v))
            : (typeof v !== 'string' || v === '');
        if (missing) {
            throw new Error(`envelopeRecoveryMemory: "${field}" is required; without it the §3.5 cancel cannot be rebuilt`);
        }
    }
    const entry = { ...record, createdAt: Number(record.createdAt) || Date.now() };
    // Same outpoint twice (an RBF-replaced commit) replaces rather than duplicates,
    // because §3.5 requires the record to track the CURRENT commit: a stale record
    // against a replaced commit is itself the stranded-funds bug it warns about.
    const next = readAll().filter(
        (r) => !(r.commitTxid === entry.commitTxid && Number(r.commitVout) === Number(entry.commitVout)));
    next.push(entry);

    const serialized = JSON.stringify(next);
    store().setItem(KEY, serialized);
    // Read back rather than trust the write: quota rejections and private-mode
    // stubs can both accept setItem and keep nothing.
    if (store().getItem(KEY) !== serialized) {
        throw new Error('envelopeRecoveryMemory: the recovery record did not survive the write; do not broadcast the commit');
    }
    return next;
}

/**
 * Every commit still awaiting a reveal, oldest first.
 * @returns {EnvelopeRecoveryRecord[]}
 */
export function listPendingCommits() {
    return readAll().slice().sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
}

/**
 * Drop a record once its reveal is confirmed, or once the commit has been
 * cancelled. Tolerant by design: failing to clear leaves a spent commit listed,
 * which is noise, while failing to WRITE loses money. The asymmetry is the point.
 *
 * @param {string} commitTxid
 * @param {number} [commitVout]
 * @returns {EnvelopeRecoveryRecord[]} the remaining pending list
 */
export function clearPendingCommit(commitTxid, commitVout) {
    const remaining = readAll().filter((r) => !(
        r.commitTxid === commitTxid
        && (commitVout === undefined || Number(r.commitVout) === Number(commitVout))));
    try {
        store().setItem(KEY, JSON.stringify(remaining));
    } catch { /* see the note above: a failed clear is noise, not loss */ }
    return remaining;
}
