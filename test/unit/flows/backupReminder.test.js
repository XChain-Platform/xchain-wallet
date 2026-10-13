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
// first funding, and a 24h snooze window.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    markBackupVerified,
    getBackupVerifiedAt,
    dismissBackupReminder,
    hasBackupReminderFunds,
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
        expect(computeBackupReminderState({
            walletId: 'w1',
            hasFunds: true,
            now: Date.parse('2030-01-01T00:00:00.000Z'),
        })).toEqual({ kind: 'hidden' });
    });

    it('is hidden when the stored timestamp is unparseable', () => {
        markBackupVerified('w1', 'not-a-date');
        const s = computeBackupReminderState({
            walletId: 'w1', hasFunds: true, now: Date.now(),
        });
        expect(s.kind).toBe('hidden');
    });
});

describe('flows/backupReminder computeBackupReminderState (never verified)', () => {
    const funded = Date.parse('2026-06-01T00:00:00.000Z');

    it('stays hidden until the wallet first has funds', () => {
        const s = computeBackupReminderState({
            walletId: 'w1',
            hasFunds: false,
            now: funded,
        });
        expect(s.kind).toBe('hidden');
    });

    it('is gentle as soon as the first funds arrive', () => {
        const s = computeBackupReminderState({
            walletId: 'w1',
            hasFunds: true,
            now: funded,
        });
        expect(s.kind).toBe('gentle');
        expect(s.dismissable).toBe(true);
        expect(s.headline).toBe('Back up your wallet');
        expect(s.body).toMatch(/recovery phrase or export an encrypted backup/i);
    });

    it('remembers first funding even after the displayed balance returns to zero', () => {
        computeBackupReminderState({ walletId: 'w1', hasFunds: true, now: funded });
        const s = computeBackupReminderState({ walletId: 'w1', hasFunds: false, now: funded + MS_PER_DAY });
        expect(s.kind).toBe('gentle');
    });

    it('escalates seven days after first funding', () => {
        computeBackupReminderState({ walletId: 'w1', hasFunds: true, now: funded });
        const s = computeBackupReminderState({ walletId: 'w1', hasFunds: false, now: funded + 8 * MS_PER_DAY });
        expect(s.kind).toBe('firm');
        expect(s.dismissable).toBe(false);
        expect(s.headline).toBe('Back up your wallet');
        expect(s.body).toMatch(/permanently lock you out/i);
    });

    it('returns after the full 24-hour snooze', () => {
        computeBackupReminderState({ walletId: 'w1', hasFunds: true, now: funded });
        dismissBackupReminder('w1', funded);
        const stillGentle = computeBackupReminderState({
            walletId: 'w1',
            hasFunds: false,
            now: funded + MS_PER_DAY - 1,
        });
        expect(stillGentle).toEqual({ kind: 'hidden', recheckAt: funded + MS_PER_DAY });

        const returned = computeBackupReminderState({
            walletId: 'w1',
            hasFunds: false,
            now: funded + MS_PER_DAY,
        });
        expect(returned.kind).toBe('gentle');
    });
});

describe('flows/backupReminder funding detection', () => {
    it('counts confirmed, pending, and escrowed value but not empty or malformed rows', () => {
        expect(hasBackupReminderFunds([])).toBe(false);
        expect(hasBackupReminderFunds([{ quantity: '0', pendingQuantity: '0' }])).toBe(false);
        expect(hasBackupReminderFunds([{ quantity: 'not-an-amount' }])).toBe(false);
        expect(hasBackupReminderFunds([{ quantity: '1' }])).toBe(true);
        expect(hasBackupReminderFunds([{ quantity: '0', pendingQuantity: '1' }])).toBe(true);
        expect(hasBackupReminderFunds([{ quantity: '0', escrowed: '1' }])).toBe(true);
    });
});

describe('flows/backupReminder computeBackupReminderState guards', () => {
    it('is hidden without a walletId', () => {
        expect(computeBackupReminderState({}).kind).toBe('hidden');
        expect(computeBackupReminderState(null).kind).toBe('hidden');
    });
});
