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
// wallet age, and a 24h snooze window.

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
    it('stays hidden regardless of the reminder cadence or elapsed time', () => {
        markBackupVerified('w1', '2020-01-01T00:00:00.000Z');
        for (const backupReminders of ['off', 'monthly', 'quarterly']) {
            expect(computeBackupReminderState({
                walletId: 'w1',
                settings: { backupReminders },
                now: Date.parse('2030-01-01T00:00:00.000Z'),
            })).toEqual({ kind: 'hidden' });
        }
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
        expect(s.headline).toBe('Back up your wallet');
        expect(s.body).toMatch(/recovery phrase or export an encrypted backup/i);
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
        expect(s.headline).toBe('Back up your wallet');
        expect(s.body).toMatch(/permanently lock you out/i);
    });

    it('honours the full 24-hour snooze across the firm threshold', () => {
        dismissBackupReminder('w1', created + 6.5 * MS_PER_DAY);
        const stillGentle = computeBackupReminderState({
            walletId: 'w1',
            walletCreatedAt: new Date(created).toISOString(),
            settings: {},
            now: created + 7 * MS_PER_DAY,
        });
        expect(stillGentle.kind).toBe('hidden');

        const firm = computeBackupReminderState({
            walletId: 'w1',
            walletCreatedAt: new Date(created).toISOString(),
            settings: {},
            now: created + 7.5 * MS_PER_DAY,
        });
        expect(firm.kind).toBe('firm');
    });

    it('falls back to gentle when createdAt is missing and not dismissed', () => {
        const s = computeBackupReminderState({ walletId: 'w1', settings: {}, now: Date.now() });
        expect(s.kind).toBe('gentle');
    });

    it('is hidden with no createdAt once dismissed', () => {
        const now = Date.parse('2026-06-10T00:00:00.000Z');
        dismissBackupReminder('w1', now);
        const s = computeBackupReminderState({ walletId: 'w1', settings: {}, now });
        expect(s.kind).toBe('hidden');
    });
});

describe('flows/backupReminder computeBackupReminderState guards', () => {
    it('is hidden without a walletId', () => {
        expect(computeBackupReminderState({}).kind).toBe('hidden');
        expect(computeBackupReminderState(null).kind).toBe('hidden');
    });
});
