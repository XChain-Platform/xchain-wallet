// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The aggregator's per-address failure, TYPED (rate-limits spec, M4 row 40).
//
// With only `error: <the message string>` on a per-address failure, Home has
// to read "; retry after N seconds" back out of prose the SDK had already
// structured. These entries cross the messaging
// boundary, where an Error's own fields are dropped, so the fields have to be
// copied onto the entry as plain values to survive at all.
//
// What is pinned here: a rate-limited read leaves the code and the seconds ON
// the entry; an untyped failure leaves both null rather than guessing; and a
// number that is not a whole non-negative count never reaches a countdown.

import { describe, it, expect } from 'vitest';
import { walletBalances } from '../../../packages/core/src/flows/balances.js';

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

const CHAIN_ID = 'bitcoin-regtest';
const DESCRIPTORS = [{ id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' }];

const chainRegistry = {
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
};

const ADDRESS = 'n2XDwu';

function makeVault() {
    return {
        wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'Main Wallet', importedKeys: [] }]),
        accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
        addresses: memCollection([{
            id: 'addr-hd', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest',
            source: 'hd', addressType: 'p2pkh', derivationPath: "m/0'/0/0", address: ADDRESS,
        }]),
    };
}

// BOTH reads have to fail for `fetchAddressShape` to throw, which is the only
// path that writes `error` at all: a single failing endpoint degrades silently
// into a partial result instead.
function registryThatRejectsWith(makeError) {
    return {
        get: () => ({
            getAddress: async () => { throw makeError(); },
            getBalances: async () => { throw makeError(); },
        }),
    };
}

async function entryFor(makeError) {
    const res = await walletBalances({
        vault: makeVault(),
        walletId: 'w1',
        chainRegistry,
        sdkRegistry: registryThatRejectsWith(makeError),
    });
    return res[CHAIN_ID][0];
}

/** The shape SDK 1665843 on throws for a 429 that survived its honoured retry. */
function rateLimited(retryAfterSeconds) {
    const e = new Error(
        `Explorer returned HTTP 429 for /RBTC/api/balances/${ADDRESS}; retry after 42 seconds`,
    );
    e.name = 'SDKRateLimitedError';
    e.code = 'RATE_LIMITED';
    e.service = 'explorer';
    e.status = 429;
    e.retryAfterSeconds = retryAfterSeconds;
    return e;
}

describe('walletBalances types a per-address failure instead of only describing it', () => {
    it('keeps the rate limit\'s code and its seconds on the entry', async () => {
        const entry = await entryFor(() => rateLimited(42));
        expect(entry.balances).toBeNull();
        expect(entry.errorCode).toBe('RATE_LIMITED');
        expect(entry.retryAfterSeconds).toBe(42);
        // The sentence is still there for every reader that only wants prose.
        expect(entry.error).toContain('Explorer returned HTTP 429');
    });

    it('leaves both fields null for a failure that named neither', async () => {
        const entry = await entryFor(() => new Error('boom'));
        expect(entry.error).toBe('boom');
        expect(entry.errorCode).toBeNull();
        expect(entry.retryAfterSeconds).toBeNull();
    });

    it('records the code but no seconds when the wait is not a whole count', async () => {
        // A non-integer would render as "for 4.5 seconds" in a countdown that
        // ticks in whole seconds, and would never reach zero cleanly.
        const entry = await entryFor(() => rateLimited(4.5));
        expect(entry.errorCode).toBe('RATE_LIMITED');
        expect(entry.retryAfterSeconds).toBeNull();
    });

    it('refuses a negative wait as much as a fractional one', async () => {
        const entry = await entryFor(() => rateLimited(-1));
        expect(entry.errorCode).toBe('RATE_LIMITED');
        expect(entry.retryAfterSeconds).toBeNull();
    });

    it('leaves both fields null on the entry of an address that READ fine', async () => {
        const res = await walletBalances({
            vault: makeVault(),
            walletId: 'w1',
            chainRegistry,
            sdkRegistry: {
                get: () => ({
                    getAddress: async () => ({ balances: { confirmed: '1.00000000' } }),
                    getBalances: async () => ({ data: [] }),
                }),
            },
        });
        const entry = res[CHAIN_ID][0];
        expect(entry.error).toBeNull();
        expect(entry.errorCode).toBeNull();
        expect(entry.retryAfterSeconds).toBeNull();
    });
});
