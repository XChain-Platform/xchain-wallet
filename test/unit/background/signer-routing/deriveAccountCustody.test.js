// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// receive.getAddress and dispenser.getAddress derive with the device an
// account is held on. The forms send no signerId, so without this the
// pooled seed signer would derive a hot key into a device account, and a
// hardware wallet (no pooled signer) could not add an address at all.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';
import * as signerBridge from '../../../../packages/extension/src/background/signerBridge.js';

const DESCRIPTOR = { coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] };
const SIGNERS = {
    'signer-1': { id: 'signer-1', walletId: 'wallet-1', kind: 'trezor', vendor: 'trezor', model: 'T' },
    'signer-2': { id: 'signer-2', walletId: 'wallet-1', kind: 'trezor', vendor: 'trezor', model: 'T' },
};

function record(id, accountId, source, signerId) {
    return {
        id, accountId, chain: 'bitcoin', network: 'regtest', source, addressType: 'p2wpkh',
        derivationPath: `m/84'/1'/${accountId === 'device-account' ? 1 : 0}'/0/0`,
        signerId, address: `addr-${id}`, publicKey: `pub-${id}`,
    };
}

function makeHost({ pooled = true, records = null } = {}) {
    const accounts = [
        { id: 'seed-account', walletId: 'wallet-1', index: 0, name: 'Seed' },
        { id: 'device-account', walletId: 'wallet-1', index: 1, name: 'Device' },
    ];
    const stored = new Map((records ?? [
        record('seed-0', 'seed-account', 'hd', 'wallet-1'),
        record('dev-0', 'device-account', 'trezor', 'signer-1'),
    ]).map((r) => [r.id, r]));
    const vault = {
        wallets: { get: async () => ({ id: 'wallet-1', format: 'bip39', origin: 'created' }) },
        accounts: { findBy: async () => accounts, get: async (id) => accounts.find((a) => a.id === id) ?? null },
        addresses: {
            get: async (id) => stored.get(id) ?? null,
            list: async () => [...stored.values()],
            put: vi.fn(async (rec) => { stored.set(rec.id, rec); }),
        },
        signers: { get: async (id) => SIGNERS[id] ?? null },
    };
    const pooledGetAddresses = vi.fn(async (p) => [{
        index: p.startIndex, address: `seed-${p.startIndex}`, publicKey: 'seed-pub', path: `m/84'/1'/${p.accountIndex}'/0/${p.startIndex}`,
    }]);
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: (id) => (id === 'bitcoin-regtest' ? DESCRIPTOR : null), chainIdFor: () => 'bitcoin-regtest' },
        sdkRegistry: { get: () => ({}), for: () => ({}) },
        signerPool: pooled
            ? { get: () => ({ kind: 'software', id: 'wallet-1', getAddresses: pooledGetAddresses }), has: () => true }
            : { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, vault, pooledGetAddresses };
}

const derive = (host, type, request) => host.handle({
    type,
    request: { walletId: 'wallet-1', chainId: 'bitcoin-regtest', ...request },
});

function deviceTransport() {
    return vi.fn(async ({ op, payload }) => (op === 'getAddresses'
        ? [{
            index: payload.startIndex,
            address: `device-${payload.startIndex}`,
            publicKey: 'device-pub',
            path: `m/84'/1'/${payload.accountIndex}'/0/${payload.startIndex}`,
        }]
        : null));
}

afterEach(() => signerBridge.clearAll());

describe.each(['receive.getAddress', 'dispenser.getAddress'])('%s derives with the account custody signer', (type) => {
    it('takes the device path for a linked device account when the request names no signer', async () => {
        const { host, vault, pooledGetAddresses } = makeHost();
        const res = await derive(host, type, { accountId: 'device-account' });
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe(signerBridge.HW_NOT_CONNECTED);
        expect(pooledGetAddresses).not.toHaveBeenCalled();
        expect(vault.addresses.put).not.toHaveBeenCalled();
    });

    it('derives through the linked device when it is connected, with no pooled signer', async () => {
        const transport = deviceTransport();
        signerBridge.setTransport('signer-1', transport);
        const { host, pooledGetAddresses } = makeHost({ pooled: false });
        const res = await derive(host, type, { accountId: 'device-account' });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result).toMatchObject({ source: 'trezor', signerId: 'signer-1', accountId: 'device-account' });
        expect(transport).toHaveBeenCalled();
        expect(pooledGetAddresses).not.toHaveBeenCalled();
    });

    it('refuses a request naming a different device than the account is held on', async () => {
        const { host, vault, pooledGetAddresses } = makeHost();
        const res = await derive(host, type, { accountId: 'device-account', signerId: 'signer-2' });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/different device/);
        expect(pooledGetAddresses).not.toHaveBeenCalled();
        expect(vault.addresses.put).not.toHaveBeenCalled();
    });

    it('keeps the pooled seed signer for a seed account', async () => {
        const { host, pooledGetAddresses } = makeHost();
        const res = await derive(host, type, { accountId: 'seed-account' });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result).toMatchObject({ source: 'hd', accountId: 'seed-account' });
        expect(pooledGetAddresses).toHaveBeenCalled();
    });

    it('resolves the account by index when the request names no accountId', async () => {
        const { host, pooledGetAddresses } = makeHost();
        const res = await derive(host, type, { accountIndex: 1 });
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe(signerBridge.HW_NOT_CONNECTED);
        expect(pooledGetAddresses).not.toHaveBeenCalled();
    });
});

// Accounts whose records name no single device leave the host nothing to
// pick; each case must refuse rather than hand the request to the seed.
const UNLINKED = [
    record('seed-0', 'seed-account', 'hd', 'wallet-1'),
    record('dev-0', 'device-account', 'trezor', null),
];
const MIXED_SEED = [
    record('seed-0', 'seed-account', 'hd', 'wallet-1'),
    record('seed-1', 'seed-account', 'hd', 'wallet-1'),
    record('seed-x', 'seed-account', 'trezor', 'signer-1'),
];

describe.each(['receive.getAddress', 'dispenser.getAddress'])('%s refuses an account with no single custody signer', (type) => {
    const expectRefused = (res, pattern, { vault, pooledGetAddresses }) => {
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(pattern);
        expect(pooledGetAddresses).not.toHaveBeenCalled();
        expect(vault.addresses.put).not.toHaveBeenCalled();
    };

    it('refuses an unlinked device account when the request names no signer', async () => {
        for (const pooled of [true, false]) {
            const h = makeHost({ pooled, records: UNLINKED });
            const res = await derive(h.host, type, { accountId: 'device-account' });
            expectRefused(res, /trezor device that none of its addresses names/, h);
        }
    });

    it('derives an unlinked device account through a requested device of its kind', async () => {
        const transport = deviceTransport();
        signerBridge.setTransport('signer-2', transport);
        const h = makeHost({ records: UNLINKED });
        const res = await derive(h.host, type, { accountId: 'device-account', signerId: 'signer-2' });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result).toMatchObject({ source: 'trezor', signerId: 'signer-2', accountId: 'device-account' });
        expect(h.pooledGetAddresses).not.toHaveBeenCalled();
    });

    it('refuses a seed account that also holds a device record', async () => {
        const h = makeHost({ records: MIXED_SEED });
        const res = await derive(h.host, type, { accountId: 'seed-account' });
        expectRefused(res, /addresses from more than one signer/, h);
    });

    it('derives nothing for an account the wallet does not hold', async () => {
        const h = makeHost({ records: UNLINKED });
        for (const request of [{ accountId: 'missing' }, { accountIndex: '1' }, { accountIndex: 7 }]) {
            const res = await derive(h.host, type, request);
            expectRefused(res, /has no account/, h);
        }
    });

    it('refuses a request naming a device for a seed account', async () => {
        const h = makeHost();
        const res = await derive(h.host, type, { accountId: 'seed-account', signerId: 'signer-1' });
        expectRefused(res, /held by the wallet seed, not a device/, h);
    });
});
