// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// regression, at the host boundary: a wallet or account added
// while the app sits on regtest used to derive its first addresses on
// the three MAINNETS (the shells' hardcoded default), which the
// active-network filter then hides everywhere. The result was an inert
// wallet - Home, Receive and Addresses all empty, and Add-address
// offering no coin because it listed only chains the account already
// occupied.
//
// `account.create` is exercised end to end here (real createAccount
// flow, in-memory vault, fake signer) because it is the cheap half of
// the pair; `wallet.add.import` resolves its chain ids through the very
// same helper on the line above it.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        find: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value)
            .map((r) => JSON.parse(JSON.stringify(r))),
    };
}

const DESCRIPTORS = [
    { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] },
    { id: 'litecoin-mainnet', coin: 'litecoin', networkKind: 'mainnet', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] },
    { id: 'dogecoin-mainnet', coin: 'dogecoin', networkKind: 'mainnet', defaultAddressType: 'p2pkh', addressTypes: ['p2pkh'] },
    { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] },
    { id: 'litecoin-regtest', coin: 'litecoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] },
    { id: 'dogecoin-regtest', coin: 'dogecoin', networkKind: 'regtest', defaultAddressType: 'p2pkh', addressTypes: ['p2pkh'] },
];

const chainRegistry = {
    has: (id) => DESCRIPTORS.some((d) => d.id === id),
    get: (id) => DESCRIPTORS.find((d) => d.id === id),
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    byNetworkKind: (kind) => DESCRIPTORS.filter((d) => d.networkKind === kind),
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
    supportedChains: () => DESCRIPTORS,
};

function makeHost({ activeNetwork, configuredChainIds }) {
    const vault = {
        wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'Second Wallet' }]),
        accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Account 1' }]),
        addresses: memCollection(),
        signers: memCollection(),
        settings: {
            _rec: {
                schemaVersion: 1,
                activeNetwork,
                fees: Object.fromEntries(configuredChainIds.map((id) => [id, { strategy: 'normal' }])),
                ads: { perChain: {} },
            },
            async get() { return JSON.parse(JSON.stringify(this._rec)); },
            async put(r) { this._rec = JSON.parse(JSON.stringify(r)); },
        },
    };
    const signer = {
        id: 'signer-1',
        kind: 'software',
        async getAddresses({ chainId, accountIndex, change, startIndex }) {
            return [{
                index: startIndex,
                address: `addr_${chainId}_${accountIndex}_${change}_${startIndex}`,
                publicKey: `pub_${chainId}`,
                path: `m/84'/0'/${accountIndex}'/${change}/${startIndex}`,
            }];
        },
        lock() {},
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => ({}) },
        signerPool: { get: () => signer, has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, vault };
}

async function createdChainIds(host) {
    const res = await host.handle({ type: 'account.create', request: { walletId: 'w1' } });
    expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
    return res.result.addresses.map((a) => a.chainId);
}

describe('New accounts seed from the vault active chain set', () => {
    it('lands on the regtest chains when the app is on regtest', async () => {
        const { host } = makeHost({
            activeNetwork: 'regtest',
            configuredChainIds: [
                'bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet',
                'bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest',
            ],
        });
        const chainIds = await createdChainIds(host);

        // The whole point: at least one address on the network the user is
        // looking at, and it comes first so Receive opens on it.
        expect(chainIds.slice(0, 3)).toEqual([
            'bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest',
        ]);
        // The mainnet chains are still seeded, so switching back is not a
        // second dead end.
        expect(chainIds).toContain('bitcoin-mainnet');
    });

    it('still seeds the regtest chains when only mainnet has fee settings', async () => {
        // Regtest reached via the extension's host-driven network switch,
        // before any regtest fee entry exists.
        const { host } = makeHost({
            activeNetwork: 'regtest',
            configuredChainIds: ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'],
        });
        const chainIds = await createdChainIds(host);
        expect(chainIds).toContain('bitcoin-regtest');
    });

    it('is unchanged on mainnet: the same three chains as before', async () => {
        const { host } = makeHost({
            activeNetwork: 'mainnet',
            configuredChainIds: ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'],
        });
        const chainIds = await createdChainIds(host);
        expect([...chainIds].sort()).toEqual([
            'bitcoin-mainnet', 'dogecoin-mainnet', 'litecoin-mainnet',
        ]);
    });

    it('honours an explicit activeChainIds request', async () => {
        const { host } = makeHost({
            activeNetwork: 'regtest',
            configuredChainIds: ['bitcoin-mainnet', 'bitcoin-regtest'],
        });
        const res = await host.handle({
            type: 'account.create',
            request: { walletId: 'w1', activeChainIds: ['litecoin-mainnet'] },
        });
        expect(res.ok).toBe(true);
        expect(res.result.addresses.map((a) => a.chainId)).toEqual(['litecoin-mainnet']);
    });
});
