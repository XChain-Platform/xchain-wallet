// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The automatic-donation claim is taken at COMPOSE time (§36, 2026-11-14).
// Bytes built with the donation cannot drop it after losing a later claim, so
// two confirm screens composed at once over different coins could both carry
// the whole queue. composeForConfirm now claims the queue (a review claim)
// when it plans the donation, so a second concurrent compose plans without it;
// the review's release (Reject, Back, a closed window) or its lapse lets it
// go, a rebuild without the donation lets it go, and Approve takes it over and
// settles it once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { prebuiltPsbtFromComposed } from '../../../packages/core/src/flows/prebuiltPsbtFromComposed.js';
import {
    ADS_RESERVATION_REVIEW_GRACE_MS,
    reconcileAdsReservation,
    reserveAdsPayout,
    returnAdsReservationToReview,
} from '../../../packages/core/src/flows/ads.js';
import { MAINNET_LAUNCH_EPOCH } from '../../../packages/core/src/flows/mainnetPrelaunch.js';
import {
    createDefaultSettings,
    deflateSettings,
    inflateSettings,
    validateSettings,
} from '../../../packages/core/src/schemas/settings.js';
import { migrateSettings } from '../../../packages/core/src/schemas/migrations.js';

// A fixed coin price: the due $30 queue is 0.0003 coin = 30,000 sats.
vi.mock('../../../packages/core/src/flows/priceLookup.js', async (importOriginal) => ({
    ...(await importOriginal()),
    refreshFiatRates: vi.fn(async () => ({ updated: [] })),
    getFiatRate: vi.fn(() => ({ rate: 100000, stale: false, chainCoin: 'bitcoin', fiatCurrency: 'USD' })),
}));

// An XChain action on a mainnet chain waits for launch, so the clock reads a day past it.
const NOW = (MAINNET_LAUNCH_EPOCH + 86_400) * 1000;
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { vi.restoreAllMocks(); });

const DESCRIPTORS = {
    'bitcoin-mainnet': { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet', adsDonationAddress: 'bc1qdonate' },
    'litecoin-mainnet': { id: 'litecoin-mainnet', coin: 'litecoin', networkKind: 'mainnet', adsDonationAddress: 'ltc1qdonate' },
};

function memCollection() {
    const m = new Map();
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => Array.from(m.values()).map((r) => structuredClone(r)),
        delete: async (id) => m.delete(id),
    };
}

function makeWallet() {
    const base = createDefaultSettings();
    let settings = { ...base, ads: { ...base.ads, queued: '30', sendAt: '25', perTransaction: '0.05' } };
    const vault = {
        pendingTxs: memCollection(),
        settings: {
            get: vi.fn(async () => structuredClone(settings)),
            put: vi.fn(async (next) => { settings = structuredClone(next); }),
        },
    };
    const sdks = {};
    const sdkFor = (chainId) => {
        if (!sdks[chainId]) {
            let n = 0;
            sdks[chainId] = {
                encoder: {
                    createTx: vi.fn(async (opts) => ({
                        psbt: `PSBT-${chainId}`,
                        encoding: 'OP_RETURN',
                        reservation: { id: `enc-${chainId}-${++n}` },
                        _opts: opts,
                    })),
                    releaseInputs: vi.fn(async () => ({ released: true })),
                    broadcastTx: vi.fn(async () => ({})),
                },
                actions: { createAction: vi.fn(() => ({ actionString: 'ISSUE|0|JDOG', action: 'ISSUE', version: 0 })) },
                wallet: {
                    getBitcoinNetwork: () => ({ dustThreshold: 546 }),
                    decomposePsbt: () => ({ inputs: [{}], outputs: [] }),
                },
            };
        }
        return sdks[chainId];
    };
    const sdkRegistry = { get: (chainId) => sdkFor(chainId) };
    const chainRegistry = { get: (chainId) => DESCRIPTORS[chainId] ?? null };
    const compose = (chainId, extra = {}) => composeForConfirm({
        sdkRegistry,
        chainRegistry,
        vault,
        chainId,
        actionData: { action: 'ISSUE', params: { TICK: 'JDOG' } },
        encoderOpts: { pubkey: 'pub', change: 'src' },
        source: 'src',
        ...extra,
    });
    const approve = (chainId, composed, signer) => submitAction({
        vault,
        walletId: 'w1',
        chainRegistry,
        sdkRegistry,
        chainId,
        actionData: { action: 'ISSUE', params: { TICK: 'JDOG' } },
        encoderOpts: { pubkey: 'pub', change: 'src', sourceAddress: 'src' },
        prebuiltPsbt: prebuiltPsbtFromComposed(composed),
        signer,
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        pendingTxMeta: { fromAddress: 'src', toAddress: 'src', actionSummary: 'Issue JDOG' },
    });
    return { vault, sdkFor, compose, approve, ads: () => settings.ads };
}

const goodSigner = () => ({
    kind: 'software',
    signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: 'txid-1' })),
});

const carries = (composed) => composed.adsPlan.canSubmit === true
    && composed.encoderOpts.customOutputs?.some((o) => /donate/.test(o.address));

describe('two confirm screens composed at once', () => {
    it('only one of them carries the donation, across two coins', async () => {
        const w = makeWallet();
        const [btc, ltc] = await Promise.all([w.compose('bitcoin-mainnet'), w.compose('litecoin-mainnet')]);
        const carrying = [btc, ltc].filter(carries);
        expect(carrying).toHaveLength(1);
        const other = carrying[0] === btc ? ltc : btc;
        expect(other.adsPlan).toMatchObject({ canSubmit: false, reason: 'reserved' });
        expect(other.encoderOpts.customOutputs ?? []).toEqual([]);
        // The winner's review claim is what the queue holds, and nothing moved.
        expect(w.ads().reserved).toMatchObject({
            id: carrying[0].adsPlan.reservationId, fiat: '30', currency: 'USD', review: true, pendingTxId: null,
        });
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });
    });

    it('a compose that cannot write the claim composes without the donation', async () => {
        const w = makeWallet();
        w.vault.settings.put.mockRejectedValueOnce(new Error('disk full'));
        const composed = await w.compose('bitcoin-mainnet');
        expect(composed.adsPlan).toMatchObject({ canSubmit: false, reason: 'reserved' });
        expect(carries(composed)).toBe(false);
    });

    it('a probe that is never shown (claimAds false) plans it without claiming the queue', async () => {
        const w = makeWallet();
        const probe = await w.compose('bitcoin-mainnet', { claimAds: false });
        expect(probe.adsPlan.canSubmit).toBe(true);
        expect(w.ads().reserved).toBeUndefined();
        expect(w.vault.settings.put).not.toHaveBeenCalled();
    });
});

describe('an abandoned review lets the claim go', () => {
    it('its release (Reject, Back, closing) frees the claim and the encoder inputs, so the next review carries it', async () => {
        const w = makeWallet();
        const first = await w.compose('bitcoin-mainnet');
        expect(carries(first)).toBe(true);
        const blocked = await w.compose('litecoin-mainnet');
        expect(carries(blocked)).toBe(false);

        await first.releaseEncoderInputs();
        expect(w.ads().reserved).toBeUndefined();
        expect(w.sdkFor('bitcoin-mainnet').encoder.releaseInputs).toHaveBeenCalledWith('enc-bitcoin-mainnet-1');
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });

        const next = await w.compose('litecoin-mainnet');
        expect(carries(next)).toBe(true);
    });

    it('a review that is never released lapses after its grace, never before', async () => {
        const w = makeWallet();
        const first = await w.compose('bitcoin-mainnet');
        const at = w.ads().reserved.at;
        await reconcileAdsReservation({ vault: w.vault, now: at + ADS_RESERVATION_REVIEW_GRACE_MS - 1 });
        expect(w.ads().reserved?.id).toBe(first.adsPlan.reservationId);
        await reconcileAdsReservation({ vault: w.vault, now: at + ADS_RESERVATION_REVIEW_GRACE_MS + 1 });
        expect(w.ads().reserved).toBeUndefined();
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0' });
    });

    it('a build that fails, or is aborted, gives the claim back', async () => {
        const w = makeWallet();
        const enc = w.sdkFor('bitcoin-mainnet').encoder;
        enc.createTx.mockRejectedValueOnce(new Error('Insufficient funds'))
            .mockRejectedValueOnce(new Error('Insufficient funds'));
        await expect(w.compose('bitcoin-mainnet')).rejects.toThrow(/Insufficient funds/);
        expect(w.ads().reserved).toBeUndefined();

        const controller = new AbortController();
        enc.createTx.mockImplementationOnce(async () => {
            controller.abort();
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        });
        await expect(w.compose('bitcoin-mainnet', { signal: controller.signal })).rejects.toThrow(/aborted/);
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a review rebuilt without the donation gives the claim back', async () => {
        const w = makeWallet();
        w.sdkFor('bitcoin-mainnet').encoder.createTx.mockRejectedValueOnce(new Error('Insufficient funds'));
        const composed = await w.compose('bitcoin-mainnet');
        expect(composed.adsPlan).toMatchObject({ canSubmit: false, reason: 'unaffordable' });
        expect(w.ads().reserved).toBeUndefined();
    });
});

describe('Approve takes the review claim over and settles it once', () => {
    it('settles the donation once, and a late release of the review changes nothing', async () => {
        const w = makeWallet();
        const composed = await w.compose('bitcoin-mainnet');
        const reviewId = composed.adsPlan.reservationId;
        const result = await w.approve('bitcoin-mainnet', composed, goodSigner());
        // 30 queued, 30 donated, plus this send's own 0.05.
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
        expect(result.pendingTxId).toBeTruthy();

        // The screen's release after Approve (or a replayed one) names a claim no longer held.
        await composed.releaseEncoderInputs();
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(reviewId).toMatch(/^ads-review-/);
    });

    it('while the approved send is pending, its claim is its PendingTx id, so no other review carries it', async () => {
        const w = makeWallet();
        const composed = await w.compose('bitcoin-mainnet');
        let releaseSign;
        const held = new Promise((resolve) => { releaseSign = resolve; });
        const signer = {
            kind: 'software',
            signPsbt: vi.fn(async ({ psbtHex }) => { await held; return { txHex: `TX(${psbtHex})`, txid: 'txid-1' }; }),
        };
        const sending = w.approve('bitcoin-mainnet', composed, signer);
        await vi.waitFor(() => expect(signer.signPsbt).toHaveBeenCalled());
        const claim = w.ads().reserved;
        expect(claim.review).toBeUndefined();
        expect(claim.id).not.toBe(composed.adsPlan.reservationId);
        expect(claim.pendingTxId).toBe(claim.id);
        expect(carries(await w.compose('litecoin-mainnet'))).toBe(false);
        releaseSign();
        await sending;
        expect(w.ads()).toMatchObject({ donated: '30', donationCount: 1 });
    });

    it('a failed Approve hands the claim back to the review, so retrying the same bytes still pays once', async () => {
        const w = makeWallet();
        const composed = await w.compose('bitcoin-mainnet');
        const signer = goodSigner();
        signer.signPsbt.mockRejectedValueOnce(Object.assign(new Error('Wrong password'), { name: 'InvalidPasswordError' }));
        await expect(w.approve('bitcoin-mainnet', composed, signer)).rejects.toThrow(/Wrong password/);
        expect(w.ads().reserved).toMatchObject({ id: composed.adsPlan.reservationId, review: true, pendingTxId: null });
        // Another review composed now still plans without it.
        expect(carries(await w.compose('litecoin-mainnet'))).toBe(false);

        await w.approve('bitcoin-mainnet', composed, signer);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a permanently refused broadcast releases the claim (its bytes can never be signed again)', async () => {
        const w = makeWallet();
        const composed = await w.compose('bitcoin-mainnet');
        w.sdkFor('bitcoin-mainnet').encoder.broadcastTx.mockRejectedValueOnce(
            Object.assign(new Error('rejected: bad-txns-inputs-missingorspent'), { code: -25 }));
        await expect(w.approve('bitcoin-mainnet', composed, goodSigner())).rejects.toThrow();
        expect(w.ads().reserved).toBeUndefined();
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });
    });
});

describe('the review claim record', () => {
    it('take-over needs the matching review id, amount and currency', async () => {
        const w = makeWallet();
        expect(await reserveAdsPayout({ vault: w.vault, id: 'r1', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet', review: true })).toBe(true);
        const ask = (over) => reserveAdsPayout({ vault: w.vault, id: 'tx-1', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet', pendingTxId: 'tx-1', ...over });
        expect(await ask({ takeOver: null })).toBe(false);
        expect(await ask({ takeOver: 'r2' })).toBe(false);
        expect(await ask({ takeOver: 'r1', fiat: '29' })).toBe(false);
        expect(await ask({ takeOver: 'r1', currency: 'EUR' })).toBe(false);
        expect(w.ads().reserved.id).toBe('r1');
        expect(await ask({ takeOver: 'r1' })).toBe(true);
        expect(w.ads().reserved).toEqual({ id: 'tx-1', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet', pendingTxId: 'tx-1', at: NOW });
        // Handing it back makes it the review claim again; only the named claim moves.
        expect(await returnAdsReservationToReview({ vault: w.vault, reservationId: 'other', reviewId: 'r1' })).toBe(false);
        expect(await returnAdsReservationToReview({ vault: w.vault, reservationId: 'tx-1', reviewId: 'r1' })).toBe(true);
        expect(w.ads().reserved).toMatchObject({ id: 'r1', pendingTxId: null, review: true });
    });

    it('survives the settings store and passes the schema; a malformed review flag is refused', () => {
        const base = createDefaultSettings();
        const review = { id: 'ads-review-1', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet', pendingTxId: null, at: NOW, review: true };
        const held = { ...base, ads: { ...base.ads, queued: '30', reserved: review } };
        const stored = inflateSettings(deflateSettings(migrateSettings(structuredClone(held))));
        expect(validateSettings(stored).ok).toBe(true);
        expect(stored.ads.reserved).toEqual(review);
        expect(validateSettings({ ...base, ads: { ...base.ads, reserved: { ...review, review: 'yes' } } }).ok).toBe(false);
    });
});
