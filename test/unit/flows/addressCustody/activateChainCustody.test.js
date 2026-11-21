// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// activateChain derives with one signer for every account in the wallet. In a
// seed wallet that also holds a device account, that signer owns only some of
// the accounts; the others are left without an address and reported apart
// from the accounts that already had one.

import { describe, expect, it } from 'vitest';

import { activateChain } from '../../../../packages/core/src/flows/activateChain.js';
import { activationMessage } from '../../../../packages/core/src/shared/components/settings/TestNetworksPages.jsx';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, structuredClone(r)]));
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (r) => { m.set(r.id, structuredClone(r)); },
        list: async () => [...m.values()].map((r) => structuredClone(r)),
        findBy: async (field, value) => [...m.values()].filter((r) => r[field] === value).map((r) => structuredClone(r)),
    };
}

const DESCRIPTOR = { coin: 'litecoin', networkKind: 'mainnet', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] };
const chainRegistry = { has: (id) => id === 'litecoin-mainnet', get: () => DESCRIPTOR };
const ACCOUNTS = [
    { id: 'seed', walletId: 'w1', name: 'Seed', index: 0 },
    { id: 'device', walletId: 'w1', name: 'Device', index: 1 },
    { id: 'fresh', walletId: 'w1', name: 'Fresh', index: 2 },
];
const btc = (id, accountId, source, signerId) => ({
    id, accountId, chain: 'bitcoin', network: 'mainnet', source, signerId,
    addressType: 'p2wpkh', derivationPath: "m/84'/0'/0'/0/0", address: `a-${id}`, publicKey: `p-${id}`,
});

function makeVault() {
    return {
        wallets: memCollection([{ id: 'w1', format: 'bip39' }]),
        accounts: memCollection(ACCOUNTS),
        addresses: memCollection([btc('s0', 'seed', 'hd', 'w1'), btc('d0', 'device', 'trezor', 'sig-1')]),
        settings: {
            rec: { schemaVersion: 1, fees: {}, ads: { perChain: {} } },
            async get() { return structuredClone(this.rec); },
            async put(r) { this.rec = structuredClone(r); },
        },
    };
}

function signer(kind, id) {
    return {
        id, kind,
        async getAddresses({ accountIndex, startIndex }) {
            const path = `m/84'/2'/${accountIndex}'/0/${startIndex}`;
            return [{ index: startIndex, address: `${kind}-${accountIndex}`, publicKey: `pub-${accountIndex}`, path }];
        },
        lock() {},
    };
}

const run = (vault, s, extra = {}) => activateChain({
    walletId: 'w1', chainId: 'litecoin-mainnet', signer: s, vault, chainRegistry, sdkRegistry: { get: () => ({}) }, ...extra,
});

describe('activateChain derives only into accounts the signer holds', () => {
    it('leaves a device account out when the seed signer activates the wallet', async () => {
        const vault = makeVault();
        const res = await run(vault, signer('software', 'w1'));
        expect(res.addresses.map((a) => a.accountId).sort()).toEqual(['fresh', 'seed']);
        expect(res.custodySkippedAccountDetails).toEqual([{ accountId: 'device', name: 'Device' }]);
        expect(res.skippedAccountDetails).toEqual([]);
        const ltc = (await vault.addresses.list()).filter((a) => a.chain === 'litecoin');
        expect(ltc.some((a) => a.accountId === 'device')).toBe(false);
    });

    it('fills only the device account when its own device activates the wallet', async () => {
        const vault = makeVault();
        const res = await run(vault, signer('trezor', 'sig-1'));
        expect(res.addresses.map((a) => a.accountId).sort()).toEqual(['device', 'fresh']);
        expect(res.addresses.find((a) => a.accountId === 'device').address).toMatchObject({ source: 'trezor', signerId: 'sig-1' });
        expect(res.custodySkippedAccountDetails).toEqual([{ accountId: 'seed', name: 'Seed' }]);
    });

    it('refuses another device on a device account scoped by accountId', async () => {
        const vault = makeVault();
        const res = await run(vault, signer('trezor', 'sig-2'), { accountId: 'device' });
        expect(res.addresses).toEqual([]);
        expect(res.custodySkippedAccountDetails).toEqual([{ accountId: 'device', name: 'Device' }]);
    });

    it('names the accounts held elsewhere in the Test Networks toast', async () => {
        const res = await run(makeVault(), signer('software', 'w1'));
        const message = activationMessage({ id: 'litecoin-mainnet', displayName: 'Litecoin' }, res);
        expect(message).toMatch(/New addresses made: 2/);
        expect(message).toMatch(/keys are on another device or seed.*Device/);
        const none = activationMessage({ id: 'litecoin-mainnet', displayName: 'Litecoin' }, {
            addresses: [], skippedAccountDetails: [], custodySkippedAccountDetails: [{ accountId: 'device', name: 'Device' }],
        });
        expect(none).not.toMatch(/already active/);
        expect(none).toMatch(/Device/);
    });
});
