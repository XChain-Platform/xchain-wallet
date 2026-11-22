// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The receive and dispenser flows tag a new record with whatever signer they
// are handed. A network switch that names a paired device would otherwise
// write device records into the seed's own account, leaving it held by two
// signers and closed to every later derive. The flows refuse a signer that
// does not hold the account's keys, in both directions.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';
import * as signerBridge from '../../../../packages/extension/src/background/signerBridge.js';
import { createDefaultSettings } from '../../../../packages/core/src/schemas/settings.js';
import { receiveAddress } from '../../../../packages/core/src/flows/receiveAddress.js';
import { dispenserAddress } from '../../../../packages/core/src/flows/dispenserAddress.js';

const DESCRIPTOR = {
    id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest',
    defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'],
};
const SIGNER = { id: 'signer-1', walletId: 'wallet-1', kind: 'trezor', vendor: 'trezor', model: 'T' };

function record(id, accountId, source, signerId, network = 'mainnet') {
    return {
        id, accountId, chain: 'bitcoin', network, source, addressType: 'p2wpkh',
        derivationPath: `m/84'/0'/0'/0/${id.endsWith('1') ? 1 : 0}`,
        signerId, address: `addr-${id}`, publicKey: `pub-${id}`,
    };
}

function fakeVault(records) {
    const stored = new Map(records.map((r) => [r.id, r]));
    let settings = createDefaultSettings();
    return {
        wallets: { get: async () => ({ id: 'wallet-1', format: 'bip39', origin: 'created' }), list: async () => [] },
        accounts: {
            findBy: async () => [{ id: 'seed-account', walletId: 'wallet-1', index: 0, name: 'Seed' }],
            get: async () => ({ id: 'seed-account', walletId: 'wallet-1', index: 0 }),
            list: async () => [],
        },
        addresses: {
            get: async (id) => stored.get(id) ?? null,
            list: async () => [...stored.values()],
            put: vi.fn(async (rec) => { stored.set(rec.id, rec); }),
        },
        signers: { get: async (id) => (id === SIGNER.id ? SIGNER : null) },
        settings: { get: async () => settings, put: async (next) => { settings = next; return next; } },
        connectedSites: { list: async () => [], findBy: async () => [] },
    };
}

function deviceTransport() {
    return vi.fn(async ({ op, payload }) => (op === 'getAddresses'
        ? [{ index: payload.startIndex, address: `device-${payload.startIndex}`, publicKey: 'device-pub', path: `m/84'/1'/0'/0/${payload.startIndex}` }]
        : null));
}

function switchNetwork(vault, request) {
    const host = createBackgroundHost({
        vault,
        chainRegistry: {
            get: (id) => (id === DESCRIPTOR.id ? DESCRIPTOR : null),
            chainIdFor: (coin, network) => `${coin}-${network}`,
            byNetworkKind: (kind) => (kind === 'regtest' ? [DESCRIPTOR] : []),
            list: () => [DESCRIPTOR],
        },
        sdkRegistry: { get: () => ({}), for: () => ({}) },
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return host.handle({ type: 'settings.setActiveNetwork', request: { walletId: 'wallet-1', network: 'regtest', ...request } });
}

afterEach(() => signerBridge.clearAll());

describe('settings.setActiveNetwork keeps a seed account free of device records', () => {
    it('derives nothing into the seed account through a device the request names', async () => {
        const transport = deviceTransport();
        signerBridge.setTransport(SIGNER.id, transport);
        const vault = fakeVault([record('seed-0', 'seed-account', 'hd', 'wallet-1')]);
        const res = await switchNetwork(vault, { signerId: SIGNER.id });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result.addresses.created).toEqual([]);
        expect(res.result.addresses.failed).toEqual([
            { chainId: DESCRIPTOR.id, reason: expect.stringMatching(/held by a different signer/) },
        ]);
        expect(vault.addresses.put).not.toHaveBeenCalled();
        expect(transport).not.toHaveBeenCalled();
    });
});

function flowSigner(kind) {
    return {
        id: kind === 'software' ? 'wallet-1' : SIGNER.id,
        kind,
        getAddresses: vi.fn(async (p) => [{
            index: p.startIndex, address: `${kind}-${p.startIndex}`, publicKey: `${kind}-pub`,
            path: `m/84'/1'/0'/0/${p.startIndex}`,
        }]),
        lock: vi.fn(),
    };
}

const flowOpts = (vault, signer) => ({
    vault,
    walletId: 'wallet-1',
    signer,
    chainRegistry: { get: () => DESCRIPTOR },
    sdkRegistry: { get: () => ({ explorer: { getHistory: async () => [] } }) },
    chainId: DESCRIPTOR.id,
    accountId: 'seed-account',
    derivationIndex: 0,
});

const SEED_HELD = [record('seed-0', 'seed-account', 'hd', 'wallet-1')];
const DEVICE_HELD = [record('dev-0', 'seed-account', 'trezor', SIGNER.id)];

describe.each([
    ['receiveAddress', receiveAddress],
    ['dispenserAddress', (opts) => dispenserAddress({ ...opts, derivationIndex: undefined })],
])('%s derives only with the signer that holds the account', (name, derive) => {
    it.each([
        ['a device into a seed-held account', SEED_HELD, 'trezor'],
        ['the seed into a device-held account', DEVICE_HELD, 'software'],
    ])('refuses %s before asking the signer for a key', async (_label, records, kind) => {
        const vault = fakeVault(records);
        const signer = flowSigner(kind);
        await expect(derive(flowOpts(vault, signer))).rejects.toThrow(`${name}: this account's keys are held by a different signer`);
        expect(signer.getAddresses).not.toHaveBeenCalled();
        expect(vault.addresses.put).not.toHaveBeenCalled();
    });

    it.each([
        ['the seed into its own account', SEED_HELD, 'software', 'hd'],
        ['the device into its own account', DEVICE_HELD, 'trezor', 'trezor'],
    ])('derives %s', async (_label, records, kind, source) => {
        const vault = fakeVault(records);
        const rec = await derive(flowOpts(vault, flowSigner(kind)));
        expect(rec).toMatchObject({ source, accountId: 'seed-account', network: 'regtest' });
    });

    it('refuses every signer for an account holding records of two device kinds', async () => {
        const mixed = [DEVICE_HELD[0], { ...record('led-1', 'seed-account', 'ledger', null), id: 'led-1' }];
        for (const kind of ['trezor', 'ledger', 'software']) {
            const signer = flowSigner(kind);
            await expect(derive(flowOpts(fakeVault(mixed), signer))).rejects.toThrow('held by a different signer');
            expect(signer.getAddresses).not.toHaveBeenCalled();
        }
    });
});

describe('receiveAddress continues a ledger-held account past its existing records', () => {
    it('derives the next external index with the ledger', async () => {
        const held = [0, 1, 2].map((i) => ({
            ...record(`led-${i}`, 'seed-account', 'ledger', null, 'regtest'),
            derivationPath: `m/84'/1'/0'/0/${i}`,
        }));
        const ledger = { ...flowSigner('ledger'), id: 'ledger-1' };
        const rec = await receiveAddress({ ...flowOpts(fakeVault(held), ledger), derivationIndex: undefined });
        expect(rec).toMatchObject({ source: 'ledger', derivationPath: "m/84'/1'/0'/0/3" });
    });
});
