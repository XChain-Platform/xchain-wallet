// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';
import * as signerBridge from '../../../../packages/extension/src/background/signerBridge.js';

function collection(initial = []) {
    const records = new Map(initial.map((row) => [row.id, structuredClone(row)]));
    return {
        get: async (id) => structuredClone(records.get(id) ?? null),
        find: async (id) => structuredClone(records.get(id) ?? null),
        list: async () => Array.from(records.values()).map((row) => structuredClone(row)),
        findBy: async (field, value) => Array.from(records.values())
            .filter((row) => row[field] === value).map((row) => structuredClone(row)),
    };
}

const account = { id: 'acct-1', walletId: 'wallet-1', index: 0, name: 'One' };
const otherAccount = { id: 'acct-2', walletId: 'wallet-2', index: 0, name: 'Other' };
const address = (overrides = {}) => ({
    id: 'addr-1', accountId: account.id, chain: 'bitcoin', network: 'regtest',
    source: 'ledger', signerId: 'device-1', addressType: 'p2wpkh',
    derivationPath: "m/84'/1'/0'/0/3", address: 'bcrt1qdevice', publicKey: 'pub',
    ...overrides,
});
const signer = (id, walletId, kind = 'ledger') => ({
    id, walletId, kind, label: id,
});
const chainRegistry = {
    get: (id) => (id === 'bitcoin-regtest'
        ? { coin: 'bitcoin', networkKind: 'regtest' }
        : null),
};

function host({ addresses = [address()] } = {}) {
    const poolGet = vi.fn(() => ({
        id: 'software-1', kind: 'software', getAddresses: vi.fn(),
    }));
    const vault = {
        wallets: collection([{ id: 'wallet-1', format: 'bip39' }]),
        accounts: collection([account, otherAccount]),
        addresses: collection(addresses),
        signers: collection([
            signer('device-1', 'wallet-1'),
            signer('device-2', 'wallet-1', 'trezor'),
        ]),
        settings: { get: async () => ({ fees: {}, ads: { perChain: {} } }) },
    };
    return {
        poolGet,
        instance: createBackgroundHost({
            vault,
            chainRegistry,
            sdkRegistry: { get: () => ({}) },
            signerPool: { get: poolGet },
            broadcastQueueStorage: null,
            signThrottleStorage: null,
            logConsoleStorage: null,
        }),
    };
}

function request(instance, overrides = {}) {
    return instance.handle({
        type: 'receive.verifyAddress',
        request: {
            walletId: 'wallet-1', chainId: 'bitcoin-regtest', addressId: 'addr-1',
            ...overrides,
        },
    });
}

describe('receive.verifyAddress signer routing', () => {
    beforeEach(() => signerBridge.clearAll());
    afterEach(() => signerBridge.clearAll());

    it('requires the stored device when signerId is omitted', async () => {
        const { instance, poolGet } = host();
        const result = await request(instance);
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('HW_NOT_CONNECTED');
        expect(poolGet).not.toHaveBeenCalled();
    });

    it('verifies through the stored device transport', async () => {
        const transport = vi.fn(async ({ op }) => (
            op === 'getAddresses'
                ? [{ address: 'bcrt1qdevice', publicKey: 'pub', path: "m/84'/1'/0'/0/3" }]
                : null
        ));
        signerBridge.setTransport('device-1', transport);
        const { instance, poolGet } = host();
        const result = await request(instance);
        expect(result.ok, JSON.stringify(result.error)).toBe(true);
        expect(result.result.confirmed).toBe(true);
        expect(transport).toHaveBeenCalledWith(expect.objectContaining({ op: 'getAddresses' }));
        expect(poolGet).not.toHaveBeenCalled();
    });

    it('refuses a request that names a different device', async () => {
        const { instance } = host();
        const result = await request(instance, { signerId: 'device-2' });
        expect(result.ok).toBe(false);
        expect(result.error.message).toMatch(/does not match the device/i);
    });

    it('refuses an address from another wallet before transport lookup', async () => {
        const { instance } = host({
            addresses: [address({ accountId: otherAccount.id, signerId: 'device-1' })],
        });
        const result = await request(instance);
        expect(result.ok).toBe(false);
        expect(result.error.message).toMatch(/not in this wallet/i);
    });

    it('refuses an unlinked device record instead of using the seed pool', async () => {
        const { instance, poolGet } = host({ addresses: [address({ signerId: null })] });
        const result = await request(instance);
        expect(result.ok).toBe(false);
        expect(result.error.message).toMatch(/no signerId/i);
        expect(poolGet).not.toHaveBeenCalled();
    });
});
