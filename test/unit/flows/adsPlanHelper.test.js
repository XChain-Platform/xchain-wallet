// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The automatic donation payout (§36, ruling 2026-11-14): when the one fiat
// queue reaches its send-at total, the next send on ANY chain carries the
// whole queue, converted at the current price, to the recipient's address on
// that network; with no price, under the dust floor, or when the address
// cannot cover it, the send goes out without it and the queue is kept.

import { describe, it, expect, vi } from 'vitest';
import {
    createTxWithAdsFallback,
    foldAdsOutput,
    resolveAdsPayout,
    withAdsAtEncode,
} from '../../../packages/core/src/flows/ads.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { dustThresholdForCoin } from '../../../packages/core/src/sdk/nativeFeePreflight.js';

const registry = defaultRegistry();

function settingsWith(ads) {
    const s = createDefaultSettings();
    return { ...s, ads: { ...s.ads, ...ads } };
}
const due = (extra = {}) => settingsWith({ queued: '25', sendAt: '25', ...extra });
const rateOf = (rate) => vi.fn(async () => ({ rate, stale: false }));

describe('resolveAdsPayout', () => {
    it('pays the whole queue converted at the current price, on every chain', async () => {
        const btc = await resolveAdsPayout({
            settings: due(), chainId: 'bitcoin-mainnet', chainRegistry: registry, rateLoader: rateOf(100000),
        });
        expect(btc).toMatchObject({
            canSubmit: true,
            reason: 'ok',
            donationAmount: 25000, // $25 at $100,000 = 0.00025 BTC
            coinAmount: '0.00025',
            donationFiat: '25',
            currency: 'USD',
            recipient: 'protocol',
            ticker: 'BTC',
            donationAddress: registry.get('bitcoin-mainnet').adsDonationAddresses.DONATE1,
        });
        const doge = await resolveAdsPayout({
            settings: due({ recipient: 'community' }), chainId: 'dogecoin-mainnet', chainRegistry: registry, rateLoader: rateOf(0.25),
        });
        expect(doge).toMatchObject({
            canSubmit: true,
            donationAmount: 10000000000, // 100 DOGE
            donationAddress: registry.get('dogecoin-mainnet').adsDonationAddresses.DONATE2,
        });
    });

    it('keeps the $5 default payout above dust at the e2e fixture prices', async () => {
        const prices = {
            'bitcoin-mainnet': 65000,
            'litecoin-mainnet': 80,
            'dogecoin-mainnet': 0.1,
        };
        for (const [chainId, price] of Object.entries(prices)) {
            const descriptor = registry.get(chainId);
            const plan = await resolveAdsPayout({
                settings: settingsWith({ queued: '5' }),
                chainId,
                chainRegistry: registry,
                rateLoader: rateOf(price),
            });
            expect(plan.canSubmit, chainId).toBe(true);
            expect(BigInt(plan.donationAmount), chainId)
                .toBeGreaterThan(BigInt(dustThresholdForCoin(descriptor.coin)));
        }
    });

    it('never pays from a test network, and asks no price there', async () => {
        const loader = rateOf(0.25);
        for (const chainId of ['dogecoin-testnet', 'bitcoin-regtest']) {
            const plan = await resolveAdsPayout({ settings: due(), chainId, chainRegistry: registry, rateLoader: loader });
            expect(plan).toMatchObject({ canSubmit: false, reason: 'test-network' });
        }
        const switched = await resolveAdsPayout({
            settings: { ...due(), activeNetwork: 'testnet' }, chainId: 'bitcoin-mainnet', chainRegistry: registry, rateLoader: loader,
        });
        expect(switched).toMatchObject({ canSubmit: false, reason: 'test-network' });
        expect(loader).not.toHaveBeenCalled();
    });

    it('pays nothing while another pending send holds the claim on the queue', async () => {
        const loader = rateOf(100000);
        const reserved = { id: 'tx-a', fiat: '25', currency: 'USD', chainId: 'bitcoin-mainnet', pendingTxId: 'tx-a', at: 1 };
        const plan = await resolveAdsPayout({
            settings: due({ reserved }), chainId: 'litecoin-mainnet', chainRegistry: registry, rateLoader: loader,
        });
        expect(plan).toMatchObject({ canSubmit: false, reason: 'reserved', donationAmount: 0 });
        expect(loader).not.toHaveBeenCalled();
    });

    it('waits below the send-at total, and is off at None', async () => {
        const loader = rateOf(100000);
        const below = await resolveAdsPayout({
            settings: settingsWith({ queued: '24.95', sendAt: '25' }), chainId: 'bitcoin-mainnet', chainRegistry: registry, rateLoader: loader,
        });
        expect(below).toMatchObject({ canSubmit: false, reason: 'below-send-at' });
        const off = await resolveAdsPayout({
            settings: due({ perTransaction: '0' }), chainId: 'bitcoin-mainnet', chainRegistry: registry, rateLoader: loader,
        });
        expect(off).toMatchObject({ canSubmit: false, reason: 'ads-off' });
        // No price is asked for until a payout is due.
        expect(loader).not.toHaveBeenCalled();
    });

    it('sends without a donation when there is no current price', async () => {
        const plan = await resolveAdsPayout({
            settings: due(), chainId: 'bitcoin-mainnet', chainRegistry: registry, rateLoader: vi.fn(async () => null),
        });
        expect(plan).toMatchObject({ canSubmit: false, reason: 'no-price', donationAmount: 0 });
        const thrown = await resolveAdsPayout({
            settings: due(), chainId: 'bitcoin-mainnet', chainRegistry: registry,
            rateLoader: vi.fn(async () => { throw new Error('offline'); }),
        });
        expect(thrown).toMatchObject({ canSubmit: false, reason: 'no-price' });
    });

    it('sends without a donation when the output would be under the dust floor', async () => {
        // $1 at $1,000,000 is 100 sats, under Bitcoin's 546.
        const plan = await resolveAdsPayout({
            settings: due({ queued: '1', sendAt: '1' }), chainId: 'bitcoin-mainnet', chainRegistry: registry, rateLoader: rateOf(1000000),
        });
        expect(plan).toMatchObject({ canSubmit: false, reason: 'dust' });
        // The SDK's live floor wins over the bundled table.
        const sdk = { wallet: { getBitcoinNetwork: () => ({ dustThreshold: 30000 }) } };
        const live = await resolveAdsPayout({
            settings: due(), chainId: 'bitcoin-mainnet', chainRegistry: registry, sdk, rateLoader: rateOf(100000),
        });
        expect(live).toMatchObject({ canSubmit: false, reason: 'dust' });
        const unknownFloor = await resolveAdsPayout({
            settings: due(),
            chainId: 'custom-mainnet',
            chainRegistry: {
                get: () => ({ ...registry.get('bitcoin-mainnet'), coin: 'custom' }),
            },
            rateLoader: rateOf(100000),
        });
        expect(unknownFloor).toMatchObject({ canSubmit: false, reason: 'dust' });
    });

    it('never pays a placeholder or unknown address', async () => {
        const descriptor = { ...registry.get('bitcoin-mainnet'), adsDonationAddresses: undefined, adsDonationAddress: 'PLACEHOLDER_REPLACE_BEFORE_MAINNET' };
        const plan = await resolveAdsPayout({
            settings: due(), chainId: 'x', chainRegistry: { get: () => descriptor }, rateLoader: rateOf(100000),
        });
        expect(plan).toMatchObject({ canSubmit: false, reason: 'address-not-configured' });
        const unknown = await resolveAdsPayout({ settings: due(), chainId: 'nope', chainRegistry: registry });
        expect(unknown).toMatchObject({ canSubmit: false, reason: 'unknown-chain' });
    });
});

const PLAN = {
    canSubmit: true, reason: 'ok', donationAmount: 25000, donationAddress: 'bc1qdonate',
    donationFiat: '25', coinAmount: '0.00025', currency: 'USD', recipient: 'protocol', ticker: 'BTC',
};

describe('affordability is the encoder answer', () => {
    it('folds the donation after the caller outputs', () => {
        expect(foldAdsOutput(PLAN, { customOutputs: [{ address: 'pay', value: 1 }] }).customOutputs)
            .toEqual([{ address: 'pay', value: 1 }, { address: 'bc1qdonate', value: 25000 }]);
        const opts = { customOutputs: [] };
        expect(foldAdsOutput({ ...PLAN, canSubmit: false }, opts)).toBe(opts);
    });

    it('keeps the donation when the build succeeds with it', async () => {
        const build = vi.fn(async () => ({ psbt: 'P' }));
        const out = await createTxWithAdsFallback({ plan: PLAN, encoderOpts: { customOutputs: [] }, build });
        expect(build).toHaveBeenCalledTimes(1);
        expect(out.plan.canSubmit).toBe(true);
        expect(out.encoderOpts.customOutputs).toEqual([{ address: 'bc1qdonate', value: 25000 }]);
    });

    it('rebuilds without it when the address cannot cover payment, donation and fees', async () => {
        const build = vi.fn(async (opts) => {
            if (opts.customOutputs.length > 1) {
                throw Object.assign(new Error('Insufficient funds'), { data: { reason: 'INSUFFICIENT_FUNDS' } });
            }
            return { psbt: 'P' };
        });
        const out = await createTxWithAdsFallback({
            plan: PLAN, encoderOpts: { customOutputs: [{ address: 'pay', value: 1 }] }, build,
        });
        expect(build).toHaveBeenCalledTimes(2);
        expect(build.mock.calls[1][0].customOutputs).toEqual([{ address: 'pay', value: 1 }]);
        expect(out.plan).toMatchObject({ canSubmit: false, reason: 'unaffordable' });
    });

    it('surfaces the send own error, never one caused by the donation', async () => {
        const build = vi.fn(async (opts) => {
            throw new Error(opts.customOutputs.length ? 'with donation' : 'the send itself');
        });
        await expect(createTxWithAdsFallback({ plan: PLAN, encoderOpts: { customOutputs: [] }, build }))
            .rejects.toThrow('the send itself');
    });

    it('does not retry a cancelled build', async () => {
        const controller = new AbortController();
        controller.abort();
        const build = vi.fn(async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); });
        await expect(createTxWithAdsFallback({
            plan: PLAN, encoderOpts: { customOutputs: [] }, build, signal: controller.signal,
        })).rejects.toThrow('cancelled');
        expect(build).toHaveBeenCalledTimes(1);
    });

    it('the live-build wrapper takes the donation back out of the shared array on a refusal', async () => {
        const createTx = vi.fn(async (opts) => {
            if (opts.customOutputs.some((o) => o.address === 'bc1qdonate')) throw new Error('Insufficient funds');
            return { psbt: 'P' };
        });
        const sdk = { encoder: { createTx } };
        const { registry: wrapped, state } = withAdsAtEncode({ get: () => sdk }, PLAN, 'bitcoin-mainnet');
        const shared = [{ address: 'pay', value: 1 }];
        await wrapped.get('bitcoin-mainnet').encoder.createTx({ customOutputs: shared });
        expect(createTx).toHaveBeenCalledTimes(2);
        expect(shared).toEqual([{ address: 'pay', value: 1 }]);
        expect(state.included).toBe(false);
    });

    it('the live-build wrapper keeps it in the shared array when it fits', async () => {
        const createTx = vi.fn(async () => ({ psbt: 'P' }));
        const { registry: wrapped, state } = withAdsAtEncode({ get: () => ({ encoder: { createTx } }) }, PLAN, 'bitcoin-mainnet');
        const shared = [];
        await wrapped.get('bitcoin-mainnet').encoder.createTx({ customOutputs: shared });
        expect(shared).toEqual([{ address: 'bc1qdonate', value: 25000 }]);
        expect(state.included).toBe(true);
        // Another chain's encoder is left alone.
        expect(wrapped.get('litecoin-mainnet').encoder.createTx).toBe(createTx);
    });
});
