// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// D-152 (Session 34). A balance read that HALF failed was reported as a whole
// one that came back empty.
//
// `fetchAddressShape` fetches the token ledger (`/balances/`) and the native
// coin (`/address/`) in parallel and lets them degrade independently, which is
// right: one endpoint hiccuping should not blank the other. What was wrong is
// that a failed TOKEN read returned `tokens: []` and no marker at all - a value
// byte-identical to "this address holds no tokens". Every surface downstream
// then stated an absence with full confidence: Home renders a wallet with no
// tokens, and the Send asset picker answers `Nothing matches "XCHAIN"` for a
// token the address is holding.
//
// FOUND, not theorised: two runs of the controller-bind e2e died in the asset
// picker, once on XCHAIN and once on the gated token itself, on a venue whose
// explorer was intermittently erroring. The live reads were not captured, so
// this file pins the CODE PATH rather than claiming the incident - the path is
// a defect on its own terms regardless of what those runs hit.
//
// Same family as D-149 from the same session, one layer down: a partial answer
// presented as a complete one. There the network declined to judge and the
// wallet said "Looks good"; here the ledger failed to load and the wallet said
// "you have none".

import { describe, it, expect } from 'vitest';
import { addressBalances, walletBalances } from '../../../packages/core/src/flows/balances.js';

const DESCRIPTORS = [{ id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' }];
const chainRegistry = {
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
};

/** An SDK whose two balance endpoints fail independently, on demand. */
function sdkWith({ tokensFail = false, nativeFail = false } = {}) {
    return {
        get: () => ({
            getAddress: async () => {
                if (nativeFail) throw new Error('address endpoint 503');
                return { balances: { confirmed: '1.50000000' } };
            },
            getBalances: async () => {
                if (tokensFail) throw new Error('balances endpoint 503');
                return { data: [{ tick: 'XCHAIN', amount: '2000', decimals: 0 }] };
            },
        }),
    };
}

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

const ADDRESS = {
    id: 'addr-hd', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest',
    source: 'hd', addressType: 'p2pkh', derivationPath: "m/0'/0/0", address: 'n2XDwu',
};

function makeVault() {
    return {
        wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'W', importedKeys: [] }]),
        accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
        addresses: memCollection([ADDRESS]),
    };
}

const read = (sdkRegistry) => addressBalances({
    sdkRegistry, chainRegistry, chainId: 'bitcoin-regtest', address: 'n2XDwu',
});

describe('D-152: a half-failed balance read must not read as an empty wallet', () => {
    it('marks the token half as unavailable when its endpoint fails', async () => {
        const shape = await read(sdkWith({ tokensFail: true }));
        // The empty list is still returned - callers keep rendering - but it is
        // no longer indistinguishable from a real absence.
        expect(shape.tokens).toEqual([]);
        expect(shape.unavailable, 'a failed token read left no trace at all')
            .toContain('tokens');
        expect(shape.unavailableReason).toMatch(/balances endpoint 503/);
        // The half that DID load is untouched: this is a disclosure fix, not a
        // retreat from degrading independently.
        expect(shape.native).toBeTruthy();
    });

    it('marks the native half when ITS endpoint fails', async () => {
        const shape = await read(sdkWith({ nativeFail: true }));
        expect(shape.native).toBeNull();
        expect(shape.unavailable).toContain('native');
        expect(shape.tokens.map((t) => t.tick)).toEqual(['XCHAIN']);
    });

    it('says nothing at all when both halves load', async () => {
        const shape = await read(sdkWith());
        // The marker must be ABSENT on the happy path, not present-and-empty: a
        // surface that tests for the key would otherwise warn on every read.
        expect(shape.unavailable).toBeUndefined();
        expect(shape.tokens.map((t) => t.tick)).toEqual(['XCHAIN']);
    });

    it('still throws only when BOTH halves fail', async () => {
        await expect(read(sdkWith({ tokensFail: true, nativeFail: true }))).rejects.toThrow();
    });

    it('carries the marker through the wallet-wide aggregator the pickers read', async () => {
        // The aggregator is what TokenPicker, Home and every action form's
        // balance line consume, so the marker is worthless if it stops here.
        const res = await walletBalances({
            vault: makeVault(),
            walletId: 'w1',
            chainRegistry,
            sdkRegistry: sdkWith({ tokensFail: true }),
        });
        const entry = (res['bitcoin-regtest'] || []).find((e) => e.address === 'n2XDwu');
        expect(entry, 'the address was not fetched at all').toBeTruthy();
        expect(entry.balances.unavailable).toContain('tokens');
    });
});
