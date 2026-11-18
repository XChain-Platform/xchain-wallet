// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import {
    getBroadcastTxids,
    markPendingTxIndexed,
    stampPendingTxAdsBooking,
} from '../../../packages/core/src/notifications/pendingTxBridge.js';

// Minimal in-memory stand-in for vault.pendingTxs (list / findBy / put).
function makeVault(rows) {
    const store = rows.slice();
    return {
        pendingTxs: {
            async list() { return store.map((r) => ({ ...r })); },
            async get(id) {
                const row = store.find((r) => r.id === id);
                return row ? { ...row } : null;
            },
            async findBy(field, value) {
                return store.filter((r) => r[field] === value).map((r) => ({ ...r }));
            },
            async put(record) {
                const i = store.findIndex((r) => r.id === record.id);
                if (i >= 0) store[i] = record; else store.push(record);
            },
        },
        _store: store,
    };
}

describe('getBroadcastTxids', () => {
    it('returns only txids of broadcast-status records', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast' },
            { id: '2', txid: 'b', status: 'indexed' },
            { id: '3', txid: 'c', status: 'broadcast' },
            { id: '4', txid: null, status: 'broadcast' },
        ]);
        const set = await getBroadcastTxids(vault);
        expect(set).toBeInstanceOf(Set);
        expect([...set].sort()).toEqual(['a', 'c']);
    });

    it('empty for a null vault', async () => {
        expect((await getBroadcastTxids(null)).size).toBe(0);
    });
});

describe('markPendingTxIndexed', () => {
    it('flips a broadcast record to indexed and stamps confirmedAt', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast', confirmedAt: null },
        ]);
        const changed = await markPendingTxIndexed(vault, 'a', { now: () => '2026-06-15T00:00:00.000Z' });
        expect(changed).toBe(true);
        expect(vault._store[0].status).toBe('indexed');
        expect(vault._store[0].confirmedAt).toBe('2026-06-15T00:00:00.000Z');
    });

    it('no-ops when already indexed or no match', async () => {
        const vault = makeVault([{ id: '1', txid: 'a', status: 'indexed', confirmedAt: 'x' }]);
        expect(await markPendingTxIndexed(vault, 'a')).toBe(false);
        expect(await markPendingTxIndexed(vault, 'nope')).toBe(false);
    });

    it('restores a booked payout once when a donation-free replacement confirms', async () => {
        const vault = makeVault([
            {
                id: 'original', txid: 'o', status: 'rbf-replaced', confirmedAt: null,
                adsBooking: {
                    id: 'original', fiat: '25', currency: 'USD', paid: true, booked: true,
                },
            },
            {
                id: 'cancel', txid: 'c', status: 'broadcast', confirmedAt: null,
                adsBooking: {
                    id: 'original', fiat: '25', currency: 'USD', paid: false, booked: false,
                },
            },
        ]);
        let settings = {
            fiatCurrency: 'USD',
            ads: {
                perTransaction: '1', sendAt: '25', queued: '1', donated: '25',
                donationCount: 1, currency: 'USD', recipient: 'protocol',
            },
        };
        vault.settings = {
            get: async () => settings,
            put: async (next) => { settings = next; },
        };

        expect(await markPendingTxIndexed(vault, 'c')).toBe(true);
        expect(settings.ads).toMatchObject({ queued: '26', donated: '0', donationCount: 0 });
        expect(vault._store.find((row) => row.id === 'original').adsBooking.reversed).toBe(true);
        expect(await markPendingTxIndexed(vault, 'c')).toBe(false);
        expect(settings.ads).toMatchObject({ queued: '26', donated: '0', donationCount: 0 });
    });

    it('does not reverse a provisional payout whose accounting write failed', async () => {
        const booking = {
            id: 'original', fiat: '25', currency: 'USD', paid: true, booked: false,
        };
        const vault = makeVault([
            { id: 'original', txid: 'o', status: 'rbf-replaced', adsBooking: booking },
            {
                id: 'cancel', txid: 'c', status: 'broadcast',
                adsBooking: { ...booking, paid: false },
            },
        ]);
        let settings = {
            fiatCurrency: 'USD',
            ads: {
                perTransaction: '1', sendAt: '25', queued: '25', donated: '0',
                donationCount: 0, currency: 'USD', recipient: 'protocol',
            },
        };
        vault.settings = {
            get: async () => settings,
            put: async (next) => { settings = next; },
        };

        expect(await markPendingTxIndexed(vault, 'c')).toBe(true);
        expect(settings.ads).toMatchObject({ queued: '25', donated: '0', donationCount: 0 });
    });

    it('does not reverse when the transaction that paid the payout confirms', async () => {
        const booking = {
            id: 'original', fiat: '25', currency: 'USD', paid: true, booked: true,
        };
        const vault = makeVault([
            { id: 'original', txid: 'o', status: 'broadcast', adsBooking: booking },
        ]);
        let settings = {
            ads: {
                perTransaction: '1', sendAt: '25', queued: '1', donated: '25',
                donationCount: 1, currency: 'USD', recipient: 'protocol',
            },
        };
        vault.settings = {
            get: async () => settings,
            put: async (next) => { settings = next; },
        };

        expect(await markPendingTxIndexed(vault, 'o')).toBe(true);
        expect(settings.ads).toMatchObject({ queued: '1', donated: '25', donationCount: 1 });
        expect(vault._store[0].adsBooking.reversed).toBeUndefined();
    });

    it('keeps confirmation indexed when the reversal write fails', async () => {
        const booking = {
            id: 'original', fiat: '25', currency: 'USD', paid: true, booked: true,
        };
        const vault = makeVault([
            { id: 'original', txid: 'o', status: 'rbf-replaced', adsBooking: booking },
            { id: 'cancel', txid: 'c', status: 'broadcast', adsBooking: { ...booking, paid: false } },
        ]);
        vault.settings = {
            get: async () => ({
                ads: {
                    perTransaction: '1', sendAt: '25', queued: '1', donated: '25',
                    donationCount: 1, currency: 'USD', recipient: 'protocol',
                },
            }),
            put: async () => { throw new Error('settings unavailable'); },
        };

        await expect(markPendingTxIndexed(vault, 'c')).resolves.toBe(true);
        expect(vault._store.find((row) => row.id === 'cancel').status).toBe('indexed');
        expect(vault._store.find((row) => row.id === 'original').adsBooking.reversed).toBe(true);
    });

    it('stamps a booking without reviving an indexed record', async () => {
        const vault = makeVault([{ id: '1', txid: 'a', status: 'indexed', confirmedAt: 'x' }]);
        expect(await stampPendingTxAdsBooking(vault, '1', { fiat: '25', currency: 'USD' })).toBe(true);
        expect(vault._store[0]).toMatchObject({
            status: 'indexed',
            adsBooking: { id: '1', fiat: '25', currency: 'USD', paid: true, booked: true },
        });
    });
});

describe('markPendingTxIndexed with a fee-bumped original', () => {
    const sent = { chain: 'BTC', network: 'mainnet', fromAddress: 'A', status: 'broadcast' };

    it('retires the replacement that can no longer confirm', async () => {
        const vault = makeVault([
            { ...sent, id: 'orig', txid: 'AA', status: 'rbf-replaced', rbfReplacement: 'bb' },
            { ...sent, id: 'bump', txid: 'bb' },
        ]);
        await markPendingTxIndexed(vault, 'AA');
        const byId = Object.fromEntries(vault._store.map((r) => [r.id, r]));
        expect(byId.orig.status).toBe('indexed');
        expect(byId.bump.status).toBe('failed');
        expect(byId.bump.error).toMatch(/original transaction confirmed/);
    });

    it('retires a whole chain of bumps and leaves unrelated sends alone', async () => {
        const vault = makeVault([
            { ...sent, id: 'o', txid: 'aa', status: 'rbf-replaced', rbfReplacement: 'bb' },
            { ...sent, id: 'b1', txid: 'bb', status: 'rbf-replaced', rbfReplacement: 'cc' },
            { ...sent, id: 'b2', txid: 'cc' },
            { ...sent, id: 'other', txid: 'dd' },
        ]);
        await markPendingTxIndexed(vault, 'aa');
        const status = Object.fromEntries(vault._store.map((r) => [r.id, r.status]));
        expect(status).toEqual({ o: 'indexed', b1: 'failed', b2: 'failed', other: 'broadcast' });
    });

    it('does not touch a replacement that confirmed itself', async () => {
        const vault = makeVault([
            { ...sent, id: 'orig', txid: 'aa', status: 'rbf-replaced', rbfReplacement: 'bb' },
            { ...sent, id: 'bump', txid: 'bb', status: 'indexed' },
        ]);
        await markPendingTxIndexed(vault, 'aa');
        expect(vault._store.find((r) => r.id === 'bump').status).toBe('indexed');
    });
});
