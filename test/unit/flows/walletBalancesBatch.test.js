// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The aggregator on the batch balances route (rate-limits spec, M3b row 53).
//
// A five-address wallet on three chains asked the explorer for 30 reads every
// 20s poll, two per address, which is the sustained rate the zone rate limits
// have to clear. One POST per chain makes that 3. What has to hold while it
// does:
//
//   - the entries are the SAME entries. The acceptance case below drives both
//     paths from ONE set of stub bodies and deep-equals the results, so a
//     wallet on a new explorer and one on an old explorer render identically;
//   - an explorer with no batch route (404) is fallen back on AND remembered,
//     so the wallet does not spend a wasted probe on every later poll;
//   - a 429 does NOT fall back. Re-issuing the chunk per address would fire
//     the twenty reads the batch replaced, manufacturing the second 429.
//
// The SDK in node_modules (0.15.1) has no batch method at all, so these stubs
// are hand-written against the contract the SDK lane is building, exactly as
// walletBalances.errorShape.test.js and balancePartialRead.test.js do.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    walletBalances,
    BALANCES_BATCH_MAX_ADDRESSES,
    _resetBatchSupportMemo,
} from '../../../packages/core/src/flows/balances.js';

const CHAIN_ID = 'bitcoin-regtest';
const DESCRIPTORS = [{ id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' }];

const chainRegistry = {
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
};

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value)
            .map((r) => JSON.parse(JSON.stringify(r))),
    };
}

/** A wallet holding `addresses` on the one chain, in the order given. */
function makeVault(addresses) {
    return {
        wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'W', importedKeys: [] }]),
        accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
        addresses: memCollection(addresses.map((address, i) => ({
            id: `addr-${i}`,
            accountId: 'acct-1',
            chain: 'bitcoin',
            network: 'regtest',
            source: 'hd',
            addressType: 'p2pkh',
            derivationPath: `m/0'/0/${i}`,
            label: `Address ${i}`,
            address,
        }))),
    };
}

const balancesBody = (tick) => ({ total: 1, data: [{ tick, amount: '2000', decimals: 0 }] });
const addressBody = (confirmed) => ({ balances: { confirmed } });

/**
 * One fixture, two readers. `bodies[addr]` is what the explorer would answer
 * for that address on each half, or an `{ message, code }` failure. The two SDK
 * stubs below serve exactly the same fixture, which is what makes the
 * deep-equality case meaningful rather than a restatement of the code.
 */
function failure(message, code) {
    const e = new Error(message);
    e.code = code;
    e.status = Number(String(code).replace('EXPLORER_HTTP_', '')) || undefined;
    return e;
}

const FIXTURE = {
    A1: { balances: balancesBody('XCHAIN'), address: addressBody('1.50000000') },
    A2: { balances: balancesBody('PEPE'), address: failure('address endpoint 503', 'EXPLORER_HTTP_503') },
    A3: { balances: failure('balances endpoint 503', 'EXPLORER_HTTP_503'), address: addressBody('0.25000000') },
    A4: { balances: failure('explorer down', 'EXPLORER_HTTP_500'), address: failure('explorer down', 'EXPLORER_HTTP_500') },
};

function perAddressSdk(fixture) {
    return {
        getBalances: vi.fn(async (a) => {
            const v = fixture[a].balances;
            if (v instanceof Error) throw v;
            return v;
        }),
        getAddress: vi.fn(async (a) => {
            const v = fixture[a].address;
            if (v instanceof Error) throw v;
            return v;
        }),
    };
}

/** The batch response shape of C53, built from the same fixture. */
function batchBodyFor(addresses, fixture) {
    const out = {};
    for (const a of addresses) {
        const bal = fixture[a].balances;
        const addr = fixture[a].address;
        const firstError = bal instanceof Error ? bal : (addr instanceof Error ? addr : null);
        out[a] = {
            balances: bal instanceof Error ? null : bal,
            address: addr instanceof Error ? null : addr,
            error: firstError
                ? { code: firstError.code, error: firstError.message, status: firstError.status }
                : null,
        };
    }
    return out;
}

function batchSdk(fixture, { batchImpl } = {}) {
    const sdk = perAddressSdk(fixture);
    sdk.getBalancesBatch = vi.fn(batchImpl || (async (addresses) => batchBodyFor(addresses, fixture)));
    return sdk;
}

const registryFor = (sdk) => ({ get: () => sdk });

const run = (addresses, sdk) => walletBalances({
    vault: makeVault(addresses),
    walletId: 'w1',
    chainRegistry,
    sdkRegistry: registryFor(sdk),
});

beforeEach(() => { _resetBatchSupportMemo(); });

describe('walletBalances reads a chain in batches when the SDK and explorer allow it', () => {
    it('spends ONE request for five addresses, in the order it was given them', async () => {
        const addresses = ['P0', 'P1', 'P2', 'P3', 'P4'];
        const fixture = Object.fromEntries(addresses.map((a) => [a, FIXTURE.A1]));
        const sdk = batchSdk(fixture);
        const res = await run(addresses, sdk);
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getBalancesBatch.mock.calls[0][0]).toEqual(addresses);
        // The per-address endpoints are not touched at all: the point of the
        // route is that those 10 reads do not happen.
        expect(sdk.getBalances).not.toHaveBeenCalled();
        expect(sdk.getAddress).not.toHaveBeenCalled();
        expect(res[CHAIN_ID]).toHaveLength(5);
    });

    it('splits 25 addresses into 20 + 5 and returns them in order', async () => {
        const addresses = Array.from({ length: 25 }, (_, i) => `X${i}`);
        const fixture = Object.fromEntries(addresses.map((a) => [a, FIXTURE.A1]));
        const sdk = batchSdk(fixture);
        const res = await run(addresses, sdk);
        expect(BALANCES_BATCH_MAX_ADDRESSES).toBe(20);
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(2);
        expect(sdk.getBalancesBatch.mock.calls[0][0]).toHaveLength(20);
        expect(sdk.getBalancesBatch.mock.calls[1][0]).toEqual(['X20', 'X21', 'X22', 'X23', 'X24']);
        expect(res[CHAIN_ID].map((e) => e.address)).toEqual(addresses);
    });

    it('yields entries identical, field for field, to the per-address path', async () => {
        // THE acceptance criterion: one fixture, both paths, deep equal. A
        // divergence here is a user seeing different balances depending on
        // which explorer answered.
        const addresses = ['A1', 'A2', 'A3', 'A4'];
        const viaBatch = await run(addresses, batchSdk(FIXTURE));
        const viaPerAddress = await run(addresses, perAddressSdk(FIXTURE));
        expect(viaBatch).toEqual(viaPerAddress);
        // And the fixture really did exercise all four outcomes, so the
        // equality above is not two empty objects agreeing.
        const byAddr = Object.fromEntries(viaBatch[CHAIN_ID].map((e) => [e.address, e]));
        expect(byAddr.A1.balances.unavailable).toBeUndefined();
        expect(byAddr.A2.balances.unavailable).toEqual(['native']);
        expect(byAddr.A3.balances.unavailable).toEqual(['tokens']);
        expect(byAddr.A4.balances).toBeNull();
    });

    it('marks the native half unavailable, with its reason, when that half is null', async () => {
        const entry = (await run(['A2'], batchSdk(FIXTURE)))[CHAIN_ID][0];
        expect(entry.balances.native).toBeNull();
        expect(entry.balances.unavailable).toEqual(['native']);
        expect(entry.balances.unavailableReason).toMatch(/address endpoint 503/);
        // The half that DID answer is untouched.
        expect(entry.balances.tokens.map((t) => t.tick)).toEqual(['PEPE']);
        expect(entry.error).toBeNull();
    });

    it('surfaces error and errorCode when BOTH halves are null', async () => {
        const entry = (await run(['A4'], batchSdk(FIXTURE)))[CHAIN_ID][0];
        expect(entry.balances).toBeNull();
        expect(entry.error).toBe('explorer down');
        expect(entry.errorCode).toBe('EXPLORER_HTTP_500');
        expect(entry.retryAfterSeconds).toBeNull();
    });

    it('surfaces error and errorCode when a LATER address is missing from the response', async () => {
        // A route that answered the batch shape but skipped an address is a
        // failure for that address, not an empty wallet, and not a fallback.
        const sdk = batchSdk(FIXTURE, {
            batchImpl: async (addresses) => batchBodyFor(addresses.slice(0, 1), FIXTURE),
        });
        const [first, second] = (await run(['A1', 'A2'], sdk))[CHAIN_ID];
        expect(first.balances).not.toBeNull();
        expect(second.balances).toBeNull();
        expect(second.error).toMatch(/no batch result for A2/);
        expect(sdk.getBalances).not.toHaveBeenCalled();
    });
});

describe('walletBalances treats a reply that is not the batch shape as "no batch route"', () => {
    // The web shell's dev-mock SDK is a Proxy answering every get* name with
    // a function that resolves to []; the real SDK names this case itself
    // (EXPLORER_BATCH_UNSUPPORTED), the flow must hold the rule for stand-ins.
    it.each([
        ['an empty array', async () => []],
        ['an object without the first address', async () => ({})],
        ['undefined', async () => undefined],
    ])('falls back per address on %s and never probes that SDK again', async (_label, batchImpl) => {
        const sdk = batchSdk(FIXTURE, { batchImpl });
        const first = await run(['A1', 'A2'], sdk);
        expect(first[CHAIN_ID].map((e) => e.error)).toEqual([null, null]);
        expect(first[CHAIN_ID][0].balances).toEqual(
            (await run(['A1'], perAddressSdk(FIXTURE)))[CHAIN_ID][0].balances,
        );
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getBalances).toHaveBeenCalledTimes(2);

        await run(['A1'], sdk);
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getBalances).toHaveBeenCalledTimes(3);
    });
});

describe('walletBalances falls back to per-address reads on a 404, once', () => {
    it('treats the typed EXPLORER_BATCH_UNSUPPORTED (an older explorer answering a JSON-RPC error at 200) the same way', async () => {
        const unsupported = failure('Explorer does not serve /RBTC/api/balances', 'EXPLORER_BATCH_UNSUPPORTED');
        const sdk = batchSdk(FIXTURE, { batchImpl: async () => { throw unsupported; } });
        const first = await run(['A1', 'A2'], sdk);
        expect(first[CHAIN_ID][0].balances.tokens.map((t) => t.tick)).toEqual(['XCHAIN']);
        await run(['A1', 'A2'], sdk);
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getBalances).toHaveBeenCalledTimes(4);
    });

    it('serves the chunk per address and never probes that SDK again', async () => {
        const notFound = failure('Explorer returned HTTP 404 for /RBTC/api/balances', 'EXPLORER_HTTP_404');
        const sdk = batchSdk(FIXTURE, { batchImpl: async () => { throw notFound; } });
        const addresses = ['A1', 'A2'];

        const first = await run(addresses, sdk);
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getBalances).toHaveBeenCalledTimes(2);
        // The fallback is a real answer, not an error row.
        expect(first[CHAIN_ID][0].balances.tokens.map((t) => t.tick)).toEqual(['XCHAIN']);

        const second = await run(addresses, sdk);
        // The memo is the whole point: a second poll spends no wasted probe.
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getBalances).toHaveBeenCalledTimes(4);
        expect(second).toEqual(first);
    });

    it('forgets the verdict for a DIFFERENT SDK instance', async () => {
        // A network switch builds a fresh registry; a wallet moved onto an
        // upgraded explorer must not stay pinned to the fallback.
        const notFound = failure('404', 'EXPLORER_HTTP_404');
        const old = batchSdk(FIXTURE, { batchImpl: async () => { throw notFound; } });
        await run(['A1'], old);
        const fresh = batchSdk(FIXTURE);
        await run(['A1'], fresh);
        expect(fresh.getBalancesBatch).toHaveBeenCalledTimes(1);
        expect(fresh.getBalances).not.toHaveBeenCalled();
    });
});

describe('walletBalances does NOT retry a rate-limited batch per address', () => {
    it('marks every address in the chunk with the code and the seconds', async () => {
        const limited = new Error('Explorer returned HTTP 429; retry after 42 seconds');
        limited.name = 'SDKRateLimitedError';
        limited.code = 'RATE_LIMITED';
        limited.status = 429;
        limited.retryAfterSeconds = 42;
        const sdk = batchSdk(FIXTURE, { batchImpl: async () => { throw limited; } });

        const res = await run(['A1', 'A2', 'A3'], sdk);
        for (const entry of res[CHAIN_ID]) {
            expect(entry.balances).toBeNull();
            expect(entry.errorCode).toBe('RATE_LIMITED');
            expect(entry.retryAfterSeconds).toBe(42);
            expect(entry.error).toContain('HTTP 429');
        }
        // The reason this matters: a per-address fallback here would fire the
        // six reads the batch replaced, into an origin that just said stop.
        expect(sdk.getBalances).not.toHaveBeenCalled();
        expect(sdk.getAddress).not.toHaveBeenCalled();
        // And a 429 is NOT a verdict about the route: the same instance batches
        // again on the next poll rather than falling back for good.
        sdk.getBalancesBatch.mockImplementation(async (addresses) => batchBodyFor(addresses, FIXTURE));
        const next = await run(['A1'], sdk);
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(2);
        expect(next[CHAIN_ID][0].error).toBeNull();
    });

    it('does not memoise a 5xx either', async () => {
        let calls = 0;
        const sdk = batchSdk(FIXTURE, {
            batchImpl: async (addresses) => {
                calls += 1;
                if (calls === 1) throw failure('explorer 502', 'EXPLORER_HTTP_502');
                return batchBodyFor(addresses, FIXTURE);
            },
        });
        const first = await run(['A1'], sdk);
        expect(first[CHAIN_ID][0].errorCode).toBe('EXPLORER_HTTP_502');
        const second = await run(['A1'], sdk);
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(2);
        expect(second[CHAIN_ID][0].error).toBeNull();
    });
});

describe('walletBalances stays on the per-address path for an SDK without the method', () => {
    it('never looks for a batch method it cannot have', async () => {
        // The installed SDK (0.15.1) is exactly this: the wallet feature-detects
        // so it can ship before the repin.
        const sdk = perAddressSdk(FIXTURE);
        expect(sdk.getBalancesBatch).toBeUndefined();
        const res = await run(['A1', 'A2'], sdk);
        expect(sdk.getBalances).toHaveBeenCalledTimes(2);
        expect(sdk.getAddress).toHaveBeenCalledTimes(2);
        expect(res[CHAIN_ID].map((e) => e.address)).toEqual(['A1', 'A2']);
    });
});
