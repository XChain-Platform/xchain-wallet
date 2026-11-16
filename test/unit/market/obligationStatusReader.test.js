// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One status reader serves the badge, the form, the autopay watcher, the
// autopay policy and the sign-time verifier, so a renamed, recased or missing
// field reads the same everywhere. Paging past the first page keeps older
// pending obligations visible.

import { describe, it, expect } from 'vitest';
import {
    extractObligationRows,
    isPendingForPayer,
    isPendingObligation,
    obligationStatus,
} from '../../../packages/core/src/market/obligationStatus.js';
import { evaluateObligation } from '../../../packages/core/src/market/autopayPolicy.js';
import { followObligationPages } from '../../../packages/core/src/market/obligationPaging.js';

describe('obligationStatus reader', () => {
    it('reads the three spellings in a fixed order and lowercases the value', () => {
        expect(obligationStatus({ coinpay_status: 'pending_coinpay' })).toBe('pending_coinpay');
        expect(obligationStatus({ coinpayStatus: 'pending_coinpay' })).toBe('pending_coinpay');
        expect(obligationStatus({ status: ' PENDING_COINPAY ' })).toBe('pending_coinpay');
        expect(obligationStatus({ coinpay_status: 'fulfilled', status: 'pending_coinpay' })).toBe('fulfilled');
    });

    it('reads a row with no status, an empty status or a non-row as the empty string', () => {
        expect(obligationStatus({})).toBe('');
        expect(obligationStatus({ coinpay_status: '', status: 'pending_coinpay' })).toBe('');
        expect(obligationStatus(null)).toBe('');
        expect(obligationStatus('pending_coinpay')).toBe('');
    });

    it('treats only an exactly pending status as pending', () => {
        expect(isPendingObligation({ coinpay_status: 'pending_coinpay' })).toBe(true);
        expect(isPendingObligation({})).toBe(false);
        expect(isPendingObligation({ coinpay_status: 'fulfilled' })).toBe(false);
        expect(isPendingObligation({ coinpay_status: 'pending_coinpay_x' })).toBe(false);
    });

    it('limits the payer filter to pending rows owed by that address', () => {
        const row = { coinpay_status: 'pending_coinpay', payer_address: 'a1' };
        expect(isPendingForPayer(row, 'a1')).toBe(true);
        expect(isPendingForPayer(row, 'a2')).toBe(false);
        expect(isPendingForPayer({ payer_address: 'a1' }, 'a1')).toBe(false);
    });

    it('agrees with the autopay policy on the same rows', () => {
        const consent = { autopay: true, payments: [] };
        const now = 1_753_380_000;
        const rows = [
            { action_index: '1', coinpay_status: 'pending_coinpay', expiration: now + 7200 },
            { action_index: '2', coinpayStatus: 'pending_coinpay', expiration: now + 7200 },
            { action_index: '3', status: 'pending_coinpay', expiration: now + 7200 },
            { action_index: '4', expiration: now + 7200 },
        ];
        for (const obligation of rows) {
            const verdict = evaluateObligation({
                obligation, consent, matchRow: null, tipHeight: 1, nowSeconds: now, alreadyAttempted: false,
            });
            expect(verdict.reason !== 'not-pending').toBe(isPendingObligation(obligation));
        }
    });

    it('finds rows under each envelope key', () => {
        for (const key of ['data', 'rows', 'obligations', 'coinpay_obligations']) {
            expect(extractObligationRows({ [key]: [{ a: 1 }] })).toEqual([{ a: 1 }]);
        }
        expect(extractObligationRows([{ a: 1 }])).toEqual([{ a: 1 }]);
        expect(extractObligationRows(null)).toEqual([]);
    });
});

const row = (i) => ({ action_index: String(i), coinpay_status: 'fulfilled' });

describe('followObligationPages', () => {
    it('returns a first page that already covers the total without reading again', async () => {
        const first = { total: 2, data: [row(2), row(1)], next_before: '1' };
        let reads = 0;
        const out = await followObligationPages(first, async () => { reads += 1; return {}; });
        expect(out).toBe(first);
        expect(reads).toBe(0);
    });

    it('leaves a bare array or a reply with no total untouched', async () => {
        const arr = [row(1)];
        expect(await followObligationPages(arr, async () => { throw new Error('read'); })).toBe(arr);
        const noTotal = { data: [row(1)], next_before: '1' };
        expect(await followObligationPages(noTotal, async () => { throw new Error('read'); })).toBe(noTotal);
    });

    it('walks the cursor until the total is covered and keeps the oldest row', async () => {
        const first = { total: 5, data: [row(5), row(4)], next_before: '4' };
        const pages = {
            4: { total: 5, data: [row(3), row(2)], next_before: '2' },
            2: { total: 5, data: [row(1)], next_before: '1' },
        };
        const seen = [];
        const out = await followObligationPages(first, async ({ before }) => { seen.push(before); return pages[before]; });
        expect(seen).toEqual(['4', '2']);
        expect(out.data.map((r) => r.action_index)).toEqual(['5', '4', '3', '2', '1']);
        expect(out.truncated).toBe(false);
    });

    it('stops at the page cap and says the answer is partial', async () => {
        const first = { total: 100, data: [row(100)], next_before: '100' };
        let reads = 0;
        const out = await followObligationPages(first, async ({ before }) => {
            reads += 1;
            return { total: 100, data: [row(Number(before) - 1)], next_before: String(Number(before) - 1) };
        }, 3);
        expect(reads).toBe(3);
        expect(out.data).toHaveLength(4);
        expect(out.truncated).toBe(true);
    });

    it('stops when a page adds no new row', async () => {
        const first = { total: 9, data: [row(9)], next_before: '9' };
        let reads = 0;
        const out = await followObligationPages(first, async () => { reads += 1; return { total: 9, data: [row(9)], next_before: '9' }; });
        expect(reads).toBe(1);
        expect(out.truncated).toBe(true);
    });
});
