// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: flows/backupReminder (§19.7 / G034 + G062). Backup-verified state
// lives in localStorage keyed by walletId. computeBackupReminderState is
// the state machine that decides hidden/gentle/firm from verified-at,
// wallet age, the reminder cadence, and a 24h dismissal window.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    markBackupVerified,
    getBackupVerifiedAt,
    dismissBackupReminder,
    computeBackupReminderState,
} from '../../../packages/core/src/flows/backupReminder.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
    // jsdom supplies a real localStorage; wipe it so each case starts clean.
    globalThis.localStorage.clear();
});

describe('flows/backupReminder mark + read', () => {
    it('round-trips a verified timestamp per walletId', () => {
        markBackupVerified('w1', '2026-01-01T00:00:00.000Z');
        expect(getBackupVerifiedAt('w1')).toBe('2026-01-01T00:00:00.000Z');
        expect(getBackupVerifiedAt('w2')).toBeNull();
    });

    it('ignores empty/invalid walletIds on both read and write', () => {
        markBackupVerified('', '2026-01-01T00:00:00.000Z');
        expect(getBackupVerifiedAt('')).toBeNull();
        // @ts-expect-error deliberately wrong type
        expect(getBackupVerifiedAt(null)).toBeNull();
    });
});

describe('flows/backupReminder computeBackupReminderState (verified wallet)', () => {
    it('is hidden when the cadence is off', () => {
        markBackupVerified('w1', '2020-01-01T00:00:00.000Z');
        const s = computeBackupReminderState({
            walletId: 'w1',
            settings: { backupReminders: 'off' },
            now: Date.now(),
        });
        expect(s.kind).toBe('hidden');
    });

    it('is hidden inside the monthly window and gentle past it', () => {
        const verifiedMs = Date.parse('2026-01-01T00:00:00.000Z');
        markBackupVerified('w1', new Date(verifiedMs).toISOString());

        const within = computeBackupReminderState({
            walletId: 'w1',
            settings: { backupReminders: 'monthly' },
            now: verifiedMs + 10 * MS_PER_DAY,
        });
        expect(within.kind).toBe('hidden');

        const past = computeBackupReminderState({
            walletId: 'w1',
            settings: { backupReminders: 'monthly' },
            now: verifiedMs + 40 * MS_PER_DAY,
        });
        expect(past.kind).toBe('gentle');
        expect(past.dismissable).toBe(true);
        expect(past.headline).toMatch(/monthly/i);
    });

    it('uses the 90-day window for quarterly', () => {
        const verifiedMs = Date.parse('2026-01-01T00:00:00.000Z');
        markBackupVerified('w1', new Date(verifiedMs).toISOString());
        expect(computeBackupReminderState({
            walletId: 'w1', settings: { backupReminders: 'quarterly' }, now: verifiedMs + 60 * MS_PER_DAY,
        }).kind).toBe('hidden');
        expect(computeBackupReminderState({
            walletId: 'w1', settings: { backupReminders: 'quarterly' }, now: verifiedMs + 100 * MS_PER_DAY,
        }).headline).toMatch(/quarterly/i);
    });

    it('is hidden once dismissed even when past the cadence window', () => {
        const verifiedMs = Date.parse('2026-01-01T00:00:00.000Z');
        markBackupVerified('w1', new Date(verifiedMs).toISOString());
        dismissBackupReminder('w1'); // dismissal window uses the real clock
        const s = computeBackupReminderState({
            walletId: 'w1',
            settings: { backupReminders: 'monthly' },
            now: verifiedMs + 40 * MS_PER_DAY,
        });
        expect(s.kind).toBe('hidden');
    });

    it('is hidden when the stored timestamp is unparseable', () => {
        markBackupVerified('w1', 'not-a-date');
        const s = computeBackupReminderState({
            walletId: 'w1', settings: { backupReminders: 'monthly' }, now: Date.now(),
        });
        expect(s.kind).toBe('hidden');
    });
});

describe('flows/backupReminder computeBackupReminderState (never verified)', () => {
    const created = Date.parse('2026-06-01T00:00:00.000Z');

    it('is hidden before the 1-day gentle threshold', () => {
        const s = computeBackupReminderState({
            walletId: 'w1',
            walletCreatedAt: new Date(created).toISOString(),
            settings: {},
            now: created + 0.5 * MS_PER_DAY,
        });
        expect(s.kind).toBe('hidden');
    });

    it('is gentle between 1 and 7 days old', () => {
        const s = computeBackupReminderState({
            walletId: 'w1',
            walletCreatedAt: new Date(created).toISOString(),
            settings: {},
            now: created + 3 * MS_PER_DAY,
        });
        expect(s.kind).toBe('gentle');
        expect(s.dismissable).toBe(true);
    });

    it('escalates to a non-dismissable firm reminder at 7+ days', () => {
        const s = computeBackupReminderState({
            walletId: 'w1',
            walletCreatedAt: new Date(created).toISOString(),
            settings: {},
            now: created + 8 * MS_PER_DAY,
        });
        expect(s.kind).toBe('firm');
        expect(s.dismissable).toBe(false);
    });

    it('respects dismissal only while still under the firm threshold', () => {
        dismissBackupReminder('w1');
        const stillGentle = computeBackupReminderState({
            walletId: 'w1',
            walletCreatedAt: new Date(created).toISOString(),
            settings: {},
            now: created + 3 * MS_PER_DAY,
        });
        expect(stillGentle.kind).toBe('hidden');

        // Past 7 days the firm reminder overrides any dismissal.
        const firm = computeBackupReminderState({
            walletId: 'w1',
            walletCreatedAt: new Date(created).toISOString(),
            settings: {},
            now: created + 9 * MS_PER_DAY,
        });
        expect(firm.kind).toBe('firm');
    });

    it('falls back to gentle when createdAt is missing and not dismissed', () => {
        const s = computeBackupReminderState({ walletId: 'w1', settings: {}, now: Date.now() });
        expect(s.kind).toBe('gentle');
    });

    it('is hidden with no createdAt once dismissed', () => {
        dismissBackupReminder('w1');
        const s = computeBackupReminderState({ walletId: 'w1', settings: {}, now: Date.now() });
        expect(s.kind).toBe('hidden');
    });
});

describe('flows/backupReminder computeBackupReminderState guards', () => {
    it('is hidden without a walletId', () => {
        expect(computeBackupReminderState({}).kind).toBe('hidden');
        expect(computeBackupReminderState(null).kind).toBe('hidden');
    });
});
