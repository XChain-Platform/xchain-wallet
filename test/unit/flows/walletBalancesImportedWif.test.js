// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Wallet E2E session 17 / D-66, the FIFTH site of one convention mismatch
// (after D-54, D-63 and the two in D-65): `walletBalances` grouped the
// wallet's addresses with `if (!a.accountId || !accountIds.has(a.accountId))
// continue`, so an imported-WIF address - which carries accountId=null by
// design (§11.3.3) - was never fetched. Its own docstring promised "every
// HD / imported address owned by a wallet".
//
// Logged as a display bug because it was found on the Addresses list, but
// this aggregator also feeds Home's total, TokenPicker, ManageToken,
// PlaceOrderPanel and the dispenser forms: an imported key's TOKENS were
// invisible to every one of them too, so a token held only on an imported
// address could not be selected in any action form.
//
// This function had NO direct unit coverage before this file, which is the
// other half of why it survived sixteen sessions.

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

const DESCRIPTORS = [
    { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' },
];

const chainRegistry = {
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
};

// Per-address on-chain truth the fake SDK serves back.
const CHAIN = {
    n2XDwu: { confirmed: '3.49993306', tokens: [] },
    mq1XCn: { confirmed: '0.59998404', tokens: [{ tick: 'XCHAIN', amount: '7', decimals: 0 }] },
    mOTHER: { confirmed: '9.00000000', tokens: [] },
};

const sdkRegistry = {
    get: () => ({
        getAddress: async (address) => ({ balances: { confirmed: CHAIN[address]?.confirmed ?? '0' } }),
        getBalances: async (address) => ({ data: CHAIN[address]?.tokens ?? [] }),
    }),
};

const HD_ADDRESS = {
    id: 'addr-hd', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest',
    source: 'hd', addressType: 'p2pkh', derivationPath: "m/0'/0/0", address: 'n2XDwu',
};
const IMPORTED_ADDRESS = {
    id: 'addr-wif', accountId: null, chain: 'bitcoin', network: 'regtest',
    source: 'imported-wif', addressType: 'p2pkh', derivationPath: null, address: 'mq1XCn',
};
// Belongs to a different wallet's importedKeys; must never be fetched for w1.
const OTHER_IMPORTED = {
    id: 'addr-wif-other', accountId: null, chain: 'bitcoin', network: 'regtest',
    source: 'imported-wif', addressType: 'p2pkh', derivationPath: null, address: 'mOTHER',
};

function makeVault({ importedKeys = [{ addressId: 'addr-wif' }], omitImportedKeys = false, accounts } = {}) {
    const w1 = { id: 'w1', schemaVersion: 1, name: 'Legacy Wallet', importedKeys };
    if (omitImportedKeys) delete w1.importedKeys;
    return {
        wallets: memCollection([
            w1,
            { id: 'w2', schemaVersion: 1, name: 'Other Wallet', importedKeys: [{ addressId: 'addr-wif-other' }] },
        ]),
        accounts: memCollection(accounts ?? [{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
        addresses: memCollection([HD_ADDRESS, IMPORTED_ADDRESS, OTHER_IMPORTED]),
    };
}

async function run(args = {}) {
    const { vaultOpts, ...rest } = args;
    return walletBalances({
        vault: makeVault(vaultOpts),
        walletId: 'w1',
        chainRegistry,
        sdkRegistry,
        ...rest,
    });
}

function addressesOf(result) {
    return (result['bitcoin-regtest'] || []).map((e) => e.address);
}

function entryFor(result, address) {
    return (result['bitcoin-regtest'] || []).find((e) => e.address === address);
}

describe('D-66: walletBalances includes imported-WIF addresses', () => {
    it('fetches the imported address alongside the HD ones', async () => {
        const res = await run();
        expect(addressesOf(res)).toContain('n2XDwu');
        expect(addressesOf(res)).toContain('mq1XCn');
    });

    it('reports the imported address\'s real native balance, not zero', async () => {
        // The visible symptom: the Addresses row and detail read 0 BTC while
        // the chain held 0.59998404, and Home's total excluded it entirely.
        const entry = entryFor(await run(), 'mq1XCn');
        expect(entry.balances.native.quantity).toBe('59998404');
    });

    it('reports TOKENS held on an imported address', async () => {
        // Wider than the row that was reported: this aggregator is what every
        // token picker and action form reads.
        const entry = entryFor(await run(), 'mq1XCn');
        expect(entry.balances.tokens.map((t) => t.tick)).toContain('XCHAIN');
    });

    it('still includes the imported address when one account is scoped', async () => {
        // AddressList and Home both pass the active accountId. Excluding
        // imported keys from account-scoped queries was the first, wrong
        // version of the D-63 fix; it must not come back here.
        const res = await run({ accountId: 'acct-1' });
        expect(addressesOf(res)).toContain('mq1XCn');
        expect(addressesOf(res)).toContain('n2XDwu');
    });

    it('never fetches another wallet\'s imported key', async () => {
        expect(addressesOf(await run())).not.toContain('mOTHER');
    });

    it('returns only HD addresses when the wallet imported nothing', async () => {
        const res = await run({ vaultOpts: { importedKeys: [] } });
        expect(addressesOf(res)).toEqual(['n2XDwu']);
    });

    it('tolerates a wallet record with no importedKeys array', async () => {
        const res = await run({ vaultOpts: { omitImportedKeys: true } });
        expect(addressesOf(res)).toEqual(['n2XDwu']);
    });

    it('still serves an imported key when the wallet has no accounts at all', async () => {
        // The old early-return bailed on an empty account set before it had
        // looked at importedKeys.
        const res = await run({ vaultOpts: { accounts: [] } });
        expect(addressesOf(res)).toEqual(['mq1XCn']);
    });

    it('rejects an accountId belonging to another wallet', async () => {
        // Pre-existing guard: the imported-key widening must not turn a
        // mismatched scope into wallet-wide totals.
        await expect(run({ accountId: 'acct-nope' })).rejects.toThrow(/does not belong/);
    });
});
