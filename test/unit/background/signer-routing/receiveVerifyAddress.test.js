// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// receive.verifyAddress confirms a hardware address on the device it is
// linked to. The pooled software signer derives the same address from the
// same seed, so it must never be the one asked.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';
import * as signerBridge from '../../../../packages/extension/src/background/signerBridge.js';

const PATH = "m/84'/1'/0'/0/2";
const ADDRESS = 'bcrt1qverifyaddress';

function makeHost({ address: addressOverrides = {}, accountWalletId = 'wallet-1' } = {}) {
    const address = {
        id: 'addr-1', accountId: 'account-1', chain: 'bitcoin', network: 'regtest',
        source: 'trezor', addressType: 'p2wpkh', derivationPath: PATH,
        signerId: 'signer-1', address: ADDRESS, ...addressOverrides,
    };
    const account = { id: 'account-1', walletId: accountWalletId, index: 0 };
    const vault = {
        addresses: { get: async (id) => (id === address.id ? address : null) },
        accounts: { get: async (id) => (id === account.id ? account : null), list: async () => [account] },
        signers: {
            get: async (id) => (id === 'signer-1'
                ? { id, walletId: 'wallet-1', kind: 'trezor', vendor: 'trezor', model: 'T' }
                : null),
        },
    };
    const pooledGetAddresses = vi.fn(async (p) => [{ index: p.startIndex, address: ADDRESS }]);
    const host = createBackgroundHost({
        vault,
        chainRegistry: {
            get: (id) => (id === 'bitcoin-regtest' ? { coin: 'bitcoin', networkKind: 'regtest' } : null),
            chainIdFor: () => 'bitcoin-regtest',
        },
        sdkRegistry: { get: () => ({}), for: () => ({}) },
        signerPool: { get: () => ({ kind: 'software', id: 'wallet-1', getAddresses: pooledGetAddresses }), has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, pooledGetAddresses };
}

const verify = (host, request = {}) => host.handle({
    type: 'receive.verifyAddress',
    request: { walletId: 'wallet-1', chainId: 'bitcoin-regtest', addressId: 'addr-1', ...request },
});

afterEach(() => signerBridge.clearAll());

describe('receive.verifyAddress signer routing', () => {
    it('refuses an unlinked hardware address instead of asking the pooled software signer', async () => {
        const { host, pooledGetAddresses } = makeHost({ address: { signerId: null } });
        const res = await verify(host, { signerId: null });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/not linked to a paired hardware wallet/);
        expect(pooledGetAddresses).not.toHaveBeenCalled();
    });

    it('refuses an address whose account belongs to another wallet', async () => {
        const { host, pooledGetAddresses } = makeHost({ accountWalletId: 'wallet-2' });
        const res = await verify(host);
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/not in this wallet/);
        expect(pooledGetAddresses).not.toHaveBeenCalled();
    });

    it('refuses a software address', async () => {
        const { host, pooledGetAddresses } = makeHost({ address: { source: 'hd', signerId: null } });
        const res = await verify(host);
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/only for hardware addresses/);
        expect(pooledGetAddresses).not.toHaveBeenCalled();
    });

    it('refuses a request naming a different device than the address link', async () => {
        const { host } = makeHost();
        const res = await verify(host, { signerId: 'signer-other' });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/different device/);
    });

    it('takes the device path for a linked address with no live transport', async () => {
        const { host, pooledGetAddresses } = makeHost();
        const res = await verify(host);
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe(signerBridge.HW_NOT_CONNECTED);
        expect(pooledGetAddresses).not.toHaveBeenCalled();
    });

    it('confirms through the linked device transport', async () => {
        const transport = vi.fn(async ({ op, payload }) => (op === 'getAddresses'
            ? [{ index: payload.startIndex, address: ADDRESS }]
            : null));
        signerBridge.setTransport('signer-1', transport);
        const { host, pooledGetAddresses } = makeHost();
        const res = await verify(host);
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result).toMatchObject({ confirmed: true, deviceAddress: ADDRESS });
        expect(transport).toHaveBeenCalledWith(expect.objectContaining({
            op: 'getAddresses',
            payload: expect.objectContaining({ verify: true, startIndex: 2, signerId: 'signer-1' }),
        }));
        expect(pooledGetAddresses).not.toHaveBeenCalled();
    });
});
