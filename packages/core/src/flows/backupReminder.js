// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §19.7 / G034 + G062 — Backup reminder state.
//
// Tracks whether each wallet has been "backup-verified" (either via the
// §19.2 word-quiz at creation time, or via a successful encrypted-backup
// export). The verified-at timestamp is stored in localStorage keyed by
// walletId so the data survives reload without churning the vault schema.
// Reminder cadence comes from `settings.backupReminders`:
//   'off'        — never re-prompt verified wallets
//   'monthly'    — re-prompt 30+ days after the last verify
//   'quarterly'  — re-prompt 90+ days after the last verify

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
    } catch { /* localStorage unavailable — best-effort */ }
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

/** @param {string} walletId */
export function dismissBackupReminder(walletId) {
    if (typeof walletId !== 'string' || !walletId) return;
    try {
        const until = Date.now() + DISMISS_HOURS * 60 * 60 * 1000;
        const raw = globalThis.localStorage?.getItem(SESSION_DISMISS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed[walletId] = until;
        globalThis.localStorage?.setItem(SESSION_DISMISS_KEY, JSON.stringify(parsed));
    } catch { /* best-effort */ }
}

function isCurrentlyDismissed(walletId) {
    try {
        const raw = globalThis.localStorage?.getItem(SESSION_DISMISS_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        const until = parsed?.[walletId];
        return typeof until === 'number' && Date.now() < until;
    } catch {
        return false;
    }
}

/**
 * @typedef {Object} BackupReminderInput
 * @property {string} walletId
 * @property {string | null | undefined} walletCreatedAt   ISO timestamp from Wallet.createdAt
 * @property {{ backupReminders?: 'off' | 'monthly' | 'quarterly' } | null | undefined} settings
 * @property {number} [now]                                 epoch ms — injectable for tests
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
    const { walletId, walletCreatedAt, settings } = input || {};
    const now = typeof input?.now === 'number' ? input.now : Date.now();
    if (!walletId) return { kind: 'hidden' };

    const verifiedAt = getBackupVerifiedAt(walletId);
    const cadence = settings?.backupReminders ?? 'off';

    if (verifiedAt) {
        if (cadence === 'off') return { kind: 'hidden' };
        const verifiedMs = Date.parse(verifiedAt);
        if (!Number.isFinite(verifiedMs)) return { kind: 'hidden' };
        const cadenceDays = cadence === 'monthly' ? 30 : 90;
        if (now - verifiedMs < cadenceDays * MS_PER_DAY) return { kind: 'hidden' };
        if (isCurrentlyDismissed(walletId)) return { kind: 'hidden' };
        return {
            kind: 'gentle',
            headline: cadence === 'monthly' ? 'Monthly backup check' : 'Quarterly backup check',
            body: 'It\'s been a while — re-verify your recovery phrase or export a fresh encrypted backup.',
            dismissable: true,
        };
    }

    // Never-verified wallet.
    const createdMs = walletCreatedAt ? Date.parse(walletCreatedAt) : NaN;
    if (Number.isFinite(createdMs)) {
        const ageDays = (now - createdMs) / MS_PER_DAY;
        if (ageDays < GENTLE_AFTER_DAYS) return { kind: 'hidden' };
        if (isCurrentlyDismissed(walletId) && ageDays < FIRM_AFTER_DAYS) {
            return { kind: 'hidden' };
        }
        if (ageDays >= FIRM_AFTER_DAYS) {
            return {
                kind: 'firm',
                headline: 'Back up your recovery phrase',
                body: 'You haven\'t confirmed your recovery phrase. If this device is lost or wiped, anything in this wallet is gone forever.',
                dismissable: false,
            };
        }
        return {
            kind: 'gentle',
            headline: 'Confirm your recovery phrase',
            body: 'Take 30 seconds to verify the recovery phrase you wrote down. It\'s the only way to recover this wallet.',
            dismissable: true,
        };
    }

    if (isCurrentlyDismissed(walletId)) return { kind: 'hidden' };
    return {
        kind: 'gentle',
        headline: 'Confirm your recovery phrase',
        body: 'Take 30 seconds to verify the recovery phrase you wrote down. It\'s the only way to recover this wallet.',
        dismissable: true,
    };
}
