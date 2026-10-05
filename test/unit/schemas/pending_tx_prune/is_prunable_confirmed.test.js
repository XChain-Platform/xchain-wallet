// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    CONFIRMED_RETENTION_MS,
    isPrunableConfirmedPendingTx,
} from '../../../../packages/core/src/schemas/pendingTx.js';

const now = Date.parse('2026-02-01T00:00:00.000Z');

describe('isPrunableConfirmedPendingTx', () => {
    it('uses a 30-day default retention', () => {
        expect(CONFIRMED_RETENTION_MS).toBe(2592000000);
    });

    it('prunes an indexed record at the retention boundary', () => {
        const confirmedAt = new Date(now - CONFIRMED_RETENTION_MS).toISOString();
        expect(isPrunableConfirmedPendingTx({ status: 'indexed', confirmedAt }, now)).toBe(true);
    });

    it('keeps an indexed record one millisecond inside the retention window', () => {
        const confirmedAt = new Date(now - CONFIRMED_RETENTION_MS + 1).toISOString();
        expect(isPrunableConfirmedPendingTx({ status: 'indexed', confirmedAt }, now)).toBe(false);
    });

    it('never prunes a pending record based on confirmation age', () => {
        const confirmedAt = new Date(now - CONFIRMED_RETENTION_MS * 2).toISOString();
        expect(isPrunableConfirmedPendingTx({ status: 'pending', confirmedAt }, now)).toBe(false);
    });

    it('keeps indexed records with invalid or missing confirmation times', () => {
        expect(isPrunableConfirmedPendingTx({ status: 'indexed', confirmedAt: 'garbage' }, now)).toBe(false);
        expect(isPrunableConfirmedPendingTx({ status: 'indexed' }, now)).toBe(false);
    });

    it('returns false for nullish records', () => {
        expect(isPrunableConfirmedPendingTx(null, now)).toBe(false);
        expect(isPrunableConfirmedPendingTx(undefined, now)).toBe(false);
    });

    it('uses an explicit retention instead of the default', () => {
        const record = { status: 'indexed', confirmedAt: new Date(now - 5000).toISOString() };
        expect(isPrunableConfirmedPendingTx(record, now, 1000)).toBe(true);
        expect(isPrunableConfirmedPendingTx(record, now, 10000)).toBe(false);
    });
});
