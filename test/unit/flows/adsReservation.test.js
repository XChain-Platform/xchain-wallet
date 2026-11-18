// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The claim one pending send holds on the due automatic-donation queue (§36,
// 2026-11-14): settings.ads.reserved carries an id and the fiat amount its
// bytes pay. Taking it is a compare-and-set; it is settled once when those
// bytes broadcast, released when they are dropped or refused for good, and a
// claim whose owner is gone is judged against its PendingTx record.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAINNET_LAUNCH_EPOCH } from '../../../packages/core/src/flows/mainnetPrelaunch.js';
import {
    ADS_RESERVATION_SIGNING_GRACE_MS,
    ADS_RESERVATION_TTL_MS,
    adsReservationOf,
    commitAdsStep,
    commitAdsStepWithBooking,
    forgetInFlightAdsReservation,
    isAdsCountedSend,
    reconcileAdsReservation,
    releaseAdsReservation,
    reserveAdsPayout,
    settleAdsReservation,
    stepAdsQueue,
} from '../../../packages/core/src/flows/ads.js';
import { discardQueuedBroadcast, drainQueuedBroadcast } from '../../../packages/core/src/flows/queuedBroadcast.js';
import {
    createDefaultSettings,
    deflateSettings,
    inflateSettings,
    validateSettings,
} from '../../../packages/core/src/schemas/settings.js';
import { migrateSettings } from '../../../packages/core/src/schemas/migrations.js';
import { createBroadcastQueueEngine } from '../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';

const NOW = 1_800_000_000_000;

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => m.delete(id),
    };
}

function wallet(ads = {}, records = []) {
    const base = createDefaultSettings();
    let settings = { ...base, ads: { ...base.ads, queued: '30', sendAt: '25', perTransaction: '0.05', ...ads } };
    const vault = {
        pendingTxs: memCollection(records),
        settings: {
            get: vi.fn(async () => JSON.parse(JSON.stringify(settings))),
            put: vi.fn(async (r) => { settings = JSON.parse(JSON.stringify(r)); }),
        },
    };
    return { vault, ads: () => settings.ads, settings: () => settings };
}

const claim = (overrides = {}) => ({ id: 'tx-a', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet', pendingTxId: 'tx-a', at: NOW, ...overrides });

describe('only mainnet counts', () => {
    it('needs a mainnet chain AND the mainnet network, failing closed', () => {
        const main = { networkKind: 'mainnet' };
        expect(isAdsCountedSend({ settings: { activeNetwork: 'mainnet' }, descriptor: main })).toBe(true);
        expect(isAdsCountedSend({ settings: {}, descriptor: main })).toBe(true);
        expect(isAdsCountedSend({ settings: { activeNetwork: 'testnet' }, descriptor: main })).toBe(false);
        expect(isAdsCountedSend({ settings: {}, descriptor: { networkKind: 'testnet' } })).toBe(false);
        expect(isAdsCountedSend({ settings: {}, descriptor: { networkKind: 'regtest' } })).toBe(false);
        expect(isAdsCountedSend({ settings: {}, descriptor: null })).toBe(false);
    });

    it('a test-network broadcast neither accrues nor takes a carried amount off', () => {
        const w = wallet();
        const s = w.settings();
        expect(stepAdsQueue(s, { mainnet: false })).toBe(s);
        expect(stepAdsQueue(s, { mainnet: false, donationIncluded: true, donatedFiat: '30', currency: 'USD' })).toBe(s);
    });
});

describe('reserveAdsPayout', () => {
    it('claims the due queue once; a second claim is refused until the first ends', async () => {
        const w = wallet();
        const [a, b] = await Promise.all([
            reserveAdsPayout({ vault: w.vault, id: 'a', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet', now: NOW }),
            reserveAdsPayout({ vault: w.vault, id: 'b', fiat: '30', currency: 'USD', chainId: 'litecoin-mainnet', now: NOW }),
        ]);
        expect([a, b]).toEqual([true, false]);
        expect(w.ads().reserved).toEqual({ id: 'a', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet', pendingTxId: null, at: NOW });
        // Re-claiming with the held id is a no-op success.
        expect(await reserveAdsPayout({ vault: w.vault, id: 'a', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet' })).toBe(true);
        expect(await releaseAdsReservation({ vault: w.vault, reservationId: 'a' })).toBe(true);
        expect(await reserveAdsPayout({ vault: w.vault, id: 'b', fiat: '30', currency: 'USD', chainId: 'litecoin-mainnet' })).toBe(true);
        forgetInFlightAdsReservation('b');
    });

    it('refuses a claim the queue no longer covers (another send already paid it)', async () => {
        const below = wallet({ queued: '5' });
        expect(await reserveAdsPayout({ vault: below.vault, id: 'a', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet' })).toBe(false);
        const more = wallet({ queued: '26' });
        expect(await reserveAdsPayout({ vault: more.vault, id: 'a', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet' })).toBe(false);
        const otherCurrency = wallet();
        expect(await reserveAdsPayout({ vault: otherCurrency.vault, id: 'a', fiat: '30', currency: 'EUR', chainId: 'bitcoin-mainnet' })).toBe(false);
        const off = wallet({ perTransaction: '0' });
        expect(await reserveAdsPayout({ vault: off.vault, id: 'a', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet' })).toBe(false);
        for (const w of [below, more, otherCurrency, off]) expect(w.vault.settings.put).not.toHaveBeenCalled();
    });

    it('the claim survives the settings store (migrate, deflate, inflate), and so does its absence', () => {
        const base = createDefaultSettings();
        const held = { ...base, ads: { ...base.ads, queued: '30', reserved: claim() } };
        const storedHeld = inflateSettings(deflateSettings(migrateSettings(JSON.parse(JSON.stringify(held)))));
        expect(validateSettings(storedHeld).ok).toBe(true);
        expect(storedHeld.ads.reserved).toEqual(claim());
        expect(adsReservationOf(storedHeld)).toEqual(claim());

        const cleared = stepAdsQueue(storedHeld, { donationIncluded: false, reservationId: 'tx-a', accrue: false });
        expect(cleared.ads.reserved).toBeUndefined();
        const storedCleared = inflateSettings(deflateSettings(migrateSettings(JSON.parse(JSON.stringify(cleared)))));
        expect(validateSettings(storedCleared).ok).toBe(true);
        expect(storedCleared.ads.reserved).toBeUndefined();
        expect(storedCleared.ads.queued).toBe('30');
    });

    it('the claim id and network verdict reach the stored queue entry through the enqueue hook', async () => {
        let blob = {};
        const storage = {
            async load() { return structuredClone(blob); },
            async loadSettlements() { return []; },
            async save(next) { blob = structuredClone(next); },
            async saveSettlements() {},
            async clear() { blob = {}; },
        };
        const engine = createBroadcastQueueEngine({
            store: createBroadcastQueueStore({ storage, prunedLedger: null }),
            importedAddressIdsFor: async () => new Set(),
            discardQueuedBroadcast: async () => {},
        });
        const saved = await engine.enqueueOnBroadcastFailure('w1')({
            chainId: 'bitcoin-mainnet', signedTxHex: 'signed', txid: 'txid-1', signedAt: 1, summary: 'Send',
            pendingTxId: 'tx-a',
            adsCommit: {
                chainId: 'bitcoin-mainnet', donationIncluded: true, donatedFiat: '30', currency: 'USD',
                mainnet: true, reservationId: 'tx-a', stray: 'dropped',
            },
        });
        expect(saved).toBe(true);
        expect(blob.w1[0].adsCommit).toEqual({
            chainId: 'bitcoin-mainnet', donationIncluded: true, donatedFiat: '30', currency: 'USD',
            mainnet: true, reservationId: 'tx-a',
        });
    });

    it('the stored claim passes the settings schema, and a malformed one is ignored', () => {
        const base = createDefaultSettings();
        expect(validateSettings({ ...base, ads: { ...base.ads, reserved: claim() } }).ok).toBe(true);
        expect(validateSettings({ ...base, ads: { ...base.ads, reserved: { id: '' } } }).ok).toBe(false);
        expect(adsReservationOf({ ads: { reserved: { id: 'x' } } })).toBeNull();
        expect(adsReservationOf({ ads: { reserved: claim() } })).toEqual(claim());
    });
});

describe('settling and releasing', () => {
    it('reports a booking only when this call credits the held payout', async () => {
        const w = wallet({ queued: '30.05', reserved: claim() });
        const first = await commitAdsStepWithBooking({
            vault: w.vault, donationIncluded: true, reservationId: 'tx-a',
        });
        expect(first.booking).toEqual({ fiat: '30', currency: 'USD' });
        const replay = await commitAdsStepWithBooking({
            vault: w.vault, donationIncluded: true, donatedFiat: '30', currency: 'USD', reservationId: 'tx-a',
        });
        expect(replay.booking).toBeNull();
    });

    it('the broadcast that holds the claim takes the claimed amount off once', async () => {
        const w = wallet({ queued: '30.05', reserved: claim() });
        await commitAdsStep({ vault: w.vault, donationIncluded: true, donatedFiat: '30', currency: 'USD', mainnet: true, reservationId: 'tx-a' });
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
        // The same verdict booked again (a replayed landing) only accrues.
        await commitAdsStep({ vault: w.vault, donationIncluded: true, donatedFiat: '30', currency: 'USD', mainnet: true, reservationId: 'tx-a' });
        expect(w.ads()).toMatchObject({ queued: '0.15', donated: '30', donationCount: 1 });
    });

    it('settleAdsReservation pays the claim without accruing, and only the named one', async () => {
        const w = wallet({ reserved: claim() });
        expect(await settleAdsReservation({ vault: w.vault, reservationId: 'other' })).toBe(false);
        expect(w.vault.settings.put).not.toHaveBeenCalled();
        expect(await settleAdsReservation({ vault: w.vault, reservationId: 'tx-a' })).toBe(true);
        expect(w.ads()).toMatchObject({ queued: '0', donated: '30', donationCount: 1 });
        expect(await settleAdsReservation({ vault: w.vault, reservationId: 'tx-a' })).toBe(false);
        expect(w.ads()).toMatchObject({ donated: '30', donationCount: 1 });
    });

    it('releasing keeps the queue due and moves no amount', async () => {
        const w = wallet({ reserved: claim() });
        expect(await releaseAdsReservation({ vault: w.vault, reservationId: 'tx-a' })).toBe(true);
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a claim settles on a mainnet chain even after the wallet switched to testnet', async () => {
        const w = wallet({ reserved: claim() });
        await w.vault.settings.put({ ...w.settings(), activeNetwork: 'testnet' });
        expect(await settleAdsReservation({ vault: w.vault, reservationId: 'tx-a' })).toBe(true);
        expect(w.ads()).toMatchObject({ donated: '30', donationCount: 1 });
    });
});

describe('reconcileAdsReservation judges a claim whose owner may be gone', () => {
    const record = (status) => ({ id: 'tx-a', chain: 'bitcoin', network: 'mainnet', status });

    it.each(['queued', 'broadcasting'])('keeps a claim whose record is %s', async (status) => {
        const w = wallet({ reserved: claim({ at: 0 }) }, [record(status)]);
        await reconcileAdsReservation({ vault: w.vault, now: NOW });
        expect(w.ads().reserved?.id).toBe('tx-a');
        expect(w.vault.settings.put).not.toHaveBeenCalled();
    });

    it.each(['broadcast', 'indexed', 'rbf-replaced'])('settles a claim whose record is %s', async (status) => {
        const w = wallet({ reserved: claim() }, [record(status)]);
        await reconcileAdsReservation({ vault: w.vault, now: NOW });
        expect(w.ads().reserved).toBeUndefined();
        expect(w.ads()).toMatchObject({ queued: '0', donated: '30', donationCount: 1 });
    });

    it('releases a claim whose record failed or is gone', async () => {
        const failed = wallet({ reserved: claim() }, [record('failed')]);
        await reconcileAdsReservation({ vault: failed.vault, now: NOW });
        expect(failed.ads()).toMatchObject({ queued: '30', donated: '0' });
        expect(failed.ads().reserved).toBeUndefined();
        const gone = wallet({ reserved: claim() });
        await reconcileAdsReservation({ vault: gone.vault, now: NOW });
        expect(gone.ads().reserved).toBeUndefined();
    });

    it('lets a never-signed claim go only after the signing grace', async () => {
        const fresh = wallet({ reserved: claim() }, [record('awaiting-signature')]);
        await reconcileAdsReservation({ vault: fresh.vault, now: NOW + 60_000 });
        expect(fresh.ads().reserved?.id).toBe('tx-a');
        await reconcileAdsReservation({ vault: fresh.vault, now: NOW + ADS_RESERVATION_SIGNING_GRACE_MS + 1 });
        expect(fresh.ads().reserved).toBeUndefined();
    });

    it('a claim with no record lapses only after its TTL', async () => {
        const w = wallet({ reserved: claim({ id: 'ads-x', pendingTxId: null }) });
        await reconcileAdsReservation({ vault: w.vault, now: NOW + ADS_RESERVATION_TTL_MS - 1 });
        expect(w.ads().reserved?.id).toBe('ads-x');
        await reconcileAdsReservation({ vault: w.vault, now: NOW + ADS_RESERVATION_TTL_MS + 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('never takes a claim a submit in this process is holding', async () => {
        const w = wallet();
        expect(await reserveAdsPayout({ vault: w.vault, id: 'live', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet', pendingTxId: 'live', now: 0 })).toBe(true);
        // Its record does not exist yet, which would otherwise read as gone.
        await reconcileAdsReservation({ vault: w.vault, now: NOW });
        expect(w.ads().reserved?.id).toBe('live');
        forgetInFlightAdsReservation('live');
        await reconcileAdsReservation({ vault: w.vault, now: NOW });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('keeps the claim when its record cannot be read', async () => {
        const w = wallet({ reserved: claim() });
        w.vault.pendingTxs.get = vi.fn(async () => { throw new Error('locked'); });
        await reconcileAdsReservation({ vault: w.vault, now: NOW });
        expect(w.ads().reserved?.id).toBe('tx-a');
    });
});

describe('the core queued-broadcast lane settles and releases the claim', () => {
    const queued = () => ({
        schemaVersion: 1, id: 'tx-a', chain: 'bitcoin', network: 'mainnet', fromAddress: 'a', toAddress: 'b',
        action: 'SEND', actionSummary: 'Send', psbtHex: 'aa', txHex: 'deadbeef', txid: null, status: 'queued',
        createdAt: new Date(0).toISOString(), broadcastAt: null, confirmedAt: null, rbfReplacement: null, error: null,
    });
    const chainRegistry = { chainIdFor: () => 'bitcoin-mainnet', get: () => ({ coin: 'bitcoin', networkKind: 'mainnet' }) };
    const sdkWith = (broadcastTx) => ({ get: () => ({ encoder: { broadcastTx } }) });
    // A queued XChain action on mainnet waits for launch: run a day past it.
    beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue((MAINNET_LAUNCH_EPOCH + 86_400) * 1000); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('a drained send that lands settles the claim', async () => {
        const w = wallet({ reserved: claim() }, [queued()]);
        const out = await drainQueuedBroadcast({ vault: w.vault, sdkRegistry: sdkWith(async () => ({ txid: 't' })), chainRegistry, pendingTxId: 'tx-a' });
        expect(out.broadcast).toBe(true);
        expect(w.ads()).toMatchObject({ queued: '0', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a drained send refused for good releases it', async () => {
        const w = wallet({ reserved: claim() }, [queued()]);
        const out = await drainQueuedBroadcast({
            vault: w.vault,
            sdkRegistry: sdkWith(async () => { throw new Error('rejected: bad-txns-inputs-missingorspent'); }),
            chainRegistry,
            pendingTxId: 'tx-a',
        });
        expect(out.permanence).toBe('permanent');
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0' });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a discard releases it', async () => {
        const w = wallet({ reserved: claim() }, [queued()]);
        expect(await discardQueuedBroadcast({ vault: w.vault, pendingTxId: 'tx-a' })).toBe(true);
        expect(w.ads().reserved).toBeUndefined();
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0' });
    });
});
