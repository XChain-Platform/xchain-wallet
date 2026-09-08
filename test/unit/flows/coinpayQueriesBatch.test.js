// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Coalescing the COINPAY obligation reads (rate-limits spec, M3b row 57).
//
// The badge scan fires `getCoinpayObligationsForAddress` once per (chain,
// address) pair out of a single `Promise.all`, so a five-address wallet on
// three chains costs 15 requests per scan. Every one of those calls is on the
// same tick, which is what a 25 ms window exists to catch: 15 becomes 3, and no
// caller of the flow changes at all.
//
// What is pinned here: the window really coalesces and really chunks; each
// caller gets ITS OWN answer, not the batch; one caller's failure rejects only
// that caller; a 404 explorer is fallen back on and remembered; a rate limit
// rejects the batch rather than re-firing it per address; and an SDK without
// the method pays no timer at all, so the fallback path gains no latency.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getCoinpayObligationsForAddress,
    COINPAY_BATCH_WINDOW_MS,
    COINPAY_BATCH_MAX_ADDRESSES,
    _resetCoinpayBatching,
} from '../../../packages/core/src/flows/coinpayQueries.js';

const body = (address) => ({ total: 1, data: [{ payer_address: address, coinpay_status: 'pending_coinpay' }] });

/** The C54 response shape: one slot per address, keyed by address. */
function batchBodyFor(addresses, { failFor = {} } = {}) {
    const out = {};
    for (const a of addresses) {
        out[a] = failFor[a]
            ? { coinpay_obligations: null, error: failFor[a] }
            : { coinpay_obligations: body(a), error: null };
    }
    return out;
}

function makeSdk({ batch = true, batchImpl, perAddressImpl } = {}) {
    const sdk = {
        getCoinpayObligations: vi.fn(perAddressImpl || (async (address) => body(address))),
    };
    if (batch) {
        sdk.getCoinpayObligationsBatch = vi.fn(batchImpl || (async (addresses) => batchBodyFor(addresses)));
    }
    return sdk;
}

/** One SDK instance per chain id, the way SDKRegistry hands them out. */
function registryOf(map) {
    return { get: (chainId) => map[chainId] };
}

const call = (sdkRegistry, chainId, address, opts) => getCoinpayObligationsForAddress({
    sdkRegistry, chainId, address, opts,
});

/** Let the window close and every promise it armed settle. */
async function closeWindow() {
    await vi.advanceTimersByTimeAsync(COINPAY_BATCH_WINDOW_MS);
    await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
    _resetCoinpayBatching();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    _resetCoinpayBatching();
});

describe('getCoinpayObligationsForAddress coalesces same-tick calls into one request', () => {
    it('answers five callers of one chain with a single batch', async () => {
        const sdk = makeSdk();
        const registry = registryOf({ 'bitcoin-regtest': sdk });
        const addresses = ['A0', 'A1', 'A2', 'A3', 'A4'];
        const pending = addresses.map((a) => call(registry, 'bitcoin-regtest', a));

        // Nothing has gone out yet: the window is what makes the coalescing
        // possible, so the request must NOT be sent on the first call.
        expect(sdk.getCoinpayObligationsBatch).not.toHaveBeenCalled();

        await closeWindow();
        const results = await Promise.all(pending);

        expect(sdk.getCoinpayObligationsBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getCoinpayObligationsBatch.mock.calls[0][0]).toEqual(addresses);
        expect(sdk.getCoinpayObligations).not.toHaveBeenCalled();
        // Each caller gets ITS OWN body, not the batch envelope.
        expect(results).toEqual(addresses.map((a) => body(a)));
    });

    it('keeps two chains in two batches', async () => {
        const btc = makeSdk();
        const doge = makeSdk();
        const registry = registryOf({ 'bitcoin-regtest': btc, 'dogecoin-regtest': doge });
        const pending = [
            call(registry, 'bitcoin-regtest', 'B0'),
            call(registry, 'dogecoin-regtest', 'D0'),
            call(registry, 'bitcoin-regtest', 'B1'),
        ];
        await closeWindow();
        await Promise.all(pending);

        expect(btc.getCoinpayObligationsBatch).toHaveBeenCalledTimes(1);
        expect(btc.getCoinpayObligationsBatch.mock.calls[0][0]).toEqual(['B0', 'B1']);
        expect(doge.getCoinpayObligationsBatch).toHaveBeenCalledTimes(1);
        expect(doge.getCoinpayObligationsBatch.mock.calls[0][0]).toEqual(['D0']);
    });

    it('splits 21 same-tick callers into two requests of 20 and 1', async () => {
        const sdk = makeSdk();
        const registry = registryOf({ 'bitcoin-regtest': sdk });
        const addresses = Array.from({ length: 21 }, (_, i) => `X${i}`);
        const pending = addresses.map((a) => call(registry, 'bitcoin-regtest', a));
        await closeWindow();
        const results = await Promise.all(pending);

        expect(COINPAY_BATCH_MAX_ADDRESSES).toBe(20);
        expect(sdk.getCoinpayObligationsBatch).toHaveBeenCalledTimes(2);
        expect(sdk.getCoinpayObligationsBatch.mock.calls[0][0]).toHaveLength(20);
        expect(sdk.getCoinpayObligationsBatch.mock.calls[1][0]).toEqual(['X20']);
        expect(results[20]).toEqual(body('X20'));
    });

    it('opens a fresh window after the first one closes', async () => {
        const sdk = makeSdk();
        const registry = registryOf({ 'bitcoin-regtest': sdk });
        const first = call(registry, 'bitcoin-regtest', 'A0');
        await closeWindow();
        await first;
        const second = call(registry, 'bitcoin-regtest', 'A0');
        await closeWindow();
        await second;
        expect(sdk.getCoinpayObligationsBatch).toHaveBeenCalledTimes(2);
    });
});

describe('a per-entry failure belongs to its own caller', () => {
    it('rejects only the address whose slot carries an error', async () => {
        const sdk = makeSdk({
            batchImpl: async (addresses) => batchBodyFor(addresses, {
                failFor: { A1: { code: 'EXPLORER_HTTP_500', error: 'obligation join failed', status: 500 } },
            }),
        });
        const registry = registryOf({ 'bitcoin-regtest': sdk });
        // Settled by outcome rather than awaited later: the rejection lands
        // while the window flushes, so a handler has to be on it by then.
        const settle = (a) => call(registry, 'bitcoin-regtest', a).then(
            (v) => ({ ok: true, v }), (e) => ({ ok: false, e }),
        );
        const good = settle('A0');
        const bad = settle('A1');
        const alsoGood = settle('A2');
        await closeWindow();

        expect(await good).toEqual({ ok: true, v: body('A0') });
        expect(await alsoGood).toEqual({ ok: true, v: body('A2') });
        const failed = await bad;
        expect(failed.ok).toBe(false);
        expect(failed.e.message).toMatch(/obligation join failed/);
        expect(failed.e.code).toBe('EXPLORER_HTTP_500');
        expect(failed.e.status).toBe(500);
    });
});

describe('an explorer without the route is fallen back on and remembered', () => {
    it('treats the typed EXPLORER_BATCH_UNSUPPORTED (a JSON-RPC error at 200 from an older explorer) like the 404', async () => {
        const unsupported = new Error('Explorer does not serve /RBTC/api/coinpay_obligations');
        unsupported.code = 'EXPLORER_BATCH_UNSUPPORTED';
        const sdk = makeSdk({ batchImpl: async () => { throw unsupported; } });
        const registry = registryOf({ 'bitcoin-regtest': sdk });
        const pending = ['A0', 'A1'].map((a) => call(registry, 'bitcoin-regtest', a));
        await closeWindow();
        expect(await Promise.all(pending)).toEqual([body('A0'), body('A1')]);
        expect(await call(registry, 'bitcoin-regtest', 'A2')).toEqual(body('A2'));
        expect(sdk.getCoinpayObligationsBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getCoinpayObligations).toHaveBeenCalledTimes(3);
    });

    it('re-issues the window per address on a 404, then never batches again', async () => {
        const notFound = new Error('Explorer returned HTTP 404 for /RBTC/api/coinpay_obligations');
        notFound.code = 'EXPLORER_HTTP_404';
        const sdk = makeSdk({ batchImpl: async () => { throw notFound; } });
        const registry = registryOf({ 'bitcoin-regtest': sdk });

        const pending = ['A0', 'A1'].map((a) => call(registry, 'bitcoin-regtest', a));
        await closeWindow();
        expect(await Promise.all(pending)).toEqual([body('A0'), body('A1')]);
        expect(sdk.getCoinpayObligationsBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getCoinpayObligations).toHaveBeenCalledTimes(2);
        expect(sdk.getCoinpayObligations.mock.calls[0]).toEqual(['A0', 'address', undefined]);

        // The memo is what stops the wallet spending a wasted probe on every
        // later scan, and it also drops the window: a fallback caller must not
        // pay 25 ms it gains nothing from.
        const later = call(registry, 'bitcoin-regtest', 'A2');
        expect(await later).toEqual(body('A2'));
        expect(sdk.getCoinpayObligationsBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getCoinpayObligations).toHaveBeenCalledTimes(3);
    });
});

describe('a rate-limited batch rejects its callers instead of re-firing per address', () => {
    it('rejects all five with the limit and reads nothing per address', async () => {
        const limited = new Error('Explorer returned HTTP 429; retry after 42 seconds');
        limited.name = 'SDKRateLimitedError';
        limited.code = 'RATE_LIMITED';
        limited.retryAfterSeconds = 42;
        const sdk = makeSdk({ batchImpl: async () => { throw limited; } });
        const registry = registryOf({ 'bitcoin-regtest': sdk });

        const pending = ['A0', 'A1', 'A2', 'A3', 'A4']
            .map((a) => call(registry, 'bitcoin-regtest', a).catch((e) => e));
        await closeWindow();
        const settled = await Promise.all(pending);

        for (const e of settled) {
            expect(e.code).toBe('RATE_LIMITED');
            expect(e.retryAfterSeconds).toBe(42);
        }
        // Five per-address reads into an origin that just said stop is the
        // burst the whole batch route exists to avoid.
        expect(sdk.getCoinpayObligations).not.toHaveBeenCalled();
    });
});

describe('an SDK without the batch method pays no window at all', () => {
    it('reads per address and resolves without any timer advancing', async () => {
        const sdk = makeSdk({ batch: false });
        const registry = registryOf({ 'bitcoin-regtest': sdk });
        // No closeWindow(): with fake timers installed, a promise that needed a
        // timer could not settle here. Awaiting it IS the assertion that the
        // fallback path is synchronous with respect to the window.
        const resp = await call(registry, 'bitcoin-regtest', 'A0', { limit: 5 });
        expect(resp).toEqual(body('A0'));
        expect(sdk.getCoinpayObligations).toHaveBeenCalledWith('A0', 'address', { limit: 5 });
        expect(COINPAY_BATCH_WINDOW_MS).toBe(25);
    });

    it('still refuses a call with no address', async () => {
        const registry = registryOf({ 'bitcoin-regtest': makeSdk() });
        await expect(call(registry, 'bitcoin-regtest', '')).rejects.toThrow(/address is required/);
        await expect(call(registry, '', 'A0')).rejects.toThrow(/chainId is required/);
        await expect(getCoinpayObligationsForAddress({ chainId: 'c', address: 'A0' }))
            .rejects.toThrow(/sdkRegistry is required/);
    });
});
