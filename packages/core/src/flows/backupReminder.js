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
const SESSION_DISMISS_KEY = 'xc:backupReminderDismissedUntil';
const GENTLE_AFTER_DAYS = 1;
const FIRM_AFTER_DAYS = 7;
const DISMISS_HOURS = 24;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function readStore() {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writeStore(map) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch { /* localStorage unavailable; best-effort */ }
}

/**
 * @param {string} walletId
 * @param {string} [isoTimestamp]   defaults to now
 */
export function markBackupVerified(walletId, isoTimestamp) {
    if (typeof walletId !== 'string' || !walletId) return;
    const map = readStore();
    map[walletId] = typeof isoTimestamp === 'string' ? isoTimestamp : new Date().toISOString();
    writeStore(map);
}

/**
 * @param {string} walletId
 * @returns {string | null}
 */
export function getBackupVerifiedAt(walletId) {
    if (typeof walletId !== 'string' || !walletId) return null;
    const map = readStore();
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
    try {
        const until = now + DISMISS_HOURS * 60 * 60 * 1000;
        const raw = globalThis.localStorage?.getItem(SESSION_DISMISS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed[walletId] = until;
        globalThis.localStorage?.setItem(SESSION_DISMISS_KEY, JSON.stringify(parsed));
    } catch { /* best-effort */ }
}

function isCurrentlyDismissed(walletId, now) {
    try {
        const raw = globalThis.localStorage?.getItem(SESSION_DISMISS_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        const until = parsed?.[walletId];
        return typeof until === 'number' && now < until;
    } catch {
        return false;
    }
}

/**
 * @typedef {Object} BackupReminderInput
 * @property {string} walletId
 * @property {string | null | undefined} walletCreatedAt   ISO timestamp from Wallet.createdAt
 * @property {number} [now]                                 epoch ms (injectable for tests)
 */

/**
 * @typedef {Object} BackupReminderState
 * @property {'hidden' | 'gentle' | 'firm'} kind
 * @property {string} [headline]
 * @property {string} [body]
 * @property {boolean} [dismissable]
 */

/**
 * @param {BackupReminderInput} input
 * @returns {BackupReminderState}
 */
export function computeBackupReminderState(input) {
    const { walletId, walletCreatedAt } = input || {};
    const now = typeof input?.now === 'number' ? input.now : Date.now();
    if (!walletId) return { kind: 'hidden' };

    const verifiedAt = getBackupVerifiedAt(walletId);
    if (verifiedAt) return { kind: 'hidden' };

    // Never-verified wallet.
    const createdMs = walletCreatedAt ? Date.parse(walletCreatedAt) : NaN;
    if (Number.isFinite(createdMs)) {
        const ageDays = (now - createdMs) / MS_PER_DAY;
        if (ageDays < GENTLE_AFTER_DAYS) return { kind: 'hidden' };
        if (isCurrentlyDismissed(walletId, now)) return { kind: 'hidden' };
        if (ageDays >= FIRM_AFTER_DAYS) {
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

    if (isCurrentlyDismissed(walletId, now)) return { kind: 'hidden' };
    return {
        kind: 'gentle',
        headline: 'Back up your wallet',
        body: 'Save your recovery phrase or export an encrypted backup so you can restore this wallet if this device is lost or wiped.',
        dismissable: true,
    };
}
