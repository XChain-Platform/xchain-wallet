// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §19.7 / G034 + G062: Backup reminder state.
//
// Tracks whether each wallet has been "backup-verified" (either via the
// §19.2 word-quiz at creation time, or via a successful encrypted-backup
// export). The verified-at timestamp is stored in localStorage keyed by
// walletId so the data survives reload without churning the vault schema.
// Home only prompts wallets that have no recorded verification.

const STORAGE_KEY = 'xc:backupVerifiedAt';
const FUNDED_AT_KEY = 'xc:backupReminderFundedAt';
const SESSION_DISMISS_KEY = 'xc:backupReminderDismissedUntil';
const FIRM_AFTER_DAYS = 7;
const DISMISS_HOURS = 24;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function readStore(key) {
    try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writeStore(key, map) {
    try {
        globalThis.localStorage?.setItem(key, JSON.stringify(map));
    } catch { /* localStorage unavailable; best-effort */ }
}

function announceStoreChange(key) {
    try {
        if (typeof globalThis.dispatchEvent !== 'function'
            || typeof globalThis.StorageEvent !== 'function') return;
        globalThis.dispatchEvent(new globalThis.StorageEvent('storage', { key }));
    } catch { /* storage event unavailable; best-effort */ }
}

/**
 * @param {string} walletId
 * @param {string} [isoTimestamp]   defaults to now
 */
export function markBackupVerified(walletId, isoTimestamp) {
    if (typeof walletId !== 'string' || !walletId) return;
    const map = readStore(STORAGE_KEY);
    map[walletId] = typeof isoTimestamp === 'string' ? isoTimestamp : new Date().toISOString();
    writeStore(STORAGE_KEY, map);
    // Same-document storage writes do not emit a native storage event.
    // Announcing this write lets an open reminder react to backup completion.
    announceStoreChange(STORAGE_KEY);
}

/**
 * @param {string} walletId
 * @returns {string | null}
 */
export function getBackupVerifiedAt(walletId) {
    if (typeof walletId !== 'string' || !walletId) return null;
    const map = readStore(STORAGE_KEY);
    const v = map[walletId];
    return typeof v === 'string' ? v : null;
}

/**
 * Snooze a gentle reminder for 24 hours.
 *
 * @param {string} walletId
 * @param {number} [now] epoch ms (injectable for tests)
 */
export function dismissBackupReminder(walletId, now = Date.now()) {
    if (typeof walletId !== 'string' || !walletId) return;
    const map = readStore(SESSION_DISMISS_KEY);
    map[walletId] = now + DISMISS_HOURS * 60 * 60 * 1000;
    writeStore(SESSION_DISMISS_KEY, map);
}

function dismissedUntil(walletId, now) {
    const until = readStore(SESSION_DISMISS_KEY)[walletId];
    return typeof until === 'number' && now < until ? until : null;
}

function firstFundedAt(walletId, hasFunds, now) {
    const map = readStore(FUNDED_AT_KEY);
    const stored = map[walletId];
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
    if (!hasFunds) return null;
    map[walletId] = now;
    writeStore(FUNDED_AT_KEY, map);
    return now;
}

/**
 * @param {Array<{ quantity?: string | number | bigint, pendingQuantity?: string | number | bigint, escrowed?: string | number | bigint }>} rows
 * @returns {boolean}
 */
export function hasBackupReminderFunds(rows) {
    return Array.isArray(rows) && rows.some((row) => (
        ['quantity', 'pendingQuantity', 'escrowed'].some((field) => {
            try {
                return BigInt(row?.[field] ?? 0) > 0n;
            } catch {
                return false;
            }
        })
    ));
}

/**
 * @typedef {Object} BackupReminderInput
 * @property {string} walletId
 * @property {boolean} hasFunds                            current balance includes confirmed, pending, or escrowed funds
 * @property {number} [now]                                 epoch ms (injectable for tests)
 */

/**
 * @typedef {Object} BackupReminderState
 * @property {'hidden' | 'gentle' | 'firm'} kind
 * @property {string} [headline]
 * @property {string} [body]
 * @property {boolean} [dismissable]
 * @property {number} [recheckAt] epoch ms when a temporary hidden state expires
 */

/**
 * @param {BackupReminderInput} input
 * @returns {BackupReminderState}
 */
export function computeBackupReminderState(input) {
    const { walletId, hasFunds = false } = input || {};
    const now = typeof input?.now === 'number' ? input.now : Date.now();
    if (!walletId) return { kind: 'hidden' };

    const verifiedAt = getBackupVerifiedAt(walletId);
    if (verifiedAt) return { kind: 'hidden' };

    const fundedAt = firstFundedAt(walletId, hasFunds, now);
    if (fundedAt === null) return { kind: 'hidden' };
    const recheckAt = dismissedUntil(walletId, now);
    if (recheckAt !== null) return { kind: 'hidden', recheckAt };
    const fundedDays = Math.max(0, now - fundedAt) / MS_PER_DAY;
    if (fundedDays >= FIRM_AFTER_DAYS) {
        return {
            kind: 'firm',
            headline: 'Back up your wallet',
            body: 'Save your recovery phrase or export an encrypted backup. Without one, losing or wiping this device can permanently lock you out of this wallet.',
            dismissable: false,
        };
    }
    return {
        kind: 'gentle',
        headline: 'Back up your wallet',
        body: 'Save your recovery phrase or export an encrypted backup so you can restore this wallet if this device is lost or wiped.',
        dismissable: true,
    };
}
