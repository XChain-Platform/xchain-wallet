// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// An `/address/` body that names a different address than the one asked for
// (another chain's, or the mainnet twin of a regtest address) is someone
// else's coin balance. Measured in the extension side panel against a local
// venue: Home showed 7.5 BTC on a regtest address holding 0.0015 when the
// reply named a Litecoin address, and 3.25 when it named a mainnet one. Both
// read paths (per address and the batch route) must mark the coin balance
// unreadable instead of crediting it.

import { beforeEach, describe, expect, it } from 'vitest';
import {
    addressBalances,
    walletBalances,
    _resetBatchSupportMemo,
} from '../../../packages/core/src/flows/balances.js';

const CHAIN_ID = 'bitcoin-regtest';
const SOURCE = 'bcrt1q4neq4jcky263n30yg42ypehfapef6zycf7qefy';
const LTC = 'ltc1qg82e5pt8sgnl2fzwfwqsu3nsgcsy7tpk3c2rcz';
const MAINNET = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const DESCRIPTOR = { id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' };
const chainRegistry = {
    descriptorFor: (id) => (id === CHAIN_ID ? DESCRIPTOR : null),
    chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? CHAIN_ID : null),
    get(id) { return this.descriptorFor(id); },
};

const body = (address, confirmed) => ({
    address, balances: { confirmed, pending: '0.00000000' }, tracker_available: true,
});
const tokens = { total: 0, data: [] };

function perAddressRegistry(addrBody) {
    return { get: () => ({ getBalances: async () => tokens, getAddress: async () => addrBody }) };
}

function memCollection(rows) {
    const m = new Map(rows.map((r) => [r.id, r]));
    return {
        get: async (id) => m.get(id) || null,
        put: async (r) => { m.set(r.id, r); },
        list: async () => [...m.values()],
        delete: async (id) => { m.delete(id); },
        findBy: async (f, v) => [...m.values()].filter((r) => r[f] === v),
    };
}
const vault = {
    wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'W', importedKeys: [] }]),
    accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
    addresses: memCollection([{
        id: 'addr-0', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest', source: 'hd',
        addressType: 'p2wpkh', derivationPath: "m/84'/1'/0'/0/0", label: 'A', address: SOURCE,
    }]),
};

beforeEach(() => { _resetBatchSupportMemo(); });

describe('a coin balance answered for another address is not credited', () => {
    it.each([['another chain', LTC], ['another network', MAINNET]])('per address: %s', async (_label, other) => {
        const shape = await addressBalances({
            sdkRegistry: perAddressRegistry(body(other, '7.50000000')), chainRegistry, chainId: CHAIN_ID, address: SOURCE,
        });
        expect(shape.native).toBeNull();
        expect(shape.unavailable).toContain('native');
    });

    it('batch route: the slot keyed by this address but naming another', async () => {
        const sdk = {
            getBalances: async () => tokens,
            getAddress: async () => body(SOURCE, '0.00150000'),
            getBalancesBatch: async () => ({ [SOURCE]: { balances: tokens, address: body(LTC, '7.50000000'), error: null } }),
        };
        const res = await walletBalances({ vault, walletId: 'w1', chainRegistry, sdkRegistry: { get: () => sdk } });
        const entry = res[CHAIN_ID].find((e) => e.address === SOURCE);
        expect(entry.balances.native).toBeNull();
        expect(entry.balances.unavailable).toContain('native');
    });

    it('keeps the reading when the echo matches, differs only in bech32 case, or is absent', async () => {
        for (const echoed of [SOURCE, SOURCE.toUpperCase(), undefined]) {
            const shape = await addressBalances({
                sdkRegistry: perAddressRegistry(body(echoed, '0.00150000')), chainRegistry, chainId: CHAIN_ID, address: SOURCE,
            });
            expect(shape.native.quantity).toBe('150000');
            expect(shape.unavailable).toBeUndefined();
        }
    });
});
