// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The automatic donation rule end to end through submitAction's live build
// (§36, ruling 2026-11-14), with the real price module behind a fake fetch:
// sends on one chain fill the one fiat queue, the send that finds it due pays
// the whole queue on ITS chain at ITS coin's price, the queue moves only after
// the broadcast, a build that cannot cover the donation goes out without it,
// the built-transaction check accepts the donation it carries, and a dApp
// bridge send (adsPayout false) only accrues. loadAdsRate is pinned against
// fresh, stale, failing, hanging and opted-out price sources.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { loadAdsRate } from '../../../packages/core/src/flows/ads.js';
import {
    _resetPriceLookupForTests,
    configureFiatRateSource,
} from '../../../packages/core/src/flows/priceLookup.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

// EUR keeps the price on the CoinGecko path (the oracle publishes USD only).
const PRICES = { bitcoin: 100000, litecoin: 100 };
const SOURCE = 'source-address';

// Only mainnet sends count; a native-coin payment needs no launch gate.
const DESCRIPTORS = {
    'bitcoin-mainnet': { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet', adsDonationAddresses: { DONATE1: 'btc-protocol', DONATE2: 'btc-community', EXPLORER: 'btc-explorer' }, adsDonationAddress: 'btc-protocol' },
    'litecoin-mainnet': { id: 'litecoin-mainnet', coin: 'litecoin', networkKind: 'mainnet', adsDonationAddresses: { DONATE1: 'ltc-protocol', DONATE2: 'ltc-community', EXPLORER: 'ltc-explorer' }, adsDonationAddress: 'ltc-protocol' },
    'bitcoin-regtest': { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest', adsDonationAddresses: { DONATE1: 'rbtc-protocol', DONATE2: 'rbtc-community', EXPLORER: 'rbtc-explorer' }, adsDonationAddress: 'rbtc-protocol' },
};
const TICKER = { 'bitcoin-mainnet': 'BTC', 'litecoin-mainnet': 'LTC', 'bitcoin-regtest': 'BTC' };

function coingeckoFetch({ prices = PRICES, fail = false, hang = false } = {}) {
    return vi.fn((url) => {
        if (hang) return new Promise(() => {});
        if (fail || !String(url).includes('/simple/price')) {
            return Promise.resolve({ ok: false, status: 404, json: async () => ({}), headers: new Headers() });
        }
        const body = {};
        if (prices.bitcoin) body.bitcoin = { eur: prices.bitcoin };
        if (prices.litecoin) body.litecoin = { eur: prices.litecoin };
        return Promise.resolve({ ok: true, status: 200, json: async () => body, headers: new Headers() });
    });
}

function wallet(ads) {
    const base = createDefaultSettings();
    let settings = { ...base, fiatCurrency: 'EUR', ads: { ...base.ads, currency: 'EUR', ...ads } };
    const vault = {
        settings: {
            get: vi.fn(async () => JSON.parse(JSON.stringify(settings))),
            put: vi.fn(async (r) => { settings = JSON.parse(JSON.stringify(r)); }),
        },
    };
    return { vault, ads: () => settings.ads };
}

function chainSdk({ refuseDonation = false, broadcastFails = false, donationAddresses = [] } = {}) {
    let lastOutputs = [];
    // Each build's outputs as they were at the call: the live path shares one
    // array, so the mock's own record would show it after the splice.
    const seen = [];
    const createTx = vi.fn(async (opts) => {
        const outputs = opts.customOutputs || [];
        seen.push(outputs.map((o) => ({ ...o })));
        if (refuseDonation && outputs.some((o) => donationAddresses.includes(o.address))) {
            throw Object.assign(new Error('Encoder RPC error: insufficient funds'), {
                data: { reason: 'INSUFFICIENT_FUNDS', available: 1, outputs: 2, fee: 1 },
            });
        }
        lastOutputs = outputs.map((o) => ({ ...o }));
        return { psbt: 'PSBTHEX', encoding: 'OP_RETURN' };
    });
    createTx.seen = seen;
    return {
        createTx,
        sdk: {
            actions: { createAction: vi.fn() },
            encoder: {
                createTx,
                broadcastTx: vi.fn(async () => {
                    if (broadcastFails) throw new Error('rejected: bad-txns-inputs-missingorspent');
                    return {};
                }),
            },
            wallet: {
                getBitcoinNetwork: () => ({ dustThreshold: 546 }),
                // The built transaction pays exactly what the encoder was asked
                // for, so the built-transaction check sees the real output set.
                decomposePsbt: () => ({
                    inputs: [{ address: SOURCE, value: 10_000_000_000 }],
                    outputs: lastOutputs.map((o) => ({ address: o.address, value: o.value, scriptType: 'p2wpkh' })),
                }),
            },
        },
    };
}

function send(w, chainId, chain, extra = {}) {
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({ signedPsbtHex: psbtHex, txHex: '02000000', txid: 'a'.repeat(64) })),
    };
    return submitAction({
        vault: w.vault,
        walletId: 'w1',
        chainRegistry: { get: (id) => DESCRIPTORS[id] },
        sdkRegistry: { get: () => chain.sdk },
        chainId,
        actionData: { action: 'SEND', params: { TICK: TICKER[chainId], AMOUNT: '0.001', DESTINATION: 'payee' } },
        encoderOpts: { pubkey: 'pub', sourceAddress: SOURCE, change: SOURCE },
        signer,
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        ...extra,
    });
}

const donationsIn = (createTx) => createTx.seen
    .map((outputs) => outputs.filter((o) => /protocol|community|explorer/.test(o.address)));

beforeEach(() => {
    _resetPriceLookupForTests();
    configureFiatRateSource({ fetch: coingeckoFetch(), now: () => Date.now() });
});
afterEach(() => _resetPriceLookupForTests());

describe('one queue, paid on whichever chain finds it due', () => {
    it('accrues on BTC sends, then the LTC send pays the whole queue at the LTC price and address', async () => {
        const w = wallet({ perTransaction: '10', sendAt: '20' });
        const btc = chainSdk();
        await send(w, 'bitcoin-mainnet', btc);
        await send(w, 'bitcoin-mainnet', btc);
        expect(donationsIn(btc.createTx).flat()).toEqual([]);
        expect(w.ads()).toMatchObject({ queued: '20', donated: '0' });

        const ltc = chainSdk();
        await send(w, 'litecoin-mainnet', ltc);
        // €20 at €100 per LTC = 0.2 LTC = 20,000,000 litoshi, to LTC's Protocol address.
        expect(donationsIn(ltc.createTx)).toEqual([[{ address: 'ltc-protocol', value: 20000000 }]]);
        // The paid €20 left the queue and this send added its own €10.
        expect(w.ads()).toMatchObject({ queued: '10', donated: '20', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('moves the queue only after the broadcast', async () => {
        const w = wallet({ queued: '25', sendAt: '25' });
        const chain = chainSdk({ broadcastFails: true });
        await expect(send(w, 'bitcoin-mainnet', chain)).rejects.toThrow();
        expect(donationsIn(chain.createTx).flat()).toHaveLength(1);
        // The only writes are the claim and its release: no amount ever moved.
        for (const [written] of w.vault.settings.put.mock.calls) {
            expect(written.ads).toMatchObject({ queued: '25', donated: '0', donationCount: 0 });
        }
        expect(w.ads()).toMatchObject({ queued: '25', donated: '0', donationCount: 0 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('sends without the donation when the address cannot cover it, and only accrues', async () => {
        const w = wallet({ queued: '25', sendAt: '25' });
        const chain = chainSdk({ refuseDonation: true, donationAddresses: ['btc-protocol'] });
        const result = await send(w, 'bitcoin-mainnet', chain);
        expect(result.txid).toBeTruthy();
        expect(chain.createTx).toHaveBeenCalledTimes(2);
        expect(donationsIn(chain.createTx)).toEqual([[{ address: 'btc-protocol', value: 25000 }], []]);
        expect(w.ads()).toMatchObject({ queued: '25.05', donated: '0', donationCount: 0 });
        // The claim went back when the build dropped the donation.
        expect(w.ads().reserved).toBeUndefined();
    });

    it('passes the built-transaction check with the donation kept, and with it taken back out', async () => {
        const kept = wallet({ queued: '25', sendAt: '25' });
        await send(kept, 'bitcoin-mainnet', chainSdk(), { verifyBuiltTx: true });
        expect(kept.ads()).toMatchObject({ donated: '25', donationCount: 1 });

        const spliced = wallet({ queued: '25', sendAt: '25' });
        await send(spliced, 'bitcoin-mainnet', chainSdk({ refuseDonation: true, donationAddresses: ['btc-protocol'] }), { verifyBuiltTx: true });
        expect(spliced.ads()).toMatchObject({ queued: '25.05', donated: '0' });
    });

    it('a dApp bridge send (adsPayout false) never carries the donation, but still accrues', async () => {
        const w = wallet({ queued: '25', sendAt: '25' });
        const chain = chainSdk();
        await send(w, 'bitcoin-mainnet', chain, { adsPayout: false, verifyBuiltTx: true });
        expect(donationsIn(chain.createTx).flat()).toEqual([]);
        expect(w.ads()).toMatchObject({ queued: '25.05', donated: '0' });
    });

    it('sends without a donation when no price can be had', async () => {
        configureFiatRateSource({ fetch: coingeckoFetch({ fail: true }) });
        const w = wallet({ queued: '25', sendAt: '25' });
        const chain = chainSdk();
        await send(w, 'bitcoin-mainnet', chain);
        expect(donationsIn(chain.createTx).flat()).toEqual([]);
        expect(w.ads()).toMatchObject({ queued: '25.05' });
    });

    it('a regtest send never pays the due queue and adds nothing to it', async () => {
        const w = wallet({ queued: '25', sendAt: '25' });
        const chain = chainSdk();
        await send(w, 'bitcoin-regtest', chain, { verifyBuiltTx: true });
        expect(donationsIn(chain.createTx).flat()).toEqual([]);
        expect(w.vault.settings.put).not.toHaveBeenCalled();
        expect(w.ads()).toMatchObject({ queued: '25', donated: '0', donationCount: 0 });
    });

    it('a mainnet send made while the wallet is on testnet neither pays nor accrues', async () => {
        const w = wallet({ queued: '25', sendAt: '25' });
        const testnet = JSON.parse(JSON.stringify(await w.vault.settings.get()));
        await w.vault.settings.put({ ...testnet, activeNetwork: 'testnet' });
        w.vault.settings.put.mockClear();
        const chain = chainSdk();
        await send(w, 'bitcoin-mainnet', chain);
        expect(donationsIn(chain.createTx).flat()).toEqual([]);
        expect(w.vault.settings.put).not.toHaveBeenCalled();
        expect(w.ads()).toMatchObject({ queued: '25', donated: '0' });
    });
});

describe('loadAdsRate', () => {
    const descriptor = DESCRIPTORS['bitcoin-mainnet'];

    it('returns a fresh price', async () => {
        const rate = await loadAdsRate({ descriptor, currency: 'EUR', settings: {} });
        expect(rate).toMatchObject({ rate: 100000, stale: false });
    });

    it('returns no price once the cached one is stale and the refresh fails', async () => {
        let now = 1_000_000_000_000;
        configureFiatRateSource({ fetch: coingeckoFetch(), now: () => now });
        expect(await loadAdsRate({ descriptor, currency: 'EUR', settings: {} })).not.toBeNull();
        now += 10 * 60 * 1000;
        configureFiatRateSource({ fetch: coingeckoFetch({ fail: true }) });
        expect(await loadAdsRate({ descriptor, currency: 'EUR', settings: {} })).toBeNull();
    });

    it('returns no price when the fetch fails', async () => {
        configureFiatRateSource({ fetch: coingeckoFetch({ fail: true }) });
        expect(await loadAdsRate({ descriptor, currency: 'EUR', settings: {} })).toBeNull();
    });

    it('gives up on a hung source at its timeout', async () => {
        configureFiatRateSource({ fetch: coingeckoFetch({ hang: true }) });
        const started = Date.now();
        expect(await loadAdsRate({ descriptor, currency: 'EUR', settings: {}, timeoutMs: 50 })).toBeNull();
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('never asks the third-party source when price data is off', async () => {
        const fetch = coingeckoFetch();
        configureFiatRateSource({ fetch });
        expect(await loadAdsRate({ descriptor, currency: 'EUR', settings: { privacy: { priceDataEnabled: false } } })).toBeNull();
        expect(fetch.mock.calls.some(([url]) => String(url).includes('coingecko'))).toBe(false);
    });
});
